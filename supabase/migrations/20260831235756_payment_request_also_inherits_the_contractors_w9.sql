-- The registered contractor's W-9 comes across too.
--
-- The W-9 belongs to the contractor, not to any one payment request: it is held
-- once on the account (documents.related_object = 'accounts', type 'w9') and
-- was being re-uploaded into every payment request's Upload W9 slot by hand.
--
-- That means the inheritance map needs a source OBJECT as well as a source
-- type, because the reservation and the account are two different places to
-- read from. prid_source_object defaults to 'enrollments', so every rule
-- written before this migration keeps meaning exactly what it meant, and the
-- unique key moves from (source_type) to (source_object, source_type) -- the
-- same type name can legitimately appear on both.
--
-- Scoping by object is also what keeps this safe: the existing
-- 'attachment' -> 'attachment' rule is an ENROLLMENTS rule, so the loose
-- attachments and the COI hanging off an account are not swept in. Only the
-- W-9 is named, and only the W-9 travels.
--
-- Read from ia_contractor_account_id, which is the account the payment
-- information already mirrors -- the party who gets paid is the party whose W-9
-- the programme wants.
--
-- Still create-only; the migration re-asserts the trigger is AFTER INSERT.

ALTER TABLE public.payment_request_inherited_document_types
  ADD COLUMN IF NOT EXISTS prid_source_object text NOT NULL DEFAULT 'enrollments';

ALTER TABLE public.payment_request_inherited_document_types
  DROP CONSTRAINT IF EXISTS payment_request_inherited_document_types_source_object_check;
ALTER TABLE public.payment_request_inherited_document_types
  ADD CONSTRAINT payment_request_inherited_document_types_source_object_check
  CHECK (prid_source_object IN ('enrollments','accounts'));

DROP INDEX IF EXISTS public.payment_request_inherited_document_types_unique_live;
CREATE UNIQUE INDEX IF NOT EXISTS payment_request_inherited_document_types_unique_live
  ON public.payment_request_inherited_document_types (prid_source_object, prid_source_type)
  WHERE prid_is_deleted IS NOT TRUE;

INSERT INTO public.payment_request_inherited_document_types
  (prid_record_number, prid_source_object, prid_source_type, prid_target_type, prid_notes)
SELECT '', 'accounts', 'w9', 'payment_w9',
       'The registered contractor''s W-9, held once on the account rather than re-uploaded per payment request.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_request_inherited_document_types x
   WHERE x.prid_source_object = 'accounts' AND x.prid_source_type = 'w9'
     AND x.prid_is_deleted IS NOT TRUE);

CREATE OR REPLACE FUNCTION public.copy_reservation_documents_to_payment_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rt     text;
  v_res_id uuid;
BEGIN
  SELECT picklist_value INTO v_rt FROM public.picklist_values WHERE id = NEW.ia_record_type;
  IF v_rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST' THEN
    RETURN NEW;
  END IF;

  IF NEW.opportunity_id IS NOT NULL THEN
    SELECT en.id INTO v_res_id
    FROM public.enrollments en
    JOIN public.picklist_values rt ON rt.id = en.enrollment_record_type
    WHERE en.opportunity_id = NEW.opportunity_id
      AND en.enrollment_is_deleted IS NOT TRUE
      AND rt.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation'
    ORDER BY en.enrollment_updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  INSERT INTO public.documents
    (document_number, name, document_type, category, file_url, file_size_bytes, mime_type,
     related_object, related_id, storage_bucket, storage_path, program_id, uploaded_by)
  SELECT '', d.name, m.prid_target_type, d.category, d.file_url, d.file_size_bytes, d.mime_type,
         'incentive_applications', NEW.id, d.storage_bucket, d.storage_path, d.program_id, d.uploaded_by
  FROM public.documents d
  JOIN public.payment_request_inherited_document_types m
    ON m.prid_source_type = d.document_type
   AND m.prid_source_object = d.related_object
   AND m.prid_is_active
   AND m.prid_is_deleted IS NOT TRUE
  WHERE d.is_deleted IS NOT TRUE
    AND (
      (d.related_object = 'enrollments' AND v_res_id IS NOT NULL AND d.related_id = v_res_id)
      OR
      (d.related_object = 'accounts'    AND NEW.ia_contractor_account_id IS NOT NULL
                                        AND d.related_id = NEW.ia_contractor_account_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.documents x
       WHERE x.related_object = 'incentive_applications'
         AND x.related_id = NEW.id
         AND x.is_deleted IS NOT TRUE
         AND x.storage_path IS NOT DISTINCT FROM d.storage_path
         AND x.document_type = m.prid_target_type);

  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.copy_reservation_documents_to_payment_request() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.payment_request_inherited_document_types
   WHERE prid_is_deleted IS NOT TRUE AND prid_is_active;
  IF v_n < 5 THEN
    RAISE EXCEPTION 'Expected five inherited document rules, found %', v_n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payment_request_inherited_document_types
     WHERE prid_source_object='accounts' AND prid_source_type='w9'
       AND prid_target_type='payment_w9' AND prid_is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'The W-9 rule is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.incentive_applications'::regclass
       AND t.tgname = 'trg_5_ia_inherit_reservation_documents'
       AND (t.tgtype & 4) <> 0 AND (t.tgtype & 16) = 0 AND (t.tgtype & 2) = 0
  ) THEN
    RAISE EXCEPTION 'The inheritance trigger is no longer AFTER INSERT only';
  END IF;
END $$;
