-- =============================================================================
-- The two public-facing intake paths REUSE a building's existing opportunity
-- instead of adding a second one.
--
-- Five database functions create opportunities. Three of them already look for
-- an existing one first and reuse it (create_assessment_work_order,
-- create_mf_building_assessment_work_order,
-- create_technician_work_order_for_property). Two never did:
--
--   • create_service_appointment — the public scheduler. Finds-or-creates the
--     property, the building and the unit by address, then unconditionally
--     inserts an opportunity. It supplies no record type, so trg_enforce_record_type
--     stamps the platform default.
--   • create_homes_intake — the NC HOMES intake form. Same shape, with an
--     explicit NC-IRA-SF-HOMES-AUDIT record type.
--
-- So a repeat booking or a second form submission from the same household at
-- the same address reused the building and then created a SECOND opportunity of
-- the same program on it — the exact duplicate the companion migration
-- (one_opportunity_per_building_record_type) now refuses. Left as they were,
-- these two would have started failing for real customers on a public form.
--
-- Reuse is also the correct answer independently of that rule: the second
-- booking is another appointment against the same piece of work, not a second
-- piece of work. Only the OPPORTUNITY is deduplicated here — each submission
-- still gets its own project, appointment and work order, because those are
-- genuinely per-visit.
--
-- Both functions are patched in place from their own live definition rather
-- than re-stated in full: the surrounding bodies (address matching, phone
-- validation, territory locking, the notification pipeline) are long and
-- unrelated, and re-typing them is how an unrelated line gets changed by
-- accident. Each patch asserts its anchor appears exactly once and raises if
-- the function has moved on since.
-- =============================================================================

DO $migration$
DECLARE
  v_def     text;
  v_needle  text;
  v_replace text;
  v_hits    int;
BEGIN
  -- ── create_homes_intake ──────────────────────────────────────────────────
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_homes_intake'
     AND pg_get_function_identity_arguments(p.oid) = 'payload jsonb';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'create_homes_intake(jsonb) not found';
  END IF;

  v_needle :=
$n$  INSERT INTO opportunities (opportunity_record_number, opportunity_name,
                             opportunity_account_id, property_id, building_id,
                             opportunity_record_type, opportunity_stage, opportunity_ami_tier, opportunity_state,
                             opportunity_owner,
                             opportunity_created_at, opportunity_created_by, opportunity_updated_at, opportunity_updated_by)
  VALUES ('', trim(v_first || ' ' || v_last) || ' — ' || v_street,
          v_account_id, v_property_id, v_building_id,
          v_opp_rt, v_stage_id, v_ami_tier_id, v_state,
          v_actor,
          now(), v_actor, now(), v_actor)
  RETURNING id, opportunity_record_number INTO v_opportunity_id, v_opp_record_number;$n$;

  v_replace :=
$r$  -- A building runs each program once. A repeat submission from the same
  -- household at the same address lands on the building that already exists,
  -- so its audit opportunity already exists too — reuse it and hang this
  -- submission's project off it.
  SELECT o.id, o.opportunity_record_number
    INTO v_opportunity_id, v_opp_record_number
    FROM opportunities o
   WHERE o.building_id = v_building_id
     AND o.opportunity_record_type = v_opp_rt
     AND coalesce(o.opportunity_is_deleted, false) = false
   ORDER BY o.opportunity_created_at DESC
   LIMIT 1;

  IF v_opportunity_id IS NULL THEN
    INSERT INTO opportunities (opportunity_record_number, opportunity_name,
                               opportunity_account_id, property_id, building_id,
                               opportunity_record_type, opportunity_stage, opportunity_ami_tier, opportunity_state,
                               opportunity_owner,
                               opportunity_created_at, opportunity_created_by, opportunity_updated_at, opportunity_updated_by)
    VALUES ('', trim(v_first || ' ' || v_last) || ' — ' || v_street,
            v_account_id, v_property_id, v_building_id,
            v_opp_rt, v_stage_id, v_ami_tier_id, v_state,
            v_actor,
            now(), v_actor, now(), v_actor)
    RETURNING id, opportunity_record_number INTO v_opportunity_id, v_opp_record_number;
  END IF;$r$;

  v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'create_homes_intake: expected exactly 1 opportunity INSERT to patch, found %', v_hits;
  END IF;
  EXECUTE replace(v_def, v_needle, v_replace);

  -- ── create_service_appointment ───────────────────────────────────────────
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_service_appointment'
     AND pg_get_function_identity_arguments(p.oid) = 'payload jsonb';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'create_service_appointment(jsonb) not found';
  END IF;

  v_needle :=
$n$  INSERT INTO opportunities (opportunity_record_number, opportunity_name,
                             opportunity_account_id, property_id, building_id, opportunity_owner,
                             opportunity_created_at, opportunity_created_by, opportunity_updated_at, opportunity_updated_by)
  VALUES ('', trim(v_first || ' ' || v_last) || ' — ' || v_street,
          v_account_id, v_property_id, v_building_id, v_admin_id,
          now(), v_admin_id, now(), v_admin_id)
  RETURNING id INTO v_opportunity_id;$n$;

  -- This insert supplies NO record type, so the one it ends up with is
  -- whatever trg_enforce_record_type stamps: the platform default, which is
  -- deliberately a nationwide type (Field Operations since 2026-08-23).
  -- The reuse lookup therefore has to ask for the same thing rather than
  -- naming a program, or a second booking would match nothing and insert
  -- the duplicate anyway.
  v_replace :=
$r$  SELECT o.id
    INTO v_opportunity_id
    FROM opportunities o
   WHERE o.building_id = v_building_id
     AND o.opportunity_record_type = public.default_record_type_for('opportunities')
     AND coalesce(o.opportunity_is_deleted, false) = false
   ORDER BY o.opportunity_created_at DESC
   LIMIT 1;

  IF v_opportunity_id IS NULL THEN
    INSERT INTO opportunities (opportunity_record_number, opportunity_name,
                               opportunity_account_id, property_id, building_id, opportunity_owner,
                               opportunity_created_at, opportunity_created_by, opportunity_updated_at, opportunity_updated_by)
    VALUES ('', trim(v_first || ' ' || v_last) || ' — ' || v_street,
            v_account_id, v_property_id, v_building_id, v_admin_id,
            now(), v_admin_id, now(), v_admin_id)
    RETURNING id INTO v_opportunity_id;
  END IF;$r$;

  v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'create_service_appointment: expected exactly 1 opportunity INSERT to patch, found %', v_hits;
  END IF;
  EXECUTE replace(v_def, v_needle, v_replace);
END
$migration$;
