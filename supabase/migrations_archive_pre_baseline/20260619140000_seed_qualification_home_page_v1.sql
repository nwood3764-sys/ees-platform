-- Seed the Qualification home page as a configured Home Page, replacing the
-- deleted hardcoded QualHome in QualificationModule.jsx. Builds the live data
-- stack it embeds: 4 reports -> 1 dashboard (6 widgets) -> 2 saved list views
-- -> 1 home page (3 components).
--
-- The home page is assigned to the Program Manager role and seeded INACTIVE
-- (hp_is_active = false) so it can be previewed via the topbar gear's Edit Page
-- and activated deliberately, rather than silently overriding every Program
-- Manager's resolved Home on deploy. Activate by setting hp_is_active = true.
--
-- Applied via MCP 2026-06-19. Reproduced here for version parity.
DO $$
DECLARE
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';  -- Nicholas Wood
  v_pm_role uuid := 'ab468bab-7228-4f8c-8c38-34ead9fc8274'; -- Program Manager
  v_asmt_review uuid := 'bcda5bd0-e683-4241-9011-36a6435118b3';
  v_ia_corrections uuid := 'e718d846-fef6-4e6c-8a54-2a07a0c4afa0';
  v_ia_prepare uuid := 'd53e637b-d5dd-4571-a7a8-4f32dbb044c9';
  r_asmt_status uuid; r_ia_status uuid; r_ia_pipeline uuid; r_asmt_review uuid;
  v_dash uuid; v_page uuid; lv_review uuid; lv_recent uuid;
BEGIN
  INSERT INTO public.reports (rpt_record_number, rpt_name, rpt_format, rpt_primary_object, rpt_selected_fields, rpt_owner_user_id, created_by, updated_by)
  VALUES ('', 'Assessments by Status', 'summary', 'assessments',
    '[{"name":"assessment_status","type":"uuid","label":"Status","table":"assessments","via_path":null}]'::jsonb,
    v_owner, v_owner, v_owner)
  RETURNING id INTO r_asmt_status;

  INSERT INTO public.reports (rpt_record_number, rpt_name, rpt_format, rpt_primary_object, rpt_selected_fields, rpt_owner_user_id, created_by, updated_by)
  VALUES ('', 'Incentive Applications by Status', 'summary', 'incentive_applications',
    '[{"name":"ia_status","type":"uuid","label":"Status","table":"incentive_applications","via_path":null}]'::jsonb,
    v_owner, v_owner, v_owner)
  RETURNING id INTO r_ia_status;

  INSERT INTO public.reports (rpt_record_number, rpt_name, rpt_format, rpt_primary_object, rpt_selected_fields, rpt_owner_user_id, created_by, updated_by)
  VALUES ('', 'Approved Incentive Pipeline by Status', 'summary', 'incentive_applications',
    '[{"name":"ia_status","type":"uuid","label":"Status","table":"incentive_applications","via_path":null},{"name":"ia_approved_incentive_amount","type":"numeric","label":"Approved Incentive Amount","table":"incentive_applications","via_path":null}]'::jsonb,
    v_owner, v_owner, v_owner)
  RETURNING id INTO r_ia_pipeline;

  INSERT INTO public.reports (rpt_record_number, rpt_name, rpt_format, rpt_primary_object, rpt_selected_fields, rpt_owner_user_id, created_by, updated_by)
  VALUES ('', 'Assessments To Be Reviewed', 'tabular', 'assessments',
    '[{"name":"assessment_name","type":"text","label":"Assessment","table":"assessments","via_path":null},{"name":"assessment_status","type":"uuid","label":"Status","table":"assessments","via_path":null}]'::jsonb,
    v_owner, v_owner, v_owner)
  RETURNING id INTO r_asmt_review;

  INSERT INTO public.dashboards (dash_record_number, dash_name, dash_columns, dash_owner_user_id, created_by, updated_by)
  VALUES ('', 'Qualification Overview', 3, v_owner, v_owner, v_owner)
  RETURNING id INTO v_dash;

  INSERT INTO public.dashboard_widgets (dw_dashboard_id, dw_report_id, dw_title, dw_widget_type, dw_position_row, dw_position_col, dw_width, dw_height, dw_widget_config, created_by, updated_by) VALUES
    (v_dash, r_asmt_status, 'Assessments to Review', 'metric', 0, 0, 1, 1,
      jsonb_build_object('measure_type','count','group_by','assessment_status','filter_value',v_asmt_review::text), v_owner, v_owner),
    (v_dash, r_ia_status, 'Corrections Needed', 'metric', 0, 1, 1, 1,
      jsonb_build_object('measure_type','count','group_by','ia_status','filter_value',v_ia_corrections::text), v_owner, v_owner),
    (v_dash, r_ia_status, 'Applications to Prepare', 'metric', 0, 2, 1, 1,
      jsonb_build_object('measure_type','count','group_by','ia_status','filter_value',v_ia_prepare::text), v_owner, v_owner),
    (v_dash, r_ia_pipeline, 'Approved Pipeline', 'metric', 1, 0, 1, 1,
      jsonb_build_object('measure_type','sum','measure_field','ia_approved_incentive_amount','group_by','ia_status','kpi_format','currency'), v_owner, v_owner),
    (v_dash, r_asmt_status, 'Assessments by Status', 'bar', 1, 1, 1, 1,
      jsonb_build_object('measure_type','count','group_by','assessment_status','sort_by','value_desc'), v_owner, v_owner),
    (v_dash, r_ia_status, 'Incentive Applications by Status', 'bar', 1, 2, 1, 1,
      jsonb_build_object('measure_type','count','group_by','ia_status','sort_by','value_desc'), v_owner, v_owner);

  INSERT INTO public.saved_list_views (list_view_record_number, list_view_name, list_view_object, list_view_module, list_view_filters, list_view_sort_field, list_view_sort_direction, list_view_visible_columns, list_view_is_shared, list_view_owner, list_view_created_by)
  VALUES ('', 'Assessments To Be Reviewed', 'assessments', 'qualification',
    jsonb_build_array(jsonb_build_object('field','assessment_status','operator','=','value',v_asmt_review::text)),
    'assessment_updated_at', 'desc',
    '["assessment_name","assessment_status","property_id"]'::jsonb,
    true, v_owner, v_owner)
  RETURNING id INTO lv_review;

  INSERT INTO public.saved_list_views (list_view_record_number, list_view_name, list_view_object, list_view_module, list_view_filters, list_view_sort_field, list_view_sort_direction, list_view_visible_columns, list_view_is_shared, list_view_owner, list_view_created_by)
  VALUES ('', 'Recent Incentive Applications', 'incentive_applications', 'qualification',
    '[]'::jsonb,
    'ia_updated_at', 'desc',
    '["ia_name","ia_status","ia_approved_incentive_amount"]'::jsonb,
    true, v_owner, v_owner)
  RETURNING id INTO lv_recent;

  INSERT INTO public.home_pages (hp_record_number, hp_name, hp_template, hp_role_id, hp_is_active, hp_is_default, hp_created_by, hp_updated_by)
  VALUES ('', 'Qualification Home', 'two_thirds_one_third', v_pm_role, false, false, v_owner, v_owner)
  RETURNING id INTO v_page;

  INSERT INTO public.home_page_components (hpc_record_number, hpc_page_id, hpc_region, hpc_type, hpc_source_id, hpc_title, hpc_config, hpc_sort_order) VALUES
    ('', v_page, 'main',    'dashboard', v_dash,    'Qualification Overview',        '{}'::jsonb, 0),
    ('', v_page, 'sidebar', 'list_view', lv_review, 'Assessments — To Be Reviewed',  '{}'::jsonb, 0),
    ('', v_page, 'sidebar', 'list_view', lv_recent, 'Recent Applications',           '{}'::jsonb, 1);
END $$;
