-- Mirror the enrollment's Installation Building sourcing on incentive applications:
--   * ia_signer_contact_id — the building/installation contact, same as the
--     enrollment's signer contact. Populated from the opportunity's authorized
--     signer (opportunity_authorized_signer_id), which for these HUD owners is
--     the primary contact (e.g. Dennis Hanson). Backfilled for existing rows and
--     auto-set on insert so Contact Name / Email / Phone resolve like the form.
--   * ia_occupied_units — Total Number of Occupied Units is an editable field on
--     the enrollment (property_ph_total_occupied is not populated), so mirror it
--     as an editable integer here.

ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_signer_contact_id uuid,
  ADD COLUMN IF NOT EXISTS ia_occupied_units    integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='incentive_applications_signer_contact_id_fkey') THEN
    ALTER TABLE public.incentive_applications ADD CONSTRAINT incentive_applications_signer_contact_id_fkey
      FOREIGN KEY (ia_signer_contact_id) REFERENCES public.contacts(id);
  END IF;
END $$;

-- Backfill existing incentive applications from their opportunity's signer.
UPDATE public.incentive_applications ia
SET ia_signer_contact_id = o.opportunity_authorized_signer_id
FROM public.opportunities o
WHERE o.id = ia.opportunity_id
  AND ia.ia_signer_contact_id IS NULL
  AND o.opportunity_authorized_signer_id IS NOT NULL;

-- Extend the autoname trigger to also default the signer contact on insert.
CREATE OR REPLACE FUNCTION public.incentive_application_autoname()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_base text;
  v_rt   text;
  v_prog text;
BEGIN
  SELECT pv.picklist_label INTO v_rt
  FROM public.picklist_values pv
  WHERE pv.id = NEW.ia_record_type;

  IF nullif(btrim(coalesce(NEW.ia_name, '')), '') IS NULL THEN
    SELECT coalesce(o.opportunity_name, p.property_name, b.building_name)
      INTO v_base
    FROM (SELECT 1) z
    LEFT JOIN public.opportunities o ON o.id = NEW.opportunity_id
    LEFT JOIN public.properties    p ON p.id = NEW.property_id
    LEFT JOIN public.buildings     b ON b.id = NEW.building_id;
    NEW.ia_name := nullif(btrim(concat_ws(' - ', nullif(v_base, ''), nullif(v_rt, ''))), '');
    IF NEW.ia_name IS NULL THEN NEW.ia_name := 'Incentive Application'; END IF;
  END IF;

  IF nullif(btrim(coalesce(NEW.ia_program_name, '')), '') IS NULL THEN
    SELECT pr.name INTO v_prog FROM public.programs pr WHERE pr.id = NEW.program_id;
    NEW.ia_program_name := coalesce(nullif(btrim(coalesce(v_prog, '')), ''), v_rt);
  END IF;

  -- Default the installation/signer contact from the opportunity's signer.
  IF NEW.ia_signer_contact_id IS NULL AND NEW.opportunity_id IS NOT NULL THEN
    SELECT o.opportunity_authorized_signer_id INTO NEW.ia_signer_contact_id
    FROM public.opportunities o WHERE o.id = NEW.opportunity_id;
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
