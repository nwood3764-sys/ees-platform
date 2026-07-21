-- =============================================================================
-- Photo "Include in final project report" flag
--
-- An internal, manually-set marker on a photo indicating it should be pulled
-- into the final project report. It is NOT rendered on the watermark (the
-- process-photo pipeline never reads it) and is purely a curation flag: a user
-- reviews a work order's photos and clicks to include the ones that matter.
--
-- Audit: who marked it and when are stamped on set, cleared on unset.
-- =============================================================================

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS include_in_final_report boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_inclusion_marked_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS report_inclusion_marked_at timestamptz;

COMMENT ON COLUMN public.photos.include_in_final_report IS
  'Internal curation flag — when true the photo is included in the final project report. Never rendered on the watermark; set manually by internal staff.';

-- Toggle RPC: sets the flag and stamps/clears the audit fields. SECURITY
-- DEFINER so the write succeeds for any authenticated internal user without a
-- per-column update policy; anon/public are revoked. Returns the new value.
CREATE OR REPLACE FUNCTION public.set_photo_report_inclusion(p_photo_id uuid, p_include boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user uuid := current_app_user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.photos
     SET include_in_final_report    = COALESCE(p_include, false),
         report_inclusion_marked_by = CASE WHEN p_include THEN v_user ELSE NULL END,
         report_inclusion_marked_at = CASE WHEN p_include THEN now()  ELSE NULL END
   WHERE id = p_photo_id
     AND is_deleted IS NOT TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo not found: %', p_photo_id;
  END IF;
  RETURN COALESCE(p_include, false);
END
$function$;

REVOKE ALL ON FUNCTION public.set_photo_report_inclusion(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_photo_report_inclusion(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_photo_report_inclusion(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_photo_report_inclusion(uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
