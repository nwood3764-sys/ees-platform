-- Seed the currently built submittal documents against their opportunity
-- stages. Only the Final Project Payment Request invoice requires a signature
-- (Nicholas, 2026-07-27).
--
-- Stage UUIDs are the WI-IRA-MF-HOMES and WI-IRA-MF-HOMES-AUDIT stage
-- picklist values; they are looked up by value rather than hardcoded so this
-- replays correctly on a branch database.
INSERT INTO public.stage_document_requirements
  (sdr_record_number, sdr_name, sdr_object, sdr_stage_value_id, sdr_document_key,
   sdr_requires_signature, sdr_signer_role, sdr_sort_order,
   sdr_owner, sdr_created_by, is_seed_data)
SELECT '', v.name, 'opportunities', sv.id, v.doc_key,
       v.requires_sig, v.signer_role, v.sort_order, u.id, u.id, true
FROM (SELECT id FROM public.users
      WHERE user_is_deleted IS NOT TRUE
      ORDER BY (user_email = 'nicholas.wood@ees-wi.org') DESC, user_created_at
      LIMIT 1) u
CROSS JOIN (VALUES
  ('Energy Audit Invoice', 'Opportunity — WI HOMES Audit Phase 8: Payment Request Submitted', 'energy_audit_invoice', false, NULL::text, 10),
  ('Project Reservation Proposal', 'Opportunity — HOMES Phase 4: Project Reservation', 'homes_project_proposal', false, NULL::text, 10),
  ('Sealed Proposal',              'Opportunity — HOMES Phase 4: Project Reservation', 'sealed_proposal',        false, NULL::text, 20),
  ('Paperwork Workbook',           'Opportunity — HOMES Phase 4: Project Reservation', 'paperwork_workbook',     false, NULL::text, 30),
  ('Final Project Payment Request Invoice', 'Opportunity — HOMES Phase 8: Payment Request Submitted', 'homes_project_invoice', true, 'Property Owner', 10),
  ('Sealed Invoice',                        'Opportunity — HOMES Phase 8: Payment Request Submitted', 'sealed_invoice',        false, NULL::text, 20),
  ('Paperwork Workbook',                    'Opportunity — HOMES Phase 8: Payment Request Submitted', 'paperwork_workbook',    false, NULL::text, 30)
) AS v(name, stage_value, doc_key, requires_sig, signer_role, sort_order)
JOIN public.picklist_values sv
  ON sv.picklist_object = 'opportunities'
 AND sv.picklist_field  = 'opportunity_stage'
 AND sv.picklist_value  = v.stage_value;
