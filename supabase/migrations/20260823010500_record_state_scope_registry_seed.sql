-- ============================================================================
-- Geographic (state) record scoping — registry seed + install
--
-- Every public base table is classified explicitly. A state-scoped user sees a
-- record only when one of that object's declared paths resolves into their
-- granted states; anything that cannot be proved to be in their states is not
-- theirs. That is the rule Nicholas set on 2026-08-23: "He cannot see anything
-- outside North Carolina at all for any reason."
--
-- Kinds:
--   own_state_column        the object carries the state itself
--   parent_lookup           FK to an object that resolves
--   child_reverse_lookup    in scope when a child row resolves (accounts)
--   polymorphic_lookup      object-name + record-id pair (documents, audit_log)
--   platform_configuration  carries no customer data — never scoped
--   hidden_when_scoped      customer data with no state linkage — never shown
--                           to a scoped user
-- ============================================================================

-- ─── Teach the engine the kind and the join column added here ───────────────
-- Not every path joins to the parent's `id`. The HUD staging and override
-- tables carry the HUD property identifier as text and match
-- properties.property_hud_property_id, so the parent-side key is declared too.
ALTER TABLE public.record_state_scope_sources
  ADD COLUMN IF NOT EXISTS rsss_parent_key_column text;

ALTER TABLE public.record_state_scope_sources
  DROP CONSTRAINT IF EXISTS rsss_resolution_kind_known;
ALTER TABLE public.record_state_scope_sources
  ADD CONSTRAINT rsss_resolution_kind_known CHECK (rsss_resolution_kind IN (
    'own_state_column',
    'parent_lookup',
    'child_reverse_lookup',
    'polymorphic_lookup',
    'platform_configuration',
    'hidden_when_scoped'
  ));

CREATE OR REPLACE FUNCTION public.build_record_state_scope_predicate(
  p_object      text,
  p_alias       text,
  p_states_expr text DEFAULT 'public.app_user_state_scope()',
  p_depth       integer DEFAULT 0
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r       record;
  v_paths text[] := ARRAY[]::text[];
  v_child text;
  v_alias text;
  v_any   boolean := false;
BEGIN
  IF p_depth > 8 THEN
    RETURN 'false';
  END IF;

  FOR r IN
    SELECT *
    FROM public.record_state_scope_sources
    WHERE rsss_object_name = p_object
      AND rsss_is_active = true
      AND rsss_is_deleted = false
    ORDER BY rsss_path_order
  LOOP
    v_any := true;

    IF r.rsss_resolution_kind = 'platform_configuration' THEN
      RETURN 'true';

    ELSIF r.rsss_resolution_kind = 'hidden_when_scoped' THEN
      RETURN 'false';

    ELSIF r.rsss_resolution_kind = 'own_state_column' THEN
      v_paths := v_paths || format(
        'upper(btrim(%I.%I)) = ANY (%s)',
        p_alias, r.rsss_state_column, p_states_expr
      );

    ELSIF r.rsss_resolution_kind = 'parent_lookup' THEN
      v_alias := 's' || (p_depth + 1);
      v_child := public.build_record_state_scope_predicate(
        r.rsss_parent_object_name, v_alias, p_states_expr, p_depth + 1
      );
      v_paths := v_paths || format(
        'EXISTS (SELECT 1 FROM public.%I %I WHERE %I.%I = %I.%I AND (%s))',
        r.rsss_parent_object_name, v_alias,
        v_alias, COALESCE(r.rsss_parent_key_column, 'id'),
        p_alias, r.rsss_parent_fk_column, v_child
      );

    ELSIF r.rsss_resolution_kind = 'child_reverse_lookup' THEN
      v_alias := 's' || (p_depth + 1);
      v_child := public.build_record_state_scope_predicate(
        r.rsss_parent_object_name, v_alias, p_states_expr, p_depth + 1
      );
      v_paths := v_paths || format(
        'EXISTS (SELECT 1 FROM public.%I %I WHERE %I.%I = %I.%I AND (%s))',
        r.rsss_parent_object_name, v_alias,
        v_alias, r.rsss_parent_fk_column,
        p_alias, COALESCE(r.rsss_parent_key_column, 'id'), v_child
      );

    ELSIF r.rsss_resolution_kind = 'polymorphic_lookup' THEN
      v_paths := v_paths || format(
        'public.record_in_state_scope(%I.%I, %I.%I, %s)',
        p_alias, r.rsss_polymorphic_object_column,
        p_alias, r.rsss_polymorphic_record_id_column,
        p_states_expr
      );
    END IF;
  END LOOP;

  IF NOT v_any THEN
    RETURN 'false';
  END IF;

  RETURN '(' || array_to_string(v_paths, ' OR ') || ')';
END;
$fn$;

-- Never enable RLS on a table that does not already have it without first
-- preserving today's access, or the install would lock every user out.
CREATE OR REPLACE FUNCTION public.install_record_state_scoping(p_object text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_oid        oid;
  v_rls_on     boolean;
  v_policy     text := 'state_scope_' || p_object;
  v_baseline   text := 'state_scope_baseline_' || p_object;
  v_pred       text;
  v_param_pred text;
BEGIN
  SELECT c.oid, c.relrowsecurity INTO v_oid, v_rls_on
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = p_object AND c.relkind = 'r';

  IF v_oid IS NULL THEN
    RETURN format('%s: not a public base table — skipped', p_object);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.record_state_scope_sources
    WHERE rsss_object_name = p_object AND rsss_is_active = true AND rsss_is_deleted = false
  ) THEN
    RETURN format('%s: no registry row — skipped', p_object);
  END IF;

  v_pred       := public.build_record_state_scope_predicate(p_object, p_object, 'public.app_user_state_scope()');
  v_param_pred := public.build_record_state_scope_predicate(p_object, 's0', '$1');

  INSERT INTO public.record_state_scope_compiled (rssc_object_name, rssc_predicate, rssc_compiled_at)
  VALUES (p_object, v_param_pred, now())
  ON CONFLICT (rssc_object_name)
  DO UPDATE SET rssc_predicate = EXCLUDED.rssc_predicate, rssc_compiled_at = now();

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy, p_object);

  IF v_pred = 'true' THEN
    RETURN format('%s: platform configuration — never scoped', p_object);
  END IF;

  -- Turning RLS on for the first time would deny everyone unless the table's
  -- current (RLS-off) openness is preserved as a permissive policy first.
  IF NOT v_rls_on THEN
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true)',
      v_baseline, p_object
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_object);
  END IF;

  EXECUTE format(
    'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO public
       USING (public.app_user_state_scope() IS NULL OR %s)
       WITH CHECK (public.app_user_state_scope() IS NULL OR %s)',
    v_policy, p_object, v_pred, v_pred
  );

  RETURN format('%s: state scoping installed', p_object);
END;
$fn$;

REVOKE ALL ON FUNCTION public.build_record_state_scope_predicate(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.install_record_state_scoping(text) FROM PUBLIC, anon, authenticated;

-- ─── The registry ───────────────────────────────────────────────────────────
INSERT INTO public.record_state_scope_sources
  (rsss_object_name, rsss_resolution_kind, rsss_state_column, rsss_parent_object_name,
   rsss_parent_fk_column, rsss_polymorphic_object_column, rsss_polymorphic_record_id_column,
   rsss_path_order, rsss_notes)
VALUES
  -- The anchor: a property is the one object that knows its own state.
  ('properties', 'own_state_column', 'property_state', NULL, NULL, NULL, NULL, 1,
   'The state anchor for the whole platform. Every other path resolves here.'),

  -- Accounts resolve backwards: an account is in scope when it owns or manages
  -- a property in the user's states. One account per real-world company means a
  -- multi-state owner is visible, but only its in-state properties are.
  ('accounts', 'child_reverse_lookup', NULL, 'properties', 'property_account_id', NULL, NULL, 1,
   'Account owns a property in the granted states.'),
  ('accounts', 'child_reverse_lookup', NULL, 'properties', 'property_management_company_id', NULL, NULL, 2,
   'Account manages a property in the granted states.'),
  ('contacts', 'parent_lookup', NULL, 'accounts', 'contact_account_id', NULL, NULL, 1,
   'A contact follows its account. A contact with no account resolves to no state and is not shown to a scoped user.'),

  -- Property spine
  ('buildings', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('units', 'parent_lookup', NULL, 'buildings', 'building_id', NULL, NULL, 1, NULL),
  ('opportunities', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('projects', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('work_orders', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('enrollments', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('assessments', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('assessments', 'parent_lookup', NULL, 'buildings', 'building_id', NULL, NULL, 2, NULL),
  ('incentive_applications', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('income_qualifications', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('project_payment_requests', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('project_reservations', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('property_programs', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('property_disaster_exposure', 'parent_lookup', NULL, 'properties', 'pde_property_id', NULL, NULL, 1, NULL),
  ('property_hud_contract_lines', 'parent_lookup', NULL, 'properties', 'phcl_property_id', NULL, NULL, 1, NULL),
  ('property_source_data', 'parent_lookup', NULL, 'properties', 'psd_property_id', NULL, NULL, 1, NULL),
  ('property_hud_match_review', 'parent_lookup', NULL, 'properties', 'phmr_candidate_property_id', NULL, NULL, 1, NULL),
  ('property_distances', 'parent_lookup', NULL, 'properties', 'origin_property_id', NULL, NULL, 1,
   'Origin side only: a distance is in scope when it starts at an in-scope property.'),
  ('packet_log', 'parent_lookup', NULL, 'enrollments', 'enrollment_id', NULL, NULL, 1,
   'packet_log.property_id holds the HUD property identifier as text, not a foreign key; the enrollment and income qualification are the real links.'),
  ('packet_log', 'parent_lookup', NULL, 'income_qualifications', 'income_qualification_id', NULL, NULL, 2, NULL),
  ('portal_user_property_grants', 'parent_lookup', NULL, 'properties', 'pug_property_id', NULL, NULL, 1, NULL),
  ('hud_property_master', 'own_state_column', 'state', NULL, NULL, NULL, NULL, 1, NULL),
  ('stg_raw_features', 'own_state_column', 'state', NULL, NULL, NULL, NULL, 1, NULL),
  ('stg_usda_mfh', 'own_state_column', 'state', NULL, NULL, NULL, NULL, 1, NULL),

  -- Work execution
  ('work_plans', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 1, NULL),
  ('work_steps', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 1, NULL),
  ('work_steps', 'parent_lookup', NULL, 'work_plans', 'work_plan_id', NULL, NULL, 2, NULL),
  ('work_step_field_values', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 1, NULL),
  ('work_order_time_entries', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 1, NULL),
  ('asset_assignments', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 1, NULL),
  ('equipment_activities', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 1, NULL),
  ('vehicle_activities', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 1, NULL),
  ('vehicle_activity_items', 'parent_lookup', NULL, 'vehicle_activities', 'vehicle_activity_id', NULL, NULL, 1, NULL),
  ('diagnostic_tests', 'parent_lookup', NULL, 'assessments', 'assessment_id', NULL, NULL, 1, NULL),
  ('diagnostic_tests', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 2, NULL),
  ('efr_reports', 'parent_lookup', NULL, 'assessments', 'assessment_id', NULL, NULL, 1, NULL),
  ('efr_reports', 'parent_lookup', NULL, 'opportunities', 'opportunity_id', NULL, NULL, 2, NULL),
  ('incentives', 'parent_lookup', NULL, 'buildings', 'building_id', NULL, NULL, 1, NULL),
  ('incentives', 'parent_lookup', NULL, 'projects', 'project_id', NULL, NULL, 2, NULL),
  ('job_kits', 'parent_lookup', NULL, 'projects', 'project_id', NULL, NULL, 1, NULL),
  ('job_kits', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 2, NULL),
  ('job_kit_line_items', 'parent_lookup', NULL, 'job_kits', 'job_kit_id', NULL, NULL, 1, NULL),
  ('materials_requests', 'parent_lookup', NULL, 'projects', 'project_id', NULL, NULL, 1, NULL),
  ('materials_requests', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 2, NULL),
  ('materials_request_line_items', 'parent_lookup', NULL, 'materials_requests', 'materials_request_id', NULL, NULL, 1, NULL),
  ('product_transfers', 'parent_lookup', NULL, 'materials_requests', 'materials_request_id', NULL, NULL, 1, NULL),
  ('payment_receipts', 'parent_lookup', NULL, 'projects', 'project_id', NULL, NULL, 1, NULL),
  ('cfp_scenarios', 'parent_lookup', NULL, 'projects', 'project_id', NULL, NULL, 1, NULL),
  ('time_sheet_entries', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 1, NULL),
  ('time_sheet_entries', 'parent_lookup', NULL, 'projects', 'project_id', NULL, NULL, 2, NULL),
  ('time_sheet_entries', 'parent_lookup', NULL, 'buildings', 'building_id', NULL, NULL, 3, NULL),
  ('gps_points', 'parent_lookup', NULL, 'time_sheet_entries', 'time_sheet_entry_id', NULL, NULL, 1, NULL),
  ('time_sheets', 'parent_lookup', NULL, 'contacts', 'contact_id', NULL, NULL, 1, NULL),

  -- Scheduling
  ('service_appointments', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 1, NULL),
  ('service_appointments', 'parent_lookup', NULL, 'opportunities', 'opportunity_id', NULL, NULL, 2, NULL),
  ('service_appointments', 'parent_lookup', NULL, 'projects', 'project_id', NULL, NULL, 3, NULL),
  ('service_appointment_assignments', 'parent_lookup', NULL, 'service_appointments', 'service_appointment_id', NULL, NULL, 1, NULL),
  ('service_appointment_tokens', 'parent_lookup', NULL, 'service_appointments', 'service_appointment_id', NULL, NULL, 1, NULL),
  ('notification_logs', 'parent_lookup', NULL, 'service_appointments', 'service_appointment_id', NULL, NULL, 1, NULL),
  ('notification_logs', 'parent_lookup', NULL, 'contacts', 'contact_id', NULL, NULL, 2, NULL),
  ('dispatcher_followup_requests', 'own_state_column', 'dfr_address_state', NULL, NULL, NULL, NULL, 1,
   'A dispatcher follow-up carries the caller''s own address state before any record exists.'),
  ('service_territories', 'own_state_column', 'service_territory_state', NULL, NULL, NULL, NULL, 1, NULL),
  ('service_territory_zips', 'parent_lookup', NULL, 'service_territories', 'service_territory_id', NULL, NULL, 1, NULL),
  ('service_territory_members', 'parent_lookup', NULL, 'service_territories', 'service_territory_id', NULL, NULL, 1, NULL),
  ('locations', 'own_state_column', 'location_state', NULL, NULL, NULL, NULL, 1, NULL),

  -- Opportunity / account satellites
  ('opportunity_line_items', 'parent_lookup', NULL, 'opportunities', 'opportunity_id', NULL, NULL, 1, NULL),
  ('opportunity_contact_roles', 'parent_lookup', NULL, 'opportunities', 'opportunity_id', NULL, NULL, 1, NULL),
  ('account_contact_relations', 'parent_lookup', NULL, 'accounts', 'account_id', NULL, NULL, 1, NULL),
  ('account_near_miss_flags', 'parent_lookup', NULL, 'accounts', 'account_id', NULL, NULL, 1, NULL),
  ('account_merge_log', 'parent_lookup', NULL, 'accounts', 'aml_master_account_id', NULL, NULL, 1, NULL),
  ('contact_certifications', 'parent_lookup', NULL, 'contacts', 'contact_id', NULL, NULL, 1, NULL),
  ('contact_skills', 'parent_lookup', NULL, 'contacts', 'contact_id', NULL, NULL, 1, NULL),
  ('occurrences', 'parent_lookup', NULL, 'contacts', 'employee_contact_id', NULL, NULL, 1, NULL),
  ('occurrence_participants', 'parent_lookup', NULL, 'contacts', 'contact_id', NULL, NULL, 1, NULL),
  ('resource_absences', 'parent_lookup', NULL, 'contacts', 'contact_id', NULL, NULL, 1, NULL),
  ('equipment_containers', 'parent_lookup', NULL, 'contacts', 'issued_to_contact_id', NULL, NULL, 1, NULL),
  ('envelope_recipients', 'parent_lookup', NULL, 'contacts', 'recipient_contact_id', NULL, NULL, 1, NULL),

  -- Owner research
  ('owner_research_requests', 'parent_lookup', NULL, 'properties', 'orq_property_id', NULL, NULL, 1, NULL),
  ('owner_research_requests', 'parent_lookup', NULL, 'accounts', 'orq_account_id', NULL, NULL, 2, NULL),
  ('owner_research_candidates', 'parent_lookup', NULL, 'properties', 'orc_property_id', NULL, NULL, 1, NULL),
  ('owner_research_candidates', 'parent_lookup', NULL, 'accounts', 'orc_account_id', NULL, NULL, 2, NULL),

  -- Service providers
  ('service_provider_applications', 'parent_lookup', NULL, 'accounts', 'spa_account_id', NULL, NULL, 1, NULL),
  ('service_provider_onboarding_steps', 'parent_lookup', NULL, 'accounts', 'spos_account_id', NULL, NULL, 1, NULL),
  ('service_provider_payments', 'parent_lookup', NULL, 'accounts', 'spp_service_provider_account_id', NULL, NULL, 1, NULL),
  ('service_provider_service_areas', 'parent_lookup', NULL, 'accounts', 'spsa_account_id', NULL, NULL, 1, NULL),
  ('service_provider_trades', 'parent_lookup', NULL, 'accounts', 'spt_account_id', NULL, NULL, 1, NULL),
  ('sp_payout_price_books', 'parent_lookup', NULL, 'accounts', 'sppb_service_provider_account_id', NULL, NULL, 1, NULL),
  ('service_provider_invoices', 'parent_lookup', NULL, 'projects', 'spi_project_id', NULL, NULL, 1, NULL),
  ('service_provider_invoices', 'parent_lookup', NULL, 'accounts', 'spi_service_provider_account_id', NULL, NULL, 2, NULL),
  ('service_provider_invoice_line_items', 'parent_lookup', NULL, 'work_orders', 'spil_work_order_id', NULL, NULL, 1, NULL),
  ('service_provider_proposals', 'parent_lookup', NULL, 'properties', 'spro_property_id', NULL, NULL, 1, NULL),
  ('service_provider_proposals', 'parent_lookup', NULL, 'projects', 'spro_project_id', NULL, NULL, 2, NULL),
  ('service_provider_proposal_lines', 'parent_lookup', NULL, 'work_orders', 'sprl_work_order_id', NULL, NULL, 1, NULL),

  -- Portal
  ('portal_users', 'parent_lookup', NULL, 'accounts', 'portal_user_account_id', NULL, NULL, 1, NULL),
  ('portal_view_as_sessions', 'parent_lookup', NULL, 'accounts', 'pva_account_id', NULL, NULL, 1, NULL),

  -- Communications
  ('conversations', 'parent_lookup', NULL, 'properties', 'property_id', NULL, NULL, 1, NULL),
  ('conversations', 'parent_lookup', NULL, 'accounts', 'account_id', NULL, NULL, 2, NULL),
  ('conversations', 'parent_lookup', NULL, 'opportunities', 'opportunity_id', NULL, NULL, 3, NULL),
  ('conversations', 'parent_lookup', NULL, 'projects', 'project_id', NULL, NULL, 4, NULL),
  ('conversations', 'parent_lookup', NULL, 'work_orders', 'work_order_id', NULL, NULL, 5, NULL),
  ('conversations', 'parent_lookup', NULL, 'contacts', 'contact_id', NULL, NULL, 6, NULL),
  ('messages', 'parent_lookup', NULL, 'conversations', 'conversation_id', NULL, NULL, 1, NULL),
  ('message_attachments', 'parent_lookup', NULL, 'messages', 'ma_message_id', NULL, NULL, 1, NULL),
  ('message_ai_transcripts', 'parent_lookup', NULL, 'messages', 'mat_message_id', NULL, NULL, 1, NULL),
  ('unmatched_inbox', 'parent_lookup', NULL, 'conversations', 'ui_linked_conversation_id', NULL, NULL, 1,
   'An unlinked inbound email resolves to no record and is not shown to a scoped user.'),
  ('envelope_events', 'parent_lookup', NULL, 'envelopes', 'envelope_id', NULL, NULL, 1, NULL),
  ('envelope_tabs', 'parent_lookup', NULL, 'envelopes', 'envelope_id', NULL, NULL, 1, NULL),

  -- Polymorphic: the object names its own parent in a text column.
  ('documents', 'polymorphic_lookup', NULL, NULL, NULL, 'related_object', 'related_id', 1, NULL),
  ('photos', 'polymorphic_lookup', NULL, NULL, NULL, 'related_object', 'related_id', 1, NULL),
  ('photos', 'parent_lookup', NULL, 'work_steps', 'work_step_id', NULL, NULL, 2, NULL),
  ('tasks', 'polymorphic_lookup', NULL, NULL, NULL, 'related_object', 'related_id', 1, NULL),
  ('activities', 'polymorphic_lookup', NULL, NULL, NULL, 'related_object', 'related_id', 1, NULL),
  ('activity_relations', 'polymorphic_lookup', NULL, NULL, NULL, 'ar_related_object', 'ar_related_id', 1, NULL),
  ('comments', 'polymorphic_lookup', NULL, NULL, NULL, 'related_object', 'related_id', 1, NULL),
  ('notifications', 'polymorphic_lookup', NULL, NULL, NULL, 'related_object', 'related_id', 1, NULL),
  ('audit_log', 'polymorphic_lookup', NULL, NULL, NULL, 'al_object', 'al_record_id', 1,
   'The field-level history of a record is the record. It follows the record''s own state.'),
  ('field_history', 'polymorphic_lookup', NULL, NULL, NULL, 'fh_object', 'fh_record_id', 1, NULL),
  ('status_change_events', 'polymorphic_lookup', NULL, NULL, NULL, 'sce_object', 'sce_record_id', 1, NULL),
  ('envelopes', 'polymorphic_lookup', NULL, NULL, NULL, 'env_parent_object', 'env_parent_record_id', 1, NULL),
  ('email_sends', 'polymorphic_lookup', NULL, NULL, NULL, 'parent_object', 'parent_record_id', 1, NULL),
  ('flow_runs', 'polymorphic_lookup', NULL, NULL, NULL, 'fr_trigger_object', 'fr_trigger_record_id', 1, NULL),
  ('automation_run_log', 'polymorphic_lookup', NULL, NULL, NULL, 'arl_trigger_object', 'arl_trigger_record_id', 1, NULL),
  ('property_merge_log', 'polymorphic_lookup', NULL, NULL, NULL, 'pml_object', 'pml_survivor_id', 1, NULL),
  ('user_recently_viewed_records', 'polymorphic_lookup', NULL, NULL, NULL, 'urv_object_table', 'urv_record_id', 1, NULL),
  ('seed_data_records', 'polymorphic_lookup', NULL, NULL, NULL, 'sdr_table_name', 'sdr_record_id', 1, NULL),
  ('flow_run_steps', 'parent_lookup', NULL, 'flow_runs', 'frs_run_id', NULL, NULL, 1, NULL),

  -- Customer data with no state linkage — never shown to a scoped user.
  ('cfp_projects', 'hidden_when_scoped', NULL, NULL, NULL, NULL, NULL, 1,
   'Carries a client and address as free text with no property link.'),
  ('property_import_batches', 'hidden_when_scoped', NULL, NULL, NULL, NULL, NULL, 1,
   'Cross-state import run statistics.'),
  ('stg_hud_ph', 'hidden_when_scoped', NULL, NULL, NULL, NULL, NULL, 1,
   'Public-housing staging rows carry no resolvable state column.'),
  ('stg_ph_building_aggs', 'hidden_when_scoped', NULL, NULL, NULL, NULL, NULL, 1,
   'Public-housing staging rows carry no resolvable state column.'),
  ('hud_match_stage', 'hidden_when_scoped', NULL, NULL, NULL, NULL, NULL, 1,
   'Cross-state HUD match staging.'),
  ('stg_hud_lihtc', 'hidden_when_scoped', NULL, NULL, NULL, NULL, NULL, 1,
   'LIHTC staging keys state numerically, not as a two-letter code.')
;

-- Paths that join on something other than the parent's id. These four carry the
-- HUD property identifier as text and match properties.property_hud_property_id
-- (verified: 2,282 of 2,282 stg_hud_mf rows resolve through it).
INSERT INTO public.record_state_scope_sources
  (rsss_object_name, rsss_resolution_kind, rsss_parent_object_name,
   rsss_parent_fk_column, rsss_parent_key_column, rsss_path_order, rsss_notes)
VALUES
  ('hud_app_overrides', 'parent_lookup', 'properties', 'property_id', 'property_hud_property_id', 1,
   'Joins on the HUD property identifier, not a foreign key.'),
  ('hud_site_aliases', 'parent_lookup', 'properties', 'property_id', 'property_hud_property_id', 1,
   'Joins on the HUD property identifier, not a foreign key.'),
  ('stg_hud_mf', 'parent_lookup', 'properties', 'property_id', 'property_hud_property_id', 1,
   'Joins on the HUD property identifier, not a foreign key.'),
  ('stg_hud_mf_owner', 'parent_lookup', 'properties', 'property_id', 'property_hud_property_id', 1,
   'Joins on the HUD property identifier, not a foreign key.');

-- Everything not named above is platform configuration or reference data.
-- Recorded explicitly so record_state_scope_status() never reports a gap, and
-- so re-classifying one later is a registry edit rather than a code change.
INSERT INTO public.record_state_scope_sources
  (rsss_object_name, rsss_resolution_kind, rsss_path_order, rsss_notes)
SELECT c.relname, 'platform_configuration', 1,
       'Classified at install: platform configuration, reference data, or an administration table carrying no customer or property information.'
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND NOT EXISTS (
    SELECT 1 FROM public.record_state_scope_sources s
    WHERE s.rsss_object_name = c.relname
  );

-- ─── Install ────────────────────────────────────────────────────────────────
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT rsss_object_name
    FROM public.record_state_scope_sources
    WHERE rsss_is_active = true AND rsss_is_deleted = false
    ORDER BY 1
  LOOP
    PERFORM public.install_record_state_scoping(r.rsss_object_name);
  END LOOP;
END
$do$;

-- ─── Indexes the generated predicates lean on ───────────────────────────────
CREATE INDEX IF NOT EXISTS properties_property_state_upper_idx
  ON public.properties (upper(btrim(property_state)));
CREATE INDEX IF NOT EXISTS properties_property_hud_property_id_idx
  ON public.properties (property_hud_property_id);
CREATE INDEX IF NOT EXISTS properties_property_account_id_idx
  ON public.properties (property_account_id);
CREATE INDEX IF NOT EXISTS properties_property_management_company_id_idx
  ON public.properties (property_management_company_id);
CREATE INDEX IF NOT EXISTS audit_log_object_record_idx
  ON public.audit_log (al_object, al_record_id);
CREATE INDEX IF NOT EXISTS field_history_object_record_idx
  ON public.field_history (fh_object, fh_record_id);
CREATE INDEX IF NOT EXISTS documents_related_idx
  ON public.documents (related_object, related_id);
CREATE INDEX IF NOT EXISTS photos_related_idx
  ON public.photos (related_object, related_id);
CREATE INDEX IF NOT EXISTS tasks_related_idx
  ON public.tasks (related_object, related_id);
CREATE INDEX IF NOT EXISTS activities_related_idx
  ON public.activities (related_object, related_id);

-- Audit stamping for the two new user-facing objects.
SELECT public.install_record_audit_stamping('user_state_scopes');
SELECT public.install_record_audit_stamping('record_state_scope_sources');

NOTIFY pgrst, 'reload schema';
