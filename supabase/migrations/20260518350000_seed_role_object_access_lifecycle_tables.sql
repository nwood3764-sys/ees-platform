-- =========================================================================
-- role_object_access seed for the lifecycle config tables.
--
-- Three tables affected:
--   1. status_transitions       — lifecycle edges authored in Lifecycle Builder
--   2. status_change_events     — audit-trail rows written by change_record_status
--   3. object_lifecycle_config  — per-object primary-lifecycle declaration
--
-- Read access: all 9 internal staff roles. Required so the StatusTransitionsBar
-- can render outgoing transitions, the ActivityTimeline can list status change
-- events, and the bar's two-phase resolver can consult object_lifecycle_config.
--
-- Write access: Program Manager only on status_transitions and
-- object_lifecycle_config. Per the EES-WI roles & field structure doc, Program
-- Manager is the program-portfolio-level authority; lifecycle authoring is a
-- Builder activity owned at that level. Project Manager is too narrow
-- (per-project responsibility). Admin short-circuits app_user_can so no row
-- is needed.
--
-- status_change_events has no write rows in this seed — the table accepts
-- inserts only via change_record_status (SECURITY DEFINER) and rejects direct
-- writes. Granting create/update/delete here would be misleading.
--
-- Pattern matches the existing picklist_values seed: 9 read-only rows across
-- the internal staff baseline.
-- =========================================================================

WITH internal_roles AS (
  SELECT id, role_name FROM public.roles
  WHERE role_name IN (
    'Director of Field Services', 'Lead Technician', 'Program Manager',
    'Project Coordinator', 'Project Manager', 'Project Site Lead',
    'Shop Steward', 'Team Lead', 'Technician in Training'
  )
),
target_objects AS (
  SELECT unnest(ARRAY[
    'status_transitions',
    'status_change_events',
    'object_lifecycle_config'
  ]) AS obj
)
INSERT INTO public.role_object_access (
  roa_role_id, roa_object_name,
  roa_read, roa_create, roa_update, roa_delete,
  roa_created_by, roa_updated_by
)
SELECT
  ir.id, tobj.obj,
  true,
  -- Program Manager gets full CRUD on the two authorable lifecycle tables.
  -- Everyone else (and Program Manager on status_change_events) gets read only.
  CASE WHEN ir.role_name = 'Program Manager' AND tobj.obj IN ('status_transitions','object_lifecycle_config') THEN true ELSE false END,
  CASE WHEN ir.role_name = 'Program Manager' AND tobj.obj IN ('status_transitions','object_lifecycle_config') THEN true ELSE false END,
  CASE WHEN ir.role_name = 'Program Manager' AND tobj.obj IN ('status_transitions','object_lifecycle_config') THEN true ELSE false END,
  'c5a01ec8-960f-42ab-8a9e-a49822de89af',
  'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM internal_roles ir, target_objects tobj;
