-- Allow a manually-chosen price book when the opportunity record type has no
-- mapping — without weakening the record-type rule where a mapping exists.
--
-- Standing ruling (Nicholas, 2026-07-26): "The opportunity record type dictates
-- the price book. It's not something someone can manually change." That holds
-- for every MAPPED record type and is unchanged here.
--
-- New (Nicholas, 2026-07-29): on an opportunity whose record type has NO price
-- book mapping (e.g. NC/MI today, or a new program), the price book "lives with
-- the opportunity" — the first product added prompts the user to pick one, and
-- it is stored on opportunities.price_book_id. The previous trigger cleared the
-- value to NULL on every write for unmapped record types, so a chosen book
-- could never persist. Fix: force the mapped book only when a mapping EXISTS;
-- otherwise leave whatever value the row carries (the user's choice).

CREATE OR REPLACE FUNCTION public.set_opportunity_price_book_from_record_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_price_book_id uuid;
  v_has_mapping   boolean;
BEGIN
  SELECT m.price_book_id INTO v_price_book_id
  FROM opportunity_record_type_price_books m
  WHERE m.ortpb_record_type_id = NEW.opportunity_record_type
    AND m.ortpb_is_deleted = false;
  v_has_mapping := FOUND;

  IF v_has_mapping THEN
    -- Mapped record type dictates the price book, unchangeable.
    NEW.price_book_id := v_price_book_id;
  END IF;
  -- No mapping: preserve NEW.price_book_id as supplied (manual selection on the
  -- opportunity, or NULL until the first product is added). Never clobber it.
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_opportunity_price_book_from_record_type() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_opportunity_price_book_from_record_type() FROM anon;
REVOKE ALL ON FUNCTION public.set_opportunity_price_book_from_record_type() FROM authenticated;

NOTIFY pgrst, 'reload schema';
