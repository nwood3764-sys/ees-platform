-- Correction to the conditional shipped earlier today (#706).
--
-- That version sent ALL FIVE combustion answers to N/A when the building has no
-- combustion appliances. Nicholas' screenshot of the real form shows four:
-- venting, spilling, gas leak detection and undiluted CO are N/A, but the
-- AMBIENT CO test still reads Passed.
--
-- Which is right, and the distinction is physical rather than clerical: venting,
-- spilling, gas leak and undiluted CO are all measurements taken AT an
-- appliance, so with no appliance there is nothing to test. Ambient CO is a
-- measurement of the air in the building, and an all-electric multifamily
-- building still has air -- the test is performed and it passes.
--
-- Only the No branch changes. The Yes branch, the fill-blanks-only rule that
-- protects a recorded Failed, and every non-combustion default are untouched.

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
    -- Measured at an appliance; there is no appliance.
    IF v_flipped OR TG_OP = 'INSERT' THEN
      NEW.ia_venting_test      := public.picklist_id_for_value('incentive_applications','venting_test','N/A');
      NEW.ia_spilling_test     := public.picklist_id_for_value('incentive_applications','spilling_test','N/A');
      NEW.ia_gas_leak_test     := public.picklist_id_for_value('incentive_applications','gas_leak_test','N/A');
      NEW.ia_undiluted_co_test := public.picklist_id_for_value('incentive_applications','undiluted_co_test','N/A');
    END IF;
    -- Measured in the air, which an all-electric building still has.
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

  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.apply_ia_health_safety_defaults() FROM PUBLIC, anon, authenticated;
