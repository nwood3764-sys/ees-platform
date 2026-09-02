-- A new service appointment is Scheduled.
--
-- Nicholas, 2026-09-02: "populate all the fields you can." Status came out
-- blank on a hand-created appointment, so the record could not say what it was
-- — and the create modal deliberately does not ask, because a status with a
-- sensible first stage is a question the platform can answer itself.
--
-- A column DEFAULT, which is the pattern envelopes.env_status already uses
-- (Draft). It applies ONLY when the column is not supplied, so every existing
-- path that sets a status — create_service_appointment, the scheduler, the
-- notification lifecycle — is untouched.
--
-- The id is looked up rather than hardcoded: a literal uuid in a migration is
-- wrong on any database whose picklist rows were seeded separately.
DO $do$
DECLARE
  v_scheduled uuid;
BEGIN
  SELECT id INTO v_scheduled
  FROM public.picklist_values
  WHERE picklist_object = 'service_appointments'
    AND picklist_field  = 'sa_status'
    AND picklist_value  = 'Scheduled'
    AND picklist_is_active
  LIMIT 1;

  IF v_scheduled IS NULL THEN
    RAISE EXCEPTION 'No active "Scheduled" value on service_appointments.sa_status';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.service_appointments ALTER COLUMN sa_status SET DEFAULT %L::uuid',
    v_scheduled);
END
$do$;

-- Prove the default resolves to the stage we meant, rather than trusting the
-- ALTER. (The uuid is matched out of the stored expression by shape — stripping
-- non-hex characters instead swallows the "d" from "::uuid".)
DO $do$
DECLARE
  v_default_status text;
BEGIN
  SELECT pv.picklist_value INTO v_default_status
  FROM pg_attrdef ad
  JOIN pg_class c ON c.oid = ad.adrelid
  JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
  JOIN public.picklist_values pv
    ON pv.id = (substring(pg_get_expr(ad.adbin, ad.adrelid)
                  from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))::uuid
  WHERE c.relname = 'service_appointments' AND a.attname = 'sa_status';

  IF v_default_status IS DISTINCT FROM 'Scheduled' THEN
    RAISE EXCEPTION 'sa_status default resolved to %, expected Scheduled', v_default_status;
  END IF;
END
$do$;
