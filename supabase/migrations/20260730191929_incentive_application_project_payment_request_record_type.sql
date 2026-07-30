-- WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST incentive application record type
--
-- Adds a new record type to the incentive_applications object so a Project
-- Payment Request is its own incentive-application record (one per opportunity /
-- per building), distinct from the main WI-IRA-MF-HOMES program application.
-- This record type is the home for the Final Project Payment Request submittal
-- package (invoices, sealed documents, workbook, Notification of Combustion
-- Safety) — generated at the incentive-application / opportunity level, never
-- from a project.
--
-- Additive only: a single new picklist value. No existing record types, layouts,
-- or records are modified.
--
-- No dedicated page layout is seeded here on purpose. fetchPageLayout()
-- (src/data/layoutService.js) falls back to the object's master layout
-- (record_type_id IS NULL — "Incentive Application Layout", PL-00301) for any
-- record type without its own, so records of this type render immediately. A
-- purpose-built Project Payment Request layout — valid current fields plus the
-- submittal-documents section and the Generate action — is built with the
-- document-generation package rather than cloned from the WI-IRA-MF-HOMES
-- layout, which carries stale field references (e.g. ia_business_entity_name)
-- the widget-config validation trigger now rejects.

insert into picklist_values (
  id, picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_is_active, picklist_sort_order, picklist_created_by,
  picklist_show_in_path, picklist_is_default_record_type,
  picklist_requires_income_qualification
)
values (
  gen_random_uuid(), 'incentive_applications', 'record_type',
  'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST',
  'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST',
  true, 90, 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
  true, false, false
)
on conflict do nothing;
