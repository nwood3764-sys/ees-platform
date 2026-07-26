-- =============================================================================
-- Portal invite automation + account-scoped security hardening
--
-- Adds the server-side spine for the "Add to Portal" action on an account
-- record: an internal user invites a contact into the Multi-Family Project
-- Portal, choosing a portal role and exactly which of the account's properties
-- that user may view. The hard security rule — a portal user can NEVER see a
-- property outside their own account — is enforced in THREE places:
--   1. Write time  (portal_invite_create / portal_grants_set): every property
--      id is validated to belong to the portal user's bound account before a
--      grant row is written; a stray id raises and aborts the whole call.
--   2. Read  time  (get_portal_project_tracker): grants are re-joined to
--      properties and filtered by the portal user's account, so even a bad or
--      legacy grant row can never leak cross-account data (defense in depth).
--   3. The portal user is bound to one account (portal_users.portal_user_account_id)
--      at creation and it is never widened.
--
-- Sending the invitation EMAIL is a deliberately separate step (edge function
-- invite-portal-user). portal_invite_create only creates a PENDING portal user
-- (no auth identity, no email) so the whole flow — role, property picker,
-- account scoping, grants — can be fully exercised without contacting the
-- person. Nothing is emailed until an internal user explicitly sends it.
-- =============================================================================

-- ── Explicit status lifecycle for portal users (nothing hardcoded) ───────────
insert into public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order, picklist_is_active)
select v.picklist_object, v.picklist_field, v.picklist_value, v.picklist_label, v.picklist_sort_order, true
from (values
  ('portal_users','status','portal_user_pending',    'Portal User Pending',     1),
  ('portal_users','status','portal_user_invited',    'Portal User Invited',     2),
  ('portal_users','status','portal_user_active',     'Portal User Active',      3),
  ('portal_users','status','portal_user_suspended',  'Portal User Suspended',   4),
  ('portal_users','status','portal_user_deactivated','Portal User Deactivated', 5)
) as v(picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order)
where not exists (
  select 1 from public.picklist_values p
  where p.picklist_object = v.picklist_object
    and p.picklist_field  = v.picklist_field
    and p.picklist_value  = v.picklist_value
);

-- ── portal_invite_create ─────────────────────────────────────────────────────
-- Creates a PENDING portal user for a contact + the property grants. Does NOT
-- send an email and does NOT create an auth identity. Account-scoped + gated.
create or replace function public.portal_invite_create(
  p_contact_id  uuid,
  p_portal_role uuid,
  p_property_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_caller         uuid;
  v_contact_name   text;
  v_contact_email  text;
  v_account        uuid;
  v_existing_pu    uuid;
  v_contact_del    boolean;
  v_portal_user_id uuid;
  v_email          text;
  v_name           text;
  v_props          uuid[];
  v_bad            int;
  v_granted        int := 0;
  v_pid            uuid;
begin
  -- 1. AuthN + permission
  v_caller := current_app_user_id();
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.app_user_can('portal_users', 'create') then
    raise exception 'You do not have permission to create portal users' using errcode = '42501';
  end if;
  if not public.app_user_can('portal_user_property_grants', 'create') then
    raise exception 'You do not have permission to grant property access' using errcode = '42501';
  end if;

  -- 2. Load contact
  select c.contact_name, c.contact_email, c.contact_account_id,
         c.contact_portal_user_id, c.contact_is_deleted
    into v_contact_name, v_contact_email, v_account, v_existing_pu, v_contact_del
  from public.contacts c
  where c.id = p_contact_id;

  if not found or v_contact_del is true then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;
  if v_account is null then
    raise exception 'This contact is not linked to an account, so it cannot be scoped to a portal' using errcode = 'P0001';
  end if;

  v_email := lower(nullif(btrim(v_contact_email), ''));
  if v_email is null then
    raise exception 'This contact has no email address on file' using errcode = 'P0001';
  end if;
  v_name := coalesce(nullif(btrim(v_contact_name), ''), v_email);

  -- 3. Already has portal access?
  if v_existing_pu is not null
     and exists (select 1 from public.portal_users pu where pu.id = v_existing_pu and pu.is_deleted = false) then
    raise exception 'This contact already has a portal user. Use Manage Portal Access to change it.' using errcode = 'P0001';
  end if;

  -- 4. Validate portal role
  if not exists (
    select 1 from public.picklist_values
    where id = p_portal_role
      and picklist_object = 'portal_users' and picklist_field = 'portal_role'
      and picklist_is_active = true
  ) then
    raise exception 'Invalid portal role' using errcode = 'P0001';
  end if;

  -- 5. ACCOUNT SCOPING (hard boundary): every selected property must belong to
  --    this contact's account. A single foreign property aborts the whole call.
  v_props := coalesce(p_property_ids, '{}');
  select count(*) into v_bad
  from unnest(v_props) as x(pid)
  where not exists (
    select 1 from public.properties p
    where p.id = x.pid
      and p.property_is_deleted = false
      and p.property_account_id = v_account
  );
  if v_bad > 0 then
    raise exception 'One or more selected properties do not belong to this account' using errcode = '42501';
  end if;

  -- 6. Create the PENDING portal user (no auth identity, no email sent here)
  insert into public.portal_users
    (record_type, full_name, email, status, portal_role,
     portal_user_account_id, created_by, updated_by)
  values
    ('Portal User', v_name, v_email, 'Portal User Pending', p_portal_role,
     v_account, v_caller, v_caller)
  returning id into v_portal_user_id;

  -- 7. Link the contact to the new portal user
  update public.contacts
     set contact_portal_user_id  = v_portal_user_id,
         contact_has_portal_access = true,
         contact_updated_by       = v_caller,
         contact_updated_at       = now()
   where id = p_contact_id;

  -- 8. Property grants (deduped)
  for v_pid in select distinct u from unnest(v_props) as u loop
    insert into public.portal_user_property_grants
      (pug_portal_user_id, pug_property_id, pug_owner, pug_created_by, pug_updated_by)
    values
      (v_portal_user_id, v_pid, v_caller, v_caller, v_caller);
    v_granted := v_granted + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'portal_user_id', v_portal_user_id,
    'email', v_email,
    'full_name', v_name,
    'account_id', v_account,
    'granted_count', v_granted,
    'status', 'Portal User Pending'
  );
end;
$function$;

-- ── portal_grants_set ────────────────────────────────────────────────────────
-- Reconcile a portal user's visible properties to EXACTLY p_property_ids.
-- Removed ones are soft-deleted, added ones inserted (or revived). Every id is
-- account-scoped to the portal user's bound account. Powers the toggle UI.
create or replace function public.portal_grants_set(
  p_portal_user_id uuid,
  p_property_ids   uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_caller  uuid;
  v_account uuid;
  v_exists  boolean;
  v_props   uuid[];
  v_bad     int;
  v_removed int := 0;
  v_active  int := 0;
  v_pid     uuid;
begin
  v_caller := current_app_user_id();
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not (public.app_user_can('portal_user_property_grants', 'create')
          and public.app_user_can('portal_user_property_grants', 'delete')) then
    raise exception 'You do not have permission to change property access' using errcode = '42501';
  end if;

  select pu.portal_user_account_id, true
    into v_account, v_exists
  from public.portal_users pu
  where pu.id = p_portal_user_id and pu.is_deleted = false;

  if v_exists is not true then
    raise exception 'Portal user not found' using errcode = 'P0002';
  end if;
  if v_account is null then
    raise exception 'This portal user is not bound to an account; its access cannot be managed safely' using errcode = 'P0001';
  end if;

  v_props := coalesce(p_property_ids, '{}');

  -- account scope
  select count(*) into v_bad
  from unnest(v_props) as x(pid)
  where not exists (
    select 1 from public.properties p
    where p.id = x.pid and p.property_is_deleted = false and p.property_account_id = v_account
  );
  if v_bad > 0 then
    raise exception 'One or more properties do not belong to this portal user''s account' using errcode = '42501';
  end if;

  -- soft-delete grants that are no longer selected
  update public.portal_user_property_grants g
     set pug_is_deleted = true, pug_deleted_at = now(), pug_deleted_by = v_caller,
         pug_updated_by = v_caller, pug_updated_at = now()
   where g.pug_portal_user_id = p_portal_user_id
     and g.pug_is_deleted = false
     and g.pug_property_id is not null
     and not (g.pug_property_id = any (v_props));
  get diagnostics v_removed = row_count;

  -- add / revive selected grants
  for v_pid in select distinct u from unnest(v_props) as u loop
    if exists (
      select 1 from public.portal_user_property_grants
      where pug_portal_user_id = p_portal_user_id and pug_property_id = v_pid and pug_is_deleted = false
    ) then
      continue;
    end if;
    update public.portal_user_property_grants
       set pug_is_deleted = false, pug_deleted_at = null, pug_deleted_by = null,
           pug_updated_by = v_caller, pug_updated_at = now()
     where pug_portal_user_id = p_portal_user_id and pug_property_id = v_pid and pug_is_deleted = true;
    if not found then
      insert into public.portal_user_property_grants
        (pug_portal_user_id, pug_property_id, pug_owner, pug_created_by, pug_updated_by)
      values
        (p_portal_user_id, v_pid, v_caller, v_caller, v_caller);
    end if;
  end loop;

  select count(*) into v_active
  from public.portal_user_property_grants
  where pug_portal_user_id = p_portal_user_id and pug_is_deleted = false and pug_property_id is not null;

  return jsonb_build_object('ok', true, 'portal_user_id', p_portal_user_id,
                            'removed', v_removed, 'active_count', v_active);
end;
$function$;

-- ── portal_revoke_access ─────────────────────────────────────────────────────
-- Soft-delete a portal user, all their grants, and unlink the contact.
create or replace function public.portal_revoke_access(
  p_portal_user_id uuid,
  p_reason         text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_caller uuid;
  v_exists boolean;
begin
  v_caller := current_app_user_id();
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.app_user_can('portal_users', 'delete') then
    raise exception 'You do not have permission to revoke portal access' using errcode = '42501';
  end if;

  select true into v_exists from public.portal_users
  where id = p_portal_user_id and is_deleted = false;
  if v_exists is not true then
    raise exception 'Portal user not found' using errcode = 'P0002';
  end if;

  update public.portal_user_property_grants
     set pug_is_deleted = true, pug_deleted_at = now(), pug_deleted_by = v_caller,
         pug_deletion_reason = coalesce(p_reason, 'Portal access revoked'),
         pug_updated_by = v_caller, pug_updated_at = now()
   where pug_portal_user_id = p_portal_user_id and pug_is_deleted = false;

  update public.contacts
     set contact_has_portal_access = false, contact_portal_user_id = null,
         contact_updated_by = v_caller, contact_updated_at = now()
   where contact_portal_user_id = p_portal_user_id;

  update public.portal_users
     set is_deleted = true, deleted_at = now(), deleted_by = v_caller,
         deletion_reason = coalesce(p_reason, 'Portal access revoked'),
         status = 'Portal User Deactivated', updated_by = v_caller
   where id = p_portal_user_id;

  return jsonb_build_object('ok', true, 'portal_user_id', p_portal_user_id);
end;
$function$;

-- ── get_portal_project_tracker — account-scope defense in depth + status gate ─
create or replace function public.get_portal_project_tracker()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
DECLARE
  v_portal_user_id uuid;
  v_account_id     uuid;
  v_result jsonb;
BEGIN
  SELECT pu.id, pu.portal_user_account_id
    INTO v_portal_user_id, v_account_id
  FROM portal_users pu
  WHERE pu.auth_user_id = auth.uid()
    AND pu.is_deleted = false
    AND pu.status NOT IN ('Portal User Suspended', 'Portal User Deactivated')
  LIMIT 1;

  IF v_portal_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_portal_user', 'properties', '[]'::jsonb);
  END IF;

  WITH granted_properties AS (
    SELECT DISTINCT g.pug_property_id AS property_id
    FROM portal_user_property_grants g
    JOIN properties p ON p.id = g.pug_property_id AND p.property_is_deleted = false
    WHERE g.pug_portal_user_id = v_portal_user_id AND g.pug_is_deleted = false
      AND g.pug_property_id IS NOT NULL
      AND (v_account_id IS NULL OR p.property_account_id = v_account_id)
  ),
  granted_buildings AS (
    SELECT DISTINCT g.pug_building_id AS building_id
    FROM portal_user_property_grants g
    JOIN buildings b ON b.id = g.pug_building_id AND b.building_is_deleted = false
    JOIN properties p ON p.id = b.property_id
    WHERE g.pug_portal_user_id = v_portal_user_id AND g.pug_is_deleted = false
      AND g.pug_building_id IS NOT NULL
      AND (v_account_id IS NULL OR p.property_account_id = v_account_id)
  ),
  rt_stages AS (
    SELECT a.pvrta_record_type_id AS record_type_id, sv.id AS stage_value_id, sv.picklist_label AS stage_label,
           (ROW_NUMBER() OVER (PARTITION BY a.pvrta_record_type_id
             ORDER BY COALESCE(a.pvrta_sort_order, sv.picklist_sort_order), sv.picklist_label))::int AS rank
    FROM picklist_value_record_type_assignments a
    JOIN picklist_values sv ON a.pvrta_picklist_value_id = sv.id
    WHERE a.pvrta_is_deleted = false AND sv.picklist_object = 'opportunities' AND sv.picklist_field = 'opportunity_stage'
  ),
  rt_stage_lists AS (
    SELECT record_type_id, jsonb_agg(jsonb_build_object('label', stage_label, 'sort_order', rank) ORDER BY rank) AS stages
    FROM rt_stages GROUP BY record_type_id
  ),
  scoped_opps AS (
    SELECT o.id, o.opportunity_record_number, o.opportunity_name, o.property_id, o.building_id,
           sv.picklist_label AS stage_label, COALESCE(cur.rank, 0) AS stage_order,
           COALESCE(rsl.stages, '[]'::jsonb) AS stages, rt.picklist_label AS program_label,
           rt.picklist_description AS record_type_description
    FROM opportunities o
    LEFT JOIN picklist_values sv ON o.opportunity_stage = sv.id
    LEFT JOIN picklist_values rt ON o.opportunity_record_type = rt.id
    LEFT JOIN rt_stages cur ON cur.record_type_id = o.opportunity_record_type AND cur.stage_value_id = o.opportunity_stage
    LEFT JOIN rt_stage_lists rsl ON rsl.record_type_id = o.opportunity_record_type
    WHERE o.opportunity_is_deleted = false AND o.building_id IS NOT NULL
      AND (o.property_id IN (SELECT property_id FROM granted_properties)
           OR o.building_id IN (SELECT building_id FROM granted_buildings))
  ),
  visible_buildings AS (
    SELECT b.id, b.building_name, b.building_record_number, b.building_address,
           b.building_total_units, b.building_number_of_units, b.property_id
    FROM buildings b
    WHERE b.building_is_deleted = false
      AND (b.property_id IN (SELECT property_id FROM granted_properties)
           OR b.id IN (SELECT building_id FROM granted_buildings))
  ),
  visible_properties AS (
    SELECT DISTINCT p.id, p.property_name, p.property_record_number, p.property_city, p.property_state,
           p.property_total_units, p.property_total_buildings
    FROM properties p
    WHERE p.property_is_deleted = false
      AND (p.id IN (SELECT property_id FROM granted_properties)
           OR p.id IN (SELECT property_id FROM visible_buildings))
  ),
  scoped_projects AS (
    SELECT pr.id, pr.opportunity_id, pr.building_id, pr.project_name,
           prt.picklist_label AS record_type, ps.picklist_label AS status_label
    FROM projects pr
    LEFT JOIN picklist_values prt ON pr.project_record_type = prt.id
    LEFT JOIN picklist_values ps ON pr.project_status = ps.id
    WHERE pr.project_is_deleted IS NOT TRUE
      AND pr.building_id IN (SELECT id FROM visible_buildings)
  ),
  scoped_work_orders AS (
    SELECT wo.id, wo.project_id, wo.unit_id, wo.work_order_name,
           wrt.picklist_label AS record_type, ws.picklist_label AS status_label, u.unit_number
    FROM work_orders wo
    LEFT JOIN picklist_values wrt ON wo.work_order_record_type = wrt.id
    LEFT JOIN picklist_values ws ON wo.work_order_status = ws.id
    LEFT JOIN units u ON wo.unit_id = u.id
    WHERE wo.work_order_is_deleted IS NOT TRUE
      AND wo.project_id IN (SELECT id FROM scoped_projects)
  ),
  scoped_work_steps AS (
    SELECT wst.id, wst.work_order_id, wst.work_step_name, wst.work_step_execution_order AS ord,
           wsv.picklist_label AS status_label, wst.work_step_reference_photo_url AS photo_url
    FROM work_steps wst
    LEFT JOIN picklist_values wsv ON wst.work_step_status = wsv.id
    WHERE wst.work_step_is_deleted IS NOT TRUE
      AND wst.work_order_id IN (SELECT id FROM scoped_work_orders)
  ),
  scoped_photos AS (
    SELECT p.work_step_id,
      jsonb_agg(jsonb_build_object(
        'id', p.id, 'url', p.file_url, 'thumb', p.thumbnail_url,
        'caption', p.caption, 'type', p.photo_type
      ) ORDER BY p.photo_type, p.created_at) AS photos
    FROM photos p
    WHERE p.is_deleted IS NOT TRUE
      AND p.work_step_id IN (SELECT id FROM scoped_work_steps)
    GROUP BY p.work_step_id
  ),
  step_json AS (
    SELECT sws.work_order_id, sws.ord,
      jsonb_build_object(
        'id', sws.id, 'name', sws.work_step_name, 'status', sws.status_label, 'order', sws.ord,
        'photo_url', sws.photo_url, 'photos', COALESCE(sp.photos, '[]'::jsonb)
      ) AS obj
    FROM scoped_work_steps sws
    LEFT JOIN scoped_photos sp ON sp.work_step_id = sws.id
  ),
  ws_by_wo AS (
    SELECT work_order_id, jsonb_agg(obj ORDER BY ord) AS steps
    FROM step_json GROUP BY work_order_id
  ),
  wo_by_project AS (
    SELECT swo.project_id,
      jsonb_agg(jsonb_build_object(
        'id', swo.id, 'name', swo.work_order_name, 'record_type', swo.record_type,
        'status', swo.status_label, 'unit_id', swo.unit_id, 'unit_number', swo.unit_number,
        'work_steps', COALESCE(wsb.steps, '[]'::jsonb)
      ) ORDER BY swo.unit_number, swo.record_type) AS wos
    FROM scoped_work_orders swo
    LEFT JOIN ws_by_wo wsb ON wsb.work_order_id = swo.id
    GROUP BY swo.project_id
  ),
  projects_by_opp AS (
    SELECT sp.opportunity_id,
      jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.project_name, 'record_type', sp.record_type,
        'status', sp.status_label, 'work_orders', COALESCE(wp.wos, '[]'::jsonb)
      ) ORDER BY sp.record_type, sp.project_name) AS projects
    FROM scoped_projects sp
    LEFT JOIN wo_by_project wp ON wp.project_id = sp.id
    GROUP BY sp.opportunity_id
  ),
  opps_by_building AS (
    SELECT so.building_id,
      jsonb_agg(jsonb_build_object(
        'id', so.id, 'record_number', so.opportunity_record_number, 'name', so.opportunity_name,
        'program', so.program_label, 'record_type_description', so.record_type_description,
        'stage_label', so.stage_label, 'stage_order', so.stage_order,
        'stages', so.stages, 'projects', COALESCE(pbo.projects, '[]'::jsonb)
      ) ORDER BY so.program_label, so.opportunity_name) AS opps
    FROM scoped_opps so
    LEFT JOIN projects_by_opp pbo ON pbo.opportunity_id = so.id
    GROUP BY so.building_id
  ),
  buildings_by_property AS (
    SELECT vb.property_id,
      jsonb_agg(jsonb_build_object(
        'id', vb.id, 'name', vb.building_name, 'record_number', vb.building_record_number,
        'address', vb.building_address,
        'total_units', COALESCE(vb.building_total_units, vb.building_number_of_units),
        'unit_count', (SELECT count(*) FROM units u WHERE u.building_id = vb.id AND u.unit_is_deleted IS NOT TRUE),
        'opportunities', COALESCE(ob.opps, '[]'::jsonb)
      ) ORDER BY vb.building_name) AS buildings
    FROM visible_buildings vb
    LEFT JOIN opps_by_building ob ON ob.building_id = vb.id
    GROUP BY vb.property_id
  )
  SELECT jsonb_build_object(
    'portal_user_id', v_portal_user_id,
    'properties', COALESCE(jsonb_agg(jsonb_build_object(
      'id', vp.id, 'name', vp.property_name, 'record_number', vp.property_record_number,
      'city', vp.property_city, 'state', vp.property_state,
      'total_units', vp.property_total_units, 'total_buildings', vp.property_total_buildings,
      'buildings', COALESCE(bp.buildings, '[]'::jsonb)
    ) ORDER BY vp.property_name), '[]'::jsonb)
  ) INTO v_result
  FROM visible_properties vp
  LEFT JOIN buildings_by_property bp ON bp.property_id = vp.id;

  RETURN v_result;
END;
$function$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on function public.portal_invite_create(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.portal_grants_set(uuid, uuid[])          from public, anon;
revoke all on function public.portal_revoke_access(uuid, text)         from public, anon;
grant execute on function public.portal_invite_create(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.portal_grants_set(uuid, uuid[])          to authenticated;
grant execute on function public.portal_revoke_access(uuid, text)         to authenticated;
grant execute on function public.app_user_can(text, text)                 to authenticated;

notify pgrst, 'reload schema';
