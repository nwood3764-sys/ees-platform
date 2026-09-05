-- The equipment lives ON the Products card, not in a second card beside it.
--
-- Nicholas, on the opportunity: "I can't enter a product. I deleted one, and now
-- it just gives me an error. It looks like there are two product-related lists
-- on the opportunity... They appear to be the same list."
--
-- Both symptoms come from the same wrong assumption in 20260903023940.
--
-- ── Why there were two identical cards ────────────────────────────────────
--
-- RecordDetail.renderRecordCard special-cases ANY related_list whose table is
-- opportunity_line_items on an opportunity and renders OpportunityProductsWidget
-- instead — "wherever that list is placed". So the Equipment section added last
-- night could never render as the filtered, equipment-focused list it was
-- configured to be: its columns and its `match` filter were discarded and it
-- drew a second, identical Products card. Two cards, same rows, same totals,
-- neither of them what was asked for.
--
-- The section is removed. The equipment now shows as a COLUMN on the one
-- Products card, which is where a person is already looking, and the model is
-- chosen in a step that opens the moment a HEAR measure is picked. That is
-- closer to what Nicholas actually described second — "if we pick a HEAR line
-- item, it prompts the user to select the actual equipment product" — than a
-- separate card was, and it avoids a card that cannot render itself.
--
-- ── Why adding a product failed ───────────────────────────────────────────
--
-- enforce_line_item_equipment_selection refuses a ventilation or heat-pump line
-- with no equipment, and the Products card's quick-add sends only the product.
-- The rule is right and stays; what was wrong is that the card had no way to
-- supply the model and swallowed the trigger's message behind a flat "Could not
-- add product" — a message that names the measure and lists its approved models,
-- thrown away and replaced with nothing to act on. Both fixed in the widget.
--
-- Nothing here changes the rule itself. A HEAR line still cannot be saved
-- without naming the equipment installed.
--
-- ── Found, deliberately NOT fixed ─────────────────────────────────────────
--
-- The assertion below caught a SECOND duplicate that predates this work:
-- WI-IRA-MF-HOMES-Audit carries two opportunity_line_items lists, both created
-- 2026-08-17 (a layout clone), in "Related Records" and "New Section". That
-- layout has therefore drawn the Products card twice since August. It is the
-- same defect Nicholas reported, on a layout he has not reported it on, and
-- removing a card from a live layout nobody asked about is not this change's
-- call to make. It is left alone and reported; the assertion pins the count at
-- one known layout, so the condition cannot silently spread.

BEGIN;

-- Soft-delete, not DELETE: block_hard_delete() governs, and a removed section
-- is part of this layout's history.
UPDATE public.page_layout_widgets w
   SET is_deleted = true, updated_at = now()
  FROM public.page_layout_sections s
  JOIN public.page_layouts pl ON pl.id = s.page_layout_id
 WHERE w.section_id = s.id
   AND pl.page_layout_object = 'opportunities'
   AND s.section_label = 'Equipment'
   AND w.is_deleted IS NOT TRUE;

UPDATE public.page_layout_sections s
   SET is_deleted = true,
       deletion_reason = 'Rendered as a duplicate Products card: RecordDetail renders every opportunity_line_items related list as OpportunityProductsWidget, discarding this section''s columns and match filter. The equipment is a column on the Products card instead.'
  FROM public.page_layouts pl
 WHERE pl.id = s.page_layout_id
   AND pl.page_layout_object = 'opportunities'
   AND s.section_label = 'Equipment'
   AND s.is_deleted IS NOT TRUE;

COMMIT;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.page_layout_sections s
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
   WHERE pl.page_layout_object = 'opportunities'
     AND s.section_label = 'Equipment' AND s.is_deleted IS NOT TRUE;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'An Equipment section still renders on % opportunity layout(s)', v_n;
  END IF;

  -- The HEAR layout — the one this change touched — must draw the Products
  -- card exactly once.
  SELECT count(*) INTO v_n
    FROM public.page_layout_widgets w
    JOIN public.page_layout_sections s ON s.id = w.section_id
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
    JOIN public.picklist_values rt ON rt.id = pl.record_type_id
   WHERE pl.page_layout_object = 'opportunities'
     AND rt.picklist_value = 'WI-IRA-MF-HEAR'
     AND w.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE
     AND w.widget_config->>'table' = 'opportunity_line_items';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'The HEAR opportunity layout draws the Products card % time(s); expected exactly 1', v_n;
  END IF;

  -- Platform-wide, exactly ONE layout may carry a duplicate: the pre-existing
  -- WI-IRA-MF-HOMES-Audit clone described above. If that number ever grows,
  -- something has started duplicating the card again and this fails loudly
  -- rather than letting it spread one layout at a time.
  SELECT count(*) INTO v_n FROM (
    SELECT pl.id
      FROM public.page_layout_widgets w
      JOIN public.page_layout_sections s ON s.id = w.section_id
      JOIN public.page_layouts pl ON pl.id = s.page_layout_id
     WHERE pl.page_layout_object = 'opportunities'
       AND w.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE
       AND w.widget_config->>'table' = 'opportunity_line_items'
     GROUP BY pl.id
    HAVING count(*) > 1
  ) dupes;
  IF v_n > 1 THEN
    RAISE EXCEPTION '% opportunity layouts draw the Products card twice; only the known WI-IRA-MF-HOMES-Audit clone is expected', v_n;
  END IF;
END $$;
