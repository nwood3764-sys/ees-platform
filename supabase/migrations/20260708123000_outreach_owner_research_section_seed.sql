-- =====================================================================
-- Outreach module: "Owner Research" section tab
--
-- The review queue (OwnerResearchQueue) is a new code-backed section in
-- the Outreach module. module_sections already carries saved config for
-- outreach (home/properties/map/imports), so the new tab must be seeded
-- there or it would append after Imports; it belongs between Map and
-- Imports, matching the code order.
-- =====================================================================

UPDATE public.module_sections
SET ms_sort_order = 4, ms_updated_at = now()
WHERE ms_module_id = 'outreach' AND ms_section_id = 'imports'
  AND ms_is_deleted IS NOT TRUE AND ms_sort_order = 3;

INSERT INTO public.module_sections (ms_module_id, ms_section_id, ms_label, ms_sort_order, ms_is_visible, ms_is_system)
SELECT 'outreach', 'research', 'Owner Research', 3, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.module_sections
  WHERE ms_module_id = 'outreach' AND ms_section_id = 'research' AND ms_is_deleted IS NOT TRUE
);

NOTIFY pgrst, 'reload schema';
