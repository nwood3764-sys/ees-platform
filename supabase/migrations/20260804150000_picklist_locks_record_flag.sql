-- Status-based record locking: a picklist status value can mark the record
-- locked once it is reached. Locked records are read-only in the UI for
-- everyone except System Administrators (who can still edit to unlock/correct),
-- and a record cannot be moved to a locking status until every required field
-- is populated. Data-driven so admins can adjust which statuses lock with no
-- code change.
ALTER TABLE public.picklist_values
  ADD COLUMN IF NOT EXISTS picklist_locks_record boolean NOT NULL DEFAULT false;

-- Enrollment lifecycle: lock once submitted to the program and beyond. The prep
-- and verification stages stay editable, and "Corrections Needed" stays editable
-- by design (the user must be able to fix it).
UPDATE public.picklist_values
SET picklist_locks_record = true
WHERE picklist_object = 'enrollments'
  AND picklist_field = 'enrollment_status'
  AND picklist_value IN (
    'Enrollment Submitted — Awaiting Program Response',
    'Enrollment Approved',
    'Enrollment Denied',
    'Enrollment Withdrawn'
  );
