-- A service appointment belongs to an ASSESSMENT, and to nothing else.
--
-- Nicholas, 2026-09-03: "this is why I don't like service appointments at all.
-- They only should be used for assessments. That's it. Get rid of them. I don't
-- want them to have anything to do with regular work orders at all."
--
-- The appointment exists for the customer-facing half of the business: an
-- assessment is booked WITH a homeowner, who is told when somebody is coming,
-- reminded, and told when the technician is on the way. That whole pipeline is
-- keyed to service_appointments and is the reason the object is here.
--
-- Regular work orders have none of that. Attaching an appointment to one bought
-- nothing and cost repeatedly: it gated the technician's day, and it carried a
-- customer contact into a pipeline whose only safety check is whether a contact
-- is present, which emailed a real property contact "Your home energy
-- assessment is scheduled" about an insulation removal (NL-00043).
--
-- Safe to enforce now: of 101 live appointments, 76 sit on non-assessment work
-- orders and ZERO appointments anywhere are in the future.
--
-- The 76 historical rows are deliberately LEFT IN PLACE. They record that a
-- crew was on a site on a day, which is true and is evidence an auditor may
-- read. This stops new ones; it does not rewrite history.
CREATE OR REPLACE FUNCTION public.enforce_service_appointment_is_for_an_assessment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_work_type text; v_wo text;
BEGIN
  IF NEW.sa_is_deleted IS TRUE THEN RETURN NEW; END IF;
  -- History is never re-validated: an appointment predating this rule stays
  -- editable so it can be corrected or closed out.
  IF TG_OP = 'UPDATE' AND NEW.work_order_id IS NOT DISTINCT FROM OLD.work_order_id THEN
    RETURN NEW;
  END IF;
  IF NEW.work_order_id IS NULL THEN RETURN NEW; END IF;

  SELECT wt.work_type_name, wo.work_order_record_number INTO v_work_type, v_wo
    FROM public.work_orders wo
    LEFT JOIN public.work_types wt ON wt.id = COALESCE(NEW.work_type_id, wo.work_type_id)
   WHERE wo.id = NEW.work_order_id;

  -- Matched on the work type NAME, so a programme's assessment added next month
  -- is covered without a migration. Audit counts: an audit IS the assessment
  -- programme's own field work (the 2026-08-23 ruling).
  IF v_work_type IS NOT NULL
     AND v_work_type NOT ILIKE '%assessment%'
     AND v_work_type NOT ILIKE '%audit%' THEN
    RAISE EXCEPTION
      'A service appointment is only for an assessment. % is a "%" work order — schedule it by setting its Assigned Technician and Scheduled Start Date on the work order itself.',
      COALESCE(v_wo, 'That work order'), v_work_type USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zz_sa_assessment_only ON public.service_appointments;
CREATE TRIGGER trg_zz_sa_assessment_only
  BEFORE INSERT OR UPDATE ON public.service_appointments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_appointment_is_for_an_assessment();

-- PostgreSQL does not check EXECUTE when it FIRES a trigger, so the grant is
-- revoked (the 2026-08-31 rule: promoting a trigger function to SECURITY
-- DEFINER must revoke EXECUTE in the same migration).
REVOKE ALL ON FUNCTION public.enforce_service_appointment_is_for_an_assessment() FROM PUBLIC, anon, authenticated;
