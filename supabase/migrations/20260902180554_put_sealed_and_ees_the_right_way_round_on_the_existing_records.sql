-- The defaults only govern NEW records. These are the ones already filed
-- backwards: EES named as primary contractor, and on twelve of them EES named
-- as its own support contractor too.
--
-- SCOPED BY WHAT IS DEMONSTRABLY WRONG, not by record type alone. Only rows
-- whose primary contractor is EES are touched. The eleven Johnson Controls
-- pre-approvals name a real third-party contractor and are left exactly as
-- they are -- which is why this is a targeted correction and not a blanket
-- overwrite of the programme's records.
--
-- Support is filled only where the programme has one configured, so HEAR keeps
-- what it has: moving its primary from EES to Sealed leaves EES in the support
-- seat, which is a real pairing rather than a company supporting itself.

SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  v_enr int; v_ia int; v_after int;
  v_ees uuid;
BEGIN
  SELECT id INTO v_ees FROM public.accounts
   WHERE account_name = 'Energy Efficiency Services of Wisconsin' AND account_is_deleted IS NOT TRUE;

  UPDATE public.enrollments e
     SET enrollment_contractor_account_id = d.pdc_primary_account_id,
         enrollment_contractor_contact_id = d.pdc_primary_contact_id,
         enrollment_support_contractor_account_id =
           CASE WHEN d.pdc_support_account_id IS NOT NULL
                THEN COALESCE(e.enrollment_support_contractor_account_id, d.pdc_support_account_id)
                ELSE e.enrollment_support_contractor_account_id END,
         enrollment_support_contractor_contact_id =
           CASE WHEN d.pdc_support_account_id IS NOT NULL
                THEN COALESCE(e.enrollment_support_contractor_contact_id, d.pdc_support_contact_id)
                ELSE e.enrollment_support_contractor_contact_id END,
         enrollment_has_support_contractor =
           CASE WHEN d.pdc_support_account_id IS NOT NULL
                THEN COALESCE(e.enrollment_has_support_contractor, true)
                ELSE e.enrollment_has_support_contractor END
    FROM public.program_default_contractors d
   WHERE d.pdc_object = 'enrollments'
     AND d.pdc_record_type = e.enrollment_record_type
     AND d.pdc_is_active AND d.pdc_is_deleted IS NOT TRUE
     AND e.enrollment_is_deleted IS NOT TRUE
     AND e.enrollment_contractor_account_id IS DISTINCT FROM d.pdc_primary_account_id
     AND (e.enrollment_contractor_account_id IS NULL
          OR e.enrollment_contractor_account_id = v_ees);
  GET DIAGNOSTICS v_enr = ROW_COUNT;

  UPDATE public.incentive_applications ia
     SET ia_contractor_account_id = d.pdc_primary_account_id,
         ia_contractor_contact_id = d.pdc_primary_contact_id,
         ia_support_contractor_account_id =
           COALESCE(ia.ia_support_contractor_account_id, d.pdc_support_account_id),
         ia_support_contractor_contact_id =
           COALESCE(ia.ia_support_contractor_contact_id, d.pdc_support_contact_id),
         ia_has_support_contractor = COALESCE(ia.ia_has_support_contractor, true)
    FROM public.program_default_contractors d
   WHERE d.pdc_object = 'incentive_applications'
     AND d.pdc_record_type = ia.ia_record_type
     AND d.pdc_is_active AND d.pdc_is_deleted IS NOT TRUE
     AND ia.ia_is_deleted IS NOT TRUE
     AND ia.ia_contractor_account_id IS DISTINCT FROM d.pdc_primary_account_id
     AND (ia.ia_contractor_account_id IS NULL
          OR ia.ia_contractor_account_id = v_ees);
  GET DIAGNOSTICS v_ia = ROW_COUNT;

  -- The condition this migration exists to end: nothing on a governed
  -- programme may still name the support contractor as its primary.
  SELECT count(*) INTO v_after
  FROM public.enrollments e
  JOIN public.program_default_contractors d
    ON d.pdc_object='enrollments' AND d.pdc_record_type = e.enrollment_record_type
   AND d.pdc_is_deleted IS NOT TRUE
  WHERE e.enrollment_is_deleted IS NOT TRUE
    AND e.enrollment_contractor_account_id = COALESCE(d.pdc_support_account_id, v_ees);
  IF v_after > 0 THEN
    RAISE EXCEPTION '% enrollments still name the support contractor as primary', v_after;
  END IF;

  -- And nothing may name one company on both sides.
  IF EXISTS (SELECT 1 FROM public.enrollments e
              WHERE e.enrollment_is_deleted IS NOT TRUE
                AND e.enrollment_support_contractor_account_id IS NOT NULL
                AND e.enrollment_support_contractor_account_id = e.enrollment_contractor_account_id)
     OR EXISTS (SELECT 1 FROM public.incentive_applications ia
                 WHERE ia.ia_is_deleted IS NOT TRUE
                   AND ia.ia_support_contractor_account_id IS NOT NULL
                   AND ia.ia_support_contractor_account_id = ia.ia_contractor_account_id)
  THEN
    RAISE EXCEPTION 'a record still names one company as both its primary and its support contractor';
  END IF;

  RAISE NOTICE 'corrected % enrollments and % incentive applications', v_enr, v_ia;
END $$;
