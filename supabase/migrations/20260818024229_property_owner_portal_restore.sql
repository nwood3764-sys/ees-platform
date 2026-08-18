-- =============================================================================
-- Property Owner Portal — restore the three things that keep it from working
-- at all in production.
--
-- The portal (standalone surface at /project-portal) was built 2026-06-29 →
-- 07-01 and has never had a single property-owner user log in. Three separate
-- defects, each sufficient on its own to make it unusable, were found on
-- 2026-08-18:
--
--   1. NO SELF-SELECT RLS ON portal_users. The portal's fetchPortalUserSelf()
--      is a direct, RLS-bound SELECT. portal_users carries only the internal
--      staff policies (app_user_can(...)), which evaluate against public.users
--      — and a portal user has no public.users row. So the SELECT returned
--      nothing and the portal bounced straight back to its own login screen,
--      forever. The fix was written on 2026-06-29 but the migration was never
--      applied to prod (it is absent from the registry). Re-issued here.
--      Note portal_user_property_grants already carries its equivalent
--      (portal_user_own_grants_select) — only portal_users was missed.
--
--   2. get_portal_calendar() DOES NOT EXIST in prod. The three migrations that
--      built it were likewise never applied, so the portal's Calendar tab has
--      always called a function that isn't there. The client try/catches the
--      failure, so it renders as an empty calendar rather than an error — which
--      is why this went unnoticed. Recreated here, with two corrections:
--        • the status gate is brought onto the current vocabulary (see 3);
--        • account scoping matches get_portal_project_tracker's hardening, so
--          both portal reads scope identically instead of the calendar being
--          one guard looser than the tracker.
--      anon is NOT granted EXECUTE (a portal user is always authenticated);
--      the same anon grant is revoked from get_portal_project_tracker so the
--      two match get_provider_portal_data, the newest of the three.
--
--   3. RECORD TYPE THAT DOES NOT EXIST. portal_invite_create() has always
--      written record_type = 'Portal User', but the only value ever seeded for
--      portal_users.record_type is 'Provider User'. Every property-owner portal
--      user would have been created carrying an unmodeled record type. Adds the
--      purpose-named 'Property Owner User' record type — its own value, paired
--      with but never shared with 'Provider User' — and points the RPC at it.
--      No backfill: zero rows carry 'Portal User' (the only portal_users row in
--      the platform today is the Provider User).
--
-- Additive throughout. No data moves.
-- =============================================================================

-- ─── 1. A portal user may read their own portal_users row ────────────────────
-- Narrow and additive: permissive policies are OR-ed, so internal staff access
-- is unchanged, and this exposes only the caller's own row. The project tracker
-- itself stays behind the SECURITY DEFINER RPC.

DROP POLICY IF EXISTS portal_user_self_select ON public.portal_users;

CREATE POLICY portal_user_self_select ON public.portal_users
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid() AND is_deleted = false);


-- ─── 2. The portal calendar read ─────────────────────────────────────────────
-- Service appointments (site visits) on the work orders under the properties
-- and buildings this portal user has been explicitly granted.

CREATE OR REPLACE FUNCTION public.get_portal_calendar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    RETURN jsonb_build_object('error', 'no_portal_user', 'appointments', '[]'::jsonb);
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
  visits AS (
    SELECT sa.id,
           COALESCE(sa.sa_subject, sa.sa_name) AS subject,
           st.picklist_label AS status,
           sa.sa_scheduled_start_time AS start_ts,
           sa.sa_scheduled_end_time AS end_ts,
           p.id AS property_id, p.property_name,
           NULLIF(trim(BOTH ', ' FROM concat_ws(', ',
             p.property_street,
             p.property_city,
             nullif(concat_ws(' ', p.property_state, p.property_zip), ''))), '') AS property_address,
           b.id AS building_id, b.building_name, b.building_address,
           u.id AS unit_id, u.unit_number,
           wrt.picklist_label AS work_order_type
    FROM service_appointments sa
    JOIN work_orders wo ON sa.work_order_id = wo.id AND wo.work_order_is_deleted IS NOT TRUE
    LEFT JOIN properties p ON wo.property_id = p.id
    LEFT JOIN buildings b ON wo.building_id = b.id
    LEFT JOIN units u ON wo.unit_id = u.id
    LEFT JOIN picklist_values st ON sa.sa_status = st.id
    LEFT JOIN picklist_values wrt ON wo.work_order_record_type = wrt.id
    WHERE sa.sa_is_deleted IS NOT TRUE
      AND sa.sa_scheduled_start_time IS NOT NULL
      AND (wo.property_id IN (SELECT property_id FROM granted_properties)
           OR wo.building_id IN (SELECT building_id FROM granted_buildings))
  )
  SELECT jsonb_build_object('appointments', COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'status', status,
    'start', start_ts, 'end', end_ts,
    'property_id', property_id, 'property_name', property_name, 'property_address', property_address,
    'building_id', building_id, 'building_name', building_name, 'building_address', building_address,
    'unit_id', unit_id, 'unit_number', unit_number, 'work_order_type', work_order_type
  ) ORDER BY start_ts), '[]'::jsonb)) INTO v_result
  FROM visits;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_portal_calendar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_calendar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_calendar() TO service_role;
-- Default privileges in this project grant EXECUTE to anon on newly created
-- public functions, so REVOKE ... FROM PUBLIC alone does not cover it.
REVOKE EXECUTE ON FUNCTION public.get_portal_calendar() FROM anon;

-- Both portal reads now match get_provider_portal_data: authenticated only.
REVOKE EXECUTE ON FUNCTION public.get_portal_project_tracker() FROM anon;


-- ─── 3. The Property Owner User record type ──────────────────────────────────
-- Its own record type, paired with but never sharing anything with the
-- Provider User record type. 'Provider User' remains the default.

INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_show_in_path,
   picklist_is_default_record_type, picklist_description)
SELECT
  'portal_users', 'record_type', 'Property Owner User', 'Property Owner User',
  true, 10, true, false,
  'External user of the Property Owner Portal — a property owner, property manager, or their staff, scoped to explicitly granted properties.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values
  WHERE picklist_object = 'portal_users' AND picklist_field = 'record_type'
    AND picklist_value = 'Property Owner User'
);

-- Point the invite RPC at it. Byte-for-byte the shipped function except for the
-- record_type literal on the INSERT.
CREATE OR REPLACE FUNCTION public.portal_invite_create(p_contact_id uuid, p_portal_role uuid, p_property_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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

  if v_existing_pu is not null
     and exists (select 1 from public.portal_users pu where pu.id = v_existing_pu and pu.is_deleted = false) then
    raise exception 'This contact already has a portal user. Use Manage Portal Access to change it.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.picklist_values
    where id = p_portal_role
      and picklist_object = 'portal_users' and picklist_field = 'portal_role'
      and picklist_is_active = true
  ) then
    raise exception 'Invalid portal role' using errcode = 'P0001';
  end if;

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

  insert into public.portal_users
    (record_type, full_name, email, status, portal_role,
     portal_user_account_id, created_by, updated_by)
  values
    ('Property Owner User', v_name, v_email, 'Portal User Pending', p_portal_role,
     v_account, v_caller, v_caller)
  returning id into v_portal_user_id;

  update public.contacts
     set contact_portal_user_id  = v_portal_user_id,
         contact_has_portal_access = true,
         contact_updated_by       = v_caller,
         contact_updated_at       = now()
   where id = p_contact_id;

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

REVOKE ALL ON FUNCTION public.portal_invite_create(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_invite_create(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_invite_create(uuid, uuid, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
