-- The application's Property Owner Name follows the property's OWNER ACCOUNT,
-- and keeps following it.
--
-- Reported (Nicholas, 2026-09-01), preparing the WI IRA Multifamily HOMES AUDIT
-- application on PROP-07530 "570 South Clark Street - Whitewater": he corrected
-- the owner on the property record to "Lutheran Social Services of Wisconsin and
-- Upper Michigan, Inc." and the application went on reading "Independence of
-- Wisconsin, Inc." -- "any update on the property record needs to flow to all
-- child objects."
--
-- TWO faults, stacked. Either one alone reproduces the report.
--
--   1. THE WRONG SOURCE WON. 20260831175946 resolved the name from
--      properties.property_hud_owner_org FIRST and used the owner account's name
--      only where HUD said nothing. On PROP-07530 the HUD import still says
--      "Independence of Wisconsin, Inc." -- so the account Nicholas set was never
--      even consulted. Ruled (Nicholas, 2026-09-01): "it needs to come from the
--      property object owner account, not the HUD owner org." That is also the
--      only rule consistent with ONE ACCOUNT PER REAL-WORLD COMPANY: ownership is
--      recorded in exactly one place -- properties.property_account_id -- and a
--      stale import column is not a second opinion about it. Where the HUD file
--      names a narrower entity than the account (PROP-23587 is HUD-owned by
--      "LSS HOUSING, INC." under the parent LSS account), the fix is to point the
--      property at that account, which is a thing a person can see and correct;
--      it is not a hidden precedence rule inside a trigger. property_hud_owner_org
--      keeps its own job -- it is what HUD said -- and is no longer consulted here.
--
--   2. IT WAS WRITTEN ONCE AND NEVER RE-READ. The old function returned early
--      whenever the column already held anything, so it could only ever fill a
--      blank, and nothing on the property or the account cascaded down. Even with
--      the source order corrected, the value Nicholas was looking at would not
--      have moved.
--
-- The shape that fixes both, and is the reason this is not simply an Inherited
-- Field: the application mirrors a form a person signs, so a person must be able
-- to correct the name for ONE application (that is why 20260831175946 gave it a
-- real column instead of binding ia_business_entity_name, which is inherited and
-- therefore read-only). So the field INHERITS UNTIL IT IS OVERRIDDEN:
--
--   * left alone, it always equals the owner account's name -- on create, on
--     every later save, and when the property or the account changes underneath it;
--   * type a different name and that application is marked overridden and is
--     never rewritten;
--   * clear it and it goes back to inheriting.
--
-- Deliberately NOT cascaded onto an application whose status LOCKS the record
-- (Submitted / Approved / Denied / Withdrawn). The name on a submitted
-- application is the name that was submitted; rewriting it underneath the
-- program's copy would make LEAP disagree with the filing. That is the same
-- boundary enforce_status_lock_incentive_applications already draws, applied
-- before the write rather than as an exception raised in the middle of somebody
-- renaming an account.

-- ---------------------------------------------------------------------------
-- 1. The override marker
-- ---------------------------------------------------------------------------

ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_property_owner_name_is_overridden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.incentive_applications.ia_property_owner_name_is_overridden IS
  'TRUE when a person typed a Property Owner Name that differs from the property owner account''s name. Set and cleared by trg_2_ia_property_owner_name -- never written by hand. While FALSE the field follows the owner account; while TRUE it is never rewritten. Clearing the name clears this flag and resumes inheritance.';

COMMENT ON COLUMN public.incentive_applications.ia_property_owner_name IS
  'Property Owner Name as it goes on the program application. Inherits the property owner account''s name (properties.property_account_id -> accounts.account_name) and keeps following it; type a different name to override it for this application, clear it to resume inheriting.';

-- ---------------------------------------------------------------------------
-- 2. One definition of the rule
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the answer does not depend on the writer being able to
-- read the owner account, and so a state scope cannot silently turn it into
-- NULL. EXECUTE is revoked: it is called only from the trigger functions below,
-- which are themselves definers.

CREATE OR REPLACE FUNCTION public.resolve_property_owner_name(p_property_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT NULLIF(BTRIM(a.account_name), '')
    FROM public.properties p
    JOIN public.accounts a
      ON a.id = p.property_account_id
     AND a.account_is_deleted IS NOT TRUE     -- a soft-deleted account names nobody
   WHERE p.id = p_property_id
     AND p.property_is_deleted IS NOT TRUE;
$function$;

REVOKE ALL ON FUNCTION public.resolve_property_owner_name(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_property_owner_name(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_property_owner_name(uuid) FROM authenticated;

COMMENT ON FUNCTION public.resolve_property_owner_name(uuid) IS
  'The owner of a property, by name: its owner account. The single definition used by the application field and by both cascades, so the three can never drift.';

-- ---------------------------------------------------------------------------
-- 3. Inherit until overridden
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.derive_incentive_application_property_owner_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_derived text;
  v_typed   boolean;
BEGIN
  v_derived := public.resolve_property_owner_name(NEW.property_id);

  -- Did THIS statement write the field? On an insert, any value is a written
  -- value; on an update, only a value that differs from the row as it stood.
  v_typed := (TG_OP = 'INSERT')
             OR (NEW.ia_property_owner_name IS DISTINCT FROM OLD.ia_property_owner_name);

  IF v_typed THEN
    IF NULLIF(BTRIM(NEW.ia_property_owner_name), '') IS NULL THEN
      -- Cleared: resume inheriting.
      NEW.ia_property_owner_name := v_derived;
      NEW.ia_property_owner_name_is_overridden := false;
    ELSE
      -- A name that matches the owner account is not an override -- it is the
      -- same answer, and must keep following the account if the account changes.
      NEW.ia_property_owner_name_is_overridden :=
        (BTRIM(NEW.ia_property_owner_name) IS DISTINCT FROM v_derived);
    END IF;
    RETURN NEW;
  END IF;

  -- The field was not written. Refresh it from the owner account unless this
  -- application carries an override. A resolved name never gets blanked: if the
  -- property has no owner account to read, the last known name stands rather
  -- than emptying a required field on a form somebody is filling in.
  IF COALESCE(NEW.ia_property_owner_name_is_overridden, false) IS FALSE
     AND v_derived IS NOT NULL THEN
    NEW.ia_property_owner_name := v_derived;
  END IF;

  RETURN NEW;
END
$function$;

-- PostgreSQL does not check EXECUTE when it FIRES a trigger, so the grant is
-- revoked (2026-08-31 rule: promoting a trigger function to SECURITY DEFINER
-- must revoke EXECUTE in the same migration, or it becomes a callable definer
-- function and an advisor lint).
REVOKE ALL ON FUNCTION public.derive_incentive_application_property_owner_name() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.derive_incentive_application_property_owner_name() FROM anon;
REVOKE ALL ON FUNCTION public.derive_incentive_application_property_owner_name() FROM authenticated;

-- trg_2_* (unchanged): after trg_1_ia_inherit_from_enrollment, before the
-- trg_zz_* enforcement pair.
DROP TRIGGER IF EXISTS trg_2_ia_property_owner_name ON public.incentive_applications;
CREATE TRIGGER trg_2_ia_property_owner_name
  BEFORE INSERT OR UPDATE ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.derive_incentive_application_property_owner_name();

-- ---------------------------------------------------------------------------
-- 4. The cascades -- what makes an update on the property reach the child
-- ---------------------------------------------------------------------------
-- Both TOUCH the child (SET property_id = property_id) rather than writing the
-- name themselves, so the rule above stays the only writer of the column and
-- the two can never disagree. That is the shape cascade_derived_name already
-- uses to carry property_name down to five child objects.

CREATE OR REPLACE FUNCTION public.cascade_property_owner_to_incentive_applications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_derived text;
BEGIN
  IF NEW.property_account_id IS NOT DISTINCT FROM OLD.property_account_id THEN
    RETURN NULL;
  END IF;

  v_derived := public.resolve_property_owner_name(NEW.id);
  IF v_derived IS NULL THEN
    RETURN NULL;                              -- never blank a resolved name
  END IF;

  UPDATE public.incentive_applications ia
     SET property_id = ia.property_id
   WHERE ia.property_id = NEW.id
     AND ia.ia_is_deleted IS NOT TRUE
     AND COALESCE(ia.ia_property_owner_name_is_overridden, false) IS FALSE
     AND ia.ia_property_owner_name IS DISTINCT FROM v_derived
     AND NOT EXISTS (SELECT 1 FROM public.picklist_values pv
                      WHERE pv.id = ia.ia_status AND pv.picklist_locks_record IS TRUE);

  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.cascade_property_owner_to_incentive_applications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cascade_property_owner_to_incentive_applications() FROM anon;
REVOKE ALL ON FUNCTION public.cascade_property_owner_to_incentive_applications() FROM authenticated;

DROP TRIGGER IF EXISTS trg_property_owner_cascades_to_incentive_applications ON public.properties;
CREATE TRIGGER trg_property_owner_cascades_to_incentive_applications
  AFTER UPDATE OF property_account_id ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.cascade_property_owner_to_incentive_applications();

-- Renaming the owner account is the same fact arriving by the other door: the
-- application names an account, so it has to follow that account's name too.
CREATE OR REPLACE FUNCTION public.cascade_account_name_to_incentive_applications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_derived text;
BEGIN
  IF NEW.account_name IS NOT DISTINCT FROM OLD.account_name THEN
    RETURN NULL;
  END IF;

  v_derived := NULLIF(BTRIM(NEW.account_name), '');
  IF v_derived IS NULL OR NEW.account_is_deleted IS TRUE THEN
    RETURN NULL;
  END IF;

  UPDATE public.incentive_applications ia
     SET property_id = ia.property_id
    FROM public.properties p
   WHERE p.id = ia.property_id
     AND p.property_account_id = NEW.id
     AND p.property_is_deleted IS NOT TRUE
     AND ia.ia_is_deleted IS NOT TRUE
     AND COALESCE(ia.ia_property_owner_name_is_overridden, false) IS FALSE
     AND ia.ia_property_owner_name IS DISTINCT FROM v_derived
     AND NOT EXISTS (SELECT 1 FROM public.picklist_values pv
                      WHERE pv.id = ia.ia_status AND pv.picklist_locks_record IS TRUE);

  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.cascade_account_name_to_incentive_applications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cascade_account_name_to_incentive_applications() FROM anon;
REVOKE ALL ON FUNCTION public.cascade_account_name_to_incentive_applications() FROM authenticated;

DROP TRIGGER IF EXISTS trg_account_name_cascades_to_incentive_applications ON public.accounts;
CREATE TRIGGER trg_account_name_cascades_to_incentive_applications
  AFTER UPDATE OF account_name ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.cascade_account_name_to_incentive_applications();

-- ---------------------------------------------------------------------------
-- 5. Backfill -- and an honest reading of what is already there
-- ---------------------------------------------------------------------------
-- Every live application is re-resolved from its owner account. A value that
-- matches NEITHER the owner account NOR what the old HUD-first rule would have
-- produced can only have been typed by a person, so it is kept and marked
-- overridden rather than silently replaced. Runs under
-- session_replication_role = replica so this does not appear in audit_log as a
-- person editing each record, and does not restamp ia_updated_*.

DO $$
DECLARE
  v_refreshed  integer;
  v_overridden integer;
  v_blank      integer;
BEGIN
  SET LOCAL session_replication_role = replica;

  UPDATE public.incentive_applications ia
     SET ia_property_owner_name_is_overridden = true
    FROM public.properties p
    LEFT JOIN public.accounts a
      ON a.id = p.property_account_id AND a.account_is_deleted IS NOT TRUE
   WHERE p.id = ia.property_id
     AND p.property_is_deleted IS NOT TRUE
     AND ia.ia_is_deleted IS NOT TRUE
     AND NULLIF(BTRIM(ia.ia_property_owner_name), '') IS NOT NULL
     AND BTRIM(ia.ia_property_owner_name) IS DISTINCT FROM NULLIF(BTRIM(a.account_name), '')
     AND BTRIM(ia.ia_property_owner_name) IS DISTINCT FROM
         COALESCE(NULLIF(BTRIM(p.property_hud_owner_org), ''), NULLIF(BTRIM(a.account_name), ''));

  GET DIAGNOSTICS v_overridden = ROW_COUNT;

  UPDATE public.incentive_applications ia
     SET ia_property_owner_name = a.account_name
    FROM public.properties p
    JOIN public.accounts a
      ON a.id = p.property_account_id AND a.account_is_deleted IS NOT TRUE
   WHERE p.id = ia.property_id
     AND p.property_is_deleted IS NOT TRUE
     AND ia.ia_is_deleted IS NOT TRUE
     AND COALESCE(ia.ia_property_owner_name_is_overridden, false) IS FALSE
     AND NULLIF(BTRIM(a.account_name), '') IS NOT NULL
     AND ia.ia_property_owner_name IS DISTINCT FROM a.account_name;

  GET DIAGNOSTICS v_refreshed = ROW_COUNT;

  SET LOCAL session_replication_role = origin;

  SELECT count(*) INTO v_blank
    FROM public.incentive_applications ia
    JOIN public.picklist_values rt ON rt.id = ia.ia_record_type
   WHERE rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
     AND ia.ia_is_deleted IS NOT TRUE
     AND NULLIF(BTRIM(ia.ia_property_owner_name), '') IS NULL;

  RAISE NOTICE 'Property Owner Name: % application(s) refreshed from the owner account, % kept as a typed override, % audit application(s) blank',
    v_refreshed, v_overridden, v_blank;

  IF v_blank > 0 THEN
    RAISE EXCEPTION 'Every audit application should name an owner; % did not', v_blank;
  END IF;
END $$;

-- Nothing may still disagree with its owner account unless it says it is an override.
DO $$
DECLARE v_drift integer;
BEGIN
  SELECT count(*) INTO v_drift
    FROM public.incentive_applications ia
    JOIN public.properties p ON p.id = ia.property_id AND p.property_is_deleted IS NOT TRUE
    JOIN public.accounts a ON a.id = p.property_account_id AND a.account_is_deleted IS NOT TRUE
   WHERE ia.ia_is_deleted IS NOT TRUE
     AND COALESCE(ia.ia_property_owner_name_is_overridden, false) IS FALSE
     AND ia.ia_property_owner_name IS DISTINCT FROM a.account_name;

  IF v_drift > 0 THEN
    RAISE EXCEPTION '% application(s) still disagree with their property owner account', v_drift;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Say so on the form
-- ---------------------------------------------------------------------------
-- The help text promised "filled in from the property's owner", which was true
-- only of the first save. It now describes what the field actually does, on
-- every layout that carries it.

DO $$
DECLARE
  r        record;
  v_new    jsonb;
  v_hits   integer := 0;
BEGIN
  FOR r IN
    SELECT w.id, w.widget_config
      FROM public.page_layouts pl
      JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
      JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
     WHERE pl.page_layout_object = 'incentive_applications'
       AND pl.is_deleted IS NOT TRUE
       AND w.widget_type = 'field_group'
       AND w.widget_config -> 'fields' @> '[{"name":"ia_property_owner_name"}]'::jsonb
  LOOP
    SELECT jsonb_build_object('fields', jsonb_agg(
             CASE WHEN f->>'name' = 'ia_property_owner_name'
                  THEN f || jsonb_build_object(
                         'help_text', 'Business entity name, or the first and last name of an individual owner. Follows the property''s owner account; type a different name to use it on this application only, or clear it to go back to the owner account.')
                  ELSE f END
             ORDER BY ord))
      INTO v_new
      FROM jsonb_array_elements(r.widget_config->'fields') WITH ORDINALITY t(f, ord);

    UPDATE public.page_layout_widgets
       SET widget_config = r.widget_config || v_new, updated_at = now()
     WHERE id = r.id;

    v_hits := v_hits + 1;
  END LOOP;

  IF v_hits = 0 THEN
    RAISE EXCEPTION 'Property Owner Name is not on any incentive application layout';
  END IF;
  RAISE NOTICE 'Property Owner Name help text corrected on % field group(s)', v_hits;
END $$;

-- A new column is invisible to PostgREST (and therefore to the record page and
-- to describe_object_columns) until the schema cache is reloaded.
NOTIFY pgrst, 'reload schema';
