-- North Carolina and Michigan get their own HOMES payment-request application
-- forms.
--
-- Nicholas, 2026-08-24, answering the one thing 20260823202021 deliberately left
-- open — whether NC and MI HOMES use a separate payment-request application:
-- "yes, of course, they use different payment request application forms."
--
-- Yesterday's mirror stopped short of this one form on purpose: mirroring a
-- program document nobody had confirmed would have been inventing it. Confirmed,
-- it mirrors exactly like the other twelve — same shape, layout cloned from the
-- Wisconsin original, free to diverge. "Different" is the point: each state's
-- form asks for what that state's program asks for, and the layouts are separate
-- from this moment on.
--
-- Unlike the twelve, these carry no same-named opportunity record type — there is
-- no NC-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST *program*; the form belongs to the
-- state's MF HOMES program, exactly as Wisconsin's belongs to WI-IRA-MF-HOMES.
-- So the spec names the owning program explicitly rather than matching on name,
-- and the eligibility edge is written from that.
--
-- Only the multifamily form is mirrored, because only the multifamily form
-- exists in Wisconsin. Inventing a single-family payment request for states that
-- have never asked for one would be the same mistake this migration is fixing.
DO $do$
DECLARE
  v_actor     uuid;
  v_spec      record;
  v_source_rt uuid;
  v_source_pl uuid;
  v_new_rt    uuid;
  v_program   uuid;
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

  SELECT id INTO v_source_rt
    FROM public.picklist_values
   WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type'
     AND picklist_value = 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST' AND picklist_is_active
   LIMIT 1;
  IF v_source_rt IS NULL THEN
    RAISE EXCEPTION 'Source form WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST not found or inactive.';
  END IF;

  SELECT id INTO v_source_pl
    FROM public.page_layouts
   WHERE page_layout_object = 'incentive_applications'
     AND page_layout_type   = 'record_detail'
     AND record_type_id     = v_source_rt
     AND is_deleted IS NOT TRUE
   ORDER BY page_layout_is_default DESC
   LIMIT 1;
  IF v_source_pl IS NULL THEN
    RAISE EXCEPTION 'No live layout for WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST — cannot clone.';
  END IF;

  FOR v_spec IN
    SELECT * FROM (VALUES
      ('NC-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST', 'NC', 'NC-IRA-MF-HOMES'),
      ('MI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST', 'MI', 'MI-IRA-MF-HOMES')
    ) AS t(new_value, new_state, program_value)
  LOOP
    -- The program this form is the payment request FOR must exist in that state.
    SELECT id INTO v_program
      FROM public.picklist_values
     WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type'
       AND picklist_value = v_spec.program_value AND picklist_is_active
     LIMIT 1;

    IF v_program IS NULL THEN
      RAISE EXCEPTION
        'No active % opportunity record type — refusing to create its payment request form.',
        v_spec.program_value;
    END IF;

    SELECT id INTO v_new_rt
      FROM public.picklist_values
     WHERE picklist_object = 'incentive_applications' AND picklist_field = 'record_type'
       AND picklist_value = v_spec.new_value
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
        true, v_sort, v_spec.new_state, v_actor, false
      )
      RETURNING id INTO v_new_rt;

      v_made_rt := v_made_rt + 1;
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
        'Payment request application layout for the ' || v_spec.program_value
          || ' program. Cloned from WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST on '
          || '2026-08-24; each state asks for its own — edit freely.',
        NULL,
        v_new_rt,
        true,
        v_actor,
        v_actor
      );
      v_made_pl := v_made_pl + 1;
    END IF;

    -- The state's MF HOMES program carries both its own application and its
    -- payment request, exactly as WI-IRA-MF-HOMES does.
    INSERT INTO public.record_type_eligibility (
      rte_record_number, rte_parent_object, rte_parent_record_type_id,
      rte_child_object, rte_child_record_type_id, rte_created_by, rte_updated_by
    )
    SELECT '', 'opportunities', v_program, 'incentive_applications', v_new_rt, v_actor, v_actor
     WHERE NOT EXISTS (
       SELECT 1 FROM public.record_type_eligibility e
        WHERE e.rte_parent_object = 'opportunities' AND e.rte_parent_record_type_id = v_program
          AND e.rte_child_object = 'incentive_applications' AND e.rte_child_record_type_id = v_new_rt
          AND NOT e.rte_is_deleted
     );
    v_edges := v_edges + 1;
  END LOOP;

  RAISE NOTICE 'Created % form(s), % layout(s), % program edge(s).', v_made_rt, v_made_pl, v_edges;
END $do$;

NOTIFY pgrst, 'reload schema';
