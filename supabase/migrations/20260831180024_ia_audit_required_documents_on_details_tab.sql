-- The assessment application's three REQUIRED uploads move onto the Details tab,
-- where the form asks for them.
--
-- Reported: "we need to build the file uploads." They were built -- Asset Score,
-- BuildingSync File and Invoice have carried their document types and the form's
-- own help text since 20260825223100 -- but their section sat on the RELATED tab
-- at section_order 100. So an assessor working down the Details tab, filling in
-- the application field by field against
-- focusonenergy.formstack.com/forms/ira_assessment_app, reached the end of the
-- form and had been shown no upload at all. On the form these three sit inside
-- "Assessment Details - Individual Multifamily Building"; in LEAP they were a tab
-- away, which reads as missing rather than as elsewhere.
--
-- File galleries render as standalone cards immediately after their section's
-- slot (they are not in-section widgets), so moving the SECTION onto Details is
-- what puts the three upload cards in the flow, directly beneath Assessment
-- Details and above Assessor Information -- the form's own order.
--
-- The payment-request layout of this same object already does exactly this: its
-- uploads are Details-tab sections (Payment Information, Supporting
-- Documentation). This brings the audit layout into line with it.
--
-- "Supporting Documents" deliberately stays on the Related tab: it is a LEAP
-- catch-all with no counterpart on the form, and it is not required.

DO $$
DECLARE
  v_layout   uuid;
  v_section  uuid;
  v_required integer;
  v_tab      text;
  v_order    integer;
BEGIN
  SELECT pl.id INTO v_layout
    FROM public.page_layouts pl
    JOIN public.picklist_values pv ON pv.id = pl.record_type_id
   WHERE pl.page_layout_object = 'incentive_applications'
     AND pl.is_deleted IS NOT TRUE
     AND pv.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
   LIMIT 1;
  IF v_layout IS NULL THEN
    RAISE EXCEPTION 'WI-IRA-MF-HOMES-AUDIT layout not found';
  END IF;

  SELECT s.id INTO v_section
    FROM public.page_layout_sections s
   WHERE s.page_layout_id = v_layout AND s.is_deleted IS NOT TRUE
     AND s.section_label = 'Required Documents'
   LIMIT 1;
  IF v_section IS NULL THEN
    RAISE EXCEPTION 'Required Documents section not found on the audit layout';
  END IF;

  -- The three uploads the form marks required must actually be there before the
  -- section is promoted; promoting an empty section would put a heading on the
  -- Details tab with nothing under it.
  SELECT count(*) INTO v_required
    FROM public.page_layout_widgets w
   WHERE w.section_id = v_section AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'file_gallery'
     AND w.widget_config ->> 'document_type' IN
         ('assessment_asset_score', 'assessment_buildingsync_file', 'assessment_invoice');
  IF v_required <> 3 THEN
    RAISE EXCEPTION 'Expected the 3 required assessment uploads on the audit layout, found %', v_required;
  END IF;

  -- Open a slot directly after Assessment Details (3) by pushing the sections
  -- below it down one. Only the Details-tab run 4..8 moves; the Related-tab
  -- sections at 100/101/201 keep their order, so Supporting Documents and
  -- Conversations are untouched.
  UPDATE public.page_layout_sections
     SET section_order = section_order + 1, updated_at = now()
   WHERE page_layout_id = v_layout AND is_deleted IS NOT TRUE
     AND section_tab = 'Details' AND section_order BETWEEN 4 AND 8;

  UPDATE public.page_layout_sections
     SET section_tab = 'Details', section_order = 4, updated_at = now()
   WHERE id = v_section;

  SELECT section_tab, section_order INTO v_tab, v_order
    FROM public.page_layout_sections WHERE id = v_section;
  IF v_tab IS DISTINCT FROM 'Details' OR v_order <> 4 THEN
    RAISE EXCEPTION 'Required Documents did not land on Details at position 4 (got %/%)', v_tab, v_order;
  END IF;

  -- Nothing may share a position on the tab, or the render order is undefined.
  IF EXISTS (
    SELECT 1 FROM public.page_layout_sections
     WHERE page_layout_id = v_layout AND is_deleted IS NOT TRUE AND section_tab = 'Details'
     GROUP BY section_order HAVING count(*) > 1)
  THEN
    RAISE EXCEPTION 'Two Details sections share a section_order on the audit layout';
  END IF;
END $$;
