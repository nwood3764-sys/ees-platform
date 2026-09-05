-- The supplemental data sheet files into the slot that was already built for it.
--
-- Nicholas: "the supplemental data sheet on the HEAR enrollment needs to be
-- entered, not under documents. When it's graded, it needs to go under the
-- multi-family supplemental data sheet area."
--
-- The HEAR Project Reservation layout has carried a "Multifamily Supplemental
-- Data Sheet" file_gallery SLOT since before this work, typed
-- `mf_supplemental_data_sheet`, in the Supporting Documentation section. The
-- generator coined its own type instead of looking for it, so every sheet it
-- produced landed in the catch-all Documents card at the bottom of the page
-- while the slot built for it sat empty.
--
-- A slot lists ONLY documents of its own type (documentSlots.js), which is
-- exactly why this was invisible: the upload succeeded, the file existed, and
-- it was simply in the wrong card. Nothing errored.
--
-- The rule worth keeping: before minting a document type, look for the slot the
-- layout already declares.

BEGIN;

UPDATE public.documents
   SET document_type = 'mf_supplemental_data_sheet',
       updated_at = now()
 WHERE document_type = 'hear_quality_installation_supplemental_data_sheet'
   AND is_deleted IS NOT TRUE;

COMMIT;

DO $$
DECLARE v_stale int; v_slot int; v_widget int;
BEGIN
  SELECT count(*) INTO v_stale FROM public.documents
   WHERE document_type = 'hear_quality_installation_supplemental_data_sheet'
     AND is_deleted IS NOT TRUE;
  IF v_stale > 0 THEN
    RAISE EXCEPTION '% sheet(s) still carry the old type and stay in the catch-all card', v_stale;
  END IF;

  -- The slot must actually exist and be typed the way the code now files under,
  -- or this has simply moved the file to a different wrong place.
  SELECT count(*) INTO v_widget
    FROM public.page_layout_widgets w
    JOIN public.page_layout_sections s ON s.id = w.section_id
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
    JOIN public.picklist_values rt ON rt.id = pl.record_type_id
   WHERE pl.page_layout_object = 'enrollments'
     AND rt.picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation'
     AND w.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE
     AND w.widget_config->>'document_type' = 'mf_supplemental_data_sheet';
  IF v_widget < 1 THEN
    RAISE EXCEPTION 'The HEAR reservation layout has no mf_supplemental_data_sheet slot to file into';
  END IF;

  SELECT count(*) INTO v_slot FROM public.documents
   WHERE document_type = 'mf_supplemental_data_sheet' AND is_deleted IS NOT TRUE;
  RAISE NOTICE 'Supplemental data sheets now in the slot: %', v_slot;
END $$;
