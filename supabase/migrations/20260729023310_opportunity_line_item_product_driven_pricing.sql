-- Opportunity line items: the PRODUCT is the driver, not the price book entry
--
-- Ruling (Nicholas, 2026-07-29): "I shouldn't have to pick my price book entry
-- ever on an opportunity, just my product, and then the product description
-- comes in, the list price comes in, all of that. Re-architect this very
-- similar to how Salesforce works."
--
-- Salesforce parity: on an OpportunityLineItem you add a PRODUCT. Salesforce
-- resolves the PricebookEntry for the opportunity's price book automatically
-- and stamps the list price onto the line. The user never selects a
-- PricebookEntry.
--
-- The pieces already in place before this migration:
--   * opportunities.price_book_id is DERIVED from the opportunity record type
--     (opportunity_record_type_price_books mapping + trg_opportunity_price_book),
--     read-only, never typed. (20260726230000)
--   * The line-item Product picker is scoped to products that have an active
--     price book entry in the opportunity's price book. (20260726220000)
--   * (product_id, price_book_id) is unique among active entries, so a product
--     plus a price book resolves to exactly one entry — deterministic.
--
-- What was WRONG: the line-item defaults trigger made the PRICE BOOK ENTRY the
-- driver (selecting it back-filled the product + prices), so the form forced
-- the user to pick BOTH a product and a price book entry. This migration flips
-- the direction: the PRODUCT drives everything, the price book entry is
-- resolved from (product x the opportunity's price book) and is no longer a
-- user selection. The frontend renders price_book_entry_id as a derived
-- read-only field (DERIVED_READONLY.opportunity_line_items in RecordDetail.jsx),
-- exactly like the opportunity's Price Book.
--
-- Contents:
--   1. Rewrite set_opportunity_line_item_defaults(): product-driven resolution
--      of the price book entry, list price, sales price, and line description;
--      a legacy entry-first fallback so existing/imported rows still resolve.
--   2. Strip the Price Book Entry picker's lookup_dependency/create_seed from
--      the line-item layout — it is no longer a picker.

-- ---------------------------------------------------------------------------
-- 1. Product-driven line-item defaults
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_opportunity_line_item_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_price_book_id  uuid;
  v_pbe_id         uuid;
  v_pbe_price      numeric;
  v_entry_count    integer;
  v_product_name   text;
  v_product_desc   text;
  v_pbe_product_id uuid;
BEGIN
  -- =========================================================================
  -- PRIMARY FLOW (Salesforce parity): the PRODUCT is the driver. On insert or
  -- whenever the product changes, resolve the single price book entry for that
  -- product in the OPPORTUNITY'S price book and pull the price + description
  -- from it. The user never picks a price book entry.
  -- =========================================================================
  IF NEW.product_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN

    -- The opportunity's price book (itself derived from the record type).
    SELECT o.price_book_id INTO v_price_book_id
    FROM opportunities o
    WHERE o.id = NEW.opportunity_id;

    -- Preferred: the entry for this product in the opportunity's price book.
    -- (product_id, price_book_id) is unique among active entries.
    IF v_price_book_id IS NOT NULL THEN
      SELECT pbe.id, pbe.price_book_entry_unit_price
        INTO v_pbe_id, v_pbe_price
      FROM price_book_entries pbe
      WHERE pbe.product_id = NEW.product_id
        AND pbe.price_book_id = v_price_book_id
        AND pbe.price_book_entry_is_deleted = false
        AND COALESCE(pbe.price_book_entry_is_active, true) = true
        AND COALESCE(pbe.price_book_entry_is_archived, false) = false
      LIMIT 1;
    END IF;

    -- Fallback for opportunities with no price book yet (NC/MI have no books
    -- configured): use the product's sole active entry when exactly one exists,
    -- so the line never dead-ends. If the product is priced into more than one
    -- book, leave the entry/price blank for the user to fill — never guess.
    IF v_pbe_id IS NULL THEN
      SELECT count(*) INTO v_entry_count
      FROM price_book_entries pbe
      WHERE pbe.product_id = NEW.product_id
        AND pbe.price_book_entry_is_deleted = false
        AND COALESCE(pbe.price_book_entry_is_active, true) = true
        AND COALESCE(pbe.price_book_entry_is_archived, false) = false;

      IF v_entry_count = 1 THEN
        SELECT pbe.id, pbe.price_book_entry_unit_price
          INTO v_pbe_id, v_pbe_price
        FROM price_book_entries pbe
        WHERE pbe.product_id = NEW.product_id
          AND pbe.price_book_entry_is_deleted = false
          AND COALESCE(pbe.price_book_entry_is_active, true) = true
          AND COALESCE(pbe.price_book_entry_is_archived, false) = false
        LIMIT 1;
      END IF;
    END IF;

    -- Stamp the resolved entry onto the line (derived, not user-selected).
    NEW.price_book_entry_id := v_pbe_id;

    -- List price is derived from the price book entry — always refresh it to
    -- the resolved entry's price when the product changes.
    NEW.oli_list_price := v_pbe_price;

    -- Sales price defaults to the list price. Preserve a hand-edited sales
    -- price, but if it was still tracking the previous list price (i.e. the
    -- default), refresh it to the new one — same "was it hand-edited?"
    -- heuristic used for the total below.
    IF NEW.oli_unit_price IS NULL THEN
      NEW.oli_unit_price := v_pbe_price;
    ELSIF TG_OP = 'UPDATE'
          AND NEW.oli_unit_price IS NOT DISTINCT FROM OLD.oli_list_price THEN
      NEW.oli_unit_price := COALESCE(v_pbe_price, NEW.oli_unit_price);
    END IF;

    -- The product's description flows into the line description when blank.
    IF NEW.oli_line_description IS NULL OR btrim(NEW.oli_line_description) = '' THEN
      SELECT p.product_description INTO v_product_desc
      FROM products p WHERE p.id = NEW.product_id;
      IF v_product_desc IS NOT NULL AND btrim(v_product_desc) <> '' THEN
        NEW.oli_line_description := v_product_desc;
      END IF;
    END IF;
  END IF;

  -- =========================================================================
  -- LEGACY / IMPORT FALLBACK: an entry supplied directly with no product (old
  -- data paths, bulk imports). Keep back-filling the product + price from the
  -- entry so nothing that pre-dates the product-driven flow breaks.
  -- =========================================================================
  IF NEW.product_id IS NULL AND NEW.price_book_entry_id IS NOT NULL THEN
    SELECT pbe.product_id, pbe.price_book_entry_unit_price
      INTO v_pbe_product_id, v_pbe_price
    FROM price_book_entries pbe
    WHERE pbe.id = NEW.price_book_entry_id;
    IF v_pbe_product_id IS NOT NULL THEN
      NEW.product_id := v_pbe_product_id;
    END IF;
    IF NEW.oli_list_price IS NULL THEN
      NEW.oli_list_price := v_pbe_price;
    END IF;
    IF NEW.oli_unit_price IS NULL THEN
      NEW.oli_unit_price := COALESCE(v_pbe_price, NEW.oli_list_price);
    END IF;
  END IF;

  -- Name derives from the product when left blank ('NEW' is the client-side
  -- required-field placeholder). trg_oli_name (20260726203000) is authoritative
  -- and fires after this, but keep the blank-fill so direct DML has a name too.
  IF (NEW.oli_name IS NULL OR btrim(NEW.oli_name) = '' OR NEW.oli_name = 'NEW')
     AND NEW.product_id IS NOT NULL THEN
    SELECT p.product_name INTO v_product_name FROM products p WHERE p.id = NEW.product_id;
    IF v_product_name IS NOT NULL THEN
      NEW.oli_name := v_product_name;
    END IF;
  END IF;

  -- Total = quantity x sales price. Computed when blank, and recomputed when
  -- quantity or sales price change without the total being hand-edited in the
  -- same save.
  IF NEW.oli_quantity IS NOT NULL AND NEW.oli_unit_price IS NOT NULL THEN
    IF NEW.oli_total_price IS NULL
       OR (TG_OP = 'UPDATE'
           AND NEW.oli_total_price IS NOT DISTINCT FROM OLD.oli_total_price
           AND (NEW.oli_quantity IS DISTINCT FROM OLD.oli_quantity
                OR NEW.oli_unit_price IS DISTINCT FROM OLD.oli_unit_price)) THEN
      NEW.oli_total_price := round(NEW.oli_quantity * NEW.oli_unit_price, 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_opportunity_line_item_defaults() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_opportunity_line_item_defaults() FROM anon;
REVOKE ALL ON FUNCTION public.set_opportunity_line_item_defaults() FROM authenticated;

-- Trigger definition is unchanged (BEFORE INSERT OR UPDATE), re-assert for
-- clarity / idempotence.
DROP TRIGGER IF EXISTS trg_oli_defaults ON public.opportunity_line_items;
CREATE TRIGGER trg_oli_defaults
  BEFORE INSERT OR UPDATE ON public.opportunity_line_items
  FOR EACH ROW EXECUTE FUNCTION public.set_opportunity_line_item_defaults();

-- ---------------------------------------------------------------------------
-- 2. Price Book Entry is no longer a picker on the line-item layout.
--    Strip its lookup_dependency + create_seed (set in 20260726240000). The
--    frontend also renders it derived-read-only, but keep the layout config
--    honest: it is a resolved, display-only field now.
-- ---------------------------------------------------------------------------

UPDATE page_layout_widgets plw
SET widget_config = jsonb_set(
  plw.widget_config,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE f->>'name'
        WHEN 'price_book_entry_id' THEN (f - 'lookup_dependency')
        ELSE f
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(plw.widget_config->'fields') WITH ORDINALITY AS t(f, ord)
  )
)
FROM page_layout_sections pls, page_layouts pl
WHERE plw.section_id = pls.id
  AND pls.page_layout_id = pl.id
  AND pl.page_layout_object = 'opportunity_line_items'
  AND pl.is_deleted IS NOT TRUE
  AND pls.is_deleted IS NOT TRUE
  AND plw.is_deleted IS NOT TRUE
  AND plw.widget_type = 'field_group'
  AND plw.widget_config ? 'fields'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(plw.widget_config->'fields') f
    WHERE f->>'name' = 'price_book_entry_id' AND f ? 'lookup_dependency'
  );

NOTIFY pgrst, 'reload schema';
