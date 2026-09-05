-- A thread is RELATED TO any record — Salesforce "Related To" (WhatId) parity.
--
-- Nicholas, 2026-09-05: "I really want this on most objects. I want to be able
-- to put communications on wherever I want: on projects, on work orders, on
-- anything. If I'm communicating, I want to be able to log emails, phone
-- calls, chat messages, and everything else to that specific object. I don't
-- want to keep doing this one by one. Why are there limits? I don't think
-- there should be."
--
-- THE LIMIT: a thread could only belong to an object that had its OWN COLUMN
-- on `conversations` (twelve of them, derived by conversation_anchor_columns()
-- from the table's foreign keys). Every new object was a schema change — "one
-- by one" is exactly what that premise forces.
--
-- THE FIX: a thread carries a polymorphic Related To —
-- `conv_related_object` + `conv_related_id` — the way `activity_relations`
-- already does for a logged call. The twelve foreign-key columns STAY: they
-- carry the owner-chain visibility rule, the state-scope paths and the
-- account roll-up, and every existing caller keeps working unchanged. Related
-- To is stamped on EVERY thread (derived from the most specific foreign key
-- when a legacy caller supplies only those), so there is one answer to
-- "which record is this thread about".
--
-- WHICH OBJECTS: conversation_related_to_objects() — every foreign-key-backed
-- object, plus every record-carrying table (a `<prefix>_record_number`
-- column, the anchor recordInsertDefaults uses) that has a live page layout.
-- Two are excluded by rule, not by list: `conversations` (a thread about a
-- thread) and `users` (a person on a thread is not a record it belongs to —
-- the same rule the foreign-key derivation already applies).
--
-- Nothing here re-emits a long function to change a few lines: the two
-- 10 KB functions are patched in place against their deployed definitions,
-- and the migration RAISES if an anchor it expects is not there.

-- ─── 1. The Related To pair ────────────────────────────────────────────────

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS conv_related_object text,
  ADD COLUMN IF NOT EXISTS conv_related_id     uuid;

COMMENT ON COLUMN public.conversations.conv_related_object IS
  'Related To (Salesforce WhatId): the object the thread belongs to. Any object conversation_related_to_objects() lists.';
COMMENT ON COLUMN public.conversations.conv_related_id IS
  'Related To: the record id on conv_related_object.';

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_related_to_pair_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_related_to_pair_check
  CHECK ((conv_related_object IS NULL) = (conv_related_id IS NULL));

CREATE INDEX IF NOT EXISTS conversations_related_to_idx
  ON public.conversations (conv_related_object, conv_related_id)
  WHERE conv_related_id IS NOT NULL AND conv_is_deleted = false;

-- ─── 2. Which objects a thread can be related to ───────────────────────────

CREATE OR REPLACE FUNCTION public.conversation_related_to_objects()
RETURNS TABLE(object_name text, fk_column text, is_polymorphic boolean)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  WITH fk AS (
    SELECT a.object_name, a.fk_column FROM public.conversation_anchor_columns() a
  ),
  pages AS (
    SELECT DISTINCT pl.page_layout_object AS object_name
    FROM public.page_layouts pl
    JOIN pg_class c ON c.relname = pl.page_layout_object AND c.relkind = 'r'
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE coalesce(pl.is_deleted, false) = false
      -- A record-carrying table: it numbers its own records.
      AND EXISTS (
        SELECT 1 FROM pg_attribute att
        WHERE att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
          AND att.attname LIKE '%\_record\_number'
      )
      -- And it has a uuid id a thread can point at.
      AND EXISTS (
        SELECT 1 FROM pg_attribute att
        WHERE att.attrelid = c.oid AND att.attname = 'id' AND att.atttypid = 'uuid'::regtype
      )
      -- A thread about a thread, and a person on a thread, are not records a
      -- thread belongs to.
      AND pl.page_layout_object NOT IN ('conversations', 'users')
  )
  SELECT fk.object_name, fk.fk_column, false FROM fk
  UNION ALL
  SELECT p.object_name, NULL::text, true
  FROM pages p
  WHERE NOT EXISTS (SELECT 1 FROM fk WHERE fk.object_name = p.object_name)
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.conversation_related_to_objects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_related_to_objects() TO authenticated, service_role;

-- ─── 3. Related To is always stamped, and always valid ─────────────────────

-- The most specific foreign key a thread carries is its Related To when a
-- caller supplied only the per-object parameters. This ORDER is the one thing
-- the foreign keys cannot say (a service appointment sits under a work order,
-- which sits under a project …); it mirrors CONVERSATION_ANCHORS in
-- src/lib/conversationAnchors.js, leaf first, root last.
CREATE OR REPLACE FUNCTION public.conversation_related_to_from_foreign_keys(p_conv public.conversations)
RETURNS TABLE(related_object text, related_id uuid)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT v.obj, (to_jsonb(p_conv) ->> v.fk)::uuid
  FROM (VALUES
    ('service_appointments',   'service_appointment_id',   1),
    ('work_orders',            'work_order_id',            2),
    ('assessments',            'assessment_id',            3),
    ('incentive_applications', 'incentive_application_id', 4),
    ('enrollments',            'enrollment_id',            5),
    ('projects',               'project_id',               6),
    ('opportunities',          'opportunity_id',           7),
    ('units',                  'unit_id',                  8),
    ('buildings',              'building_id',              9),
    ('properties',             'property_id',             10),
    ('accounts',               'account_id',              11),
    ('contacts',               'contact_id',              12)
  ) AS v(obj, fk, ord)
  WHERE (to_jsonb(p_conv) ->> v.fk) IS NOT NULL
  ORDER BY v.ord
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.conversation_related_to_from_foreign_keys(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_related_to_from_foreign_keys(public.conversations) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_conversation_related_to()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_fk     text;
  v_known  boolean;
  v_exists boolean;
BEGIN
  -- A legacy caller supplied per-object columns and no Related To: derive it.
  IF NEW.conv_related_object IS NULL THEN
    SELECT r.related_object, r.related_id INTO NEW.conv_related_object, NEW.conv_related_id
    FROM public.conversation_related_to_from_foreign_keys(NEW) r;
  END IF;

  IF NEW.conv_related_object IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT true, a.fk_column INTO v_known, v_fk
  FROM public.conversation_related_to_objects() a
  WHERE a.object_name = NEW.conv_related_object;

  IF v_known IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'a conversation cannot be related to %: it is not an object with a record page', NEW.conv_related_object
      USING ERRCODE = '23514',
            HINT = 'conversation_related_to_objects() lists what a thread can be related to.';
  END IF;

  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', NEW.conv_related_object)
    INTO v_exists USING NEW.conv_related_id;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'a conversation cannot be related to % %: no such record', NEW.conv_related_object, NEW.conv_related_id
      USING ERRCODE = '23503';
  END IF;

  -- A foreign-key-backed Related To also fills its column, so the owner-chain
  -- rule, the state-scope paths and the account roll-up keep seeing it.
  IF v_fk IS NOT NULL AND (to_jsonb(NEW) ->> v_fk) IS NULL THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(v_fk, NEW.conv_related_id));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_0_conversation_related_to ON public.conversations;
CREATE TRIGGER trg_0_conversation_related_to
  BEFORE INSERT OR UPDATE OF conv_related_object, conv_related_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_related_to();

-- Backfill: every live thread gets its Related To from its most specific key.
UPDATE public.conversations c
SET conv_related_object = d.related_object,
    conv_related_id     = d.related_id
FROM (
  SELECT c2.id, r.related_object, r.related_id
  FROM public.conversations c2
  CROSS JOIN LATERAL public.conversation_related_to_from_foreign_keys(c2) r
  WHERE c2.conv_related_object IS NULL
) d
WHERE d.id = c.id
  AND d.related_object IS NOT NULL;

-- ─── 4. find_or_create_conversation: the generic pair relates to ANY object ─

CREATE OR REPLACE FUNCTION public.find_or_create_conversation(
  p_channel text, p_our_address text, p_customer_address text,
  p_contact_id uuid DEFAULT NULL, p_account_id uuid DEFAULT NULL, p_project_id uuid DEFAULT NULL,
  p_service_appointment_id uuid DEFAULT NULL, p_subject text DEFAULT NULL,
  p_opportunity_id uuid DEFAULT NULL, p_property_id uuid DEFAULT NULL, p_building_id uuid DEFAULT NULL,
  p_incentive_application_id uuid DEFAULT NULL, p_work_order_id uuid DEFAULT NULL,
  p_assessment_id uuid DEFAULT NULL, p_unit_id uuid DEFAULT NULL, p_force_new boolean DEFAULT false,
  p_anchor_object text DEFAULT NULL, p_anchor_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $function$
declare
  v_conv_id uuid;
  v_anchor_column text;
  v_anchor_known boolean;
begin
  if p_channel is null or p_channel not in ('sms','email') then
    raise exception 'channel must be sms or email';
  end if;
  if p_our_address is null or p_customer_address is null then
    raise exception 'our_address and customer_address are required';
  end if;

  -- Related To: any object with a record page. A foreign-key-backed object
  -- also fills its column (below); a polymorphic one is carried by the pair.
  if p_anchor_object is not null and p_anchor_id is not null then
    select true, a.fk_column into v_anchor_known, v_anchor_column
      from public.conversation_related_to_objects() a
     where a.object_name = p_anchor_object;
    if v_anchor_known is distinct from true then
      raise exception 'a conversation cannot be related to %: it is not an object with a record page, so the thread would not appear on any record', p_anchor_object;
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
      work_order_id, assessment_id,
      conv_related_object, conv_related_id
    ) values (
      '', p_channel, p_our_address, p_customer_address,
      'open', p_subject,
      p_contact_id, p_account_id, p_project_id, p_service_appointment_id,
      p_opportunity_id, p_property_id, p_building_id, p_unit_id, p_incentive_application_id,
      p_work_order_id, p_assessment_id,
      p_anchor_object, p_anchor_id
    )
    returning id into v_conv_id;
  end if;

  -- The generic anchor fills its column, and the Related To pair, only when
  -- the thread does not already carry one — exactly as the explicit
  -- parameters above do.
  if v_anchor_column is not null then
    execute format('update public.conversations set %I = coalesce(%I, $1) where id = $2', v_anchor_column, v_anchor_column)
      using p_anchor_id, v_conv_id;
  end if;
  if p_anchor_object is not null and p_anchor_id is not null then
    update public.conversations
       set conv_related_object = coalesce(conv_related_object, p_anchor_object),
           conv_related_id     = coalesce(conv_related_id, p_anchor_id)
     where id = v_conv_id;
  end if;

  return v_conv_id;
end $function$;

REVOKE ALL ON FUNCTION public.find_or_create_conversation(text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text,uuid) TO authenticated, service_role;

-- ─── 5. The feed reads the pair as well as the column ──────────────────────

CREATE OR REPLACE FUNCTION public.list_communication_timeline(p_object text, p_id uuid, p_channel_filter text DEFAULT NULL)
RETURNS TABLE(entry_kind text, entry_id uuid, record_number text, channel text, activity_type text, subject text, preview text, body text, occurred_at timestamptz, direction text, unread_count integer, counterparty text, our_address text, actor_name text, contact_name text, duration_seconds integer, via_object text, via_id uuid, via_label text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
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
  -- A thread belongs to this record when its Related To names it, or when
  -- the object's own foreign-key column on conversations carries it (a
  -- thread related to a service appointment is also on its work order).
  SELECT s.via_object, s.via_id, s.via_label, c.*
  FROM scope s
  JOIN public.conversation_related_to_objects() a ON a.object_name = s.obj
  JOIN public.conversations c
    ON c.conv_is_deleted = false
   AND (
         (c.conv_related_object = s.obj AND c.conv_related_id = s.id)
      OR (a.fk_column IS NOT NULL AND (to_jsonb(c) ->> a.fk_column)::uuid = s.id)
       )
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

REVOKE ALL ON FUNCTION public.list_communication_timeline(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_communication_timeline(text,uuid,text) TO authenticated;

-- ─── 6. Filing an email: any object, patched in place ──────────────────────

DO $patch$
DECLARE
  v_src text;
  v_new text;
  v_old_lookup text := $s$  SELECT a.fk_column INTO v_fk_column
    FROM public.conversation_anchor_columns() a
   WHERE a.object_name = p_target_object;
  IF v_fk_column IS NULL THEN
    RAISE EXCEPTION '% has no Conversations area, so an email cannot be filed on it.', p_target_object;
  END IF;$s$;
  v_new_lookup text := $s$  -- Related To: any object with a record page. A foreign-key-backed object
  -- is matched on its column as well, so a thread filed before Related To
  -- existed is still found.
  SELECT true, a.fk_column INTO v_fk_known, v_fk_column
    FROM public.conversation_related_to_objects() a
   WHERE a.object_name = p_target_object;
  IF v_fk_known IS DISTINCT FROM true THEN
    RAISE EXCEPTION '% is not an object with a record page, so an email cannot be filed on it.', p_target_object;
  END IF;
  IF v_fk_column IS NOT NULL THEN
    v_related_where := format('(conv_related_object = %L AND conv_related_id = $1) OR %I = $1', p_target_object, v_fk_column);
  ELSE
    v_related_where := format('(conv_related_object = %L AND conv_related_id = $1)', p_target_object);
  END IF;$s$;
  v_old_find text := $s$  EXECUTE format(
    'SELECT id FROM public.conversations
      WHERE %I = $1 AND conv_channel = ''email''
        AND lower(conv_customer_address) = $2 AND conv_is_deleted = false
      ORDER BY conv_last_message_at DESC NULLS LAST LIMIT 1', v_fk_column)
    INTO v_conv_id USING p_target_id, lower(v_customer);$s$;
  v_new_find text := $s$  EXECUTE format(
    'SELECT id FROM public.conversations
      WHERE (%s) AND conv_channel = ''email''
        AND lower(conv_customer_address) = $2 AND conv_is_deleted = false
      ORDER BY conv_last_message_at DESC NULLS LAST LIMIT 1', v_related_where)
    INTO v_conv_id USING p_target_id, lower(v_customer);$s$;
  v_old_insert text := $s$  IF v_conv_id IS NULL THEN
    EXECUTE format(
      'INSERT INTO public.conversations (
         conv_record_number, conv_channel, conv_our_address, conv_customer_address,
         conv_status, conv_subject, %I, conv_owner, conv_created_by, conv_updated_by
       ) VALUES ('''', ''email'', $1, $2, ''open'', $3, $4, $5, $5, $5) RETURNING id', v_fk_column)
      INTO v_conv_id USING v_our_address, v_customer, NULLIF(btrim(COALESCE(p_subject,'')),''), p_target_id, v_me;
  END IF;$s$;
  v_new_insert text := $s$  IF v_conv_id IS NULL THEN
    -- The Related To pair is the anchor; the trigger fills the object's own
    -- foreign-key column when it has one.
    INSERT INTO public.conversations (
      conv_record_number, conv_channel, conv_our_address, conv_customer_address,
      conv_status, conv_subject, conv_related_object, conv_related_id,
      conv_owner, conv_created_by, conv_updated_by
    ) VALUES ('', 'email', v_our_address, v_customer, 'open',
              NULLIF(btrim(COALESCE(p_subject,'')),''), p_target_object, p_target_id,
              v_me, v_me, v_me)
    RETURNING id INTO v_conv_id;
  END IF;$s$;
  v_old_decl text := $s$  v_fk_column       text;$s$;
  v_new_decl text := $s$  v_fk_column       text;
  v_fk_known        boolean;
  v_related_where   text;$s$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'import_email_into_conversation';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'import_email_into_conversation is not deployed';
  END IF;

  IF position(v_old_decl   IN v_src) = 0 THEN RAISE EXCEPTION 'import_email_into_conversation: declaration anchor not found'; END IF;
  IF position(v_old_lookup IN v_src) = 0 THEN RAISE EXCEPTION 'import_email_into_conversation: anchor-lookup block not found'; END IF;
  IF position(v_old_find   IN v_src) = 0 THEN RAISE EXCEPTION 'import_email_into_conversation: find-thread block not found'; END IF;
  IF position(v_old_insert IN v_src) = 0 THEN RAISE EXCEPTION 'import_email_into_conversation: insert-thread block not found'; END IF;

  v_new := replace(v_src, v_old_decl,   v_new_decl);
  v_new := replace(v_new, v_old_lookup, v_new_lookup);
  v_new := replace(v_new, v_old_find,   v_new_find);
  v_new := replace(v_new, v_old_insert, v_new_insert);

  IF v_new = v_src THEN RAISE EXCEPTION 'import_email_into_conversation: nothing changed'; END IF;
  EXECUTE v_new;
END $patch$;

REVOKE ALL ON FUNCTION public.import_email_into_conversation(text,uuid,text,text,jsonb,jsonb,text,text,timestamptz,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_email_into_conversation(text,uuid,text,text,jsonb,jsonb,text,text,timestamptz,text,text,text) TO authenticated;

-- ─── 7. The Outlook add-in's picker offers every object ────────────────────

CREATE OR REPLACE FUNCTION public.email_log_target_columns(p_object text)
RETURNS TABLE(prefix text, name_column text, record_number_column text, deleted_column text, updated_column text, email_column text)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_prefix text;
  v_rn     text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_related_to_objects() a WHERE a.object_name = p_object
  ) THEN
    RAISE EXCEPTION 'an email cannot be filed on %: a conversation cannot be related to it', p_object
      USING HINT = 'Allowed: ' || (
        SELECT string_agg(a.object_name, ', ' ORDER BY a.object_name)
        FROM public.conversation_related_to_objects() a
      );
  END IF;

  SELECT c.column_name::text INTO v_rn
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = p_object
    AND c.column_name LIKE '%\_record\_number'
  ORDER BY c.ordinal_position
  LIMIT 1;
  IF v_rn IS NULL THEN
    RAISE EXCEPTION '% has no record-number column, so its records cannot be identified in the picker', p_object;
  END IF;
  v_prefix := left(v_rn, length(v_rn) - length('_record_number'));

  RETURN QUERY
  SELECT
    v_prefix,
    (SELECT c.column_name::text FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=p_object AND c.column_name = v_prefix || '_name'),
    v_rn,
    (SELECT c.column_name::text FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=p_object
        AND c.column_name IN (v_prefix || '_is_deleted', 'is_deleted')
      ORDER BY (c.column_name = v_prefix || '_is_deleted') DESC LIMIT 1),
    (SELECT c.column_name::text FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=p_object
        AND c.column_name IN (v_prefix || '_updated_at', 'updated_at')
      ORDER BY (c.column_name = v_prefix || '_updated_at') DESC LIMIT 1),
    (SELECT c.column_name::text FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=p_object
        AND c.column_name = v_prefix || '_email' AND c.data_type = 'text');
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_email_log_objects()
RETURNS TABLE(object_name text, label text, label_plural text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT a.object_name, l.label, l.label_plural
  FROM public.conversation_related_to_objects() a
  CROSS JOIN LATERAL public.object_display_label(a.object_name) l
  ORDER BY l.label;
$function$;

-- email_log_target reads a soft-delete column; a record-carrying table with a
-- page layout may not carry one (it then cannot be "deleted", so nothing is
-- filtered). Patched in place so the filter is applied only when the column
-- exists.
DO $patch$
DECLARE
  v_src text; v_new text;
  v_old text := $s$  v_sql := format(
    'SELECT %L::text, t.id, %s, t.%I FROM public.%I t WHERE t.id = $1 AND t.%I = false',
    p_object,
    CASE WHEN c.name_column IS NULL THEN format('t.%I', c.record_number_column)
         ELSE format('coalesce(nullif(btrim(t.%I), %L), t.%I)', c.name_column, '', c.record_number_column) END,
    c.record_number_column, p_object, c.deleted_column
  );$s$;
  v_rep text := $s$  v_sql := format(
    'SELECT %L::text, t.id, %s, t.%I FROM public.%I t WHERE t.id = $1 AND %s',
    p_object,
    CASE WHEN c.name_column IS NULL THEN format('t.%I', c.record_number_column)
         ELSE format('coalesce(nullif(btrim(t.%I), %L), t.%I)', c.name_column, '', c.record_number_column) END,
    c.record_number_column, p_object,
    CASE WHEN c.deleted_column IS NULL THEN 'true' ELSE format('t.%I = false', c.deleted_column) END
  );$s$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'email_log_target';
  IF v_src IS NULL OR position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'email_log_target: anchor not found';
  END IF;
  v_new := replace(v_src, v_old, v_rep);
  EXECUTE v_new;
END $patch$;

-- The picker's search assumed every object carries a soft-delete column and
-- an updated-at column; a record-carrying table with a page layout may have
-- neither. Patched in place.
DO $patch$
DECLARE
  v_src text; v_new text;
  v_old text := $s$  v_sql := format(
    'SELECT %L::text, t.id, %s, %s FROM public.%I t WHERE t.%I = false AND ($1 IS NULL OR (%s)) ORDER BY t.%I DESC NULLS LAST LIMIT %s',
    p_object, v_label, v_sublabel, p_object, c.deleted_column, v_match, c.updated_column, v_limit
  );$s$;
  v_rep text := $s$  v_sql := format(
    'SELECT %L::text, t.id, %s, %s FROM public.%I t WHERE %s AND ($1 IS NULL OR (%s)) ORDER BY %s DESC NULLS LAST LIMIT %s',
    p_object, v_label, v_sublabel, p_object,
    CASE WHEN c.deleted_column IS NULL THEN 'true' ELSE format('t.%I = false', c.deleted_column) END,
    v_match,
    format('t.%I', coalesce(c.updated_column, c.record_number_column)),
    v_limit
  );$s$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_records_for_email_log';
  IF v_src IS NULL OR position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'search_records_for_email_log: anchor not found';
  END IF;
  v_new := replace(v_src, v_old, v_rep);
  EXECUTE v_new;
END $patch$;

-- ─── 8. A state for any record: walk the registry that already knows ───────

-- Which mailbox an email goes out from is decided by the record's STATE.
-- resolve_outbound_mailbox_for_anchor() walks twelve objects by hand; a
-- thread can now be related to any of ~70. record_state_scope_sources
-- already records how EVERY object resolves to a state (it is what the
-- geographic access engine runs on), so the generic answer walks that.
CREATE OR REPLACE FUNCTION public.record_state_for(p_object text, p_id uuid, p_depth integer DEFAULT 0)
RETURNS TABLE(state_value text, resolution_path text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r           record;
  v_state     text;
  v_path      text;
  v_parent_id uuid;
  v_child_id  uuid;
  v_poly_obj  text;
  v_poly_id   uuid;
  v_key       text;
BEGIN
  IF p_object IS NULL OR p_id IS NULL OR p_depth > 6 THEN RETURN; END IF;

  FOR r IN
    SELECT * FROM public.record_state_scope_sources
    WHERE rsss_object_name = p_object AND rsss_is_active = true AND rsss_is_deleted = false
    ORDER BY rsss_path_order
  LOOP
    IF r.rsss_resolution_kind = 'own_state_column' THEN
      EXECUTE format('SELECT upper(btrim(%I)) FROM public.%I WHERE id = $1', r.rsss_state_column, p_object)
        INTO v_state USING p_id;
      IF v_state IS NOT NULL AND v_state <> '' THEN
        RETURN QUERY SELECT v_state, format('%s.%s', p_object, r.rsss_state_column);
        RETURN;
      END IF;

    ELSIF r.rsss_resolution_kind = 'parent_lookup' THEN
      v_key := coalesce(r.rsss_parent_key_column, 'id');
      EXECUTE format('SELECT p.id FROM public.%I c JOIN public.%I p ON p.%I = c.%I WHERE c.id = $1',
                     p_object, r.rsss_parent_object_name, v_key, r.rsss_parent_fk_column)
        INTO v_parent_id USING p_id;
      IF v_parent_id IS NOT NULL THEN
        SELECT s.state_value, s.resolution_path INTO v_state, v_path
        FROM public.record_state_for(r.rsss_parent_object_name, v_parent_id, p_depth + 1) s;
        IF v_state IS NOT NULL THEN
          RETURN QUERY SELECT v_state, format('%s.%s -> %s', p_object, r.rsss_parent_fk_column, v_path);
          RETURN;
        END IF;
      END IF;

    ELSIF r.rsss_resolution_kind = 'child_reverse_lookup' THEN
      FOR v_child_id IN
        EXECUTE format('SELECT c.id FROM public.%I c WHERE c.%I = $1 ORDER BY c.id LIMIT 25',
                       r.rsss_parent_object_name, r.rsss_parent_fk_column) USING p_id
      LOOP
        SELECT s.state_value, s.resolution_path INTO v_state, v_path
        FROM public.record_state_for(r.rsss_parent_object_name, v_child_id, p_depth + 1) s;
        IF v_state IS NOT NULL THEN
          RETURN QUERY SELECT v_state, format('%s <- %s.%s -> %s', p_object, r.rsss_parent_object_name, r.rsss_parent_fk_column, v_path);
          RETURN;
        END IF;
      END LOOP;

    ELSIF r.rsss_resolution_kind = 'polymorphic_lookup' THEN
      EXECUTE format('SELECT %I, %I FROM public.%I WHERE id = $1',
                     r.rsss_polymorphic_object_column, r.rsss_polymorphic_record_id_column, p_object)
        INTO v_poly_obj, v_poly_id USING p_id;
      IF v_poly_obj IS NOT NULL AND v_poly_id IS NOT NULL THEN
        SELECT s.state_value, s.resolution_path INTO v_state, v_path
        FROM public.record_state_for(v_poly_obj, v_poly_id, p_depth + 1) s;
        IF v_state IS NOT NULL THEN
          RETURN QUERY SELECT v_state, format('%s.%s -> %s', p_object, r.rsss_polymorphic_object_column, v_path);
          RETURN;
        END IF;
      END IF;
    END IF;
    -- platform_configuration and hidden_when_scoped carry no state.
  END LOOP;
  RETURN;
END;
$$;

-- Internal to the mailbox resolver (itself SECURITY DEFINER): not an API.
REVOKE ALL ON FUNCTION public.record_state_for(text, uuid, integer) FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE
  v_src text; v_new text;
  v_old text := $s$  end if;

  if v_state is null then
    return;
  end if;$s$;
  v_rep text := $s$  end if;

  -- Any other object — and any of the twelve whose own chain found nothing —
  -- resolves through the state-scope registry, which knows how every record
  -- reaches a state.
  if v_state is null then
    select s.state_value, s.resolution_path || ' (record_state_scope_sources)'
      into v_state, v_path
      from public.record_state_for(p_anchor_object, p_anchor_record_id) s;
  end if;

  if v_state is null then
    return;
  end if;$s$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resolve_outbound_mailbox_for_anchor';
  IF v_src IS NULL THEN RAISE EXCEPTION 'resolve_outbound_mailbox_for_anchor is not deployed'; END IF;
  IF (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'resolve_outbound_mailbox_for_anchor: expected exactly one fallthrough anchor';
  END IF;
  v_new := replace(v_src, v_old, v_rep);
  EXECUTE v_new;
END $patch$;

REVOKE ALL ON FUNCTION public.resolve_outbound_mailbox_for_anchor(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_outbound_mailbox_for_anchor(text,uuid) TO authenticated, service_role;

-- Is this object platform configuration (never state-scoped)? Read from the
-- registry as owner: record_state_scope_sources is admin-only under RLS, and
-- a caller learns one boolean about an object, never a row. Also what the
-- state-scope dispatcher answers for an object that has no resolver (§11).
CREATE OR REPLACE FUNCTION public.record_state_scope_object_is_configuration(p_object text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.record_state_scope_sources s
    WHERE s.rsss_object_name = p_object AND s.rsss_is_active AND NOT s.rsss_is_deleted
      AND s.rsss_resolution_kind IN ('platform_configuration', 'hidden_when_scoped')
  );
$$;
REVOKE ALL ON FUNCTION public.record_state_scope_object_is_configuration(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_state_scope_object_is_configuration(text) TO authenticated, service_role;

-- ─── 9. Also-relate-to offers a record's parents, on every object ──────────

-- list_relatable_records was an if/else for five objects; a call logged on
-- anything else offered nothing to relate to. The parents are the object's
-- own foreign keys (one hop, then the parents' parents), excluding people,
-- picklist values, the record itself, and platform configuration — a call
-- is not "about" a price book.
-- The value of one foreign-key column on one record, by name. Read under the
-- caller's own RLS (SECURITY INVOKER), so a parent the caller cannot see is
-- simply not offered.
CREATE OR REPLACE FUNCTION public.record_foreign_key_value(p_object text, p_id uuid, p_column text)
RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE v uuid;
BEGIN
  IF p_object IS NULL OR p_id IS NULL OR p_column IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT %I FROM public.%I WHERE id = $1', p_column, p_object) INTO v USING p_id;
  RETURN v;
END;
$$;

-- A record's display label: its <prefix>_name, else its record number; NULL
-- when the row is not visible to the caller or is soft-deleted.
CREATE OR REPLACE FUNCTION public.record_display_label(p_object text, p_id uuid)
RETURNS TABLE(record_label text)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rn      text;
  v_prefix  text;
  v_name    text;
  v_deleted text;
  v_sql     text;
  v_out     text;
BEGIN
  IF p_object IS NULL OR p_id IS NULL THEN RETURN; END IF;
  SELECT c.column_name::text INTO v_rn
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = p_object AND c.column_name LIKE '%\_record\_number'
  ORDER BY c.ordinal_position LIMIT 1;
  IF v_rn IS NULL THEN RETURN; END IF;
  v_prefix := left(v_rn, length(v_rn) - length('_record_number'));

  SELECT c.column_name::text INTO v_name FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=p_object AND c.column_name = v_prefix || '_name';
  SELECT c.column_name::text INTO v_deleted FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=p_object
    AND c.column_name IN (v_prefix || '_is_deleted', 'is_deleted')
  ORDER BY (c.column_name = v_prefix || '_is_deleted') DESC LIMIT 1;

  v_sql := format('SELECT %s FROM public.%I t WHERE t.id = $1 AND %s',
    CASE WHEN v_name IS NULL THEN format('t.%I', v_rn)
         ELSE format('coalesce(nullif(btrim(t.%I), %L), t.%I)', v_name, '', v_rn) END,
    p_object,
    CASE WHEN v_deleted IS NULL THEN 'true' ELSE format('coalesce(t.%I, false) = false', v_deleted) END);
  EXECUTE v_sql INTO v_out USING p_id;
  IF v_out IS NOT NULL THEN
    RETURN QUERY SELECT v_out;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_relatable_records(p_object text, p_id uuid)
RETURNS TABLE(rel_object text, rel_id uuid, rel_label text, rel_type_label text)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  WITH RECURSIVE fk AS (
    -- Catalog names carry collation "C"; the walk's seed is a plain text
    -- parameter. A recursive CTE needs one collation across both terms.
    SELECT (src.relname::text) COLLATE "default" AS child,
           (att.attname::text) COLLATE "default" AS fk_column,
           (tgt.relname::text) COLLATE "default" AS parent
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
    WHERE n.nspname = 'public' AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
      AND att.atttypid = 'uuid'::regtype
      AND tgt.relname NOT IN ('users', 'picklist_values')
      AND tgt.relname <> src.relname
      AND NOT public.record_state_scope_object_is_configuration(tgt.relname::text)
  ),
  walk AS (
    SELECT p_object AS obj, p_id AS id, 0 AS hop
    UNION ALL
    SELECT fk.parent, public.record_foreign_key_value(w.obj, w.id, fk.fk_column), w.hop + 1
    FROM walk w JOIN fk ON fk.child = w.obj
    WHERE w.hop < 2 AND w.id IS NOT NULL
  ),
  found AS (
    SELECT DISTINCT ON (w.obj, w.id) w.obj, w.id, w.hop
    FROM walk w
    WHERE w.hop > 0 AND w.id IS NOT NULL AND NOT (w.obj = p_object AND w.id = p_id)
    ORDER BY w.obj, w.id, w.hop
  )
  SELECT f.obj, f.id, lbl.record_label, l.label
  FROM found f
  CROSS JOIN LATERAL public.object_display_label(f.obj) l
  CROSS JOIN LATERAL public.record_display_label(f.obj, f.id) lbl
  WHERE lbl.record_label IS NOT NULL
  ORDER BY f.hop, l.label, lbl.record_label;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_relatable_records(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_relatable_records(text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.record_foreign_key_value(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_foreign_key_value(text,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_display_label(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_display_label(text,uuid) TO authenticated;

-- ─── 10. Who may see a thread: the Related To record's owner too ───────────

-- The owner-chain arm of the conversations SELECT policy knew four columns.
-- A thread related to any other object is visible to that record's owner.
CREATE OR REPLACE FUNCTION public.record_owner_id(p_object text, p_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rn text; v_prefix text; v_col text; v_out uuid;
BEGIN
  IF p_object IS NULL OR p_id IS NULL THEN RETURN NULL; END IF;
  SELECT c.column_name::text INTO v_rn FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=p_object AND c.column_name LIKE '%\_record\_number'
  ORDER BY c.ordinal_position LIMIT 1;
  IF v_rn IS NULL THEN RETURN NULL; END IF;
  v_prefix := left(v_rn, length(v_rn) - length('_record_number'));
  SELECT c.column_name::text INTO v_col FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=p_object
    AND c.column_name IN (v_prefix || '_owner', v_prefix || '_owner_id', 'owner_id')
    AND c.data_type = 'uuid'
  ORDER BY (c.column_name = v_prefix || '_owner') DESC, (c.column_name = v_prefix || '_owner_id') DESC LIMIT 1;
  IF v_col IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT %I FROM public.%I WHERE id = $1', v_col, p_object) INTO v_out USING p_id;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.record_owner_id(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_record_owner_in_chain(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  with me as (
    select id as user_id from public.users where auth_user_id = auth.uid()
  ), conv as (
    select c.contact_id, c.account_id, c.project_id, c.service_appointment_id,
           c.conv_related_object, c.conv_related_id
    from public.conversations c
    where c.id = p_conversation_id and not c.conv_is_deleted
  )
  select exists (
    select 1 from conv c, me
    where (c.contact_id is not null
           and exists (select 1 from public.contacts x where x.id = c.contact_id and x.contact_owner = me.user_id))
       or (c.account_id is not null
           and exists (select 1 from public.accounts x where x.id = c.account_id and x.account_owner = me.user_id))
       or (c.project_id is not null
           and exists (select 1 from public.projects x where x.id = c.project_id and x.project_owner = me.user_id))
       or (c.service_appointment_id is not null
           and exists (select 1 from public.service_appointments x where x.id = c.service_appointment_id and x.sa_owner = me.user_id))
       -- The record the thread is Related To, whatever object it is.
       or (c.conv_related_object is not null
           and public.record_owner_id(c.conv_related_object, c.conv_related_id) = me.user_id)
       or exists (
         select 1 from public.opportunities o
         where o.id in (select * from resolve_anchor_opportunity(p_conversation_id))
           and o.opportunity_owner = me.user_id
       )
  );
$function$;

-- ─── 11. Geographic access follows Related To ──────────────────────────────

INSERT INTO public.record_state_scope_sources (
  rsss_record_number, rsss_object_name, rsss_resolution_kind,
  rsss_polymorphic_object_column, rsss_polymorphic_record_id_column, rsss_path_order, rsss_notes
)
SELECT '', 'conversations', 'polymorphic_lookup', 'conv_related_object', 'conv_related_id', 9,
       'A thread is in scope when the record it is Related To is (any object).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources r
  WHERE r.rsss_object_name = 'conversations'
    AND r.rsss_resolution_kind = 'polymorphic_lookup'
    AND r.rsss_is_deleted = false
);

CREATE OR REPLACE FUNCTION public.record_state_scope_object_is_never_scoped(p_object text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.record_state_scope_sources s
    WHERE s.rsss_object_name = p_object AND s.rsss_is_active AND NOT s.rsss_is_deleted
      AND s.rsss_resolution_kind = 'platform_configuration'
  );
$$;
-- Called only from the SECURITY DEFINER dispatcher.
REVOKE ALL ON FUNCTION public.record_state_scope_object_is_never_scoped(text) FROM PUBLIC, anon, authenticated;

-- A record of a platform-configuration object (a vehicle, a product) is
-- visible to everyone, so a thread related to one is too. The dispatcher's
-- "unknown object" answer was a blanket false — correct for an object that
-- is scoped but has no resolver, wrong for one that is never scoped at all.
-- The predicate builder already says 'true' for these; the dispatcher now
-- agrees with it by asking the same registry.

DO $patch$
DECLARE
  v_src text; v_new text;
  v_old text := $s$                        ELSE false
                      END)$s$;
  v_rep text := $s$                        ELSE public.record_state_scope_object_is_never_scoped(p_object)
                      END)$s$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rebuild_record_state_scope_dispatcher';
  IF v_src IS NULL OR position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'rebuild_record_state_scope_dispatcher: ELSE anchor not found';
  END IF;
  v_new := replace(v_src, v_old, v_rep);
  EXECUTE v_new;
END $patch$;

SELECT public.install_record_state_scope_resolver('conversations');
SELECT public.install_record_state_scoping('conversations');
SELECT public.rebuild_record_state_scope_dispatcher();

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.record_state_scope_integrity();
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'record_state_scope_integrity() reported % dangling row(s)', v_n;
  END IF;
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='record_state_scope_conversations') NOT LIKE '%conv_related_object%' THEN
    RAISE EXCEPTION 'the conversations resolver does not read Related To';
  END IF;
  IF NOT public.record_in_state_scope('vehicles', gen_random_uuid(), ARRAY['NC']) THEN
    RAISE EXCEPTION 'a platform-configuration object must be in every state scope';
  END IF;
  IF public.record_in_state_scope('no_such_object', gen_random_uuid(), ARRAY['NC']) THEN
    RAISE EXCEPTION 'an unknown object must still fail closed';
  END IF;
END $$;

-- ─── 12. Help ───────────────────────────────────────────────────────────────

-- HA-00078 opened with the list of twelve objects. It is no longer a list.
UPDATE public.help_articles
SET ha_body_markdown = regexp_replace(
      ha_body_markdown,
      '^\s*The \*\*Communications\*\* card — the split-pane area showing every email thread,\ntext thread and logged call related to the record you are looking at — is on\nthese objects:\n\n(- \*\*[^\n]*\n)+',
      E'\nThe **Communications** card — the split-pane area showing every email thread,\ntext thread and logged call related to the record you are looking at — can be\nplaced on **any object that has a record page**: accounts, contacts,\nproperties, buildings, units, opportunities, projects, work orders, work\nsteps, work plans, assessments, enrollments, incentives, service appointments,\nvehicles, envelopes, materials requests, time sheets — every one. A thread is\n**Related To** the record it was started from (Salesforce''s *Related To*), and\nthe card on that record shows it. An **account** additionally rolls up its\ncontacts'' threads and calls.\n\nAn admin puts the card on a layout at Setup → Object Manager → *the object* →\nPage Layouts → Add a card → **Communications**, and can put it in the right\nsidebar and on a tab at the same time (Copy to…).\n\n',
      'n'),
    ha_updated_at = now()
WHERE ha_record_number = 'HA-00078';

DO $$
BEGIN
  IF (SELECT ha_body_markdown FROM public.help_articles WHERE ha_record_number = 'HA-00078') NOT LIKE '%any object that has a record page%' THEN
    RAISE EXCEPTION 'HA-00078 was not corrected';
  END IF;
END $$;

-- The card article and the Outlook article now show on every object a thread
-- can be related to.
DELETE FROM public.help_article_anchors
 WHERE haa_anchor_type = 'object'
   AND haa_article_id IN (SELECT id FROM public.help_articles WHERE ha_record_number IN ('HA-00078', 'HA-00154'));

INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order)
SELECT a.id, 'object', reg.object_name, row_number() OVER (PARTITION BY a.id ORDER BY reg.object_name)
FROM public.help_articles a
CROSS JOIN public.conversation_related_to_objects() reg
WHERE a.ha_record_number IN ('HA-00078', 'HA-00154');

INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_sort_order)
SELECT a.id, 'object', 'conversations', 999
FROM public.help_articles a
WHERE a.ha_record_number = 'HA-00078';

-- The new article.
DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.help_articles (ha_record_number, ha_slug, ha_title, ha_summary,
                                    ha_category, ha_audience, ha_is_published, ha_body_markdown)
  VALUES (
    '', 'communications-on-any-record',
    'Communications on any record — Related To',
    'A Communications card goes on any object with a record page, and a thread is Related To the record it was started from. Emails, texts and calls all file to that record.',
    'Communications', 'all', true,
    $md$
## What changed

Until now a thread could only belong to one of twelve objects — the ones
with their own column on the conversations table. Putting Communications on a
new object was a database change, every time.

A thread is now **Related To** a record — any record, on any object that has
a page layout. Salesforce calls this the activity's *Related To*; LEAP uses the
same word. Work orders, work steps, work plans, materials requests, vehicles,
envelopes, time sheets, occurrences — every one of them can carry the card and
hold its own threads.

## Putting the card on a layout

1. Setup → Object Manager → *the object* → Page Layouts → open the layout.
2. In a section, **Add a card** → **Communications**.
3. To show it in the right sidebar *and* on a tab, use **Copy to…** on the
   placed card. A card can sit in as many places as you want.

The palette never refuses the card because it is already on the layout; it
only tells you where the existing ones are.

## What the card does on any object

- **New Email** — sent from the state mailbox the record resolves to. A
  record with no state of its own (a work step, a vehicle) walks up to the
  record that has one (its work order's property, say) using the same map the
  geographic access rules use.
- **Log a Call** — the call is related to this record and, under *Also relate
  to*, to its parents (a work order offers its project, property, building and
  account; a contact offers its account).
- **Drop an email from Outlook** onto the card, or use the Outlook add-in's
  *Log Email* — the record picker now lists every object that can hold a
  thread.

## Who sees a thread

The same rules as before, plus one: the **owner of the record the thread is
Related To** can see it. Administrators, roles granted *Communications: view
all*, the recipient and the owners of the thread's contact / account /
project / opportunity / service appointment see it as they did.

A user restricted to a state sees a thread when the record it is Related To
is in that state — a thread on a vehicle or another configuration record, which
belongs to no state, is visible to everyone.

## Where a thread records what it is related to

On the thread itself: **Related To** (object + record). Threads that existed
before this change were given their Related To from the most specific record
they already carried: a thread on a service appointment is Related To the
appointment, not the account.
$md$
  );
END $$;

INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_sort_order)
SELECT a.id, 'concept', c.concept, c.ord
FROM public.help_articles a
CROSS JOIN (VALUES ('communications-card', 1), ('log-a-call', 2), ('file-an-email', 3)) AS c(concept, ord)
WHERE a.ha_slug = 'communications-on-any-record';

-- ─── 13. Proof ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_n integer;
  v_objs text[];
BEGIN
  SELECT array_agg(object_name ORDER BY object_name) INTO v_objs FROM public.conversation_related_to_objects();
  IF array_length(v_objs, 1) < 60 THEN
    RAISE EXCEPTION 'expected at least 60 objects a thread can be related to, found %', array_length(v_objs, 1);
  END IF;
  IF NOT (v_objs @> ARRAY['work_steps','work_plans','vehicles','materials_requests','envelopes','enrollments','accounts']) THEN
    RAISE EXCEPTION 'the Related To object set is missing an expected object';
  END IF;
  IF v_objs && ARRAY['users','conversations'] THEN
    RAISE EXCEPTION 'users and conversations must never be Related To targets';
  END IF;
  -- Every foreign-key-backed object is still backed by its column.
  IF (SELECT count(*) FROM public.conversation_related_to_objects() WHERE fk_column IS NOT NULL) <> 12 THEN
    RAISE EXCEPTION 'the twelve foreign-key anchors changed';
  END IF;

  -- Every live thread now says what it is related to.
  SELECT count(*) INTO v_n FROM public.conversations
  WHERE conv_is_deleted = false AND conv_related_object IS NULL
    AND (contact_id IS NOT NULL OR account_id IS NOT NULL OR project_id IS NOT NULL OR service_appointment_id IS NOT NULL
         OR opportunity_id IS NOT NULL OR property_id IS NOT NULL OR building_id IS NOT NULL OR unit_id IS NOT NULL
         OR incentive_application_id IS NOT NULL OR work_order_id IS NOT NULL OR assessment_id IS NOT NULL OR enrollment_id IS NOT NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% anchored thread(s) still carry no Related To', v_n;
  END IF;

  -- The patched functions carry the new lookup.
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'import_email_into_conversation') NOT LIKE '%conversation_related_to_objects%' THEN
    RAISE EXCEPTION 'import_email_into_conversation was not patched';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'resolve_outbound_mailbox_for_anchor') NOT LIKE '%record_state_for%' THEN
    RAISE EXCEPTION 'resolve_outbound_mailbox_for_anchor was not patched';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'email_log_target') NOT LIKE '%c.deleted_column IS NULL%' THEN
    RAISE EXCEPTION 'email_log_target was not patched';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'search_records_for_email_log') NOT LIKE '%c.deleted_column IS NULL%' THEN
    RAISE EXCEPTION 'search_records_for_email_log was not patched';
  END IF;

  -- The Outlook picker offers every object.
  SELECT count(*) INTO v_n FROM public.list_email_log_objects();
  IF v_n < 60 THEN RAISE EXCEPTION 'list_email_log_objects offers only % objects', v_n; END IF;

  -- The help follows the set.
  SELECT count(*) INTO v_n FROM public.help_article_anchors an
  JOIN public.help_articles a ON a.id = an.haa_article_id
  WHERE a.ha_record_number = 'HA-00078' AND an.haa_anchor_type = 'object' AND an.haa_object = 'work_steps';
  IF v_n <> 1 THEN RAISE EXCEPTION 'HA-00078 is not anchored to work_steps'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.help_articles WHERE ha_slug = 'communications-on-any-record' AND ha_is_published) THEN
    RAISE EXCEPTION 'the new help article is missing';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
