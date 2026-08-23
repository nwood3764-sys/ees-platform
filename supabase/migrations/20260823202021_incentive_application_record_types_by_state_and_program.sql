-- An incentive application's record type is decided by WHERE the property is
-- and WHICH program the opportunity runs — never by the platform default.
--
-- Nicholas, 2026-08-23, straight after the same fix landed on opportunities:
-- "users should only see state specific record types filtered by building and
-- property addresses… so NC properties only see NC incentive record types.
-- Also these need to be also tied to opportunity record types, not any
-- incentive record type should be able to be created for any opportunity
-- record type," and then: "this is similar to assessments also."
--
-- It is the same two rules assessments got on 2026-08-22 (20260822213141 +
-- 20260822213503), applied to the object that had neither:
--
--   1. STATE. Every one of the nine active incentive application record types
--      carried picklist_state = NULL, so every one of them was nationwide by
--      declaration. Eight are Wisconsin programs (WI-FOE and the seven WI-IRA-*
--      forms) and the ninth, Electrify Denver, is Colorado's — and it is the
--      flagged platform DEFAULT, so enforce_rt__incentive_applications stamps a
--      Colorado program on any application inserted without a record type.
--      3,912 live properties are in North Carolina and 2,440 in Michigan; all of
--      them were being offered Wisconsin's forms.
--
--   2. PROGRAM. Which application belongs to which program was nowhere in the
--      database — a WI-IRA-SF-HEAR application could be created on a
--      WI-IRA-MF-HOMES opportunity. record_type_eligibility is exactly this
--      shape and already governs assessments under opportunities; this extends
--      it to incentive applications and seeds one edge per program.
--
-- North Carolina and Michigan each run the same six IRA programs as Wisconsin
-- (their opportunity record types exist and are in use), so their application
-- record types are mirrored from Wisconsin's and their layouts cloned — Nicholas
-- on the assessment equivalent: "Each state needs its own record types. We don't
-- share record types. We don't share page layouts. We don't share anything
-- between states. Copy what we're doing in Wisconsin, then we'll modify what is
-- needed."
--
-- Deliberately NOT mirrored:
--   • WI-FOE — Focus on Energy is a Wisconsin utility program. It has no
--     counterpart in another state, so it stays Wisconsin-only and is bound to
--     the three FOE-*-WI opportunity record types.
--   • WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST — the Wisconsin HOMES payment
--     request form. Whether North Carolina's and Michigan's HOMES programs use a
--     separate payment-request application, and what it asks for, is a program
--     fact nobody here knows. Mirroring it would be inventing a form.
--   • ELECTRIFY-DENVER — scoped to CO. No Colorado opportunity record type
--     exists yet, so it gets no program edge; it appears when Colorado's
--     program does.

-- ---------------------------------------------------------------------------
-- 1. State-scope the record types that already exist.
--
--    Enumerated rather than matched on the 'WI-' name prefix: a record type's
--    state is a fact about the program, and inferring it from a naming
--    convention is the kind of guess that puts a form in the wrong state the
--    first time someone names one differently.
-- ---------------------------------------------------------------------------
UPDATE public.picklist_values
   SET picklist_state = 'WI'
 WHERE picklist_object = 'incentive_applications'
   AND picklist_field  = 'record_type'
   AND picklist_value IN (
     'WI-FOE',
     'WI-IRA-MF-HEAR',
     'WI-IRA-MF-HOMES',
     'WI-IRA-MF-HOMES-AUDIT',
     'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST',
     'WI-IRA-SF-HEAR',
     'WI-IRA-SF-HOMES',
     'WI-IRA-SF-HOMES-AUDIT'
   )
   AND picklist_state IS DISTINCT FROM 'WI';

UPDATE public.picklist_values
   SET picklist_state = 'CO'
 WHERE picklist_object = 'incentive_applications'
   AND picklist_field  = 'record_type'
   AND picklist_value  = 'ELECTRIFY-DENVER'
   AND picklist_state IS DISTINCT FROM 'CO';

-- ---------------------------------------------------------------------------
-- 2. The platform default must not be one state's program.
--
--    Same defect the opportunity work found in FOE-2024-WI (20260823002712):
--    default_record_type_for() is a single global value with no idea where the
--    record is, and enforce_rt__incentive_applications stamps it on every
--    insert that arrives without a record type. On opportunities the flag could
--    move to Field Operations, the nationwide type that exists for exactly this
--    purpose. There is no such type here — an incentive application is ALWAYS
--    some program's application — so this object simply has no default, and
--    part 4 below derives the right one from the opportunity instead.
--
--    Note default_record_type_for() still falls back to the first active type by
--    sort order when no flag is set. That is why the guardrail in part 5 is the
--    actual guarantee: a wrong-state stamp is rejected, not quietly accepted.
-- ---------------------------------------------------------------------------
UPDATE public.picklist_values
   SET picklist_is_default_record_type = false
 WHERE picklist_object = 'incentive_applications'
   AND picklist_field  = 'record_type'
   AND picklist_is_default_record_type;

-- ---------------------------------------------------------------------------
-- 3. Mirror Wisconsin's six IRA application types into North Carolina and
--    Michigan, with their page layouts, and bind every program to its own
--    application form.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_actor     uuid;
  v_spec      record;
  v_source_rt uuid;
  v_source_pl uuid;
  v_new_rt    uuid;
  v_sort      integer;
  v_made_rt   integer := 0;
  v_made_pl   integer := 0;
  v_edges     integer := 0;
BEGIN
  SELECT id INTO v_actor FROM public.users
   WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Owner user not found — refusing to seed record types without an owner.';
  END IF;

  FOR v_spec IN
    SELECT * FROM (VALUES
      ('NC-IRA-MF-HEAR',        'NC', 'WI-IRA-MF-HEAR'),
      ('NC-IRA-MF-HOMES',       'NC', 'WI-IRA-MF-HOMES'),
      ('NC-IRA-MF-HOMES-AUDIT', 'NC', 'WI-IRA-MF-HOMES-AUDIT'),
      ('NC-IRA-SF-HEAR',        'NC', 'WI-IRA-SF-HEAR'),
      ('NC-IRA-SF-HOMES',       'NC', 'WI-IRA-SF-HOMES'),
      ('NC-IRA-SF-HOMES-AUDIT', 'NC', 'WI-IRA-SF-HOMES-AUDIT'),
      ('MI-IRA-MF-HEAR',        'MI', 'WI-IRA-MF-HEAR'),
      ('MI-IRA-MF-HOMES',       'MI', 'WI-IRA-MF-HOMES'),
      ('MI-IRA-MF-HOMES-AUDIT', 'MI', 'WI-IRA-MF-HOMES-AUDIT'),
      ('MI-IRA-SF-HEAR',        'MI', 'WI-IRA-SF-HEAR'),
      ('MI-IRA-SF-HOMES',       'MI', 'WI-IRA-SF-HOMES'),
      ('MI-IRA-SF-HOMES-AUDIT', 'MI', 'WI-IRA-SF-HOMES-AUDIT')
    ) AS t(new_value, new_state, source_value)
  LOOP
    SELECT id INTO v_source_rt
      FROM public.picklist_values
     WHERE picklist_object = 'incentive_applications'
       AND picklist_field  = 'record_type'
       AND picklist_value  = v_spec.source_value
       AND picklist_is_active
     LIMIT 1;

    IF v_source_rt IS NULL THEN
      RAISE EXCEPTION 'Source incentive application record type % not found or inactive.',
        v_spec.source_value;
    END IF;

    -- Guard, same as the assessment mirror: the program this application form
    -- belongs to must exist as an active opportunity record type in that state.
    -- Without it there is nothing for this record type to be an application FOR.
    IF NOT EXISTS (
      SELECT 1 FROM public.picklist_values
       WHERE picklist_object = 'opportunities'
         AND picklist_field  = 'record_type'
         AND picklist_value  = v_spec.new_value
         AND picklist_is_active
    ) THEN
      RAISE EXCEPTION
        'No active % opportunity record type — refusing to create an incentive application record type for a program that does not exist.',
        v_spec.new_value;
    END IF;

    SELECT id INTO v_new_rt
      FROM public.picklist_values
     WHERE picklist_object = 'incentive_applications'
       AND picklist_field  = 'record_type'
       AND picklist_value  = v_spec.new_value
     LIMIT 1;

    IF v_new_rt IS NULL THEN
      SELECT COALESCE(max(picklist_sort_order), 0) + 10 INTO v_sort
        FROM public.picklist_values
       WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type';

      INSERT INTO public.picklist_values (
        picklist_object, picklist_field, picklist_value, picklist_label,
        picklist_is_active, picklist_sort_order, picklist_state,
        picklist_created_by, picklist_is_default_record_type
      )
      VALUES (
        'incentive_applications', 'record_type', v_spec.new_value, v_spec.new_value,
        true, v_sort, v_spec.new_state,
        v_actor, false
      )
      RETURNING id INTO v_new_rt;

      v_made_rt := v_made_rt + 1;
    END IF;

    -- Layout: the Wisconsin original's default record_detail layout, cloned
    -- wholesale so North Carolina and Michigan open a real form on day one and
    -- can diverge from it freely.
    SELECT id INTO v_source_pl
      FROM public.page_layouts
     WHERE page_layout_object = 'incentive_applications'
       AND page_layout_type   = 'record_detail'
       AND record_type_id     = v_source_rt
       AND is_deleted IS NOT TRUE
     ORDER BY page_layout_is_default DESC
     LIMIT 1;

    IF v_source_pl IS NULL THEN
      RAISE EXCEPTION 'No live layout for source record type % — cannot clone.', v_spec.source_value;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.page_layouts
       WHERE page_layout_object = 'incentive_applications'
         AND page_layout_type   = 'record_detail'
         AND record_type_id     = v_new_rt
         AND is_deleted IS NOT TRUE
    ) THEN
      PERFORM public.clone_page_layout(
        v_source_pl,
        v_spec.new_value,
        'Incentive application layout for the ' || v_spec.new_value || ' program. Cloned from '
          || v_spec.source_value || ' on 2026-08-23; edit freely — states share nothing.',
        NULL,
        v_new_rt,
        true,
        v_actor,
        v_actor
      );
      v_made_pl := v_made_pl + 1;
    END IF;
  END LOOP;

  -- 3b. One edge per program: an opportunity record type may carry the
  --     incentive application record type of the same name. That covers the 18
  --     IRA programs across WI/NC/MI now that the mirrors exist.
  INSERT INTO public.record_type_eligibility (
    rte_record_number, rte_parent_object, rte_parent_record_type_id,
    rte_child_object, rte_child_record_type_id, rte_created_by, rte_updated_by
  )
  SELECT '', 'opportunities', opp.id, 'incentive_applications', ia.id, v_actor, v_actor
    FROM public.picklist_values opp
    JOIN public.picklist_values ia
      ON ia.picklist_object = 'incentive_applications'
     AND ia.picklist_field  = 'record_type'
     AND ia.picklist_is_active
     AND ia.picklist_value  = opp.picklist_value
   WHERE opp.picklist_object = 'opportunities'
     AND opp.picklist_field  = 'record_type'
     AND opp.picklist_is_active
     AND NOT EXISTS (
       SELECT 1 FROM public.record_type_eligibility e
        WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = opp.id
          AND e.rte_child_object = 'incentive_applications' AND e.rte_child_record_type_id = ia.id
          AND NOT e.rte_is_deleted
     );
  GET DIAGNOSTICS v_edges = ROW_COUNT;

  -- 3c. The two program bindings whose names do not match.
  --
  --     FOE-2024-WI / FOE-2025-WI / FOE-2026-WI are the Focus on Energy program
  --     year by year; all three submit the one WI-FOE application.
  --
  --     WI-IRA-MF-HOMES also carries the Wisconsin HOMES payment-request form,
  --     which is how the one live example was built (IA-00002 sits on a
  --     WI-IRA-MF-HOMES opportunity). Without this edge that pairing — already
  --     in production — would be rejected by the guardrail below.
  INSERT INTO public.record_type_eligibility (
    rte_record_number, rte_parent_object, rte_parent_record_type_id,
    rte_child_object, rte_child_record_type_id, rte_created_by, rte_updated_by
  )
  SELECT '', 'opportunities', opp.id, 'incentive_applications', ia.id, v_actor, v_actor
    FROM (VALUES
      ('FOE-2024-WI',     'WI-FOE'),
      ('FOE-2025-WI',     'WI-FOE'),
      ('FOE-2026-WI',     'WI-FOE'),
      ('WI-IRA-MF-HOMES', 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST')
    ) AS pair(opp_value, ia_value)
    JOIN public.picklist_values opp
      ON opp.picklist_object = 'opportunities' AND opp.picklist_field = 'record_type'
     AND opp.picklist_value = pair.opp_value AND opp.picklist_is_active
    JOIN public.picklist_values ia
      ON ia.picklist_object = 'incentive_applications' AND ia.picklist_field = 'record_type'
     AND ia.picklist_value = pair.ia_value AND ia.picklist_is_active
   WHERE NOT EXISTS (
     SELECT 1 FROM public.record_type_eligibility e
      WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = opp.id
        AND e.rte_child_object = 'incentive_applications' AND e.rte_child_record_type_id = ia.id
        AND NOT e.rte_is_deleted
   );
  GET DIAGNOSTICS v_sort = ROW_COUNT;
  v_edges := v_edges + v_sort;

  RAISE NOTICE 'Created % record type(s), % layout(s), % program edge(s).',
    v_made_rt, v_made_pl, v_edges;
END $do$;

-- ---------------------------------------------------------------------------
-- 4. An incentive application with no record type takes its OPPORTUNITY's
--    program, instead of whatever the global default happens to be.
--
--    Byte-for-byte the shape of derive_assessment_record_type()
--    (20260822213503): the program's own application form if it is eligible,
--    then the only eligible form if there is exactly one, then leave it null and
--    let the existing default path run — with the guardrail below to catch it.
--
--    trg_0_* deliberately: Postgres fires BEFORE triggers in name order, and
--    both trg_enforce_record_type (which stamps the default) and trg_ia_autoname
--    (which composes ia_name from the record-type label) have to see the derived
--    value, not the one they would have invented.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_incentive_application_record_type()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_opp_rt    uuid;
  v_opp_value text;
  v_pick      uuid;
  v_count     integer;
BEGIN
  IF NEW.ia_record_type IS NOT NULL OR NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.opportunity_record_type INTO v_opp_rt
    FROM public.opportunities o WHERE o.id = NEW.opportunity_id;
  IF v_opp_rt IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pv.picklist_value INTO v_opp_value
    FROM public.picklist_values pv WHERE pv.id = v_opp_rt;

  -- a. The program's own application form, if it is eligible here.
  SELECT e.id INTO v_pick
    FROM public.eligible_record_types_for_parent(
           'opportunities', v_opp_rt, 'incentive_applications') e
   WHERE e.picklist_value = v_opp_value
   LIMIT 1;

  -- b. Otherwise, the only eligible form — if there is exactly one.
  IF v_pick IS NULL THEN
    SELECT count(*) INTO v_count
      FROM public.eligible_record_types_for_parent(
             'opportunities', v_opp_rt, 'incentive_applications');
    IF v_count = 1 THEN
      SELECT e.id INTO v_pick
        FROM public.eligible_record_types_for_parent(
               'opportunities', v_opp_rt, 'incentive_applications') e
       LIMIT 1;
    END IF;
  END IF;

  IF v_pick IS NOT NULL THEN
    NEW.ia_record_type := v_pick;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.derive_incentive_application_record_type() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_0_ia_record_type_from_opportunity ON public.incentive_applications;
CREATE TRIGGER trg_0_ia_record_type_from_opportunity
  BEFORE INSERT ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.derive_incentive_application_record_type();

-- ---------------------------------------------------------------------------
-- 5. The guarantee, in the database: an application form belongs to the state
--    its property is in AND to the program its opportunity runs.
--
--    Both halves in one trigger because they are one question to the user —
--    "can this form be used here?" — and a single, specific error is worth more
--    than two vague ones. Permissive where it cannot know: a nationwide form
--    (picklist_state NULL) passes any state, a property with no state
--    constrains nothing, and an opportunity record type with no eligibility
--    edges is unconstrained, exactly as record_type_eligible() defines it.
--
--    Pre-existing rows are grandfathered the same way opportunities are: an
--    UPDATE that changes neither the record type nor the parents returns early,
--    so a row that predates this rule stays editable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_incentive_application_record_type()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_state      text;
  v_rt_state   text;
  v_rt_label   text;
  v_parent_rt  uuid;
  v_opp_label  text;
  v_allowed    text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.ia_record_type IS NOT DISTINCT FROM OLD.ia_record_type
     AND NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id
     AND NEW.property_id    IS NOT DISTINCT FROM OLD.property_id THEN
    RETURN NEW;
  END IF;

  IF NEW.ia_record_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT picklist_state, picklist_label INTO v_rt_state, v_rt_label
    FROM public.picklist_values WHERE id = NEW.ia_record_type;

  -- 5a. State. The property is the authority — the same ruling the opportunity
  --     state rule rests on, and incentive_applications.property_id is NOT NULL
  --     so it is always resolvable. Never the building: building_state is blank
  --     on a third of live buildings.
  IF NEW.property_id IS NOT NULL AND v_rt_state IS NOT NULL THEN
    SELECT property_state INTO v_state FROM public.properties WHERE id = NEW.property_id;

    IF v_state IS NOT NULL AND v_state <> v_rt_state THEN
      SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
        INTO v_allowed
        FROM public.picklist_values pv
       WHERE pv.picklist_object = 'incentive_applications'
         AND pv.picklist_field  = 'record_type'
         AND pv.picklist_is_active
         AND (pv.picklist_state IS NULL OR pv.picklist_state = v_state);

      RAISE EXCEPTION
        'Incentive application record type "%" runs in % and this property is in %. Available in %: %.',
        COALESCE(v_rt_label, '(unknown)'), v_rt_state, v_state, v_state,
        COALESCE(v_allowed, '(none configured)');
    END IF;
  END IF;

  -- 5b. Program.
  IF NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT opportunity_record_type INTO v_parent_rt
    FROM public.opportunities WHERE id = NEW.opportunity_id;
  IF v_parent_rt IS NULL THEN RETURN NEW; END IF;

  IF public.record_type_eligible(
       'opportunities', v_parent_rt, 'incentive_applications', NEW.ia_record_type) THEN
    RETURN NEW;
  END IF;

  SELECT picklist_label INTO v_opp_label FROM public.picklist_values WHERE id = v_parent_rt;
  SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
    INTO v_allowed
    FROM public.record_type_eligibility e
    JOIN public.picklist_values pv ON pv.id = e.rte_child_record_type_id
   WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = v_parent_rt
     AND e.rte_child_object = 'incentive_applications'
     AND e.rte_is_active AND NOT e.rte_is_deleted;

  RAISE EXCEPTION
    'Incentive application record type "%" is not part of the "%" program. Allowed here: %.',
    COALESCE(v_rt_label, '(unknown)'), COALESCE(v_opp_label, '(unknown)'),
    COALESCE(v_allowed, '(none configured)');
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_incentive_application_record_type() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_ia_record_type_state_and_program ON public.incentive_applications;
CREATE TRIGGER trg_zz_ia_record_type_state_and_program
  BEFORE INSERT OR UPDATE OF ia_record_type, opportunity_id, property_id
  ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_incentive_application_record_type();

NOTIFY pgrst, 'reload schema';
