-- =====================================================================
-- Single-family building record types (Nicholas, 2026-07-22): distinguish
-- detached (no units — the building IS the home; work orders live at
-- building level) from attached (each attached home is a unit). Feeds the
-- New Assessment self-service flow. Admin-manageable; idempotent.
-- =====================================================================
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT 'buildings', 'record_type', v.val, v.lbl, true, v.ord, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (VALUES
  ('single_family_detached', 'Single Family Detached', 71),
  ('single_family_attached', 'Single Family Attached', 72)
) AS v(val, lbl, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
   WHERE p.picklist_object='buildings' AND p.picklist_field='record_type' AND p.picklist_value=v.val
);

NOTIFY pgrst, 'reload schema';
