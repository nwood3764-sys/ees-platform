-- Inherited Field type — a first-class, admin-createable field kind that shows a
-- read-only value pulled from a BASE record up the parent chain (Salesforce's
-- cross-object formula field). No physical column: the value is resolved at read
-- from field_metadata, exactly like formula/rollup. This is the "don't duplicate
-- parent data on child records — reference it" primitive.
--
-- Storage: field_metadata.fm_field_kind='inherited' + fm_inherit_config jsonb:
--   {
--     "hops": [ {"fk":"property_id","table":"properties"},
--               {"fk":"property_account_id","table":"accounts"} ],  -- chain, self→base
--     "source_column": "account_email",   -- column on the base (last hop) table
--     "source_data_type": "text",          -- physical type of source (for describe)
--     "display_type": "email"              -- how to render (scalar display types only, v1)
--   }
-- Multi-hop: hops[0].fk is a column on the object; hops[i].fk is a column on
-- hops[i-1].table; hops[last].table is the base. One hop = direct parent.

-- 1. Config column + widen the field-kind CHECK to allow 'inherited' ---------
ALTER TABLE public.field_metadata
  ADD COLUMN IF NOT EXISTS fm_inherit_config jsonb;

ALTER TABLE public.field_metadata DROP CONSTRAINT IF EXISTS field_metadata_fm_field_kind_check;
ALTER TABLE public.field_metadata ADD CONSTRAINT field_metadata_fm_field_kind_check
  CHECK (fm_field_kind = ANY (ARRAY['standard'::text, 'formula'::text, 'rollup'::text, 'inherited'::text]));

-- 2. describe_object_columns — expose inherited fields as virtual columns so the
--    Fields list and the page-layout palette can see and place them. The physical
--    branch is byte-identical to the prior definition (only its trailing ORDER BY
--    moved out to the union); a UNION ALL appends the virtual inherited rows. Same
--    OUT signature, so CREATE OR REPLACE (no DROP) is safe.
CREATE OR REPLACE FUNCTION public.describe_object_columns(p_table text)
 RETURNS TABLE(column_name text, data_type text, is_nullable text, column_default text, character_maximum_length integer, numeric_precision integer, numeric_scale integer, ordinal_position integer, is_primary_key boolean, is_foreign_key boolean, references_table text, references_column text, field_label text, help_text text, financial_tier integer, track_history boolean, is_custom boolean, field_kind text, display_type text, formula_expression text, formula_return_type text, formula_refs jsonb, rollup_config jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH rel AS (
    SELECT c.oid AS relid FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = p_table AND c.relkind IN ('r','p')
  ),
  pk AS (
    SELECT unnest(con.conkey) AS attnum FROM pg_catalog.pg_constraint con, rel
    WHERE con.conrelid = rel.relid AND con.contype = 'p'
  ),
  fk AS (
    SELECT con.conkey[1] AS attnum, fc.relname AS ref_table, fa.attname AS ref_column
    FROM pg_catalog.pg_constraint con
    JOIN rel ON con.conrelid = rel.relid
    JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid
    JOIN pg_catalog.pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
  )
  SELECT
    a.attname::text AS column_name,
    CASE WHEN a.attndims > 0 THEN 'ARRAY'
      ELSE CASE t.typname
        WHEN 'int2' THEN 'smallint' WHEN 'int4' THEN 'integer' WHEN 'int8' THEN 'bigint'
        WHEN 'float4' THEN 'real' WHEN 'float8' THEN 'double precision' WHEN 'numeric' THEN 'numeric'
        WHEN 'varchar' THEN 'character varying' WHEN 'bpchar' THEN 'character' WHEN 'bool' THEN 'boolean'
        WHEN 'timestamp' THEN 'timestamp without time zone' WHEN 'timestamptz' THEN 'timestamp with time zone'
        WHEN 'time' THEN 'time without time zone' WHEN 'timetz' THEN 'time with time zone'
        WHEN 'date' THEN 'date' WHEN 'text' THEN 'text' WHEN 'uuid' THEN 'uuid'
        WHEN 'jsonb' THEN 'jsonb' WHEN 'json' THEN 'json' ELSE t.typname::text END
    END AS data_type,
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
    CASE WHEN t.typname IN ('varchar','bpchar') AND a.atttypmod > 4 THEN (a.atttypmod - 4) ELSE NULL END::int AS character_maximum_length,
    CASE WHEN t.typname = 'numeric' AND a.atttypmod >= 4 THEN ((a.atttypmod - 4) >> 16) & 65535
      WHEN t.typname = 'int2' THEN 16 WHEN t.typname = 'int4' THEN 32 WHEN t.typname = 'int8' THEN 64
      WHEN t.typname = 'float4' THEN 24 WHEN t.typname = 'float8' THEN 53 ELSE NULL END::int AS numeric_precision,
    CASE WHEN t.typname = 'numeric' AND a.atttypmod >= 4 THEN (a.atttypmod - 4) & 65535
      WHEN t.typname IN ('int2','int4','int8') THEN 0 ELSE NULL END::int AS numeric_scale,
    a.attnum::int AS ordinal_position,
    (pk.attnum IS NOT NULL) AS is_primary_key,
    (fk.attnum IS NOT NULL) AS is_foreign_key,
    fk.ref_table::text AS references_table,
    fk.ref_column::text AS references_column,
    fm.fm_label AS field_label,
    fm.fm_help_text AS help_text,
    fm.fm_financial_tier AS financial_tier,
    fm.fm_track_history AS track_history,
    COALESCE(fm.fm_is_custom, false) AS is_custom,
    COALESCE(fm.fm_field_kind, 'standard') AS field_kind,
    fm.fm_display_type AS display_type,
    fm.fm_formula_expression AS formula_expression,
    fm.fm_formula_return_type AS formula_return_type,
    fm.fm_formula_refs AS formula_refs,
    fm.fm_rollup_config AS rollup_config
  FROM rel
  JOIN pg_catalog.pg_attribute a ON a.attrelid = rel.relid
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  LEFT JOIN pk ON pk.attnum = a.attnum
  LEFT JOIN fk ON fk.attnum = a.attnum
  LEFT JOIN public.field_metadata fm ON fm.fm_object = p_table AND fm.fm_column = a.attname AND fm.fm_is_deleted = false
  WHERE a.attnum > 0 AND NOT a.attisdropped

  UNION ALL

  -- Virtual inherited fields: no physical column, surfaced from field_metadata.
  SELECT
    fm.fm_column::text,
    COALESCE(fm.fm_inherit_config->>'source_data_type', 'text')::text,
    'YES'::text,
    NULL::text,
    NULL::int, NULL::int, NULL::int,
    (9000 + row_number() OVER (ORDER BY fm.fm_column))::int,
    false,
    false,
    NULL::text, NULL::text,
    fm.fm_label,
    fm.fm_help_text,
    fm.fm_financial_tier,
    fm.fm_track_history,
    COALESCE(fm.fm_is_custom, true),
    'inherited'::text,
    COALESCE(fm.fm_display_type, fm.fm_inherit_config->>'display_type', 'text')::text,
    NULL::text, NULL::text, NULL::jsonb, NULL::jsonb
  FROM public.field_metadata fm
  WHERE fm.fm_object = p_table
    AND fm.fm_field_kind = 'inherited'
    AND fm.fm_is_deleted = false
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a2
      JOIN pg_catalog.pg_class c2 ON c2.oid = a2.attrelid
      JOIN pg_catalog.pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname='public' AND c2.relname=p_table AND a2.attname=fm.fm_column
        AND a2.attnum>0 AND NOT a2.attisdropped
    )

  ORDER BY ordinal_position;
$function$;

-- 3. admin_upsert_inherited_field — create/edit an inherited field. Validates the
--    hop chain (each FK exists on the correct table and references the next table)
--    and the source column, then upserts the field_metadata definition. No DDL,
--    no physical column.
CREATE OR REPLACE FUNCTION public.admin_upsert_inherited_field(
  p_object text,
  p_column text,
  p_label text,
  p_config jsonb,
  p_display_type text DEFAULT 'text',
  p_help_text text DEFAULT NULL,
  p_financial_tier integer DEFAULT 1
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user uuid;
  v_disp text := COALESCE(NULLIF(btrim(p_display_type),''), 'text');
  v_hops jsonb := p_config->'hops';
  v_src  text := NULLIF(btrim(p_config->>'source_column'), '');
  v_cur_table text := p_object;
  v_fk text; v_next_table text; v_ref_table text; v_n int; i int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Editing field definitions is admin-only' USING ERRCODE='insufficient_privilege';
  END IF;
  IF p_financial_tier NOT IN (1,2,3) THEN
    RAISE EXCEPTION 'financial_tier must be 1, 2, or 3' USING ERRCODE='invalid_parameter_value';
  END IF;
  IF v_disp NOT IN ('text','textarea','number','integer','currency','percent','date',
                    'datetime','boolean','email','phone','url') THEN
    RAISE EXCEPTION 'Inherited fields support scalar display types only (got %)', v_disp USING ERRCODE='invalid_parameter_value';
  END IF;
  IF NULLIF(btrim(p_column),'') IS NULL THEN
    RAISE EXCEPTION 'A field name is required' USING ERRCODE='invalid_parameter_value';
  END IF;
  -- The column must be VIRTUAL: it must not collide with a real column on the object.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=p_object AND a.attname=p_column AND a.attnum>0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'A physical column named % already exists on % — pick a different field name', p_column, p_object USING ERRCODE='invalid_parameter_value';
  END IF;
  IF v_hops IS NULL OR jsonb_typeof(v_hops) <> 'array' OR jsonb_array_length(v_hops) < 1 THEN
    RAISE EXCEPTION 'An inherited field needs at least one relationship hop' USING ERRCODE='invalid_parameter_value';
  END IF;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'An inherited field needs a source_column' USING ERRCODE='invalid_parameter_value';
  END IF;

  -- Walk and validate each hop: hops[i].fk must be an FK on the current table
  -- whose referenced table equals hops[i].table.
  v_n := jsonb_array_length(v_hops);
  FOR i IN 0..v_n-1 LOOP
    v_fk := NULLIF(btrim(v_hops->i->>'fk'), '');
    v_next_table := NULLIF(btrim(v_hops->i->>'table'), '');
    IF v_fk IS NULL OR v_next_table IS NULL THEN
      RAISE EXCEPTION 'Hop % is missing fk/table', i USING ERRCODE='invalid_parameter_value';
    END IF;
    SELECT fc.relname INTO v_ref_table
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid
    WHERE n.nspname='public' AND c.relname=v_cur_table AND con.contype='f'
      AND array_length(con.conkey,1)=1 AND a.attname=v_fk;
    IF v_ref_table IS NULL THEN
      RAISE EXCEPTION 'Column % on % is not a foreign key', v_fk, v_cur_table USING ERRCODE='invalid_parameter_value';
    END IF;
    IF v_ref_table <> v_next_table THEN
      RAISE EXCEPTION 'Hop % (% on %) points at %, not %', i, v_fk, v_cur_table, v_ref_table, v_next_table USING ERRCODE='invalid_parameter_value';
    END IF;
    v_cur_table := v_next_table;  -- advance to the base for the next hop
  END LOOP;

  -- v_cur_table is now the base (last hop) table. The source column must exist on it.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v_cur_table AND a.attname=v_src AND a.attnum>0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'Source column % does not exist on base table %', v_src, v_cur_table USING ERRCODE='invalid_parameter_value';
  END IF;

  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid();

  INSERT INTO public.field_metadata (
    fm_record_number, fm_object, fm_column, fm_label, fm_help_text,
    fm_financial_tier, fm_field_kind, fm_display_type, fm_inherit_config,
    fm_is_custom, fm_created_by, fm_updated_by
  ) VALUES (
    '', p_object, p_column, COALESCE(NULLIF(btrim(p_label),''), p_column), p_help_text,
    p_financial_tier, 'inherited', v_disp, p_config,
    true, v_user, v_user
  )
  ON CONFLICT (fm_object, fm_column) DO UPDATE SET
    fm_label = COALESCE(NULLIF(btrim(EXCLUDED.fm_label),''), field_metadata.fm_label),
    fm_help_text = EXCLUDED.fm_help_text,
    fm_financial_tier = EXCLUDED.fm_financial_tier,
    fm_field_kind = 'inherited',
    fm_display_type = EXCLUDED.fm_display_type,
    fm_inherit_config = EXCLUDED.fm_inherit_config,
    fm_is_custom = true,
    fm_is_deleted = false,
    fm_updated_by = v_user,
    fm_updated_at = now();

  RETURN jsonb_build_object('ok', true, 'object', p_object, 'column', p_column,
                            'field_kind', 'inherited', 'base_object', v_cur_table);
END; $function$;

-- 4. admin_remove_inherited_field — soft-delete the metadata row (there is no
--    physical column to drop).
CREATE OR REPLACE FUNCTION public.admin_remove_inherited_field(p_object text, p_column text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_user uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Editing field definitions is admin-only' USING ERRCODE='insufficient_privilege';
  END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_user_id = auth.uid();
  UPDATE public.field_metadata
    SET fm_is_deleted = true, fm_updated_by = v_user, fm_updated_at = now()
    WHERE fm_object = p_object AND fm_column = p_column AND fm_field_kind = 'inherited';
  RETURN jsonb_build_object('ok', true);
END; $function$;

-- 5. Grants — mirror the sibling admin field RPCs (SECURITY DEFINER, admin-gated
--    inside; describe_object_columns stays readable by authenticated).
REVOKE ALL ON FUNCTION public.admin_upsert_inherited_field(text,text,text,jsonb,text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_inherited_field(text,text,text,jsonb,text,text,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_remove_inherited_field(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_inherited_field(text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
