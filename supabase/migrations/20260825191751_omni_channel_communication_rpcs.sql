-- =============================================================================
-- The three reads and one write behind the omni-channel Conversations area.
--
--   resolve_email_participants(text[])         who each address is
--   import_email_into_conversation(...)        file one parsed email
--   list_communication_timeline(object, id)    email + text + call, one feed
--
-- All SECURITY INVOKER: every one of them touches contacts, accounts,
-- conversations and messages, and each caller must see exactly what RLS —
-- including the geographic state scope — says they may see. A definer function
-- here would hand a state-restricted user another state's contacts through the
-- back door of a matched email address.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Who is this address?
--
-- Order matters and is deliberate, most specific first: our own mailbox, then
-- an EES person, then the individual, then the company, then the company's
-- domain. Nothing is invented — an address that resolves to nobody comes back
-- as 'unmatched' with a null match, which is what the import stores.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_email_participants(p_addresses text[])
 RETURNS TABLE(
   address        text,
   matched_object text,
   matched_id     uuid,
   matched_label  text,
   match_basis    text,
   is_ees_side    boolean,
   contact_id     uuid,
   account_id     uuid,
   account_name   text,
   is_ambiguous   boolean
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH input AS (
  SELECT DISTINCT lower(btrim(a)) AS addr
  FROM unnest(COALESCE(p_addresses, ARRAY[]::text[])) AS a
  WHERE btrim(COALESCE(a,'')) <> '' AND a LIKE '%@%'
),
-- The domain half of the address, used only for the account-website fallback.
-- Consumer mail hosts are excluded: a gmail.com address says nothing about
-- which company someone belongs to.
dom AS (
  SELECT addr, split_part(addr,'@',2) AS domain FROM input
),
mailbox AS (
  SELECT i.addr, o.id, o.obm_display_name AS label
  FROM input i
  JOIN public.outbound_mailboxes o
    ON lower(o.obm_address) = i.addr AND o.obm_is_deleted = false
),
usr AS (
  SELECT i.addr, u.id,
         COALESCE(NULLIF(btrim(COALESCE(u.user_first_name,'') || ' ' || COALESCE(u.user_last_name,'')),''),
                  u.user_name, u.user_email) AS label
  FROM input i
  JOIN public.users u ON lower(u.user_email) = i.addr
),
ct AS (
  SELECT DISTINCT ON (i.addr)
         i.addr, c.id, c.contact_name AS label, c.contact_account_id,
         (SELECT count(*) FROM public.contacts c2
           WHERE lower(c2.contact_email) = i.addr AND c2.contact_is_deleted = false) > 1 AS ambiguous
  FROM input i
  JOIN public.contacts c ON lower(c.contact_email) = i.addr AND c.contact_is_deleted = false
  ORDER BY i.addr, c.contact_updated_at DESC NULLS LAST, c.contact_created_at DESC NULLS LAST
),
acct_email AS (
  SELECT DISTINCT ON (i.addr) i.addr, a.id, a.account_name AS label
  FROM input i
  JOIN public.accounts a ON lower(a.account_email) = i.addr AND a.account_is_deleted = false
  ORDER BY i.addr, a.account_updated_at DESC NULLS LAST
),
-- Exactly one account may claim a domain. Two accounts on the same domain is
-- not a match — it is a question, and guessing would file the email on the
-- wrong company.
acct_domain AS (
  SELECT d.addr, (array_agg(a.id))[1] AS id, (array_agg(a.account_name))[1] AS label
  FROM dom d
  JOIN public.accounts a
    ON a.account_is_deleted = false
   AND a.account_website IS NOT NULL
   AND split_part(lower(regexp_replace(regexp_replace(a.account_website, '^https?://', ''), '^www\.', '')), '/', 1) = d.domain
  WHERE d.domain NOT IN ('gmail.com','yahoo.com','outlook.com','hotmail.com','aol.com',
                         'icloud.com','me.com','live.com','msn.com','comcast.net','att.net',
                         'verizon.net','sbcglobal.net','protonmail.com','proton.me')
  GROUP BY d.addr
  HAVING count(DISTINCT a.id) = 1
)
SELECT
  i.addr AS address,
  CASE
    WHEN m.id  IS NOT NULL THEN 'outbound_mailboxes'
    WHEN u.id  IS NOT NULL THEN 'users'
    WHEN c.id  IS NOT NULL THEN 'contacts'
    WHEN ae.id IS NOT NULL THEN 'accounts'
    WHEN ad.id IS NOT NULL THEN 'accounts'
  END AS matched_object,
  COALESCE(m.id, u.id, c.id, ae.id, ad.id) AS matched_id,
  COALESCE(m.label, u.label, c.label, ae.label, ad.label) AS matched_label,
  CASE
    WHEN m.id  IS NOT NULL THEN 'outbound_mailbox'
    WHEN u.id  IS NOT NULL THEN 'user_email'
    WHEN c.id  IS NOT NULL THEN 'contact_email'
    WHEN ae.id IS NOT NULL THEN 'account_email'
    WHEN ad.id IS NOT NULL THEN 'account_website_domain'
    ELSE 'unmatched'
  END AS match_basis,
  (m.id IS NOT NULL OR u.id IS NOT NULL) AS is_ees_side,
  c.id AS contact_id,
  COALESCE(ae.id, ad.id, c.contact_account_id) AS account_id,
  COALESCE(ae.label, ad.label, ca.account_name) AS account_name,
  COALESCE(c.ambiguous, false) AS is_ambiguous
FROM input i
LEFT JOIN mailbox    m  ON m.addr  = i.addr
LEFT JOIN usr        u  ON u.addr  = i.addr
LEFT JOIN ct         c  ON c.addr  = i.addr
LEFT JOIN acct_email ae ON ae.addr = i.addr
LEFT JOIN acct_domain ad ON ad.addr = i.addr
LEFT JOIN public.accounts ca ON ca.id = c.contact_account_id AND ca.account_is_deleted = false;
$function$;

COMMENT ON FUNCTION public.resolve_email_participants(text[]) IS
  'Resolves email addresses to the contact / account / EES user / EES mailbox behind them. Returns one row per distinct address, including addresses that matched nobody (match_basis = unmatched).';

REVOKE ALL ON FUNCTION public.resolve_email_participants(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_email_participants(text[]) TO authenticated;


-- -----------------------------------------------------------------------------
-- File one email onto one record.
--
-- The caller has already parsed the message (.msg / .eml / a dragged payload)
-- in the browser; this function decides everything that must be decided in the
-- database: which side EES is on, which thread it belongs to, whether we have
-- already filed it, and who was involved.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_email_into_conversation(
  p_target_object        text,
  p_target_id            uuid,
  p_from_address         text,
  p_from_name            text          DEFAULT NULL,
  p_to                   jsonb         DEFAULT '[]'::jsonb,
  p_cc                   jsonb         DEFAULT '[]'::jsonb,
  p_subject              text          DEFAULT NULL,
  p_body                 text          DEFAULT NULL,
  p_sent_at              timestamptz   DEFAULT NULL,
  p_internet_message_id  text          DEFAULT NULL,
  p_import_source        text          DEFAULT 'eml_file',
  p_file_name            text          DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me              uuid := public.current_app_user_id();
  v_my_email        text;
  v_from            text := lower(btrim(COALESCE(p_from_address,'')));
  v_to_addrs        text[];
  v_cc_addrs        text[];
  v_all             text[];
  v_direction       text;
  v_our_address     text;
  v_customer        text;
  v_conv_id         uuid;
  v_msg_id          uuid;
  v_existing        uuid;
  v_unread          integer;
  v_fk_column       text;
  v_contact_id      uuid;
  v_account_id      uuid;
  v_sent_at         timestamptz := COALESCE(p_sent_at, now());
  v_participants    jsonb;
  v_rec             record;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to file an email.';
  END IF;
  IF p_target_object IS NULL OR p_target_id IS NULL THEN
    RAISE EXCEPTION 'A record is required to file an email against.';
  END IF;
  IF v_from = '' OR v_from NOT LIKE '%@%' THEN
    RAISE EXCEPTION 'The email has no readable sender address, so it cannot be filed.';
  END IF;

  -- The FK on conversations that points at the record being dropped on. An
  -- object with no column here has no conversations area, so filing onto it
  -- would put the email somewhere nobody can find it.
  v_fk_column := CASE p_target_object
    WHEN 'contacts'               THEN 'contact_id'
    WHEN 'accounts'               THEN 'account_id'
    WHEN 'projects'               THEN 'project_id'
    WHEN 'service_appointments'   THEN 'service_appointment_id'
    WHEN 'work_orders'            THEN 'work_order_id'
    WHEN 'incentive_applications' THEN 'incentive_application_id'
    WHEN 'opportunities'          THEN 'opportunity_id'
    WHEN 'assessments'            THEN 'assessment_id'
    WHEN 'buildings'              THEN 'building_id'
    WHEN 'properties'             THEN 'property_id'
    WHEN 'units'                  THEN 'unit_id'
  END;
  IF v_fk_column IS NULL THEN
    RAISE EXCEPTION '% has no Conversations area, so an email cannot be filed on it.', p_target_object;
  END IF;

  SELECT lower(u.user_email) INTO v_my_email FROM public.users u WHERE u.id = v_me;

  SELECT array_agg(DISTINCT lower(btrim(x)))
    INTO v_to_addrs
  FROM jsonb_array_elements(COALESCE(p_to,'[]'::jsonb)) e,
       LATERAL (SELECT COALESCE(e->>'address', e#>>'{}')) AS t(x)
  WHERE btrim(COALESCE(x,'')) <> '' AND x LIKE '%@%';

  SELECT array_agg(DISTINCT lower(btrim(x)))
    INTO v_cc_addrs
  FROM jsonb_array_elements(COALESCE(p_cc,'[]'::jsonb)) e,
       LATERAL (SELECT COALESCE(e->>'address', e#>>'{}')) AS t(x)
  WHERE btrim(COALESCE(x,'')) <> '' AND x LIKE '%@%';

  v_to_addrs := COALESCE(v_to_addrs, ARRAY[]::text[]);
  v_cc_addrs := COALESCE(v_cc_addrs, ARRAY[]::text[]);
  v_all := ARRAY[v_from] || v_to_addrs || v_cc_addrs;

  -- Already filed? The Internet Message-ID survives a forward and a re-save,
  -- so a second drop of the same email returns the first one instead of
  -- doubling it.
  IF p_internet_message_id IS NOT NULL AND btrim(p_internet_message_id) <> '' THEN
    SELECT m.id, m.conversation_id INTO v_msg_id, v_conv_id
    FROM public.messages m
    WHERE m.msg_external_message_id = btrim(p_internet_message_id)
      AND m.msg_import_source IS NOT NULL
      AND m.msg_is_deleted = false
    LIMIT 1;
    IF v_msg_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'conversation_id', v_conv_id,
        'message_id',      v_msg_id,
        'was_duplicate',   true
      );
    END IF;
  END IF;

  -- Which side is EES on? An email SENT by one of our mailboxes or one of our
  -- people is outbound; anything else is inbound. Status is never guessed from
  -- the record — it is read from the addresses.
  IF EXISTS (SELECT 1 FROM public.resolve_email_participants(ARRAY[v_from]) r WHERE r.is_ees_side) THEN
    v_direction   := 'outbound';
    v_our_address := v_from;
    v_customer    := COALESCE(v_to_addrs[1], v_cc_addrs[1], v_from);
  ELSE
    v_direction := 'inbound';
    SELECT r.address INTO v_our_address
    FROM public.resolve_email_participants(v_to_addrs || v_cc_addrs) r
    WHERE r.is_ees_side
    LIMIT 1;
    -- A thread between two outside parties, forwarded to us for the file. The
    -- person filing it is the EES side of the record, and saying so is more
    -- honest than inventing a mailbox that was never on the message.
    v_our_address := COALESCE(v_our_address, v_my_email);
    v_customer    := v_from;
  END IF;

  IF v_our_address IS NULL THEN
    RAISE EXCEPTION 'No EES address on the email and your user record has no email, so there is nothing to file it under.';
  END IF;

  -- Who the counterparty resolves to, so the thread lands on the contact and
  -- the company even when it was dropped on one of them.
  SELECT r.contact_id, r.account_id INTO v_contact_id, v_account_id
  FROM public.resolve_email_participants(ARRAY[v_customer]) r
  LIMIT 1;

  -- One thread per counterparty per record, which is how every other email in
  -- LEAP already threads.
  EXECUTE format(
    'SELECT id FROM public.conversations
      WHERE %I = $1 AND conv_channel = ''email''
        AND lower(conv_customer_address) = $2 AND conv_is_deleted = false
      ORDER BY conv_last_message_at DESC NULLS LAST LIMIT 1', v_fk_column)
    INTO v_conv_id USING p_target_id, lower(v_customer);

  IF v_conv_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.conversations (
         conv_record_number, conv_channel, conv_our_address, conv_customer_address,
         conv_status, conv_subject, %I, conv_owner, conv_created_by, conv_updated_by
       ) VALUES ('''', ''email'', $1, $2, ''open'', $3, $4, $5, $5, $5) RETURNING id', v_fk_column)
      INTO v_conv_id USING v_our_address, v_customer, NULLIF(btrim(COALESCE(p_subject,'')),''), p_target_id, v_me;
  END IF;

  -- Carry the contact and the company onto the thread when the drop target did
  -- not already supply them, so the same email shows on both records.
  UPDATE public.conversations c SET
    contact_id = COALESCE(c.contact_id, v_contact_id),
    account_id = COALESCE(c.account_id, v_account_id,
                          (SELECT ct.contact_account_id FROM public.contacts ct
                            WHERE ct.id = COALESCE(c.contact_id, v_contact_id)))
  WHERE c.id = v_conv_id;

  SELECT c.conv_inbound_unread_count INTO v_unread FROM public.conversations c WHERE c.id = v_conv_id;

  INSERT INTO public.messages (
    msg_record_number, conversation_id, msg_direction, msg_channel,
    msg_from_address, msg_to_address, msg_cc_address, msg_subject, msg_body,
    msg_provider, msg_status, msg_sent_at, msg_delivered_at,
    msg_external_message_id, msg_import_source, msg_import_file_name,
    msg_imported_by, msg_imported_at, msg_created_by, msg_updated_by, contact_id
  ) VALUES (
    '', v_conv_id, v_direction, 'email',
    v_from, array_to_string(v_to_addrs, '; '), NULLIF(array_to_string(v_cc_addrs, '; '),''),
    NULLIF(btrim(COALESCE(p_subject,'')),''), COALESCE(p_body,''),
    'manual_import',
    CASE WHEN v_direction = 'inbound' THEN 'received' ELSE 'sent' END,
    v_sent_at, v_sent_at,
    NULLIF(btrim(COALESCE(p_internet_message_id,'')),''),
    p_import_source, p_file_name, v_me, now(), v_me, v_me, v_contact_id
  )
  RETURNING id INTO v_msg_id;

  -- The rollup trigger stamps the thread with now() and counts an inbound
  -- message as unread. Neither is true of an email being filed by hand: it was
  -- sent when it was sent, and the person filing it has plainly read it.
  UPDATE public.conversations c SET
    conv_last_message_at = (SELECT max(COALESCE(m.msg_sent_at, m.msg_created_at))
                              FROM public.messages m
                             WHERE m.conversation_id = v_conv_id AND m.msg_is_deleted = false),
    conv_last_message_direction = v_direction,
    conv_last_message_preview   = left(COALESCE(p_body,''), 200),
    conv_inbound_unread_count   = v_unread
  WHERE c.id = v_conv_id;

  -- Who was involved, kept.
  FOR v_rec IN
    WITH people AS (
      SELECT 'from'::text AS prole, v_from AS paddr,
             NULLIF(btrim(COALESCE(p_from_name,'')),'') AS pname
      UNION ALL
      SELECT 'to', lower(btrim(COALESCE(e->>'address', e#>>'{}'))),
             NULLIF(btrim(COALESCE(e->>'name','')),'')
        FROM jsonb_array_elements(COALESCE(p_to,'[]'::jsonb)) e
      UNION ALL
      SELECT 'cc', lower(btrim(COALESCE(e->>'address', e#>>'{}'))),
             NULLIF(btrim(COALESCE(e->>'name','')),'')
        FROM jsonb_array_elements(COALESCE(p_cc,'[]'::jsonb)) e
    )
    SELECT DISTINCT ON (pp.prole, pp.paddr) pp.prole, pp.pname, r.*
    FROM people pp
    JOIN public.resolve_email_participants(v_all) r ON r.address = pp.paddr
    WHERE pp.paddr LIKE '%@%'
    ORDER BY pp.prole, pp.paddr
  LOOP
    INSERT INTO public.message_participants (
      mpart_record_number, message_id, mpart_role, mpart_address, mpart_display_name,
      mpart_matched_object, mpart_matched_id, mpart_match_basis, mpart_is_ees_side,
      contact_id, account_id, mpart_created_by, mpart_updated_by
    ) VALUES (
      '', v_msg_id, v_rec.prole, v_rec.address, v_rec.pname,
      v_rec.matched_object, v_rec.matched_id, v_rec.match_basis, v_rec.is_ees_side,
      v_rec.contact_id, v_rec.account_id, v_me, v_me
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object(
           'role', mp.mpart_role, 'address', mp.mpart_address,
           'matched_object', mp.mpart_matched_object, 'matched_id', mp.mpart_matched_id,
           'match_basis', mp.mpart_match_basis, 'is_ees_side', mp.mpart_is_ees_side)
           ORDER BY mp.mpart_role, mp.mpart_address)
    INTO v_participants
  FROM public.message_participants mp
  WHERE mp.message_id = v_msg_id AND mp.mpart_is_deleted = false;

  RETURN jsonb_build_object(
    'conversation_id',  v_conv_id,
    'message_id',       v_msg_id,
    'direction',        v_direction,
    'our_address',      v_our_address,
    'customer_address', v_customer,
    'contact_id',       v_contact_id,
    'account_id',       v_account_id,
    'was_duplicate',    false,
    'participants',     COALESCE(v_participants, '[]'::jsonb)
  );
END;
$function$;

COMMENT ON FUNCTION public.import_email_into_conversation(text,uuid,text,text,jsonb,jsonb,text,text,timestamptz,text,text,text) IS
  'Files one already-parsed email onto a record: derives direction from who sent it, threads it by counterparty, stores the message and every participant, and returns what it matched. Re-filing the same Internet Message-ID returns the original instead of duplicating it.';

REVOKE ALL ON FUNCTION public.import_email_into_conversation(text,uuid,text,text,jsonb,jsonb,text,text,timestamptz,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_email_into_conversation(text,uuid,text,text,jsonb,jsonb,text,text,timestamptz,text,text,text) TO authenticated;


-- -----------------------------------------------------------------------------
-- One feed: email threads, text threads, and logged calls together.
--
-- Nicholas, 2026-08-25: "phone call messages need to be listed under the
-- Conversations tab… we definitely need to make sure we have one omni channel
-- for communication and tracking area for reach. For contacts and accounts."
--
-- An account rolls up its contacts' conversations and activities. A call with
-- a person at a company is a call with the company — Salesforce's own
-- account-activity roll-up, and the reason an account page was empty before
-- while every one of its contacts had history.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_communication_timeline(
  p_object         text,
  p_id             uuid,
  p_channel_filter text DEFAULT NULL
)
 RETURNS TABLE(
   entry_kind        text,
   entry_id          uuid,
   record_number     text,
   channel           text,
   activity_type     text,
   subject           text,
   preview           text,
   body              text,
   occurred_at       timestamptz,
   direction         text,
   unread_count      integer,
   counterparty      text,
   our_address       text,
   actor_name        text,
   contact_name      text,
   duration_seconds  integer,
   via_object        text,
   via_id            uuid,
   via_label         text
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH scope AS (
  -- The records whose communication counts as this record's. An account
  -- includes its own contacts; everything else is itself.
  SELECT p_object AS obj, p_id AS id, NULL::text AS via_object, NULL::uuid AS via_id, NULL::text AS via_label
  UNION ALL
  SELECT 'contacts', c.id, 'contacts', c.id, c.contact_name
  FROM public.contacts c
  WHERE p_object = 'accounts' AND c.contact_account_id = p_id AND c.contact_is_deleted = false
),
conv AS (
  SELECT s.via_object, s.via_id, s.via_label, c.*
  FROM scope s
  JOIN public.conversations c
    ON c.conv_is_deleted = false
   AND CASE s.obj
         WHEN 'contacts'               THEN c.contact_id
         WHEN 'accounts'               THEN c.account_id
         WHEN 'projects'               THEN c.project_id
         WHEN 'service_appointments'   THEN c.service_appointment_id
         WHEN 'work_orders'            THEN c.work_order_id
         WHEN 'incentive_applications' THEN c.incentive_application_id
         WHEN 'opportunities'          THEN c.opportunity_id
         WHEN 'assessments'            THEN c.assessment_id
         WHEN 'buildings'              THEN c.building_id
         WHEN 'properties'             THEN c.property_id
         WHEN 'units'                  THEN c.unit_id
       END = s.id
  WHERE p_channel_filter IS NULL OR c.conv_channel = p_channel_filter
),
-- A conversation reached both directly and through a contact is one thread,
-- and the direct reading wins so it is not labelled "via" on its own record.
conv_deduped AS (
  SELECT DISTINCT ON (id) * FROM conv ORDER BY id, (via_object IS NULL) DESC
),
act AS (
  SELECT DISTINCT ON (a.id) s.via_object, s.via_id, s.via_label, a.*
  FROM scope s
  JOIN public.activity_relations ar
    ON ar.ar_related_object = s.obj AND ar.ar_related_id = s.id
  JOIN public.activities a ON a.id = ar.activity_id
  WHERE p_channel_filter IS NULL
  ORDER BY a.id, (s.via_object IS NULL) DESC
)
SELECT
  'conversation'::text, c.id, c.conv_record_number, c.conv_channel, NULL::text,
  c.conv_subject,
  c.conv_last_message_preview,
  NULL::text,
  c.conv_last_message_at,
  c.conv_last_message_direction,
  c.conv_inbound_unread_count,
  c.conv_customer_address,
  c.conv_our_address,
  NULL::text, NULL::text, NULL::integer,
  c.via_object, c.via_id, c.via_label
FROM conv_deduped c
UNION ALL
SELECT
  'activity'::text, a.id, NULL::text,
  -- A logged Call is a channel in this feed exactly as email and text are.
  CASE lower(a.activity_type) WHEN 'call' THEN 'call'
                              WHEN 'text message' THEN 'sms'
                              WHEN 'email' THEN 'email'
                              ELSE 'activity' END,
  a.activity_type,
  a.subject,
  left(COALESCE(a.body,''), 200),
  a.body,
  COALESCE(a.performed_at, a.created_at),
  a.direction,
  0,
  ct.contact_name,
  NULL::text,
  COALESCE(NULLIF(btrim(COALESCE(u.user_first_name,'') || ' ' || COALESCE(u.user_last_name,'')),''),
           u.user_name),
  ct.contact_name,
  a.duration_seconds,
  a.via_object, a.via_id, a.via_label
FROM act a
LEFT JOIN public.users u ON u.id = a.performed_by
LEFT JOIN public.contacts ct ON a.secondary_object = 'contacts' AND ct.id = a.secondary_id
ORDER BY 9 DESC NULLS LAST
LIMIT 200;
$function$;

COMMENT ON FUNCTION public.list_communication_timeline(text,uuid,text) IS
  'The omni-channel Conversations feed for one record: email threads, text threads and logged activities (calls, meetings, notes) in one time-ordered list. An account also rolls up its contacts'' threads and activities, labelled with the contact they came through.';

REVOKE ALL ON FUNCTION public.list_communication_timeline(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_communication_timeline(text,uuid,text) TO authenticated;


-- -----------------------------------------------------------------------------
-- Logging a call on a contact should offer its company.
--
-- list_relatable_records has known only opportunities and projects since it
-- shipped, so the Log Activity composer on a contact offered nothing to relate
-- and the call never reached the account. Contacts and accounts are exactly
-- the two objects this workstream is about.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_relatable_records(p_object text, p_id uuid)
 RETURNS TABLE(rel_object text, rel_id uuid, rel_label text, rel_type_label text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_object = 'opportunities' THEN
    RETURN QUERY
      SELECT 'properties', p.id, p.property_name, 'Property'
      FROM opportunities o JOIN properties p ON p.id = o.property_id
      WHERE o.id = p_id
      UNION ALL
      SELECT 'accounts', a.id, a.account_name, 'Account'
      FROM opportunities o JOIN accounts a ON a.id = o.opportunity_account_id
      WHERE o.id = p_id
      UNION ALL
      SELECT 'buildings', b.id, b.building_name, 'Building'
      FROM opportunities o JOIN buildings b ON b.id = o.building_id
      WHERE o.id = p_id;

  ELSIF p_object = 'projects' THEN
    RETURN QUERY
      SELECT 'opportunities', o.id, o.opportunity_name, 'Opportunity'
      FROM projects pr JOIN opportunities o ON o.id = pr.opportunity_id
      WHERE pr.id = p_id
      UNION ALL
      SELECT 'properties', p.id, p.property_name, 'Property'
      FROM projects pr JOIN properties p ON p.id = pr.property_id
      WHERE pr.id = p_id
      UNION ALL
      SELECT 'accounts', a.id, a.account_name, 'Account'
      FROM projects pr JOIN accounts a ON a.id = pr.project_account_id
      WHERE pr.id = p_id
      UNION ALL
      SELECT 'buildings', b.id, b.building_name, 'Building'
      FROM projects pr JOIN buildings b ON b.id = pr.building_id
      WHERE pr.id = p_id;

  ELSIF p_object = 'contacts' THEN
    RETURN QUERY
      SELECT 'accounts', a.id, a.account_name, 'Account'
      FROM contacts c JOIN accounts a ON a.id = c.contact_account_id
      WHERE c.id = p_id AND a.account_is_deleted = false;
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';
