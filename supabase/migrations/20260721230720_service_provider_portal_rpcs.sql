-- ============================================================================
-- Service Provider Portal + Intake — Phase 3a: portal RPCs
-- ----------------------------------------------------------------------------
-- Security-scoped data + action RPCs for the provider portal, plus the internal
-- staff RPCs that issue proposals and generate invoices. All provider-facing
-- RPCs resolve the caller from auth.uid() -> portal_users (record_type
-- 'Provider User') -> portal_user_account_id, and filter to THAT provider
-- account only. A provider can never see or act on another provider's work,
-- pricing, or pay, nor any customer contract value / margin (only the fields
-- these RPCs explicitly return are ever exposed).
--
-- Mirrors the customer Project Portal pattern (get_portal_project_tracker):
-- SECURITY DEFINER + set search_path + auth.uid() resolution + status gate +
-- REVOKE-then-GRANT. See docs/leap-service-provider-portal.md.
-- ============================================================================

-- Provider portal role + record type picklist values (for the invite flow)
INSERT INTO public.picklist_values (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), v.obj, v.fld, v.val, v.lbl, true, v.ord
FROM (VALUES
  ('portal_users','record_type','Provider User','Provider User',20),
  ('portal_users','portal_role','service_provider_admin','Service Provider Admin',30),
  ('portal_users','portal_role','service_provider_technician','Service Provider Technician',40)
) AS v(obj,fld,val,lbl,ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object=v.obj AND p.picklist_field=v.fld AND p.picklist_value=v.val
);

-- ----------------------------------------------------------------------------
-- get_provider_portal_data() — everything the signed-in provider may see
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_provider_portal_data()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_portal_user_id uuid;
  v_account_id     uuid;
  v_result         jsonb;
BEGIN
  SELECT pu.id, pu.portal_user_account_id
    INTO v_portal_user_id, v_account_id
  FROM portal_users pu
  WHERE pu.auth_user_id = auth.uid()
    AND pu.is_deleted = false
    AND pu.record_type = 'Provider User'
    AND pu.status NOT IN ('Portal User Suspended','Portal User Deactivated')
  LIMIT 1;

  IF v_portal_user_id IS NULL THEN
    RETURN jsonb_build_object('error','no_portal_user',
      'work_orders','[]'::jsonb,'proposals','[]'::jsonb,'invoices','[]'::jsonb);
  END IF;
  IF v_account_id IS NULL THEN
    RETURN jsonb_build_object('error','no_provider_account',
      'work_orders','[]'::jsonb,'proposals','[]'::jsonb,'invoices','[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'provider', jsonb_build_object(
      'account_id', v_account_id,
      'name', (SELECT account_name FROM accounts WHERE id = v_account_id)
    ),
    -- Proposals issued to this provider (with priced lines)
    'proposals', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id, 'record_number', p.spro_record_number, 'name', p.spro_name,
        'status', ps.picklist_label, 'status_value', ps.picklist_value,
        'total_amount', p.spro_total_amount, 'state', p.spro_state,
        'project_name', pr.project_name, 'property_name', prop.property_name,
        'issued_at', p.spro_issued_at, 'responded_at', p.spro_responded_at,
        'declined_reason', p.spro_declined_reason, 'notes', p.spro_notes,
        'lines', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', l.id,
            'measure', COALESCE(prod.product_name, l.sprl_measure_description),
            'quantity', l.sprl_quantity, 'unit_rate', l.sprl_payout_unit_rate, 'amount', l.sprl_amount,
            'work_order_number', wo.work_order_record_number, 'work_order_name', wo.work_order_name
          ) ORDER BY l.sprl_sort_order NULLS LAST, l.sprl_created_at), '[]'::jsonb)
          FROM service_provider_proposal_lines l
          LEFT JOIN products prod ON prod.id = l.sprl_product_id
          LEFT JOIN work_orders wo ON wo.id = l.sprl_work_order_id
          WHERE l.sprl_proposal_id = p.id AND l.sprl_is_deleted IS NOT TRUE
        )
      ) ORDER BY p.spro_created_at DESC), '[]'::jsonb)
      FROM service_provider_proposals p
      LEFT JOIN picklist_values ps ON ps.id = p.spro_status
      LEFT JOIN projects pr ON pr.id = p.spro_project_id
      LEFT JOIN properties prop ON prop.id = p.spro_property_id
      WHERE p.spro_service_provider_account_id = v_account_id AND p.spro_is_deleted IS NOT TRUE
    ),
    -- Work orders assigned to this provider (grouped client-side by project)
    'work_orders', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', wo.id, 'record_number', wo.work_order_record_number, 'name', wo.work_order_name,
        'status', wst.picklist_label,
        'acceptance_status', acc.picklist_label, 'acceptance_value', acc.picklist_value,
        'work_type', wt.work_type_name, 'agreed_payout', wo.work_order_agreed_payout_amount,
        'scheduled_start_date', wo.work_order_scheduled_start_date,
        'special_instructions', wo.work_order_special_instructions,
        'active_proposal_id', wo.work_order_active_proposal_id,
        'project_id', pr.id, 'project_name', pr.project_name,
        'property_name', prop.property_name, 'building_name', bld.building_name, 'unit_name', un.unit_name
      ) ORDER BY pr.project_name, wo.work_order_record_number), '[]'::jsonb)
      FROM work_orders wo
      LEFT JOIN picklist_values wst ON wst.id = wo.work_order_status
      LEFT JOIN picklist_values acc ON acc.id = wo.work_order_provider_acceptance_status
      LEFT JOIN work_types wt ON wt.id = wo.work_type_id
      LEFT JOIN projects pr ON pr.id = wo.project_id
      LEFT JOIN properties prop ON prop.id = wo.property_id
      LEFT JOIN buildings bld ON bld.id = wo.building_id
      LEFT JOIN units un ON un.id = wo.unit_id
      WHERE wo.work_order_service_provider_account_id = v_account_id AND wo.work_order_is_deleted IS NOT TRUE
    ),
    -- Payment section: invoices (with lines + payments) for this provider
    'invoices', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', i.id, 'record_number', i.spi_record_number,
        'status', ist.picklist_label, 'status_value', ist.picklist_value,
        'total_amount', i.spi_total_amount, 'amount_paid', i.spi_amount_paid,
        'invoice_date', i.spi_invoice_date, 'due_date', i.spi_due_date,
        'lines', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'description', COALESCE(il.spil_description, prod.product_name),
            'quantity', il.spil_quantity, 'unit_rate', il.spil_unit_rate, 'amount', il.spil_amount,
            'work_order_number', wo.work_order_record_number
          ) ORDER BY il.spil_sort_order NULLS LAST), '[]'::jsonb)
          FROM service_provider_invoice_line_items il
          LEFT JOIN products prod ON prod.id = il.spil_product_id
          LEFT JOIN work_orders wo ON wo.id = il.spil_work_order_id
          WHERE il.spil_invoice_id = i.id AND il.spil_is_deleted IS NOT TRUE
        ),
        'payments', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'amount', pay.spp_amount, 'date', pay.spp_payment_date,
            'method', pay.spp_payment_method, 'reference', pay.spp_payment_reference,
            'status', pst.picklist_label
          ) ORDER BY pay.spp_payment_date DESC NULLS LAST), '[]'::jsonb)
          FROM service_provider_payments pay
          LEFT JOIN picklist_values pst ON pst.id = pay.spp_status
          WHERE pay.spp_invoice_id = i.id AND pay.spp_is_deleted IS NOT TRUE
        )
      ) ORDER BY i.spi_created_at DESC), '[]'::jsonb)
      FROM service_provider_invoices i
      LEFT JOIN picklist_values ist ON ist.id = i.spi_status
      WHERE i.spi_service_provider_account_id = v_account_id AND i.spi_is_deleted IS NOT TRUE
    )
  ) INTO v_result;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_provider_portal_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_provider_portal_data() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- provider_respond_to_proposal(proposal, accept, decline_reason)
--   Provider accepts/rejects an issued proposal; cascades to its work orders.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_respond_to_proposal(
  p_proposal_id uuid, p_accept boolean, p_decline_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_portal_user_id uuid; v_account_id uuid; v_status uuid;
  v_issued uuid; v_accepted uuid; v_declined uuid;
  v_wo_accepted uuid; v_wo_declined uuid;
BEGIN
  SELECT pu.id, pu.portal_user_account_id INTO v_portal_user_id, v_account_id
  FROM portal_users pu
  WHERE pu.auth_user_id = auth.uid() AND pu.is_deleted = false
    AND pu.record_type = 'Provider User'
    AND pu.status NOT IN ('Portal User Suspended','Portal User Deactivated')
  LIMIT 1;
  IF v_account_id IS NULL THEN RETURN jsonb_build_object('error','no_provider_account'); END IF;

  -- proposal must belong to the caller's provider account
  SELECT spro_status INTO v_status FROM service_provider_proposals
   WHERE id = p_proposal_id AND spro_service_provider_account_id = v_account_id AND spro_is_deleted IS NOT TRUE;
  IF v_status IS NULL THEN RETURN jsonb_build_object('error','proposal_not_found'); END IF;

  SELECT id INTO v_issued   FROM picklist_values WHERE picklist_object='service_provider_proposals' AND picklist_field='status' AND picklist_value='Proposal Issued';
  SELECT id INTO v_accepted FROM picklist_values WHERE picklist_object='service_provider_proposals' AND picklist_field='status' AND picklist_value='Proposal Accepted';
  SELECT id INTO v_declined FROM picklist_values WHERE picklist_object='service_provider_proposals' AND picklist_field='status' AND picklist_value='Proposal Declined';
  IF v_status IS DISTINCT FROM v_issued THEN RETURN jsonb_build_object('error','proposal_not_open'); END IF;

  SELECT id INTO v_wo_accepted FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='provider_acceptance_status' AND picklist_value='Work Order Accepted by Provider';
  SELECT id INTO v_wo_declined FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='provider_acceptance_status' AND picklist_value='Work Order Declined by Provider';

  IF p_accept THEN
    UPDATE service_provider_proposals
       SET spro_status = v_accepted, spro_responded_at = now(), spro_updated_at = now()
     WHERE id = p_proposal_id;
    UPDATE work_orders wo SET
       work_order_provider_acceptance_status = v_wo_accepted,
       work_order_provider_responded_at = now(),
       work_order_active_proposal_id = p_proposal_id,
       work_order_agreed_payout_amount = COALESCE((
         SELECT SUM(l.sprl_amount) FROM service_provider_proposal_lines l
          WHERE l.sprl_proposal_id = p_proposal_id AND l.sprl_work_order_id = wo.id AND l.sprl_is_deleted IS NOT TRUE),0),
       work_order_updated_at = now()
     WHERE wo.work_order_service_provider_account_id = v_account_id
       AND wo.id IN (SELECT DISTINCT l.sprl_work_order_id FROM service_provider_proposal_lines l
                      WHERE l.sprl_proposal_id = p_proposal_id AND l.sprl_work_order_id IS NOT NULL AND l.sprl_is_deleted IS NOT TRUE);
    RETURN jsonb_build_object('ok', true, 'status', 'Proposal Accepted');
  ELSE
    UPDATE service_provider_proposals
       SET spro_status = v_declined, spro_declined_reason = p_decline_reason,
           spro_responded_at = now(), spro_updated_at = now()
     WHERE id = p_proposal_id;
    UPDATE work_orders wo SET
       work_order_provider_acceptance_status = v_wo_declined,
       work_order_provider_declined_reason = p_decline_reason,
       work_order_provider_responded_at = now(),
       work_order_updated_at = now()
     WHERE wo.work_order_service_provider_account_id = v_account_id
       AND wo.id IN (SELECT DISTINCT l.sprl_work_order_id FROM service_provider_proposal_lines l
                      WHERE l.sprl_proposal_id = p_proposal_id AND l.sprl_work_order_id IS NOT NULL AND l.sprl_is_deleted IS NOT TRUE);
    RETURN jsonb_build_object('ok', true, 'status', 'Proposal Declined');
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.provider_respond_to_proposal(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_respond_to_proposal(uuid, boolean, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- generate_service_provider_proposal(provider, work_order_ids, state, notes)
--   INTERNAL staff: issue priced work to a provider. Prices each work order's
--   installed measures (opportunity_line_items) via resolve_payout_rate.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_service_provider_proposal(
  p_provider_account_id uuid, p_work_order_ids uuid[], p_state text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_user uuid; v_proposal_id uuid; v_issued uuid; v_wo_issued uuid;
  v_project uuid; v_property uuid; v_state text; v_rate numeric; v_name text;
  wo record; oli record; v_has_line boolean;
BEGIN
  IF NOT public.app_user_can('service_provider_proposals','create') THEN
    RAISE EXCEPTION 'Not authorized to create service provider proposals' USING errcode='42501';
  END IF;
  v_user := public.current_app_user_id();
  IF p_work_order_ids IS NULL OR array_length(p_work_order_ids,1) IS NULL THEN
    RETURN jsonb_build_object('error','no_work_orders');
  END IF;

  SELECT w.project_id, w.property_id INTO v_project, v_property FROM work_orders w WHERE w.id = p_work_order_ids[1];
  v_state := COALESCE(p_state, (SELECT property_state FROM properties WHERE id = v_property));
  SELECT account_name INTO v_name FROM accounts WHERE id = p_provider_account_id;

  SELECT id INTO v_issued    FROM picklist_values WHERE picklist_object='service_provider_proposals' AND picklist_field='status' AND picklist_value='Proposal Issued';
  SELECT id INTO v_wo_issued FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='provider_acceptance_status' AND picklist_value='Work Order Issued to Provider';

  INSERT INTO service_provider_proposals
    (spro_name, spro_service_provider_account_id, spro_project_id, spro_property_id, spro_state,
     spro_status, spro_issued_by, spro_issued_at, spro_notes, spro_owner, spro_created_by, spro_updated_by)
  VALUES (COALESCE('Proposal — '||v_name, 'Proposal'), p_provider_account_id, v_project, v_property, v_state,
     v_issued, v_user, now(), p_notes, v_user, v_user, v_user)
  RETURNING id INTO v_proposal_id;

  FOR wo IN SELECT * FROM work_orders WHERE id = ANY(p_work_order_ids) LOOP
    v_has_line := false;
    FOR oli IN
      SELECT o.* FROM opportunity_line_items o
       WHERE o.opportunity_id = wo.opportunity_id AND o.oli_is_deleted IS NOT TRUE
         AND (o.unit_id = wo.unit_id OR o.unit_id IS NULL)
    LOOP
      v_rate := public.resolve_payout_rate(p_provider_account_id, v_state, oli.product_id);
      INSERT INTO service_provider_proposal_lines
        (sprl_name, sprl_proposal_id, sprl_work_order_id, sprl_product_id, sprl_quantity,
         sprl_payout_unit_rate, sprl_owner, sprl_created_by, sprl_updated_by)
      VALUES ('Line', v_proposal_id, wo.id, oli.product_id, COALESCE(oli.oli_quantity,1),
         COALESCE(v_rate,0), v_user, v_user, v_user);
      v_has_line := true;
    END LOOP;
    IF NOT v_has_line THEN
      INSERT INTO service_provider_proposal_lines
        (sprl_name, sprl_proposal_id, sprl_work_order_id, sprl_measure_description, sprl_quantity,
         sprl_payout_unit_rate, sprl_owner, sprl_created_by, sprl_updated_by)
      VALUES ('Line', v_proposal_id, wo.id,
         COALESCE((SELECT work_type_name FROM work_types WHERE id = wo.work_type_id),'Work'),
         1, 0, v_user, v_user, v_user);
    END IF;
    UPDATE work_orders SET
       work_order_service_provider_account_id = p_provider_account_id,
       work_order_active_proposal_id = v_proposal_id,
       work_order_provider_acceptance_status = v_wo_issued,
       work_order_updated_at = now()
     WHERE id = wo.id;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'proposal_id', v_proposal_id,
    'record_number', (SELECT spro_record_number FROM service_provider_proposals WHERE id = v_proposal_id),
    'total', (SELECT spro_total_amount FROM service_provider_proposals WHERE id = v_proposal_id));
END $$;

REVOKE ALL ON FUNCTION public.generate_service_provider_proposal(uuid, uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_service_provider_proposal(uuid, uuid[], text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- generate_provider_invoice_from_proposal(proposal)
--   INTERNAL: turn an accepted proposal into a payable (Pending Approval).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_provider_invoice_from_proposal(p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_user uuid; v_accepted uuid; v_status uuid; v_pending uuid;
  v_invoice_id uuid; v_acct uuid; v_project uuid; v_name text;
BEGIN
  IF NOT public.app_user_can('service_provider_invoices','create') THEN
    RAISE EXCEPTION 'Not authorized to create service provider invoices' USING errcode='42501';
  END IF;
  v_user := public.current_app_user_id();

  SELECT spro_status, spro_service_provider_account_id, spro_project_id
    INTO v_status, v_acct, v_project
  FROM service_provider_proposals WHERE id = p_proposal_id AND spro_is_deleted IS NOT TRUE;
  IF v_acct IS NULL THEN RETURN jsonb_build_object('error','proposal_not_found'); END IF;

  SELECT id INTO v_accepted FROM picklist_values WHERE picklist_object='service_provider_proposals' AND picklist_field='status' AND picklist_value='Proposal Accepted';
  IF v_status IS DISTINCT FROM v_accepted THEN RETURN jsonb_build_object('error','proposal_not_accepted'); END IF;

  SELECT id INTO v_pending FROM picklist_values WHERE picklist_object='service_provider_invoices' AND picklist_field='status' AND picklist_value='Invoice Pending Approval';
  SELECT account_name INTO v_name FROM accounts WHERE id = v_acct;

  INSERT INTO service_provider_invoices
    (spi_name, spi_service_provider_account_id, spi_proposal_id, spi_project_id, spi_status,
     spi_invoice_date, spi_owner, spi_created_by, spi_updated_by)
  VALUES (COALESCE('Invoice — '||v_name,'Invoice'), v_acct, p_proposal_id, v_project, v_pending,
     current_date, v_user, v_user, v_user)
  RETURNING id INTO v_invoice_id;

  INSERT INTO service_provider_invoice_line_items
    (spil_name, spil_invoice_id, spil_work_order_id, spil_proposal_line_id, spil_product_id,
     spil_description, spil_quantity, spil_unit_rate, spil_owner, spil_created_by, spil_updated_by)
  SELECT 'Line', v_invoice_id, l.sprl_work_order_id, l.id, l.sprl_product_id,
     l.sprl_measure_description, l.sprl_quantity, l.sprl_payout_unit_rate, v_user, v_user, v_user
  FROM service_provider_proposal_lines l
  WHERE l.sprl_proposal_id = p_proposal_id AND l.sprl_is_deleted IS NOT TRUE;

  RETURN jsonb_build_object('ok', true, 'invoice_id', v_invoice_id,
    'record_number', (SELECT spi_record_number FROM service_provider_invoices WHERE id = v_invoice_id),
    'total', (SELECT spi_total_amount FROM service_provider_invoices WHERE id = v_invoice_id));
END $$;

REVOKE ALL ON FUNCTION public.generate_provider_invoice_from_proposal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_provider_invoice_from_proposal(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
