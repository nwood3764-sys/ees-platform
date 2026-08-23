-- Retire the two generic energy-assessment OPPORTUNITY record types.
--
-- Nicholas, 2026-08-23: "Multifamily assessments and single-family assessments
-- shouldn't be record types. Make those inactive. Don't delete them, just make
-- them inactive."
--
-- They are the last two nationwide program-shaped opportunity record types left
-- over from before assessments became per-state. Every real program is scoped to
-- one state (picklist_state) and an assessment is the AUDIT program's own work —
-- NC-IRA-SF-HOMES-AUDIT, WI-IRA-MF-HOMES-AUDIT and the rest, seeded 2026-08-22 —
-- so a nationwide "Multifamily Energy Assessment" opportunity has no program,
-- no state, and slipped past the state filter on every property in the platform.
--
-- Inactive, not deleted, and Salesforce-parity semantics throughout: the value
-- disappears from the New Opportunity picker, records that already carry it keep
-- it and still render, and its own opportunity_stage set
-- (picklist_value_record_type_assignments — two stages each) is left intact so
-- those records keep their lifecycle. Nine live opportunities carry
-- SINGLE-FAMILY-ENERGY-ASSESSMENT (OPP-00081/82/83/88/89/90/91/92/00141); none
-- carry MULTIFAMILY-ENERGY-ASSESSMENT.
--
-- Scope is deliberately the opportunities object only. The identically named
-- PROJECTS and WORK_ORDERS record types are what the assessment work actually
-- runs on and are untouched.
--
-- Note for the next session: create_assessment_work_order and
-- create_mf_building_assessment_work_order (the LEAP Pad self-service assessment
-- paths) still resolve these two values by name when they create the assessment
-- opportunity, so records they create will carry a retired record type. They
-- keep working — an inactive record type is legal on a record and both values
-- stay nationwide, so the new state guardrail passes — but the right target is
-- the property state's audit program, and which program (and which of its
-- stages) an ad-hoc field assessment belongs to is Nicholas's call, not a
-- migration's.

UPDATE public.picklist_values
   SET picklist_is_active = false
 WHERE picklist_object = 'opportunities'
   AND picklist_field  = 'record_type'
   AND picklist_value IN ('MULTIFAMILY-ENERGY-ASSESSMENT', 'SINGLE-FAMILY-ENERGY-ASSESSMENT')
   AND picklist_is_active;
