-- ============================================================================
-- search_records_for_email_log(p_object, p_query)
--
-- Purpose-built record search for the LEAP Outlook add-in's "Log Email"
-- taskpane. The add-in lets a user pick which LEAP record an Outlook email
-- should be logged against; this RPC powers that picker's search box.
--
-- Scope is intentionally limited to the objects the email/conversations
-- pipeline can anchor a thread to (the ANCHOR_FK map in send-email-v1 /
-- log-email-to-record). p_object is whitelisted with explicit per-object
-- static queries — never interpolated into dynamic SQL — so this cannot be
-- turned into an arbitrary-table read.
--
-- SECURITY INVOKER: the search runs as the calling LEAP user, so RLS on each
-- object decides what they may see. A user only finds records they already
-- have read access to.
--
-- Returns up to p_limit matches, most-recently-updated first. An empty/blank
-- query returns the caller's most recent records for that object (so the
-- picker is useful before they type).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_records_for_email_log(
  p_object text,
  p_query  text DEFAULT NULL,
  p_limit  integer DEFAULT 20
)
RETURNS TABLE (
  rec_object   text,
  rec_id       uuid,
  rec_label    text,
  rec_sublabel text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  -- Escape LIKE metacharacters so a stray % / _ / \ in the search box is
  -- treated literally, then wrap in wildcards. NULL/blank → NULL (no filter).
  v_pattern text := CASE
    WHEN p_query IS NULL OR btrim(p_query) = '' THEN NULL
    ELSE '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  END;
BEGIN
  IF p_object = 'opportunities' THEN
    RETURN QUERY
      SELECT 'opportunities'::text, o.id, o.opportunity_name,
             o.opportunity_record_number
      FROM opportunities o
      WHERE o.opportunity_is_deleted = false
        AND (v_pattern IS NULL
             OR o.opportunity_name ILIKE v_pattern ESCAPE '\'
             OR o.opportunity_record_number ILIKE v_pattern ESCAPE '\')
      ORDER BY o.opportunity_updated_at DESC NULLS LAST
      LIMIT v_limit;

  ELSIF p_object = 'properties' THEN
    RETURN QUERY
      SELECT 'properties'::text, p.id, p.property_name,
             p.property_record_number
      FROM properties p
      WHERE p.property_is_deleted = false
        AND (v_pattern IS NULL
             OR p.property_name ILIKE v_pattern ESCAPE '\'
             OR p.property_record_number ILIKE v_pattern ESCAPE '\')
      ORDER BY p.property_updated_at DESC NULLS LAST
      LIMIT v_limit;

  ELSIF p_object = 'accounts' THEN
    RETURN QUERY
      SELECT 'accounts'::text, a.id, a.account_name,
             a.account_record_number
      FROM accounts a
      WHERE a.account_is_deleted = false
        AND (v_pattern IS NULL
             OR a.account_name ILIKE v_pattern ESCAPE '\'
             OR a.account_record_number ILIKE v_pattern ESCAPE '\')
      ORDER BY a.account_updated_at DESC NULLS LAST
      LIMIT v_limit;

  ELSIF p_object = 'contacts' THEN
    RETURN QUERY
      SELECT 'contacts'::text, c.id,
             coalesce(nullif(btrim(c.contact_name), ''),
                      btrim(concat_ws(' ', c.contact_first_name, c.contact_last_name)),
                      c.contact_record_number),
             btrim(concat_ws(' · ', c.contact_record_number, c.contact_email))
      FROM contacts c
      WHERE c.contact_is_deleted = false
        AND (v_pattern IS NULL
             OR c.contact_name ILIKE v_pattern ESCAPE '\'
             OR c.contact_first_name ILIKE v_pattern ESCAPE '\'
             OR c.contact_last_name ILIKE v_pattern ESCAPE '\'
             OR c.contact_email ILIKE v_pattern ESCAPE '\'
             OR c.contact_record_number ILIKE v_pattern ESCAPE '\')
      ORDER BY c.contact_updated_at DESC NULLS LAST
      LIMIT v_limit;

  ELSIF p_object = 'projects' THEN
    RETURN QUERY
      SELECT 'projects'::text, pr.id, pr.project_name,
             pr.project_record_number
      FROM projects pr
      WHERE pr.project_is_deleted = false
        AND (v_pattern IS NULL
             OR pr.project_name ILIKE v_pattern ESCAPE '\'
             OR pr.project_record_number ILIKE v_pattern ESCAPE '\')
      ORDER BY pr.project_updated_at DESC NULLS LAST
      LIMIT v_limit;

  ELSIF p_object = 'work_orders' THEN
    RETURN QUERY
      SELECT 'work_orders'::text, w.id,
             coalesce(nullif(btrim(w.work_order_name), ''), w.work_order_record_number),
             w.work_order_record_number
      FROM work_orders w
      WHERE w.work_order_is_deleted = false
        AND (v_pattern IS NULL
             OR w.work_order_name ILIKE v_pattern ESCAPE '\'
             OR w.work_order_record_number ILIKE v_pattern ESCAPE '\')
      ORDER BY w.work_order_updated_at DESC NULLS LAST
      LIMIT v_limit;

  ELSE
    RAISE EXCEPTION 'search_records_for_email_log: unsupported object %', p_object
      USING HINT = 'Allowed: opportunities, properties, accounts, contacts, projects, work_orders';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.search_records_for_email_log(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_records_for_email_log(text, text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
