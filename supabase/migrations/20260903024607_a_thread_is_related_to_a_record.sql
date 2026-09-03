-- =============================================================================
-- A thread is RELATED TO a record. It is not "anchored" to one.
--
-- Nicholas, 2026-09-03: "I like 'related to' a lot better for communications."
--
-- "Anchor" was doing two unrelated jobs in one platform — which record an email
-- thread belongs to, and which screen a help article shows up on — and it is
-- not a word anybody says out loud about an email. Salesforce calls this field
-- Related To on an activity, LEAP's own Log a Call already says "Also relate
-- to", and the platform defaults to Salesforce parity.
--
-- This renames what a PERSON READS. The API names — `conversation_anchor_
-- columns()`, the `p_anchor_object` parameter, the `haa_` columns — stay
-- exactly as they are, the same split the object rename used the same day:
-- the label changes, the API name does not, and nothing that calls them has to
-- be touched.
--
-- Signing anchors (enforce_signature_template_has_anchor, the \sig1\ tabs in a
-- document template) are NOT this word. An anchor there is the industry term
-- for the marker a signature is placed on, and it stays.
-- =============================================================================

DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- The message a person gets when a send cannot find a record to file under.
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'find_or_create_conversation';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'find_or_create_conversation is not installed';
  END IF;

  v_new := replace(
    v_def,
    'a conversation cannot be anchored to %: it has no column on conversations, so the thread would not appear on the record',
    'a conversation cannot be related to %: there is no column on conversations for it, so the thread would not appear on the record'
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'find_or_create_conversation: the message being renamed was not found';
  END IF;
  EXECUTE v_new;
END
$do$;

REVOKE ALL ON FUNCTION public.find_or_create_conversation(text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text,uuid) TO authenticated, service_role;

DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'email_log_target_columns';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'email_log_target_columns is not installed';
  END IF;

  v_new := replace(
    v_def,
    'an email cannot be filed on %: a conversation cannot be anchored to it',
    'an email cannot be filed on %: a conversation cannot be related to it'
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'email_log_target_columns: the message being renamed was not found';
  END IF;
  EXECUTE v_new;
END
$do$;

REVOKE ALL ON FUNCTION public.email_log_target_columns(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_log_target_columns(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- The help articles say it the same way.
--
-- Only the COMMUNICATIONS articles. The signature ones (HA-00042/43/49/50/51)
-- are about signing anchors and are left exactly as they are.
-- -----------------------------------------------------------------------------
UPDATE public.help_articles SET
  ha_title = replace(ha_title, 'anchored to', 'related to'),
  ha_summary = replace(replace(replace(coalesce(ha_summary, ''),
                 'anchored to', 'related to'), 'Anchored to', 'Related to'),
                 'anchor record', 'related record'),
  ha_body_markdown = replace(replace(replace(replace(ha_body_markdown,
                 'anchored to', 'related to'), 'Anchored to', 'Related to'),
                 'anchor record', 'related record'),
                 'the anchor object', 'the related record')
WHERE ha_is_deleted = false
  AND ha_record_number IN ('HA-00029','HA-00030','HA-00057','HA-00060','HA-00076','HA-00078','HA-00148','HA-00154','HA-00208')
  AND (ha_title ILIKE '%anchor%' OR coalesce(ha_summary,'') ILIKE '%anchor%' OR ha_body_markdown ILIKE '%anchor%');

-- -----------------------------------------------------------------------------
-- Prove it reads the new way, and that signing kept its own word.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE v_n int; v_left text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='find_or_create_conversation'
      AND p.prosrc LIKE '%cannot be anchored to%'
  ) THEN
    RAISE EXCEPTION 'the send path still tells a person their thread cannot be "anchored"';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='find_or_create_conversation'
      AND p.prosrc LIKE '%cannot be related to%'
  ) THEN
    RAISE EXCEPTION 'the renamed message did not land';
  END IF;

  -- The function still WORKS, not just reads well.
  PERFORM * FROM public.conversation_anchor_columns();
  PERFORM * FROM public.email_log_target_columns('enrollments');

  -- No communications article still says it the old way.
  SELECT string_agg(ha_record_number, ', ' ORDER BY ha_record_number) INTO v_left
  FROM public.help_articles
  WHERE ha_is_deleted = false
    AND ha_record_number IN ('HA-00029','HA-00030','HA-00057','HA-00060','HA-00076','HA-00078','HA-00148','HA-00154','HA-00208')
    AND (ha_title ILIKE '%anchor%' OR ha_body_markdown ILIKE '%anchored to%' OR ha_body_markdown ILIKE '%anchor record%');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'these communications articles still say anchor: %', v_left;
  END IF;

  -- CONTROL — signing anchors are a different word doing a different job and
  -- must NOT have been swept up.
  SELECT count(*) INTO v_n FROM public.help_articles
  WHERE ha_is_deleted = false AND ha_record_number IN ('HA-00049','HA-00050','HA-00051')
    AND ha_body_markdown ILIKE '%anchor%';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'the signature-tab articles lost the word anchor, which is the right word there';
  END IF;
END
$do$;

NOTIFY pgrst, 'reload schema';
