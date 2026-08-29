-- =============================================================================
-- A record type the platform assigns is not a record type a person picks.
--
-- Nicholas, 2026-08-29: "why in the world do we have field operations as a
-- record type? I thought we got rid of all this stuff."
--
-- FIELD-OPERATIONS is not a program, and it cannot be retired. It is:
--   • the platform's nationwide default opportunity record type
--     (picklist_is_default_record_type). That flag was deliberately moved to it
--     on 2026-08-23 precisely BECAUSE it is nationwide — enforce_rt__opportunities
--     stamps the default on any opportunity inserted without one, and while a
--     Wisconsin program held the flag the public scheduler was silently stamping
--     FOE-2024-WI on North Carolina properties (OPP-00132/133/134/135/140).
--   • the anchor LEAP Pad hangs ad-hoc technician work off:
--     create_technician_work_order_for_property resolves it BY NAME to find or
--     create the property's Field Operations opportunity.
-- Deactivating it would put both of those back.
--
-- So the fix is not to remove it — it is to stop OFFERING it. This adds the
-- general artifact for that: a record type flagged system-assigned is still
-- fully live for automation and for every record already carrying it, and is
-- simply never listed in a manual record-type picker. FIELD-OPERATIONS is its
-- first member; nothing else on the platform is flagged.
-- =============================================================================

ALTER TABLE public.picklist_values
  ADD COLUMN IF NOT EXISTS picklist_is_system_assigned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.picklist_values.picklist_is_system_assigned IS
  'Record type assigned by the platform, never offered in a manual record-type '
  'picker. The value stays active and enforceable — this governs what is listed '
  'to a user, not what may be saved.';

UPDATE public.picklist_values
   SET picklist_is_system_assigned = true
 WHERE picklist_object = 'opportunities'
   AND picklist_field  = 'record_type'
   AND picklist_value  = 'FIELD-OPERATIONS'
   AND picklist_is_system_assigned = false;

-- The picker reads eligibility through this RPC as well, so it has to be able
-- to see the flag. Return-type change, so DROP/CREATE, then re-grant and
-- reload PostgREST's schema cache (the 2026-07 rule).
DROP FUNCTION IF EXISTS public.eligible_record_types_for_parent(text, uuid, text);

CREATE FUNCTION public.eligible_record_types_for_parent(
  p_parent_object text, p_parent_record_type uuid, p_child_object text)
RETURNS TABLE(
  id uuid, picklist_value text, picklist_label text, picklist_state text,
  picklist_sort_order integer, picklist_is_system_assigned boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT pv.id, pv.picklist_value, pv.picklist_label, pv.picklist_state,
         pv.picklist_sort_order, pv.picklist_is_system_assigned
    FROM public.picklist_values pv
   WHERE pv.picklist_object = p_child_object
     AND pv.picklist_field  = 'record_type'
     AND pv.picklist_is_active
     AND (
       NOT EXISTS (
         SELECT 1 FROM public.record_type_eligibility e
          WHERE e.rte_parent_object      = p_parent_object
            AND e.rte_parent_record_type_id = p_parent_record_type
            AND e.rte_child_object       = p_child_object
            AND e.rte_is_active AND NOT e.rte_is_deleted
       )
       OR EXISTS (
         SELECT 1 FROM public.record_type_eligibility e
          WHERE e.rte_parent_object      = p_parent_object
            AND e.rte_parent_record_type_id = p_parent_record_type
            AND e.rte_child_object       = p_child_object
            AND e.rte_child_record_type_id = pv.id
            AND e.rte_is_active AND NOT e.rte_is_deleted
       )
     )
   ORDER BY pv.picklist_label;
$function$;

REVOKE ALL ON FUNCTION public.eligible_record_types_for_parent(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eligible_record_types_for_parent(text, uuid, text) TO authenticated, service_role;

DO $assert$
DECLARE
  v_flagged int;
  v_ok      boolean;
BEGIN
  SELECT count(*) INTO v_flagged
    FROM public.picklist_values WHERE picklist_is_system_assigned;
  IF v_flagged <> 1 THEN
    RAISE EXCEPTION 'expected exactly one system-assigned record type, found %', v_flagged;
  END IF;

  -- It must remain ACTIVE and remain the platform default. Hiding it from the
  -- picker while quietly deactivating it would hand the default back to a
  -- state-specific program, which is the 2026-08-23 defect.
  SELECT picklist_is_active AND picklist_is_default_record_type INTO v_ok
    FROM public.picklist_values
   WHERE picklist_object = 'opportunities' AND picklist_field = 'record_type'
     AND picklist_value  = 'FIELD-OPERATIONS';
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FIELD-OPERATIONS must stay active and stay the platform default record type';
  END IF;
END
$assert$;

NOTIFY pgrst, 'reload schema';
