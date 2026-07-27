-- Price book is derived from the opportunity record type — never typed
--
-- Ruling (Nicholas, 2026-07-26): "The opportunity record type dictates the
-- price book. It's not something someone can manually change." The previous
-- migration exposed price_book_id as a free lookup on every opportunity
-- layout; that was wrong. The mapping is data, the value is derived, and the
-- field renders read-only (DERIVED_READONLY in RecordDetail.jsx).
--
-- Also in this migration:
--   1. Price books renamed to full descriptive names (naming hard rule: no
--      abbreviations). Seeded price book entry names recomputed to match.
--   2. New purpose-built mapping table opportunity_record_type_price_books
--      (ORTPB-) — one active price book per opportunity record type,
--      admin-manageable, nothing hardcoded.
--   3. Trigger derives opportunities.price_book_id from the record type on
--      every write, plus a cascade when a mapping changes. Existing rows
--      backfilled.
--   4. set_opportunity_line_item_defaults loses its name-derivation branch —
--      trg_oli_name (migration 20260726200000, PR #224) is authoritative and
--      fires after it, so that code was dead.
--
-- NOTE: WI record type 'WI-IRA-SF-HOMES' maps to the price book formerly
-- named 'WI-IRA-FOE-SF-HOMES' — the only record-type/price-book pair whose
-- names did not already agree. NC and MI record types have no price books
-- yet, so their opportunities derive a NULL price book (the line-item
-- pickers fall back to all active entries rather than dead-ending).

-- ---------------------------------------------------------------------------
-- 1. Descriptive price book names
-- ---------------------------------------------------------------------------

UPDATE price_books pb
SET price_book_name = m.new_name
FROM (VALUES
  ('FOE-2024-WI',           'Focus on Energy Wisconsin 2024'),
  ('FOE-2025-WI',           'Focus on Energy Wisconsin 2025'),
  ('FOE-2026-WI',           'Focus on Energy Wisconsin 2026'),
  ('WI-IRA-MF-HOMES',       'Wisconsin IRA Multifamily HOMES'),
  ('WI-IRA-FOE-SF-HOMES',   'Wisconsin IRA Single-Family HOMES'),
  ('WI-IRA-MF-HEAR',        'Wisconsin IRA Multifamily HEAR'),
  ('WI-IRA-SF-HEAR',        'Wisconsin IRA Single-Family HEAR'),
  ('WI-IRA-MF-HOMES-Audit', 'Wisconsin IRA Multifamily HOMES Audit'),
  ('WI-IRA-SF-HOMES-AUDIT', 'Wisconsin IRA Single-Family HOMES Audit')
) AS m(old_name, new_name)
WHERE pb.price_book_name = m.old_name
  AND pb.price_book_is_deleted IS NOT TRUE;

-- Entry names were composed as "<product> - <book>" at seed time; recompose
-- them so they match the renamed books.
UPDATE price_book_entries pbe
SET price_book_entry_name = p.product_name || ' - ' || pb.price_book_name
FROM products p, price_books pb
WHERE pbe.product_id = p.id
  AND pbe.price_book_id = pb.id
  AND pbe.price_book_entry_is_deleted IS NOT TRUE
  AND pbe.price_book_entry_name IS DISTINCT FROM (p.product_name || ' - ' || pb.price_book_name);

-- ---------------------------------------------------------------------------
-- 2. Mapping table: opportunity record type -> price book
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.opportunity_record_type_price_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ortpb_record_number text NOT NULL,
  ortpb_owner uuid NOT NULL REFERENCES public.users(id),
  ortpb_created_by uuid NOT NULL REFERENCES public.users(id),
  ortpb_created_at timestamptz NOT NULL DEFAULT now(),
  ortpb_updated_by uuid REFERENCES public.users(id),
  ortpb_updated_at timestamptz DEFAULT now(),
  ortpb_is_deleted boolean NOT NULL DEFAULT false,
  ortpb_deleted_at timestamptz,
  ortpb_deleted_by uuid REFERENCES public.users(id),
  ortpb_deletion_reason text,
  ortpb_record_type_id uuid NOT NULL REFERENCES public.picklist_values(id),
  price_book_id uuid NOT NULL REFERENCES public.price_books(id)
);

-- One active price book per opportunity record type.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ortpb_active_record_type
  ON public.opportunity_record_type_price_books (ortpb_record_type_id)
  WHERE ortpb_is_deleted = false;

CREATE SEQUENCE IF NOT EXISTS public.seq_opportunity_record_type_price_books;

CREATE OR REPLACE FUNCTION public.set_ortpb_record_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  NEW.ortpb_record_number := generate_record_number('ORTPB-', 'seq_opportunity_record_type_price_books');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ortpb_rn ON public.opportunity_record_type_price_books;
CREATE TRIGGER trg_ortpb_rn
  BEFORE INSERT ON public.opportunity_record_type_price_books
  FOR EACH ROW EXECUTE FUNCTION public.set_ortpb_record_number();

DROP TRIGGER IF EXISTS trg_ortpb_no_hard_delete ON public.opportunity_record_type_price_books;
CREATE TRIGGER trg_ortpb_no_hard_delete
  BEFORE DELETE ON public.opportunity_record_type_price_books
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

DROP TRIGGER IF EXISTS trg_audit_ortpb ON public.opportunity_record_type_price_books;
CREATE TRIGGER trg_audit_ortpb
  AFTER INSERT OR UPDATE OR DELETE ON public.opportunity_record_type_price_books
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();

ALTER TABLE public.opportunity_record_type_price_books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_select_ortpb ON public.opportunity_record_type_price_books;
CREATE POLICY app_select_ortpb ON public.opportunity_record_type_price_books
  FOR SELECT TO authenticated
  USING ((SELECT app_user_can('opportunity_record_type_price_books', 'read')));

DROP POLICY IF EXISTS app_insert_ortpb ON public.opportunity_record_type_price_books;
CREATE POLICY app_insert_ortpb ON public.opportunity_record_type_price_books
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_user_can('opportunity_record_type_price_books', 'create')));

DROP POLICY IF EXISTS app_update_ortpb ON public.opportunity_record_type_price_books;
CREATE POLICY app_update_ortpb ON public.opportunity_record_type_price_books
  FOR UPDATE TO authenticated
  USING ((SELECT app_user_can('opportunity_record_type_price_books', 'update')));

DROP POLICY IF EXISTS app_delete_ortpb ON public.opportunity_record_type_price_books;
CREATE POLICY app_delete_ortpb ON public.opportunity_record_type_price_books
  FOR DELETE TO authenticated
  USING ((SELECT app_user_can('opportunity_record_type_price_books', 'delete')));

-- Seed the Wisconsin mappings (record type label = price book, one pair aside).
INSERT INTO public.opportunity_record_type_price_books (
  ortpb_record_number, ortpb_owner, ortpb_created_by, ortpb_record_type_id, price_book_id
)
SELECT 'NEW', u.id, u.id, pv.id, pb.id
FROM (VALUES
  ('foe_2024_wi',           'Focus on Energy Wisconsin 2024'),
  ('foe_2025_wi',           'Focus on Energy Wisconsin 2025'),
  ('foe_2026_wi',           'Focus on Energy Wisconsin 2026'),
  ('wi_ira_mf_homes',       'Wisconsin IRA Multifamily HOMES'),
  ('wi_ira_sf_homes',       'Wisconsin IRA Single-Family HOMES'),
  ('wi_ira_mf_hear',        'Wisconsin IRA Multifamily HEAR'),
  ('wi_ira_sf_hear',        'Wisconsin IRA Single-Family HEAR'),
  ('wi_ira_mf_homes_audit', 'Wisconsin IRA Multifamily HOMES Audit'),
  ('wi_ira_sf_homes_audit', 'Wisconsin IRA Single-Family HOMES Audit')
) AS m(rt_value, book_name)
JOIN picklist_values pv
  ON pv.picklist_object = 'opportunities'
 AND pv.picklist_field = 'record_type'
 AND pv.picklist_value = m.rt_value
JOIN price_books pb
  ON pb.price_book_name = m.book_name AND pb.price_book_is_deleted IS NOT TRUE
CROSS JOIN (SELECT id FROM users WHERE user_email = 'nicholas.wood@ees-wi.org' AND user_is_deleted IS NOT TRUE LIMIT 1) u
WHERE NOT EXISTS (
  SELECT 1 FROM public.opportunity_record_type_price_books x
  WHERE x.ortpb_record_type_id = pv.id AND x.ortpb_is_deleted = false
);

-- ---------------------------------------------------------------------------
-- 3. Derive opportunities.price_book_id from the record type
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_opportunity_price_book_from_record_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_price_book_id uuid;
BEGIN
  SELECT m.price_book_id INTO v_price_book_id
  FROM opportunity_record_type_price_books m
  WHERE m.ortpb_record_type_id = NEW.opportunity_record_type
    AND m.ortpb_is_deleted = false;

  -- Derived, never typed: the mapping wins, including clearing the value when
  -- the record type has no price book configured.
  NEW.price_book_id := v_price_book_id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_opportunity_price_book_from_record_type() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_opportunity_price_book_from_record_type() FROM anon;
REVOKE ALL ON FUNCTION public.set_opportunity_price_book_from_record_type() FROM authenticated;

DROP TRIGGER IF EXISTS trg_opportunity_price_book ON public.opportunities;
CREATE TRIGGER trg_opportunity_price_book
  BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_opportunity_price_book_from_record_type();

-- Cascade: changing or removing a mapping re-derives every opportunity on
-- that record type, so the mapping table stays the single source of truth.
CREATE OR REPLACE FUNCTION public.cascade_price_book_to_opportunities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE opportunities o
  SET price_book_id = CASE WHEN NEW.ortpb_is_deleted THEN NULL ELSE NEW.price_book_id END
  WHERE o.opportunity_record_type = NEW.ortpb_record_type_id
    AND o.opportunity_is_deleted IS NOT TRUE
    AND o.price_book_id IS DISTINCT FROM
        (CASE WHEN NEW.ortpb_is_deleted THEN NULL ELSE NEW.price_book_id END);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cascade_price_book_to_opportunities() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cascade_price_book_to_opportunities() FROM anon;
REVOKE ALL ON FUNCTION public.cascade_price_book_to_opportunities() FROM authenticated;

DROP TRIGGER IF EXISTS trg_ortpb_cascade ON public.opportunity_record_type_price_books;
CREATE TRIGGER trg_ortpb_cascade
  AFTER INSERT OR UPDATE ON public.opportunity_record_type_price_books
  FOR EACH ROW EXECUTE FUNCTION public.cascade_price_book_to_opportunities();

-- Backfill existing opportunities from the mapping.
UPDATE opportunities o
SET price_book_id = m.price_book_id
FROM opportunity_record_type_price_books m
WHERE m.ortpb_record_type_id = o.opportunity_record_type
  AND m.ortpb_is_deleted = false
  AND o.opportunity_is_deleted IS NOT TRUE
  AND o.price_book_id IS DISTINCT FROM m.price_book_id;

-- ---------------------------------------------------------------------------
-- 4. Drop the dead name-derivation branch from the line-item defaults trigger.
--    trg_oli_name (20260726200000) fires after trg_oli_defaults and overwrites
--    oli_name unconditionally, so this code never had an effect.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_opportunity_line_item_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pbe_product_id uuid;
  v_pbe_price numeric;
BEGIN
  IF NEW.price_book_entry_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.price_book_entry_id IS DISTINCT FROM OLD.price_book_entry_id) THEN
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

NOTIFY pgrst, 'reload schema';
