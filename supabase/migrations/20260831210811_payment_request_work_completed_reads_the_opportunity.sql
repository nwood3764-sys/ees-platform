-- "What work was completed?" on the HOMES Project Payment Request is answered
-- from the parent opportunity's own line items, not only from the reservation.
--
-- Reported: the payment request's improvement checkboxes came up blank and had
-- to be ticked by hand, on opportunities whose scope of work is already
-- recorded as line items.
--
-- Cause: build_ia_payment_request_prefill read ONE source -- the
-- WI-IRA-MF-HOMES-Project-Reservation enrollment on the same opportunity --
-- and, worse, returned '{}' outright when no such enrollment existed. So an
-- opportunity with a fully itemised scope but no reservation prefilled
-- NOTHING: not the measures, not the contractor, not even "I'm Applying for a
-- Final Installation Payment Request". Live proof: of the 6 payment requests,
-- 3 carry no work-completed answer at all, and IA-00032's opportunity has no
-- reservation.
--
-- The opportunity is the better source because it is where the scope is sold
-- and revised. The reservation is a point-in-time copy of it.
--
-- Two artifacts, one purpose each:
--
-- 1. product_work_completed_measures (PWCM-) -- which "What work was
--    completed?" option each PRODUCT evidences. Per product, deliberately NOT
--    per product family: the Water Heating family holds both the low-flow
--    aerators (Water Saving Measures) and the heat-pump water heater (ENERGY
--    STAR Water Heater), and the Services family holds the HOMES savings-tier
--    and Focus On Energy incentive lines, which are money, not measures. A
--    family-level map would answer that question wrongly for half the catalog.
--    Admin-managed, so a new product is wired up with no deploy.
--
-- 2. ia_work_completed_from_opportunity(opportunity) -- the derivation.
--
-- The two sources are UNIONED, never overridden. Older opportunities (OPP-00066)
-- carry incentive-style lines and rely on the reservation for measures the
-- line items do not name; newer ones (OPP-00193) carry measure lines and can
-- answer on their own. Taking either as authoritative would lose real answers
-- recorded by the other. Union cannot: it only ever adds.
--
-- A product whose measure is genuinely ambiguous is left UNMAPPED rather than
-- guessed -- Blown Cellulose and Closed-Cell Spray Foam are ceiling OR wall
-- insulation depending on where they went, and this is a form submitted to a
-- programme. An unticked box the preparer ticks is a smaller error than a
-- ticked box claiming work nobody did.

-- ── 1. The mapping ────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.product_work_completed_measure_seq;

CREATE TABLE IF NOT EXISTS public.product_work_completed_measures (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pwcm_record_number          text NOT NULL DEFAULT '',
  product_id                  uuid NOT NULL REFERENCES public.products(id),
  -- The option's stored value, exactly as the payment request layout offers it.
  pwcm_work_completed_value   text NOT NULL,
  pwcm_notes                  text,
  pwcm_is_active              boolean NOT NULL DEFAULT true,
  pwcm_owner                  uuid REFERENCES public.users(id),
  pwcm_is_deleted             boolean NOT NULL DEFAULT false,
  pwcm_deleted_at             timestamptz,
  pwcm_deleted_by             uuid REFERENCES public.users(id),
  pwcm_deletion_reason        text,
  is_seed_data                boolean NOT NULL DEFAULT false
);

-- One statement of a product's measure, not two.
CREATE UNIQUE INDEX IF NOT EXISTS product_work_completed_measures_unique_live
  ON public.product_work_completed_measures (product_id, pwcm_work_completed_value)
  WHERE pwcm_is_deleted IS NOT TRUE;

CREATE INDEX IF NOT EXISTS product_work_completed_measures_product_idx
  ON public.product_work_completed_measures (product_id)
  WHERE pwcm_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.set_pwcm_record_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog' AS $function$
BEGIN
  IF NEW.pwcm_record_number IS NULL OR NEW.pwcm_record_number = '' THEN
    NEW.pwcm_record_number := public.generate_record_number(
      'PWCM', 'product_work_completed_measure_seq');
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.set_pwcm_record_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pwcm_record_number ON public.product_work_completed_measures;
CREATE TRIGGER trg_pwcm_record_number BEFORE INSERT ON public.product_work_completed_measures
  FOR EACH ROW EXECUTE FUNCTION public.set_pwcm_record_number();

DROP TRIGGER IF EXISTS trg_pwcm_block_hard_delete ON public.product_work_completed_measures;
CREATE TRIGGER trg_pwcm_block_hard_delete BEFORE DELETE ON public.product_work_completed_measures
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- Create date / Created by / Last modified date / Last modified by, by the
-- platform rule rather than by hand (2026-08-22).
SELECT public.install_record_audit_stamping('product_work_completed_measures');

ALTER TABLE public.product_work_completed_measures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pwcm_read  ON public.product_work_completed_measures;
DROP POLICY IF EXISTS pwcm_write ON public.product_work_completed_measures;
-- Same shape as record_type_eligibility, the closest existing artifact: every
-- internal user reads the configuration, only an administrator changes it.
CREATE POLICY pwcm_read  ON public.product_work_completed_measures
  FOR SELECT USING (public.current_app_user_id() IS NOT NULL);
CREATE POLICY pwcm_write ON public.product_work_completed_measures
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.product_work_completed_measures TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_work_completed_measures TO authenticated;

-- The product catalog is reference data, so this mapping is too. Registering it
-- keeps record_state_scope_status() at zero unregistered objects (2026-08-23).
INSERT INTO public.record_state_scope_sources
  (rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_path_order,
   rsss_is_active, rsss_notes)
SELECT '', 'product_work_completed_measures', 'platform_configuration', 1, true,
       'Product catalog reference data: which "What work was completed?" option a product evidences. Carries no customer or property information.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
   WHERE rsss_object_name = 'product_work_completed_measures'
     AND rsss_is_deleted IS NOT TRUE);

-- ── 2. The seed ───────────────────────────────────────────────────────────
INSERT INTO public.product_work_completed_measures
  (pwcm_record_number, product_id, pwcm_work_completed_value, pwcm_notes)
SELECT '', p.id, m.measure, m.note
FROM (VALUES
  ('Attic Air Sealing',                                              'Air Sealing',                     'Attic air sealing is the form''s Air Sealing measure.'),
  ('Attic Insulation',                                               'Ceiling Insulation',              'The form calls attic insulation Ceiling Insulation.'),
  -- The three Focus On Energy attic-insulation incentives cannot be claimed
  -- without attic insulation having been installed, so each evidences it.
  ('Focus on Energy - Attic Insulation Incentive (Baseline Below R-11)',  'Ceiling Insulation',          'Incentive line; cannot be claimed without attic insulation.'),
  ('Focus on Energy - Attic Insulation Incentive (Baseline R-12 to R-19)','Ceiling Insulation',          'Incentive line; cannot be claimed without attic insulation.'),
  ('Focus on Energy - Attic Insulation Incentive (Baseline R-20 to R-38)','Ceiling Insulation',          'Incentive line; cannot be claimed without attic insulation.'),
  ('Bathroom Faucet Aerators',                                       'Water Saving Measures',           NULL),
  ('Kitchen Faucet Aerators',                                        'Water Saving Measures',           NULL),
  ('Low-Flow Showerheads',                                           'Water Saving Measures',           NULL),
  ('ENERGY STAR Electric Heat Pump Water Heater',                    'ENERGY STAR Water Heater',        NULL),
  ('Rheem ProTerra 50-gal HPWH',                                     'ENERGY STAR Water Heater',        NULL),
  ('ENERGY STAR Ventilation',                                        'Ventilation System',              NULL),
  ('ENERGY STAR Electric Heat Pump Clothes Dryer',                   'ENERGY STAR Appliance Replacement', NULL),
  ('ENERGY STAR Electric Stove, Cooktop, or Range',                  'ENERGY STAR Appliance Replacement', NULL),
  -- A heat pump answers both equipment questions; the form asks them separately.
  ('ENERGY STAR Electric Heat Pump for Space Heating and Cooling',    'ENERGY STAR Heating Equipment',   'A heat pump is both the heating and the cooling equipment.'),
  ('ENERGY STAR Electric Heat Pump for Space Heating and Cooling',    'ENERGY STAR Cooling Equipment',   'A heat pump is both the heating and the cooling equipment.'),
  ('Mitsubishi MSZ-FH15NA Hyper Heat',                               'ENERGY STAR Heating Equipment',   'A heat pump is both the heating and the cooling equipment.'),
  ('Mitsubishi MSZ-FH15NA Hyper Heat',                               'ENERGY STAR Cooling Equipment',   'A heat pump is both the heating and the cooling equipment.')
) AS m(product_name, measure, note)
JOIN public.products p
  ON p.product_name = m.product_name AND p.product_is_deleted IS NOT TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_work_completed_measures x
   WHERE x.product_id = p.id AND x.pwcm_work_completed_value = m.measure
     AND x.pwcm_is_deleted IS NOT TRUE);

-- Every mapped value must be an option the form actually offers. A typo here
-- would tick nothing and look like the derivation had simply failed.
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(DISTINCT x.pwcm_work_completed_value, ', ') INTO v_bad
  FROM public.product_work_completed_measures x
  WHERE x.pwcm_is_deleted IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.page_layouts pl
      JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f->'options','[]'::jsonb)) o
      WHERE pl.page_layout_object = 'incentive_applications' AND pl.is_deleted IS NOT TRUE
        AND f->>'name' = 'ia_work_completed'
        AND o->>'value' = x.pwcm_work_completed_value);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Mapped work-completed values that the form does not offer: %', v_bad;
  END IF;
END $$;

-- ── 3. The derivation ─────────────────────────────────────────────────────
-- SECURITY INVOKER: the caller sees only line items RLS lets them see, so this
-- cannot become a side door onto another state's scope of work.
CREATE OR REPLACE FUNCTION public.ia_work_completed_from_opportunity(p_opportunity_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE jsonb_agg(v ORDER BY v) END
  FROM (
    SELECT DISTINCT m.pwcm_work_completed_value AS v
    FROM public.opportunity_line_items oli
    JOIN public.product_work_completed_measures m
      ON m.product_id = oli.product_id
     AND m.pwcm_is_active
     AND m.pwcm_is_deleted IS NOT TRUE
    WHERE oli.opportunity_id = p_opportunity_id
      AND oli.oli_is_deleted IS NOT TRUE
  ) s;
$function$;

REVOKE ALL ON FUNCTION public.ia_work_completed_from_opportunity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ia_work_completed_from_opportunity(uuid) TO authenticated, service_role;

-- ── 4. The prefill ────────────────────────────────────────────────────────
-- Changes from the previous version, and nothing else:
--   * the opportunity's own facts are returned even when NO reservation
--     enrollment exists (it used to return '{}' and prefill nothing at all);
--   * ia_work_completed is the UNION of the opportunity's line items and the
--     reservation's recorded measures.
CREATE OR REPLACE FUNCTION public.build_ia_payment_request_prefill(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  e          public.enrollments%ROWTYPE;
  o          public.opportunities%ROWTYPE;
  v_from_opp jsonb;
  v_measures jsonb;
BEGIN
  IF p_opportunity_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  SELECT op.* INTO o
  FROM public.opportunities op
  WHERE op.id = p_opportunity_id
    AND op.opportunity_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  -- The reservation is optional now. When it is there it still supplies
  -- everything it always did.
  SELECT en.* INTO e
  FROM public.enrollments en
  JOIN public.picklist_values rt ON rt.id = en.enrollment_record_type
  WHERE en.opportunity_id = p_opportunity_id
    AND en.enrollment_is_deleted IS NOT TRUE
    AND rt.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation'
  ORDER BY en.enrollment_updated_at DESC NULLS LAST
  LIMIT 1;

  -- Union, so neither source can erase what the other knows: an older
  -- opportunity's measures live only on its reservation, a newer one's live
  -- only on its line items.
  v_from_opp := public.ia_work_completed_from_opportunity(p_opportunity_id);
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_agg(v ORDER BY v) END
    INTO v_measures
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(v_from_opp, '[]'::jsonb)) AS v
    UNION
    SELECT jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(COALESCE(e.enrollment_work_measures, 'null'::jsonb)) = 'array'
                  THEN e.enrollment_work_measures ELSE '[]'::jsonb END)
  ) s;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    -- From the opportunity, so a payment request created where no reservation
    -- exists still lands on the right parents.
    'opportunity_id', o.id,
    'property_id',    COALESCE(e.property_id, o.property_id),
    'building_id',    COALESCE(e.building_id, o.building_id),
    'ia_work_completed', v_measures,
    'ia_application_for', (
      SELECT id FROM public.picklist_values
      WHERE picklist_object='incentive_applications' AND picklist_field='application_for'
        AND picklist_value='Final Installation Payment Request' AND picklist_is_active LIMIT 1),
    -- From the reservation, unchanged. All NULL when there is no reservation,
    -- and stripped out rather than written as blanks.
    'ia_contractor_account_id',         e.enrollment_contractor_account_id,
    'ia_contractor_contact_id',         e.enrollment_contractor_contact_id,
    'ia_has_support_contractor',        e.enrollment_has_support_contractor,
    'ia_support_contractor_account_id', e.enrollment_support_contractor_account_id,
    'ia_support_contractor_contact_id', e.enrollment_support_contractor_contact_id,
    'ia_submitted_by',                  e.enrollment_submitted_by,
    'ia_total_project_cost',            e.enrollment_total_project_cost,
    'ia_building_type',         public.picklist_value_translate(e.enrollment_building_type,         'incentive_applications','building_type'),
    'ia_building_project_type', public.picklist_value_translate(e.enrollment_building_project_type, 'incentive_applications','building_project_type'),
    'ia_income_level',          public.picklist_value_translate(e.enrollment_income_level,          'incentive_applications','income_level'),
    'ia_heating_type',          public.picklist_value_translate(e.enrollment_heating_type,          'incentive_applications','heating_type'),
    'ia_who_gets_paid',         public.picklist_value_translate(e.enrollment_payee,                 'incentive_applications','who_gets_paid'),
    'ia_tax_classification_type', public.picklist_value_translate(e.enrollment_tax_classification,  'incentive_applications','tax_classification_type'),
    'ia_modeling_software',     public.picklist_value_translate(e.enrollment_modeling_software,     'incentive_applications','modeling_software')
  ));
END $function$;

REVOKE ALL ON FUNCTION public.build_ia_payment_request_prefill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_ia_payment_request_prefill(uuid) TO authenticated, service_role;

-- ── 5. Proof against the live records ─────────────────────────────────────
DO $$
DECLARE
  v_opp     uuid;
  v_derived jsonb;
  v_actual  jsonb;
BEGIN
  -- OPP-00193's line items must reproduce, unaided, the answer a person
  -- already recorded on IA-00043. If the mapping were wrong this is where it
  -- shows.
  SELECT id INTO v_opp FROM public.opportunities WHERE opportunity_record_number = 'OPP-00193';
  v_derived := public.ia_work_completed_from_opportunity(v_opp);
  SELECT ia_work_completed INTO v_actual
    FROM public.incentive_applications WHERE ia_record_number = 'IA-00043';

  IF v_derived IS DISTINCT FROM v_actual THEN
    RAISE EXCEPTION 'OPP-00193 derives % but IA-00043 records %', v_derived, v_actual;
  END IF;

  -- And the prefill must now answer at all where there is no reservation.
  SELECT id INTO v_opp FROM public.opportunities WHERE opportunity_record_number = 'OPP-00186';
  IF public.build_ia_payment_request_prefill(v_opp) ->> 'ia_application_for' IS NULL THEN
    RAISE EXCEPTION 'Prefill still returns nothing for an opportunity with no reservation enrollment';
  END IF;
END $$;
