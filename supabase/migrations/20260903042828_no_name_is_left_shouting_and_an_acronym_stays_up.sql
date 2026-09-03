-- ===========================================================================
-- No name is left shouting, and an acronym stays up.
--
-- Nicholas, shown that ~840 names were still half-shouted after the first pass:
-- *"We shouldn't have an all-caps name for anything... If you wanna capitalize
-- the first letter on street names, that's fine. It was an acronym. You can
-- leave it all caps."*
--
-- The first pass was deliberately conservative: a value carrying ANY lowercase
-- letter was treated as cased on purpose and returned untouched, so only
-- WHOLLY shouted values were rewritten. Addresses and cities were the one
-- exception, recasing word by word. That left the half-shouted names alone --
--
--     333 HOLLY - The Woodlands
--     200 LEVEE DRIVE ASSOCIATES, a MN L.P.
--     Riverview MANOR of MINNESOTA
--     Foo APARTMENTS - Bar
--
-- 615 property_aka_name, 153 account_name, 73 property_hud_owner_org.
--
-- The ruling settles the trade: recase word by word for EVERY kind, and keep
-- the acronyms up. So the safety rule moves from the VALUE to the WORD -- a
-- word that already carries a lowercase letter was written by a person and is
-- still never touched, which is what keeps "de la Cruz", "iHeart" and
-- "6737 W Washington Street, Suite 2275" exactly as they are.
--
-- THREE THINGS PROTECT AN ACRONYM, and they are what make this safe to widen:
--
--   1. The derived vocabulary (a token the corpus capitalises deliberately
--      beside lowercase words, or one with no vowel) -- 561 tokens already.
--   2. Inside a MIXED value, a shouted token of one or two letters stays up.
--      In a value somebody cased, a short run of capitals is an initialism
--      ("J & B", "R K", "MN"); in a wholly shouted value it is just the import
--      shouting, where "ST PAUL" must still become "St. Paul" -- which is why
--      this applies to mixed values only.
--   3. The list below: professional credentials, agencies and the organisation
--      acronyms that actually appear in live account names. These are exactly
--      the ones the derivation CANNOT see, because the corpus also writes them
--      as ordinary words somewhere ("Marc" the first name, "Arc", "Ltd") or
--      because they appear all-upper only once. `Mary P Fox, CEM` is the live
--      case that forced this: CEM appears all-upper exactly once in the whole
--      corpus, so no derivation reaches it, and without the list it prints
--      "Cem".
--
-- One correction to the minor-word rule, found by running it: it lowercased
-- "The" in "333 HOLLY - The Woodlands" because the word sits mid-name. It must
-- only touch words the pass actually RECASED, so it is now conditioned on the
-- word having been shouted. "OF" in a wholly shouted name still falls to "of".
-- ===========================================================================

insert into public.text_case_acronyms (tca_token, tca_source, tca_notes)
select t, 'manual', n from (values
  ('CEM','professional credential'),('BPI','professional credential'),
  ('LEED','professional credential'),('HERS','professional credential'),
  ('RESNET','professional credential'),('CPA','professional credential'),
  ('PMP','professional credential'),('CEA','professional credential'),
  ('CBCP','professional credential'),('CMVP','professional credential'),
  ('NATE','professional credential'),('AIA','professional credential'),
  ('HUD','agency or programme'),('USDA','agency or programme'),
  ('LIHTC','agency or programme'),('FHA','agency or programme'),
  ('CDBG','agency or programme'),('EPA','agency or programme'),
  ('OSHA','agency or programme'),('IRA','agency or programme'),
  ('HVAC','trade term'),('ADA','trade term'),
  ('DBA','written on a business name'),('AKA','written on a business name'),
  ('ASI','organisation acronym in live account names'),
  ('ARC','organisation acronym in live account names'),
  ('LULAC','organisation acronym in live account names'),
  ('YMCA','organisation acronym in live account names'),
  ('YWCA','organisation acronym in live account names'),
  ('VFW','organisation acronym in live account names')
) s(t,n)
on conflict do nothing;

-- The safety rule now lives on the WORD, and a short shouted run inside a
-- value somebody cased is an initialism.
drop function if exists public._text_case_word(text, jsonb);
create function public._text_case_word(p_word text, p_acronyms jsonb, p_value_is_mixed boolean)
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

  -- THE SAFETY RULE, per word: any lowercase letter means a person wrote it.
  IF p_word ~ '[a-z]' THEN RETURN p_word; END IF;

  m := regexp_match(p_word, '^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$');
  v_lead := coalesce(m[1],''); v_core := coalesce(m[2],''); v_tail := coalesce(m[3],'');
  IF v_core = '' THEN RETURN p_word; END IF;

  -- Consulted BEFORE the hyphen split, so a token registered whole ("L.L.C")
  -- wins over its parts.
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
  v_in text; v_words text[]; v_mixed boolean;
  v_out text[] := array[]::text[]; v_w text; v_n int; i int;
  -- Words that fall to lowercase inside a name when they are neither the first
  -- nor the last word: "Lutheran Social Services of Wisconsin and Upper Michigan".
  c_minor constant text[] := array['OF','THE','AND','FOR','AT','IN','ON','TO','A','AN','BY','OR',
                                   'DE','LA','LE','DU','DEL','DER','VAN','VON','DA','DOS','DAS'];
BEGIN
  IF p_text IS NULL THEN RETURN NULL; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('person','organization','address','city','title') THEN
    RAISE EXCEPTION 'normalize_text_case: unknown kind %', p_kind;
  END IF;

  v_in := btrim(regexp_replace(p_text, '\s+', ' ', 'g'));
  IF v_in = '' THEN RETURN v_in; END IF;

  -- A job title's dash spacing is corrected whatever its casing: a hyphen with
  -- whitespace on exactly ONE side is a dash somebody mistyped
  -- ("Vice President- Housing"); a hyphen with space on neither side is a
  -- compound word ("Non-Profit").
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
    -- Only a word this pass actually recased may fall to lowercase. Without
    -- the shouted test this turned "333 HOLLY - The Woodlands" into
    -- "333 Holly - the Woodlands".
    IF i > 1 AND i < v_n AND p_kind IN ('person','organization','title')
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
  v_got   text;
  v_fail  text[] := array[]::text[];
  v_cases constant text[][] := array[
    -- the half-shouted names this migration exists to fix
    ['333 HOLLY - The Woodlands','organization','333 Holly - The Woodlands'],
    ['200 LEVEE DRIVE ASSOCIATES, a MN L.P.','organization','200 Levee Drive Associates, a MN L.P.'],
    ['Riverview MANOR of MINNESOTA','organization','Riverview Manor of Minnesota'],
    ['Foo APARTMENTS - Bar','organization','Foo Apartments - Bar'],
    ['Fairway Management, INC','organization','Fairway Management, Inc'],
    -- THE CONTROLS: an acronym inside a cased name must survive, or widening
    -- the pass has cost more than it bought.
    ['Mary P Fox, CEM','person','Mary P Fox, CEM'],
    ['The ARC of Dane County','organization','The ARC of Dane County'],
    ['LULAC Housing, Inc.','organization','LULAC Housing, Inc.'],
    ['J & B Holdings','organization','J & B Holdings'],
    ['de la Cruz Housing','organization','de la Cruz Housing'],
    ['iHeart Realty','organization','iHeart Realty'],
    -- and everything the first pass already settled
    ['LUTHERAN SOCIAL SERVICES OF WISCONSIN AND UPPER MICHIGAN, INC.','organization',
     'Lutheran Social Services of Wisconsin and Upper Michigan, Inc.'],
    ['HOUSING AUTHORITY CITY OF MILWAUKEE','organization','Housing Authority City of Milwaukee'],
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
    ['DENNIS HANSON','person','Dennis Hanson'],
    -- a wholly shouted city still expands, which is why rule 2 is scoped to
    -- MIXED values only
    ['ST. PAUL','city','St. Paul'],
    ['WAUKESHA','city','Waukesha'],
    ['PO BOX 304, WAUKESHA, WI 53187, Alexandria, VA 22314','address',
     'PO Box 304, Waukesha, WI 53187, Alexandria, VA 22314'],
    ['6737 W Washington Street, Suite 2275','address','6737 W Washington Street, Suite 2275'],
    ['13400 Bishops Lane - ATTN: Gary Taxman','address','13400 Bishops Lane - Attn: Gary Taxman'],
    ['1124 S IH 35','address','1124 S IH 35'],
    ['123 MCDONALD ST','address','123 McDonald St'],
    ['Vice President- Housing & Residential','title','Vice President - Housing & Residential'],
    ['Non-Profit Director','title','Non-Profit Director']
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

-- Reinstall so a replay of this file on a branch database produces exactly what
-- production carries.
do $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tcnc_object o FROM public.text_case_normalized_columns
           WHERE tcnc_is_deleted IS NOT TRUE ORDER BY 1 LOOP
    PERFORM public.install_text_case_normalization(r.o);
  END LOOP;
END $$;
