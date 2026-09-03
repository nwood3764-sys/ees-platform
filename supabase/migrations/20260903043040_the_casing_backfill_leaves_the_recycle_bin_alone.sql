-- ===========================================================================
-- The casing backfill drops its prefilter and leaves the recycle bin alone.
--
-- Two fixes, both found by RUNNING the widened rule rather than by reading it.
--
-- 1. THE PREFILTER IS GONE. It skipped any value containing a lowercase letter
--    -- a correct superset while names were whole-value, and not one at all now
--    that every kind recases word by word, since a HALF-shouted name is exactly
--    what the widened rule exists to fix. Running the previous migration's
--    backfill with the prefilter still in place returned "0 rewritten" against
--    840 known half-shouted names. This is the SECOND time this prefilter
--    stopped being a superset when the rule moved (the first cost 38 rows on
--    accounts.billing_street), so it is removed rather than narrowed again.
--    Every kind now scans every row; verify_text_case_normalization() was
--    always the real guard.
--
-- 2. SOFT-DELETED ROWS ARE LEFT ALONE. With the prefilter gone, verify_ then
--    reported "still shouting -- buildings.building_name: 1 rows" on
--    "ZZ TEST Seed Property — Email Pipeline - 1", a building somebody threw
--    away months ago. A deleted record is on no screen and no document:
--    rewriting it is churn, and DEMANDING it fails a migration over a discarded
--    test row. Both functions now skip them through the table's own
--    <prefix>_is_deleted column, derived from information_schema rather than
--    listed -- LEAP soft-deletes everything, so every record table has one.
--
--    (The rule itself is idempotent; that was checked before blaming it.
--    normalize(normalize(x)) = normalize(x) on the offending value.)
-- ===========================================================================
create or replace function public._text_case_live_predicate(p_object text)
returns text language sql stable
set search_path to 'public','pg_catalog' as $fn$
  select coalesce(
    (select format('coalesce(%I, false) IS NOT TRUE', column_name)
       from information_schema.columns
      where table_schema = 'public' and table_name = p_object
        and column_name like '%is_deleted'
      order by length(column_name)
      limit 1),
    'TRUE');
$fn$;
revoke all on function public._text_case_live_predicate(text) from public;
revoke all on function public._text_case_live_predicate(text) from anon, authenticated;

create or replace function public.run_text_case_backfill(p_objects text[], p_columns text[] default null)
returns bigint language plpgsql
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  r record; t record; v_sql text; v_rows bigint; v_total bigint := 0;
  v_cols text[]; v_live text;
  v_off  text[] := array[]::text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT tcnc_column), array[]::text[]) INTO v_cols
  FROM public.text_case_normalized_columns
  WHERE tcnc_is_deleted IS NOT TRUE AND tcnc_object = ANY (p_objects)
    AND (p_columns IS NULL OR tcnc_column = ANY (p_columns));
  IF array_length(v_cols, 1) IS NULL THEN RETURN 0; END IF;

  -- Silence what cannot see the change: every row trigger whose function body
  -- mentions none of the columns about to be written. properties_recompute_
  -- rollups fires FOR EACH ROW unqualified and recounts a property's children
  -- for a display-name change; a trigger that cannot see the change cannot be
  -- needed by it.
  FOR t IN
    SELECT c.relname AS tbl, tg.tgname AS trg
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid AND c.relnamespace = 'public'::regnamespace
    JOIN pg_proc  p ON p.oid = tg.tgfoid
    WHERE NOT tg.tgisinternal AND tg.tgenabled = 'O' AND c.relname = ANY (p_objects)
      AND NOT EXISTS (SELECT 1 FROM unnest(v_cols) x WHERE p.prosrc ILIKE '%' || x || '%')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', t.tbl, t.trg);
    v_off := v_off || (t.tbl || '.' || t.trg);
  END LOOP;

  FOR r IN SELECT tcnc_object o, tcnc_column c, tcnc_kind k
           FROM public.text_case_normalized_columns
           WHERE tcnc_is_deleted IS NOT TRUE AND tcnc_object = ANY (p_objects)
             AND (p_columns IS NULL OR tcnc_column = ANY (p_columns))
           ORDER BY 1, 2
  LOOP
    v_live := public._text_case_live_predicate(r.o);
    -- Record the change, then make it. Both statements carry the same
    -- predicate, so the log and the rewrite can never disagree.
    v_sql := format(
      'INSERT INTO public.text_case_normalization_log
         (tcnl_object, tcnl_record_id, tcnl_column, tcnl_kind, tcnl_value_before, tcnl_value_after)
       SELECT %1$L, id, %2$L, %3$L, %2$I,
              public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
       FROM public.%1$I
       WHERE %2$I IS NOT NULL AND %4$s
         AND public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
             IS DISTINCT FROM %2$I',
      r.o, r.c, r.k, v_live);
    EXECUTE v_sql;
    v_sql := format(
      'UPDATE public.%1$I
          SET %2$I = public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
       WHERE %2$I IS NOT NULL AND %4$s
         AND public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
             IS DISTINCT FROM %2$I',
      r.o, r.c, r.k, v_live);
    EXECUTE v_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
    IF v_rows > 0 THEN RAISE NOTICE 'text case backfill: %.% -> % rows', r.o, r.c, v_rows; END IF;
  END LOOP;

  FOREACH v_sql IN ARRAY v_off LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I',
                   split_part(v_sql, '.', 1), split_part(v_sql, '.', 2));
  END LOOP;
  RETURN v_total;
END;
$fn$;
revoke all on function public.run_text_case_backfill(text[], text[]) from public;
revoke all on function public.run_text_case_backfill(text[], text[]) from anon, authenticated;

create or replace function public.verify_text_case_normalization(p_objects text[], p_columns text[] default null)
returns table (finding text, detail text) language plpgsql
set search_path to 'public','pg_catalog' as $fn$
DECLARE r record; v_left bigint; v_live text;
BEGIN
  FOR r IN SELECT tcnc_object o, tcnc_column c, tcnc_kind k
           FROM public.text_case_normalized_columns
           WHERE tcnc_is_deleted IS NOT TRUE AND tcnc_object = ANY (p_objects)
             AND (p_columns IS NULL OR tcnc_column = ANY (p_columns))
  LOOP
    v_live := public._text_case_live_predicate(r.o);
    EXECUTE format(
      'SELECT count(*) FROM public.%1$I
       WHERE %2$I IS NOT NULL AND %4$s
         AND public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
             IS DISTINCT FROM %2$I',
      r.o, r.c, r.k, v_live) INTO v_left;
    IF v_left > 0 THEN
      finding := 'still shouting'; detail := format('%s.%s: %s rows', r.o, r.c, v_left);
      RETURN NEXT;
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.relname o, tg.tgname g
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid AND c.relnamespace = 'public'::regnamespace
    WHERE NOT tg.tgisinternal AND tg.tgenabled = 'D' AND c.relname = ANY (p_objects)
  LOOP
    finding := 'trigger left disabled'; detail := format('%s.%s', r.o, r.g);
    RETURN NEXT;
  END LOOP;
END;
$fn$;
revoke all on function public.verify_text_case_normalization(text[], text[]) from public;
revoke all on function public.verify_text_case_normalization(text[], text[]) from anon, authenticated;

do $$
DECLARE
  v_objects constant text[] := array['accounts','contacts','enrollments','buildings',
                                     'opportunities','incentive_applications'];
  v_rows bigint; v_bad text; v_probe text;
BEGIN
  PERFORM set_config('statement_timeout', '600s', true);
  v_rows := public.run_text_case_backfill(v_objects);
  RAISE NOTICE 'text case: % half-shouted values rewritten', v_rows;

  SELECT string_agg(finding || ' -- ' || detail, '; ') INTO v_bad
  FROM public.verify_text_case_normalization(v_objects);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'text case backfill incomplete: %', v_bad;
  END IF;

  -- THE CONTROL: the credential in a cased name survived the widening. A
  -- word-level pass over names without the acronym list prints "Cem".
  SELECT contact_name INTO v_probe FROM public.contacts
   WHERE contact_name ILIKE '%Fox%' AND contact_is_deleted IS NOT TRUE LIMIT 1;
  IF v_probe IS NOT NULL AND v_probe ILIKE '%cem%' AND v_probe NOT LIKE '%CEM%' THEN
    RAISE EXCEPTION 'the widened pass ate a credential: %L', v_probe;
  END IF;

  SELECT enrollment_owner_address INTO v_probe FROM public.enrollments
   WHERE enrollment_record_number = 'ENR-00059';
  IF v_probe IS DISTINCT FROM 'PO Box 304, Waukesha, WI 53187, Alexandria, VA 22314' THEN
    RAISE EXCEPTION 'ENR-00059 owner address reads %L', v_probe;
  END IF;
END $$;
