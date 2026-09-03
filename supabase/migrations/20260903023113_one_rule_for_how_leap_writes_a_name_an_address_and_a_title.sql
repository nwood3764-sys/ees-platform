-- ===========================================================================
-- ONE rule for how LEAP writes a name, an address, a city and a job title.
--
-- Reported from the Wisconsin IRA Multifamily HOMES Project Reservation
-- (Sealed): the Customer Information block read
--
--     Dennis Hanson - Vice President- Housing & Residential
--     PO BOX 304
--     WAUKESHA, WI 53187, Alexandria, VA 22314
--
-- Nicholas: "I don't know why Waukesha is all capitalized. We already put a
-- bunch of stuff in to normalize our data. We shouldn't have all caps anywhere
-- like that."
--
-- He is right that the rule exists and wrong that it is applied:
-- normalize_street_address() has done this job carefully since the property
-- importers landed -- Mc names, ordinals, highway designators, deliberate
-- mixed case -- and it is wired to EXACTLY ONE COLUMN, properties.property_street,
-- through normalize_property_address().  That is why property_street shouts on
-- 3 rows out of 16,665 while everything beside it shouts freely:
--
--     account_name                2,151    property_hud_owner_org      1,108
--     property_aka_name          14,285    property_lihtc_project_name 9,052
--     billing_city                  185    billing_street                150
--
-- A second casing rule per column is how you end up with five that disagree
-- (the lesson pinnedTableHeader.js, dateDisplay.js and listFilterDates.js each
-- already record), so the rule lives here once and the columns it governs are
-- DECLARED in a registry -- see the migration that follows this one.
--
-- THE SAFETY RULE, and the reason this can be run across live data:
-- A VALUE THAT ALREADY CARRIES A LOWERCASE LETTER IS LEFT ALONE.  Somebody --
-- a person, or a careful import -- chose that casing, and "de la Cruz",
-- "iHeartMedia" and "6737 W Washington Street, Suite 2275" are all correct as
-- written.  Only a WHOLLY shouted value is recased, because a wholly shouted
-- value is the signature of a shouting data source and never of a decision.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The acronym vocabulary.
--
-- You cannot tell an acronym from a shouted word by looking at it.  In LEAP's
-- own data ACC, CAP, DAK, JES, CDA and MRCDC sit in the same column as HORSE,
-- WOODED and KAPLAN, and every one of them is five capital letters.  So the
-- vocabulary is DERIVED from the corpus rather than guessed, on two signals
-- that only an acronym satisfies:
--
--   (a) the token appears ALL-UPPER inside a value that is NOT wholly shouted
--       -- i.e. somebody capitalised it deliberately, beside lowercase words
--       ("Gorman & Company LLC", "JES Holdings"); or
--   (b) the token has no vowel at all (MRCDC, WHPC, CLR, NIBP, HDS).
--
-- Both are additionally required never to appear in mixed case anywhere in the
-- corpus, which is what throws out APARTMENTS, MINNESOTA and ATLANTA -- words
-- that merely happen to be shouted in some rows and are written properly in
-- others.
--
-- The failure directions are deliberately asymmetric.  Over-preserving leaves
-- one word shouted: visible, harmless, and fixed by deleting a row.
-- Under-preserving prints "Acc Management Group" on 62 properties.  So when
-- the two signals disagree, the token is kept.
--
-- The table exists -- rather than the vocabulary being a constant in the
-- function -- because this is a judgement no algorithm settles, and a person
-- must be able to add or retire a token without a migration.
-- ---------------------------------------------------------------------------
create table if not exists public.text_case_acronyms (
  id                uuid primary key default gen_random_uuid(),
  tca_record_number text        not null default '',
  tca_token         text        not null,
  tca_source        text        not null default 'derived',
  tca_notes         text,
  tca_is_deleted    boolean     not null default false,
  tca_deleted_at    timestamptz,
  tca_deleted_by    uuid,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint text_case_acronyms_token_is_upper  check (tca_token = upper(tca_token)),
  constraint text_case_acronyms_token_not_blank check (btrim(tca_token) <> ''),
  constraint text_case_acronyms_source_check    check (tca_source in ('derived','manual'))
);
create unique index if not exists text_case_acronyms_token_uk
  on public.text_case_acronyms (tca_token) where tca_is_deleted is not true;

alter table public.text_case_acronyms enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='text_case_acronyms' and policyname='tca_select') then
    create policy tca_select on public.text_case_acronyms for select to authenticated
      using ( (select public.app_user_can('accounts','read')) );
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='text_case_acronyms' and policyname='tca_write') then
    create policy tca_write on public.text_case_acronyms for all to authenticated
      using ( (select public.app_is_admin()) ) with check ( (select public.app_is_admin()) );
  end if;
end $$;

-- The vocabulary as an array, so a statement reads the table once instead of
-- once per row.
create or replace function public.text_case_acronym_tokens()
returns text[] language sql stable
set search_path to 'public','pg_catalog' as $fn$
  select coalesce(array_agg(tca_token), array[]::text[])
  from public.text_case_acronyms where tca_is_deleted is not true;
$fn$;

-- ---------------------------------------------------------------------------
-- One shouted WORD -> its written form.
--
-- Split out from normalize_text_case so the hyphen and slash cases can recurse
-- into it ("WHPC-NIBP", "OWNER/AGENT") instead of each re-implementing the
-- token rules.
-- ---------------------------------------------------------------------------
create or replace function public._text_case_word(p_word text, p_acronyms text[])
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

  -- peel leading/trailing punctuation, so "INC.," and "INC" are judged alike
  m := regexp_match(p_word, '^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$');
  v_lead := coalesce(m[1],''); v_core := coalesce(m[2],''); v_tail := coalesce(m[3],'');
  IF v_core = '' THEN RETURN p_word; END IF;

  -- The vocabulary is consulted BEFORE the hyphen split, so a token registered
  -- whole ("L.L.C", "WI-IRA") wins over its parts.
  IF upper(v_core) = ANY (p_acronyms) THEN RETURN v_lead || upper(v_core) || v_tail; END IF;

  IF v_core ~ '[-/]' THEN
    v_sep := substring(v_core from '[-/]');
    SELECT array_agg(public._text_case_word(p, p_acronyms) ORDER BY o) INTO v_out
      FROM regexp_split_to_table(v_core, '[-/]') WITH ORDINALITY AS s(p, o);
    RETURN v_lead || array_to_string(v_out, v_sep) || v_tail;
  END IF;

  RETURN v_lead || (CASE
    -- an ordinal keeps a lowercase suffix: 17TH -> 17th
    WHEN v_core ~ '^[0-9]+(ST|ND|RD|TH)$' THEN lower(v_core)
    -- anything else carrying a digit is a number, a unit or a code: leave it
    WHEN v_core ~ '[0-9]'                 THEN v_core
    -- a single letter is an initial or a directional: R, K, W
    WHEN length(v_core) = 1               THEN v_core
    -- a roman numeral suffix: Phase II, Apartments III
    WHEN v_core ~ '^(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$' THEN v_core
    -- MCDONALD -> McDonald.  "MC" on its own is a token, not a prefix.
    WHEN v_core ~ '^MC[A-Z]{2,}$'         THEN 'Mc' || initcap(lower(substring(v_core from 3)))
    -- O'BRIEN -> O'Brien.  initcap() does NOT treat an apostrophe as a word
    -- break, so without this it returns "O'brien".
    WHEN v_core ~ '^[ODL]''[A-Z]{2,}$'    THEN substring(v_core from 1 for 2) || initcap(lower(substring(v_core from 3)))
    -- ...and for the same reason MORGAN'S comes back "Morgan'S" unless the
    -- possessive is lowered explicitly.
    ELSE regexp_replace(initcap(lower(v_core)), '''S$', '''s')
  END) || v_tail;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- normalize_text_case(value, kind) -- the single rule.
--
--   'person'        a human name
--   'organization'  a company / authority / project name
--   'address'       a mailing address line
--   'city'          a city name
--   'title'         a job title
--
-- Street-TYPE expansion (St -> Street, W -> West) is deliberately NOT done
-- here.  That vocabulary belongs to normalize_street_address(), which owns the
-- property's own street and is the one place it is written down.  A MAILING
-- address is transcribed the way its owner writes it, and expanding it would
-- also rewrite the city "St. Paul" into "Street Paul" -- which is exactly why
-- these are two rules and not one.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_text_case(p_text text, p_kind text default 'organization')
returns text language plpgsql stable
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  v_in text; v_acronyms text[]; v_words text[];
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

  -- A job title's dash spacing is corrected WHATEVER its casing, because the
  -- reported line -- "Dennis Hanson - Vice President- Housing & Residential" --
  -- prints two hyphen conventions side by side and neither is a casing problem.
  -- A hyphen with whitespace on exactly ONE side is a dash somebody mistyped;
  -- a hyphen with space on neither side is a compound word ("Non-Profit") and
  -- is left alone.
  IF p_kind = 'title' THEN
    v_in := regexp_replace(v_in, '(\S)-\s+', '\1 - ', 'g');
    v_in := regexp_replace(v_in, '\s+-(\S)', ' - \1', 'g');
    v_in := btrim(regexp_replace(v_in, '\s+', ' ', 'g'));
  END IF;

  -- THE SAFETY RULE: one lowercase letter means the casing was chosen. Stop.
  IF v_in ~ '[a-z]' THEN RETURN v_in; END IF;

  v_acronyms := public.text_case_acronym_tokens();
  v_words := string_to_array(v_in, ' ');
  v_n := array_length(v_words, 1);
  FOR i IN 1..v_n LOOP
    v_w := public._text_case_word(v_words[i], v_acronyms);
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
-- Seed the vocabulary from the corpus.
-- ---------------------------------------------------------------------------
with vals as (
  select account_name v                              from public.accounts   where account_is_deleted  is not true
  union all select account_organization_name         from public.accounts   where account_is_deleted  is not true
  union all select billing_street                    from public.accounts   where account_is_deleted  is not true
  union all select property_aka_name                 from public.properties where property_is_deleted is not true
  union all select property_hud_owner_org            from public.properties where property_is_deleted is not true
  union all select property_hud_owner_address        from public.properties where property_is_deleted is not true
  union all select property_lihtc_project_name       from public.properties where property_is_deleted is not true
  union all select property_ph_authority_name        from public.properties where property_is_deleted is not true
  union all select property_ph_project_name          from public.properties where property_is_deleted is not true
  union all select property_usda_management_name     from public.properties where property_is_deleted is not true
  union all select property_mf_raw_mgmt_agent_org_name        from public.properties where property_is_deleted is not true
  union all select property_mfown_raw_owner_organization_name from public.properties where property_is_deleted is not true
  union all select contact_name                      from public.contacts   where contact_is_deleted  is not true
  union all select contact_title                     from public.contacts   where contact_is_deleted  is not true
), w as (
  select (v ~ '[a-z]') as in_mixed_value, w
  from vals, lateral regexp_split_to_table(coalesce(v,''), '[^A-Za-z0-9&''.]+') w
  where w ~ '^[A-Za-z]+$' and length(w) between 2 and 6
), agg as (
  select upper(w) t, count(*) n,
         count(*) filter (where w <> upper(w))                   as ever_mixed,
         count(*) filter (where in_mixed_value and w = upper(w)) as upper_in_mixed
  from w group by 1
)
insert into public.text_case_acronyms (tca_token, tca_source, tca_notes)
select t, 'derived',
       case when upper_in_mixed >= 2 then 'capitalised beside lowercase words in the corpus'
            else 'no vowel' end
from agg
where ever_mixed = 0 and n >= 2 and (upper_in_mixed >= 2 or t !~ '[AEIOU]')
on conflict do nothing;

-- The legal suffixes are seeded BY HAND, not derived, because the corpus
-- already contains badly-cased copies of them ("Llc") and the derivation's
-- "never written mixed" test therefore throws them out -- the one place where
-- reading the data gives the wrong answer, since what is in the data is the
-- defect.  US convention: LLC / LP / LLP / PLLC stay upper; Inc., Corp., Ltd.
-- and Co. are title-cased and so need no entry.
-- JES / CDA / NIBP are real acronyms in live account names that appear ONLY
-- inside wholly-shouted values, so neither derivation signal can see them.
insert into public.text_case_acronyms (tca_token, tca_source, tca_notes)
select t, 'manual', n from (values
  ('LLC','legal suffix'), ('L.L.C','legal suffix'), ('LLP','legal suffix'),
  ('LLLP','legal suffix'), ('PLLC','legal suffix'), ('LP','legal suffix'),
  ('L.P','legal suffix'), ('PC','legal suffix'),
  ('JES','acronym seen only inside shouted values'),
  ('CDA','acronym seen only inside shouted values'),
  ('NIBP','acronym seen only inside shouted values')
) s(t,n)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Prove the rule, against the exact values that were reported and the ones
-- that make it hard.  A migration that installs a text transformation without
-- running it is a migration that installs a guess.
-- ---------------------------------------------------------------------------
do $$
DECLARE
  v_got   text;
  v_fail  text[] := array[]::text[];
  v_cases constant text[][] := array[
    -- the reported line, end to end
    ['PO BOX 304, WAUKESHA, WI 53187','address','PO Box 304, Waukesha, WI 53187'],
    ['Vice President- Housing & Residential','title','Vice President - Housing & Residential'],
    ['WAUKESHA','city','Waukesha'],
    -- the safety rule: a value with any lowercase is returned untouched
    ['6737 W Washington Street, Suite 2275','address','6737 W Washington Street, Suite 2275'],
    -- minor words, legal suffixes, possessives, Mc and O' names
    ['LUTHERAN SOCIAL SERVICES OF WISCONSIN AND UPPER MICHIGAN, INC.','organization',
     'Lutheran Social Services of Wisconsin and Upper Michigan, Inc.'],
    ['GORMAN & COMPANY LLC','organization','Gorman & Company LLC'],
    ['MICHAELS MANAGEMENT AFFORDABLE L.L.C.','organization','Michaels Management Affordable L.L.C.'],
    ['MORGAN''S MILL SUBDIVISION','organization','Morgan''s Mill Subdivision'],
    ['O''BRIEN MANAGEMENT LP','organization','O''Brien Management LP'],
    ['123 MCDONALD ST','address','123 McDonald St'],
    -- acronyms the derivation must have found, on both of its two signals
    ['ACC MANAGEMENT GROUP INC','organization','ACC Management Group Inc'],
    ['LSS HOUSING, HAMPTON, INC.','organization','LSS Housing, Hampton, Inc.'],
    ['WHPC-NIBP PORTFOLIO LLC','organization','WHPC-NIBP Portfolio LLC'],
    ['MRCDC','organization','MRCDC'],
    ['1124 S IH 35','address','1124 S IH 35'],
    -- single letters, ordinals and a city abbreviation that must NOT expand
    ['HALLOIN, R K, INC','organization','Halloin, R K, Inc'],
    ['WOODFIELD SUBDIVISION 17TH','organization','Woodfield Subdivision 17th'],
    ['ST. PAUL','city','St. Paul'],
    -- a compound word in a title keeps its hyphen; a person is a person
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

  -- The vocabulary must actually have been derived.  An empty one would let
  -- every check above pass except the acronym cases, so assert its size too.
  IF (select count(*) from public.text_case_acronyms where tca_is_deleted is not true) < 200 THEN
    RAISE EXCEPTION 'text_case_acronyms holds only % tokens -- the derivation found nothing',
      (select count(*) from public.text_case_acronyms);
  END IF;
END $$;

comment on function public.normalize_text_case(text,text) is
  'The one rule for how LEAP writes a name, an address, a city and a job title. A value already carrying a lowercase letter is returned untouched. Street-type expansion lives in normalize_street_address(), deliberately not here.';
comment on table public.text_case_acronyms is
  'Tokens that stay upper when a shouted value is recased. Derived from LEAP''s own corpus; editable because no algorithm settles which capitals are an acronym.';
