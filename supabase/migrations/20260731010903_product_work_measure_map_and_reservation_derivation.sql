-- Data-driven map: opportunity line-item product -> reservation work measure(s).
-- One product can imply several measures (e.g. attic insulation work includes
-- air sealing), so it's a many-to-many junction, admin-manageable — never
-- hardcoded in app logic. Feeds the reservation "What work will be completed?"
-- multiselect from the opportunity's line items.
CREATE TABLE IF NOT EXISTS public.product_work_measure_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pwmm_product_id uuid NOT NULL REFERENCES public.products(id),
  pwmm_work_measure text NOT NULL,
  pwmm_created_at timestamptz NOT NULL DEFAULT now(),
  pwmm_updated_at timestamptz NOT NULL DEFAULT now(),
  pwmm_created_by uuid,
  pwmm_updated_by uuid,
  pwmm_is_deleted boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE public.product_work_measure_map IS 'Maps an opportunity line-item product to one or more reservation work measures (enrollments.work_measures options). Admin-manageable; feeds reservation work-measure pre-population.';
CREATE UNIQUE INDEX IF NOT EXISTS product_work_measure_map_active_uniq
  ON public.product_work_measure_map (pwmm_product_id, pwmm_work_measure)
  WHERE pwmm_is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS product_work_measure_map_product_idx
  ON public.product_work_measure_map (pwmm_product_id) WHERE pwmm_is_deleted IS NOT TRUE;

ALTER TABLE public.product_work_measure_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_select_product_work_measure_map ON public.product_work_measure_map
  FOR SELECT TO authenticated USING (true);
CREATE POLICY app_insert_product_work_measure_map ON public.product_work_measure_map
  FOR INSERT TO authenticated WITH CHECK ((SELECT app_user_can('product_work_measure_map','create')));
CREATE POLICY app_update_product_work_measure_map ON public.product_work_measure_map
  FOR UPDATE TO authenticated USING ((SELECT app_user_can('product_work_measure_map','update')))
  WITH CHECK ((SELECT app_user_can('product_work_measure_map','update')));
CREATE POLICY app_delete_product_work_measure_map ON public.product_work_measure_map
  FOR DELETE TO authenticated USING ((SELECT app_user_can('product_work_measure_map','delete')));

-- Seed the current mappings by product_code (interpretation baked as data):
--  - Attic insulation (FOE incentives + measure) -> Ceiling Insulation + Air Sealing
--    (attic insulation work always includes attic-floor air sealing)
--  - Attic air sealing measure -> Air Sealing
--  - Faucet aerators + low-flow showerheads -> Water Saving Measures
INSERT INTO public.product_work_measure_map (pwmm_product_id, pwmm_work_measure)
SELECT p.id, m.measure
FROM products p
JOIN (VALUES
  ('FOE-ATTIC-LT-R11','Ceiling Insulation'), ('FOE-ATTIC-LT-R11','Air Sealing'),
  ('FOE-ATTIC-R12-19','Ceiling Insulation'), ('FOE-ATTIC-R12-19','Air Sealing'),
  ('FOE-ATTIC-R20-38','Ceiling Insulation'), ('FOE-ATTIC-R20-38','Air Sealing'),
  ('MEAS-ATTIC-INS','Ceiling Insulation'),   ('MEAS-ATTIC-INS','Air Sealing'),
  ('MEAS-ATTIC-AS','Air Sealing'),
  ('MEAS-AER-BATH','Water Saving Measures'),
  ('MEAS-AER-KITCHEN','Water Saving Measures'),
  ('MEAS-SHOWERHEAD','Water Saving Measures')
) AS m(code, measure) ON m.code = p.product_code
WHERE p.product_is_deleted IS NOT TRUE
ON CONFLICT DO NOTHING;

-- Derive the distinct work measures for an opportunity from its line items.
CREATE OR REPLACE FUNCTION public.derive_reservation_work_measures(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT COALESCE(jsonb_agg(DISTINCT m.pwmm_work_measure ORDER BY m.pwmm_work_measure), '[]'::jsonb)
  FROM opportunity_line_items oli
  JOIN product_work_measure_map m
    ON m.pwmm_product_id = oli.product_id AND m.pwmm_is_deleted IS NOT TRUE
  WHERE oli.opportunity_id = p_opportunity_id AND oli.oli_is_deleted IS NOT TRUE;
$fn$;
REVOKE ALL ON FUNCTION public.derive_reservation_work_measures(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.derive_reservation_work_measures(uuid) TO authenticated;

-- Reservation defaults: also fill the work-measure multiselect from the
-- opportunity's line items when it's still blank (fill-if-empty; a user's own
-- selection is never overwritten).
CREATE OR REPLACE FUNCTION public.set_enrollment_reservation_defaults()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE v_rt text; v_code text; v_measures jsonb;
BEGIN
  SELECT picklist_value INTO v_rt FROM picklist_values WHERE id = NEW.enrollment_record_type;
  IF v_rt IS NULL OR v_rt NOT ILIKE '%Project-Reservation%' THEN RETURN NEW; END IF;

  IF NEW.enrollment_application_for IS NULL THEN
    NEW.enrollment_application_for := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='application_for' AND picklist_value='Project Reservation' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_building_type IS NULL THEN
    NEW.enrollment_building_type := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='building_type' AND picklist_value='Existing' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_building_project_type IS NULL THEN
    NEW.enrollment_building_project_type := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='building_project_type' AND picklist_value='Multifamily - Central 5 Units' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_contractor_account_id IS NULL THEN
    NEW.enrollment_contractor_account_id := (SELECT id FROM accounts WHERE account_is_deleted IS NOT TRUE AND account_name='Energy Efficiency Services of Wisconsin' LIMIT 1);
  END IF;
  IF NEW.enrollment_has_support_contractor IS NULL THEN NEW.enrollment_has_support_contractor := false; END IF;
  IF NEW.enrollment_payee IS NULL THEN
    NEW.enrollment_payee := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='payee' AND picklist_value='Registered Contractor' AND picklist_is_active LIMIT 1);
  END IF;
  IF NEW.enrollment_tax_classification IS NULL THEN
    NEW.enrollment_tax_classification := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='tax_classification' AND picklist_value='S Corporation' AND picklist_is_active LIMIT 1);
  END IF;

  IF NEW.enrollment_signer_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    NEW.enrollment_signer_contact_id := (SELECT opportunity_authorized_signer_id FROM opportunities WHERE id = NEW.opportunity_id);
  END IF;
  IF NEW.enrollment_contractor_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    NEW.enrollment_contractor_contact_id := (
      SELECT ocr.contact_id FROM opportunity_contact_roles ocr
      JOIN picklist_values pv ON pv.id = ocr.ocr_role
      WHERE ocr.opportunity_id = NEW.opportunity_id AND ocr.ocr_is_deleted IS NOT TRUE
        AND pv.picklist_value = 'Contractor Primary Contact'
      ORDER BY ocr.ocr_is_primary DESC NULLS LAST, ocr.ocr_created_at ASC LIMIT 1);
  END IF;

  IF (NEW.enrollment_work_measures IS NULL OR NEW.enrollment_work_measures = '[]'::jsonb)
     AND NEW.opportunity_id IS NOT NULL THEN
    SELECT jsonb_agg(DISTINCT m.pwmm_work_measure ORDER BY m.pwmm_work_measure)
      INTO v_measures
      FROM opportunity_line_items oli
      JOIN product_work_measure_map m
        ON m.pwmm_product_id = oli.product_id AND m.pwmm_is_deleted IS NOT TRUE
     WHERE oli.opportunity_id = NEW.opportunity_id AND oli.oli_is_deleted IS NOT TRUE;
    IF v_measures IS NOT NULL AND jsonb_array_length(v_measures) > 0 THEN
      NEW.enrollment_work_measures := v_measures;
    END IF;
  END IF;

  IF NEW.building_id IS NOT NULL THEN
    SELECT ira_confirmation_code_lea INTO v_code FROM buildings WHERE id = NEW.building_id;
    IF NEW.enrollment_income_level IS NULL AND v_code IS NOT NULL THEN
      IF v_code ILIKE 'LEA%' THEN
        NEW.enrollment_income_level := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='income_level' AND picklist_value='Low-Income' AND picklist_is_active LIMIT 1);
      ELSIF v_code ILIKE 'MEA%' THEN
        NEW.enrollment_income_level := (SELECT id FROM picklist_values WHERE picklist_object='enrollments' AND picklist_field='income_level' AND picklist_value='Moderate' AND picklist_is_active LIMIT 1);
      END IF;
    END IF;
    IF NEW.enrollment_occupied_units IS NULL THEN
      NEW.enrollment_occupied_units := (SELECT building_total_units FROM buildings WHERE id = NEW.building_id);
    END IF;
  END IF;
  RETURN NEW;
END; $fn$;

NOTIFY pgrst, 'reload schema';
