-- =============================================================================
-- Field type system — modifiable field types, formula fields, rollup fields
-- =============================================================================
-- LEAP fields were type-derived purely from the Postgres column type; the
-- field_metadata table stored only presentation metadata (label/help/tier) and
-- its fm_data_type was advisory (never read back for rendering). This migration
-- makes the LOGICAL field type authoritative and adds Salesforce-parity
-- formula and rollup field kinds — all metadata-driven, additive, and
-- computed-at-read (no per-field DDL, no physical column retype, reversible).
--
--   fm_field_kind        'standard' | 'formula' | 'rollup'
--   fm_display_type      logical display type override (currency, percent,
--                        email, phone, url, textarea, …); null → derive from
--                        the physical pg type as before
--   fm_formula_*         formula expression + return type + reference map
--   fm_rollup_config     child object / fk / aggregate / field / filters
--
-- describe_object_columns now LEFT JOINs field_metadata and returns these as
-- additional (nullable) columns, so every renderer that already flows through
-- it becomes type-aware at once. Existing return columns are unchanged and in
-- the same order — only additive columns are appended.
-- =============================================================================

-- ── 1. Extend field_metadata ────────────────────────────────────────────────
ALTER TABLE public.field_metadata
  ADD COLUMN IF NOT EXISTS fm_field_kind        text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS fm_display_type      text,
  ADD COLUMN IF NOT EXISTS fm_formula_expression text,
  ADD COLUMN IF NOT EXISTS fm_formula_return_type text,
  ADD COLUMN IF NOT EXISTS fm_formula_refs      jsonb,
  ADD COLUMN IF NOT EXISTS fm_rollup_config     jsonb;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'field_metadata_fm_field_kind_check'
  ) THEN
    ALTER TABLE public.field_metadata
      ADD CONSTRAINT field_metadata_fm_field_kind_check
      CHECK (fm_field_kind IN ('standard','formula','rollup'));
  END IF;
END $$;

COMMENT ON COLUMN public.field_metadata.fm_field_kind IS
  'standard | formula (computed-at-read) | rollup (aggregate of child records)';
COMMENT ON COLUMN public.field_metadata.fm_display_type IS
  'Logical display/editor type override (text, textarea, number, integer, currency, percent, date, datetime, boolean, email, phone, url, picklist, lookup). Null → derive from the physical Postgres type.';
COMMENT ON COLUMN public.field_metadata.fm_formula_refs IS
  'Array of {alias, kind:field|related, column, fk_column?, table?, column_type?, lookup_table?, lookup_field?} describing every symbol the formula expression references, so the record loader can resolve same-object and cross-object values into the evaluation scope.';
COMMENT ON COLUMN public.field_metadata.fm_rollup_config IS
  'Object {child_table, child_fk, function:COUNT|SUM|AVG|MIN|MAX, field?, filters?:[{column,op,value}], return_type} defining the aggregate over child records.';


-- ── 2. describe_object_columns — overlay field_metadata (authoritative type) ──
-- Recreated verbatim from the baseline with a LEFT JOIN to field_metadata and
-- additive return columns appended. Physical-type derivation is byte-identical
-- to the prior definition; only the logical overlay columns are new. DROP first:
-- adding OUT columns changes the return row type, which CREATE OR REPLACE cannot
-- do. Nothing in the DB depends on it (PostgREST resolves it by name at runtime),
-- so the drop is safe.
DROP FUNCTION IF EXISTS public.describe_object_columns(text);
CREATE OR REPLACE FUNCTION public.describe_object_columns(p_table text)
 RETURNS TABLE(
   column_name text, data_type text, is_nullable text, column_default text,
   character_maximum_length integer, numeric_precision integer, numeric_scale integer,
   ordinal_position integer, is_primary_key boolean, is_foreign_key boolean,
   references_table text, references_column text,
   -- additive logical-type overlay (from field_metadata) --------------------
   field_label text, help_text text, financial_tier integer, track_history boolean,
   is_custom boolean, field_kind text, display_type text,
   formula_expression text, formula_return_type text, formula_refs jsonb,
   rollup_config jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH rel AS (
    SELECT c.oid AS relid
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = p_table AND c.relkind IN ('r','p')
  ),
  pk AS (
    SELECT unnest(con.conkey) AS attnum
    FROM pg_catalog.pg_constraint con, rel
    WHERE con.conrelid = rel.relid AND con.contype = 'p'
  ),
  fk AS (
    SELECT
      con.conkey[1] AS attnum,
      fc.relname    AS ref_table,
      fa.attname    AS ref_column
    FROM pg_catalog.pg_constraint con
    JOIN rel ON con.conrelid = rel.relid
    JOIN pg_catalog.pg_class     fc ON fc.oid = con.confrelid
    JOIN pg_catalog.pg_attribute fa
      ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
  )
  SELECT
    a.attname::text                        AS column_name,
    CASE
      WHEN a.attndims > 0 THEN 'ARRAY'
      ELSE CASE t.typname
        WHEN 'int2'        THEN 'smallint'
        WHEN 'int4'        THEN 'integer'
        WHEN 'int8'        THEN 'bigint'
        WHEN 'float4'      THEN 'real'
        WHEN 'float8'      THEN 'double precision'
        WHEN 'numeric'     THEN 'numeric'
        WHEN 'varchar'     THEN 'character varying'
        WHEN 'bpchar'      THEN 'character'
        WHEN 'bool'        THEN 'boolean'
        WHEN 'timestamp'   THEN 'timestamp without time zone'
        WHEN 'timestamptz' THEN 'timestamp with time zone'
        WHEN 'time'        THEN 'time without time zone'
        WHEN 'timetz'      THEN 'time with time zone'
        WHEN 'date'        THEN 'date'
        WHEN 'text'        THEN 'text'
        WHEN 'uuid'        THEN 'uuid'
        WHEN 'jsonb'       THEN 'jsonb'
        WHEN 'json'        THEN 'json'
        ELSE t.typname::text
      END
    END                                    AS data_type,
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)    AS column_default,
    CASE
      WHEN t.typname IN ('varchar','bpchar') AND a.atttypmod > 4
        THEN (a.atttypmod - 4)
      ELSE NULL
    END::int                               AS character_maximum_length,
    CASE
      WHEN t.typname = 'numeric' AND a.atttypmod >= 4
        THEN ((a.atttypmod - 4) >> 16) & 65535
      WHEN t.typname = 'int2' THEN 16
      WHEN t.typname = 'int4' THEN 32
      WHEN t.typname = 'int8' THEN 64
      WHEN t.typname = 'float4' THEN 24
      WHEN t.typname = 'float8' THEN 53
      ELSE NULL
    END::int                               AS numeric_precision,
    CASE
      WHEN t.typname = 'numeric' AND a.atttypmod >= 4
        THEN (a.atttypmod - 4) & 65535
      WHEN t.typname IN ('int2','int4','int8') THEN 0
      ELSE NULL
    END::int                               AS numeric_scale,
    a.attnum::int                          AS ordinal_position,
    (pk.attnum IS NOT NULL)                AS is_primary_key,
    (fk.attnum IS NOT NULL)                AS is_foreign_key,
    fk.ref_table::text                     AS references_table,
    fk.ref_column::text                    AS references_column,
    fm.fm_label                            AS field_label,
    fm.fm_help_text                        AS help_text,
    fm.fm_financial_tier                   AS financial_tier,
    fm.fm_track_history                    AS track_history,
    COALESCE(fm.fm_is_custom, false)       AS is_custom,
    COALESCE(fm.fm_field_kind, 'standard') AS field_kind,
    fm.fm_display_type                     AS display_type,
    fm.fm_formula_expression               AS formula_expression,
    fm.fm_formula_return_type              AS formula_return_type,
    fm.fm_formula_refs                     AS formula_refs,
    fm.fm_rollup_config                    AS rollup_config
  FROM rel
  JOIN pg_catalog.pg_attribute a ON a.attrelid = rel.relid
  JOIN pg_catalog.pg_type      t ON t.oid      = a.atttypid
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  LEFT JOIN pk ON pk.attnum = a.attnum
  LEFT JOIN fk ON fk.attnum = a.attnum
  LEFT JOIN public.field_metadata fm
    ON fm.fm_object = p_table AND fm.fm_column = a.attname AND fm.fm_is_deleted = false
  WHERE a.attnum > 0 AND NOT a.attisdropped
  ORDER BY a.attnum;
$function$;

REVOKE ALL ON FUNCTION public.describe_object_columns(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.describe_object_columns(text) TO authenticated, service_role;


-- ── 3. admin_update_field_definition — edit type / formula / rollup ──────────
-- Supersedes admin_upsert_field_metadata for the field editor: same
-- presentation fields PLUS logical type, formula, and rollup configuration.
-- Admin-only. Validates the column exists and (for rollups) that the child
-- table/fk/field are real. Does NOT alter the physical column — type is
-- metadata over storage (Salesforce model); formula/rollup are computed-at-read.
CREATE OR REPLACE FUNCTION public.admin_update_field_definition(
  p_object text,
  p_column text,
  p_label text,
  p_help_text text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_example_value text DEFAULT NULL,
  p_financial_tier integer DEFAULT 1,
  p_track_history boolean DEFAULT false,
  p_display_type text DEFAULT NULL,
  p_field_kind text DEFAULT 'standard',
  p_formula_expression text DEFAULT NULL,
  p_formula_return_type text DEFAULT NULL,
  p_formula_refs jsonb DEFAULT NULL,
  p_rollup_config jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user uuid;
  v_exists boolean;
  v_kind text := COALESCE(NULLIF(btrim(p_field_kind),''), 'standard');
  v_disp text := NULLIF(btrim(p_display_type),'');
  v_child text;
  v_fk text;
  v_func text;
  v_agg_field text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Editing field definitions is admin-only' USING ERRCODE='insufficient_privilege';
  END IF;
  IF p_financial_tier NOT IN (1,2,3) THEN
    RAISE EXCEPTION 'financial_tier must be 1, 2, or 3' USING ERRCODE='invalid_parameter_value';
  END IF;
  IF v_kind NOT IN ('standard','formula','rollup') THEN
    RAISE EXCEPTION 'field_kind must be standard, formula, or rollup' USING ERRCODE='invalid_parameter_value';
  END IF;
  IF v_disp IS NOT NULL AND v_disp NOT IN (
    'text','textarea','number','integer','currency','percent','date','datetime',
    'boolean','email','phone','url','picklist','lookup','formula','rollup'
  ) THEN
    RAISE EXCEPTION 'Unsupported display type: %', v_disp USING ERRCODE='invalid_parameter_value';
  END IF;

  -- Column must exist on the object.
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname=p_object AND a.attname=p_column
      AND a.attnum>0 AND NOT a.attisdropped
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Column % does not exist on %', p_column, p_object USING ERRCODE='invalid_parameter_value';
  END IF;

  -- Formula validation (light — the client engine does full syntax validation).
  IF v_kind = 'formula' THEN
    IF COALESCE(btrim(p_formula_expression),'') = '' THEN
      RAISE EXCEPTION 'A formula field requires an expression' USING ERRCODE='invalid_parameter_value';
    END IF;
  END IF;

  -- Rollup validation — the child table, FK, and (for non-COUNT) field must exist.
  IF v_kind = 'rollup' THEN
    IF p_rollup_config IS NULL THEN
      RAISE EXCEPTION 'A rollup field requires a rollup configuration' USING ERRCODE='invalid_parameter_value';
    END IF;
    v_child     := NULLIF(btrim(p_rollup_config->>'child_table'), '');
    v_fk        := NULLIF(btrim(p_rollup_config->>'child_fk'), '');
    v_func      := upper(NULLIF(btrim(p_rollup_config->>'function'), ''));
    v_agg_field := NULLIF(btrim(p_rollup_config->>'field'), '');
    IF v_child IS NULL OR v_fk IS NULL OR v_func IS NULL THEN
      RAISE EXCEPTION 'Rollup config needs child_table, child_fk, and function' USING ERRCODE='invalid_parameter_value';
    END IF;
    IF v_func NOT IN ('COUNT','SUM','AVG','MIN','MAX') THEN
      RAISE EXCEPTION 'Rollup function must be COUNT, SUM, AVG, MIN, or MAX' USING ERRCODE='invalid_parameter_value';
    END IF;
    -- child_table is a real base table
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v_child AND c.relkind='r'
    ) INTO v_exists;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'Rollup child table % does not exist', v_child USING ERRCODE='invalid_parameter_value';
    END IF;
    -- child_fk column exists on the child table
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v_child AND a.attname=v_fk AND a.attnum>0 AND NOT a.attisdropped
    ) INTO v_exists;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'Rollup FK column % does not exist on %', v_fk, v_child USING ERRCODE='invalid_parameter_value';
    END IF;
    -- aggregate field exists when the function needs one
    IF v_func <> 'COUNT' THEN
      IF v_agg_field IS NULL THEN
        RAISE EXCEPTION 'Rollup function % requires a field to aggregate', v_func USING ERRCODE='invalid_parameter_value';
      END IF;
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=v_child AND a.attname=v_agg_field AND a.attnum>0 AND NOT a.attisdropped
      ) INTO v_exists;
      IF NOT v_exists THEN
        RAISE EXCEPTION 'Rollup field % does not exist on %', v_agg_field, v_child USING ERRCODE='invalid_parameter_value';
      END IF;
    END IF;
  END IF;

  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid();

  INSERT INTO public.field_metadata (
    fm_record_number, fm_object, fm_column, fm_label, fm_help_text, fm_description,
    fm_example_value, fm_financial_tier, fm_track_history,
    fm_field_kind, fm_display_type, fm_formula_expression, fm_formula_return_type,
    fm_formula_refs, fm_rollup_config, fm_created_by, fm_updated_by
  ) VALUES (
    '', p_object, p_column, COALESCE(NULLIF(btrim(p_label),''), p_column), p_help_text, p_description,
    p_example_value, p_financial_tier, p_track_history,
    v_kind,
    v_disp,
    CASE WHEN v_kind='formula' THEN p_formula_expression ELSE NULL END,
    CASE WHEN v_kind='formula' THEN NULLIF(btrim(p_formula_return_type),'') ELSE NULL END,
    CASE WHEN v_kind='formula' THEN p_formula_refs ELSE NULL END,
    CASE WHEN v_kind='rollup'  THEN p_rollup_config ELSE NULL END,
    v_user, v_user
  )
  ON CONFLICT (fm_object, fm_column) DO UPDATE SET
    fm_label             = COALESCE(NULLIF(btrim(EXCLUDED.fm_label),''), field_metadata.fm_label),
    fm_help_text         = EXCLUDED.fm_help_text,
    fm_description       = EXCLUDED.fm_description,
    fm_example_value     = EXCLUDED.fm_example_value,
    fm_financial_tier    = EXCLUDED.fm_financial_tier,
    fm_track_history     = EXCLUDED.fm_track_history,
    fm_field_kind        = EXCLUDED.fm_field_kind,
    fm_display_type      = EXCLUDED.fm_display_type,
    fm_formula_expression = EXCLUDED.fm_formula_expression,
    fm_formula_return_type= EXCLUDED.fm_formula_return_type,
    fm_formula_refs      = EXCLUDED.fm_formula_refs,
    fm_rollup_config     = EXCLUDED.fm_rollup_config,
    fm_is_deleted        = false,   -- editing a field re-activates its metadata
    fm_updated_by        = v_user,
    fm_updated_at        = now();

  RETURN jsonb_build_object('ok', true, 'object', p_object, 'column', p_column, 'field_kind', v_kind);
END; $function$;

REVOKE ALL ON FUNCTION public.admin_update_field_definition(text,text,text,text,text,text,integer,boolean,text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_field_definition(text,text,text,text,text,text,integer,boolean,text,text,text,text,jsonb,jsonb) TO authenticated, service_role;


-- ── 4. compute_record_rollups — evaluate all rollup fields for one record ────
-- Returns a jsonb map { column_name: value } for every rollup field defined on
-- p_object, aggregating child records that point back via the configured FK.
-- SECURITY INVOKER so the caller's RLS governs which child rows are counted.
-- Soft-deleted child rows are excluded automatically when the child table has
-- an is_deleted-style boolean column.
CREATE OR REPLACE FUNCTION public.compute_record_rollups(p_object text, p_record_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_out jsonb := '{}'::jsonb;
  r record;
  v_child text; v_fk text; v_func text; v_field text;
  v_deleted_col text;
  v_sql text; v_val numeric; v_where text; v_filter jsonb;
  v_col text; v_op text; v_raw text; v_safe_op text;
BEGIN
  IF p_record_id IS NULL THEN RETURN v_out; END IF;

  FOR r IN
    SELECT fm_column, fm_rollup_config
    FROM public.field_metadata
    WHERE fm_object = p_object AND fm_field_kind = 'rollup'
      AND fm_is_deleted = false AND fm_rollup_config IS NOT NULL
  LOOP
    v_child := NULLIF(btrim(r.fm_rollup_config->>'child_table'), '');
    v_fk    := NULLIF(btrim(r.fm_rollup_config->>'child_fk'), '');
    v_func  := upper(NULLIF(btrim(r.fm_rollup_config->>'function'), ''));
    v_field := NULLIF(btrim(r.fm_rollup_config->>'field'), '');

    -- Re-validate against the live catalog every call (config could be stale).
    IF v_child IS NULL OR v_fk IS NULL OR v_func NOT IN ('COUNT','SUM','AVG','MIN','MAX') THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                   WHERE n.nspname='public' AND c.relname=v_child AND c.relkind='r') THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
                   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                   WHERE n.nspname='public' AND c.relname=v_child AND a.attname=v_fk AND a.attnum>0 AND NOT a.attisdropped) THEN CONTINUE; END IF;
    IF v_func <> 'COUNT' THEN
      IF v_field IS NULL THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
                     JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='public' AND c.relname=v_child AND a.attname=v_field AND a.attnum>0 AND NOT a.attisdropped) THEN CONTINUE; END IF;
    END IF;

    -- Auto-exclude soft-deleted child rows if the table carries an is_deleted flag.
    SELECT a.attname INTO v_deleted_col
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
    WHERE n.nspname='public' AND c.relname=v_child AND t.typname='bool'
      AND (a.attname='is_deleted' OR a.attname LIKE '%\_is\_deleted')
      AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY a.attnum LIMIT 1;

    v_where := format('%I = %L', v_fk, p_record_id);
    IF v_deleted_col IS NOT NULL THEN
      v_where := v_where || format(' AND COALESCE(%I, false) = false', v_deleted_col);
    END IF;

    -- Optional simple filters: [{column, op, value}]. Columns validated; ops whitelisted.
    IF jsonb_typeof(r.fm_rollup_config->'filters') = 'array' THEN
      FOR v_filter IN SELECT * FROM jsonb_array_elements(r.fm_rollup_config->'filters') LOOP
        v_col := NULLIF(btrim(v_filter->>'column'), '');
        v_op  := NULLIF(btrim(v_filter->>'op'), '');
        v_raw := v_filter->>'value';
        IF v_col IS NULL OR v_op IS NULL THEN CONTINUE; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
                       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                       WHERE n.nspname='public' AND c.relname=v_child AND a.attname=v_col AND a.attnum>0 AND NOT a.attisdropped) THEN CONTINUE; END IF;
        v_safe_op := CASE v_op WHEN '=' THEN '=' WHEN '!=' THEN '<>' WHEN '<>' THEN '<>'
                               WHEN '>' THEN '>' WHEN '>=' THEN '>=' WHEN '<' THEN '<' WHEN '<=' THEN '<=' ELSE NULL END;
        IF v_safe_op IS NULL THEN CONTINUE; END IF;
        v_where := v_where || format(' AND %I %s %L', v_col, v_safe_op, v_raw);
      END LOOP;
    END IF;

    IF v_func = 'COUNT' THEN
      v_sql := format('SELECT count(*)::numeric FROM public.%I WHERE %s', v_child, v_where);
    ELSE
      v_sql := format('SELECT %s(%I)::numeric FROM public.%I WHERE %s', v_func, v_field, v_child, v_where);
    END IF;

    BEGIN
      EXECUTE v_sql INTO v_val;
    EXCEPTION WHEN OTHERS THEN
      v_val := NULL;
    END;

    v_out := v_out || jsonb_build_object(r.fm_column, v_val);
  END LOOP;

  RETURN v_out;
END; $function$;

REVOKE ALL ON FUNCTION public.compute_record_rollups(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_record_rollups(text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
