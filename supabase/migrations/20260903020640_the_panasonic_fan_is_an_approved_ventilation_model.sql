-- The Panasonic FV-0511VF1 is an approved model for the ENERGY STAR Ventilation
-- measure — the first row of the two-tier product catalogue.
--
-- This is the fan on the Quality Installation Supplemental Data Sheet Nicholas
-- supplied for GREEN VALLEY ESTATES (570 South Clark Street, Whitewater — 8
-- units, ENR-00077). Every one of its 8 rows reads "Panasonic FV-0511VF1" in
-- the Model Number column, and until now LEAP held that string nowhere: the
-- opportunity carried OLI-00070 "ENERGY STAR Ventilation x 8" against PRD-00027,
-- a rebate line with no manufacturer and no model.
--
-- Seeded as DATA, not as a constant in the sheet generator. An earlier cut of
-- this work was told to hard-code the model number and move on; the structure
-- Nicholas then asked for ("I do want to include the submittal sheets, the
-- Energy Star certification, and all that — that's going to live on the product
-- record") is what makes the hard-code unnecessary. A second fan is a product
-- record and a PQE- link from here, never a code change.
--
-- The supporting documents are NOT seeded. A submittal sheet and an ENERGY STAR
-- certificate are real files that have to be obtained from the manufacturer;
-- inventing rows that point at nothing would make the Documents card on the
-- product look complete while the filing packet it feeds stays empty. They are
-- uploaded to the product record, and the supplemental data sheet copies
-- whatever is actually there.

BEGIN;

-- ── The equipment product ─────────────────────────────────────────────────
--
-- Owner and author are carried from the measure product it qualifies for: a
-- migration has no signed-in user, so current_app_user_id() is NULL and the
-- audit stamper cannot fill either NOT NULL column. Same device the
-- external_form_targets seed uses.
INSERT INTO public.products (
  product_record_number, product_name, product_record_type, product_family,
  product_manufacturer, product_model_number, product_description,
  product_is_active, product_is_serialized,
  product_owner, product_created_by
)
SELECT
  '',                                        -- trg_product_rn fills this
  'Panasonic FV-0511VF1',
  (SELECT id FROM public.picklist_values
    WHERE picklist_object = 'products' AND picklist_field = 'record_type'
      AND picklist_value = 'VENTILATION-EQUIPMENT'),
  (SELECT id FROM public.picklist_values
    WHERE picklist_object = 'products' AND picklist_field = 'product_family'
      AND picklist_value = 'Ventilation'),
  'Panasonic',
  'FV-0511VF1',
  'WhisperGreen Select ENERGY STAR certified ceiling exhaust fan. Installed to claim the IRA HEAR ENERGY STAR Mechanical Ventilation measure; its model number is what the Quality Installation Supplemental Data Sheet reports per unit.',
  true,
  false,                                     -- a bath fan carries no serial; the sheet reports N/A
  (SELECT product_owner      FROM public.products WHERE product_code = 'HEAR-VENT'),
  (SELECT product_created_by FROM public.products WHERE product_code = 'HEAR-VENT')
WHERE NOT EXISTS (
  SELECT 1 FROM public.products
   WHERE product_manufacturer = 'Panasonic' AND product_model_number = 'FV-0511VF1'
     AND product_is_deleted IS NOT TRUE
);

-- ── The approval link ─────────────────────────────────────────────────────
INSERT INTO public.product_qualifying_equipment (
  pqe_record_number, pqe_measure_product_id, pqe_equipment_product_id,
  pqe_notes, pqe_is_active, pqe_owner, pqe_created_by
)
SELECT
  '',
  m.id,
  e.id,
  'Seeded from the Quality Installation Supplemental Data Sheet filed for GREEN VALLEY ESTATES (570 South Clark Street, Whitewater), where this is the model installed in all 8 units.',
  true,
  m.product_owner,
  m.product_created_by
FROM public.products m
CROSS JOIN public.products e
WHERE m.product_code = 'HEAR-VENT'
  AND e.product_manufacturer = 'Panasonic' AND e.product_model_number = 'FV-0511VF1'
  AND e.product_is_deleted IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.product_qualifying_equipment q
     WHERE q.pqe_measure_product_id = m.id AND q.pqe_equipment_product_id = e.id
       AND q.pqe_is_deleted IS NOT TRUE
  );

COMMIT;

-- ── Assertions ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_model text;
  v_links int;
BEGIN
  SELECT p.product_model_number INTO v_model
    FROM public.product_qualifying_equipment q
    JOIN public.products m ON m.id = q.pqe_measure_product_id
    JOIN public.products p ON p.id = q.pqe_equipment_product_id
   WHERE m.product_code = 'HEAR-VENT' AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE;

  IF v_model IS DISTINCT FROM 'FV-0511VF1' THEN
    RAISE EXCEPTION 'The ventilation measure does not resolve to the Panasonic FV-0511VF1 (got %)', COALESCE(v_model, 'nothing');
  END IF;

  -- The equipment product must NOT itself be a measure that demands equipment,
  -- or picking it would demand another product beneath it, forever.
  IF EXISTS (
    SELECT 1 FROM public.products
     WHERE product_manufacturer = 'Panasonic' AND product_model_number = 'FV-0511VF1'
       AND product_requires_equipment_selection
  ) THEN
    RAISE EXCEPTION 'The fan is flagged as requiring equipment of its own';
  END IF;

  SELECT count(*) INTO v_links FROM public.product_qualifying_equipment
   WHERE pqe_is_deleted IS NOT TRUE;
  IF v_links <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 approved-model link; found %', v_links;
  END IF;
END $$;
