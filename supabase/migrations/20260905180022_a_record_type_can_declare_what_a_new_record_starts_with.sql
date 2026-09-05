-- ===========================================================================
-- A record type can declare what a new record STARTS WITH.
--
-- Nicholas, 2026-09-05, on a building: "the type should just default to
-- apartment... just go ahead and default all multifamily building record types
-- to apartments. And then allow the user to change it if they want to, so just
-- on create, I suppose."
--
-- Salesforce answers this on the record type itself -- a picklist has a default
-- value PER RECORD TYPE -- and LEAP had nowhere to say it.  So this is the
-- registry (RTFD-) plus the generated trigger that applies it, in the same
-- shape record_audit_column_overrides, record_state_scope_sources and
-- text_case_normalized_columns already use.
--
-- Two decisions worth stating, because both are easy to get wrong:
--
--   1. It is NOT expressed as a picklist_value_record_type_assignments row.
--      That table answers a DIFFERENT question -- which values this record type
--      may CHOOSE FROM -- and since 2026-08-16 a record type that carries any
--      assignment at all is scoped STRICTLY to them.  Adding one row saying
--      "Apartment is the default" would have cut the Type dropdown on every
--      multifamily building down to Apartment alone, which is the opposite of
--      "allow the user to change it".  Two questions, two artifacts.
--
--   2. WHICH record types are multifamily is DECLARED here, not guessed from
--      the value reading "MULTIFAMILY".  A name heuristic is how
--      building_type's own siblings would get swept in later.
--
-- INSERT only.  "Just on create" is the ask, and it is also the safe reading:
-- a default that reapplied on update would fight a person who cleared the
-- field on purpose.
-- ===========================================================================

create sequence if not exists public.seq_record_type_field_defaults;

create table if not exists public.record_type_field_defaults (
  id                       uuid primary key default gen_random_uuid(),
  rtfd_record_number       text        not null default '',
  rtfd_object              text        not null,
  rtfd_column              text        not null,
  rtfd_record_type_id      uuid        not null references public.picklist_values(id),
  rtfd_default_value_id    uuid        not null references public.picklist_values(id),
  rtfd_notes               text,
  rtfd_is_active           boolean     not null default true,
  rtfd_is_deleted          boolean     not null default false,
  rtfd_deleted_at          timestamptz,
  rtfd_deleted_by          uuid,
  created_at               timestamptz not null default now(),
  created_by               uuid,
  updated_at               timestamptz not null default now(),
  updated_by               uuid
);

-- One answer per (object, column, record type).  A second row would make which
-- default wins depend on physical row order.
create unique index if not exists record_type_field_defaults_uk
  on public.record_type_field_defaults (rtfd_object, rtfd_column, rtfd_record_type_id)
  where rtfd_is_deleted is not true;

create or replace function public.set_rtfd_record_number()
returns trigger language plpgsql
set search_path to 'public','pg_catalog' as $fn$
BEGIN
  NEW.rtfd_record_number := public.generate_record_number('RTFD-', 'seq_record_type_field_defaults');
  RETURN NEW;
END $fn$;
drop trigger if exists trg_rtfd_rn on public.record_type_field_defaults;
create trigger trg_rtfd_rn before insert on public.record_type_field_defaults
  for each row execute function public.set_rtfd_record_number();

drop trigger if exists trg_rtfd_no_hard_delete on public.record_type_field_defaults;
create trigger trg_rtfd_no_hard_delete before delete on public.record_type_field_defaults
  for each row execute function public.block_hard_delete();

-- Read by anyone who can read a record (the generated trigger runs as the
-- signed-in user, so it has to be able to see the registry -- see the note on
-- SECURITY INVOKER below).  Written by admins.
alter table public.record_type_field_defaults enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='record_type_field_defaults' and policyname='rtfd_select') then
    create policy rtfd_select on public.record_type_field_defaults for select to authenticated
      using ( true );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='record_type_field_defaults' and policyname='rtfd_write') then
    create policy rtfd_write on public.record_type_field_defaults for all to authenticated
      using ( (select public.app_is_admin()) ) with check ( (select public.app_is_admin()) );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A registry row that names a column, a record type or a value that does not
-- exist is a default that silently never applies.  Refuse it at write time,
-- by name, rather than discovering it as "the field just stays blank".
-- ---------------------------------------------------------------------------
create or replace function public.validate_record_type_field_default()
returns trigger language plpgsql
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  v_coltype text;
  v_rt      public.picklist_values%ROWTYPE;
  v_val     public.picklist_values%ROWTYPE;
  v_prefix  text;
  v_short   text;
BEGIN
  IF to_regclass('public.' || quote_ident(NEW.rtfd_object)) IS NULL THEN
    RAISE EXCEPTION 'record_type_field_defaults: no such object %', NEW.rtfd_object;
  END IF;

  SELECT data_type INTO v_coltype FROM information_schema.columns
   WHERE table_schema='public' AND table_name=NEW.rtfd_object AND column_name=NEW.rtfd_column;
  IF v_coltype IS NULL THEN
    RAISE EXCEPTION 'record_type_field_defaults: %.% does not exist',
      NEW.rtfd_object, NEW.rtfd_column;
  END IF;
  -- The default is a picklist_values id, so the column has to be able to hold
  -- one.  Writing a uuid into a text column would print a uuid on the page.
  IF v_coltype <> 'uuid' THEN
    RAISE EXCEPTION 'record_type_field_defaults: %.% is %, not a picklist column',
      NEW.rtfd_object, NEW.rtfd_column, v_coltype;
  END IF;

  SELECT * INTO v_rt FROM public.picklist_values WHERE id = NEW.rtfd_record_type_id;
  IF v_rt.picklist_field <> 'record_type' OR v_rt.picklist_object <> NEW.rtfd_object THEN
    RAISE EXCEPTION 'record_type_field_defaults: % is not a record type of %',
      coalesce(v_rt.picklist_value, NEW.rtfd_record_type_id::text), NEW.rtfd_object;
  END IF;

  -- Picklist values are stored under either the full column name or the
  -- prefix-stripped short name; both spellings are live on this platform.
  SELECT * INTO v_val FROM public.picklist_values WHERE id = NEW.rtfd_default_value_id;
  v_prefix := (SELECT regexp_replace(a.attname, '_record_number$', '')
                 FROM pg_attribute a
                WHERE a.attrelid = to_regclass('public.' || quote_ident(NEW.rtfd_object))
                  AND a.attnum > 0 AND NOT a.attisdropped
                  AND a.attname LIKE '%\_record\_number'
                LIMIT 1);
  v_short := CASE WHEN v_prefix IS NOT NULL AND NEW.rtfd_column LIKE v_prefix || '\_%'
                  THEN substring(NEW.rtfd_column from length(v_prefix) + 2) END;
  IF v_val.picklist_object IS DISTINCT FROM NEW.rtfd_object
     OR v_val.picklist_field NOT IN (NEW.rtfd_column, coalesce(v_short, NEW.rtfd_column)) THEN
    RAISE EXCEPTION 'record_type_field_defaults: % is not a value of %.%',
      coalesce(v_val.picklist_value, NEW.rtfd_default_value_id::text),
      NEW.rtfd_object, NEW.rtfd_column;
  END IF;
  IF v_val.picklist_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'record_type_field_defaults: % is retired and cannot be a default',
      v_val.picklist_value;
  END IF;

  RETURN NEW;
END $fn$;
drop trigger if exists trg_rtfd_validate on public.record_type_field_defaults;
create trigger trg_rtfd_validate before insert or update on public.record_type_field_defaults
  for each row execute function public.validate_record_type_field_default();

-- ---------------------------------------------------------------------------
-- Generate one object's trigger from its registry rows.
--
-- Only the COLUMN LIST is generated; the values themselves are read from the
-- registry at run time, so changing a default is a data edit and never a
-- deploy.  And the registry re-installs the object whenever it is written to
-- (below), so the generated list can never fall behind the rows -- the failure
-- mode every hand-kept list in this repo has eventually hit.
--
-- SECURITY INVOKER, deliberately: it reads only record_type_field_defaults,
-- whose SELECT policy is open to authenticated, so there is no definer
-- function to hang an EXECUTE grant on.  That keeps it off the advisors
-- entirely (see the 2026-08-31 note in CLAUDE.md about the grant the advisors
-- tell you to revoke and the record writes that then fail).
-- ---------------------------------------------------------------------------
create or replace function public.install_record_type_field_defaults(p_object text)
returns text language plpgsql
set search_path to 'public','pg_catalog' as $fn$
DECLARE
  v_fn     text := 'apply_record_type_field_defaults__' || p_object;
  v_rtcol  text;
  v_body   text := '';
  v_n      int  := 0;
  r        record;
BEGIN
  IF to_regclass('public.' || quote_ident(p_object)) IS NULL THEN
    RAISE EXCEPTION 'install_record_type_field_defaults: no such table %', p_object;
  END IF;

  -- The object's own record-type column, read off the table rather than
  -- assumed: buildings spell it building_record_type, some objects spell it
  -- record_type.
  SELECT a.attname INTO v_rtcol
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.' || quote_ident(p_object))
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('record_type', (
       SELECT regexp_replace(b.attname, '_record_number$', '_record_type')
         FROM pg_attribute b
        WHERE b.attrelid = a.attrelid AND b.attnum > 0 AND NOT b.attisdropped
          AND b.attname LIKE '%\_record\_number' LIMIT 1))
   ORDER BY length(a.attname) DESC
   LIMIT 1;

  IF v_rtcol IS NULL THEN
    RAISE EXCEPTION 'install_record_type_field_defaults: % has no record type column', p_object;
  END IF;

  FOR r IN
    SELECT DISTINCT rtfd_column
      FROM public.record_type_field_defaults
     WHERE rtfd_object = p_object AND rtfd_is_deleted IS NOT TRUE AND rtfd_is_active
     ORDER BY rtfd_column
  LOOP
    v_body := v_body || format(
      E'  IF NEW.%1$I IS NULL AND NEW.%2$I IS NOT NULL THEN\n'
      '    SELECT d.rtfd_default_value_id INTO NEW.%1$I\n'
      '      FROM public.record_type_field_defaults d\n'
      '     WHERE d.rtfd_object = %3$L AND d.rtfd_column = %4$L\n'
      '       AND d.rtfd_record_type_id = NEW.%2$I\n'
      '       AND d.rtfd_is_active AND d.rtfd_is_deleted IS NOT TRUE;\n'
      '  END IF;\n',
      r.rtfd_column, v_rtcol, p_object, r.rtfd_column);
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN
    EXECUTE format('DROP TRIGGER IF EXISTS trg_r_record_type_field_defaults ON public.%I', p_object);
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I()', v_fn);
    RETURN format('%s: no registered defaults, trigger removed', p_object);
  END IF;

  EXECUTE format(
    E'CREATE OR REPLACE FUNCTION public.%I() RETURNS trigger\n'
    'LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''public'',''pg_catalog'' AS $t$\n'
    'BEGIN\n%s  RETURN NEW;\nEND;\n$t$;', v_fn, v_body);

  -- trg_r_ sorts AFTER trg_0_ (which makes a building follow its property's
  -- record type) and after trg_enforce_record_type (which fills in the
  -- platform default), so the record type is already settled when the default
  -- is looked up -- and BEFORE the trg_z* normalizers and enforcers, which
  -- judge the value that will actually be stored.
  EXECUTE format('DROP TRIGGER IF EXISTS trg_r_record_type_field_defaults ON public.%I', p_object);
  EXECUTE format(
    'CREATE TRIGGER trg_r_record_type_field_defaults BEFORE INSERT ON public.%I '
    'FOR EACH ROW EXECUTE FUNCTION public.%I()', p_object, v_fn);

  RETURN format('%s: %s columns', p_object, v_n);
END $fn$;
revoke all on function public.install_record_type_field_defaults(text) from public;
revoke all on function public.install_record_type_field_defaults(text) from anon, authenticated;

-- The registry keeps its own generated code current.
create or replace function public.reinstall_record_type_field_defaults()
returns trigger language plpgsql
set search_path to 'public','pg_catalog' as $fn$
BEGIN
  PERFORM public.install_record_type_field_defaults(coalesce(NEW.rtfd_object, OLD.rtfd_object));
  IF TG_OP = 'UPDATE' AND OLD.rtfd_object IS DISTINCT FROM NEW.rtfd_object THEN
    PERFORM public.install_record_type_field_defaults(OLD.rtfd_object);
  END IF;
  RETURN NULL;
END $fn$;
drop trigger if exists trg_rtfd_reinstall on public.record_type_field_defaults;
create trigger trg_rtfd_reinstall after insert or update on public.record_type_field_defaults
  for each row execute function public.reinstall_record_type_field_defaults();

-- ---------------------------------------------------------------------------
-- The rows Nicholas asked for: a multifamily building is an Apartment unless
-- somebody says otherwise.  Both multifamily record types, because "all
-- multifamily building record types" is what was asked, and NOT the single
-- family / non-residential / general types, which are not multifamily.
-- ---------------------------------------------------------------------------
insert into public.record_type_field_defaults
  (rtfd_object, rtfd_column, rtfd_record_type_id, rtfd_default_value_id, rtfd_notes)
select 'buildings', 'building_type', rt.id, v.id,
       'Nicholas, 2026-09-05: default all multifamily building record types to Apartment, changeable on the record.'
  from public.picklist_values rt
  join public.picklist_values v
    on v.picklist_object = 'buildings' and v.picklist_field = 'building_type'
   and v.picklist_value = 'Apartment' and v.picklist_is_active
 where rt.picklist_object = 'buildings' and rt.picklist_field = 'record_type'
   and rt.picklist_value in ('MULTIFAMILY', 'NEW-CONSTRUCTION-MULTIFAMILY')
   and rt.picklist_is_active
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Assert it, rather than assume the seed landed and the trigger was built.
-- ---------------------------------------------------------------------------
do $$
DECLARE
  v_rows int;
  v_apartment uuid;
  v_mf uuid;
BEGIN
  SELECT count(*) INTO v_rows FROM public.record_type_field_defaults
   WHERE rtfd_object='buildings' AND rtfd_column='building_type' AND rtfd_is_deleted IS NOT TRUE;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'expected 2 building_type defaults (both multifamily record types), found %', v_rows;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'buildings' AND t.tgname = 'trg_r_record_type_field_defaults') THEN
    RAISE EXCEPTION 'the buildings trigger was not installed';
  END IF;

  -- Trigger order is load-bearing: the record type is filled in by
  -- trg_enforce_record_type / trg_0_building_record_type_follows_property, and
  -- a default looked up before that runs reads NULL and does nothing.
  IF (SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relname='buildings' AND NOT t.tgisinternal
         AND t.tgname IN ('trg_enforce_record_type','trg_r_record_type_field_defaults')
       ORDER BY t.tgname DESC LIMIT 1) <> 'trg_r_record_type_field_defaults' THEN
    RAISE EXCEPTION 'the defaults trigger must sort after trg_enforce_record_type';
  END IF;

  SELECT id INTO v_apartment FROM public.picklist_values
   WHERE picklist_object='buildings' AND picklist_field='building_type' AND picklist_value='Apartment';
  SELECT id INTO v_mf FROM public.picklist_values
   WHERE picklist_object='buildings' AND picklist_field='record_type' AND picklist_value='MULTIFAMILY';
  IF NOT EXISTS (SELECT 1 FROM public.record_type_field_defaults
                  WHERE rtfd_record_type_id=v_mf AND rtfd_default_value_id=v_apartment) THEN
    RAISE EXCEPTION 'the multifamily default does not point at Apartment';
  END IF;

  -- CONTROL: single family must NOT have picked up a default.
  IF EXISTS (
    SELECT 1 FROM public.record_type_field_defaults d
      JOIN public.picklist_values rt ON rt.id = d.rtfd_record_type_id
     WHERE d.rtfd_object='buildings' AND rt.picklist_value LIKE 'SINGLE-FAMILY%') THEN
    RAISE EXCEPTION 'a non-multifamily record type was given a default';
  END IF;
END $$;

notify pgrst, 'reload schema';
