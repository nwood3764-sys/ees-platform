-- The Jotform's "Configurable list" -- Unit Number and IQ Code -- as its own
-- section, replacing the loose Property LEA#s field.
--
-- That field was added earlier today straight onto Installation Building
-- Information, where it read as a stray: the Jotform has no standalone LEA
-- field. The number belongs in the configurable list's IQ Code column.
-- Nicholas: "the LEA number is the same as the IQ code. It's on the building
-- record." So IQ Code stays a live read of buildings.ira_confirmation_code_lea
-- rather than a copy -- one number, corrected in one place.
--
-- The Jotform grid offers Add Row; EES files one row per submittal
-- ("Whole Building"), so two plain fields carry it. No child object.

ALTER TABLE public.incentive_applications
  ADD COLUMN IF NOT EXISTS ia_unit_number text;

COMMENT ON COLUMN public.incentive_applications.ia_unit_number IS
  'Unit Number on the submittal form''s configurable list. "Whole Building" for a multifamily project submitted as one row.';

CREATE OR REPLACE FUNCTION public.apply_ia_health_safety_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rt      text;
  v_yes     uuid;
  v_no      uuid;
  v_flipped boolean := false;
BEGIN
  SELECT picklist_value INTO v_rt FROM public.picklist_values WHERE id = NEW.ia_record_type;
  IF v_rt IS DISTINCT FROM 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST' THEN
    RETURN NEW;
  END IF;

  v_yes := public.picklist_id_for_value('incentive_applications','has_combustion_appliances','Yes');
  v_no  := public.picklist_id_for_value('incentive_applications','has_combustion_appliances','No');

  IF TG_OP = 'INSERT' AND NEW.ia_has_combustion_appliances IS NULL THEN
    NEW.ia_has_combustion_appliances := v_yes;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.ia_has_combustion_appliances IS DISTINCT FROM OLD.ia_has_combustion_appliances THEN
    v_flipped := true;
  END IF;

  IF NEW.ia_has_combustion_appliances = v_no THEN
    IF v_flipped OR TG_OP = 'INSERT' THEN
      NEW.ia_venting_test      := public.picklist_id_for_value('incentive_applications','venting_test','N/A');
      NEW.ia_spilling_test     := public.picklist_id_for_value('incentive_applications','spilling_test','N/A');
      NEW.ia_gas_leak_test     := public.picklist_id_for_value('incentive_applications','gas_leak_test','N/A');
      NEW.ia_undiluted_co_test := public.picklist_id_for_value('incentive_applications','undiluted_co_test','N/A');
    END IF;
    NEW.ia_ambient_co_test := COALESCE(NEW.ia_ambient_co_test,
      public.picklist_id_for_value('incentive_applications','ambient_co_test','Passed'));
    IF v_flipped THEN
      NEW.ia_ambient_co_test := public.picklist_id_for_value('incentive_applications','ambient_co_test','Passed');
    END IF;
  ELSE
    NEW.ia_venting_test      := COALESCE(NEW.ia_venting_test,      public.picklist_id_for_value('incentive_applications','venting_test','Passed'));
    NEW.ia_spilling_test     := COALESCE(NEW.ia_spilling_test,     public.picklist_id_for_value('incentive_applications','spilling_test','Passed'));
    NEW.ia_gas_leak_test     := COALESCE(NEW.ia_gas_leak_test,     public.picklist_id_for_value('incentive_applications','gas_leak_test','Passed'));
    NEW.ia_undiluted_co_test := COALESCE(NEW.ia_undiluted_co_test, public.picklist_id_for_value('incentive_applications','undiluted_co_test','Passed'));
    NEW.ia_ambient_co_test   := COALESCE(NEW.ia_ambient_co_test,   public.picklist_id_for_value('incentive_applications','ambient_co_test','Passed'));
    IF v_flipped THEN
      NEW.ia_venting_test      := public.picklist_id_for_value('incentive_applications','venting_test','Passed');
      NEW.ia_spilling_test     := public.picklist_id_for_value('incentive_applications','spilling_test','Passed');
      NEW.ia_gas_leak_test     := public.picklist_id_for_value('incentive_applications','gas_leak_test','Passed');
      NEW.ia_undiluted_co_test := public.picklist_id_for_value('incentive_applications','undiluted_co_test','Passed');
      NEW.ia_ambient_co_test   := public.picklist_id_for_value('incentive_applications','ambient_co_test','Passed');
    END IF;
  END IF;

  NEW.ia_mold_moisture          := COALESCE(NEW.ia_mold_moisture,          public.picklist_id_for_value('incentive_applications','mold_moisture','No'));
  NEW.ia_roof_condition         := COALESCE(NEW.ia_roof_condition,         public.picklist_id_for_value('incentive_applications','roof_condition','Good'));
  NEW.ia_ashrae_62_2            := COALESCE(NEW.ia_ashrae_62_2,            public.picklist_id_for_value('incentive_applications','ashrae_62_2','yes'));
  NEW.ia_drainage_condition     := COALESCE(NEW.ia_drainage_condition,     public.picklist_id_for_value('incentive_applications','drainage_condition','Good'));
  NEW.ia_disclosed_to_homeowner := COALESCE(NEW.ia_disclosed_to_homeowner, public.picklist_id_for_value('incentive_applications','disclosed_to_homeowner','Yes'));
  NEW.ia_modeling_software      := COALESCE(NEW.ia_modeling_software,      public.picklist_id_for_value('incentive_applications','modeling_software','Energy Plus'));
  NEW.ia_unit_number            := COALESCE(NULLIF(BTRIM(NEW.ia_unit_number),''), 'Whole Building');

  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.apply_ia_health_safety_defaults() FROM PUBLIC, anon, authenticated;

UPDATE public.incentive_applications
SET ia_unit_number = COALESCE(NULLIF(BTRIM(ia_unit_number),''), 'Whole Building')
WHERE ia_is_deleted IS NOT TRUE
  AND ia_record_type = public.picklist_id_for_value('incentive_applications','record_type','WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST');

UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
  w.widget_config, '{fields}',
  (SELECT COALESCE(jsonb_agg(
            CASE WHEN f->>'name' = 'property_id.property_zip'
                 THEN f || jsonb_build_object('full_width', true)
                 ELSE f END ORDER BY ord), '[]'::jsonb)
     FROM jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) WITH ORDINALITY AS t(f, ord)
    WHERE f->>'name' <> 'building_id.ira_confirmation_code_lea'))
FROM public.page_layouts pl
WHERE pl.id = w.page_layout_id
  AND pl.page_layout_record_number = 'PL-00382' AND pl.is_deleted IS NOT TRUE
  AND w.is_deleted IS NOT TRUE
  AND w.widget_title = 'Installation Building Information';

UPDATE public.page_layout_sections s
SET section_order = s.section_order + 1
FROM public.page_layouts pl
WHERE pl.id = s.page_layout_id
  AND pl.page_layout_record_number = 'PL-00382' AND pl.is_deleted IS NOT TRUE
  AND s.is_deleted IS NOT TRUE AND s.section_order >= 7;

WITH sec AS (
  INSERT INTO public.page_layout_sections
    (page_layout_id, section_order, section_label, section_columns, section_tab,
     section_is_collapsible, section_is_collapsed_by_default, section_placement)
  SELECT pl.id, 7, 'Configurable List', 2, 'Details', false, false, 'main'
  FROM public.page_layouts pl
  WHERE pl.page_layout_record_number = 'PL-00382' AND pl.is_deleted IS NOT TRUE
    AND NOT EXISTS (SELECT 1 FROM public.page_layout_sections s2
                     WHERE s2.page_layout_id = pl.id AND s2.is_deleted IS NOT TRUE
                       AND s2.section_label = 'Configurable List')
  RETURNING id, page_layout_id
)
INSERT INTO public.page_layout_widgets
  (page_layout_widget_record_number, page_layout_id, section_id, widget_title, widget_type,
   widget_config, widget_position, widget_column)
SELECT '', sec.page_layout_id, sec.id, 'Configurable List', 'field_group',
       jsonb_build_object('fields', jsonb_build_array(
         jsonb_build_object('name','ia_unit_number','type','text','label','Unit Number','column',1),
         jsonb_build_object('name','building_id.ira_confirmation_code_lea','type','related_field',
                            'label','IQ Code','column',2,
                            'related', jsonb_build_object('table','buildings','column','ira_confirmation_code_lea',
                                                          'fk_column','building_id','column_type','text'))
       )), 1, 1
FROM sec;

DO $$
DECLARE v_stray integer; v_fields text;
BEGIN
  SELECT count(*) INTO v_stray
  FROM public.page_layouts pl
  JOIN public.page_layout_widgets w ON w.page_layout_id=pl.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.page_layout_record_number='PL-00382' AND pl.is_deleted IS NOT TRUE
    AND w.widget_title = 'Installation Building Information'
    AND f->>'name' = 'building_id.ira_confirmation_code_lea';
  IF v_stray > 0 THEN
    RAISE EXCEPTION 'The loose LEA field is still on Installation Building Information';
  END IF;

  SELECT string_agg(f->>'label', ', ' ORDER BY f->>'column') INTO v_fields
  FROM public.page_layouts pl
  JOIN public.page_layout_widgets w ON w.page_layout_id=pl.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.page_layout_record_number='PL-00382' AND pl.is_deleted IS NOT TRUE
    AND w.widget_title = 'Configurable List';
  IF v_fields IS DISTINCT FROM 'Unit Number, IQ Code' THEN
    RAISE EXCEPTION 'Configurable List holds: %', COALESCE(v_fields,'(nothing)');
  END IF;
END $$;
