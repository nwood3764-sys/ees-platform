-- =========================================================================
-- project_payment_requests lifecycle infrastructure.
--
-- Pre-migration state:
--   • Columns are bare (status, record_type, payment_request_number,
--     owner_id, is_deleted, created_by, ...) — out of platform convention
--     where every other table uses a per-table prefix (e.g. wo_*, ia_*).
--   • status is text with a default of 'Payment Request To Be Prepared'.
--   • record_type is text with a default of 'standard'.
--   • 6 active rows numbered PAY-01000..PAY-01005, each in a different
--     lifecycle status (good demo coverage).
--   • Application code is partially-migrated: RecordDetail.jsx and
--     layoutService.js expect ppr_* columns; incentivesService.js still
--     reads the bare text columns.
--   • No picklist_values rows for project_payment_requests exist.
--   • No status_transitions rows for project_payment_requests exist.
--
-- This migration is purely additive:
--   1. Add ppr_record_number (text), ppr_status (uuid FK), ppr_record_type
--      (uuid FK) columns. Old text columns stay in place — this avoids
--      breaking incentivesService.js, which is updated in a follow-on
--      slice. Both representations coexist; backfill keeps them aligned
--      for existing rows.
--   2. Seed 9 status picklist_values (the canonical 9 statuses per
--      anura-status-lifecycles.md) and 1 record_type picklist value.
--   3. Backfill ppr_status (uuid) from the existing text status, and
--      ppr_record_type from existing text record_type, and ppr_record_number
--      from existing payment_request_number for the 6 existing rows.
--   4. Auto-numbering trigger for new INSERTs.
--
-- The text status column stays usable but is now considered legacy. A
-- follow-on slice will switch incentivesService.js to read ppr_status
-- (joining picklist_values), at which point the text status column can
-- be deprecated.
-- =========================================================================

-- Step 1: Add the new prefixed columns
ALTER TABLE public.project_payment_requests
  ADD COLUMN ppr_record_number text,
  ADD COLUMN ppr_status        uuid REFERENCES public.picklist_values(id),
  ADD COLUMN ppr_record_type   uuid REFERENCES public.picklist_values(id);

COMMENT ON COLUMN public.project_payment_requests.ppr_record_number IS
  'Auto-numbered record identifier (PAY-#####). Replaces the legacy payment_request_number column; both columns are populated during the transition period.';

COMMENT ON COLUMN public.project_payment_requests.ppr_status IS
  'FK to picklist_values(id) where picklist_object=project_payment_requests and picklist_field=ppr_status. Replaces the legacy text status column.';

COMMENT ON COLUMN public.project_payment_requests.ppr_record_type IS
  'FK to picklist_values(id) where picklist_object=project_payment_requests and picklist_field=ppr_record_type. Replaces the legacy text record_type column.';

-- Step 2: Seed picklist_values
-- 2a. Status — 9 explicit, action-implying values per anura-status-lifecycles.md
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
VALUES
  ('project_payment_requests','ppr_status','Payment Request To Be Prepared',           'Payment Request To Be Prepared',           true, 10, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('project_payment_requests','ppr_status','Payment Request To Be Verified',           'Payment Request To Be Verified',           true, 20, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('project_payment_requests','ppr_status','Payment Request To Be Submitted',          'Payment Request To Be Submitted',          true, 30, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('project_payment_requests','ppr_status','Payment Request Submitted — Awaiting Review','Payment Request Submitted — Awaiting Review', true, 40, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('project_payment_requests','ppr_status','Payment Request Under Review',             'Payment Request Under Review',             true, 50, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('project_payment_requests','ppr_status','Payment Request Approved',                 'Payment Request Approved',                 true, 60, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('project_payment_requests','ppr_status','Payment Request Payment Pending',          'Payment Request Payment Pending',          true, 70, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('project_payment_requests','ppr_status','Payment Request Payment Received',         'Payment Request Payment Received',         true, 80, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('project_payment_requests','ppr_status','Payment Request Closed',                   'Payment Request Closed',                   true, 90, 'c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- 2b. Record type — single 'Project Payment Request' value matching the SF DeveloperName pattern
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
VALUES
  ('project_payment_requests','ppr_record_type','Project_Payment_Request','Project Payment Request', true, 10, 'c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- Step 3: Backfill existing rows from legacy text columns
-- 3a. Status — match existing text to the new picklist values
UPDATE public.project_payment_requests ppr
SET ppr_status = pv.id
FROM public.picklist_values pv
WHERE pv.picklist_object = 'project_payment_requests'
  AND pv.picklist_field  = 'ppr_status'
  AND pv.picklist_value  = ppr.status;

-- 3b. Record type — all 6 existing rows are 'standard'; map to the new
-- 'Project_Payment_Request' record type (the only one we seeded).
UPDATE public.project_payment_requests ppr
SET ppr_record_type = pv.id
FROM public.picklist_values pv
WHERE pv.picklist_object = 'project_payment_requests'
  AND pv.picklist_field  = 'ppr_record_type'
  AND pv.picklist_value  = 'Project_Payment_Request';

-- 3c. Record number — preserve the existing PAY-##### identifiers
UPDATE public.project_payment_requests
SET ppr_record_number = payment_request_number
WHERE payment_request_number IS NOT NULL;

-- Step 4: Auto-numbering trigger for new inserts. Reuses the existing
-- payment_request_number_seq sequence (already advanced past 01005 by the
-- existing rows), keeping new and legacy numbering aligned.
CREATE OR REPLACE FUNCTION public.set_ppr_record_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ppr_record_number IS NULL OR NEW.ppr_record_number = '' THEN
    NEW.ppr_record_number := public.generate_record_number('PAY-', 'payment_request_number_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_ppr_record_number
  BEFORE INSERT ON public.project_payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_ppr_record_number();
