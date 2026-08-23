-- An opportunity's program state is its property's state — always.
--
-- Nicholas, 2026-08-23, from the New Opportunity pop-up on BLD-00153
-- ("931 Tessie Street - Rocky Mount", a North Carolina building): the picker
-- offered every program in the platform — FOE-2024-WI, the MI set, the WI set —
-- on a North Carolina property. "North Carolina properties only get North
-- Carolina opportunities."
--
-- Two independent root causes, both fixed here.
--
--   1. THE STATE WAS NEVER KNOWN. The record-type picker filters on the state it
--      is handed (picklist_state on each record type, which every program
--      already carries), and the create-prefill seeded that from the parent's
--      own state column. From a property that works; from a BUILDING it does
--      not — building_state is null on 24 of 73 live buildings, including this
--      one, because a building created from a property inherits the address
--      only when the property carried one. With no state the picker falls back
--      to the full list. The state does not belong to the building or to a copy
--      on the opportunity: it belongs to the PROPERTY, and opportunities.
--      property_id is NOT NULL, so it is always resolvable. This migration makes
--      opportunity_state a derived value that follows the property, so nothing
--      downstream has to guess again. 82 of 94 live opportunities carried a null
--      state before this — the column was declared and never maintained.
--
--   2. THE PLATFORM DEFAULT WAS A WISCONSIN PROGRAM. default_record_type_for
--      ('opportunities') resolved to FOE-2024-WI, and enforce_rt__opportunities
--      stamps it on any opportunity inserted without a record type — which is
--      what create_service_appointment (the public scheduler) does. That is how
--      OPP-00132/133/134/135/140 came to run a Wisconsin 2024 program on
--      properties in Huntersville, North Carolina. A platform-wide fallback
--      cannot be state-specific; the flag moves to Field Operations, the
--      nationwide record type that exists for exactly this purpose.
--
-- Then the guarantee itself: a record type scoped to one state can never be
-- saved on a property in another. Pre-existing mismatches are grandfathered
-- (the trigger fires only when the record type or the property actually
-- changes) so the five rows above stay editable while Nicholas decides what
-- program they should have been.

-- ---------------------------------------------------------------------------
-- 1. opportunity_state follows the property.
--    Same shape as sync_opportunity_account_from_property (20260709130000) —
--    the sibling rule that an opportunity's account always equals its
--    property's. SECURITY DEFINER with anon/authenticated revoked so RLS on
--    properties can never make the sync silently skip.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_opportunity_state_from_property()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_property_state text;
BEGIN
  IF NEW.property_id IS NOT NULL THEN
    SELECT property_state INTO v_property_state
      FROM public.properties WHERE id = NEW.property_id;
    IF v_property_state IS NOT NULL
       AND NEW.opportunity_state IS DISTINCT FROM v_property_state THEN
      NEW.opportunity_state := v_property_state;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_opportunity_state_from_property() FROM public, anon, authenticated;

-- trg_0_* deliberately: Postgres fires BEFORE triggers in name order, and this
-- has to land before trg_enforce_record_type / trg_zz_* below read the state.
DROP TRIGGER IF EXISTS trg_0_opportunity_state_follows_property ON public.opportunities;
CREATE TRIGGER trg_0_opportunity_state_follows_property
  BEFORE INSERT OR UPDATE OF property_id, opportunity_state ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.sync_opportunity_state_from_property();

-- A property moving state carries its opportunities with it, exactly as
-- cascade_property_account_to_opportunities does for the account.
CREATE OR REPLACE FUNCTION public.cascade_property_state_to_opportunities()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NEW.property_state IS DISTINCT FROM OLD.property_state THEN
    UPDATE public.opportunities
       SET opportunity_state = NEW.property_state
     WHERE property_id = NEW.id
       AND opportunity_is_deleted IS NOT TRUE
       AND opportunity_state IS DISTINCT FROM NEW.property_state;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cascade_property_state_to_opportunities() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_properties_state_cascades_to_opportunities ON public.properties;
CREATE TRIGGER trg_properties_state_cascades_to_opportunities
  AFTER UPDATE OF property_state ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.cascade_property_state_to_opportunities();

-- ---------------------------------------------------------------------------
-- 2. Backfill the 82 opportunities whose state was never written.
--
--    session_replication_role = replica so the audit logger does not record a
--    migration as if a person had edited each record (same reasoning as the
--    20260822225224 audit backfill), and so the stamping trigger does not
--    rewrite every updated_at.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n integer;
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE public.opportunities o
     SET opportunity_state = p.property_state
    FROM public.properties p
   WHERE p.id = o.property_id
     AND p.property_state IS NOT NULL
     AND o.opportunity_state IS DISTINCT FROM p.property_state;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'opportunity_state backfilled on % rows', v_n;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The platform-wide fallback record type must be nationwide.
--    One default per object is enforced by picklist_one_default_rt_per_object,
--    so clear and set in a single statement.
-- ---------------------------------------------------------------------------
UPDATE public.picklist_values
   SET picklist_is_default_record_type = (picklist_value = 'FIELD-OPERATIONS')
 WHERE picklist_object = 'opportunities'
   AND picklist_field  = 'record_type'
   AND (picklist_is_default_record_type OR picklist_value = 'FIELD-OPERATIONS');

-- ---------------------------------------------------------------------------
-- 4. The guarantee. A state-scoped record type is only valid on a property in
--    that state; a nationwide record type (picklist_state IS NULL — Field
--    Operations) is valid anywhere; a property with no state constrains
--    nothing.
--
--    Modeled on enforce_assessment_record_type_eligibility (20260822213503):
--    permissive by default, descriptive on rejection, and the client filters
--    the same rule so the wrong program is never OFFERED in the first place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunity_record_type_allowed_for_state(
  p_record_type uuid,
  p_state       text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT p_record_type IS NULL
      OR p_state IS NULL
      OR EXISTS (
           SELECT 1 FROM public.picklist_values pv
            WHERE pv.id = p_record_type
              AND (pv.picklist_state IS NULL OR pv.picklist_state = p_state)
         );
$$;

-- Server-side only: the trigger below is its only caller, and the client
-- filters the same rule from picklist_state on the record types it already
-- loads. Granting authenticated would add a security-definer advisor lint for
-- an entry point nothing uses.
REVOKE ALL ON FUNCTION public.opportunity_record_type_allowed_for_state(uuid, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_opportunity_record_type_state()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_state    text;
  v_rt_state text;
  v_rt_label text;
  v_allowed  text;
BEGIN
  -- Grandfathered: an UPDATE that leaves both the record type and the property
  -- alone is never blocked, so the rows that predate this rule stay editable.
  IF TG_OP = 'UPDATE'
     AND NEW.opportunity_record_type IS NOT DISTINCT FROM OLD.opportunity_record_type
     AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id THEN
    RETURN NEW;
  END IF;

  IF NEW.opportunity_record_type IS NULL OR NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT property_state INTO v_state FROM public.properties WHERE id = NEW.property_id;
  IF v_state IS NULL THEN RETURN NEW; END IF;

  SELECT picklist_state, picklist_label INTO v_rt_state, v_rt_label
    FROM public.picklist_values WHERE id = NEW.opportunity_record_type;

  IF v_rt_state IS NULL OR v_rt_state = v_state THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
    INTO v_allowed
    FROM public.picklist_values pv
   WHERE pv.picklist_object = 'opportunities' AND pv.picklist_field = 'record_type'
     AND pv.picklist_is_active
     AND (pv.picklist_state IS NULL OR pv.picklist_state = v_state);

  RAISE EXCEPTION
    'Opportunity record type "%" runs in % and this property is in %. Available in %: %.',
    COALESCE(v_rt_label, '(unknown)'), v_rt_state, v_state, v_state,
    COALESCE(v_allowed, '(none configured)');
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_opportunity_record_type_state() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_opportunity_record_type_state ON public.opportunities;
CREATE TRIGGER trg_zz_opportunity_record_type_state
  BEFORE INSERT OR UPDATE OF opportunity_record_type, property_id ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.enforce_opportunity_record_type_state();

NOTIFY pgrst, 'reload schema';
