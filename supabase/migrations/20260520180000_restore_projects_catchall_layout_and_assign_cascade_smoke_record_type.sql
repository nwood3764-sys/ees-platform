-- =====================================================================
-- Restore projects' catch-all default layout + assign record type to
-- the Cascade Smoke project that surfaced the bug.
--
-- Symptom: opening Cascade Smoke project rendered "This record can't be
-- displayed right now. The default page layout for this object is missing."
--
-- Root cause:
--   1. projects.id=3049c72a-34ab-43ff-8890-6b5e118d2562 has
--      project_record_type=NULL (never assigned at seed time).
--   2. The only record_type_id=NULL layout for projects was soft-deleted
--      (page_layouts.id=4b0bcfb8-d426-46c5-be6c-f4aac783cd19).
--   So the resolver had no record-type-matched layout AND no catch-all.
--
-- Fix:
--   (a) Restore the catch-all layout — its sections (3) and widgets (5)
--       were never soft-deleted, so the layout is whole on un-deletion.
--   (b) Assign the Cascade Smoke project the Assessment record type
--       (id=09a312cf-1e62-4b6e-a526-0166e3d141fe) since the project's
--       name ends in "— assessment" and the Assessment layout matches.
-- =====================================================================

-- (a) Restore the soft-deleted catch-all default layout
UPDATE public.page_layouts
SET is_deleted       = false,
    deletion_reason  = NULL,
    updated_at       = now()
WHERE id = '4b0bcfb8-d426-46c5-be6c-f4aac783cd19'::uuid
  AND page_layout_object = 'projects'
  AND record_type_id IS NULL;

-- (b) Assign Cascade Smoke project the Assessment record type
UPDATE public.projects
SET project_record_type = '09a312cf-1e62-4b6e-a526-0166e3d141fe'::uuid,
    project_updated_at  = now(),
    project_updated_by  = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
WHERE id = '3049c72a-34ab-43ff-8890-6b5e118d2562'::uuid;

-- Verify both fixes landed
DO $$
DECLARE
  v_layout_alive boolean;
  v_proj_rt uuid;
BEGIN
  SELECT NOT is_deleted INTO v_layout_alive
  FROM public.page_layouts
  WHERE id = '4b0bcfb8-d426-46c5-be6c-f4aac783cd19'::uuid;
  IF NOT v_layout_alive THEN
    RAISE EXCEPTION 'Catch-all projects layout failed to restore';
  END IF;

  SELECT project_record_type INTO v_proj_rt
  FROM public.projects
  WHERE id = '3049c72a-34ab-43ff-8890-6b5e118d2562'::uuid;
  IF v_proj_rt IS NULL THEN
    RAISE EXCEPTION 'Cascade Smoke project record type still NULL';
  END IF;
END $$;
