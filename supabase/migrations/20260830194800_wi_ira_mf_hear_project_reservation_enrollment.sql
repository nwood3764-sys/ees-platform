-- WI-IRA-MF-HEAR Project Reservation — the Focus on Energy submittal form, in LEAP
--
-- Source of truth: the "IRA HEAR Multifamily Project Submittal Form"
-- (focusonenergy.jotform.com/251176242544858), supplied as a PDF. Every field,
-- section heading, option list and help string below is taken from that form.
--
-- WHY THIS IS AN ENROLLMENT AND NOT AN INCENTIVE APPLICATION -- Nicholas:
-- "We need to separate the opportunity from the enrollment and from the
-- incentive records." The HOMES precedent already draws that line and this
-- follows it exactly: the program's SUBMITTAL FORM is an enrollment
-- (WI-IRA-MF-HOMES-Project-Reservation / PL-00377, whose sections are that
-- form's sections one for one), the OPPORTUNITY carries the sales lifecycle,
-- and incentive_applications tracks the rebate. Building the form onto
-- incentive_applications would have folded two purposes into one artifact.
--
-- ONE record type covers both stages, not two -- Nicholas: "this is the same
-- thing for the HEAR project reservation and the HEAR final project payment
-- request." The form itself works that way: its first question, "I'm Applying
-- for a(n)", chooses Project Reservation or Final Installation Payment Request.
-- HOMES does the same, via enrollment_application_for.
--
-- The record type is named "...-Project-Reservation" deliberately:
-- set_enrollment_reservation_defaults() keys off `ILIKE '%Project-Reservation%'`,
-- so HEAR inherits the whole reservation default set (contractor = Sealed Inc,
-- support contractor = EES of Wisconsin, payee, tax classification, signer,
-- income level derived from the building's LEA/MEA confirmation code, occupied
-- units) with no change to that function.
--
-- The layout is COPIED from PL-00377 and then patched, rather than authored from
-- scratch, because the Installation Building / Contractor / Payment sections are
-- dense with dotted related-field configs (building_id.building_year_built and
-- friends). Copying keeps those byte-correct; only the genuinely HEAR-specific
-- widgets are replaced.

-- 1. Columns the HEAR form needs that the HOMES form does not -----------------
-- HOMES asks for modeled savings and one total cost; HEAR asks for the rebate
-- requested plus equipment/materials and installation costs broken out. The
-- rebate-requested field is NOT new: enrollment_requested_incentive_amount is
-- program-neutral and is simply labelled per program, exactly as HOMES does.
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS enrollment_energy_data_sharing_permission uuid
    REFERENCES picklist_values(id),
  ADD COLUMN IF NOT EXISTS enrollment_equipment_and_materials_costs numeric,
  ADD COLUMN IF NOT EXISTS enrollment_installation_costs numeric,
  ADD COLUMN IF NOT EXISTS enrollment_total_ira_hear_cost numeric;

COMMENT ON COLUMN enrollments.enrollment_energy_data_sharing_permission IS
  'IRA HEAR submittal form: "Permission to share energy data with the State and DOE for evaluation purposes?"';
COMMENT ON COLUMN enrollments.enrollment_total_ira_hear_cost IS
  'IRA HEAR submittal form: "Total IRA HEAR Costs". The HEAR counterpart of enrollment_total_ira_homes_cost; kept separate because each is that program''s own figure.';

-- 2. The one picklist the form needs that did not exist ----------------------
-- Note the prefix-stripped field name: fetchPicklistOptions and
-- set_enrollment_reservation_defaults both look these up WITHOUT the
-- "enrollment_" prefix. application_for / building_type / building_project_type
-- / income_level / payee / tax_classification already exist and are reused
-- as-is; only the energy-data question was missing.
INSERT INTO picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_is_active, picklist_sort_order
)
SELECT 'enrollments', 'energy_data_sharing_permission', v.val, v.val, true, v.ord
FROM (VALUES ('Yes', 1), ('No', 2)) AS v(val, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM picklist_values
  WHERE picklist_object = 'enrollments'
    AND picklist_field = 'energy_data_sharing_permission'
    AND picklist_value = v.val
);

-- 3. The record type ---------------------------------------------------------
INSERT INTO picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_is_active, picklist_sort_order, picklist_state
)
SELECT 'enrollments', 'record_type',
       'WI-IRA-MF-HEAR-Project-Reservation', 'WI-IRA-MF-HEAR-Project-Reservation',
       true, 26, rt.picklist_state
FROM picklist_values rt
WHERE rt.picklist_object = 'enrollments' AND rt.picklist_field = 'record_type'
  AND rt.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation'
  AND NOT EXISTS (
    SELECT 1 FROM picklist_values
    WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type'
      AND picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation'
  );

-- 4. Line items feed the form's "What work will be completed?" ---------------
-- derive_reservation_work_measures() walks opportunity_line_items ->
-- product_work_measure_map, so mapping the HEAR price book's products is what
-- connects the price book to this form: add the line item, and the reservation
-- ticks the measure by itself.
-- The space-heating heat pump is DELIBERATELY NOT mapped: the form splits it
-- into Ductless / Ducted / Geothermal and the product does not say which, so a
-- mapping would tick a box the crew never chose on a rebate submission.
INSERT INTO product_work_measure_map (pwmm_product_id, pwmm_work_measure)
SELECT p.id, m.measure
FROM (VALUES
  ('HEAR-HPWH',   'ENERGY STAR Heat Pump Water Heater'),
  ('HEAR-PANEL',  'Electrical Load Center'),
  ('HEAR-WIRING', 'Electrical Wiring'),
  ('HEAR-VENT',   'ENERGY STAR Mechanical Ventilation'),
  ('HEAR-DRYER',  'ENERGY STAR Heat Pump Clothes Dryer'),
  ('HEAR-STOVE',  'ENERGY STAR Electric Cooking Product')
) AS m(code, measure)
JOIN products p ON p.product_code = m.code AND p.product_is_deleted IS NOT TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM product_work_measure_map x
  WHERE x.pwmm_product_id = p.id AND x.pwmm_work_measure = m.measure
    AND x.pwmm_is_deleted IS NOT TRUE
);

-- 5. The layout --------------------------------------------------------------
DO $$
DECLARE
  v_src    uuid;
  v_rt     uuid;
  v_layout uuid;
  v_sec    record;
  v_new    uuid;
  v_owner  uuid;
  v_count  integer;
  v_hear_measures jsonb := jsonb_build_array(
    jsonb_build_object('label','Air Sealing & Insulation','value','Air Sealing & Insulation'),
    jsonb_build_object('label','Electrical Load Center','value','Electrical Load Center'),
    jsonb_build_object('label','Electrical Wiring','value','Electrical Wiring'),
    jsonb_build_object('label','ENERGY STAR Heat Pump Water Heater','value','ENERGY STAR Heat Pump Water Heater'),
    jsonb_build_object('label','ENERGY STAR Ductless Heat Pump','value','ENERGY STAR Ductless Heat Pump'),
    jsonb_build_object('label','ENERGY STAR Ducted Heat Pump','value','ENERGY STAR Ducted Heat Pump'),
    jsonb_build_object('label','ENERGY STAR Geothermal Heat Pump','value','ENERGY STAR Geothermal Heat Pump'),
    jsonb_build_object('label','ENERGY STAR Heat Pump Clothes Dryer','value','ENERGY STAR Heat Pump Clothes Dryer'),
    jsonb_build_object('label','ENERGY STAR Electric Cooking Product','value','ENERGY STAR Electric Cooking Product'),
    jsonb_build_object('label','ENERGY STAR Mechanical Ventilation','value','ENERGY STAR Mechanical Ventilation')
  );
BEGIN
  SELECT l.id, l.page_layout_owner INTO v_src, v_owner
  FROM page_layouts l
  JOIN picklist_values rt ON rt.id = l.record_type_id
  WHERE l.page_layout_object = 'enrollments' AND l.is_deleted IS NOT TRUE
    AND rt.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Source layout for WI-IRA-MF-HOMES-Project-Reservation not found';
  END IF;

  SELECT id INTO v_rt FROM picklist_values
  WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type'
    AND picklist_value = 'WI-IRA-MF-HEAR-Project-Reservation';
  IF v_rt IS NULL THEN
    RAISE EXCEPTION 'WI-IRA-MF-HEAR-Project-Reservation record type was not created';
  END IF;

  -- Idempotent: retire any previous build of this layout rather than stacking.
  UPDATE page_layout_widgets w SET is_deleted = true
   FROM page_layouts l
   WHERE l.id = w.page_layout_id AND l.page_layout_object = 'enrollments'
     AND l.record_type_id = v_rt AND w.is_deleted IS NOT TRUE;
  UPDATE page_layout_sections s SET is_deleted = true
   FROM page_layouts l
   WHERE l.id = s.page_layout_id AND l.page_layout_object = 'enrollments'
     AND l.record_type_id = v_rt AND s.is_deleted IS NOT TRUE;
  UPDATE page_layouts SET is_deleted = true
   WHERE page_layout_object = 'enrollments' AND record_type_id = v_rt
     AND is_deleted IS NOT TRUE;

  INSERT INTO page_layouts (
    page_layout_record_number, page_layout_name, page_layout_object,
    page_layout_type, page_layout_is_default, record_type_id,
    page_layout_owner, page_layout_created_by, is_deleted
  )
  VALUES (
    '', 'WI-IRA-MF-HEAR-PR — Enrollments', 'enrollments',
    'record_detail', true, v_rt, v_owner, v_owner, false
  )
  RETURNING id INTO v_layout;

  FOR v_sec IN
    SELECT * FROM page_layout_sections
     WHERE page_layout_id = v_src AND is_deleted IS NOT TRUE
     ORDER BY section_order
  LOOP
    INSERT INTO page_layout_sections (
      page_layout_id, section_order, section_label, section_columns,
      section_is_collapsible, section_is_collapsed_by_default,
      section_tab, section_placement, is_deleted
    )
    VALUES (
      v_layout, v_sec.section_order, v_sec.section_label, v_sec.section_columns,
      v_sec.section_is_collapsible, v_sec.section_is_collapsed_by_default,
      v_sec.section_tab, v_sec.section_placement, false
    )
    RETURNING id INTO v_new;

    INSERT INTO page_layout_widgets (
      page_layout_widget_record_number, page_layout_id, section_id,
      widget_type, widget_title, widget_column, widget_position, widget_size,
      widget_config, widget_is_user_customizable, widget_is_required, is_deleted
    )
    SELECT '', v_layout, v_new,
      w.widget_type, w.widget_title, w.widget_column, w.widget_position, w.widget_size,
      w.widget_config, w.widget_is_user_customizable, w.widget_is_required, false
    FROM page_layout_widgets w
    WHERE w.section_id = v_sec.id AND w.is_deleted IS NOT TRUE
    ORDER BY w.widget_position;
  END LOOP;

  -- 5a. Application — add the form's energy-data question.
  UPDATE page_layout_widgets w
     SET widget_config = jsonb_set(
           w.widget_config, '{fields}',
           (w.widget_config->'fields') || jsonb_build_array(jsonb_build_object(
             'name',   'enrollment_energy_data_sharing_permission',
             'type',   'picklist',
             'label',  'Permission to share energy data with the State and DOE for evaluation purposes?',
             'column', 2,
             'display','radio'))
         )
   FROM page_layout_sections s
   WHERE s.id = w.section_id AND w.page_layout_id = v_layout
     AND s.section_label = 'Application' AND w.widget_type = 'field_group'
     AND w.is_deleted IS NOT TRUE;

  -- 5b. Building Improvements — HEAR's own measure list and money fields.
  UPDATE page_layout_widgets w
     SET widget_config = jsonb_build_object('fields', jsonb_build_array(
           jsonb_build_object(
             'name','enrollment_work_measures','type','multiselect',
             'label','What work will be completed?','column',1,
             'options', v_hear_measures,
             'help_text','Improvements must be listed on your contract/scope of work.')))
   FROM page_layout_sections s
   WHERE s.id = w.section_id AND w.page_layout_id = v_layout
     AND s.section_label = 'Building Improvements'
     AND w.widget_config->'fields'->0->>'name' = 'enrollment_work_measures'
     AND w.is_deleted IS NOT TRUE;

  UPDATE page_layout_widgets w
     SET widget_config = jsonb_build_object('fields', jsonb_build_array(
           jsonb_build_object('name','enrollment_requested_incentive_amount','type','currency',
             'label','Total IRA HEAR Rebate Requested','column',1),
           jsonb_build_object('name','enrollment_equipment_and_materials_costs','type','currency',
             'label','Equipment & Materials Costs','column',2),
           jsonb_build_object('name','enrollment_installation_costs','type','currency',
             'label','Installation Costs','column',1),
           jsonb_build_object('name','enrollment_total_ira_hear_cost','type','currency',
             'label','Total IRA HEAR Costs','column',2),
           jsonb_build_object('name','enrollment_estimated_completion_date','type','date',
             'label','Estimated project completion date','column',1)))
   FROM page_layout_sections s
   WHERE s.id = w.section_id AND w.page_layout_id = v_layout
     AND s.section_label = 'Building Improvements'
     AND w.widget_config->'fields'->0->>'name' = 'enrollment_requested_incentive_amount'
     AND w.is_deleted IS NOT TRUE;

  -- 5c. Supporting Documentation — HEAR asks for three uploads, not five.
  -- HPXML/BuildingSync, the Audit Template report and the reservation customer
  -- report are HOMES modelling artifacts; HEAR does not ask for them.
  UPDATE page_layout_widgets w
     SET is_deleted = true
   FROM page_layout_sections s
   WHERE s.id = w.section_id AND w.page_layout_id = v_layout
     AND s.section_label = 'Supporting Documentation'
     AND w.widget_config->>'document_type' IN
         ('reservation_hpxml','audit_template_report','reservation_customer_report')
     AND w.is_deleted IS NOT TRUE;

  UPDATE page_layout_widgets w
     SET widget_config = w.widget_config
           || jsonb_build_object('help_text','Required for all Multifamily projects.')
   FROM page_layout_sections s
   WHERE s.id = w.section_id AND w.page_layout_id = v_layout
     AND s.section_label = 'Supporting Documentation'
     AND w.widget_config->>'document_type' = 'customer_contract_sow'
     AND w.is_deleted IS NOT TRUE;

  INSERT INTO page_layout_widgets (
    page_layout_widget_record_number, page_layout_id, section_id,
    widget_type, widget_title, widget_column, widget_position, widget_config, is_deleted
  )
  SELECT '', v_layout, s.id, 'file_gallery',
         'Multifamily Supplemental Data Sheet', 1, 2,
         jsonb_build_object('target','documents',
                            'document_type','mf_supplemental_data_sheet',
                            'help_text','The spreadsheet must be populated with the equipment data.'),
         false
  FROM page_layout_sections s
  WHERE s.page_layout_id = v_layout AND s.section_label = 'Supporting Documentation'
    AND s.is_deleted IS NOT TRUE;

  -- 5d. Submission — HEAR is not a modelled program, so no modelling software.
  UPDATE page_layout_widgets w
     SET widget_config = jsonb_build_object('fields', jsonb_build_array(
           jsonb_build_object('name','enrollment_submitted_by','type','lookup',
             'label','Who is submitting this form?','column',1,
             'lookup_field','user_name','lookup_table','users')))
   FROM page_layout_sections s
   WHERE s.id = w.section_id AND w.page_layout_id = v_layout
     AND s.section_label = 'Submission' AND w.widget_type = 'field_group'
     AND w.is_deleted IS NOT TRUE;

  -- 5e. The form asks for bedroom count; the building already holds it, so it is
  -- shown as a related field rather than copied onto the enrollment.
  UPDATE page_layout_widgets w
     SET widget_config = jsonb_set(
           w.widget_config, '{fields}',
           (w.widget_config->'fields') || jsonb_build_array(jsonb_build_object(
             'name','building_id.building_number_of_bedrooms',
             'type','related_field',
             'label','Multifamily number of bedrooms',
             'column',2,
             'related', jsonb_build_object(
               'table','buildings',
               'column','building_number_of_bedrooms',
               'fk_column','building_id',
               'column_type','number')))
         )
   FROM page_layout_sections s
   WHERE s.id = w.section_id AND w.page_layout_id = v_layout
     AND s.section_label = 'Installation Building Information'
     AND w.widget_type = 'field_group' AND w.is_deleted IS NOT TRUE;

  -- 6. Prove the result rather than trusting the patches ---------------------
  SELECT count(*) INTO v_count FROM page_layout_sections
   WHERE page_layout_id = v_layout AND is_deleted IS NOT TRUE;
  IF v_count <> (SELECT count(*) FROM page_layout_sections
                  WHERE page_layout_id = v_src AND is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'HEAR reservation layout section count does not match the HOMES source';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM page_layout_widgets w
    WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE
      AND w.widget_config->'fields'->0->>'name' = 'enrollment_work_measures'
      AND jsonb_array_length(w.widget_config->'fields'->0->'options') = 10
  ) THEN
    RAISE EXCEPTION 'HEAR work-measure multiselect did not take the form''s 10 options';
  END IF;

  SELECT count(*) INTO v_count FROM page_layout_widgets w
   JOIN page_layout_sections s ON s.id = w.section_id
   WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE
     AND s.section_label = 'Supporting Documentation';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'Expected 3 HEAR document slots, found %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM page_layout_widgets w
    WHERE w.page_layout_id = v_layout AND w.is_deleted IS NOT TRUE
      AND w.widget_config::text LIKE '%enrollment_total_ira_hear_cost%'
  ) THEN
    RAISE EXCEPTION 'HEAR cost fields did not land on the layout';
  END IF;
END $$;
