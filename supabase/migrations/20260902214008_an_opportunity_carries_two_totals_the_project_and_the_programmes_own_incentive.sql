-- One opportunity, two totals, and which one you want depends on what you are
-- producing.
--
-- OPP-00198 is the worked example (Nicholas, 2026-09-02): $40,000 of IRA HOMES
-- rebate plus $2,910.60 of Focus on Energy insulation and air sealing rebate.
-- The PROPOSAL must show both -- the Focus money is an instant discount the
-- customer sees come off their price, and the proposal already prints it under
-- OTHER NON-IRA REBATES. The IRA SUBMISSION must carry $40,000 and nothing
-- else: "We can't charge the IRA for the focus stuff."
--
--   opportunity_amount                  $42,910.60  the whole project
--   the programme's own incentive       $40,000.00  what goes to IRA
--
-- WHAT WAS MISSING. Nothing anywhere recorded which line is the opportunity's
-- OWN programme money and which is another programme's. The document engine
-- knows the distinction (it prints that NON-IRA heading) but derives it from
-- Asset Score arithmetic, not from the records -- so the two can disagree and
-- nothing would catch it. And matching on product NAME ("HOMES Project ..."
-- versus "Focus on Energy ...") is the one thing that must not be done: it
-- breaks silently the first time somebody renames a product.
--
-- So the fact becomes configuration: for each opportunity record type, which
-- products are that programme's own incentive lines. A product not registered
-- for the opportunity's record type still counts toward the project total --
-- it is real money on the project -- it just never reaches the programme's
-- submission.

CREATE SEQUENCE IF NOT EXISTS public.program_incentive_product_seq;

CREATE TABLE IF NOT EXISTS public.program_incentive_products (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_record_number           text NOT NULL DEFAULT '',
  pip_opportunity_record_type uuid NOT NULL REFERENCES public.picklist_values(id),
  pip_product_id              uuid NOT NULL REFERENCES public.products(id),
  pip_notes                   text,
  pip_is_active               boolean NOT NULL DEFAULT true,
  pip_owner                   uuid REFERENCES public.users(id),
  pip_is_deleted              boolean NOT NULL DEFAULT false,
  pip_deleted_at              timestamptz,
  pip_deleted_by              uuid REFERENCES public.users(id),
  pip_deletion_reason         text,
  is_seed_data                boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS program_incentive_products_unique_live
  ON public.program_incentive_products (pip_opportunity_record_type, pip_product_id)
  WHERE pip_is_deleted IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.set_pip_record_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog' AS $function$
BEGIN
  IF NEW.pip_record_number IS NULL OR NEW.pip_record_number = '' THEN
    NEW.pip_record_number := public.generate_record_number('PIP-', 'program_incentive_product_seq');
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.set_pip_record_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pip_record_number ON public.program_incentive_products;
CREATE TRIGGER trg_pip_record_number BEFORE INSERT ON public.program_incentive_products
  FOR EACH ROW EXECUTE FUNCTION public.set_pip_record_number();

DROP TRIGGER IF EXISTS trg_pip_block_hard_delete ON public.program_incentive_products;
CREATE TRIGGER trg_pip_block_hard_delete BEFORE DELETE ON public.program_incentive_products
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

SELECT public.install_record_audit_stamping('program_incentive_products');

ALTER TABLE public.program_incentive_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pip_read  ON public.program_incentive_products;
DROP POLICY IF EXISTS pip_write ON public.program_incentive_products;
CREATE POLICY pip_read  ON public.program_incentive_products
  FOR SELECT USING (public.current_app_user_id() IS NOT NULL);
CREATE POLICY pip_write ON public.program_incentive_products
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_incentive_products TO authenticated;

INSERT INTO public.record_state_scope_sources
  (rsss_record_number, rsss_object_name, rsss_resolution_kind, rsss_path_order, rsss_is_active, rsss_notes)
SELECT '', 'program_incentive_products', 'platform_configuration', 1, true,
       'Programme reference data: which products are a programme''s own incentive lines, so an opportunity''s project total and its programme submission total can differ. Carries no customer or property information.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
   WHERE rsss_object_name = 'program_incentive_products' AND rsss_is_deleted IS NOT TRUE);

-- The seed. Product names appear here because a person read this list and
-- confirmed it; what is STORED is ids, so a later rename cannot repoint a row.
INSERT INTO public.program_incentive_products
  (pip_record_number, pip_opportunity_record_type, pip_product_id, pip_notes)
SELECT '', rt.id, p.id, s.note
FROM (VALUES
  ('HOMES', 'HOMES Project - 20% to 34% Modeled Savings',
   'The HOMES per-unit rebate at the 20-34% modeled savings tier.'),
  ('HOMES', 'HOMES Project - 35% or Greater Modeled Savings',
   'The HOMES per-unit rebate at the 35%-or-greater modeled savings tier.'),
  ('HEAR',  'ENERGY STAR Electric Heat Pump for Space Heating and Cooling',
   'HEAR equipment rebate.'),
  ('HEAR',  'ENERGY STAR Ventilation', 'HEAR equipment rebate.'),
  ('HEAR',  'Electrical Wiring',       'HEAR electrical rebate.'),
  ('AUDIT', 'Energy Audit',            'The audit programme''s own fee.'),
  ('FOE',   'Focus on Energy - Attic Insulation Incentive (Baseline Below R-11)',
   'Focus on Energy instant discount. Registered against the FOE programme only -- on an IRA opportunity it counts toward the project total and never toward the IRA submission.'),
  ('FOE',   'Focus on Energy - Attic Insulation Incentive (Baseline R-12 to R-19)',
   'Focus on Energy instant discount. Registered against the FOE programme only.'),
  ('FOE',   'Focus on Energy - Attic Insulation Incentive (Baseline R-20 to R-38)',
   'Focus on Energy instant discount. Registered against the FOE programme only.')
) AS s(family, product_name, note)
JOIN public.products p
  ON p.product_name = s.product_name AND p.product_is_deleted IS NOT TRUE
JOIN public.picklist_values rt
  ON rt.picklist_object = 'opportunities' AND rt.picklist_field = 'record_type'
 AND CASE s.family
       WHEN 'HOMES' THEN rt.picklist_value LIKE '%-HOMES'
       WHEN 'HEAR'  THEN rt.picklist_value LIKE '%-HEAR'
       WHEN 'AUDIT' THEN rt.picklist_value LIKE '%-HOMES-AUDIT'
       WHEN 'FOE'   THEN rt.picklist_value LIKE 'WI-FOE-%'
     END
WHERE NOT EXISTS (
  SELECT 1 FROM public.program_incentive_products x
   WHERE x.pip_opportunity_record_type = rt.id AND x.pip_product_id = p.id
     AND x.pip_is_deleted IS NOT TRUE);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.program_incentive_products WHERE pip_is_deleted IS NOT TRUE;
  IF n = 0 THEN RAISE EXCEPTION 'no incentive products registered -- the seed matched nothing'; END IF;
  -- The rule that makes OPP-00198 come out right: a Focus on Energy product is
  -- NOT an IRA HOMES incentive line.
  IF EXISTS (
    SELECT 1 FROM public.program_incentive_products x
    JOIN public.products p ON p.id = x.pip_product_id
    JOIN public.picklist_values rt ON rt.id = x.pip_opportunity_record_type
    WHERE x.pip_is_deleted IS NOT TRUE
      AND p.product_name LIKE 'Focus on Energy%' AND rt.picklist_value LIKE '%IRA%')
  THEN
    RAISE EXCEPTION 'a Focus on Energy product was registered as an IRA incentive line';
  END IF;
  RAISE NOTICE 'registered % programme incentive product rows', n;
END $$;
