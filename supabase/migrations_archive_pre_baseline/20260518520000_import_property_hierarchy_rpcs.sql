-- normalize_property_address(street, city, state)
-- Used by both the preview and import RPCs to dedup property addresses
-- consistently. The frontend client mirrors the same logic in JS for
-- in-file dup detection.
CREATE OR REPLACE FUNCTION public.normalize_property_address(p_street text, p_city text, p_state text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(
                          coalesce(p_street, '') || '|' || coalesce(p_city, '') || '|' || coalesce(p_state, ''),
                          '[.,#]', '', 'g'),
                        '\s+', ' ', 'g'),
                      '\m(street)\M', 'street', 'gi'),
                    '\m(st)\M', 'street', 'gi'),
                  '\m(ave|av)\M', 'avenue', 'gi'),
                '\m(rd)\M', 'road', 'gi'),
              '\m(blvd|bl)\M', 'boulevard', 'gi'),
            '\m(dr)\M', 'drive', 'gi'),
          '\m(ln)\M', 'lane', 'gi'),
        '\m(ct)\M', 'court', 'gi'),
      '\m(n|no)\M', 'north', 'gi')
  );
$$;

-- import_property_hierarchy(payload, source_filename)
-- Transactional creator of Account -> Property -> Building -> Unit hierarchy.
-- Dedupes on the way in. Writes an audit row to bulk_import_runs.
-- See body comments inline.
CREATE OR REPLACE FUNCTION public.import_property_hierarchy(
  p_rows            jsonb,
  p_source_filename text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller_user_id      uuid;
  v_row                 jsonb;
  v_action              text;
  v_owner_name          text;
  v_owner_id            uuid;
  v_property_name       text;
  v_property_street     text;
  v_property_city       text;
  v_property_state      text;
  v_property_zip        text;
  v_property_subsidy    text;
  v_property_addr_norm  text;
  v_property_id         uuid;
  v_property_rt_id      uuid;
  v_account_rt_id       uuid;
  v_subsidy_pl_id       uuid;
  v_building_name       text;
  v_building_year       integer;
  v_building_count      integer;
  v_building_notes      text;
  v_building_id         uuid;
  v_unit_id             uuid;
  v_unit_i              integer;
  v_owners_created      integer := 0;
  v_properties_created  integer := 0;
  v_buildings_created   integer := 0;
  v_units_created       integer := 0;
  v_owner_ids           uuid[] := ARRAY[]::uuid[];
  v_property_ids        uuid[] := ARRAY[]::uuid[];
  v_building_ids        uuid[] := ARRAY[]::uuid[];
  v_unit_ids            uuid[] := ARRAY[]::uuid[];
  v_bir_id              uuid;
  v_bir_record_number   text;
  v_processed_rows      integer := 0;
BEGIN
  SELECT u.id INTO v_caller_user_id
    FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1;
  IF v_caller_user_id IS NULL THEN
    RAISE EXCEPTION 'import_property_hierarchy: caller has no public.users record (auth.uid()=%)', auth.uid();
  END IF;

  SELECT pv.id INTO v_account_rt_id
    FROM picklist_values pv
   WHERE pv.picklist_object='accounts' AND pv.picklist_field='record_type'
     AND pv.picklist_value='Property' LIMIT 1;

  SELECT pv.id INTO v_property_rt_id
    FROM picklist_values pv
   WHERE pv.picklist_object='properties' AND pv.picklist_field='record_type'
     AND pv.picklist_value='MultiFamily' LIMIT 1;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_action := coalesce(v_row->>'row_action', 'create');
    IF v_action = 'skip' THEN CONTINUE; END IF;

    v_owner_name       := btrim(v_row->>'owner_name');
    v_property_name    := btrim(v_row->>'property_name');
    v_property_street  := btrim(v_row->>'property_street');
    v_property_city    := btrim(v_row->>'property_city');
    v_property_state   := upper(btrim(v_row->>'property_state'));
    v_property_zip     := btrim(v_row->>'property_zip');
    v_property_subsidy := nullif(btrim(v_row->>'property_subsidy_type'), '');
    v_building_name    := btrim(v_row->>'building_name');
    v_building_year    := nullif(v_row->>'building_year_built','')::integer;
    v_building_count   := nullif(v_row->>'building_unit_count','')::integer;
    v_building_notes   := nullif(btrim(v_row->>'building_notes'), '');

    SELECT a.id INTO v_owner_id
      FROM public.accounts a
     WHERE lower(btrim(a.account_name)) = lower(v_owner_name)
       AND NOT a.account_is_deleted LIMIT 1;

    IF v_owner_id IS NULL THEN
      INSERT INTO public.accounts (
        account_name, account_record_type, account_owner, account_created_by, account_updated_by
      ) VALUES (
        v_owner_name, v_account_rt_id, v_caller_user_id, v_caller_user_id, v_caller_user_id
      ) RETURNING id INTO v_owner_id;
      v_owners_created := v_owners_created + 1;
      v_owner_ids := array_append(v_owner_ids, v_owner_id);
    END IF;

    v_property_addr_norm := normalize_property_address(v_property_street, v_property_city, v_property_state);

    SELECT p.id INTO v_property_id
      FROM public.properties p
     WHERE normalize_property_address(p.property_street, p.property_city, p.property_state) = v_property_addr_norm
       AND NOT p.property_is_deleted LIMIT 1;

    IF v_property_id IS NULL THEN
      v_subsidy_pl_id := NULL;
      IF v_property_subsidy IS NOT NULL THEN
        SELECT pv.id INTO v_subsidy_pl_id
          FROM picklist_values pv
         WHERE pv.picklist_object='properties' AND pv.picklist_field='property_subsidy_type'
           AND pv.picklist_value=v_property_subsidy LIMIT 1;
      END IF;

      INSERT INTO public.properties (
        property_name, property_account_id, property_street, property_city,
        property_state, property_zip, property_record_type, property_subsidy_type,
        property_owner, property_created_by, property_updated_by
      ) VALUES (
        v_property_name, v_owner_id, v_property_street, v_property_city,
        v_property_state, v_property_zip, v_property_rt_id, v_subsidy_pl_id,
        v_caller_user_id, v_caller_user_id, v_caller_user_id
      ) RETURNING id INTO v_property_id;
      v_properties_created := v_properties_created + 1;
      v_property_ids := array_append(v_property_ids, v_property_id);
    END IF;

    IF v_building_name IS NOT NULL AND v_building_name <> '' THEN
      SELECT b.id INTO v_building_id
        FROM public.buildings b
       WHERE b.property_id = v_property_id
         AND lower(btrim(b.building_name)) = lower(v_building_name)
         AND NOT b.building_is_deleted LIMIT 1;

      IF v_building_id IS NULL THEN
        INSERT INTO public.buildings (
          building_name, building_number_or_name, property_id,
          building_year_built, building_notes,
          building_owner, building_created_by, building_updated_by
        ) VALUES (
          v_building_name, v_building_name, v_property_id,
          v_building_year, v_building_notes,
          v_caller_user_id, v_caller_user_id, v_caller_user_id
        ) RETURNING id INTO v_building_id;
        v_buildings_created := v_buildings_created + 1;
        v_building_ids := array_append(v_building_ids, v_building_id);

        IF v_building_count IS NOT NULL AND v_building_count > 0 THEN
          FOR v_unit_i IN 1..v_building_count LOOP
            INSERT INTO public.units (
              unit_name, unit_number, building_id,
              unit_owner, unit_created_by, unit_updated_by
            ) VALUES (
              'Unit ' || v_unit_i, v_unit_i::text, v_building_id,
              v_caller_user_id, v_caller_user_id, v_caller_user_id
            ) RETURNING id INTO v_unit_id;
            v_units_created := v_units_created + 1;
            v_unit_ids := array_append(v_unit_ids, v_unit_id);
          END LOOP;
        END IF;
      END IF;
    END IF;

    v_processed_rows := v_processed_rows + 1;
  END LOOP;

  INSERT INTO public.bulk_import_runs (
    bir_import_type, bir_source_filename, bir_row_count,
    bir_accounts_created, bir_properties_created, bir_buildings_created, bir_units_created,
    bir_decisions_json, bir_created_record_ids,
    bir_owner, bir_created_by, bir_updated_by
  ) VALUES (
    'property_hierarchy', p_source_filename, v_processed_rows,
    v_owners_created, v_properties_created, v_buildings_created, v_units_created,
    p_rows,
    jsonb_build_object(
      'account_ids',  to_jsonb(v_owner_ids),
      'property_ids', to_jsonb(v_property_ids),
      'building_ids', to_jsonb(v_building_ids),
      'unit_ids',     to_jsonb(v_unit_ids)
    ),
    v_caller_user_id, v_caller_user_id, v_caller_user_id
  ) RETURNING id, bir_record_number INTO v_bir_id, v_bir_record_number;

  RETURN jsonb_build_object(
    'import_run_id',         v_bir_id,
    'import_run_record_number', v_bir_record_number,
    'processed_rows',        v_processed_rows,
    'accounts_created',      v_owners_created,
    'properties_created',    v_properties_created,
    'buildings_created',     v_buildings_created,
    'units_created',         v_units_created
  );
END
$function$;

REVOKE ALL ON FUNCTION public.import_property_hierarchy(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_property_hierarchy(jsonb, text) TO authenticated;

-- preview_property_hierarchy_import(p_rows)
-- Dry-run dedup check against existing rows; no writes.
CREATE OR REPLACE FUNCTION public.preview_property_hierarchy_import(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller_user_id  uuid;
  v_row             jsonb;
  v_idx             integer := 0;
  v_addr_norm       text;
  v_existing_prop   record;
  v_existing_bldg   record;
  v_result          jsonb := '[]'::jsonb;
  v_row_result      jsonb;
BEGIN
  SELECT u.id INTO v_caller_user_id
    FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1;
  IF v_caller_user_id IS NULL THEN
    RAISE EXCEPTION 'preview_property_hierarchy_import: caller has no public.users record';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_addr_norm := normalize_property_address(
      v_row->>'property_street', v_row->>'property_city', v_row->>'property_state'
    );

    v_existing_prop := NULL;
    v_existing_bldg := NULL;

    SELECT p.id, p.property_name, p.property_record_number,
           p.property_street, p.property_city, p.property_state,
           p.property_account_id, a.account_name
      INTO v_existing_prop
      FROM public.properties p
      LEFT JOIN public.accounts a ON a.id = p.property_account_id
     WHERE normalize_property_address(p.property_street, p.property_city, p.property_state) = v_addr_norm
       AND NOT p.property_is_deleted LIMIT 1;

    IF v_existing_prop.id IS NOT NULL
       AND coalesce(btrim(v_row->>'building_name'),'') <> '' THEN
      SELECT b.id, b.building_name, b.building_record_number
        INTO v_existing_bldg
        FROM public.buildings b
       WHERE b.property_id = v_existing_prop.id
         AND lower(btrim(b.building_name)) = lower(btrim(v_row->>'building_name'))
         AND NOT b.building_is_deleted LIMIT 1;
    END IF;

    v_row_result := jsonb_build_object(
      'row_index', v_idx,
      'existing_property', CASE WHEN v_existing_prop.id IS NULL THEN NULL ELSE
        jsonb_build_object(
          'id',            v_existing_prop.id,
          'name',          v_existing_prop.property_name,
          'record_number', v_existing_prop.property_record_number,
          'street',        v_existing_prop.property_street,
          'city',          v_existing_prop.property_city,
          'state',         v_existing_prop.property_state,
          'account_name',  v_existing_prop.account_name
        )
      END,
      'existing_building', CASE WHEN v_existing_bldg.id IS NULL THEN NULL ELSE
        jsonb_build_object(
          'id',            v_existing_bldg.id,
          'name',          v_existing_bldg.building_name,
          'record_number', v_existing_bldg.building_record_number
        )
      END,
      'suggested_action',
        CASE
          WHEN v_existing_bldg.id IS NOT NULL THEN 'error_building_exists'
          WHEN v_existing_prop.id IS NOT NULL THEN 'skip'
          ELSE 'create'
        END
    );

    v_result := v_result || v_row_result;
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_result;
END
$function$;

REVOKE ALL ON FUNCTION public.preview_property_hierarchy_import(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_property_hierarchy_import(jsonb) TO authenticated;
