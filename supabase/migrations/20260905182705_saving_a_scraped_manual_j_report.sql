-- Saving a scraped Manual J — one statement, or none of it.
--
-- A report is 1 + 17 + 255 + 14 rows. Writing them from the browser one at a
-- time leaves a half-saved load calculation behind the moment anything fails,
-- and a half-saved load calculation is worse than none: it reads as a complete
-- one. SECURITY INVOKER, so RLS and the state scope still decide.

CREATE OR REPLACE FUNCTION public.save_manual_j_report(p_assessment_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_report_id uuid;
  v_user      uuid := public.current_app_user_id();
  v_block     jsonb;
  v_component jsonb;
  v_material  jsonb;
  v_block_id  uuid;
  v_seq       int := 0;
  v_cseq      int;
  v_assessment record;
BEGIN
  IF p_assessment_id IS NULL THEN
    RAISE EXCEPTION 'save_manual_j_report: an assessment is required — a Manual J belongs to one'
      USING ERRCODE = '22023';
  END IF;

  SELECT a.id, a.property_id, a.building_id, a.opportunity_id, a.project_id
    INTO v_assessment
  FROM public.assessments a
  WHERE a.id = p_assessment_id AND a.assessment_is_deleted IS NOT TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_manual_j_report: assessment % was not found, or is not visible to you', p_assessment_id
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.manual_j_reports (
    mjr_record_number, assessment_id, property_id, building_id, unit_id, opportunity_id, project_id,
    document_id, mjr_source_software, mjr_manual_j_version, mjr_report_title, mjr_report_created_by,
    mjr_report_created_at_text, mjr_report_updated_at_text, mjr_source_file_name,
    mjr_subject_name, mjr_subject_address, mjr_subject_street, mjr_subject_city, mjr_subject_state, mjr_subject_postal_code,
    mjr_weather_station, mjr_elevation_ft, mjr_latitude, mjr_altitude_correction_factor,
    mjr_heating_outdoor_db_f, mjr_heating_indoor_db_f, mjr_heating_temp_difference_f,
    mjr_cooling_outdoor_db_f, mjr_cooling_indoor_db_f, mjr_cooling_temp_difference_f,
    mjr_cooling_indoor_rh_pct, mjr_cooling_daily_range, mjr_cooling_grains_difference,
    mjr_design_heating_load_btuh, mjr_design_cooling_load_btuh, mjr_design_sensible_cooling_btuh,
    mjr_design_latent_cooling_btuh, mjr_design_load_basis, mjr_design_load_basis_id,
    mjr_conditioned_floor_area_sq_ft, mjr_neep_construction_year, mjr_neep_ducting_configuration,
    mjr_notes, mjr_raw_extract, mjr_parser_version, mjr_extracted_at,
    mjr_reviewed_by, mjr_reviewed_at, mjr_owner, mjr_created_by, mjr_updated_by
  ) VALUES (
    '', p_assessment_id,
    COALESCE((p_payload->>'property_id')::uuid, v_assessment.property_id),
    COALESCE((p_payload->>'building_id')::uuid, v_assessment.building_id),
    (p_payload->>'unit_id')::uuid,
    COALESCE((p_payload->>'opportunity_id')::uuid, v_assessment.opportunity_id),
    COALESCE((p_payload->>'project_id')::uuid, v_assessment.project_id),
    (p_payload->>'document_id')::uuid,
    p_payload->>'source_software', p_payload->>'manual_j_version', p_payload->>'report_title',
    p_payload->>'report_created_by', p_payload->>'report_created_at_text', p_payload->>'report_updated_at_text',
    p_payload->>'source_file_name',
    p_payload->>'subject_name', p_payload->>'subject_address', p_payload->>'subject_street',
    p_payload->>'subject_city', p_payload->>'subject_state', p_payload->>'subject_postal_code',
    p_payload->>'weather_station',
    (p_payload->>'elevation_ft')::numeric, (p_payload->>'latitude')::numeric,
    (p_payload->>'altitude_correction_factor')::numeric,
    (p_payload->>'heating_outdoor_db_f')::numeric, (p_payload->>'heating_indoor_db_f')::numeric,
    (p_payload->>'heating_temp_difference_f')::numeric,
    (p_payload->>'cooling_outdoor_db_f')::numeric, (p_payload->>'cooling_indoor_db_f')::numeric,
    (p_payload->>'cooling_temp_difference_f')::numeric,
    (p_payload->>'cooling_indoor_rh_pct')::numeric, p_payload->>'cooling_daily_range',
    (p_payload->>'cooling_grains_difference')::numeric,
    (p_payload->>'design_heating_load_btuh')::numeric, (p_payload->>'design_cooling_load_btuh')::numeric,
    (p_payload->>'design_sensible_cooling_btuh')::numeric, (p_payload->>'design_latent_cooling_btuh')::numeric,
    p_payload->>'design_load_basis', p_payload->>'design_load_basis_id',
    (p_payload->>'conditioned_floor_area_sq_ft')::numeric,
    (p_payload->>'neep_construction_year')::int, p_payload->>'neep_ducting_configuration',
    p_payload->>'notes', p_payload->'raw_extract', p_payload->>'parser_version', now(),
    v_user, now(), v_user, v_user, v_user
  )
  RETURNING id INTO v_report_id;

  FOR v_block IN SELECT jsonb_array_elements(COALESCE(p_payload->'blocks', '[]'::jsonb))
  LOOP
    v_seq := v_seq + 1;
    INSERT INTO public.manual_j_load_blocks (
      mjl_record_number, manual_j_report_id, mjl_scope, mjl_block_name, mjl_system_name,
      mjl_zone_name, mjl_room_name, mjl_story, mjl_sequence, mjl_source_page,
      mjl_total_heating_btuh, mjl_total_cooling_btuh, mjl_sensible_cooling_btuh, mjl_latent_cooling_btuh,
      mjl_floor_area_sq_ft, mjl_volume_cu_ft, mjl_ceiling_height_ft, mjl_exposed_wall_gross_sq_ft,
      mjl_exposed_wall_net_sq_ft, mjl_glazing_area_sq_ft, mjl_running_exposed_wall_ft,
      mjl_sensible_heat_ratio, mjl_envelope_tightness, mjl_appliance_scenario, mjl_occupants, mjl_design_cfm,
      mjl_exposed_wall_by_orientation, mjl_rooms,
      mjl_system_type, mjl_distribution_type, mjl_ducts, mjl_supply_run_location, mjl_leakage_class,
      mjl_duct_wall_insulation, mjl_airway_configuration, mjl_ehlf, mjl_esgf, mjl_elg,
      mjl_owner, mjl_created_by, mjl_updated_by
    ) VALUES (
      '', v_report_id, v_block->>'scope', v_block->>'name', v_block->>'system',
      v_block->>'zone', v_block->>'room', v_block->>'story', v_seq, (v_block->>'page')::int,
      (v_block#>>'{total,totalHeatingBtuh}')::numeric, (v_block#>>'{total,totalCoolingBtuh}')::numeric,
      (v_block#>>'{total,sensibleCoolingBtuh}')::numeric, (v_block#>>'{total,latentCoolingBtuh}')::numeric,
      (v_block#>>'{geometry,floorAreaSqFt}')::numeric, (v_block#>>'{geometry,volumeCuFt}')::numeric,
      (v_block#>>'{geometry,ceilingHeightFt}')::numeric, (v_block#>>'{geometry,exposedWallGrossSqFt}')::numeric,
      (v_block#>>'{geometry,exposedWallNetSqFt}')::numeric, (v_block#>>'{geometry,glazingAreaSqFt}')::numeric,
      (v_block#>>'{geometry,runningExposedWallFt}')::numeric, (v_block#>>'{geometry,sensibleHeatRatio}')::numeric,
      v_block#>>'{geometry,envelopeTightness}', v_block#>>'{geometry,applianceScenario}',
      (v_block#>>'{geometry,occupants}')::numeric, (v_block#>>'{geometry,designCfm}')::numeric,
      v_block->'exposedWallByOrientation', v_block->'rooms',
      v_block#>>'{distribution,systemType}', v_block#>>'{distribution,distributionType}',
      v_block#>>'{distribution,ducts}', v_block#>>'{distribution,supplyRunLocation}',
      v_block#>>'{distribution,leakageClass}', v_block#>>'{distribution,ductWallInsulation}',
      v_block#>>'{distribution,airwayConfiguration}',
      (v_block#>>'{distribution,ehlf}')::numeric, (v_block#>>'{distribution,esgf}')::numeric,
      (v_block#>>'{distribution,elg}')::numeric,
      v_user, v_user, v_user
    )
    RETURNING id INTO v_block_id;

    v_cseq := 0;
    FOR v_component IN SELECT jsonb_array_elements(COALESCE(v_block->'components', '[]'::jsonb))
    LOOP
      v_cseq := v_cseq + 1;
      INSERT INTO public.manual_j_load_components (
        mjc_record_number, manual_j_load_block_id, manual_j_report_id, mjc_component_name, mjc_sequence,
        mjc_sensible_cooling_btuh, mjc_latent_cooling_btuh, mjc_total_cooling_btuh, mjc_total_heating_btuh,
        mjc_owner, mjc_created_by, mjc_updated_by
      ) VALUES (
        '', v_block_id, v_report_id, v_component->>'name', v_cseq,
        (v_component#>>'{values,sensibleCoolingBtuh}')::numeric,
        (v_component#>>'{values,latentCoolingBtuh}')::numeric,
        (v_component#>>'{values,totalCoolingBtuh}')::numeric,
        (v_component#>>'{values,totalHeatingBtuh}')::numeric,
        v_user, v_user, v_user
      );
    END LOOP;
  END LOOP;

  v_seq := 0;
  FOR v_material IN SELECT jsonb_array_elements(COALESCE(p_payload->'materials', '[]'::jsonb))
  LOOP
    v_seq := v_seq + 1;
    INSERT INTO public.manual_j_building_materials (
      mjm_record_number, manual_j_report_id, mjm_construction_type, mjm_construction_number,
      mjm_orientation, mjm_area_sq_ft, mjm_cooling_btuh, mjm_heating_btuh, mjm_u_value,
      mjm_description, mjm_is_total_row, mjm_sequence, mjm_owner, mjm_created_by, mjm_updated_by
    ) VALUES (
      '', v_report_id, v_material->>'constructionType', v_material->>'constructionNumber',
      v_material->>'orientation', (v_material->>'areaSqFt')::numeric,
      (v_material->>'coolingBtuh')::numeric, (v_material->>'heatingBtuh')::numeric,
      (v_material->>'uValue')::numeric, v_material->>'description',
      COALESCE((v_material->>'isTotalRow')::boolean, false), v_seq, v_user, v_user, v_user
    );
  END LOOP;

  RETURN v_report_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_manual_j_report(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_manual_j_report(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

