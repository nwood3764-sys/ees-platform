-- "Permission to share energy data with the State and DOE for evaluation
-- purposes" defaults to Yes on every IRA enrollment (Nicholas). Fill-blank: the
-- value stays editable, but a new IRA enrollment is created Yes and every
-- existing blank IRA enrollment is set Yes. The Yes option is resolved by value,
-- so no uuid is hardcoded. Scoped to any enrollment record type whose value
-- contains "IRA" (HOMES, HEAR, MF — all of them). SECURITY INVOKER (fills a
-- value, calls no definer function) — adds no advisor lint.
--
-- Already applied to prod via the Supabase MCP; this file mirrors it for branch
-- replays. The backfill only touches rows that are still blank, so replaying it
-- is safe.

CREATE OR REPLACE FUNCTION public.set_enrollment_energy_data_sharing_default()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_catalog' AS $fn$
DECLARE v_rt text; v_yes uuid;
BEGIN
  IF NEW.enrollment_energy_data_sharing_permission IS NOT NULL THEN RETURN NEW; END IF;
  SELECT picklist_value INTO v_rt FROM public.picklist_values WHERE id = NEW.enrollment_record_type;
  IF v_rt IS NULL OR v_rt NOT ILIKE '%IRA%' THEN RETURN NEW; END IF;
  SELECT id INTO v_yes FROM public.picklist_values
    WHERE picklist_object='enrollments' AND picklist_field='energy_data_sharing_permission'
      AND picklist_value='Yes' LIMIT 1;
  NEW.enrollment_energy_data_sharing_permission := v_yes;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_0_enrollment_energy_data_sharing_default ON public.enrollments;
CREATE TRIGGER trg_0_enrollment_energy_data_sharing_default
  BEFORE INSERT ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_enrollment_energy_data_sharing_default();

UPDATE public.enrollments e
   SET enrollment_energy_data_sharing_permission =
        (SELECT id FROM public.picklist_values
          WHERE picklist_object='enrollments' AND picklist_field='energy_data_sharing_permission'
            AND picklist_value='Yes' LIMIT 1)
 WHERE e.enrollment_energy_data_sharing_permission IS NULL
   AND EXISTS (SELECT 1 FROM public.picklist_values rt
                WHERE rt.id = e.enrollment_record_type AND rt.picklist_value ILIKE '%IRA%');
