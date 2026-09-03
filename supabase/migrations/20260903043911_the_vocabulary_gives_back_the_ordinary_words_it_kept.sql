-- ===========================================================================
-- The vocabulary gives back the ordinary words it had kept.
--
-- Auditing what the widened pass LEFT in capitals -- the other half of checking
-- it, and the half that is easy to skip -- found two things.
--
-- 1. The derivation had kept 30 ordinary words, place names and surnames:
--    TEAM, RIGHT, SNAP, CARS, ACRE, NONE, RANT, APARTMENTS, APTS, COURT,
--    HEIGHTS, HOMES, plus WINONA, FERGUS, HUTTO, KIRON, TRACY, ERVIN, ORNESS,
--    MCIVER and friends. Each qualified because it appears all-upper beside
--    lowercase words somewhere and is never written in mixed case anywhere in
--    this corpus -- a fair signal for an acronym and a bad one for a surname
--    that only ever arrived shouted. "Pineywoods Community Orange Home TEAM"
--    is the giveaway. Retired, not deleted, so the reason stays visible.
--
-- 2. Roman numerals past XII (VIII, XVII, XXII, XXIII, CLIV, LXXXVI, CXLVII)
--    were being preserved BY ACCIDENT -- they had landed in the derived
--    vocabulary rather than being recognised. "Ada Deer Manor III" should not
--    depend on a data-derived lookup, so the numeral rule now matches the whole
--    numeral grammar instead of a hand-listed II..XII, and the entries that
--    were standing in for it are retired.
-- ===========================================================================
update public.text_case_acronyms
   set tca_is_deleted = true, tca_deleted_at = now(),
       tca_notes = coalesce(tca_notes,'') || ' -- retired: an ordinary word, place or surname, not an acronym'
 where tca_is_deleted is not true
   and tca_token in ('APARTMENTS','APTS','COURT','HEIGHTS','HOMES','ACRE','CARS','NONE','RANT',
                     'RIGHT','SNAP','TEAM','WINONA','TRACY','FERGUS','HUTTO','KIRON','ERVIN',
                     'ORNESS','MCIVER','POSADA','CIELO','ANACUA','PARAS','SAKO','SOAT','SOBO',
                     'HOLIE','HOMZ','HIRISE');

update public.text_case_acronyms
   set tca_is_deleted = true, tca_deleted_at = now(),
       tca_notes = coalesce(tca_notes,'') || ' -- retired: a roman numeral, now matched by rule'
 where tca_is_deleted is not true
   and tca_token ~ '^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$'
   and length(tca_token) >= 2;

create or replace function public._text_case_word(p_word text, p_acronyms jsonb, p_value_is_mixed boolean)
returns text language plpgsql immutable
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  v_lead text; v_tail text; v_core text; v_out text[]; v_sep text; m text[];
BEGIN
  IF p_word IS NULL OR p_word = '' THEN RETURN p_word; END IF;
  -- THE SAFETY RULE, per word: any lowercase letter means a person wrote it.
  IF p_word ~ '[a-z]' THEN RETURN p_word; END IF;
  m := regexp_match(p_word, '^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$');
  v_lead := coalesce(m[1],''); v_core := coalesce(m[2],''); v_tail := coalesce(m[3],'');
  IF v_core = '' THEN RETURN p_word; END IF;
  IF p_acronyms ? upper(v_core) THEN RETURN v_lead || upper(v_core) || v_tail; END IF;
  IF v_core ~ '[-/]' THEN
    v_sep := substring(v_core from '[-/]');
    SELECT array_agg(public._text_case_word(p, p_acronyms, p_value_is_mixed) ORDER BY o) INTO v_out
      FROM regexp_split_to_table(v_core, '[-/]') WITH ORDINALITY AS s(p, o);
    RETURN v_lead || array_to_string(v_out, v_sep) || v_tail;
  END IF;
  RETURN v_lead || (CASE
    WHEN v_core ~ '^[0-9]+(ST|ND|RD|TH)$' THEN lower(v_core)   -- 17TH -> 17th
    WHEN v_core ~ '[0-9]'                 THEN v_core          -- a number, unit or code
    WHEN length(v_core) = 1               THEN v_core          -- an initial or directional
    -- In a value somebody cased, a one- or two-letter run of capitals is an
    -- initialism: "J & B Holdings", "HALLOIN, R K", "a MN L.P.". In a wholly
    -- shouted value it is not, which is why "ST PAUL" still becomes St. Paul.
    WHEN p_value_is_mixed AND length(v_core) <= 2 THEN v_core
    -- A roman numeral, by its grammar rather than by a list: Manor III,
    -- Phase VIII, Building XXIII.
    WHEN length(v_core) >= 2
         AND v_core ~ '^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$' THEN v_core
    WHEN v_core ~ '^MC[A-Z]{2,}$'         THEN 'Mc' || initcap(lower(substring(v_core from 3)))
    -- initcap() does NOT treat an apostrophe as a word break, so without these
    -- two lines O'BRIEN comes back "O'brien" and MORGAN'S comes back "Morgan'S".
    WHEN v_core ~ '^[ODL]''[A-Z]{2,}$'    THEN substring(v_core from 1 for 2) || initcap(lower(substring(v_core from 3)))
    ELSE regexp_replace(initcap(lower(v_core)), '''S$', '''s')
  END) || v_tail;
END;
$fn$;

do $$
DECLARE
  v_got text; v_fail text[] := array[]::text[];
  v_cases constant text[][] := array[
    -- the ordinary words come back
    ['Pineywoods Community Orange Home TEAM','organization','Pineywoods Community Orange Home Team'],
    ['River Cove APARTMENTS','organization','River Cove Apartments'],
    -- the numerals stay, now by rule rather than by accident
    ['Ada Deer Manor III','organization','Ada Deer Manor III'],
    ['AHEPA 29 Phase VIII, Inc','organization','AHEPA 29 Phase VIII, Inc'],
    ['Cedar XXIII Apartments','organization','Cedar XXIII Apartments'],
    -- and the real acronyms are untouched
    ['ACC Management Group Inc','organization','ACC Management Group Inc'],
    ['Al-Car VOA Elderly Housing, Inc.','organization','Al-Car VOA Elderly Housing, Inc.'],
    ['Mary P Fox, CEM','person','Mary P Fox, CEM'],
    ['1408 Whitson LLC','organization','1408 Whitson LLC'],
    ['918 East 22nd Street Investors, A Minnesota Limited Partnership','organization',
     '918 East 22nd Street Investors, A Minnesota Limited Partnership'],
    ['LUTHERAN SOCIAL SERVICES OF WISCONSIN AND UPPER MICHIGAN, INC.','organization',
     'Lutheran Social Services of Wisconsin and Upper Michigan, Inc.'],
    ['ST. PAUL','city','St. Paul'],
    ['PO BOX 304, WAUKESHA, WI 53187, Alexandria, VA 22314','address',
     'PO Box 304, Waukesha, WI 53187, Alexandria, VA 22314']
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
END $$;
