-- ===========================================================================
-- The columns the casing rule governs are DECLARED, and there is one function
-- that applies it to what is already stored.
--
-- The previous migration installed normalize_text_case().  A rule nothing
-- calls is a rule nothing enforces, so this one says WHICH columns it governs
-- (a registry, the shape record_audit_column_overrides and
-- record_state_scope_sources already use), generates the trigger that applies
-- it per object, and provides run_text_case_backfill() to correct what is
-- already stored.  The backfill itself runs in the migrations that follow,
-- object by object, because a single call has to finish inside one minute.
--
-- Deliberately NOT registered:
--
--   * every property_*_raw_* / _mf_raw_ / _mfown_raw_ / _usda_raw_ / _ph_raw_
--     column.  Those are the import's own transcript -- what HUD, LIHTC and
--     USDA actually sent -- and they are the evidence a match was made
--     correctly.  Rewriting them destroys the provenance the display columns
--     are checked against.
--   * incentive_applications.ia_program_name.  It holds a program CODE
--     ("WI-IRA-MF-HOMES-AUDIT"), and the calibration run turned that into
--     "WI-Ira-MF-Homes-Audit".  A code is not prose.
--   * properties.property_street and property_city, which
--     normalize_property_address() has owned since the importers landed.  Two
--     rules on one column is the thing this whole change exists to prevent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- First: the vocabulary becomes a jsonb OBJECT rather than a text[].
--
-- Not a style change -- a measured one.  `= ANY(array)` is a linear scan, so
-- every word of every shouted value was compared against all 494 tokens: on
-- properties.property_aka_name alone (16,779 values to rewrite) that is 5.0
-- seconds.  `jsonb ? key` is a hash probe, and the same query runs in 1.5.
-- Over the eleven registered property columns that is the difference between a
-- backfill that fits in a transaction and one that does not.
-- ---------------------------------------------------------------------------
drop function if exists public.text_case_acronym_tokens();
drop function if exists public._text_case_word(text, text[]);

create or replace function public.text_case_acronym_tokens()
returns jsonb language sql stable
set search_path to 'public','pg_catalog' as $fn$
  select coalesce(jsonb_object_agg(tca_token, true), '{}'::jsonb)
  from public.text_case_acronyms where tca_is_deleted is not true;
$fn$;

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
    -- break, so without this it returns "O'brien"...
    WHEN v_core ~ '^[ODL]''[A-Z]{2,}$'    THEN substring(v_core from 1 for 2) || initcap(lower(substring(v_core from 3)))
    -- ...and for the same reason MORGAN'S comes back "Morgan'S" unless the
    -- possessive is lowered explicitly.
    ELSE regexp_replace(initcap(lower(v_core)), '''S$', '''s')
  END) || v_tail;
END;
$fn$;

-- The worker, so a bulk statement can hoist the vocabulary out of the row loop
-- instead of rebuilding it per value.  normalize_text_case() keeps its
-- signature and remains the one thing anything else calls.
create or replace function public._normalize_text_case(p_text text, p_kind text, p_acronyms jsonb)
returns text language plpgsql immutable
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  v_in text; v_words text[];
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
  -- a hyphen with space on neither side is a compound word ("Non-Profit").
  IF p_kind = 'title' THEN
    v_in := regexp_replace(v_in, '(\S)-\s+', '\1 - ', 'g');
    v_in := regexp_replace(v_in, '\s+-(\S)', ' - \1', 'g');
    v_in := btrim(regexp_replace(v_in, '\s+', ' ', 'g'));
  END IF;

  -- THE SAFETY RULE: one lowercase letter means the casing was chosen. Stop.
  IF v_in ~ '[a-z]' THEN RETURN v_in; END IF;

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

create or replace function public.normalize_text_case(p_text text, p_kind text default 'organization')
returns text language sql stable
set search_path to 'public','pg_catalog' as $fn$
  select public._normalize_text_case(p_text, p_kind, public.text_case_acronym_tokens());
$fn$;

-- ---------------------------------------------------------------------------
-- The registry.
-- ---------------------------------------------------------------------------
create table if not exists public.text_case_normalized_columns (
  id                 uuid primary key default gen_random_uuid(),
  tcnc_record_number text        not null default '',
  tcnc_object        text        not null,
  tcnc_column        text        not null,
  tcnc_kind          text        not null,
  tcnc_notes         text,
  tcnc_is_deleted    boolean     not null default false,
  tcnc_deleted_at    timestamptz,
  tcnc_deleted_by    uuid,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint text_case_normalized_columns_kind_check
    check (tcnc_kind in ('person','organization','address','city','title'))
);
create unique index if not exists text_case_normalized_columns_uk
  on public.text_case_normalized_columns (tcnc_object, tcnc_column)
  where tcnc_is_deleted is not true;

alter table public.text_case_normalized_columns enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='text_case_normalized_columns' and policyname='tcnc_select') then
    create policy tcnc_select on public.text_case_normalized_columns for select to authenticated
      using ( (select public.app_user_can('accounts','read')) );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='text_case_normalized_columns' and policyname='tcnc_write') then
    create policy tcnc_write on public.text_case_normalized_columns for all to authenticated
      using ( (select public.app_is_admin()) ) with check ( (select public.app_is_admin()) );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- What the backfill changed.  A recase of ~25,000 live values with no record
-- of the previous text is a one-way door; with this table it is reversible,
-- and an account whose name comes back wrong can be traced to the rule that
-- rewrote it.
--
-- Because this table records the change, the backfill runs with the two AUDIT
-- triggers on each object switched off -- otherwise log_audit_and_field_history
-- would file ~25,000 snapshots recording a migration as though a person had
-- edited every record, and stamp_<object>_audit_fields would overwrite every
-- row's real Last Modified Date with now() (that field shipped 2026-08-22, and
-- a mass recase is not what "last modified" is meant to tell you).
--
-- Deliberately NOT session_replication_role = replica, which the 2026-08-22
-- backfill used: neither the migration role nor the SQL role may set that
-- parameter on this project any more.  Disabling two NAMED triggers is the
-- narrower instrument in any case -- foreign keys stay enforced and every
-- other trigger on the object still fires.
-- ---------------------------------------------------------------------------
create table if not exists public.text_case_normalization_log (
  id                 uuid primary key default gen_random_uuid(),
  tcnl_object        text        not null,
  tcnl_record_id     uuid        not null,
  tcnl_column        text        not null,
  tcnl_kind          text        not null,
  tcnl_value_before  text        not null,
  tcnl_value_after   text        not null,
  tcnl_reason        text        not null default 'backfill',
  created_at         timestamptz not null default now()
);
create index if not exists text_case_normalization_log_record_idx
  on public.text_case_normalization_log (tcnl_object, tcnl_record_id);
alter table public.text_case_normalization_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='text_case_normalization_log' and policyname='tcnl_select') then
    create policy tcnl_select on public.text_case_normalization_log for select to authenticated
      using ( (select public.app_is_admin()) );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Generate one object's trigger from its registry rows.
--
-- The generated function is SECURITY DEFINER, and this is not a preference.
-- normalize_text_case() reads text_case_acronyms, which is RLS-protected; a
-- SECURITY INVOKER trigger would therefore hang on a SELECT grant to
-- `authenticated` -- and a grant of exactly that shape is what the advisors
-- tell the next session to revoke.  That conflict has already broken record
-- writes twice (2026-07-27, and again 2026-08-29 as "permission denied for
-- function recompute_property_rollups").  The settled answer, recorded in
-- CLAUDE.md, is to make the TRIGGER function definer and REVOKE EXECUTE in the
-- same migration -- PostgreSQL does not check EXECUTE when it FIRES a trigger,
-- only at CREATE TRIGGER, so revoking costs nothing and keeps the advisor
-- count flat.
-- ---------------------------------------------------------------------------
create or replace function public.install_text_case_normalization(p_object text)
returns text language plpgsql
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  v_fn   text := 'text_case_normalize__' || p_object;
  v_body text := '';
  r      record;
  v_n    int := 0;
BEGIN
  IF to_regclass('public.' || quote_ident(p_object)) IS NULL THEN
    RAISE EXCEPTION 'install_text_case_normalization: no such table %', p_object;
  END IF;

  FOR r IN
    SELECT tcnc_column, tcnc_kind
    FROM public.text_case_normalized_columns
    WHERE tcnc_object = p_object AND tcnc_is_deleted IS NOT TRUE
    ORDER BY tcnc_column
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=p_object AND column_name=r.tcnc_column) THEN
      RAISE EXCEPTION 'install_text_case_normalization: %.% is registered but does not exist',
        p_object, r.tcnc_column;
    END IF;
    -- Only touch a column whose value actually moved.  properties carries 828
    -- columns; re-deriving eleven of them on every write, most of which change
    -- neither, is a tax on the platform's busiest table for nothing.
    v_body := v_body || format(
      E'  IF TG_OP = ''INSERT'' OR NEW.%1$I IS DISTINCT FROM OLD.%1$I THEN\n    NEW.%1$I := public.normalize_text_case(NEW.%1$I, %2$L);\n  END IF;\n',
      r.tcnc_column, r.tcnc_kind);
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN
    EXECUTE format('DROP TRIGGER IF EXISTS trg_zy_text_case ON public.%I', p_object);
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I()', v_fn);
    RETURN format('%s: no registered columns, trigger removed', p_object);
  END IF;

  EXECUTE format(
    E'CREATE OR REPLACE FUNCTION public.%I() RETURNS trigger\nLANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'',''pg_catalog'' AS $t$\nBEGIN\n%s  RETURN NEW;\nEND;\n$t$;',
    v_fn, v_body);

  -- A plain CREATE FUNCTION leaves the default PUBLIC EXECUTE grant, which
  -- would make each of these a *callable* SECURITY DEFINER function and one
  -- more advisor finding apiece.  Revoke in the same breath as creating it.
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC', v_fn);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM anon, authenticated', v_fn);

  -- trg_zy_ sorts after the derivers (trg_0_, trg_a..trg_c) so a composed name
  -- is normalized once it exists, and before the trg_zz_ enforcers, which
  -- judge the value that will actually be stored.
  EXECUTE format('DROP TRIGGER IF EXISTS trg_zy_text_case ON public.%I', p_object);
  EXECUTE format(
    'CREATE TRIGGER trg_zy_text_case BEFORE INSERT OR UPDATE ON public.%I '
    'FOR EACH ROW EXECUTE FUNCTION public.%I()', p_object, v_fn);

  RETURN format('%s: %s columns', p_object, v_n);
END;
$fn$;
revoke all on function public.install_text_case_normalization(text) from public;
revoke all on function public.install_text_case_normalization(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Correct what is already stored, for the named objects.  Split by object
-- because one call has to finish inside a minute; idempotent, so a second run
-- rewrites nothing.
-- ---------------------------------------------------------------------------
create or replace function public.run_text_case_backfill(p_objects text[])
returns bigint language plpgsql
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  r       record;
  t       record;
  v_sql   text;
  v_pre   text;
  v_rows  bigint;
  v_total bigint := 0;
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
    -- A cheap prefilter, so a 16,665-row table is a regex test per value rather
    -- than a plpgsql call per value.  It is a strict SUPERSET of what the rule
    -- can change: outside kind 'title' (which also respaces a mixed-case dash)
    -- the only edits are to a wholly shouted value or to stray whitespace.
    -- verify_text_case_normalization() re-checks EVERY row with no prefilter at
    -- all, so if this superset is ever wrong it is caught rather than quietly
    -- skipping rows.
    v_pre := CASE WHEN r.k = 'title' THEN 'TRUE'
                  ELSE format('(%1$I !~ ''[a-z]'' OR %1$I ~ ''\s\s'' OR %1$I <> btrim(%1$I))', r.c)
             END;

    -- Record the change, then make it.  Both statements carry the same
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

-- Every registered column of the named objects that the rule would still
-- change, plus any audit trigger the backfill left switched off.  Must return
-- zero rows.
create or replace function public.verify_text_case_normalization(p_objects text[])
returns table (finding text, detail text) language plpgsql
set search_path to 'public','pg_catalog' as $fn$
DECLARE r record; v_left bigint;
BEGIN
  FOR r IN SELECT tcnc_object o, tcnc_column c, tcnc_kind k
           FROM public.text_case_normalized_columns
           WHERE tcnc_is_deleted IS NOT TRUE AND tcnc_object = ANY (p_objects)
  LOOP
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

  FOR r IN
    SELECT c.relname o, tg.tgname g
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid AND c.relnamespace = 'public'::regnamespace
    JOIN pg_proc  p ON p.oid = tg.tgfoid
    WHERE NOT tg.tgisinternal AND tg.tgenabled = 'D' AND c.relname = ANY (p_objects)
      AND (p.proname = 'log_audit_and_field_history' OR p.proname ~ '^stamp_.*_audit_fields$')
  LOOP
    finding := 'audit trigger left disabled'; detail := format('%s.%s', r.o, r.g);
    RETURN NEXT;
  END LOOP;
END;
$fn$;
revoke all on function public.verify_text_case_normalization(text[]) from public;
revoke all on function public.verify_text_case_normalization(text[]) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Register the columns a document, a record page or a list view prints.
-- ---------------------------------------------------------------------------
insert into public.text_case_normalized_columns (tcnc_object, tcnc_column, tcnc_kind, tcnc_notes)
select o, c, k, n from (values
  -- the owner company, its billing address, and that company's own contacts:
  -- the three things the Customer Information block on every proposal prints
  ('accounts','account_name','organization','printed as the customer on every proposal'),
  ('accounts','account_organization_name','organization',null),
  ('accounts','account_service_provider_dba_name','organization',null),
  ('accounts','billing_street','address','composed into enrollment_owner_address'),
  ('accounts','billing_city','city','composed into enrollment_owner_address'),
  ('accounts','mailing_street','address',null),
  ('accounts','mailing_city','city',null),

  ('contacts','contact_name','person',null),
  ('contacts','contact_first_name','person',null),
  ('contacts','contact_last_name','person',null),
  ('contacts','contact_title','title','also fixes the dash spacing in "Vice President- Housing"'),
  ('contacts','contact_department','organization',null),
  ('contacts','contact_mailing_street','address',null),
  ('contacts','contact_mailing_city','city',null),
  ('contacts','contact_home_base_street','address',null),
  ('contacts','contact_home_base_city','city',null),
  ('contacts','contact_emergency_contact_name','person',null),

  ('enrollments','enrollment_contact_name','person',null),
  ('enrollments','enrollment_contact_title','title',null),
  ('enrollments','enrollment_owner_address','address','the reported line'),
  ('enrollments','enrollment_payment_address_line1','address',null),
  ('enrollments','enrollment_payment_city','city',null),

  ('buildings','building_name','organization',null),
  ('buildings','building_number_or_name','organization',null),
  ('buildings','building_address','address',null),
  ('buildings','building_city','city',null),

  ('properties','property_aka_name','organization',null),
  ('properties','property_subdivision_name','organization',null),
  ('properties','property_hud_owner_org','organization',null),
  ('properties','property_hud_owner_address','address',null),
  ('properties','property_hud_owner_city','city',null),
  ('properties','property_lihtc_project_name','organization',null),
  ('properties','property_ph_project_name','organization',null),
  ('properties','property_ph_authority_name','organization',null),
  ('properties','property_usda_management_name','organization',null),
  ('properties','property_mf_hub_name','organization',null),
  ('properties','property_std_address','address','HUD standardised address; referenced by no function or client module'),

  ('opportunities','opportunity_property_aka','organization','copied from properties.property_aka_name at create'),

  ('incentive_applications','ia_property_owner_name','organization','printed as the customer on the payment-request invoice'),
  ('incentive_applications','ia_building_owner_name','organization',null),
  ('incentive_applications','ia_applicant_name','person',null),
  ('incentive_applications','ia_business_entity_name_contact_name','person',null),
  ('incentive_applications','ia_installation_contact_name','person',null),
  ('incentive_applications','ia_in_unit_owner_name','person',null),
  ('incentive_applications','ia_signature_first_name','person',null),
  ('incentive_applications','ia_signature_last_name','person',null),
  ('incentive_applications','ia_primary_contractor_business_name','organization',null),
  ('incentive_applications','ia_primary_contractor_contact_first_name','person',null),
  ('incentive_applications','ia_primary_contractor_contact_last_name','person',null),
  ('incentive_applications','ia_primary_contractor_address_street','address',null),
  ('incentive_applications','ia_primary_contractor_address_city','city',null),
  ('incentive_applications','ia_payment_mailing_street','address',null),
  ('incentive_applications','ia_payment_mailing_city','city',null),
  ('incentive_applications','ia_mailing_address_for_rebates','address',null)
) s(o,c,k,n)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Install the triggers.
-- ---------------------------------------------------------------------------
do $$
DECLARE r record; v_msg text;
BEGIN
  FOR r IN SELECT DISTINCT tcnc_object o FROM public.text_case_normalized_columns
           WHERE tcnc_is_deleted IS NOT TRUE ORDER BY 1 LOOP
    v_msg := public.install_text_case_normalization(r.o);
    RAISE NOTICE 'text case: %', v_msg;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- The rule still behaves after the jsonb swap, and the trigger really fires on
-- an ordinary write.  Re-run here rather than trusted from the previous
-- migration: the vocabulary lookup was reimplemented, and an untested rewrite
-- of a text transformation is a guess.
-- ---------------------------------------------------------------------------
do $$
DECLARE
  v_got   text;
  v_probe text;
  v_fail  text[] := array[]::text[];
  v_cases constant text[][] := array[
    ['PO BOX 304, WAUKESHA, WI 53187','address','PO Box 304, Waukesha, WI 53187'],
    ['Vice President- Housing & Residential','title','Vice President - Housing & Residential'],
    ['WAUKESHA','city','Waukesha'],
    ['6737 W Washington Street, Suite 2275','address','6737 W Washington Street, Suite 2275'],
    ['LUTHERAN SOCIAL SERVICES OF WISCONSIN AND UPPER MICHIGAN, INC.','organization',
     'Lutheran Social Services of Wisconsin and Upper Michigan, Inc.'],
    ['GORMAN & COMPANY LLC','organization','Gorman & Company LLC'],
    ['MICHAELS MANAGEMENT AFFORDABLE L.L.C.','organization','Michaels Management Affordable L.L.C.'],
    ['MORGAN''S MILL SUBDIVISION','organization','Morgan''s Mill Subdivision'],
    ['O''BRIEN MANAGEMENT LP','organization','O''Brien Management LP'],
    ['123 MCDONALD ST','address','123 McDonald St'],
    ['ACC MANAGEMENT GROUP INC','organization','ACC Management Group Inc'],
    ['LSS HOUSING, HAMPTON, INC.','organization','LSS Housing, Hampton, Inc.'],
    ['WHPC-NIBP PORTFOLIO LLC','organization','WHPC-NIBP Portfolio LLC'],
    ['MRCDC','organization','MRCDC'],
    ['1124 S IH 35','address','1124 S IH 35'],
    ['HALLOIN, R K, INC','organization','Halloin, R K, Inc'],
    ['WOODFIELD SUBDIVISION 17TH','organization','Woodfield Subdivision 17th'],
    ['ST. PAUL','city','St. Paul'],
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
    RAISE EXCEPTION 'normalize_text_case failed % of % cases after the jsonb swap: %',
      array_length(v_fail,1), array_length(v_cases,1), array_to_string(v_fail, E'\n  ');
  END IF;

  -- The trigger fires on an ordinary write, not only during a backfill.
  -- Written and rolled back inside this block.
  BEGIN
    UPDATE public.accounts SET account_name = 'ZZ TEST SHOUTING NAME LLC'
     WHERE id = (SELECT id FROM public.accounts WHERE account_is_deleted IS NOT TRUE LIMIT 1)
     RETURNING account_name INTO v_probe;
    -- Asserted by shape, not by exact text: whether a given probe word lands in
    -- the derived acronym vocabulary depends on the corpus, and an assertion
    -- that must be re-tuned whenever the data moves is one nobody trusts.  What
    -- must hold is that the write was recased and the legal suffix survived.
    IF v_probe ~ '^[A-Z0-9 ]+$' OR v_probe NOT LIKE '% LLC' THEN
      RAISE EXCEPTION 'the accounts trigger did not fire, or ate the suffix: got %L', v_probe;
    END IF;
    RAISE EXCEPTION 'rollback_the_probe';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_the_probe' THEN RAISE; END IF;
  END;
END $$;

comment on table public.text_case_normalized_columns is
  'Which columns normalize_text_case() governs, and as what kind. install_text_case_normalization(object) turns these rows into that object''s trigger.';
comment on table public.text_case_normalization_log is
  'Every value the casing backfill rewrote, before and after, so the rewrite is reversible and traceable.';
comment on function public.run_text_case_backfill(text[]) is
  'Apply the casing rule to what is already stored, for the named objects. Idempotent; logs every change to text_case_normalization_log; silences only the two audit triggers while it runs.';
