-- =============================================================================
-- North Carolina Energy Savers — Site Visit self-scheduling
--
-- Configures the existing (Wisconsin-built) customer self-scheduling engine to
-- work for North Carolina, and adds the two engine-support columns the routing
-- rewrite needs:
--
--   1. Per-territory timezone + per-territory max one-way drive cap.
--   2. Per-resource home base (lat/lng) on contacts — the origin point for
--      optimized routing. First stop of a resource's day is measured from here;
--      subsequent stops are measured from the previous appointment.
--   3. Fix technicians_in_territory (matched 'Technician' capitalized; the
--      stored picklist value is lowercase 'technician', so the function
--      returned nobody for every territory).
--   4. Generic 'North Carolina Energy Auditor' field resource (technician
--      record type) parented to an internal account, homed in Huntersville NC,
--      and made a member of the North Carolina service territory (ST-00002).
--   5. Purpose-built work type 'North Carolina Energy Savers - Site Visit'
--      with its own public booking slug.
--   6. North Carolina operating hours tightened to Mon–Fri 08:00–16:00 start
--      window; Saturday closed.
--   7. North Carolina ZIP → territory rows (Charlotte metro / Piedmont) so both
--      compute-availability and the create_service_appointment cascade resolve
--      the territory. Statewide ZIP coverage / live geocoding is a follow-up.
--
-- Additive and idempotent. Nothing existing is removed.
-- =============================================================================

-- ── 1. Per-territory timezone + max one-way drive ───────────────────────────
ALTER TABLE public.service_territories
  ADD COLUMN IF NOT EXISTS service_territory_timezone text,
  ADD COLUMN IF NOT EXISTS service_territory_max_one_way_drive_minutes integer;

COMMENT ON COLUMN public.service_territories.service_territory_timezone IS
  'IANA timezone for slot generation + customer-facing slot display in this territory.';
COMMENT ON COLUMN public.service_territories.service_territory_max_one_way_drive_minutes IS
  'A candidate slot is rejected if the drive to it (from home base or the previous appointment) exceeds this.';

UPDATE public.service_territories
   SET service_territory_timezone = CASE upper(service_territory_state)
         WHEN 'NC' THEN 'America/New_York'
         WHEN 'WI' THEN 'America/Chicago'
         WHEN 'CO' THEN 'America/Denver'
         WHEN 'MI' THEN 'America/Detroit'
         WHEN 'IN' THEN 'America/Indiana/Indianapolis'
         ELSE 'America/Chicago'
       END
 WHERE service_territory_timezone IS NULL;

UPDATE public.service_territories
   SET service_territory_max_one_way_drive_minutes = 120
 WHERE id = '007ebf5c-1673-4848-807b-5839fa59f540'
   AND service_territory_max_one_way_drive_minutes IS NULL;

-- ── 2. Per-resource home base on contacts ───────────────────────────────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS contact_home_base_street    text,
  ADD COLUMN IF NOT EXISTS contact_home_base_city      text,
  ADD COLUMN IF NOT EXISTS contact_home_base_state     text,
  ADD COLUMN IF NOT EXISTS contact_home_base_zip       text,
  ADD COLUMN IF NOT EXISTS contact_home_base_latitude  numeric,
  ADD COLUMN IF NOT EXISTS contact_home_base_longitude numeric;

COMMENT ON COLUMN public.contacts.contact_home_base_latitude IS
  'Starting point for optimized routing — the resource''s home/office. The first stop of the day is measured from here.';

-- ── 3. Fix technicians_in_territory case mismatch ───────────────────────────
-- The stored contacts.record_type picklist value is lowercase 'technician'
-- (label 'Technician'); the original matched the capitalized string and so
-- returned zero rows for every territory. Match case-insensitively.
CREATE OR REPLACE FUNCTION public.technicians_in_territory(p_territory_id uuid)
 RETURNS TABLE(contact_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT DISTINCT c.id AS contact_id
  FROM contacts c
  JOIN picklist_values pv ON pv.id = c.contact_record_type
                          AND pv.picklist_object = 'contacts'
                          AND pv.picklist_field  = 'record_type'
                          AND lower(pv.picklist_value) = 'technician'
  WHERE c.contact_is_deleted = false
    AND COALESCE(c.contact_inactive, false) = false
    AND (
      c.contact_service_territory_id = p_territory_id
      OR EXISTS (
        SELECT 1 FROM service_territory_members stm
        WHERE stm.contact_id = c.id
          AND stm.service_territory_id = p_territory_id
          AND stm.stm_is_deleted = false
      )
    );
$function$;

-- ── 4–5. Internal account, NC auditor resource, territory membership,
--         purpose-built work type ─────────────────────────────────────────────
DO $$
DECLARE
  v_admin        uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';  -- platform admin user
  v_nc_territory uuid := '007ebf5c-1673-4848-807b-5839fa59f540';  -- ST-00002 North Carolina
  v_tech_rt      uuid := 'c040ba82-76ac-4025-a04d-9dd8d540b6a0';  -- contacts.record_type = technician
  v_account      uuid;
  v_contact      uuid;
  v_work_type    uuid;
BEGIN
  -- Internal account to parent field-resource contacts (contact_account_id is NOT NULL).
  SELECT id INTO v_account FROM accounts
    WHERE account_name = 'Energy Efficiency Services — Field Resources'
      AND COALESCE(account_is_deleted, false) = false
    LIMIT 1;
  IF v_account IS NULL THEN
    INSERT INTO accounts (account_record_number, account_name, account_owner, account_created_by,
                          account_created_at, account_updated_by, account_updated_at)
    VALUES ('', 'Energy Efficiency Services — Field Resources', v_admin, v_admin, now(), v_admin, now())
    RETURNING id INTO v_account;
  END IF;

  -- Generic North Carolina Energy Auditor resource, homed in Huntersville NC.
  SELECT id INTO v_contact FROM contacts
    WHERE contact_name = 'North Carolina Energy Auditor'
      AND COALESCE(contact_is_deleted, false) = false
    LIMIT 1;
  IF v_contact IS NULL THEN
    INSERT INTO contacts (contact_record_number, contact_name, contact_first_name, contact_last_name,
                          contact_account_id, contact_record_type, contact_service_territory_id,
                          contact_owner, contact_created_by, contact_created_at, contact_updated_by, contact_updated_at,
                          contact_home_base_street, contact_home_base_city, contact_home_base_state,
                          contact_home_base_zip, contact_home_base_latitude, contact_home_base_longitude)
    VALUES ('', 'North Carolina Energy Auditor', 'North Carolina', 'Energy Auditor',
            v_account, v_tech_rt, v_nc_territory,
            v_admin, v_admin, now(), v_admin, now(),
            'Downtown Huntersville', 'Huntersville', 'NC', '28078', 35.4107, -80.8428)
    RETURNING id INTO v_contact;
  END IF;

  -- North Carolina service territory membership (primary).
  IF NOT EXISTS (
    SELECT 1 FROM service_territory_members
    WHERE contact_id = v_contact AND service_territory_id = v_nc_territory AND stm_is_deleted = false
  ) THEN
    INSERT INTO service_territory_members (stm_record_number, service_territory_id, contact_id, stm_is_primary,
                                           stm_owner, stm_created_by, stm_created_at, stm_updated_by, stm_updated_at)
    VALUES ('', v_nc_territory, v_contact, true, v_admin, v_admin, now(), v_admin, now());
  END IF;

  -- Purpose-built NC Energy Savers site-visit work type + public booking slug.
  SELECT id INTO v_work_type FROM work_types
    WHERE work_type_public_slug = 'nc-energy-savers-site-visit'
      AND work_type_is_deleted = false
    LIMIT 1;
  IF v_work_type IS NULL THEN
    INSERT INTO work_types (work_type_record_number, work_type_name, work_type_owner, work_type_created_by,
                            work_type_updated_by, work_type_created_at, work_type_updated_at,
                            work_type_description, work_type_is_active, work_type_duration_minutes,
                            work_type_is_publicly_schedulable, work_type_public_slug, work_type_customer_facing_description)
    VALUES ('', 'North Carolina Energy Savers - Site Visit', v_admin, v_admin, v_admin, now(), now(),
            'Customer-scheduled home energy site walk for the North Carolina Energy Saver program. Booked online by pre-qualified homeowners; single NC Energy Auditor with drive-time-optimized availability.',
            true, 60, true, 'nc-energy-savers-site-visit',
            'A home energy walk-through — we''ll look at insulation levels, HVAC systems, and other areas that impact your energy use. Most visits take 30–45 minutes.')
    RETURNING id INTO v_work_type;
  END IF;
END $$;

-- ── 6. North Carolina operating hours: Mon–Fri 08:00–16:00, Saturday closed ──
UPDATE public.operating_hours
   SET oh_first_slot_start_time = '08:00',
       oh_last_slot_start_time  = '16:00',
       oh_is_closed             = false,
       oh_updated_at            = now()
 WHERE service_territory_id = '007ebf5c-1673-4848-807b-5839fa59f540'
   AND oh_day_of_week BETWEEN 1 AND 5
   AND oh_is_deleted = false;

UPDATE public.operating_hours
   SET oh_is_closed  = true,
       oh_updated_at = now()
 WHERE service_territory_id = '007ebf5c-1673-4848-807b-5839fa59f540'
   AND oh_day_of_week = 6
   AND oh_is_deleted = false;

-- ── 7. North Carolina ZIP → territory (Charlotte metro / Piedmont) ──────────
INSERT INTO public.service_territory_zips (stz_record_number, service_territory_id, stz_zip_code,
                                           stz_owner, stz_created_by, stz_created_at, stz_updated_by, stz_updated_at)
SELECT '', '007ebf5c-1673-4848-807b-5839fa59f540', v.z,
       'c5a01ec8-960f-42ab-8a9e-a49822de89af', 'c5a01ec8-960f-42ab-8a9e-a49822de89af', now(),
       'c5a01ec8-960f-42ab-8a9e-a49822de89af', now()
FROM (VALUES
  -- Charlotte
  ('28202'),('28203'),('28204'),('28205'),('28206'),('28207'),('28208'),('28209'),('28210'),('28211'),
  ('28212'),('28213'),('28214'),('28215'),('28216'),('28217'),('28226'),('28227'),('28262'),('28269'),
  ('28270'),('28273'),('28277'),('28278'),
  -- North Mecklenburg / Lake Norman
  ('28078'),('28031'),('28036'),('28037'),
  -- Iredell (Mooresville / Statesville)
  ('28115'),('28117'),('28625'),('28677'),
  -- Cabarrus (Concord / Kannapolis / Harrisburg / Midland)
  ('28025'),('28027'),('28081'),('28083'),('28075'),('28107'),
  -- Union (Matthews / Monroe / Indian Trail / Waxhaw)
  ('28104'),('28105'),('28110'),('28112'),('28079'),('28173'),('28134'),
  -- Gaston / Lincoln (Gastonia / Belmont / Mount Holly / Denver / Lincolnton)
  ('28052'),('28054'),('28056'),('28012'),('28120'),('28092'),
  -- Rowan (Salisbury)
  ('28144'),('28146')
) AS v(z)
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_territory_zips s
  WHERE s.stz_zip_code = v.z AND s.stz_is_deleted = false
);
