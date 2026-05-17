-- ─── cfp_* tables: replace USING (true) policies with role-aware ones ──
-- The Cap Forecasting Pipeline feature shipped with provisional
-- `cfp_*_all FOR ALL USING (true) WITH CHECK (true)` policies — fully
-- open to any authenticated user. The scheduling rework's authenticated-
-- write-sweep covered most business tables but didn't touch this isolated
-- feature.
--
-- Swap to the standard 4-policy pattern (select/insert/update/delete)
-- backed by app_user_can. Seed role_object_access for the 5 internal
-- staff roles: Admin full CRUD, Program Manager / Project Manager / Project
-- Coordinator / Director of Field Services read-only. External roles
-- (Property Owner, Property Manager, Subcontractor Partner) get no rows
-- — CFP is internal financial modeling, not customer-facing.

-- cfp_projects
drop policy if exists cfp_projects_all on public.cfp_projects;
create policy app_select_cfp_projects on public.cfp_projects
  for select using (app_user_can('cfp_projects', 'read'));
create policy app_insert_cfp_projects on public.cfp_projects
  for insert with check (app_user_can('cfp_projects', 'create'));
create policy app_update_cfp_projects on public.cfp_projects
  for update using (app_user_can('cfp_projects', 'update'));
create policy app_delete_cfp_projects on public.cfp_projects
  for delete using (app_user_can('cfp_projects', 'delete'));

-- cfp_scenarios
drop policy if exists cfp_scenarios_all on public.cfp_scenarios;
create policy app_select_cfp_scenarios on public.cfp_scenarios
  for select using (app_user_can('cfp_scenarios', 'read'));
create policy app_insert_cfp_scenarios on public.cfp_scenarios
  for insert with check (app_user_can('cfp_scenarios', 'create'));
create policy app_update_cfp_scenarios on public.cfp_scenarios
  for update using (app_user_can('cfp_scenarios', 'update'));
create policy app_delete_cfp_scenarios on public.cfp_scenarios
  for delete using (app_user_can('cfp_scenarios', 'delete'));

insert into role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
select r.id, t.tn,
       true,
       case when r.role_name in ('Admin','Program Manager','Project Manager')                 then true else false end,
       case when r.role_name in ('Admin','Program Manager','Project Manager')                 then true else false end,
       case when r.role_name = 'Admin'                                                        then true else false end
from roles r,
     (values ('cfp_projects'),('cfp_scenarios')) as t(tn)
where r.role_is_active
  and r.role_name in ('Admin','Program Manager','Project Manager','Project Coordinator','Director of Field Services');
