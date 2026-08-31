-- A payment request brings the reservation's files with it, once, when it is
-- created.
--
-- The HOMES Project Reservation and the Project Payment Request are the same
-- programme on the same opportunity at two stages, and most of the supporting
-- documentation is literally the same file. Re-uploading it by hand is the
-- step nobody should be doing.
--
-- ON CREATE ONLY (Nicholas): AFTER INSERT, never on update. A later edit must
-- not drag files back in -- once the record exists, what is attached to it is
-- the preparer's decision. The migration asserts the trigger really is INSERT
-- only rather than trusting the definition to stay that way.
--
-- The type mapping is a table, not a list inside the function, because which
-- reservation document feeds which payment request slot is programme
-- configuration: the two forms name the same document differently
-- (reservation_hpxml is the payment request's HPXMLv4/Building Sync File) and
-- a new slot should be wirable without a deploy.
--
-- A document type NOT in the map is deliberately left behind. The reservation
-- carries customer_contract_sow and li_owner_acknowledgment, which belong to
-- the reservation and are not asked for again at payment.
--
-- What is copied is the document RECORD, pointing at the same stored object.
-- SQL cannot duplicate the bytes, and it should not: the file is the same file.
-- Deleting either side never removes the other's row, and neither deletes the
-- object.

CREATE SEQUENCE IF NOT EXISTS public.payment_request_inherited_document_type_seq;

CREATE TABLE IF NOT EXISTS public.payment_request_inherited_document_types (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prid_record_number     text NOT NULL DEFAULT '',
  prid_source_type       text NOT NULL,
  prid_target_type       text NOT NULL,
  prid_notes             text,
  prid_is_active         boolean NOT NULL DEFAULT true,
  prid_owner             uuid REFERENCES public.users(id),
  prid_is_deleted        boolean NOT NULL DEFAULT false,
  prid_deleted_at        timestamptz,
  prid_deleted_by        uuid REFERENCES public.users(id),
  prid_deletion_reason   text,
  is_seed_data           boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_request_inherited_document_types_unique_live
  ON public.payment_request_inherited_document_types (prid_source_type)
  WHERE prid_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.set_prid_record_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog' AS $function$
BEGIN
  IF NEW.prid_record_number IS NULL OR NEW.prid_record_number = '' THEN
    NEW.prid_record_number := public.generate_record_number(
      'PRID-', 'payment_request_inherited_document_type_seq');
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.set_prid_record_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prid_record_number ON public.payment_request_inherited_document_types;
CREATE TRIGGER trg_prid_record_number BEFORE INSERT ON public.payment_request_inherited_document_types
  FOR EACH ROW EXECUTE FUNCTION public.set_prid_record_number();

DROP TRIGGER IF EXISTS trg_prid_block_hard_delete ON public.payment_request_inherited_document_types;
CREATE TRIGGER trg_prid_block_hard_delete BEFORE DELETE ON public.payment_request_inherited_document_types
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

SELECT public.install_record_audit_stamping('payment_request_inherited_document_types');

ALTER TABLE public.payment_request_inherited_document_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prid_read  ON public.payment_request_inherited_document_types;
DROP POLICY IF EXISTS prid_write ON public.payment_request_inherited_document_types;
CREATE POLICY prid_read  ON public.payment_request_inherited_document_types
  FOR SELECT USING (public.current_app_user_id() IS NOT NULL);
CREATE POLICY prid_write ON public.payment_request_inherited_document_types
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_request_inherited_document_types TO authenticated;

INSERT INTO public.record_state_scope_sources
  (rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_path_order, rsss_is_active, rsss_notes)
SELECT '', 'payment_request_inherited_document_types', 'platform_configuration', 1, true,
       'Document-type reference data: which reservation document feeds which payment request upload slot. Carries no customer or property information.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
   WHERE rsss_object_name = 'payment_request_inherited_document_types' AND rsss_is_deleted IS NOT TRUE);

INSERT INTO public.payment_request_inherited_document_types
  (prid_record_number, prid_source_type, prid_target_type, prid_notes)
SELECT '', m.src, m.tgt, m.note
FROM (VALUES
  ('audit_template_report',        'audit_template_report',        'The same document under the same name on both forms.'),
  ('reservation_hpxml',            'payment_hpxml',                'The reservation''s HPXML / Building Sync file is the payment request''s.'),
  ('reservation_customer_report',  'payment_customer_report',      'The reservation''s customer report is the payment request''s.'),
  ('attachment',                   'attachment',                   'Loose attachments carry across as loose attachments.')
) AS m(src, tgt, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_request_inherited_document_types x
   WHERE x.prid_source_type = m.src AND x.prid_is_deleted IS NOT TRUE);

CREATE OR REPLACE FUNCTION public.copy_reservation_documents_to_payment_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rt      text;
  v_res_id  uuid;
BEGIN
  SELECT picklist_value INTO v_rt FROM public.picklist_values WHERE id = NEW.ia_record_type;
  IF v_rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST'
     OR NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT en.id INTO v_res_id
  FROM public.enrollments en
  JOIN public.picklist_values rt ON rt.id = en.enrollment_record_type
  WHERE en.opportunity_id = NEW.opportunity_id
    AND en.enrollment_is_deleted IS NOT TRUE
    AND rt.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation'
  ORDER BY en.enrollment_updated_at DESC NULLS LAST
  LIMIT 1;
  IF v_res_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.documents
    (document_number, name, document_type, category, file_url, file_size_bytes, mime_type,
     related_object, related_id, storage_bucket, storage_path, program_id, uploaded_by)
  SELECT '', d.name, m.prid_target_type, d.category, d.file_url, d.file_size_bytes, d.mime_type,
         'incentive_applications', NEW.id, d.storage_bucket, d.storage_path, d.program_id, d.uploaded_by
  FROM public.documents d
  JOIN public.payment_request_inherited_document_types m
    ON m.prid_source_type = d.document_type
   AND m.prid_is_active
   AND m.prid_is_deleted IS NOT TRUE
  WHERE d.related_object = 'enrollments'
    AND d.related_id = v_res_id
    AND d.is_deleted IS NOT TRUE
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

DROP TRIGGER IF EXISTS trg_5_ia_inherit_reservation_documents ON public.incentive_applications;
CREATE TRIGGER trg_5_ia_inherit_reservation_documents
  AFTER INSERT ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.copy_reservation_documents_to_payment_request();

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.payment_request_inherited_document_types
   WHERE prid_is_deleted IS NOT TRUE AND prid_is_active;
  IF v_n < 4 THEN
    RAISE EXCEPTION 'Expected the four inherited document types, found %', v_n;
  END IF;

  -- On create only. If anyone widens this to UPDATE, the migration replay fails.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.incentive_applications'::regclass
       AND t.tgname = 'trg_5_ia_inherit_reservation_documents'
       AND (t.tgtype & 4) <> 0      -- INSERT
       AND (t.tgtype & 16) = 0      -- not UPDATE
       AND (t.tgtype & 2)  = 0      -- AFTER, not BEFORE
  ) THEN
    RAISE EXCEPTION 'The inheritance trigger is not AFTER INSERT only';
  END IF;
END $$;
