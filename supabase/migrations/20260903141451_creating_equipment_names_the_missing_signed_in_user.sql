-- Creating equipment names the missing signed-in user instead of failing on a
-- NOT NULL constraint.
--
-- products.product_owner and product_created_by are both NOT NULL, and
-- current_app_user_id() returns NULL for any caller LEAP does not recognise as
-- an app user. The first probe of create_qualifying_equipment_for_measure hit
-- that as `null value in column "product_owner" violates not-null constraint`
-- — a message that names a column the person never filled in, for a cause that
-- has nothing to do with the form they were using.
--
-- Every record in LEAP has a named owner, so there is no sensible fallback
-- here: the honest answer is to refuse and say the session is not a LEAP user.

CREATE OR REPLACE FUNCTION public.create_qualifying_equipment_for_measure(
  p_measure_product_id uuid,
  p_manufacturer       text,
  p_model_number       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rt      uuid;
  v_name    text;
  v_id      uuid;
  v_owner   uuid;
  v_make    text := nullif(btrim(p_manufacturer), '');
  v_model   text := nullif(btrim(p_model_number), '');
BEGIN
  IF v_model IS NULL THEN
    RAISE EXCEPTION 'A model number is required — it is what the programme''s supplemental data sheet reports for every unit.';
  END IF;

  v_owner := public.current_app_user_id();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Cannot create equipment: this session is not signed in as a LEAP user, and every product needs a named owner.';
  END IF;

  SELECT product_equipment_record_type_id INTO v_rt
    FROM public.products
   WHERE id = p_measure_product_id AND product_requires_equipment_selection;
  IF v_rt IS NULL THEN
    RAISE EXCEPTION 'That measure does not take an equipment selection, or has no equipment record type configured.';
  END IF;

  v_name := btrim(concat_ws(' ', v_make, v_model));

  -- Reuse an identical model rather than minting a duplicate product: two
  -- catalogue rows for one physical fan is how a report starts double-counting.
  SELECT id INTO v_id FROM public.products
   WHERE product_is_deleted IS NOT TRUE
     AND coalesce(product_manufacturer,'') = coalesce(v_make,'')
     AND product_model_number = v_model
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.products (
      product_record_number, product_name, product_record_type,
      product_manufacturer, product_model_number, product_is_active,
      product_owner, product_created_by
    ) VALUES ('', v_name, v_rt, v_make, v_model, true, v_owner, v_owner)
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.product_qualifying_equipment (
    pqe_record_number, pqe_measure_product_id, pqe_equipment_product_id,
    pqe_is_active, pqe_owner, pqe_created_by
  )
  SELECT '', p_measure_product_id, v_id, true, v_owner, v_owner
  WHERE NOT EXISTS (
    SELECT 1 FROM public.product_qualifying_equipment q
     WHERE q.pqe_measure_product_id = p_measure_product_id
       AND q.pqe_equipment_product_id = v_id
       AND q.pqe_is_deleted IS NOT TRUE);

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_qualifying_equipment_for_measure(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_qualifying_equipment_for_measure(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
