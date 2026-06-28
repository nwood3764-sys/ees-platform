-- =====================================================================
-- resolve_outbound_mailbox_for_anchor(anchor_object, anchor_record_id)
--
-- Returns the single outbound mailbox that should be used to send any
-- email anchored to the given record. Users cannot override this; the
-- frontend renders the result read-only. send-email-v1 also calls the
-- same resolver server-side and rejects any client-supplied mailbox
-- that doesn't match — defense in depth.
--
-- Resolution chain by anchor object:
--   projects             → project.property_id → properties.property_state
--   work_orders          → wo.property_id → properties.property_state
--                          (fall back to wo.project_id → projects.property_id)
--   service_appointments → sa.work_order_id → wo chain above
--   accounts             → accounts.billing_state (mailing_state fallback)
--   contacts             → contacts.contact_mailing_state
--                          (fall back to contacts.account_id → accounts.billing_state)
--
-- Once a state is resolved, pick the single active outbound_mailbox
-- whose obm_state matches. If none, return NULL (caller must surface
-- "no mailbox configured for state X" as a hard error rather than
-- defaulting to an arbitrary mailbox).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.resolve_outbound_mailbox_for_anchor(
  p_anchor_object   text,
  p_anchor_record_id uuid
)
RETURNS TABLE (
  outbound_mailbox_id uuid,
  obm_address         text,
  obm_display_name    text,
  obm_state           text,
  resolution_path     text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_state text;
  v_path  text;
BEGIN
  IF p_anchor_object = 'projects' THEN
    SELECT pr.property_state, 'projects → properties.property_state'
      INTO v_state, v_path
      FROM projects p
      JOIN properties pr ON pr.id = p.property_id
     WHERE p.id = p_anchor_record_id;

  ELSIF p_anchor_object = 'work_orders' THEN
    SELECT pr.property_state, 'work_orders.property_id → properties.property_state'
      INTO v_state, v_path
      FROM work_orders w
      JOIN properties pr ON pr.id = w.property_id
     WHERE w.id = p_anchor_record_id;
    IF v_state IS NULL THEN
      SELECT pr.property_state, 'work_orders.project_id → projects.property_id → properties.property_state'
        INTO v_state, v_path
        FROM work_orders w
        JOIN projects p   ON p.id = w.project_id
        JOIN properties pr ON pr.id = p.property_id
       WHERE w.id = p_anchor_record_id;
    END IF;

  ELSIF p_anchor_object = 'service_appointments' THEN
    SELECT pr.property_state, 'service_appointments.work_order_id → work_orders → properties.property_state'
      INTO v_state, v_path
      FROM service_appointments sa
      JOIN work_orders w ON w.id = sa.work_order_id
      JOIN properties pr ON pr.id = COALESCE(w.property_id, (SELECT property_id FROM projects WHERE id = w.project_id))
     WHERE sa.id = p_anchor_record_id;

  ELSIF p_anchor_object = 'accounts' THEN
    SELECT COALESCE(a.billing_state, a.mailing_state),
           'accounts → billing_state (or mailing_state)'
      INTO v_state, v_path
      FROM accounts a
     WHERE a.id = p_anchor_record_id;

  ELSIF p_anchor_object = 'contacts' THEN
    SELECT c.contact_mailing_state, 'contacts.contact_mailing_state'
      INTO v_state, v_path
      FROM contacts c
     WHERE c.id = p_anchor_record_id;
    IF v_state IS NULL THEN
      SELECT COALESCE(a.billing_state, a.mailing_state),
             'contacts.account_id → accounts.billing_state'
        INTO v_state, v_path
        FROM contacts c
        JOIN accounts a ON a.id = c.account_id
       WHERE c.id = p_anchor_record_id;
    END IF;

  END IF;

  IF v_state IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT m.id, m.obm_address, m.obm_display_name, m.obm_state, v_path
      FROM outbound_mailboxes m
     WHERE m.obm_state = v_state
       AND m.obm_is_active = true
       AND m.obm_is_deleted = false
     LIMIT 1;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_outbound_mailbox_for_anchor(text, uuid) TO authenticated;
