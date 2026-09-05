-- ===========================================================================
-- An ADDRESS is recased word by word, and the shouting already stored in the
-- customer-facing objects is corrected.
--
-- Why the previous migration was not enough, discovered by running it: the
-- reported line
--
--     PO BOX 304, WAUKESHA, WI 53187, Alexandria, VA 22314
--
-- was left completely untouched, and correctly so.  It carries a lowercase
-- letter ("Alexandria"), and the safety rule -- a value that already carries
-- lowercase was cased by somebody on purpose -- stopped there.  That rule is
-- what makes a 25,000-value rewrite safe and it is not being weakened.  What
-- is true is that it is too blunt for ONE kind of value.
--
-- So the rule now runs WORD by word for kinds 'address' and 'city', and stays
-- whole-value for 'person', 'organization' and 'title'.  That split is not a
-- convenience; it is where the risk actually lies.  A postal address contains
-- no brand names and no credentials, so a shouted word in one is always a
-- transcription artefact:
--
--     13400 Bishops Lane - ATTN: Gary Taxman  ->  ... - Attn: Gary Taxman
--     200 E 8th St, SUITE 208                 ->  200 E 8th St, Suite 208
--
-- A NAME does contain them, and the live data proves it: contacts holds
-- "Mary P Fox, CEM" -- a Certified Energy Manager -- where a word-level pass
-- would print "Cem".  CEM appears all-upper exactly once in the whole corpus,
-- so no derivation can see it.  Names therefore keep the whole-value rule.
--
-- MEASURED CONSEQUENCE, recorded rather than hidden: ~840 NAMES stay partly
-- shouted -- 615 property_aka_name ("333 HOLLY - The Woodlands"), 153
-- account_name ("200 LEVEE DRIVE ASSOCIATES, a MN L.P."), 73
-- property_hud_owner_org.  Every one of them has some lowercase in it, so the
-- rule reads them as deliberate.  Widening the word-level pass to names is one
-- line in _normalize_text_case if that trade is ever worth making.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A word that already carries lowercase was written by a person: leave it.
-- On a wholly shouted value no word has lowercase, so this changes nothing
-- there -- it exists so the word-level pass below can be selective.
-- ---------------------------------------------------------------------------
create or replace function public._text_case_word(p_word text, p_acronyms jsonb)
returns text language plpgsql immutable
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  v_lead text;   -- punctuation before the letters, e.g. the "(" of "(FORMERLY"
  v_tail text;   -- punctuation after,              e.g. the "," of "INC,"
  v_core text;
  v_out  text[];
  v_sep  text;
  m      text[];
BEGIN
  IF p_word IS NULL OR p_word = '' THEN RETURN p_word; END IF;
  IF p_word ~ '[a-z]' THEN RETURN p_word; END IF;

  -- peel leading/trailing punctuation, so "INC.," and "INC" are judged alike
  m := regexp_match(p_word, '^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$');
  v_lead := coalesce(m[1],''); v_core := coalesce(m[2],''); v_tail := coalesce(m[3],'');
  IF v_core = '' THEN RETURN p_word; END IF;

  -- The vocabulary is consulted BEFORE the hyphen split, so a token registered
  -- whole ("L.L.C") wins over its parts.
  IF p_acronyms ? upper(v_core) THEN RETURN v_lead || upper(v_core) || v_tail; END IF;

  IF v_core ~ '[-/]' THEN
    v_sep := substring(v_core from '[-/]');
    SELECT array_agg(public._text_case_word(p, p_acronyms) ORDER BY o) INTO v_out
      FROM regexp_split_to_table(v_core, '[-/]') WITH ORDINALITY AS s(p, o);
    RETURN v_lead || array_to_string(v_out, v_sep) || v_tail;
  END IF;

  RETURN v_lead || (CASE
    WHEN v_core ~ '^[0-9]+(ST|ND|RD|TH)$' THEN lower(v_core)          -- 17TH -> 17th
    WHEN v_core ~ '[0-9]'                 THEN v_core                 -- a number, unit or code
    WHEN length(v_core) = 1               THEN v_core                 -- an initial or directional
    WHEN v_core ~ '^(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$' THEN v_core
    WHEN v_core ~ '^MC[A-Z]{2,}$'         THEN 'Mc' || initcap(lower(substring(v_core from 3)))
    -- initcap() does NOT treat an apostrophe as a word break, so without these
    -- two lines O'BRIEN comes back "O'brien" and MORGAN'S comes back "Morgan'S".
    WHEN v_core ~ '^[ODL]''[A-Z]{2,}$'    THEN substring(v_core from 1 for 2) || initcap(lower(substring(v_core from 3)))
    ELSE regexp_replace(initcap(lower(v_core)), '''S$', '''s')
  END) || v_tail;
END;
$fn$;

create or replace function public._normalize_text_case(p_text text, p_kind text, p_acronyms jsonb)
returns text language plpgsql immutable
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  v_in text; v_words text[];
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

  -- A job title's dash spacing is corrected WHATEVER its casing, because the
  -- reported line -- "Dennis Hanson - Vice President- Housing & Residential" --
  -- prints two hyphen conventions side by side and neither is a casing problem.
  -- A hyphen with whitespace on exactly ONE side is a dash somebody mistyped;
  -- a hyphen with space on neither side is a compound word ("Non-Profit").
  IF p_kind = 'title' THEN
    v_in := regexp_replace(v_in, '(\S)-\s+', '\1 - ', 'g');
    v_in := regexp_replace(v_in, '\s+-(\S)', ' - \1', 'g');
    v_in := btrim(regexp_replace(v_in, '\s+', ' ', 'g'));
  END IF;

  -- THE SAFETY RULE.  A name carrying any lowercase was cased on purpose and is
  -- returned untouched.  An ADDRESS or a CITY falls through to the word loop
  -- instead, where _text_case_word leaves every word that has lowercase in it
  -- alone -- see this migration's header for why the two kinds differ.
  IF v_in ~ '[a-z]' AND p_kind NOT IN ('address','city') THEN RETURN v_in; END IF;

  v_words := string_to_array(v_in, ' ');
  v_n := array_length(v_words, 1);
  FOR i IN 1..v_n LOOP
    v_w := public._text_case_word(v_words[i], p_acronyms);
    IF i > 1 AND i < v_n AND p_kind IN ('person','organization','title')
       AND upper(v_words[i]) = ANY (c_minor) THEN
      v_w := lower(v_w);
    END IF;
    v_out := array_append(v_out, v_w);
  END LOOP;
  v_in := array_to_string(v_out, ' ');

  -- A post office box keeps its initialism whichever way it is punctuated.
  IF p_kind = 'address' THEN
    v_in := regexp_replace(v_in, '\mPo(\.?)\s+Box\M', 'PO\1 Box', 'g');
    v_in := regexp_replace(v_in, '\mP\.o\.\s*Box\M',  'P.O. Box', 'g');
  END IF;

  RETURN v_in;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- The two-letter state and territory codes, seeded by hand.
--
-- Found by running the word-level pass on the reported line: it produced
-- "Alexandria, Va 22314".  VA is not in the derived vocabulary and cannot be --
-- it has a vowel, and it never appears all-upper inside a mixed-case value
-- twice in this corpus.  But a state code in an address is a rule that IS
-- knowable, exhaustively and in advance, so it is written down.  The handful
-- that are also English words (IN, OR, ME, OK, LA, DE) are safe: the minor-word
-- rule lowercases them mid-name, and this list only ever applies to a word that
-- was already shouted.
-- ---------------------------------------------------------------------------
insert into public.text_case_acronyms (tca_token, tca_source, tca_notes)
select t, 'manual', 'USPS state or territory code' from unnest(array[
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY','PR','VI','GU','AS','MP'
]) t
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Prove the split, then correct what is stored.
-- ---------------------------------------------------------------------------
do $$
DECLARE
  v_got   text;
  v_fail  text[] := array[]::text[];
  v_cases constant text[][] := array[
    -- the reported line, now end to end
    ['PO BOX 304, WAUKESHA, WI 53187, Alexandria, VA 22314','address',
     'PO Box 304, Waukesha, WI 53187, Alexandria, VA 22314'],
    ['Vice President- Housing & Residential','title','Vice President - Housing & Residential'],
    ['WAUKESHA','city','Waukesha'],
    -- word-level, address only
    ['13400 Bishops Lane - ATTN: Gary Taxman','address','13400 Bishops Lane - Attn: Gary Taxman'],
    ['200 E 8th St, SUITE 208','address','200 E 8th St, Suite 208'],
    ['6737 W Washington Street, Suite 2275','address','6737 W Washington Street, Suite 2275'],
    ['1124 S IH 35','address','1124 S IH 35'],
    ['PO BOX 304','address','PO Box 304'],
    ['P.O. BOX 1447','address','P.O. Box 1447'],
    ['123 MCDONALD ST','address','123 McDonald St'],
    ['ST. PAUL','city','St. Paul'],
    -- whole-value, everything else.  These two are the CONTROLS: a partly
    -- shouted NAME must come back exactly as it went in, or the word-level pass
    -- has leaked into the kinds where credentials and brand names live.
    ['Mary P Fox, CEM','person','Mary P Fox, CEM'],
    ['333 HOLLY - The Woodlands','organization','333 HOLLY - The Woodlands'],
    ['LUTHERAN SOCIAL SERVICES OF WISCONSIN AND UPPER MICHIGAN, INC.','organization',
     'Lutheran Social Services of Wisconsin and Upper Michigan, Inc.'],
    ['GORMAN & COMPANY LLC','organization','Gorman & Company LLC'],
    ['MICHAELS MANAGEMENT AFFORDABLE L.L.C.','organization','Michaels Management Affordable L.L.C.'],
    ['MORGAN''S MILL SUBDIVISION','organization','Morgan''s Mill Subdivision'],
    ['O''BRIEN MANAGEMENT LP','organization','O''Brien Management LP'],
    ['ACC MANAGEMENT GROUP INC','organization','ACC Management Group Inc'],
    ['LSS HOUSING, HAMPTON, INC.','organization','LSS Housing, Hampton, Inc.'],
    ['WHPC-NIBP PORTFOLIO LLC','organization','WHPC-NIBP Portfolio LLC'],
    ['MRCDC','organization','MRCDC'],
    ['HALLOIN, R K, INC','organization','Halloin, R K, Inc'],
    ['WOODFIELD SUBDIVISION 17TH','organization','Woodfield Subdivision 17th'],
    ['Non-Profit Director','title','Non-Profit Director'],
    ['DENNIS HANSON','person','Dennis Hanson']
  ];
BEGIN
  FOR i IN 1..array_length(v_cases,1) LOOP
    v_got := public.normalize_text_case(v_cases[i][1], v_cases[i][2]);
    IF v_got IS DISTINCT FROM v_cases[i][3] THEN
      v_fail := array_append(v_fail, format('%L (%s) -> %L, expected %L',
        v_cases[i][1], v_cases[i][2], v_got, v_cases[i][3]));
    END IF;
  END LOOP;
  IF array_length(v_fail,1) > 0 THEN
    RAISE EXCEPTION 'normalize_text_case failed % of % cases: %',
      array_length(v_fail,1), array_length(v_cases,1), array_to_string(v_fail, E'\n  ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The backfill's prefilter has to follow the split too.
--
-- It skipped any value containing a lowercase letter, which was a correct
-- superset while the rule was whole-value.  It is not one any more: a
-- word-level kind changes MIXED values, which is the whole point.  Running the
-- migration without this found it immediately -- "still shouting --
-- accounts.billing_street: 33 rows; enrollments.enrollment_owner_address: 4
-- rows; buildings.building_address: 1 row" -- because
-- verify_text_case_normalization() re-checks every row with no prefilter at
-- all.  A prefilter that silently skips rows would otherwise have looked like
-- a clean run.
-- ---------------------------------------------------------------------------
create or replace function public.run_text_case_backfill(p_objects text[])
returns bigint language plpgsql
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  r record; t record; v_sql text; v_pre text; v_rows bigint; v_total bigint := 0;
BEGIN
  FOR t IN
    SELECT c.relname AS tbl, tg.tgname AS trg
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid AND c.relnamespace = 'public'::regnamespace
    JOIN pg_proc  p ON p.oid = tg.tgfoid
    WHERE NOT tg.tgisinternal AND c.relname = ANY (p_objects)
      AND (p.proname = 'log_audit_and_field_history' OR p.proname ~ '^stamp_.*_audit_fields$')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', t.tbl, t.trg);
  END LOOP;

  FOR r IN SELECT tcnc_object o, tcnc_column c, tcnc_kind k
           FROM public.text_case_normalized_columns
           WHERE tcnc_is_deleted IS NOT TRUE AND tcnc_object = ANY (p_objects)
           ORDER BY 1, 2
  LOOP
    -- For the whole-value kinds a shouted value is the only thing that can
    -- change (plus stray whitespace), so a regex test per value saves a plpgsql
    -- call per value on a 16,665-row table.  The word-level kinds get no
    -- prefilter, because a mixed value is exactly what they exist to fix.
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

  FOR t IN
    SELECT c.relname AS tbl, tg.tgname AS trg
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid AND c.relnamespace = 'public'::regnamespace
    JOIN pg_proc  p ON p.oid = tg.tgfoid
    WHERE NOT tg.tgisinternal AND c.relname = ANY (p_objects)
      AND (p.proname = 'log_audit_and_field_history' OR p.proname ~ '^stamp_.*_audit_fields$')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', t.tbl, t.trg);
  END LOOP;
  RETURN v_total;
END;
$fn$;
revoke all on function public.run_text_case_backfill(text[]) from public;
revoke all on function public.run_text_case_backfill(text[]) from anon, authenticated;

-- The triggers carry the kind per column, not the function body, so nothing
-- needs reinstalling -- but reinstall anyway, so a replay of this file on a
-- branch database produces exactly what production carries.
do $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tcnc_object o FROM public.text_case_normalized_columns
           WHERE tcnc_is_deleted IS NOT TRUE ORDER BY 1 LOOP
    PERFORM public.install_text_case_normalization(r.o);
  END LOOP;
END $$;

do $$
DECLARE
  v_objects constant text[] := array['accounts','contacts','enrollments','buildings',
                                     'opportunities','incentive_applications'];
  v_rows  bigint;
  v_bad   text;
  v_probe text;
BEGIN
  PERFORM set_config('statement_timeout', '600s', true);

  v_rows := public.run_text_case_backfill(v_objects);
  RAISE NOTICE 'text case: % values rewritten across %', v_rows, v_objects;

  -- Nothing may still be shouting, and no audit trigger may be left off.
  -- verify_ re-checks every row with NO prefilter, so it also proves the
  -- backfill's prefilter was a genuine superset of what the rule can change.
  SELECT string_agg(finding || ' -- ' || detail, '; ') INTO v_bad
  FROM public.verify_text_case_normalization(v_objects);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'text case backfill incomplete: %', v_bad;
  END IF;

  -- Reversible: the log must hold what was rewritten.
  IF NOT EXISTS (SELECT 1 FROM public.text_case_normalization_log
                 WHERE tcnl_object = ANY (v_objects)) THEN
    RAISE EXCEPTION 'the backfill rewrote % values but logged none -- it is not reversible', v_rows;
  END IF;

  -- The two lines actually reported, on the Sealed Project Reservation for
  -- 570 South Clark Street.
  SELECT enrollment_owner_address INTO v_probe FROM public.enrollments
   WHERE enrollment_record_number = 'ENR-00059';
  IF v_probe IS DISTINCT FROM 'PO Box 304, Waukesha, WI 53187, Alexandria, VA 22314' THEN
    RAISE EXCEPTION 'ENR-00059 owner address reads %L', v_probe;
  END IF;

  SELECT contact_title INTO v_probe FROM public.contacts
   WHERE contact_email = 'dennis.hanson@lsswis.org' AND contact_is_deleted IS NOT TRUE LIMIT 1;
  IF v_probe IS DISTINCT FROM 'Vice President - Housing & Residential' THEN
    RAISE EXCEPTION 'the reported contact title reads %L', v_probe;
  END IF;

  -- The customer name the payment-request invoice prints.  IA-00037 carried
  -- "LSS HOUSING, HAMPTON, INC.", which is a useful case in its own right:
  -- LSS must survive as an acronym while HOUSING and HAMPTON must not.
  SELECT ia_property_owner_name INTO v_probe FROM public.incentive_applications
   WHERE ia_record_number = 'IA-00037' AND ia_is_deleted IS NOT TRUE;
  IF v_probe IS DISTINCT FROM 'LSS Housing, Hampton, Inc.' THEN
    RAISE EXCEPTION 'IA-00037 property owner name reads %L', v_probe;
  END IF;
END $$;
