-- ============================================================================
-- Account related lists are named for the RELATIONSHIP, not just the object
-- ----------------------------------------------------------------------------
-- Nicholas, 2026-08-25, from the Account page layout editor: "There are two
-- sections called Properties, but one should be Property Management Company,
-- right? … you just can't have Properties. Nobody knows what the hell that
-- means. Name these objects correctly. Stop paraphrasing."
--
-- Properties reach an Account through TWO lookups:
--   properties.property_account_id            — "Property Account"
--   properties.property_management_company_id — "Property Management Company"
-- and Owner Research Requests through two more:
--   owner_research_requests.orq_account_id          — "Account"
--   owner_research_requests.orq_approved_account_id — "Approved Account"
--
-- Every one of those lists was titled with the OBJECT alone, so an account
-- page carried the same heading twice and named neither relationship. Where a
-- title tried to disambiguate it did it by paraphrase — "Properties Managed"
-- is a description somebody invented, not the name of any field in LEAP.
--
-- The name of a relationship is the lookup field's own label, exactly as that
-- field is labeled on its own object's page layout. Salesforce parity: an
-- object related more than once carries the child relationship in the title.
--
-- The client now derives these titles when a related list is added
-- (src/lib/relatedListNaming.js, pinned by scripts/related-list-naming-fixture
-- .mjs), so this migration only corrects the layouts that already shipped.
-- The two sections holding these lists on Account Layout were never named
-- either — they still carried the canvas editor's placeholder labels — so they
-- are named here for what they hold.
-- ============================================================================

DO $fix$
DECLARE
  v_renamed_properties int;
  v_renamed_requests   int;
  v_sections           int;
  v_still_ambiguous    int;
BEGIN
  -- ── Properties, on all 8 account layouts ─────────────────────────────────
  UPDATE page_layout_widgets w
     SET widget_title = 'Properties (Property Account)'
    FROM page_layouts pl
   WHERE pl.id = w.page_layout_id
     AND pl.page_layout_object = 'accounts'
     AND pl.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'related_list'
     AND w.widget_config->>'table' = 'properties'
     AND w.widget_config->>'fk' = 'property_account_id'
     AND w.widget_title IS DISTINCT FROM 'Properties (Property Account)';
  GET DIAGNOSTICS v_renamed_properties = ROW_COUNT;

  UPDATE page_layout_widgets w
     SET widget_title = 'Properties (Property Management Company)'
    FROM page_layouts pl
   WHERE pl.id = w.page_layout_id
     AND pl.page_layout_object = 'accounts'
     AND pl.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'related_list'
     AND w.widget_config->>'table' = 'properties'
     AND w.widget_config->>'fk' = 'property_management_company_id'
     AND w.widget_title IS DISTINCT FROM 'Properties (Property Management Company)';
  GET DIAGNOSTICS v_sections = ROW_COUNT;
  v_renamed_properties := v_renamed_properties + v_sections;

  -- ── Owner Research Requests: requested by vs approved onto ───────────────
  UPDATE page_layout_widgets w
     SET widget_title = 'Owner Research Requests (Account)'
    FROM page_layouts pl
   WHERE pl.id = w.page_layout_id
     AND pl.page_layout_object = 'accounts'
     AND pl.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'related_list'
     AND w.widget_config->>'table' = 'owner_research_requests'
     AND w.widget_config->>'fk' = 'orq_account_id'
     AND w.widget_title IS DISTINCT FROM 'Owner Research Requests (Account)';
  GET DIAGNOSTICS v_renamed_requests = ROW_COUNT;

  UPDATE page_layout_widgets w
     SET widget_title = 'Owner Research Requests (Approved Account)'
    FROM page_layouts pl
   WHERE pl.id = w.page_layout_id
     AND pl.page_layout_object = 'accounts'
     AND pl.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'related_list'
     AND w.widget_config->>'table' = 'owner_research_requests'
     AND w.widget_config->>'fk' = 'orq_approved_account_id'
     AND w.widget_title IS DISTINCT FROM 'Owner Research Requests (Approved Account)';
  GET DIAGNOSTICS v_sections = ROW_COUNT;
  v_renamed_requests := v_renamed_requests + v_sections;

  -- ── The sections holding them, still carrying editor placeholders ────────
  UPDATE page_layout_sections s
     SET section_label = CASE s.section_label
                           WHEN 'Untitled Section' THEN 'Properties'
                           WHEN 'New Section'      THEN 'Owner Research'
                         END
    FROM page_layouts pl
   WHERE pl.id = s.page_layout_id
     AND pl.page_layout_object = 'accounts'
     AND pl.page_layout_name = 'Account Layout'
     AND pl.is_deleted IS NOT TRUE
     AND s.is_deleted IS NOT TRUE
     AND s.section_label IN ('Untitled Section', 'New Section');
  GET DIAGNOSTICS v_sections = ROW_COUNT;

  -- ── Prove it: no account layout shows one title twice ────────────────────
  SELECT count(*) INTO v_still_ambiguous
    FROM (
      SELECT pl.id, w.widget_title
        FROM page_layouts pl
        JOIN page_layout_widgets w
          ON w.page_layout_id = pl.id
         AND w.is_deleted IS NOT TRUE
         AND w.widget_type = 'related_list'
       WHERE pl.page_layout_object = 'accounts'
         AND pl.is_deleted IS NOT TRUE
         -- an exact duplicate of the same list (same table AND same foreign
         -- key) is a different defect and is deliberately not counted here
       GROUP BY pl.id, w.widget_title
      HAVING count(DISTINCT w.widget_config->>'fk') > 1
    ) dup;

  IF v_still_ambiguous > 0 THEN
    RAISE EXCEPTION 'account related lists still share a title across % relationship(s)', v_still_ambiguous;
  END IF;

  RAISE NOTICE 'related list names: % properties, % owner research requests, % sections',
    v_renamed_properties, v_renamed_requests, v_sections;
END
$fix$;
