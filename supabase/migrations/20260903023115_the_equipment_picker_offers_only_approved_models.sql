-- The equipment picker offers only the models approved for that measure.
--
-- Nicholas: "It needs to be a little more interactive so the user does not
-- forget to select the correct equipment. I want this to be pretty intuitive."
--
-- The trigger installed in 20260903020144 already REFUSES a line item whose
-- equipment is not linked to its measure. That is the guarantee — it holds for
-- an API call, an import and a flow, none of which go near a picker. This is
-- the other half: making the right answer the easy one, so nobody meets the
-- refusal in the first place.
--
-- Modelled on list_opportunities_for_property: a SECURITY INVOKER function so
-- RLS still governs which products the caller may see (a definer function here
-- would hand a state-restricted user a catalogue they cannot otherwise read),
-- and it takes the CURRENT value so an already-saved model that has since been
-- withdrawn from the approved list still renders as the selection rather than
-- the control silently reading empty.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_qualifying_equipment_for_measure(
  p_measure_product_ids uuid[],
  p_include_product_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  id                  uuid,
  product_name        text,
  product_manufacturer text,
  product_model_number text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT DISTINCT e.id, e.product_name, e.product_manufacturer, e.product_model_number
    FROM public.products e
    JOIN public.product_qualifying_equipment q
      ON q.pqe_equipment_product_id = e.id
   WHERE q.pqe_measure_product_id = ANY (p_measure_product_ids)
     AND q.pqe_is_active AND q.pqe_is_deleted IS NOT TRUE
     AND e.product_is_active AND e.product_is_deleted IS NOT TRUE
  UNION
  SELECT e.id, e.product_name, e.product_manufacturer, e.product_model_number
    FROM public.products e
   WHERE p_include_product_id IS NOT NULL
     AND e.id = p_include_product_id
     AND e.product_is_deleted IS NOT TRUE
  ORDER BY 2;
$function$;

COMMENT ON FUNCTION public.list_qualifying_equipment_for_measure(uuid[], uuid) IS
  'The equipment products approved for the given incentive measure(s), for the opportunity line item equipment picker. SECURITY INVOKER so RLS still governs product visibility. Always includes p_include_product_id, so a saved model that has since been withdrawn from the approved list still shows as the current selection instead of the control reading empty.';

-- anon has no business enumerating the product catalogue.
REVOKE ALL ON FUNCTION public.list_qualifying_equipment_for_measure(uuid[], uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_qualifying_equipment_for_measure(uuid[], uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_n int; v_name text;
BEGIN
  -- The ventilation measure must offer exactly the Panasonic, and nothing else.
  SELECT count(*), min(product_name) INTO v_n, v_name
    FROM public.list_qualifying_equipment_for_measure(
      ARRAY[(SELECT id FROM public.products WHERE product_code = 'HEAR-VENT')], NULL);
  IF v_n <> 1 OR v_name <> 'Panasonic FV-0511VF1' THEN
    RAISE EXCEPTION 'The ventilation picker offers % model(s) (first: %); expected exactly the Panasonic FV-0511VF1', v_n, COALESCE(v_name, 'none');
  END IF;

  -- A measure with no approved models must offer NOTHING, not the whole
  -- catalogue. A picker that falls back to everything is how a water heater
  -- gets recorded as the fan installed in a bathroom.
  SELECT count(*) INTO v_n
    FROM public.list_qualifying_equipment_for_measure(
      ARRAY[(SELECT id FROM public.products WHERE product_code = 'HEAR-PANEL')], NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'A measure with no approved models offered % product(s) instead of none', v_n;
  END IF;

  -- The current value is always offered back, even when it is not approved.
  SELECT count(*) INTO v_n
    FROM public.list_qualifying_equipment_for_measure(
      ARRAY[(SELECT id FROM public.products WHERE product_code = 'HEAR-PANEL')],
      (SELECT id FROM public.products WHERE product_code = 'HEAR-HPWH'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A saved-but-unapproved model was not offered back as the current selection (got % rows)', v_n;
  END IF;
END $$;
