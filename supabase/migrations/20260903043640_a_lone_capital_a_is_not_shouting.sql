-- ===========================================================================
-- A lone capital A is not a shouted word, and FKA is an acronym.
--
-- Two corrections read off what the widened pass actually WROTE, not off the
-- code:
--
-- 1. The minor-word rule fires on a word the pass considers shouted, and it
--    counted "A" as one -- so
--        918 East 22nd Street Investors, A Minnesota Limited Partnership
--    came back with a lowercase "a". That A is the first word of the entity's
--    legal name, deliberately capitalised, and the pass had no business
--    touching it. The rule now requires two letters, which is what "shouted"
--    actually means. 10 account names were affected.
--
-- 2. FKA and NKA are acronyms, and
--        CCI, Inc. (FKA California Commercial Investment Group, Inc.)
--    came back "(Fka ...". They sit beside DBA and AKA, already seeded.
--
-- The restore at the bottom is the FIRST use of text_case_normalization_log
-- for the purpose it was built for: every value these two defects rewrote is
-- put back from the log, rather than from a guess about what it used to be.
-- ===========================================================================
insert into public.text_case_acronyms (tca_token, tca_source, tca_notes)
select t, 'manual', 'written on a business name' from unnest(array['FKA','NKA']) t
on conflict do nothing;

create or replace function public._normalize_text_case(p_text text, p_kind text, p_acronyms jsonb)
returns text language plpgsql immutable
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  v_in text; v_words text[]; v_mixed boolean;
  v_out text[] := array[]::text[]; v_w text; v_n int; i int;
  c_minor constant text[] := array['OF','THE','AND','FOR','AT','IN','ON','TO','A','AN','BY','OR',
                                   'DE','LA','LE','DU','DEL','DER','VAN','VON','DA','DOS','DAS'];
BEGIN
  IF p_text IS NULL THEN RETURN NULL; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('person','organization','address','city','title') THEN
    RAISE EXCEPTION 'normalize_text_case: unknown kind %', p_kind;
  END IF;
  v_in := btrim(regexp_replace(p_text, '\s+', ' ', 'g'));
  IF v_in = '' THEN RETURN v_in; END IF;
  IF p_kind = 'title' THEN
    v_in := regexp_replace(v_in, '(\S)-\s+', '\1 - ', 'g');
    v_in := regexp_replace(v_in, '\s+-(\S)', ' - \1', 'g');
    v_in := btrim(regexp_replace(v_in, '\s+', ' ', 'g'));
  END IF;
  v_mixed := v_in ~ '[a-z]';
  v_words := string_to_array(v_in, ' ');
  v_n := array_length(v_words, 1);
  FOR i IN 1..v_n LOOP
    v_w := public._text_case_word(v_words[i], p_acronyms, v_mixed);
    -- Only a word this pass actually recased may fall to lowercase, and a
    -- single letter was never shouting in the first place.
    IF i > 1 AND i < v_n AND p_kind IN ('person','organization','title')
       AND length(v_words[i]) >= 2
       AND v_words[i] !~ '[a-z]'
       AND upper(v_words[i]) = ANY (c_minor) THEN
      v_w := lower(v_w);
    END IF;
    v_out := array_append(v_out, v_w);
  END LOOP;
  v_in := array_to_string(v_out, ' ');
  IF p_kind = 'address' THEN
    v_in := regexp_replace(v_in, '\mPo(\.?)\s+Box\M', 'PO\1 Box', 'g');
    v_in := regexp_replace(v_in, '\mP\.o\.\s*Box\M',  'P.O. Box', 'g');
  END IF;
  RETURN v_in;
END;
$fn$;

do $$
DECLARE
  v_got text; v_fail text[] := array[]::text[]; v_restored int := 0; r record;
  v_cases constant text[][] := array[
    ['918 East 22nd Street Investors, A Minnesota Limited Partnership','organization',
     '918 East 22nd Street Investors, A Minnesota Limited Partnership'],
    ['CCI, Inc. (FKA California Commercial Investment Group, Inc.)','organization',
     'CCI, Inc. (FKA California Commercial Investment Group, Inc.)'],
    -- unchanged: a shouted minor word in a wholly shouted name still falls
    ['LUTHERAN SOCIAL SERVICES OF WISCONSIN AND UPPER MICHIGAN, INC.','organization',
     'Lutheran Social Services of Wisconsin and Upper Michigan, Inc.'],
    ['333 HOLLY - The Woodlands','organization','333 Holly - The Woodlands'],
    ['Mary P Fox, CEM','person','Mary P Fox, CEM']
  ];
BEGIN
  FOR i IN 1..array_length(v_cases,1) LOOP
    v_got := public.normalize_text_case(v_cases[i][1], v_cases[i][2]);
    IF v_got IS DISTINCT FROM v_cases[i][3] THEN
      v_fail := array_append(v_fail, format('%L -> %L, expected %L',
        v_cases[i][1], v_got, v_cases[i][3]));
    END IF;
  END LOOP;
  IF array_length(v_fail,1) > 0 THEN
    RAISE EXCEPTION 'normalize_text_case failed: %', array_to_string(v_fail, E'\n  ');
  END IF;

  -- Put back every value the two corrected defects rewrote: a logged row whose
  -- BEFORE value the corrected rule now leaves alone was rewritten in error.
  FOR r IN
    SELECT l.tcnl_object o, l.tcnl_column c, l.tcnl_record_id id, l.tcnl_value_before b
    FROM public.text_case_normalization_log l
    WHERE l.created_at > now() - interval '2 hours'
      AND public.normalize_text_case(l.tcnl_value_before, l.tcnl_kind) = l.tcnl_value_before
      AND l.tcnl_value_after IS DISTINCT FROM l.tcnl_value_before
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2 AND %I IS DISTINCT FROM $1',
                   r.o, r.c, r.c) USING r.b, r.id;
    v_restored := v_restored + 1;
  END LOOP;
  RAISE NOTICE 'restored % values the two corrected defects had rewritten', v_restored;
END $$;
