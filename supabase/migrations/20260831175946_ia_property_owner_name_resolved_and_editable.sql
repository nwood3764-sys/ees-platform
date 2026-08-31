-- The assessment application's "Property Owner Name" is a field of its own, and
-- it resolves the owner from BOTH places a property records one.
--
-- Reported alongside the Building Improvements gap: on IA-00042 (779 Maple
-- Avenue - Columbus) the REQUIRED "Property Owner Name" was blank, on a property
-- whose owner is plainly on screen -- Lutheran Social Services of Wisconsin and
-- Upper Michigan, Inc.
--
-- Two faults, and the second is the one that mattered:
--
--   1. The layout bound the field to properties.property_hud_owner_org through a
--      cross-object related field. That column is populated by the HUD import and
--      is NULL on every property created in LEAP by hand, which carries its owner
--      as an ACCOUNT on properties.property_account_id. Identical to the defect
--      fixed for the pre-approval prefill in 20260831173157 -- same two sources,
--      same wrong one read. Fixed here the same way and in the same order: the
--      HUD owner organization still wins wherever it is present (it names the
--      entity owning THAT property and can be narrower than the account -- e.g.
--      PROP-23587 is HUD-owned by "LSS HOUSING, INC." under the parent LSS
--      account); the owner account's name is used only where HUD says nothing.
--
--   2. A related field is READ-ONLY. So the blank was a dead end, not merely a
--      wrong answer -- there was no way to type the owner in even after seeing it
--      was missing, and no column for a user to correct a resolved value that is
--      wrong for a particular application. The application mirrors a form field
--      that a person must be able to answer, so it gets a real, editable column.
--
-- Deliberately NOT ia_business_entity_name: that is a different form's field
-- (it appears on the HEAR/HOMES installation layouts), it is an INHERITED field
-- with a single source (the owner account) so it cannot express the HUD
-- precedence above, and inherited fields are read-only for the same reason (2).

ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_property_owner_name text;

COMMENT ON COLUMN public.incentive_applications.ia_property_owner_name IS
  'Property Owner Name as it goes on the program application. Derived on write from the property''s HUD owner organization, else its owner account name; editable, and an entered value is never overwritten.';

CREATE OR REPLACE FUNCTION public.derive_incentive_application_property_owner_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Only ever FILLS a blank. A value typed by a person -- or one carried by an
  -- earlier write -- is left exactly as it is.
  IF NULLIF(BTRIM(NEW.ia_property_owner_name), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
           NULLIF(BTRIM(p.property_hud_owner_org), ''),
           NULLIF(BTRIM(a.account_name), ''))
    INTO NEW.ia_property_owner_name
    FROM public.properties p
    LEFT JOIN public.accounts a
      ON a.id = p.property_account_id
     AND a.account_is_deleted IS NOT TRUE      -- a soft-deleted account names nobody
   WHERE p.id = NEW.property_id
     AND p.property_is_deleted IS NOT TRUE;

  RETURN NEW;
END
$function$;

-- SECURITY DEFINER so the resolution does not depend on the writer being able to
-- read the property's owner account, and so it cannot be defeated by a state
-- scope. It is a trigger function: PostgreSQL does not check EXECUTE when it
-- FIRES a trigger, so the grant is revoked (see the 2026-08-31 rule that
-- promoting a trigger function to SECURITY DEFINER must revoke EXECUTE in the
-- same migration, or it becomes a callable definer function and an advisor lint).
REVOKE ALL ON FUNCTION public.derive_incentive_application_property_owner_name() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.derive_incentive_application_property_owner_name() FROM anon;
REVOKE ALL ON FUNCTION public.derive_incentive_application_property_owner_name() FROM authenticated;

-- trg_2_* so it runs after trg_1_ia_inherit_from_enrollment (the enrollment
-- inheritance) and before the trg_zz_* enforcement pair.
DROP TRIGGER IF EXISTS trg_2_ia_property_owner_name ON public.incentive_applications;
CREATE TRIGGER trg_2_ia_property_owner_name
  BEFORE INSERT OR UPDATE ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.derive_incentive_application_property_owner_name();

-- Backfill every live application that has a property to resolve from, under
-- session_replication_role = replica so this migration does not appear in
-- audit_log as a person editing each record, and does not restamp ia_updated_*.
DO $$
DECLARE
  v_filled integer;
  v_blank  integer;
BEGIN
  SET LOCAL session_replication_role = replica;

  UPDATE public.incentive_applications ia
     SET ia_property_owner_name = src.owner_name
    FROM (
      SELECT ia2.id AS ia_id,
             COALESCE(NULLIF(BTRIM(p.property_hud_owner_org), ''),
                      NULLIF(BTRIM(a.account_name), '')) AS owner_name
        FROM public.incentive_applications ia2
        JOIN public.properties p ON p.id = ia2.property_id AND p.property_is_deleted IS NOT TRUE
        LEFT JOIN public.accounts a ON a.id = p.property_account_id AND a.account_is_deleted IS NOT TRUE
       WHERE ia2.ia_is_deleted IS NOT TRUE
         AND NULLIF(BTRIM(ia2.ia_property_owner_name), '') IS NULL
    ) src
   WHERE ia.id = src.ia_id
     AND src.owner_name IS NOT NULL;

  GET DIAGNOSTICS v_filled = ROW_COUNT;

  SET LOCAL session_replication_role = origin;

  SELECT count(*) INTO v_blank
    FROM public.incentive_applications ia
    JOIN public.picklist_values rt ON rt.id = ia.ia_record_type
   WHERE rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
     AND ia.ia_is_deleted IS NOT TRUE
     AND NULLIF(BTRIM(ia.ia_property_owner_name), '') IS NULL;

  RAISE NOTICE 'Property Owner Name backfilled on % application(s); % audit application(s) still blank', v_filled, v_blank;

  IF v_blank > 0 THEN
    RAISE EXCEPTION 'Every audit application should resolve an owner; % did not', v_blank;
  END IF;
END $$;

-- Point the layout at the new field. The related field is REPLACED in place, so
-- it keeps its position (first field of "Assessment Details"), its form label and
-- its column; only the binding changes -- from a read-only parent column that is
-- null on hand-created properties, to the application's own resolved field.
DO $$
DECLARE
  v_widget uuid;
  v_cfg    jsonb;
  v_new    jsonb;
BEGIN
  SELECT w.id, w.widget_config INTO v_widget, v_cfg
    FROM public.page_layouts pl
    JOIN public.picklist_values pv ON pv.id = pl.record_type_id
    JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
    JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
   WHERE pl.page_layout_object = 'incentive_applications'
     AND pl.is_deleted IS NOT TRUE
     AND pv.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
     AND s.section_label = 'Assessment Details - Individual Multifamily Building'
     AND w.widget_type = 'field_group'
   LIMIT 1;

  IF v_widget IS NULL THEN
    RAISE EXCEPTION 'Audit application Assessment Details field group not found';
  END IF;

  SELECT jsonb_build_object('fields', jsonb_agg(
           CASE WHEN f->>'name' = 'property_id.property_hud_owner_org'
                THEN jsonb_build_object(
                       'name',      'ia_property_owner_name',
                       'type',      'text',
                       'label',     'Property Owner Name',
                       'column',    f->'column',
                       'required',  true,
                       'help_text', 'Business entity name, or the first and last name of an individual owner. Filled in from the property''s owner; edit it if this application needs a different name.')
                ELSE f END
           ORDER BY ord))
    INTO v_new
    FROM jsonb_array_elements(v_cfg->'fields') WITH ORDINALITY t(f, ord);

  IF NOT (v_new -> 'fields') @> '[{"name":"ia_property_owner_name"}]'::jsonb THEN
    RAISE EXCEPTION 'Property Owner Name was not rebound on the audit layout';
  END IF;
  IF (v_new -> 'fields') @> '[{"name":"property_id.property_hud_owner_org"}]'::jsonb THEN
    RAISE EXCEPTION 'The read-only HUD owner field is still on the audit layout';
  END IF;

  UPDATE public.page_layout_widgets
     SET widget_config = v_cfg || v_new, updated_at = now()
   WHERE id = v_widget;
END $$;

-- A new column is invisible to PostgREST (and therefore to the record page and
-- to describe_object_columns) until the schema cache is reloaded.
NOTIFY pgrst, 'reload schema';
