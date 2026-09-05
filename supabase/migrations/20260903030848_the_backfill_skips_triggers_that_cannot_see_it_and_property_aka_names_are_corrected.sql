-- ===========================================================================
-- The backfill skips the triggers that cannot see it, takes a column filter,
-- and the property AKA names are corrected.
--
-- Two mechanical changes forced by the size of `properties`, then the first
-- slice of its data.
--
-- 1. A COLUMN FILTER.  properties is 16,665 live rows across eleven registered
--    columns and ~30,500 values that need rewriting.  Measured on production:
--    2,000 property rows rewrite in 4.1 seconds -- ~490 rows/second, which is
--    what a 100 MB heap with 6 KB rows and 31 indexes costs -- so the whole
--    object is roughly two minutes of writing and cannot go in one call.  The
--    filter also earns its keep afterwards: registering a new column later
--    should backfill THAT column, not rescan the other ten.
--
-- 2. THE TRIGGER RULE IS DERIVED, NOT LISTED.  The backfill used to silence
--    exactly two named triggers (the audit logger and the audit stamper).  But
--    `properties_recompute_rollups` fires FOR EACH ROW on every UPDATE,
--    unqualified, and recounts a property's buildings, units, opportunities and
--    projects -- 14,285 times, for a change to a display name that cannot move
--    any of those numbers.  Five `cascade_derived_name` triggers are in the
--    same position.
--
--    So instead of a longer list: DISABLE EVERY ROW TRIGGER ON THE OBJECT WHOSE
--    FUNCTION BODY MENTIONS NONE OF THE COLUMNS ABOUT TO BE WRITTEN.  A trigger
--    that cannot see the change cannot be needed by it, and the rule is read
--    off pg_proc.prosrc rather than kept by hand -- the same way
--    trigger_written_columns() already answers "which columns does a trigger
--    fill".  A trigger that DOES reference one of the columns stays on, so a
--    future registry entry on a column something derives from keeps its
--    deriver.
-- ===========================================================================

drop function if exists public.run_text_case_backfill(text[]);
drop function if exists public.verify_text_case_normalization(text[]);

create or replace function public.run_text_case_backfill(p_objects text[], p_columns text[] default null)
returns bigint language plpgsql
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  r record; t record; v_sql text; v_pre text; v_rows bigint; v_total bigint := 0;
  v_cols text[];
  v_off  text[] := array[]::text[];   -- 'table.trigger' pairs this call switched off
BEGIN
  SELECT coalesce(array_agg(DISTINCT tcnc_column), array[]::text[]) INTO v_cols
  FROM public.text_case_normalized_columns
  WHERE tcnc_is_deleted IS NOT TRUE AND tcnc_object = ANY (p_objects)
    AND (p_columns IS NULL OR tcnc_column = ANY (p_columns));
  IF array_length(v_cols, 1) IS NULL THEN RETURN 0; END IF;

  -- Silence what cannot see the change.  Recorded as it goes, so exactly what
  -- was switched off is switched back on.
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
    -- For the whole-value kinds a shouted value is the only thing that can
    -- change (plus stray whitespace), so a regex test per value saves a plpgsql
    -- call per value.  The word-level kinds get no prefilter, because a MIXED
    -- value is exactly what they exist to fix -- prefiltering them silently
    -- skipped 38 rows, which verify_text_case_normalization() caught on the
    -- first run of the previous migration.
    v_pre := CASE WHEN r.k IN ('title','address','city') THEN 'TRUE'
                  ELSE format('(%1$I !~ ''[a-z]'' OR %1$I ~ ''\s\s'' OR %1$I <> btrim(%1$I))', r.c)
             END;
    v_sql := format(
      'INSERT INTO public.text_case_normalization_log
         (tcnl_object, tcnl_record_id, tcnl_column, tcnl_kind, tcnl_value_before, tcnl_value_after)
       SELECT %1$L, id, %2$L, %3$L, %2$I,
              public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
       FROM public.%1$I
       WHERE %2$I IS NOT NULL AND %4$s
         AND public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
             IS DISTINCT FROM %2$I',
      r.o, r.c, r.k, v_pre);
    EXECUTE v_sql;
    v_sql := format(
      'UPDATE public.%1$I
          SET %2$I = public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
       WHERE %2$I IS NOT NULL AND %4$s
         AND public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
             IS DISTINCT FROM %2$I',
      r.o, r.c, r.k, v_pre);
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
DECLARE r record; v_left bigint;
BEGIN
  FOR r IN SELECT tcnc_object o, tcnc_column c, tcnc_kind k
           FROM public.text_case_normalized_columns
           WHERE tcnc_is_deleted IS NOT TRUE AND tcnc_object = ANY (p_objects)
             AND (p_columns IS NULL OR tcnc_column = ANY (p_columns))
  LOOP
    -- No prefilter, every row: this is what proves the backfill's prefilter was
    -- a genuine superset of what the rule can change.
    EXECUTE format(
      'SELECT count(*) FROM public.%1$I
       WHERE %2$I IS NOT NULL
         AND public._normalize_text_case(%2$I, %3$L, public.text_case_acronym_tokens())
             IS DISTINCT FROM %2$I',
      r.o, r.c, r.k) INTO v_left;
    IF v_left > 0 THEN
      finding := 'still shouting'; detail := format('%s.%s: %s rows', r.o, r.c, v_left);
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Nothing the backfill switched off may be left off.  A migration that
  -- leaves auditing or a rollup disabled on properties is far worse than the
  -- shouting it came to fix.
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

comment on function public.run_text_case_backfill(text[], text[]) is
  'Apply the casing rule to what is already stored, for the named objects and optionally only the named columns. Idempotent; logs every change to text_case_normalization_log; while it runs it disables only the triggers whose function body mentions none of the columns it writes.';

-- ---------------------------------------------------------------------------
-- property_aka_name: 14,285 of 16,652 populated values were shouting.  It is
-- the column the Outreach Properties list shows beside the address, and it is
-- copied onto every opportunity as opportunity_property_aka.
-- ---------------------------------------------------------------------------
do $$
DECLARE
  v_cols constant text[] := array['property_aka_name','property_subdivision_name'];
  v_rows bigint;
  v_bad  text;
BEGIN
  PERFORM set_config('statement_timeout', '600s', true);

  v_rows := public.run_text_case_backfill(array['properties'], v_cols);
  RAISE NOTICE 'text case: % property AKA names rewritten', v_rows;

  SELECT string_agg(finding || ' -- ' || detail, '; ') INTO v_bad
  FROM public.verify_text_case_normalization(array['properties'], v_cols);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'property AKA name backfill incomplete: %', v_bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.text_case_normalization_log
                 WHERE tcnl_object = 'properties' AND tcnl_column = 'property_aka_name') THEN
    RAISE EXCEPTION 'the property AKA backfill rewrote % values but logged none', v_rows;
  END IF;

  -- normalize_property_address() still owns the street and the city, and this
  -- backfill did not reach past its own registry into them.
  IF EXISTS (SELECT 1 FROM public.text_case_normalization_log
             WHERE tcnl_object = 'properties'
               AND tcnl_column IN ('property_street','property_city')) THEN
    RAISE EXCEPTION 'the casing backfill wrote to a column normalize_property_address() owns';
  END IF;
END $$;
