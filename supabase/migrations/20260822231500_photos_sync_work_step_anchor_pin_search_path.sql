-- Advisor follow-up to 20260822223100: function_search_path_mutable.
-- Pin the search path on the photo anchor trigger so it matches every other
-- function in the platform.
create or replace function public.photos_sync_work_step_anchor()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  if new.related_object = 'work_steps'
     and new.work_step_id is null
     and new.related_id is not null then
    new.work_step_id := new.related_id;
  end if;
  return new;
end;
$$;

revoke all on function public.photos_sync_work_step_anchor() from public, anon, authenticated;
