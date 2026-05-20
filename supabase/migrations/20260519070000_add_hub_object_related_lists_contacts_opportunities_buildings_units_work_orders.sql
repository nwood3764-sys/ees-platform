-- Hub-object related-list pass. Adds the canonical "Related Records" section
-- with the most-useful child related lists on every page layout for five
-- hub objects: contacts, opportunities, buildings, units, work_orders.
-- Mirrors the Accounts pattern. Each object's children are derived from the
-- FK graph and limited to lists that produce real signal on the parent page
-- (no debug/log/audit tables).
--
-- Coverage added this migration:
--   contacts      : Site Contact Properties, Opportunity Contact Roles, Conversations
--   opportunities : Projects, Contact Roles, Line Items, Incentive Applications,
--                   Work Orders, Assessments
--   buildings     : Units, Work Orders, Assessments
--   units         : Work Orders
--   work_orders   : Service Appointments
--
-- Re-run safe: skips layouts that already have a "Related Records" section so
-- partial earlier runs or the Accounts pass don't get double-added.

WITH layout_targets AS (
  SELECT pl.id AS layout_id, pl.page_layout_object AS obj
    FROM public.page_layouts pl
   WHERE pl.page_layout_object IN ('contacts','opportunities','buildings','units','work_orders')
     AND pl.page_layout_type   = 'record_detail'
     AND pl.page_layout_is_default = true
     AND NOT pl.is_deleted
),
new_sections AS (
  INSERT INTO public.page_layout_sections
    (page_layout_id, section_label, section_order, section_is_collapsible, is_deleted)
  SELECT
    lt.layout_id,
    'Related Records',
    coalesce((SELECT max(section_order) + 1 FROM page_layout_sections s
              WHERE s.page_layout_id = lt.layout_id AND NOT s.is_deleted), 1),
    true,
    false
    FROM layout_targets lt
    WHERE NOT EXISTS (
      SELECT 1 FROM public.page_layout_sections s2
       WHERE s2.page_layout_id = lt.layout_id
         AND s2.section_label  = 'Related Records'
         AND NOT s2.is_deleted
    )
    RETURNING id AS section_id, page_layout_id
),
sections_with_obj AS (
  SELECT ns.section_id, ns.page_layout_id, lt.obj
    FROM new_sections ns
    JOIN layout_targets lt ON lt.layout_id = ns.page_layout_id
)
INSERT INTO public.page_layout_widgets
  (page_layout_id, section_id, widget_type, widget_title, widget_position, widget_config, is_deleted)
SELECT
  swo.page_layout_id,
  swo.section_id,
  'related_list',
  title,
  pos,
  cfg::jsonb,
  false
FROM sections_with_obj swo
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    (1, 'Site Contact Properties', '{"fk":"property_primary_contact_id","table":"properties","title":"Site Contact Properties","columns":[{"name":"property_record_number","type":"text","label":"Record #"},{"name":"property_name","type":"text","label":"Name"},{"name":"property_city","type":"text","label":"City"},{"name":"property_state","type":"text","label":"State"},{"name":"property_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"property_created_at","is_deleted_col":"property_is_deleted"}'),
    (2, 'Opportunity Contact Roles', '{"fk":"contact_id","table":"opportunity_contact_roles","title":"Opportunity Contact Roles","columns":[{"name":"role","type":"text","label":"Role"},{"name":"is_primary","type":"boolean","label":"Primary"}],"sort_dir":"desc","sort_field":"created_at","is_deleted_col":"is_deleted"}'),
    (3, 'Conversations', '{"fk":"contact_id","table":"conversations","title":"Conversations","columns":[{"name":"conversation_subject","type":"text","label":"Subject"},{"name":"conversation_channel","type":"picklist","label":"Channel"},{"name":"conversation_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"conversation_created_at","is_deleted_col":"conversation_is_deleted"}')
  ) AS x(pos, title, cfg)
  WHERE swo.obj = 'contacts'
  UNION ALL
  SELECT * FROM (VALUES
    (1, 'Projects', '{"fk":"opportunity_id","table":"projects","title":"Projects","columns":[{"name":"project_record_number","type":"text","label":"Record #"},{"name":"project_name","type":"text","label":"Name"},{"name":"project_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"project_created_at","is_deleted_col":"project_is_deleted"}'),
    (2, 'Contact Roles', '{"fk":"opportunity_id","table":"opportunity_contact_roles","title":"Contact Roles","columns":[{"name":"role","type":"text","label":"Role"},{"name":"is_primary","type":"boolean","label":"Primary"}],"sort_dir":"desc","sort_field":"created_at","is_deleted_col":"is_deleted"}'),
    (3, 'Line Items', '{"fk":"opportunity_id","table":"opportunity_line_items","title":"Line Items","columns":[{"name":"product_name","type":"text","label":"Product"},{"name":"quantity","type":"number","label":"Qty"},{"name":"unit_price","type":"currency","label":"Unit Price"},{"name":"total_price","type":"currency","label":"Total"}],"sort_dir":"asc","sort_field":"created_at","is_deleted_col":"is_deleted"}'),
    (4, 'Incentive Applications', '{"fk":"opportunity_id","table":"incentive_applications","title":"Incentive Applications","columns":[{"name":"ia_record_number","type":"text","label":"Record #"},{"name":"ia_name","type":"text","label":"Name"},{"name":"ia_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"ia_created_at","is_deleted_col":"ia_is_deleted"}'),
    (5, 'Work Orders', '{"fk":"opportunity_id","table":"work_orders","title":"Work Orders","columns":[{"name":"work_order_record_number","type":"text","label":"Record #"},{"name":"work_order_name","type":"text","label":"Name"},{"name":"work_order_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"work_order_created_at","is_deleted_col":"work_order_is_deleted"}'),
    (6, 'Assessments', '{"fk":"opportunity_id","table":"assessments","title":"Assessments","columns":[{"name":"assessment_record_number","type":"text","label":"Record #"},{"name":"assessment_name","type":"text","label":"Name"},{"name":"assessment_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"assessment_created_at","is_deleted_col":"assessment_is_deleted"}')
  ) AS x(pos, title, cfg)
  WHERE swo.obj = 'opportunities'
  UNION ALL
  SELECT * FROM (VALUES
    (1, 'Units', '{"fk":"building_id","table":"units","title":"Units","columns":[{"name":"unit_record_number","type":"text","label":"Record #"},{"name":"unit_name","type":"text","label":"Name"},{"name":"unit_status","type":"picklist","label":"Status"}],"sort_dir":"asc","sort_field":"unit_name","is_deleted_col":"unit_is_deleted"}'),
    (2, 'Work Orders', '{"fk":"building_id","table":"work_orders","title":"Work Orders","columns":[{"name":"work_order_record_number","type":"text","label":"Record #"},{"name":"work_order_name","type":"text","label":"Name"},{"name":"work_order_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"work_order_created_at","is_deleted_col":"work_order_is_deleted"}'),
    (3, 'Assessments', '{"fk":"building_id","table":"assessments","title":"Assessments","columns":[{"name":"assessment_record_number","type":"text","label":"Record #"},{"name":"assessment_name","type":"text","label":"Name"},{"name":"assessment_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"assessment_created_at","is_deleted_col":"assessment_is_deleted"}')
  ) AS x(pos, title, cfg)
  WHERE swo.obj = 'buildings'
  UNION ALL
  SELECT * FROM (VALUES
    (1, 'Work Orders', '{"fk":"unit_id","table":"work_orders","title":"Work Orders","columns":[{"name":"work_order_record_number","type":"text","label":"Record #"},{"name":"work_order_name","type":"text","label":"Name"},{"name":"work_order_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"work_order_created_at","is_deleted_col":"work_order_is_deleted"}')
  ) AS x(pos, title, cfg)
  WHERE swo.obj = 'units'
  UNION ALL
  SELECT * FROM (VALUES
    (1, 'Service Appointments', '{"fk":"work_order_id","table":"service_appointments","title":"Service Appointments","columns":[{"name":"sa_record_number","type":"text","label":"Record #"},{"name":"sa_status","type":"picklist","label":"Status"}],"sort_dir":"desc","sort_field":"sa_created_at","is_deleted_col":"sa_is_deleted"}')
  ) AS x(pos, title, cfg)
  WHERE swo.obj = 'work_orders'
) AS rl(pos, title, cfg);
