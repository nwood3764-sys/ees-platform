-- ============================================================================
-- Account related lists: the titles Nicholas named
-- ----------------------------------------------------------------------------
-- Nicholas, 2026-08-25: "One needs to say 'properties', and then the next one
-- needs to say 'properties managed'."
--
-- The previous migration (20260825202633) renamed these to "Properties
-- (Property Account)" and "Properties (Property Management Company)". That was
-- my wording, not his, and it was applied to two things he never asked about —
-- the Owner Research Requests pair and the two section labels on Account
-- Layout. This sets the two titles he named and puts everything else back the
-- way he had it.
--
-- The remaining ambiguity is stated, not silently decided: Account Layout
-- carries two Owner Research Requests lists — one for the account that
-- requested the research (orq_account_id), one for the account the research
-- was approved onto (orq_approved_account_id) — and both are titled "Owner
-- Research Requests" again. What each should be called is Nicholas's to say.
-- ============================================================================

DO $fix$
DECLARE
  v_owned    int;
  v_managed  int;
  v_reverted int;
  v_sections int;
BEGIN
  -- ── The two titles, on all 8 account layouts ─────────────────────────────
  UPDATE page_layout_widgets w
     SET widget_title = 'Properties'
    FROM page_layouts pl
   WHERE pl.id = w.page_layout_id
     AND pl.page_layout_object = 'accounts'
     AND pl.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'related_list'
     AND w.widget_config->>'table' = 'properties'
     AND w.widget_config->>'fk' = 'property_account_id'
     AND w.widget_title IS DISTINCT FROM 'Properties';
  GET DIAGNOSTICS v_owned = ROW_COUNT;

  UPDATE page_layout_widgets w
     SET widget_title = 'Properties Managed'
    FROM page_layouts pl
   WHERE pl.id = w.page_layout_id
     AND pl.page_layout_object = 'accounts'
     AND pl.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'related_list'
     AND w.widget_config->>'table' = 'properties'
     AND w.widget_config->>'fk' = 'property_management_company_id'
     AND w.widget_title IS DISTINCT FROM 'Properties Managed';
  GET DIAGNOSTICS v_managed = ROW_COUNT;

  -- ── Put back what was renamed without being asked ────────────────────────
  UPDATE page_layout_widgets w
     SET widget_title = 'Owner Research Requests'
    FROM page_layouts pl
   WHERE pl.id = w.page_layout_id
     AND pl.page_layout_object = 'accounts'
     AND pl.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'related_list'
     AND w.widget_config->>'table' = 'owner_research_requests'
     AND w.widget_title IN ('Owner Research Requests (Account)',
                            'Owner Research Requests (Approved Account)');
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  UPDATE page_layout_sections s
     SET section_label = CASE s.section_label
                           WHEN 'Properties'     THEN 'Untitled Section'
                           WHEN 'Owner Research' THEN 'New Section'
                         END
    FROM page_layouts pl
   WHERE pl.id = s.page_layout_id
     AND pl.page_layout_object = 'accounts'
     AND pl.page_layout_name = 'Account Layout'
     AND pl.is_deleted IS NOT TRUE
     AND s.is_deleted IS NOT TRUE
     AND s.section_label IN ('Properties', 'Owner Research');
  GET DIAGNOSTICS v_sections = ROW_COUNT;

  -- The pair Nicholas named must read exactly that, on every account layout.
  IF EXISTS (
    SELECT 1
      FROM page_layouts pl
      JOIN page_layout_widgets w
        ON w.page_layout_id = pl.id
       AND w.is_deleted IS NOT TRUE
       AND w.widget_type = 'related_list'
     WHERE pl.page_layout_object = 'accounts'
       AND pl.is_deleted IS NOT TRUE
       AND w.widget_config->>'table' = 'properties'
       AND w.widget_title NOT IN ('Properties', 'Properties Managed')
  ) THEN
    RAISE EXCEPTION 'an account properties list is titled something other than Properties / Properties Managed';
  END IF;

  RAISE NOTICE 'titles: % Properties, % Properties Managed, % owner research restored, % sections restored',
    v_owned, v_managed, v_reverted, v_sections;
END
$fix$;
