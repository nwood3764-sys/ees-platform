-- The HEAR reservation enrollment matches the HEAR form, and inherits what it can
--
-- Nicholas: "the HEAR enrollment should match the HEAR job form, and it should
-- inherit all the fields it can."
--
-- PL-00404 was built by copying the HOMES reservation layout (PL-00377) and
-- swapping HEAR's fields in. That got the structure right and carried four kinds
-- of HOMES residue with it, all fixed here:
--
--   1. A help string on the contractor question still read "...may perform work
--      on IRA HOMES projects" -- on the HEAR form.
--   2. Support Contractor Information and Payment Information are HOMES sections.
--      The IRA HEAR Multifamily Project Submittal Form has neither.
--   3. Installation Building Information carried property_hud_owner_org TWICE,
--      plus Total Floors and Total Project Cost, which the HEAR form never asks.
--   4. A stray "New Section" holding a second Documents gallery and Assessments
--      list, duplicating the Documents section above it.
--
-- It also puts the form's fields where the FORM puts them. The HEAR form asks the
-- income level, confirmation code, unit counts, floor area, year built and
-- bedrooms in its OPENING block, before Contractor Information -- not down in
-- Installation Building Information, where the HOMES layout keeps them. Matching
-- the form means matching its order.
--
-- INHERITANCE. Everything that can be read from the property or the building
-- already is, and stays that way: address, unit count, year built, bedrooms,
-- electric utility and account, heating fuel, and the LEA/MEA confirmation code
-- are all related fields, so nobody retypes what LEAP already knows. Only what is
-- genuinely the submission's own answer is stored on the enrollment: occupied
-- units, income level, the money, and who submitted it.
--
-- Conditioned floor area is the one field with nowhere to inherit FROM. The form
-- asks for "Conditioned Floor Area of Multifamily Building (sq ft)" and buildings
-- only carried building_square_footage, which is GROSS area -- a different
-- measurement. Relabelling it would have printed the wrong number under the right
-- name on a rebate submission, so the column is added to buildings, where the
-- fact belongs, and inherited like its neighbours.

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS building_conditioned_floor_area_sq_ft numeric;

COMMENT ON COLUMN buildings.building_conditioned_floor_area_sq_ft IS
  'Conditioned (heated/cooled) floor area in square feet. Distinct from building_square_footage, which is gross area. Asked for by name on the IRA HEAR multifamily submittal form.';

DO $$
DECLARE
  v_layout uuid;
  v_sec    uuid;
  v_count  integer;
  v_labels text;
BEGIN
  SELECT l.id INTO v_layout
  FROM page_layouts l
  JOIN picklist_values rt ON rt.id = l.record_type_id
  WHERE l.page_layout_object = 'enrollments' AND l.is_deleted IS NOT TRUE
    AND rt.picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation';
  IF v_layout IS NULL THEN
    RAISE EXCEPTION 'HEAR reservation layout not found';
  END IF;

  -- 1. Application — the form's opening block, in the form's order ----------
  SELECT s.id INTO v_sec FROM page_layout_sections s
   WHERE s.page_layout_id = v_layout AND s.section_label = 'Application'
     AND s.is_deleted IS NOT TRUE;

  UPDATE page_layout_widgets w
     SET widget_config = jsonb_build_object('fields', jsonb_build_array(
       jsonb_build_object('name','enrollment_application_for','type','picklist',
         'label','I''m Applying for a(n)','column',1,'display','radio'),
       jsonb_build_object('name','enrollment_building_type','type','picklist',
         'label','Building Type','column',2,'display','radio'),
       jsonb_build_object('name','enrollment_building_project_type','type','picklist',
         'label','Building Project Type','column',1,'display','radio',
         'help_text','Central Multifamily must be used when the reservation is for shared building upgrades that benefit more than one unit in a multifamily building.'),
       jsonb_build_object('name','enrollment_energy_data_sharing_permission','type','picklist',
         'label','Permission to share energy data with the State and DOE for evaluation purposes?',
         'column',2,'display','radio'),
       jsonb_build_object('name','enrollment_income_level','type','picklist',
         'label','Which income level is your customer approved at?','column',1),
       jsonb_build_object('name','building_id.ira_confirmation_code_lea','type','related_field',
         'label','Income-Qualified Confirmation Code','column',2,
         'help_text','Confirmation Code must match installation address approved.',
         'related', jsonb_build_object('table','buildings','column','ira_confirmation_code_lea',
                                       'fk_column','building_id','column_type','text')),
       jsonb_build_object('name','building_id.building_total_units','type','related_field',
         'label','Total Number of Units in the building?','column',1,
         'related', jsonb_build_object('table','buildings','column','building_total_units',
                                       'fk_column','building_id','column_type','number')),
       jsonb_build_object('name','enrollment_occupied_units','type','number',
         'label','Number of Occupied Units','column',2),
       jsonb_build_object('name','building_id.building_conditioned_floor_area_sq_ft','type','related_field',
         'label','Conditioned Floor Area of Multifamily Building (sq ft)','column',1,
         'related', jsonb_build_object('table','buildings','column','building_conditioned_floor_area_sq_ft',
                                       'fk_column','building_id','column_type','number')),
       jsonb_build_object('name','building_id.building_year_built','type','related_field',
         'label','Year the Building was Built','column',2,
         'related', jsonb_build_object('table','buildings','column','building_year_built',
                                       'fk_column','building_id','column_type','number')),
       jsonb_build_object('name','building_id.building_number_of_bedrooms','type','related_field',
         'label','Multifamily number of bedrooms','column',1,
         'related', jsonb_build_object('table','buildings','column','building_number_of_bedrooms',
                                       'fk_column','building_id','column_type','number')))
     )
   WHERE w.section_id = v_sec AND w.widget_type = 'field_group' AND w.is_deleted IS NOT TRUE;

  -- 2. Primary Contractor — the help string said HOMES on a HEAR form -------
  UPDATE page_layout_widgets w
     SET widget_config = replace(w.widget_config::text, 'IRA HOMES projects', 'IRA HEAR projects')::jsonb
   FROM page_layout_sections s
   WHERE s.id = w.section_id AND w.page_layout_id = v_layout
     AND s.section_label = 'Primary Contractor Information'
     AND w.is_deleted IS NOT TRUE
     AND w.widget_config::text LIKE '%IRA HOMES projects%';

  -- 3. Installation Building Information — only what the form asks ----------
  SELECT s.id INTO v_sec FROM page_layout_sections s
   WHERE s.page_layout_id = v_layout AND s.section_label = 'Installation Building Information'
     AND s.is_deleted IS NOT TRUE;

  UPDATE page_layout_widgets w
     SET widget_config = jsonb_build_object('fields', jsonb_build_array(
       jsonb_build_object('name','property_id.property_hud_owner_org','type','related_field',
         'label','Business Entity Name','column',1,
         'related', jsonb_build_object('table','properties','column','property_hud_owner_org',
                                       'fk_column','property_id','column_type','text')),
       jsonb_build_object('name','enrollment_signer_contact_id','type','lookup',
         'label','Contact Name','column',2,
         'lookup_field','contact_name','lookup_table','contacts'),
       jsonb_build_object('name','enrollment_signer_contact_id.contact_email','type','related_field',
         'label','Email','column',1,
         'related', jsonb_build_object('table','contacts','column','contact_email',
                                       'fk_column','enrollment_signer_contact_id','column_type','email')),
       jsonb_build_object('name','enrollment_signer_contact_id.contact_phone','type','related_field',
         'label','Phone Number','column',2,
         'related', jsonb_build_object('table','contacts','column','contact_phone',
                                       'fk_column','enrollment_signer_contact_id','column_type','phone')),
       jsonb_build_object('name','property_id.property_street','type','related_field',
         'label','Installation Address','column',1,
         'related', jsonb_build_object('table','properties','column','property_street',
                                       'fk_column','property_id','column_type','text')),
       jsonb_build_object('name','property_id.property_city','type','related_field',
         'label','City','column',1,
         'related', jsonb_build_object('table','properties','column','property_city',
                                       'fk_column','property_id','column_type','text')),
       jsonb_build_object('name','property_id.property_state','type','related_field',
         'label','State / Province','column',2,
         'related', jsonb_build_object('table','properties','column','property_state',
                                       'fk_column','property_id','column_type','text')),
       jsonb_build_object('name','property_id.property_zip','type','related_field',
         'label','Postal / Zip Code','column',2,
         'related', jsonb_build_object('table','properties','column','property_zip',
                                       'fk_column','property_id','column_type','text')))
     )
   WHERE w.section_id = v_sec AND w.widget_type = 'field_group' AND w.is_deleted IS NOT TRUE;

  -- 4. Sections the HEAR form does not have --------------------------------
  -- Removed from the LAYOUT only. enrollment_payee and enrollment_tax_classification
  -- are still set by set_enrollment_reservation_defaults(), so no data is lost and
  -- putting either section back is a Setup edit.
  UPDATE page_layout_widgets w SET is_deleted = true
   FROM page_layout_sections s
   WHERE s.id = w.section_id AND w.page_layout_id = v_layout
     AND s.section_label IN ('Support Contractor Information','Payment Information','New Section')
     AND w.is_deleted IS NOT TRUE;

  UPDATE page_layout_sections s SET is_deleted = true,
         deletion_reason = 'Not on the IRA HEAR Multifamily Project Submittal Form'
   WHERE s.page_layout_id = v_layout
     AND s.section_label IN ('Support Contractor Information','Payment Information','New Section')
     AND s.is_deleted IS NOT TRUE;

  -- 5. Prove it ------------------------------------------------------------
  -- Assert the exact section set, not a count -- a count only says how many.
  SELECT string_agg(s.section_label, ' | ' ORDER BY s.section_order) INTO v_labels
    FROM page_layout_sections s
   WHERE s.page_layout_id = v_layout AND s.is_deleted IS NOT TRUE;
  IF v_labels IS DISTINCT FROM
     'Enrollment | Application | Primary Contractor Information | Installation Building Information | Utility Information | Building Improvements | Supporting Documentation | Submission | Documents | System Information' THEN
    RAISE EXCEPTION 'HEAR reservation sections are: %', v_labels;
  END IF;

  IF EXISTS (
    SELECT 1 FROM page_layout_widgets w
    WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE
      AND w.widget_config::text LIKE '%IRA HOMES%'
  ) THEN
    RAISE EXCEPTION 'The HEAR layout still mentions IRA HOMES';
  END IF;

  -- No field appears twice anywhere on the layout.
  SELECT count(*) INTO v_count FROM (
    SELECT f->>'name' AS n
    FROM page_layout_widgets w
    CROSS JOIN LATERAL jsonb_array_elements(w.widget_config->'fields') f
    WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE
      AND w.widget_type = 'field_group'
    GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF v_count > 0 THEN
    RAISE EXCEPTION '% field(s) appear more than once on the HEAR layout', v_count;
  END IF;

  -- The building facts the form asks for are INHERITED, not retyped.
  SELECT count(*) INTO v_count
  FROM page_layout_widgets w
  CROSS JOIN LATERAL jsonb_array_elements(w.widget_config->'fields') f
  WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE
    AND f->>'type' = 'related_field';
  IF v_count < 15 THEN
    RAISE EXCEPTION 'Only % inherited fields on the HEAR layout; expected at least 15', v_count;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
