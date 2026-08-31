-- Correction of the migration applied minutes earlier in this session.
--
-- product_work_completed_measures was a SECOND product -> measure map. LEAP
-- already had one: product_work_measure_map, read by
-- derive_reservation_work_measures, which is how the reservation enrollment's
-- "What work will be completed?" is pre-populated from the same line items.
-- Two maps means a new product must be wired up twice and the two answers
-- drift; the duplicate is removed rather than kept.
--
-- What is genuinely different is the VOCABULARY, not the product mapping. The
-- reservation offers 34 measure options and the payment request 23, and where
-- they name the same work they often name it differently -- the reservation's
-- "ENERGY STAR Heat Pump Water Heater" is the payment request's "ENERGY STAR
-- Water Heater", its "ENERGY STAR Mechanical Ventilation" is "Ventilation
-- System". So the one thing worth adding is the translation between the two
-- lists, and the derivation becomes:
--
--   opportunity line items -> product_work_measure_map (existing)
--     -> work_measure_work_completed_map (new) -> the payment request's options
--
-- Identity rows are seeded FROM THE TWO LAYOUTS rather than typed out, so a
-- measure both forms already spell the same way needs no maintenance and
-- cannot be mistyped. Only genuine renames are listed by hand.
--
-- Reusing the existing map also made the derivation MORE correct, which is the
-- sign it was the right structure: that map records Attic Insulation and the
-- Focus On Energy attic incentives as evidencing Air Sealing as well as
-- Ceiling Insulation, so OPP-00066 -- whose line items are incentive-style --
-- now reproduces all three measures a person recorded by hand on IA-00013,
-- where the duplicate map produced only two.

DROP FUNCTION IF EXISTS public.ia_work_completed_from_opportunity(uuid);
DROP TABLE IF EXISTS public.product_work_completed_measures;
DROP FUNCTION IF EXISTS public.set_pwcm_record_number();
DROP SEQUENCE IF EXISTS public.product_work_completed_measure_seq;

UPDATE public.record_state_scope_sources
SET rsss_is_deleted = true, rsss_deleted_at = now(),
    rsss_deletion_reason = 'Duplicate of product_work_measure_map; removed in the same session it was created.'
WHERE rsss_object_name = 'product_work_completed_measures'
  AND rsss_is_deleted IS NOT TRUE;

CREATE SEQUENCE IF NOT EXISTS public.work_measure_work_completed_map_seq;

CREATE TABLE IF NOT EXISTS public.work_measure_work_completed_map (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wmwc_record_number        text NOT NULL DEFAULT '',
  wmwc_work_measure         text NOT NULL,
  wmwc_work_completed_value text NOT NULL,
  wmwc_notes                text,
  wmwc_is_active            boolean NOT NULL DEFAULT true,
  wmwc_owner                uuid REFERENCES public.users(id),
  wmwc_is_deleted           boolean NOT NULL DEFAULT false,
  wmwc_deleted_at           timestamptz,
  wmwc_deleted_by           uuid REFERENCES public.users(id),
  wmwc_deletion_reason      text,
  is_seed_data              boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS work_measure_work_completed_map_unique_live
  ON public.work_measure_work_completed_map (wmwc_work_measure, wmwc_work_completed_value)
  WHERE wmwc_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.set_wmwc_record_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog' AS $function$
BEGIN
  IF NEW.wmwc_record_number IS NULL OR NEW.wmwc_record_number = '' THEN
    NEW.wmwc_record_number := public.generate_record_number(
      'WMWC-', 'work_measure_work_completed_map_seq');
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.set_wmwc_record_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wmwc_record_number ON public.work_measure_work_completed_map;
CREATE TRIGGER trg_wmwc_record_number BEFORE INSERT ON public.work_measure_work_completed_map
  FOR EACH ROW EXECUTE FUNCTION public.set_wmwc_record_number();

DROP TRIGGER IF EXISTS trg_wmwc_block_hard_delete ON public.work_measure_work_completed_map;
CREATE TRIGGER trg_wmwc_block_hard_delete BEFORE DELETE ON public.work_measure_work_completed_map
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

SELECT public.install_record_audit_stamping('work_measure_work_completed_map');

ALTER TABLE public.work_measure_work_completed_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wmwc_read  ON public.work_measure_work_completed_map;
DROP POLICY IF EXISTS wmwc_write ON public.work_measure_work_completed_map;
CREATE POLICY wmwc_read  ON public.work_measure_work_completed_map
  FOR SELECT USING (public.current_app_user_id() IS NOT NULL);
CREATE POLICY wmwc_write ON public.work_measure_work_completed_map
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_measure_work_completed_map TO authenticated;

INSERT INTO public.record_state_scope_sources
  (rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_path_order,
   rsss_is_active, rsss_notes)
SELECT '', 'work_measure_work_completed_map', 'platform_configuration', 1, true,
       'Form vocabulary reference data: which payment-request "What work was completed?" option a reservation work measure answers. Carries no customer or property information.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
   WHERE rsss_object_name = 'work_measure_work_completed_map'
     AND rsss_is_deleted IS NOT TRUE);

WITH pr_options AS (
  SELECT DISTINCT o->>'value' AS v
  FROM public.page_layouts pl
  JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f->'options','[]'::jsonb)) o
  WHERE pl.page_layout_object='incentive_applications' AND pl.is_deleted IS NOT TRUE
    AND f->>'name'='ia_work_completed'
), res_options AS (
  SELECT DISTINCT o->>'value' AS v
  FROM public.page_layouts pl
  JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f->'options','[]'::jsonb)) o
  WHERE pl.page_layout_object='enrollments' AND pl.is_deleted IS NOT TRUE
    AND f->>'name'='enrollment_work_measures'
)
INSERT INTO public.work_measure_work_completed_map
  (wmwc_record_number, wmwc_work_measure, wmwc_work_completed_value, wmwc_notes)
SELECT '', r.v, r.v, 'Both forms use this wording.'
FROM res_options r JOIN pr_options p ON p.v = r.v
WHERE NOT EXISTS (
  SELECT 1 FROM public.work_measure_work_completed_map x
   WHERE x.wmwc_work_measure = r.v AND x.wmwc_work_completed_value = r.v
     AND x.wmwc_is_deleted IS NOT TRUE);

INSERT INTO public.work_measure_work_completed_map
  (wmwc_record_number, wmwc_work_measure, wmwc_work_completed_value, wmwc_notes)
SELECT '', m.measure, m.option, m.note
FROM (VALUES
  ('ENERGY STAR Heat Pump Water Heater',   'ENERGY STAR Water Heater',          'Same equipment, different wording on the two forms.'),
  ('ENERGY STAR Mechanical Ventilation',   'Ventilation System',                'Same measure, different wording on the two forms.'),
  ('ENERGY STAR Heat Pump Clothes Dryer',  'ENERGY STAR Appliance Replacement', 'The payment request asks only whether an appliance was replaced.'),
  ('ENERGY STAR Electric Cooking Product', 'ENERGY STAR Appliance Replacement', 'The payment request asks only whether an appliance was replaced.'),
  ('ENERGY STAR Ducted Heat Pump',         'ENERGY STAR Heating Equipment',     'A heat pump answers both equipment questions.'),
  ('ENERGY STAR Ducted Heat Pump',         'ENERGY STAR Cooling Equipment',     'A heat pump answers both equipment questions.'),
  ('ENERGY STAR Ductless Heat Pump',       'ENERGY STAR Heating Equipment',     'A heat pump answers both equipment questions.'),
  ('ENERGY STAR Ductless Heat Pump',       'ENERGY STAR Cooling Equipment',     'A heat pump answers both equipment questions.'),
  ('ENERGY STAR Geothermal Heat Pump',     'ENERGY STAR Heating Equipment',     'A heat pump answers both equipment questions.'),
  ('ENERGY STAR Geothermal Heat Pump',     'ENERGY STAR Cooling Equipment',     'A heat pump answers both equipment questions.'),
  ('Air Sealing & Insulation',             'Air Sealing',                       'Only the air sealing half is unambiguous; the insulation surface is not stated.')
) AS m(measure, option, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.work_measure_work_completed_map x
   WHERE x.wmwc_work_measure = m.measure AND x.wmwc_work_completed_value = m.option
     AND x.wmwc_is_deleted IS NOT TRUE);

-- Electrical Load Center, Electrical Wiring and Foundation Insulation are
-- deliberately unmapped: the payment request offers no equivalent option, and
-- inventing the nearest one would tick a box claiming different work.

CREATE OR REPLACE FUNCTION public.ia_work_completed_from_opportunity(p_opportunity_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_agg(v ORDER BY v) END
  FROM (
    SELECT DISTINCT t.wmwc_work_completed_value AS v
    FROM public.opportunity_line_items oli
    JOIN public.product_work_measure_map m
      ON m.pwmm_product_id = oli.product_id
     AND m.pwmm_is_deleted IS NOT TRUE
    JOIN public.work_measure_work_completed_map t
      ON t.wmwc_work_measure = m.pwmm_work_measure
     AND t.wmwc_is_active
     AND t.wmwc_is_deleted IS NOT TRUE
    WHERE oli.opportunity_id = p_opportunity_id
      AND oli.oli_is_deleted IS NOT TRUE
  ) s;
$function$;

REVOKE ALL ON FUNCTION public.ia_work_completed_from_opportunity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ia_work_completed_from_opportunity(uuid) TO authenticated, service_role;

DO $$
DECLARE
  v_bad text;
  v_opp uuid;
  v_derived jsonb;
BEGIN
  SELECT string_agg(DISTINCT x.wmwc_work_completed_value, ', ') INTO v_bad
  FROM public.work_measure_work_completed_map x
  WHERE x.wmwc_is_deleted IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.page_layouts pl
      JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f->'options','[]'::jsonb)) o
      WHERE pl.page_layout_object='incentive_applications' AND pl.is_deleted IS NOT TRUE
        AND f->>'name'='ia_work_completed' AND o->>'value' = x.wmwc_work_completed_value);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Translations pointing at options the payment request does not offer: %', v_bad;
  END IF;

  IF to_regclass('public.product_work_completed_measures') IS NOT NULL THEN
    RAISE EXCEPTION 'The duplicate product map still exists';
  END IF;

  SELECT id INTO v_opp FROM public.opportunities WHERE opportunity_record_number='OPP-00193';
  v_derived := public.ia_work_completed_from_opportunity(v_opp);
  IF v_derived IS DISTINCT FROM
     (SELECT ia_work_completed FROM public.incentive_applications WHERE ia_record_number='IA-00043') THEN
    RAISE EXCEPTION 'OPP-00193 now derives %, which is not what IA-00043 records', v_derived;
  END IF;
END $$;
