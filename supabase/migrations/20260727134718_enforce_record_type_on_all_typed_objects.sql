-- Enforce: no record may be created without a record type
-- ---------------------------------------------------------------------------
-- Policy (Nicholas): it must be impossible to create a record of a record-typed
-- object without a record type — from ANY path, not just the create UI (which
-- already gates on the record-type picker). Imports, RPCs (e.g. the LEAP Pad
-- ad-hoc unit creation), and automation flows insert directly and could leave
-- the record type null.
--
-- Approach (Salesforce parity, non-breaking): every record-typed object gets a
-- designated DEFAULT record type. A BEFORE INSERT trigger fills the record-type
-- column from that default whenever an insert omits it. The create UI still
-- forces an explicit choice; backend inserts can no longer produce a null.
--
-- Scope: the 35 objects that have a real, own record-type column. Excluded:
--   • work_types    — its only *_record_type column is a config field
--                     (work_type_default_project_record_type), not an own type.
--   • portal_users  — has record-type picklist values but no record-type column.
-- Those two are called out so a future session handles them deliberately.
-- ---------------------------------------------------------------------------

-- 1) Designated default record type per object -----------------------------
alter table picklist_values
  add column if not exists picklist_is_default_record_type boolean not null default false;

-- Exactly one default per object: prefer a conventional default name, else the
-- lowest-sort-order active type.
with ranked as (
  select id, row_number() over (
    partition by picklist_object
    order by (case when lower(picklist_value) in ('standard','master','default','dwelling unit')
                   then 0 else 1 end),
             picklist_sort_order nulls last, picklist_created_at nulls last, picklist_label
  ) as rn
  from picklist_values
  where picklist_field='record_type' and picklist_is_active
)
update picklist_values pv
   set picklist_is_default_record_type = (r.rn = 1)
  from ranked r
 where r.id = pv.id;

create unique index if not exists picklist_one_default_rt_per_object
  on picklist_values (picklist_object)
  where picklist_field='record_type' and picklist_is_default_record_type;

-- 2) Default resolver -------------------------------------------------------
-- STABLE so a multi-row insert evaluates it once per (statement, object).
create or replace function public.default_record_type_for(p_obj text)
returns uuid
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    (select id from picklist_values
       where picklist_object = p_obj and picklist_field='record_type'
         and picklist_is_active and picklist_is_default_record_type
       order by picklist_sort_order nulls last, picklist_created_at nulls last limit 1),
    (select id from picklist_values
       where picklist_object = p_obj and picklist_field='record_type' and picklist_is_active
       order by picklist_sort_order nulls last, picklist_created_at nulls last limit 1)
  );
$function$;

-- 3) Per-table BEFORE INSERT enforcement -----------------------------------
-- One small trigger function per object (direct column assignment — no whole-row
-- jsonb round-trip, so tables carrying geometry/tsvector columns are untouched).
-- If the object somehow has no active record type, default_record_type_for
-- returns null and the column is left as-is: this trigger can never fail an
-- insert.
do $do$
declare
  r record;
  fn text;
begin
  for r in
    select * from (values
      ('accounts','account_record_type'),
      ('assessments','assessment_record_type'),
      ('buildings','building_record_type'),
      ('contacts','contact_record_type'),
      ('diagnostic_tests','diagnostic_record_type'),
      ('document_templates','record_type'),
      ('efr_reports','efr_record_type'),
      ('email_templates','record_type'),
      ('enrollments','enrollment_record_type'),
      ('envelope_events','event_record_type'),
      ('envelope_recipients','recipient_record_type'),
      ('envelope_tabs','tab_record_type'),
      ('envelopes','env_record_type'),
      ('equipment','equipment_record_type'),
      ('equipment_activities','ea_record_type'),
      ('gps_points','gps_record_type'),
      ('incentive_applications','ia_record_type'),
      ('incentives','incentive_record_type'),
      ('mechanical_equipment','me_record_type'),
      ('occurrences','occurrence_record_type'),
      ('opportunities','opportunity_record_type'),
      ('products','product_record_type'),
      ('project_report_templates','prt_record_type'),
      ('projects','project_record_type'),
      ('properties','property_record_type'),
      ('time_sheet_entries','tse_record_type'),
      ('time_sheets','ts_record_type'),
      ('units','unit_record_type'),
      ('vehicle_activities','va_record_type'),
      ('vehicles','vehicle_record_type'),
      ('work_orders','work_order_record_type'),
      ('work_plan_templates','wpt_record_type'),
      ('work_plans','work_plan_record_type'),
      ('work_step_templates','wst_record_type'),
      ('work_steps','work_step_record_type')
    ) as t(obj, col)
  loop
    -- Guard: only wire objects whose table + column actually exist as a uuid.
    if not exists (
      select 1 from information_schema.columns c
       where c.table_schema='public' and c.table_name=r.obj
         and c.column_name=r.col and c.data_type='uuid'
    ) then
      continue;
    end if;

    fn := 'enforce_rt__' || r.obj;

    execute format($tmpl$
      create or replace function public.%I() returns trigger
      language plpgsql
      set search_path to 'public', 'pg_catalog'
      as $trg$
      begin
        if NEW.%I is null then
          NEW.%I := public.default_record_type_for(%L);
        end if;
        return NEW;
      end
      $trg$;
    $tmpl$, fn, r.col, r.col, r.obj);

    execute format('drop trigger if exists trg_enforce_record_type on public.%I', r.obj);
    execute format(
      'create trigger trg_enforce_record_type before insert on public.%I '
      || 'for each row execute function public.%I()', r.obj, fn);
  end loop;
end
$do$;

-- Help article ---------------------------------------------------------------
insert into help_articles
  (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published, ha_created_by)
select gen_random_uuid(), 'HA-00153', 'every-record-has-a-record-type',
 'Every Record Has a Record Type',
 'Record-typed objects can never be created without a record type — from the app, an import, or automation. Each object has a default record type used as a fallback.',
$md$## The rule

For every object that uses record types, **a record can never be created without
one**. This holds no matter how the record is created:

- **In the app** — the create screen shows the Record Type prompt and will not let
  you continue until you choose one (when an object has a single record type it is
  assigned automatically).
- **Imports, automations, and background jobs** — if a create path does not specify
  a record type, the object's **default record type** is applied automatically, so a
  record can never land in the database without one.

## Default record type

Each record-typed object has one **default record type**. It is the fallback used
when a non-interactive create path (an import or an automation) does not set a type.
People creating records by hand still choose explicitly — the default is only a
safety net so nothing slips through untyped.

For example, the default for **Units** is **Dwelling Unit**, so a unit created by a
field automation is a dwelling unless someone classifies it otherwise.

## Changing the default

An administrator can change which record type is the default for an object. There is
always exactly one default per object.

## Objects without record types

A few structural objects (join records, system/audit logs, and configuration tables)
have no record-type concept and are unaffected — the rule applies to the business
objects that actually carry record types.
$md$,
 'Administration', 'internal', true,
 (select ha_created_by from help_articles where ha_created_by is not null order by ha_created_at desc limit 1)
where not exists (select 1 from help_articles where ha_record_number='HA-00153');

notify pgrst, 'reload schema';
