-- Sealed Inc is the PRIMARY contractor on the IRA programmes and Energy
-- Efficiency Services of Wisconsin is the SUPPORT contractor. Nearly every
-- enrollment had it the other way round -- EES as primary, and on twelve of
-- them EES named as its own support contractor, which is not a relationship at
-- all. Only ENR-00010 / 00037 / 00062 / 00063 and IA-00013 were right.
--
-- WHY THIS IS A TABLE AND NOT A CONSTANT. Which contractor leads which
-- programme is programme configuration, not a fact about the platform: it is
-- state-specific, it changes when a programme is re-bid, and HEAR may have no
-- support contractor at all (Nicholas, 2026-09-01). A constant inside a
-- function would need a deploy to change and could not express "HOMES has a
-- support contractor, HEAR does not". So the pairing is a row per object x
-- record type, and a programme with no support contractor is a row whose
-- support columns are NULL -- which reads as "no default", never as "clear
-- whatever is there".
--
-- A DEFAULT IS NOT A LOCK. The trigger fills only what is blank, so a record
-- naming a genuinely different contractor is never rewritten. That is what
-- protects the eleven Johnson Controls pre-approvals: real work by a real third
-- party, deliberately left exactly as they are.
--
-- The pairing is read from ENR-00010, one of the four records that were already
-- right, rather than resolved by name: "Brittin Wood" matches two contact
-- records (CON-00130 and its duplicate CON-00131), so a name lookup is
-- ambiguous, and the contact the correct records actually point at is the one
-- this default must reproduce.

CREATE SEQUENCE IF NOT EXISTS public.program_default_contractor_seq;

CREATE TABLE IF NOT EXISTS public.program_default_contractors (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pdc_record_number         text NOT NULL DEFAULT '',
  pdc_object                text NOT NULL CHECK (pdc_object IN ('enrollments','incentive_applications')),
  pdc_record_type           uuid NOT NULL REFERENCES public.picklist_values(id),
  pdc_primary_account_id    uuid REFERENCES public.accounts(id),
  pdc_primary_contact_id    uuid REFERENCES public.contacts(id),
  pdc_support_account_id    uuid REFERENCES public.accounts(id),
  pdc_support_contact_id    uuid REFERENCES public.contacts(id),
  pdc_notes                 text,
  pdc_is_active             boolean NOT NULL DEFAULT true,
  pdc_owner                 uuid REFERENCES public.users(id),
  pdc_is_deleted            boolean NOT NULL DEFAULT false,
  pdc_deleted_at            timestamptz,
  pdc_deleted_by            uuid REFERENCES public.users(id),
  pdc_deletion_reason       text,
  is_seed_data              boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS program_default_contractors_unique_live
  ON public.program_default_contractors (pdc_object, pdc_record_type)
  WHERE pdc_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.set_pdc_record_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog' AS $function$
BEGIN
  IF NEW.pdc_record_number IS NULL OR NEW.pdc_record_number = '' THEN
    NEW.pdc_record_number := public.generate_record_number('PDC-', 'program_default_contractor_seq');
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.set_pdc_record_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pdc_record_number ON public.program_default_contractors;
CREATE TRIGGER trg_pdc_record_number BEFORE INSERT ON public.program_default_contractors
  FOR EACH ROW EXECUTE FUNCTION public.set_pdc_record_number();

DROP TRIGGER IF EXISTS trg_pdc_block_hard_delete ON public.program_default_contractors;
CREATE TRIGGER trg_pdc_block_hard_delete BEFORE DELETE ON public.program_default_contractors
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

SELECT public.install_record_audit_stamping('program_default_contractors');

ALTER TABLE public.program_default_contractors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pdc_read  ON public.program_default_contractors;
DROP POLICY IF EXISTS pdc_write ON public.program_default_contractors;
CREATE POLICY pdc_read  ON public.program_default_contractors
  FOR SELECT USING (public.current_app_user_id() IS NOT NULL);
CREATE POLICY pdc_write ON public.program_default_contractors
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_default_contractors TO authenticated;

INSERT INTO public.record_state_scope_sources
  (rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_path_order, rsss_is_active, rsss_notes)
SELECT '', 'program_default_contractors', 'platform_configuration', 1, true,
       'Programme reference data: which contractor leads each programme and which supports it. Names EES''s own trading partners; carries no customer or property information.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
   WHERE rsss_object_name = 'program_default_contractors' AND rsss_is_deleted IS NOT TRUE);

INSERT INTO public.program_default_contractors
  (pdc_record_number, pdc_object, pdc_record_type,
   pdc_primary_account_id, pdc_primary_contact_id,
   pdc_support_account_id, pdc_support_contact_id, pdc_notes)
SELECT '', d.obj, pv.id,
       src.enrollment_contractor_account_id, src.enrollment_contractor_contact_id,
       CASE WHEN d.with_support THEN src.enrollment_support_contractor_account_id END,
       CASE WHEN d.with_support THEN src.enrollment_support_contractor_contact_id END,
       d.note
FROM (VALUES
  ('enrollments',            'WI-IRA-MF-HOMES-Project-Reservation',     true,
   'Sealed leads the HOMES install; EES performs the supporting work.'),
  ('enrollments',            'WI-IRA-MF-HOMES-Assessment-Preapproval',  true,
   'Sealed leads the HOMES install; EES performs the supporting work.'),
  ('enrollments',            'WI-IRA-MF-HEAR-Project-Reservation',      false,
   'Sealed leads HEAR. No support contractor is assumed -- HEAR may not have one, so the support fields stay blank until someone names one.'),
  ('incentive_applications', 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST', true,
   'Mirrors the HOMES reservation: Sealed primary, EES support.')
) AS d(obj, rt, with_support, note)
JOIN public.picklist_values pv
  ON pv.picklist_object = d.obj AND pv.picklist_field = 'record_type'
 AND pv.picklist_value = d.rt AND pv.picklist_is_active
CROSS JOIN LATERAL (
  SELECT e.enrollment_contractor_account_id, e.enrollment_contractor_contact_id,
         e.enrollment_support_contractor_account_id, e.enrollment_support_contractor_contact_id
  FROM public.enrollments e WHERE e.enrollment_record_number = 'ENR-00010'
) src
WHERE NOT EXISTS (
  SELECT 1 FROM public.program_default_contractors x
   WHERE x.pdc_object = d.obj AND x.pdc_record_type = pv.id AND x.pdc_is_deleted IS NOT TRUE);

DO $$
DECLARE n int; v_primary text; v_support text;
BEGIN
  SELECT count(*) INTO n FROM public.program_default_contractors WHERE pdc_is_deleted IS NOT TRUE;
  IF n <> 4 THEN
    RAISE EXCEPTION 'expected 4 programme contractor defaults, found %', n;
  END IF;
  SELECT a.account_name, s.account_name INTO v_primary, v_support
  FROM public.program_default_contractors d
  JOIN public.accounts a ON a.id = d.pdc_primary_account_id
  LEFT JOIN public.accounts s ON s.id = d.pdc_support_account_id
  WHERE d.pdc_object = 'incentive_applications';
  IF v_primary <> 'Sealed Inc' OR v_support <> 'Energy Efficiency Services of Wisconsin' THEN
    RAISE EXCEPTION 'the default came out backwards: primary=% support=%', v_primary, v_support;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_program_default_contractors()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog' AS $function$
DECLARE d public.program_default_contractors%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'enrollments' THEN
    SELECT * INTO d FROM public.program_default_contractors
     WHERE pdc_object = 'enrollments' AND pdc_record_type = NEW.enrollment_record_type
       AND pdc_is_active AND pdc_is_deleted IS NOT TRUE;
    IF NOT FOUND THEN RETURN NEW; END IF;

    -- Blanks only. A record naming a different contractor is never rewritten.
    NEW.enrollment_contractor_account_id := COALESCE(NEW.enrollment_contractor_account_id, d.pdc_primary_account_id);
    NEW.enrollment_contractor_contact_id := COALESCE(NEW.enrollment_contractor_contact_id, d.pdc_primary_contact_id);

    -- A programme with no support contractor configured leaves these alone
    -- entirely; it never clears what a preparer entered.
    IF d.pdc_support_account_id IS NOT NULL THEN
      NEW.enrollment_support_contractor_account_id := COALESCE(NEW.enrollment_support_contractor_account_id, d.pdc_support_account_id);
      NEW.enrollment_support_contractor_contact_id := COALESCE(NEW.enrollment_support_contractor_contact_id, d.pdc_support_contact_id);
      NEW.enrollment_has_support_contractor        := COALESCE(NEW.enrollment_has_support_contractor, true);
    END IF;

  ELSIF TG_TABLE_NAME = 'incentive_applications' THEN
    SELECT * INTO d FROM public.program_default_contractors
     WHERE pdc_object = 'incentive_applications' AND pdc_record_type = NEW.ia_record_type
       AND pdc_is_active AND pdc_is_deleted IS NOT TRUE;
    IF NOT FOUND THEN RETURN NEW; END IF;

    NEW.ia_contractor_account_id := COALESCE(NEW.ia_contractor_account_id, d.pdc_primary_account_id);
    NEW.ia_contractor_contact_id := COALESCE(NEW.ia_contractor_contact_id, d.pdc_primary_contact_id);
    IF d.pdc_support_account_id IS NOT NULL THEN
      NEW.ia_support_contractor_account_id := COALESCE(NEW.ia_support_contractor_account_id, d.pdc_support_account_id);
      NEW.ia_support_contractor_contact_id := COALESCE(NEW.ia_support_contractor_contact_id, d.pdc_support_contact_id);
      NEW.ia_has_support_contractor        := COALESCE(NEW.ia_has_support_contractor, true);
    END IF;
  END IF;

  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.apply_program_default_contractors() FROM PUBLIC, anon, authenticated;

-- trg_1_ so it runs AFTER the trg_0_ record-type derivation -- a record created
-- with no record type has nothing to look a default up by until that has run --
-- and before the trg_zz_ enforcement rules.
DROP TRIGGER IF EXISTS trg_1_program_default_contractors ON public.enrollments;
CREATE TRIGGER trg_1_program_default_contractors BEFORE INSERT ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.apply_program_default_contractors();

DROP TRIGGER IF EXISTS trg_1_program_default_contractors ON public.incentive_applications;
CREATE TRIGGER trg_1_program_default_contractors BEFORE INSERT ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.apply_program_default_contractors();
