-- ============================================================================
-- Outlook add-in: match the people on an email to LEAP contacts, and create a
-- contact for an unknown sender/recipient — the Salesforce "Show Related
-- Records" behavior. Both SECURITY INVOKER so RLS decides what the caller may
-- see / insert.
-- ============================================================================

-- Match a list of email addresses to existing (non-deleted) contacts.
-- Returns one row per input address; contact_id is NULL when unmatched.
CREATE OR REPLACE FUNCTION public.lookup_email_participants(p_emails text[])
RETURNS TABLE (
  participant_email text,
  contact_id        uuid,
  contact_name      text,
  account_id        uuid,
  account_name      text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT btrim(e.email) AS participant_email,
         c.id AS contact_id,
         coalesce(nullif(btrim(c.contact_name), ''),
                  btrim(concat_ws(' ', c.contact_first_name, c.contact_last_name))) AS contact_name,
         c.contact_account_id AS account_id,
         a.account_name
  FROM unnest(p_emails) AS e(email)
  LEFT JOIN LATERAL (
    SELECT id, contact_name, contact_first_name, contact_last_name, contact_account_id
    FROM contacts
    WHERE contact_is_deleted = false
      AND lower(contact_email) = lower(btrim(e.email))
    ORDER BY contact_updated_at DESC NULLS LAST
    LIMIT 1
  ) c ON true
  LEFT JOIN accounts a ON a.id = c.contact_account_id AND a.account_is_deleted = false;
$$;

-- Create a contact from an email participant. An account is required
-- (contact_account_id is NOT NULL); record number, record type, and
-- contact_name are filled by existing triggers.
CREATE OR REPLACE FUNCTION public.create_contact_from_email(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_account_id uuid
)
RETURNS TABLE (
  contact_id   uuid,
  contact_name text,
  account_id   uuid,
  account_name text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := current_app_user_id();
  v_first text := coalesce(nullif(btrim(p_first_name), ''), 'Unknown');
  v_last  text := coalesce(nullif(btrim(p_last_name), ''), '');
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No LEAP user in session';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'An account is required to create a contact';
  END IF;

  INSERT INTO contacts (
    contact_record_number, contact_name, contact_first_name, contact_last_name,
    contact_email, contact_account_id, contact_owner, contact_created_by
  )
  VALUES (
    '', btrim(v_first || ' ' || v_last), v_first, v_last,
    nullif(btrim(p_email), ''), p_account_id, v_uid, v_uid
  )
  RETURNING id INTO v_id;

  RETURN QUERY
    SELECT c.id, c.contact_name, c.contact_account_id, a.account_name
    FROM contacts c
    LEFT JOIN accounts a ON a.id = c.contact_account_id
    WHERE c.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_email_participants(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_email_participants(text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.create_contact_from_email(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_contact_from_email(text, text, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
