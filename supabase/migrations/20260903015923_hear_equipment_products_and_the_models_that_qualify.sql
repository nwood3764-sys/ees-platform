-- HEAR equipment products, and which models qualify for which measure.
--
-- Nicholas, on where the fan model number for the Quality Installation
-- Supplemental Data Sheet comes from: "Yes, I think we should have the specific
-- product record because I do want to include the submittal sheets, the Energy
-- Star certification, and all that. That's going to live on the product
-- record." Then, on scope: "we're really only doing fans, heat pumps, and
-- furnaces. That's it."
--
-- ── The two tiers were already in the data, unnamed ───────────────────────
--
-- LEAP's product catalogue has carried two different kinds of row since it was
-- seeded, and nothing said so:
--
--   Tier 1, the INCENTIVE MEASURE — 26 rows on the PRODUCT record type with
--   codes like HEAR-VENT, HEAR-HPWH, MEAS-ATTIC-INS. No manufacturer, no model
--   number, no specifications. This is what the programme PAYS FOR. It is what
--   goes on the opportunity line item and what product_work_measure_map maps to
--   a work measure.
--
--   Tier 2, the REAL EQUIPMENT — 2 rows already on a HEAT-PUMP-EQUIPMENT record
--   type (PRD-00001 Mitsubishi MSZ-FH15NA, PRD-00002 Rheem ProTerra), carrying
--   product_manufacturer and product_model_number. The table has carried
--   product_ahri_certificate_number, product_energy_star_v6_1 and the whole
--   submittal/specification/manual block all along.
--
-- What was missing is the LINK. Nothing said "the Panasonic FV-0511VF1 is an
-- approved model for the ENERGY STAR Ventilation measure", and nothing said
-- which model a given job is actually installing. So the supplemental data
-- sheet — whose entire purpose is to report model numbers to the programme
-- administrator — had no model number to report.
--
-- ── Why a new junction and not product_assemblies ─────────────────────────
--
-- product_assemblies already relates a product to other products
-- (product_package_id -> assembly_product_id, with pa_quantity and
-- pa_product_role). It was built for KITS: a package whose bill of materials is
-- its components. "Which models are approved for this rebate" is not a bill of
-- materials — the measure is not made of the fan, and a fan qualifying for two
-- programmes is not a component of both. Bending the assembly table to carry
-- eligibility is precisely the reuse-across-purposes this repo forbids, and it
-- would put two unrelated meanings behind one pa_product_role string.
--
-- So: product_qualifying_equipment (PQE-), purpose-named, its own definition.
--
-- ── Why record types per category, and only three ─────────────────────────
--
-- HEAT-PUMP-EQUIPMENT already exists and is reused, not renamed — renaming a
-- record type two live products already carry would rewrite history for no
-- gain. VENTILATION-EQUIPMENT and FURNACE-EQUIPMENT join it. That is exactly
-- the three categories named, and no more: appliances, water heaters and
-- electrical work get a record type when someone actually installs one, because
-- a record type nobody has a product for is a page layout nobody maintains.

BEGIN;

-- ── 1. The two new equipment record types ─────────────────────────────────
--
-- Sort order continues from the existing product record types rather than
-- restarting, so the picker reads in a deliberate order.
INSERT INTO public.picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_is_active, picklist_sort_order, picklist_description
)
SELECT v.value, v.field, v.val, v.label, true, v.sort_order, v.descr
FROM (VALUES
  ('products', 'record_type', 'VENTILATION-EQUIPMENT', 'Ventilation Equipment', 30,
   'A real, installable ventilation product — an exhaust or supply fan — carrying its manufacturer, model number and supporting documentation. Not an incentive measure; see the PRODUCT record type for what the programme pays for.'),
  ('products', 'record_type', 'FURNACE-EQUIPMENT', 'Furnace Equipment', 40,
   'A real, installable furnace carrying its manufacturer, model number and supporting documentation. Not an incentive measure; see the PRODUCT record type for what the programme pays for.')
) AS v(value, field, val, label, sort_order, descr)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object = 'products' AND p.picklist_field = 'record_type'
    AND p.picklist_value = v.val
);

-- ── 2. Which measures demand an equipment selection ───────────────────────
--
-- A DATA flag, not a list in code. The supplemental data sheet reports a model
-- number, so a measure that installs a discrete piece of equipment must name
-- one; a measure that does not (attic insulation, air sealing, electrical
-- wiring, a service panel) has no model number to report and must never be made
-- to invent one. Turning the requirement on for a new measure is a checkbox in
-- Object Manager from here, never a migration.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_requires_equipment_selection boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.product_requires_equipment_selection IS
  'When true, an opportunity line item carrying this incentive measure must also name the specific equipment product being installed (opportunity_line_items.oli_equipment_product_id). Set on measures that install a discrete, model-numbered device — the Quality Installation Supplemental Data Sheet reports that model to the programme administrator. Never set on a measure with no equipment (insulation, air sealing, wiring, a service panel).';

-- Fans and heat pumps: the two categories with live line items today. Furnaces
-- get the flag with their first product. Deliberately NOT flagged: HEAR-WIRING
-- and HEAR-PANEL (electrical work, no model number on the sheet), HEAR-DRYER
-- and HEAR-STOVE (appliances, outside the stated scope).
UPDATE public.products
   SET product_requires_equipment_selection = true
 WHERE product_code IN ('HEAR-VENT', 'HEAR-HP-SPACE-HEAT-COOL')
   AND product_is_deleted IS NOT TRUE;

-- ── 3. product_qualifying_equipment (PQE-) — the approved models ──────────
CREATE TABLE IF NOT EXISTS public.product_qualifying_equipment (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pqe_record_number         text        NOT NULL,
  pqe_measure_product_id    uuid        NOT NULL REFERENCES public.products(id),
  pqe_equipment_product_id  uuid        NOT NULL REFERENCES public.products(id),
  pqe_notes                 text,
  pqe_is_active             boolean     NOT NULL DEFAULT true,
  pqe_owner                 uuid        NOT NULL REFERENCES public.users(id),
  pqe_created_by            uuid,
  pqe_created_at            timestamptz NOT NULL DEFAULT now(),
  pqe_updated_by            uuid,
  pqe_updated_at            timestamptz,
  pqe_is_deleted            boolean     NOT NULL DEFAULT false,
  pqe_deleted_at            timestamptz,
  pqe_deleted_by            uuid,
  pqe_deletion_reason       text,
  is_seed_data              boolean     NOT NULL DEFAULT false,
  -- A measure is never its own qualifying equipment. Without this, one careless
  -- pick makes "ENERGY STAR Ventilation" its own model number and the sheet
  -- reports a rebate name where the administrator expects a fan.
  CONSTRAINT pqe_measure_is_not_its_own_equipment_ck
    CHECK (pqe_measure_product_id <> pqe_equipment_product_id)
);

COMMENT ON TABLE public.product_qualifying_equipment IS
  'Which real equipment products qualify for which incentive measure product. Many-to-many on purpose: a measure approves many models, and one model can qualify under more than one programme. Scopes the equipment picker on an opportunity line item. NOT a bill of materials — that is product_assemblies, which was built for kits and must not be reused for eligibility.';

-- One live link per (measure, equipment) pair. Partial, so a soft-deleted link
-- never blocks re-approving a model that was withdrawn and reinstated.
CREATE UNIQUE INDEX IF NOT EXISTS pqe_unique_live_pair
  ON public.product_qualifying_equipment (pqe_measure_product_id, pqe_equipment_product_id)
  WHERE pqe_is_deleted IS NOT TRUE;

CREATE INDEX IF NOT EXISTS pqe_measure_idx
  ON public.product_qualifying_equipment (pqe_measure_product_id)
  WHERE pqe_is_deleted IS NOT TRUE;

-- Record number, via the platform's own generator.
CREATE SEQUENCE IF NOT EXISTS public.seq_product_qualifying_equipment;

CREATE OR REPLACE FUNCTION public.set_pqe_record_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  NEW.pqe_record_number := generate_record_number('PQE-', 'seq_product_qualifying_equipment');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pqe_rn ON public.product_qualifying_equipment;
CREATE TRIGGER trg_pqe_rn BEFORE INSERT ON public.product_qualifying_equipment
  FOR EACH ROW EXECUTE FUNCTION public.set_pqe_record_number();

DROP TRIGGER IF EXISTS trg_product_qualifying_equipment_no_hard_delete
  ON public.product_qualifying_equipment;
CREATE TRIGGER trg_product_qualifying_equipment_no_hard_delete
  BEFORE DELETE ON public.product_qualifying_equipment
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

DROP TRIGGER IF EXISTS trg_audit_product_qualifying_equipment
  ON public.product_qualifying_equipment;
CREATE TRIGGER trg_audit_product_qualifying_equipment
  AFTER INSERT OR DELETE OR UPDATE ON public.product_qualifying_equipment
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

-- ── 4. RLS — mirrors products, the object it configures ───────────────────
--
-- This is platform configuration (an approved-model list), so it is scoped by
-- the products permission rather than by geography: an approved model is
-- approved in every state, and state scoping is registered as
-- platform_configuration in step 6 for the same reason.
ALTER TABLE public.product_qualifying_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_select_product_qualifying_equipment ON public.product_qualifying_equipment;
CREATE POLICY app_select_product_qualifying_equipment ON public.product_qualifying_equipment
  FOR SELECT USING ((SELECT public.app_user_can('products', 'read')));

DROP POLICY IF EXISTS app_insert_product_qualifying_equipment ON public.product_qualifying_equipment;
CREATE POLICY app_insert_product_qualifying_equipment ON public.product_qualifying_equipment
  FOR INSERT WITH CHECK ((SELECT public.app_user_can('products', 'create')));

DROP POLICY IF EXISTS app_update_product_qualifying_equipment ON public.product_qualifying_equipment;
CREATE POLICY app_update_product_qualifying_equipment ON public.product_qualifying_equipment
  FOR UPDATE USING ((SELECT public.app_user_can('products', 'update')))
          WITH CHECK ((SELECT public.app_user_can('products', 'update')));

DROP POLICY IF EXISTS app_delete_product_qualifying_equipment ON public.product_qualifying_equipment;
CREATE POLICY app_delete_product_qualifying_equipment ON public.product_qualifying_equipment
  FOR DELETE USING ((SELECT public.app_user_can('products', 'delete')));

COMMIT;

-- ── 5. Audit stamping and state scoping — the platform's own installers ───
--
-- Run OUTSIDE the transaction above only in the sense that they are separate
-- statements; both are idempotent generators. resolve_record_audit_columns
-- derives the four audit columns from the table's dominant `pqe_` prefix, so no
-- record_audit_column_overrides row is needed.
BEGIN;

SELECT public.install_record_audit_stamping('product_qualifying_equipment');

-- An approved-model list is the same in every state, exactly like the products
-- and price_book_entries rows it sits beside (both platform_configuration).
-- Registering it keeps record_state_scope_status() at zero unregistered
-- objects — the guard that stops a new object silently escaping state scoping.
INSERT INTO public.record_state_scope_sources (
  rsss_record_number, rsss_object_name, rsss_resolution_kind,
  rsss_path_order, rsss_is_active, rsss_notes, rsss_owner
)
SELECT '', 'product_qualifying_equipment', 'platform_configuration', 1, true,
       'Approved-model list. A model approved for a measure is approved wherever that measure runs, so this carries no state of its own — same classification as products and price_book_entries.',
       (SELECT rsss_owner FROM public.record_state_scope_sources
         WHERE rsss_object_name = 'products' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.record_state_scope_sources
  WHERE rsss_object_name = 'product_qualifying_equipment'
    AND rsss_is_deleted IS NOT TRUE
);

COMMIT;

-- ── 6. Assertions — the migration proves itself ──────────────────────────
DO $$
DECLARE
  v_missing_rt   int;
  v_flagged      int;
  v_wrongly_set  int;
BEGIN
  SELECT count(*) INTO v_missing_rt
  FROM (VALUES ('VENTILATION-EQUIPMENT'), ('FURNACE-EQUIPMENT')) AS w(val)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.picklist_values
    WHERE picklist_object = 'products' AND picklist_field = 'record_type'
      AND picklist_value = w.val AND picklist_is_active
  );
  IF v_missing_rt > 0 THEN
    RAISE EXCEPTION 'Equipment record types did not land: % missing', v_missing_rt;
  END IF;

  SELECT count(*) INTO v_flagged FROM public.products
   WHERE product_requires_equipment_selection AND product_is_deleted IS NOT TRUE;
  IF v_flagged <> 2 THEN
    RAISE EXCEPTION 'Expected exactly 2 measures requiring equipment (HEAR-VENT, HEAR-HP-SPACE-HEAT-COOL); found %', v_flagged;
  END IF;

  -- The negative control. Electrical wiring and a service panel install no
  -- model-numbered device; if the flag ever sweeps them up, a line item for
  -- them would demand equipment that does not exist and could not be saved.
  SELECT count(*) INTO v_wrongly_set FROM public.products
   WHERE product_requires_equipment_selection
     AND product_code IN ('HEAR-WIRING', 'HEAR-PANEL', 'MEAS-ATTIC-INS', 'MEAS-ATTIC-AS');
  IF v_wrongly_set > 0 THEN
    RAISE EXCEPTION 'A measure with no installable equipment was flagged as requiring it (% rows)', v_wrongly_set;
  END IF;

  -- record_state_scope_status() lists every registered object with the
  -- resolution kinds it resolves by. An object absent from that listing is one
  -- that escaped state scoping entirely, which is the failure this guards.
  IF NOT EXISTS (
    SELECT 1 FROM public.record_state_scope_status() s
     WHERE s.object_name = 'product_qualifying_equipment'
       AND s.resolution_kinds = 'platform_configuration'
  ) THEN
    RAISE EXCEPTION 'product_qualifying_equipment is not registered for state scoping as platform configuration';
  END IF;
END $$;
