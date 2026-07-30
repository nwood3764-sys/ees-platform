-- ---------------------------------------------------------------------------
-- Income Qualification is a record-type-scoped, run-once enrollment step
-- ---------------------------------------------------------------------------
-- "Run Income Qualification" was showing on EVERY enrollment record, because
-- its only visibility rule was tableName === 'enrollments'. That was correct
-- when the only enrollment record types were the six income-qualification IRA
-- programs (WI/NC/MI × SF/MF). Enrollments have since grown other record types
-- that are NOT income qualification (the HOMES Assessment-Preapproval and
-- Project-Reservation stages), so the action now over-applies.
--
-- Income qualification is a property of the enrollment RECORD TYPE, not of the
-- object — so we flag it on the record-type picklist row, the same place the
-- record type's icon/color/default flag already live (picklist_is_default_
-- record_type is the existing precedent for a record-type workflow boolean on
-- this table). Nothing is hardcoded in app logic: the guard reads this flag.
--
-- The run-once half of the fix is data-driven too and needs no schema: the run
-- already persists enrollments.enrollment_determination_date, so the client
-- gates the action on that being null.
-- ---------------------------------------------------------------------------

ALTER TABLE public.picklist_values
  ADD COLUMN IF NOT EXISTS picklist_requires_income_qualification boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.picklist_values.picklist_requires_income_qualification IS
  'Record-type flag (enrollments.record_type): true when this enrollment record type runs the one-time Income Qualification step. Drives the "Run Income Qualification" action visibility. Manageable per record type.';

-- Seed: the six income-qualification IRA enrollment programs. The HOMES
-- Assessment-Preapproval and Project-Reservation enrollment record types are
-- deliberately left false — they are other stages, not income qualification.
UPDATE public.picklist_values
   SET picklist_requires_income_qualification = true
 WHERE picklist_object = 'enrollments'
   AND picklist_field  = 'record_type'
   AND picklist_value IN (
     'WI-IRA-SF', 'WI-IRA-MF',
     'NC-IRA-SF', 'NC-IRA-MF',
     'MI-IRA-SF', 'MI-IRA-MF'
   );

NOTIFY pgrst, 'reload schema';
