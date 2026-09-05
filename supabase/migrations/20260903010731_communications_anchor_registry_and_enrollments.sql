-- =============================================================================
-- Communications on enrollments — and one definition of what a thread can be
-- anchored to.
--
-- Nicholas, 2026-09-03: "we need to have a communication on all enrollment
-- objects and all incentive record objects… communication is a related list
-- object. With lots of functionality for emails, logging calls, etc."
--
-- The Communications card was on 21 of 24 incentive layouts and on NO
-- enrollment layout, because `conversations` carried no foreign key to
-- `enrollments` — a thread could not be anchored to one, so the card had
-- nothing to hold.
--
-- The deeper problem is that WHICH objects can hold a thread was written down
-- SIX times: the CASE in list_communication_timeline, the CASE in
-- import_email_into_conversation, the parameter list of
-- find_or_create_conversation, OBJECT_CONVERSATION_FK in layoutCards.js,
-- FK_TO_ANCHOR_OBJECT in ConversationPanel.jsx and ANCHOR_FK_PARAM in
-- send-email-v1. Six copies of one fact is six chances for one to be wrong,
-- and adding enrollments meant editing all six. Same class as the hand-written
-- lists fixed on 2026-08-24 (URL/display allowlists), 2026-08-31 (four picker
-- option maps) and 2026-09-02 (applyInsertDefaults, TRIGGER_DERIVED_REQUIRED,
-- resolveInheritedParents).
--
-- So the answer is READ OFF THE TABLE'S OWN FOREIGN KEYS.
-- conversation_anchor_columns() derives object -> column from pg_catalog, and
-- the two reads that used a hand-written CASE now ask it. A future anchor is
-- one ADD COLUMN away with no map to remember.
--
-- Three kinds of FK are deliberately NOT anchors, the same exclusions
-- parentRelationships already applies: `users` (an owner or a creator is a
-- person on the thread, not a record it belongs to) and `picklist_values` (a
-- status is a value). conversations carries no self-reference.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The enrollment anchor itself.
-- -----------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS enrollment_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.conversations'::regclass
      AND conname  = 'conversations_enrollment_id_fkey'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_enrollment_id_fkey
      FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id);
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS conversations_enrollment_id_idx
  ON public.conversations (enrollment_id)
  WHERE enrollment_id IS NOT NULL;

COMMENT ON COLUMN public.conversations.enrollment_id IS
  'The enrollment this thread is anchored to, so it shows in that enrollment''s Communications card.';

-- -----------------------------------------------------------------------------
-- 2. The registry — derived, never enumerated.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversation_anchor_columns()
 RETURNS TABLE(object_name text, fk_column text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT tgt.relname::text, att.attname::text
  FROM pg_constraint c
  JOIN pg_class     src ON src.oid = c.conrelid
  JOIN pg_class     tgt ON tgt.oid = c.confrelid
  JOIN pg_namespace n   ON n.oid   = src.relnamespace
  JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
  WHERE n.nspname   = 'public'
    AND src.relname = 'conversations'
    AND c.contype   = 'f'
    AND array_length(c.conkey, 1) = 1
    AND att.atttypid = 'uuid'::regtype
    -- A person on the thread is not a record the thread belongs to, and a
    -- picklist value is not a parent.
    AND tgt.relname NOT IN ('users', 'picklist_values');
$function$;

COMMENT ON FUNCTION public.conversation_anchor_columns() IS
  'Which objects a conversation can be anchored to, and the column on conversations that holds each — read off the table''s own foreign keys, never a hand-kept list. Owners (users) and picklist values are excluded: they are people and values on a thread, not records it belongs to.';

REVOKE ALL ON FUNCTION public.conversation_anchor_columns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_anchor_columns() TO authenticated;

-- The derived answer must reproduce the eleven objects the hand-written CASE
-- listed, plus enrollments. If it does not, the derivation is wrong and
-- everything below it would be wrong too.
DO $do$
DECLARE
  v_expected text[] := ARRAY[
    'accounts','assessments','buildings','contacts','enrollments',
    'incentive_applications','opportunities','projects','properties',
    'service_appointments','units','work_orders'
  ];
  v_actual text[];
BEGIN
  SELECT array_agg(object_name ORDER BY object_name)
    INTO v_actual FROM public.conversation_anchor_columns();
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'conversation_anchor_columns() returned % — expected %', v_actual, v_expected;
  END IF;
  IF (SELECT fk_column FROM public.conversation_anchor_columns() WHERE object_name = 'enrollments')
     IS DISTINCT FROM 'enrollment_id' THEN
    RAISE EXCEPTION 'the enrollments anchor did not resolve to enrollment_id';
  END IF;
END
$do$;

-- -----------------------------------------------------------------------------
-- 3. The omni-channel feed asks the registry.
--
-- Byte-for-byte the shipped function apart from the anchor join: the scope
-- roll-up, the dedupe, the activity half and the ordering are unchanged.
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
  -- Which column anchors a thread to this object is read from the table's own
  -- foreign keys, so an object that gains an anchor gains a feed with no
  -- change here.
  SELECT s.via_object, s.via_id, s.via_label, c.*
  FROM scope s
  JOIN public.conversation_anchor_columns() a ON a.object_name = s.obj
  JOIN public.conversations c
    ON c.conv_is_deleted = false
   AND (to_jsonb(c) ->> a.fk_column)::uuid = s.id
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
  'The omni-channel Conversations feed for one record: email threads, text threads and logged activities (calls, meetings, notes) in one time-ordered list. Which objects can hold a thread is read from conversation_anchor_columns(), never enumerated. An account also rolls up its contacts'' threads and activities, labelled with the contact they came through.';

REVOKE ALL ON FUNCTION public.list_communication_timeline(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_communication_timeline(text,uuid,text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Filing a dropped email asks the registry too.
--
-- Patched in place rather than re-emitted: the function is 10 KB of parsing
-- and participant logic that has nothing to do with this change, and retyping
-- it verbatim to alter four lines is how a working function gets corrupted.
-- The patch replaces exactly one block and RAISES if it cannot find it.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'import_email_into_conversation';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'import_email_into_conversation is not installed';
  END IF;

  IF v_def LIKE '%conversation_anchor_columns%' THEN
    RETURN;  -- already patched
  END IF;

  v_new := regexp_replace(
    v_def,
    'v_fk_column := CASE p_target_object.*?END;',
    'SELECT a.fk_column INTO v_fk_column' || E'\n' ||
    '    FROM public.conversation_anchor_columns() a' || E'\n' ||
    '   WHERE a.object_name = p_target_object;',
    'ns'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'import_email_into_conversation: the anchor CASE block was not found, so nothing was patched';
  END IF;
  IF v_new LIKE '%WHEN ''incentive_application%' THEN
    RAISE EXCEPTION 'import_email_into_conversation: the anchor CASE block survived the patch';
  END IF;

  EXECUTE v_new;
END
$do$;

REVOKE ALL ON FUNCTION public.import_email_into_conversation(text,uuid,text,text,jsonb,jsonb,text,text,timestamptz,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_email_into_conversation(text,uuid,text,text,jsonb,jsonb,text,text,timestamptz,text,text,text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Threading a send: one generic anchor instead of a parameter per object.
--
-- The per-object parameters stay exactly as they are — every caller that uses
-- them is unchanged. What is new is p_anchor_object / p_anchor_id, which
-- resolve through the registry, so a caller that knows only "this thread
-- belongs to that record" no longer needs a parameter minted for its object.
-- An anchor object with no column RAISES: a thread that silently loses its
-- anchor disappears from the record it was sent from, which is the whole
-- defect this change exists to fix.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.find_or_create_conversation(text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean);

CREATE FUNCTION public.find_or_create_conversation(
  p_channel                text,
  p_our_address            text,
  p_customer_address       text,
  p_contact_id             uuid    DEFAULT NULL,
  p_account_id             uuid    DEFAULT NULL,
  p_project_id             uuid    DEFAULT NULL,
  p_service_appointment_id uuid    DEFAULT NULL,
  p_subject                text    DEFAULT NULL,
  p_opportunity_id         uuid    DEFAULT NULL,
  p_property_id            uuid    DEFAULT NULL,
  p_building_id            uuid    DEFAULT NULL,
  p_incentive_application_id uuid  DEFAULT NULL,
  p_work_order_id          uuid    DEFAULT NULL,
  p_assessment_id          uuid    DEFAULT NULL,
  p_unit_id                uuid    DEFAULT NULL,
  p_force_new              boolean DEFAULT false,
  p_anchor_object          text    DEFAULT NULL,
  p_anchor_id              uuid    DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_conv_id uuid;
  v_anchor_column text;
begin
  if p_channel is null or p_channel not in ('sms','email') then
    raise exception 'channel must be sms or email';
  end if;
  if p_our_address is null or p_customer_address is null then
    raise exception 'our_address and customer_address are required';
  end if;

  if p_anchor_object is not null and p_anchor_id is not null then
    select a.fk_column into v_anchor_column
      from public.conversation_anchor_columns() a
     where a.object_name = p_anchor_object;
    if v_anchor_column is null then
      raise exception 'a conversation cannot be anchored to %: it has no column on conversations, so the thread would not appear on the record', p_anchor_object;
    end if;
  end if;

  if not p_force_new then
    select id into v_conv_id
    from public.conversations
    where conv_channel = p_channel
      and conv_our_address = p_our_address
      and conv_customer_address = p_customer_address
      and conv_status = 'open'
      and conv_is_deleted = false
    limit 1;

    if v_conv_id is not null then
      update public.conversations
      set
        contact_id             = coalesce(contact_id, p_contact_id),
        account_id             = coalesce(account_id, p_account_id),
        project_id             = coalesce(project_id, p_project_id),
        service_appointment_id = coalesce(service_appointment_id, p_service_appointment_id),
        opportunity_id         = coalesce(opportunity_id, p_opportunity_id),
        property_id            = coalesce(property_id, p_property_id),
        building_id            = coalesce(building_id, p_building_id),
        unit_id                = coalesce(unit_id, p_unit_id),
        incentive_application_id = coalesce(incentive_application_id, p_incentive_application_id),
        work_order_id          = coalesce(work_order_id, p_work_order_id),
        assessment_id          = coalesce(assessment_id, p_assessment_id),
        conv_subject           = coalesce(conv_subject, p_subject),
        conv_updated_at        = now()
      where id = v_conv_id;
    end if;
  end if;

  if v_conv_id is null then
    insert into public.conversations (
      conv_record_number, conv_channel, conv_our_address, conv_customer_address,
      conv_status, conv_subject,
      contact_id, account_id, project_id, service_appointment_id,
      opportunity_id, property_id, building_id, unit_id, incentive_application_id,
      work_order_id, assessment_id
    ) values (
      '', p_channel, p_our_address, p_customer_address,
      'open', p_subject,
      p_contact_id, p_account_id, p_project_id, p_service_appointment_id,
      p_opportunity_id, p_property_id, p_building_id, p_unit_id, p_incentive_application_id,
      p_work_order_id, p_assessment_id
    )
    returning id into v_conv_id;
  end if;

  -- The generic anchor fills its column only when the thread does not already
  -- carry one, exactly as the explicit parameters above do.
  if v_anchor_column is not null then
    execute format('update public.conversations set %I = coalesce(%I, $1) where id = $2', v_anchor_column, v_anchor_column)
      using p_anchor_id, v_conv_id;
  end if;

  return v_conv_id;
end $function$;

COMMENT ON FUNCTION public.find_or_create_conversation(text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text,uuid) IS
  'Finds the open thread with this counterparty on this channel, or opens one, and fills in any anchor it does not already carry. p_anchor_object / p_anchor_id anchor a thread to any object conversation_anchor_columns() knows, so a new anchor needs no new parameter.';

REVOKE ALL ON FUNCTION public.find_or_create_conversation(text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text,uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. An email from an enrollment has to come from somewhere.
--
-- resolve_outbound_mailbox_for_anchor walks the anchor to a state and picks
-- that state's mailbox. It had no enrollments branch, so a send from an
-- enrollment would have failed with "no mailbox could be resolved" — the card
-- would have been there and the send would not have worked.
--
-- Enrollments carry no state of their own (enrollment_payment_state is a
-- payment status, not a place), so the state comes from the property, then the
-- opportunity. Patched in place, one branch inserted, for the same reason as
-- the import function above.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE
  v_def text;
  v_new text;
  v_branch text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resolve_outbound_mailbox_for_anchor';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'resolve_outbound_mailbox_for_anchor is not installed';
  END IF;
  IF v_def LIKE '%p_anchor_object = ''enrollments''%' THEN
    RETURN;  -- already patched
  END IF;

  v_branch :=
    'elsif p_anchor_object = ''enrollments'' then' || E'\n' ||
    '    select pr.property_state, ''enrollments.property_id -> properties.property_state''' || E'\n' ||
    '      into v_state, v_path' || E'\n' ||
    '      from enrollments e' || E'\n' ||
    '      join properties pr on pr.id = e.property_id' || E'\n' ||
    '     where e.id = p_anchor_record_id;' || E'\n' ||
    '    if v_state is null then' || E'\n' ||
    '      select o.opportunity_state, ''enrollments.opportunity_id -> opportunities.opportunity_state''' || E'\n' ||
    '        into v_state, v_path' || E'\n' ||
    '        from enrollments e' || E'\n' ||
    '        join opportunities o on o.id = e.opportunity_id' || E'\n' ||
    '       where e.id = p_anchor_record_id;' || E'\n' ||
    '    end if;' || E'\n\n' ||
    '  elsif p_anchor_object = ''incentive_applications'' then';

  v_new := replace(v_def, 'elsif p_anchor_object = ''incentive_applications'' then', v_branch);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'resolve_outbound_mailbox_for_anchor: no incentive_applications branch to insert before';
  END IF;

  EXECUTE v_new;
END
$do$;

REVOKE ALL ON FUNCTION public.resolve_outbound_mailbox_for_anchor(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_outbound_mailbox_for_anchor(text,uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Logging a call on an enrollment or an incentive should offer its parents.
--
-- Nicholas, 2026-08-25, on contacts: logging a call offered nothing to relate,
-- so the call never reached the account. The same was true of enrollments and
-- incentive applications, which is half of "lots of functionality for emails,
-- logging calls, etc."
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

  ELSIF p_object = 'enrollments' THEN
    RETURN QUERY
      SELECT 'properties', p.id, p.property_name, 'Property'
      FROM enrollments e JOIN properties p ON p.id = e.property_id
      WHERE e.id = p_id AND p.property_is_deleted = false
      UNION ALL
      SELECT 'buildings', b.id, b.building_name, 'Building'
      FROM enrollments e JOIN buildings b ON b.id = e.building_id
      WHERE e.id = p_id AND b.building_is_deleted = false
      UNION ALL
      SELECT 'opportunities', o.id, o.opportunity_name, 'Opportunity'
      FROM enrollments e JOIN opportunities o ON o.id = e.opportunity_id
      WHERE e.id = p_id AND o.opportunity_is_deleted = false
      UNION ALL
      SELECT 'accounts', a.id, a.account_name, 'Account'
      FROM enrollments e
      JOIN properties p ON p.id = e.property_id
      JOIN accounts a ON a.id = p.property_account_id
      WHERE e.id = p_id AND a.account_is_deleted = false;

  ELSIF p_object = 'incentive_applications' THEN
    RETURN QUERY
      SELECT 'properties', p.id, p.property_name, 'Property'
      FROM incentive_applications ia JOIN properties p ON p.id = ia.property_id
      WHERE ia.id = p_id AND p.property_is_deleted = false
      UNION ALL
      SELECT 'buildings', b.id, b.building_name, 'Building'
      FROM incentive_applications ia JOIN buildings b ON b.id = ia.building_id
      WHERE ia.id = p_id AND b.building_is_deleted = false
      UNION ALL
      SELECT 'opportunities', o.id, o.opportunity_name, 'Opportunity'
      FROM incentive_applications ia JOIN opportunities o ON o.id = ia.opportunity_id
      WHERE ia.id = p_id AND o.opportunity_is_deleted = false
      UNION ALL
      SELECT 'projects', pr.id, pr.project_name, 'Project'
      FROM incentive_applications ia JOIN projects pr ON pr.id = ia.project_id
      WHERE ia.id = p_id AND pr.project_is_deleted = false
      UNION ALL
      SELECT 'accounts', a.id, a.account_name, 'Account'
      FROM incentive_applications ia
      JOIN properties p ON p.id = ia.property_id
      JOIN accounts a ON a.id = p.property_account_id
      WHERE ia.id = p_id AND a.account_is_deleted = false;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.list_relatable_records(text,uuid) IS
  'The parent records a logged call, meeting or note on this record can also be related to, so the activity reaches the property, building, opportunity, project and account it belongs to.';

REVOKE ALL ON FUNCTION public.list_relatable_records(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_relatable_records(text,uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Geographic record access follows the new anchors.
--
-- record_state_scope_conversations resolves a thread's state through its
-- parents, and it knew six of them. A thread anchored ONLY to an enrollment or
-- an incentive application resolved to nothing and — the engine fails closed,
-- correctly — was invisible to every state-restricted user. Registering the
-- two paths is what makes the new card work for them; it can only reveal
-- threads whose parent that user may already see.
-- -----------------------------------------------------------------------------
INSERT INTO public.record_state_scope_sources (
  rsss_record_number, rsss_object_name, rsss_resolution_kind,
  rsss_parent_object_name, rsss_parent_fk_column, rsss_path_order, rsss_notes
)
SELECT '', 'conversations', 'parent_lookup', v.parent, v.fk, v.ord,
       'A thread anchored to this record is in scope when the record is.'
FROM (VALUES
  ('enrollments',            'enrollment_id',            7),
  ('incentive_applications', 'incentive_application_id', 8)
) AS v(parent, fk, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources r
  WHERE r.rsss_object_name = 'conversations'
    AND r.rsss_parent_object_name = v.parent
    AND r.rsss_is_deleted = false
);

SELECT public.install_record_state_scope_resolver('conversations');
SELECT public.install_record_state_scoping('conversations');

-- -----------------------------------------------------------------------------
-- 9. Prove it, rather than assume it.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE
  v_src text;
  v_n   int;
BEGIN
  -- The resolver now reaches both new parents.
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_state_scope_conversations';
  IF v_src NOT LIKE '%record_state_scope_enrollments(s0.enrollment_id%' THEN
    RAISE EXCEPTION 'the conversations state-scope resolver does not reach enrollments';
  END IF;
  IF v_src NOT LIKE '%record_state_scope_incentive_applications(s0.incentive_application_id%' THEN
    RAISE EXCEPTION 'the conversations state-scope resolver does not reach incentive applications';
  END IF;

  -- Nothing in the scoping engine is left dangling.
  SELECT count(*) INTO v_n FROM public.record_state_scope_integrity();
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'record_state_scope_integrity() reported % dangling row(s)', v_n;
  END IF;

  -- The feed answers for an enrollment (zero rows today — what matters is that
  -- it resolves the anchor instead of raising).
  PERFORM * FROM public.list_communication_timeline('enrollments', gen_random_uuid());

  -- And it still answers for the objects that already had a card.
  PERFORM * FROM public.list_communication_timeline('accounts', gen_random_uuid());
  PERFORM * FROM public.list_communication_timeline('incentive_applications', gen_random_uuid());
END
$do$;

NOTIFY pgrst, 'reload schema';
