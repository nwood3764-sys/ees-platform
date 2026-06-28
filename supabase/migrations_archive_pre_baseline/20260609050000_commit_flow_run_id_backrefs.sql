-- Add id back-references to commit_screen_flow_run so a single confirmed batch
-- can create a parent and its children atomically and in order: a child action
-- references an earlier action's freshly-created id via a {{ref:NAME}} token.
--
-- How it works:
--   * Each action MAY carry a "ref" (short string the model assigns, e.g. "acct").
--   * Any value (and record_id) in a LATER action may contain the token
--     {{ref:acct}}; before that action executes, every {{ref:NAME}} is replaced
--     with the uuid created by the action whose ref = NAME earlier in THIS batch.
--   * After an action creates a row, its created_id is registered under its ref.
--
-- Ordering is the array order (parents must precede children). Unresolved refs
-- raise a clear error so a hole can never be written. Fully backward compatible:
-- actions without a ref and values without tokens behave exactly as before.
-- Also: each result row now carries object + ref so the client can render a
-- link to every created record.

create or replace function public.commit_screen_flow_run(p_flow_id uuid, p_context jsonb, p_actions jsonb, p_ai_assisted boolean DEFAULT false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
DECLARE
  v_user uuid; v_flow public.flows%ROWTYPE; v_run_id uuid;
  v_action jsonb; v_order integer := 0;
  v_obj text; v_rid uuid; v_vals jsonb; v_type text;
  v_status_field text; v_to_status uuid; v_note text;
  v_cols text; v_set text; v_created uuid; v_results jsonb := '[]'::jsonb;
  v_outcome text; v_message text;
  v_k text; v_blocked text[];
  v_num_col text; v_colrec record;
  v_extra_cols text; v_extra_vals text;
  v_rpc text; v_p jsonb; v_rpc_result jsonb;
  v_refs jsonb := '{}'::jsonb;          -- ref name -> created uuid (this batch)
  v_ref text;                            -- this action's own ref label
  v_action_text text;                    -- serialized action for token substitution
  v_missing text[];                      -- unresolved {{ref:...}} names
  v_m text;
BEGIN
  v_user := current_app_user_id();
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_flow FROM public.flows WHERE id=p_flow_id AND is_deleted=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Flow not found'; END IF;

  INSERT INTO public.flow_runs
    (fr_record_number, fr_flow_id, fr_flow_version_id, fr_flow_type,
     fr_status, fr_context, fr_ai_assisted, owner_id, created_by)
  VALUES
    ('', p_flow_id, v_flow.flow_active_version_id, 'screen',
     'in_progress', COALESCE(p_context,'{}'::jsonb), p_ai_assisted, v_user, v_user)
  RETURNING id INTO v_run_id;

  FOR v_action IN SELECT * FROM jsonb_array_elements(COALESCE(p_actions,'[]'::jsonb)) LOOP
    v_order := v_order + 1;
    v_ref := NULLIF(v_action->>'ref','');

    v_action_text := v_action::text;
    IF position('{{ref:' in v_action_text) > 0 THEN
      v_missing := ARRAY[]::text[];
      FOR v_m IN
        SELECT DISTINCT (regexp_matches(v_action_text, '\{\{ref:([A-Za-z0-9_\-]+)\}\}', 'g'))[1]
      LOOP
        IF v_refs ? v_m THEN
          v_action_text := replace(v_action_text, '{{ref:' || v_m || '}}', v_refs->>v_m);
        ELSE
          v_missing := array_append(v_missing, v_m);
        END IF;
      END LOOP;
      IF array_length(v_missing,1) IS NOT NULL THEN
        v_outcome := 'error';
        v_message := format('Unresolved reference(s): %s — a referenced record was not created earlier in this batch.', array_to_string(v_missing, ', '));
        INSERT INTO public.flow_run_steps
          (frs_record_number, frs_run_id, frs_element_type, frs_order,
           frs_outcome, frs_outcome_message, frs_input, frs_created_target_id)
        VALUES ('', v_run_id, v_action->>'type', v_order, v_outcome, v_message, v_action, NULL);
        v_results := v_results || jsonb_build_object('order',v_order,'outcome',v_outcome,'message',v_message,'created_id',NULL);
        UPDATE public.flow_runs SET fr_status='error', fr_outcome_message=v_message, fr_completed_at=now() WHERE id=v_run_id;
        RETURN jsonb_build_object('ok',false,'run_id',v_run_id,'results',v_results);
      END IF;
      v_action := v_action_text::jsonb;
    END IF;

    v_type := v_action->>'type';
    v_obj  := v_action->>'object';
    v_rid  := NULLIF(v_action->>'record_id','')::uuid;
    v_vals := v_action->'values';
    v_outcome := 'ok'; v_message := NULL; v_created := NULL;

    BEGIN
      IF v_type='status_change' THEN
        v_status_field := COALESCE(v_action->>'status_field', _automation_status_column_for(v_obj));
        v_to_status    := NULLIF(v_action->>'to_status_id','')::uuid;
        v_note         := v_action->>'note';
        IF v_rid IS NULL THEN RAISE EXCEPTION 'status_change requires record_id'; END IF;
        IF v_status_field IS NULL THEN RAISE EXCEPTION 'status_change requires status_field for %', v_obj; END IF;
        IF v_to_status IS NULL THEN RAISE EXCEPTION 'status_change requires to_status_id'; END IF;
        PERFORM change_record_status(v_obj, v_status_field, v_rid, v_to_status, v_note);
        v_created := v_rid;
        v_message := format('Status changed on %s %s', v_obj, v_rid);

      ELSIF v_type='report_create' THEN
        v_created := create_report(v_action->'report');
        v_message := format('Created report %s', v_created);

      ELSIF v_type='admin_action' THEN
        v_rpc := v_action->>'rpc';
        v_p   := COALESCE(v_action->'params', '{}'::jsonb);
        IF v_rpc IS NULL OR v_rpc = '' THEN
          RAISE EXCEPTION 'admin_action requires an rpc name';
        END IF;
        IF v_rpc ~* '(purge|delete|drop|truncate|hard_delete|destroy)' THEN
          RAISE EXCEPTION 'Refused: % is a destructive operation. Froggy cannot delete or purge data.', v_rpc;
        END IF;

        IF v_rpc = 'admin_add_custom_field' THEN
          SELECT admin_add_custom_field(
            v_p->>'object', v_p->>'column', v_p->>'label', v_p->>'data_type',
            v_p->>'help_text', v_p->>'description', v_p->>'example_value',
            COALESCE((v_p->>'financial_tier')::int, 1),
            COALESCE((v_p->>'track_history')::boolean, false),
            v_p->>'fk_table'
          ) INTO v_rpc_result;
        ELSIF v_rpc = 'admin_upsert_field_metadata' THEN
          SELECT admin_upsert_field_metadata(
            v_p->>'object', v_p->>'column', v_p->>'label',
            v_p->>'help_text', v_p->>'description', v_p->>'example_value',
            COALESCE((v_p->>'financial_tier')::int, 1),
            COALESCE((v_p->>'track_history')::boolean, false)
          ) INTO v_rpc_result;
        ELSIF v_rpc = 'set_record_type_picklist_values' THEN
          SELECT set_record_type_picklist_values(
            (v_p->>'record_type_id')::uuid, v_p->>'object', v_p->>'field',
            ARRAY(SELECT jsonb_array_elements_text(v_p->'value_ids'))::uuid[]
          ) INTO v_rpc_result;
        ELSIF v_rpc = 'set_flow_active' THEN
          SELECT set_flow_active((v_p->>'flow_id')::uuid, (v_p->>'active')::boolean) INTO v_rpc_result;
        ELSIF v_rpc = 'set_module_sections' THEN
          SELECT set_module_sections(v_p->>'module_id', v_p->'sections') INTO v_rpc_result;
        ELSIF v_rpc = 'save_home_page' THEN
          SELECT save_home_page(v_p->'page', v_p->'components') INTO v_rpc_result;
        ELSIF v_rpc = 'bulk_update_records' THEN
          SELECT bulk_update_records(
            v_p->>'table',
            ARRAY(SELECT jsonb_array_elements_text(v_p->'record_ids'))::uuid[],
            v_p->'updates',
            v_user
          ) INTO v_rpc_result;
        ELSIF v_rpc = 'provision_field_technician' THEN
          SELECT provision_field_technician(
            (v_p->>'user_id')::uuid,
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_p->'program_ids'))::uuid[], '{}'::uuid[]),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_p->'permission_set_ids'))::uuid[], '{}'::uuid[]),
            NULLIF(v_p->>'service_territory_id','')::uuid
          ) INTO v_rpc_result;
        ELSIF v_rpc = 'recompute_account_rollups' THEN
          PERFORM recompute_account_rollups((v_p->>'account_id')::uuid); v_rpc_result := jsonb_build_object('ok',true);
        ELSIF v_rpc = 'recompute_building_rollups' THEN
          PERFORM recompute_building_rollups((v_p->>'building_id')::uuid); v_rpc_result := jsonb_build_object('ok',true);
        ELSIF v_rpc = 'recompute_opportunity_rollups' THEN
          PERFORM recompute_opportunity_rollups((v_p->>'opportunity_id')::uuid); v_rpc_result := jsonb_build_object('ok',true);
        ELSIF v_rpc = 'recompute_property_rollups' THEN
          PERFORM recompute_property_rollups((v_p->>'property_id')::uuid); v_rpc_result := jsonb_build_object('ok',true);
        ELSIF v_rpc = 'restore_record' THEN
          SELECT restore_record(v_p->>'table', (v_p->>'record_id')::uuid) INTO v_rpc_result;
        ELSIF v_rpc = 'restore_document_template' THEN
          SELECT restore_document_template((v_p->>'document_template_id')::uuid) INTO v_rpc_result;
        ELSIF v_rpc = 'restore_email_template' THEN
          SELECT restore_email_template((v_p->>'email_template_id')::uuid) INTO v_rpc_result;
        ELSIF v_rpc = 'restore_project_report_template' THEN
          SELECT restore_project_report_template((v_p->>'prt_id')::uuid) INTO v_rpc_result;
        ELSIF v_rpc = 'void_envelope' THEN
          SELECT void_envelope((v_p->>'envelope_id')::uuid, v_p->>'reason') INTO v_rpc_result;
        ELSE
          RAISE EXCEPTION 'Refused: % is not an allowed admin action.', v_rpc;
        END IF;

        v_message := format('Ran %s', v_rpc);

      ELSIF v_type='record_create' THEN
        IF NOT app_user_can(v_obj, 'create') THEN
          RAISE EXCEPTION 'No create permission on %', v_obj;
        END IF;
        v_blocked := ARRAY[]::text[];
        FOR v_k IN SELECT key FROM jsonb_object_keys(v_vals) AS key LOOP
          IF NOT app_user_field_editable(v_obj, v_k) THEN
            v_blocked := array_append(v_blocked, v_k);
          END IF;
        END LOOP;
        IF array_length(v_blocked,1) IS NOT NULL THEN
          RAISE EXCEPTION 'Not permitted to set field(s): %', array_to_string(v_blocked, ', ');
        END IF;

        SELECT string_agg(quote_ident(k),','), string_agg(format('%L', val),',')
          INTO v_cols, v_set
          FROM jsonb_each_text(v_vals) AS j(k,val);

        v_extra_cols := NULL; v_extra_vals := NULL;

        FOR v_colrec IN
          SELECT a.attname
          FROM pg_attribute a
          JOIN pg_class c ON c.oid=a.attrelid
          JOIN pg_namespace ns ON ns.oid=c.relnamespace
          LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
          WHERE ns.nspname='public' AND c.relname=v_obj
            AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull
            AND pg_get_expr(d.adbin,d.adrelid) IS NULL
            AND format_type(a.atttypid,a.atttypmod)='uuid'
            AND ( a.attname LIKE '%\_owner' OR a.attname='owner_id'
               OR a.attname LIKE '%\_created\_by' OR a.attname='created_by'
               OR a.attname LIKE '%\_updated\_by' OR a.attname='updated_by' )
        LOOP
          IF NOT (v_vals ? v_colrec.attname) THEN
            v_extra_cols := concat_ws(',', v_extra_cols, quote_ident(v_colrec.attname));
            v_extra_vals := concat_ws(',', v_extra_vals, format('%L', v_user));
          END IF;
        END LOOP;

        SELECT a.attname INTO v_num_col
          FROM pg_attribute a
          JOIN pg_class c ON c.oid=a.attrelid
          JOIN pg_namespace ns ON ns.oid=c.relnamespace
          WHERE ns.nspname='public' AND c.relname=v_obj
            AND a.attnum>0 AND NOT a.attisdropped
            AND a.attname LIKE '%\_record\_number'
          LIMIT 1;
        IF v_num_col IS NOT NULL AND NOT (v_vals ? v_num_col) THEN
          v_extra_cols := concat_ws(',', v_extra_cols, quote_ident(v_num_col));
          v_extra_vals := concat_ws(',', v_extra_vals, '''''');
        END IF;

        IF v_extra_cols IS NOT NULL THEN
          v_cols := concat_ws(',', v_cols, v_extra_cols);
          v_set  := concat_ws(',', v_set,  v_extra_vals);
        END IF;

        EXECUTE format('INSERT INTO public.%I (%s) VALUES (%s) RETURNING id', v_obj, v_cols, v_set)
          INTO v_created;
        v_message := format('Created %s %s', v_obj, v_created);

      ELSIF v_type='record_update' THEN
        IF v_rid IS NULL THEN RAISE EXCEPTION 'record_update requires record_id'; END IF;
        IF NOT app_user_can(v_obj, 'update') THEN
          RAISE EXCEPTION 'No update permission on %', v_obj;
        END IF;
        IF NOT app_user_in_scope(v_obj, v_rid) THEN
          RAISE EXCEPTION 'Record % on % is not in your scope', v_rid, v_obj;
        END IF;
        v_blocked := ARRAY[]::text[];
        FOR v_k IN SELECT key FROM jsonb_object_keys(v_vals) AS key LOOP
          IF NOT app_user_field_editable(v_obj, v_k) THEN
            v_blocked := array_append(v_blocked, v_k);
          END IF;
        END LOOP;
        IF array_length(v_blocked,1) IS NOT NULL THEN
          RAISE EXCEPTION 'Not permitted to set field(s): %', array_to_string(v_blocked, ', ');
        END IF;
        SELECT string_agg(format('%I = %L', k, val), ', ')
          INTO v_set FROM jsonb_each_text(v_vals) AS j(k,val);
        EXECUTE format('UPDATE public.%I SET %s WHERE id = $1', v_obj, v_set) USING v_rid;
        v_created := v_rid;
        v_message := format('Updated %s %s', v_obj, v_rid);

      ELSE
        v_outcome := 'skipped'; v_message := format('Unknown action type %s', v_type);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_outcome := 'error'; v_message := format('%s: %s', SQLSTATE, SQLERRM);
    END;

    -- Register this action's created id under its ref so later actions can use it.
    IF v_outcome='ok' AND v_ref IS NOT NULL AND v_created IS NOT NULL THEN
      v_refs := v_refs || jsonb_build_object(v_ref, v_created::text);
    END IF;

    INSERT INTO public.flow_run_steps
      (frs_record_number, frs_run_id, frs_element_type, frs_order,
       frs_outcome, frs_outcome_message, frs_input, frs_created_target_id)
    VALUES
      ('', v_run_id, v_type, v_order, v_outcome, v_message, v_action, v_created);

    v_results := v_results || jsonb_build_object('order',v_order,'outcome',v_outcome,'message',v_message,'created_id',v_created,'object',v_obj,'ref',v_ref);

    IF v_outcome='error' THEN
      UPDATE public.flow_runs SET fr_status='error', fr_outcome_message=v_message, fr_completed_at=now() WHERE id=v_run_id;
      RETURN jsonb_build_object('ok',false,'run_id',v_run_id,'results',v_results);
    END IF;
  END LOOP;

  UPDATE public.flow_runs SET fr_status='completed', fr_completed_at=now() WHERE id=v_run_id;
  RETURN jsonb_build_object('ok',true,'run_id',v_run_id,'results',v_results);
END; $function$;

revoke all on function public.commit_screen_flow_run(uuid, jsonb, jsonb, boolean) from public;
grant execute on function public.commit_screen_flow_run(uuid, jsonb, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
