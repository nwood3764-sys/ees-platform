-- Permission sweep — Phase A
-- Seed role_object_access with the baseline role × object × action matrix.
-- Internal roles get broad READ on all business tables, scoped WRITE depending
-- on role. External roles (Property Owner, Property Manager, Subcontractor
-- Partner) get nothing yet — their access will come via row-level rules when
-- the portal is built.
-- Admin is intentionally NOT in this table; app_user_can short-circuits Admin
-- to true regardless.

DELETE FROM public.role_object_access;

WITH internal_roles AS (
  SELECT id, role_name FROM public.roles
  WHERE role_name IN (
    'Program Manager', 'Project Manager', 'Project Coordinator',
    'Director of Field Services', 'Project Site Lead', 'Team Lead',
    'Lead Technician', 'Technician in Training', 'Shop Steward'
  )
),
business_objects AS (
  SELECT unnest(ARRAY[
    'accounts', 'account_contact_relations', 'contacts', 'contact_skills',
    'properties', 'buildings', 'units',
    'opportunities', 'opportunity_line_items', 'opportunity_contact_roles',
    'price_books', 'price_book_entries', 'products', 'product_items',
    'product_assemblies', 'product_transfers',
    'projects',
    'work_orders', 'work_steps', 'work_plans',
    'work_types', 'work_plan_templates', 'work_plan_template_entries', 'work_step_templates',
    'service_appointments', 'service_appointment_assignments',
    'materials_requests', 'materials_request_line_items',
    'time_sheets', 'time_sheet_entries',
    'photos', 'documents', 'gps_points',
    'vehicles', 'vehicle_activities',
    'equipment', 'equipment_activities', 'equipment_containers', 'equipment_information',
    'mechanical_equipment', 'ahri_equipment', 'ahri_certificates',
    'asset_assignments', 'job_kits', 'crew_phones',
    'assessments', 'diagnostic_tests', 'efr_reports',
    'incentives', 'incentive_applications',
    'activities', 'comments', 'chat_threads', 'chat_messages',
    'project_report_templates', 'project_report_template_sections',
    'project_report_template_snapshots',
    'project_report_template_record_type_assignments',
    'occurrences', 'occurrence_participants',
    'users', 'roles', 'skills',
    'picklist_values',
    'field_history'
  ]) AS object_name
)
INSERT INTO public.role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT ir.id, bo.object_name, TRUE, FALSE, FALSE, FALSE
FROM internal_roles ir CROSS JOIN business_objects bo;

-- Program Manager
UPDATE public.role_object_access
SET roa_create = TRUE, roa_update = TRUE
WHERE roa_role_id = (SELECT id FROM public.roles WHERE role_name = 'Program Manager')
  AND roa_object_name IN (
    'opportunities', 'opportunity_line_items', 'opportunity_contact_roles',
    'projects', 'incentives', 'incentive_applications',
    'accounts', 'contacts', 'properties', 'buildings', 'units',
    'activities', 'comments', 'documents'
  );

-- Project Manager
UPDATE public.role_object_access
SET roa_create = TRUE, roa_update = TRUE
WHERE roa_role_id = (SELECT id FROM public.roles WHERE role_name = 'Project Manager')
  AND roa_object_name IN (
    'opportunities', 'opportunity_line_items', 'opportunity_contact_roles',
    'projects', 'work_orders', 'work_plans', 'work_steps',
    'service_appointments', 'service_appointment_assignments',
    'materials_requests', 'materials_request_line_items',
    'accounts', 'contacts', 'properties', 'buildings', 'units',
    'assessments', 'diagnostic_tests', 'efr_reports',
    'activities', 'comments', 'documents', 'photos',
    'project_report_templates', 'project_report_template_sections'
  );

-- Project Coordinator
UPDATE public.role_object_access
SET roa_create = TRUE, roa_update = TRUE
WHERE roa_role_id = (SELECT id FROM public.roles WHERE role_name = 'Project Coordinator')
  AND roa_object_name IN (
    'projects', 'work_orders', 'work_steps',
    'service_appointments', 'service_appointment_assignments',
    'materials_requests', 'materials_request_line_items',
    'time_sheets', 'time_sheet_entries',
    'occurrences', 'occurrence_participants',
    'activities', 'comments', 'documents', 'photos'
  );

-- Director of Field Services
UPDATE public.role_object_access
SET roa_create = TRUE, roa_update = TRUE
WHERE roa_role_id = (SELECT id FROM public.roles WHERE role_name = 'Director of Field Services')
  AND roa_object_name IN (
    'work_orders', 'work_steps',
    'service_appointments', 'service_appointment_assignments',
    'vehicles', 'vehicle_activities',
    'equipment', 'equipment_activities', 'equipment_containers', 'equipment_information',
    'asset_assignments', 'job_kits', 'crew_phones',
    'time_sheets', 'time_sheet_entries',
    'gps_points', 'photos',
    'activities', 'comments', 'documents'
  );

-- Project Site Lead
UPDATE public.role_object_access
SET roa_create = TRUE, roa_update = TRUE
WHERE roa_role_id = (SELECT id FROM public.roles WHERE role_name = 'Project Site Lead')
  AND roa_object_name IN (
    'work_orders', 'work_steps',
    'time_sheets', 'time_sheet_entries',
    'vehicle_activities', 'equipment_activities',
    'gps_points', 'photos',
    'activities', 'comments'
  );

-- Team Lead
UPDATE public.role_object_access
SET roa_create = TRUE, roa_update = TRUE
WHERE roa_role_id = (SELECT id FROM public.roles WHERE role_name = 'Team Lead')
  AND roa_object_name IN (
    'work_steps',
    'time_sheets', 'time_sheet_entries',
    'vehicle_activities', 'equipment_activities',
    'gps_points', 'photos',
    'activities', 'comments'
  );

-- Lead Technician
UPDATE public.role_object_access
SET roa_create = TRUE, roa_update = TRUE
WHERE roa_role_id = (SELECT id FROM public.roles WHERE role_name = 'Lead Technician')
  AND roa_object_name IN (
    'work_steps',
    'time_sheets', 'time_sheet_entries',
    'gps_points', 'photos',
    'comments'
  );

-- Technician in Training
UPDATE public.role_object_access
SET roa_create = TRUE, roa_update = TRUE
WHERE roa_role_id = (SELECT id FROM public.roles WHERE role_name = 'Technician in Training')
  AND roa_object_name IN (
    'time_sheets', 'time_sheet_entries',
    'gps_points', 'photos',
    'comments'
  );

-- Shop Steward
UPDATE public.role_object_access
SET roa_create = TRUE, roa_update = TRUE
WHERE roa_role_id = (SELECT id FROM public.roles WHERE role_name = 'Shop Steward')
  AND roa_object_name IN (
    'vehicles', 'vehicle_activities',
    'equipment', 'equipment_activities', 'equipment_containers', 'equipment_information',
    'asset_assignments', 'job_kits',
    'materials_requests', 'materials_request_line_items',
    'product_items', 'product_transfers',
    'activities', 'comments'
  );
