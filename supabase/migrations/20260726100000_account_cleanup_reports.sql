-- Two purpose-built account data-cleanup reports (Nicholas, 2026-07-26):
--   RPT: "Account Near-Miss Duplicate Names Report" — active accounts whose names match
--        another active account once punctuation/entity suffixes are stripped
--        (the 2026-07-25 dedupe only merged exact upper/trim matches).
--   RPT: "Accounts Missing Record Type Report" — active accounts with no record type
--        (mostly the 2026-06-29 HUD import pass).
-- Both are tabular reports on the accounts base table so report rows hyperlink to the
-- account and the Record Type column is inline-editable in the report runner.
--
-- The near-miss report is scoped via a cross filter on account_near_miss_flags — a
-- purpose-built flag table (FK -> accounts) rebuilt by refresh_account_near_miss_flags(),
-- because the report engine's cross filters require a real table with a FK to the
-- primary object.

-- 1. Flag table: one row per active account that is part of a near-miss name group.
CREATE TABLE IF NOT EXISTS public.account_near_miss_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  anmf_match_group_key text NOT NULL,
  anmf_other_account_names text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_near_miss_flags_account_idx
  ON public.account_near_miss_flags (account_id);
CREATE INDEX IF NOT EXISTS account_near_miss_flags_group_idx
  ON public.account_near_miss_flags (anmf_match_group_key);

ALTER TABLE public.account_near_miss_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_near_miss_flags_read ON public.account_near_miss_flags;
CREATE POLICY account_near_miss_flags_read ON public.account_near_miss_flags
  FOR SELECT TO authenticated
  USING (app_user_can('accounts', 'read'));

REVOKE ALL ON public.account_near_miss_flags FROM PUBLIC, anon;
GRANT SELECT ON public.account_near_miss_flags TO authenticated;
GRANT ALL ON public.account_near_miss_flags TO service_role;

-- 2. Rebuild function — re-run any time (e.g. after merges or renames).
CREATE OR REPLACE FUNCTION public.refresh_account_near_miss_flags()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM account_near_miss_flags;

  WITH act AS (
    SELECT a.id, a.account_name,
           normalize_duplicate_match_name(a.account_name) AS canon
    FROM accounts a
    WHERE a.account_is_deleted IS NOT TRUE
      AND normalize_duplicate_match_name(a.account_name) IS NOT NULL
  ),
  grp AS (
    SELECT canon FROM act GROUP BY canon HAVING count(*) > 1
  )
  INSERT INTO account_near_miss_flags (account_id, anmf_match_group_key, anmf_other_account_names)
  SELECT act.id, act.canon,
         (SELECT string_agg(o.account_name, ' | ' ORDER BY o.account_name)
          FROM act o WHERE o.canon = act.canon AND o.id <> act.id)
  FROM act JOIN grp USING (canon);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_account_near_miss_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_account_near_miss_flags() TO authenticated, service_role;

SELECT public.refresh_account_near_miss_flags();

-- 3. The two report definitions.
DO $$
DECLARE
  v_owner uuid;
  v_rpt_near_miss uuid;
  v_rpt_missing_rt uuid;
BEGIN
  SELECT id INTO v_owner FROM users
   WHERE user_email = 'nicholas.wood@ees-wi.org' AND user_is_deleted IS NOT TRUE
   LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Report owner user not found';
  END IF;

  -- Idempotency: skip if already seeded.
  IF EXISTS (SELECT 1 FROM reports WHERE rpt_name = 'Account Near-Miss Duplicate Names Report'
               AND is_deleted IS NOT TRUE) THEN
    RETURN;
  END IF;

  INSERT INTO reports (
    rpt_record_number, rpt_name, rpt_description, rpt_format, rpt_primary_object,
    rpt_selected_fields, rpt_filter_logic, rpt_sort_config, rpt_column_groupings,
    rpt_runtime_prompts, rpt_charts, rpt_owner_user_id, created_by, updated_by
  ) VALUES (
    '',
    'Account Near-Miss Duplicate Names Report',
    'Active accounts whose names match another active account once punctuation and entity suffixes (LLC, Inc., LP, ...) are stripped. Sorted by name so likely duplicates sit next to each other. Open an account from the row link and use the Merge action if it is a true duplicate; Record Type is editable inline. Re-run refresh_account_near_miss_flags() after large merges/renames to update the flag list.',
    'tabular', 'accounts',
    '[{"name":"account_name","type":"text","label":"Account Name","table":"accounts","via_path":null},
      {"name":"account_record_number","type":"text","label":"Account Number","table":"accounts","via_path":null},
      {"name":"account_record_type","type":"uuid","label":"Record Type","table":"accounts","via_path":null},
      {"name":"billing_city","type":"text","label":"Billing City","table":"accounts","via_path":null},
      {"name":"billing_state","type":"text","label":"Billing State","table":"accounts","via_path":null},
      {"name":"account_created_at","type":"timestamptz","label":"Created","table":"accounts","via_path":null}]'::jsonb,
    'all',
    '[{"name":"account_name","direction":"asc"}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    v_owner, v_owner, v_owner
  ) RETURNING id INTO v_rpt_near_miss;

  INSERT INTO report_filters (
    rfilt_report_id, rfilt_filter_index, rfilt_field_name, rfilt_field_table,
    rfilt_field_via_path, rfilt_operator, rfilt_value,
    rfilt_is_cross_filter, rfilt_cross_object, rfilt_cross_match,
    rfilt_cross_subfilters, rfilt_is_runtime_prompt
  ) VALUES (
    v_rpt_near_miss, 1, 'id', 'accounts',
    NULL, 'equals', 'null'::jsonb,
    true, 'account_near_miss_flags', 'with',
    '[]'::jsonb, false
  );

  INSERT INTO reports (
    rpt_record_number, rpt_name, rpt_description, rpt_format, rpt_primary_object,
    rpt_selected_fields, rpt_filter_logic, rpt_sort_config, rpt_column_groupings,
    rpt_runtime_prompts, rpt_charts, rpt_owner_user_id, created_by, updated_by
  ) VALUES (
    '',
    'Accounts Missing Record Type Report',
    'Active accounts with no record type set — mostly the 2026-06-29 HUD import pass. Open the account from the row link, or set the Record Type directly in the report row (double-click the Record Type cell).',
    'tabular', 'accounts',
    '[{"name":"account_name","type":"text","label":"Account Name","table":"accounts","via_path":null},
      {"name":"account_record_number","type":"text","label":"Account Number","table":"accounts","via_path":null},
      {"name":"account_record_type","type":"uuid","label":"Record Type","table":"accounts","via_path":null},
      {"name":"billing_city","type":"text","label":"Billing City","table":"accounts","via_path":null},
      {"name":"billing_state","type":"text","label":"Billing State","table":"accounts","via_path":null},
      {"name":"account_created_at","type":"timestamptz","label":"Created","table":"accounts","via_path":null}]'::jsonb,
    'all',
    '[{"name":"account_name","direction":"asc"}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    v_owner, v_owner, v_owner
  ) RETURNING id INTO v_rpt_missing_rt;

  INSERT INTO report_filters (
    rfilt_report_id, rfilt_filter_index, rfilt_field_name, rfilt_field_table,
    rfilt_field_via_path, rfilt_operator, rfilt_value,
    rfilt_is_cross_filter, rfilt_cross_subfilters, rfilt_is_runtime_prompt
  ) VALUES (
    v_rpt_missing_rt, 1, 'account_record_type', 'accounts',
    NULL, 'is_null', 'null'::jsonb,
    false, '[]'::jsonb, false
  );
END $$;

NOTIFY pgrst, 'reload schema';
