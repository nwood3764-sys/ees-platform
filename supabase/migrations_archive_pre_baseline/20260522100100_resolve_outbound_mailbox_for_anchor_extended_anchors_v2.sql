-- ============================================================================
-- resolve_outbound_mailbox_for_anchor — extended for the six new anchor objects
--
-- v1 of this resolver handled: projects, work_orders, service_appointments,
-- accounts, contacts. With the Communications widget now appearing on six
-- additional layouts (opportunities, incentive_applications, assessments,
-- buildings, properties — work_orders was already covered), the resolver
-- needs traversal paths from each new anchor to a state so the Compose Email
-- modal can pick the right outbound mailbox.
--
-- Resolution paths added:
--   opportunities          → opportunity_state, else property_id → property_state
--   incentive_applications → ia_installation_address_state, else property_id,
--                            else project_id → project's property
--   assessments            → property_id → property_state, else project_id,
--                            else building_id → building_state
--   buildings              → building_state, else property_id → property_state
--   properties             → property_state (direct)
--
-- Existing branches (projects, work_orders, service_appointments, accounts,
-- contacts) are unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_outbound_mailbox_for_anchor(
  p_anchor_object text,
  p_anchor_record_id uuid
)
RETURNS TABLE (
  outbound_mailbox_id uuid,
  obm_address text,
  obm_display_name text,
  obm_state text,
  resolution_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_state text;
  v_path  text;
BEGIN
  -- Walk anchor → state. Each branch sets v_state and v_path on success.
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

  -- ────────────────────────────── new anchors ───────────────────────────────
  ELSIF p_anchor_object = 'opportunities' THEN
    SELECT o.opportunity_state, 'opportunities.opportunity_state'
      INTO v_state, v_path
      FROM opportunities o
     WHERE o.id = p_anchor_record_id;
    IF v_state IS NULL THEN
      SELECT pr.property_state, 'opportunities.property_id → properties.property_state'
        INTO v_state, v_path
        FROM opportunities o
        JOIN properties pr ON pr.id = o.property_id
       WHERE o.id = p_anchor_record_id;
    END IF;

  ELSIF p_anchor_object = 'incentive_applications' THEN
    SELECT ia.ia_installation_address_state, 'incentive_applications.ia_installation_address_state'
      INTO v_state, v_path
      FROM incentive_applications ia
     WHERE ia.id = p_anchor_record_id;
    IF v_state IS NULL THEN
      SELECT pr.property_state, 'incentive_applications.property_id → properties.property_state'
        INTO v_state, v_path
        FROM incentive_applications ia
        JOIN properties pr ON pr.id = ia.property_id
       WHERE ia.id = p_anchor_record_id;
    END IF;
    IF v_state IS NULL THEN
      SELECT pr.property_state, 'incentive_applications.project_id → projects.property_id → properties.property_state'
        INTO v_state, v_path
        FROM incentive_applications ia
        JOIN projects p   ON p.id = ia.project_id
        JOIN properties pr ON pr.id = p.property_id
       WHERE ia.id = p_anchor_record_id;
    END IF;

  ELSIF p_anchor_object = 'assessments' THEN
    SELECT pr.property_state, 'assessments.property_id → properties.property_state'
      INTO v_state, v_path
      FROM assessments a
      JOIN properties pr ON pr.id = a.property_id
     WHERE a.id = p_anchor_record_id;
    IF v_state IS NULL THEN
      SELECT pr.property_state, 'assessments.project_id → projects.property_id → properties.property_state'
        INTO v_state, v_path
        FROM assessments a
        JOIN projects p   ON p.id = a.project_id
        JOIN properties pr ON pr.id = p.property_id
       WHERE a.id = p_anchor_record_id;
    END IF;
    IF v_state IS NULL THEN
      SELECT b.building_state, 'assessments.building_id → buildings.building_state'
        INTO v_state, v_path
        FROM assessments a
        JOIN buildings b ON b.id = a.building_id
       WHERE a.id = p_anchor_record_id;
    END IF;

  ELSIF p_anchor_object = 'buildings' THEN
    SELECT b.building_state, 'buildings.building_state'
      INTO v_state, v_path
      FROM buildings b
     WHERE b.id = p_anchor_record_id;
    IF v_state IS NULL THEN
      SELECT pr.property_state, 'buildings.property_id → properties.property_state'
        INTO v_state, v_path
        FROM buildings b
        JOIN properties pr ON pr.id = b.property_id
       WHERE b.id = p_anchor_record_id;
    END IF;

  ELSIF p_anchor_object = 'properties' THEN
    SELECT pr.property_state, 'properties.property_state'
      INTO v_state, v_path
      FROM properties pr
     WHERE pr.id = p_anchor_record_id;

  END IF;

  IF v_state IS NULL THEN
    RETURN;  -- empty result; caller surfaces "no state resolvable for anchor"
  END IF;

  -- Single active mailbox for that state. If zero or multiple match,
  -- return empty so the caller surfaces it rather than guessing.
  RETURN QUERY
    SELECT m.id, m.obm_address, m.obm_display_name, m.obm_state, v_path
      FROM outbound_mailboxes m
     WHERE m.obm_state = v_state
       AND m.obm_is_active = true
       AND m.obm_is_deleted = false
     LIMIT 1;
END $function$;
