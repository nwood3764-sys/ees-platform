-- The payment request opens in the configuration it is nearly always submitted
-- in, and the combustion answers follow the combustion question.
--
-- Reported: every Health & Safety answer had to be set by hand on every payment
-- request, and the save was blocked by eight required questions that are the
-- same eight answers almost every time. Modeling Software was blank though it
-- is always Energy Plus.
--
-- Defaults, exactly as Nicholas specified them:
--   combustion appliances at test-out   Yes
--   venting / spilling / gas leak /
--   undiluted CO / ambient CO           Passed
--   mold or moisture                    No
--   roof condition                      Good
--   ASHRAE 62.2 performed               yes      (this picklist is lower case)
--   drainage condition                  Good
--   disclosed to the homeowner          Yes
--   modeling software                   Energy Plus
--
-- The five combustion tests are CONDITIONAL on the combustion question, because
-- a test you did not run is not a test that passed: answer No and all five
-- become N/A; answer Yes and they return to Passed. Only a CHANGE to that
-- question rewrites them.
--
-- A default is not a lock. Outside that flip the five are filled only when
-- blank, so a genuine Failed or Warning recorded by an auditor survives every
-- later save -- proved in a rolled-back transaction before shipping, along with
-- both directions of the flip.
--
-- Two layers on purpose, because they cover different paths:
--   * build_ia_payment_request_prefill puts the answers on the CREATE FORM, so
--     the required-field gate is satisfied before the first save rather than
--     after it (the blocked save is what was reported);
--   * the trigger guarantees them however the record is created, and is the
--     only place the conditional flip can live.
--
-- Scoped to the WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST record type. Every
-- other programme's application has its own form and its own answers.

CREATE OR REPLACE FUNCTION public.picklist_id_for_value(p_object text, p_field text, p_value text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT id FROM public.picklist_values
   WHERE picklist_object = p_object
     AND picklist_field  = p_field
     AND picklist_value  = p_value
     AND picklist_is_active
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.picklist_id_for_value(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.picklist_id_for_value(text, text, text) TO authenticated, service_role;

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
      NEW.ia_ambient_co_test   := public.picklist_id_for_value('incentive_applications','ambient_co_test','N/A');
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

DROP TRIGGER IF EXISTS trg_3_ia_health_safety_defaults ON public.incentive_applications;
CREATE TRIGGER trg_3_ia_health_safety_defaults
  BEFORE INSERT OR UPDATE ON public.incentive_applications
  FOR EACH ROW EXECUTE FUNCTION public.apply_ia_health_safety_defaults();

-- Same answers on the create form, so the required-field gate is satisfied
-- before the first save rather than after it. Only ia_modeling_software and the
-- Health & Safety block are added; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.build_ia_payment_request_prefill(p_opportunity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  e          public.enrollments%ROWTYPE;
  o          public.opportunities%ROWTYPE;
  v_from_opp jsonb;
  v_measures jsonb;
BEGIN
  IF p_opportunity_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  SELECT op.* INTO o FROM public.opportunities op
   WHERE op.id = p_opportunity_id AND op.opportunity_is_deleted IS NOT TRUE;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT en.* INTO e
  FROM public.enrollments en
  JOIN public.picklist_values rt ON rt.id = en.enrollment_record_type
  WHERE en.opportunity_id = p_opportunity_id
    AND en.enrollment_is_deleted IS NOT TRUE
    AND rt.picklist_value = 'WI-IRA-MF-HOMES-Project-Reservation'
  ORDER BY en.enrollment_updated_at DESC NULLS LAST
  LIMIT 1;

  v_from_opp := public.ia_work_completed_from_opportunity(p_opportunity_id);
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_agg(v ORDER BY v) END
    INTO v_measures
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(v_from_opp, '[]'::jsonb)) AS v
    UNION
    SELECT jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(COALESCE(e.enrollment_work_measures, 'null'::jsonb)) = 'array'
                  THEN e.enrollment_work_measures ELSE '[]'::jsonb END)
  ) s;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'opportunity_id', o.id,
    'property_id',    COALESCE(e.property_id, o.property_id),
    'building_id',    COALESCE(e.building_id, o.building_id),
    'ia_work_completed', v_measures,
    'ia_application_for', (
      SELECT id FROM public.picklist_values
      WHERE picklist_object='incentive_applications' AND picklist_field='application_for'
        AND picklist_value='Final Installation Payment Request' AND picklist_is_active LIMIT 1),
    'ia_contractor_account_id',         e.enrollment_contractor_account_id,
    'ia_contractor_contact_id',         e.enrollment_contractor_contact_id,
    'ia_has_support_contractor',        e.enrollment_has_support_contractor,
    'ia_support_contractor_account_id', e.enrollment_support_contractor_account_id,
    'ia_support_contractor_contact_id', e.enrollment_support_contractor_contact_id,
    'ia_submitted_by',                  e.enrollment_submitted_by,
    'ia_total_project_cost',            e.enrollment_total_project_cost,
    'ia_building_type',         public.picklist_value_translate(e.enrollment_building_type,         'incentive_applications','building_type'),
    'ia_building_project_type', public.picklist_value_translate(e.enrollment_building_project_type, 'incentive_applications','building_project_type'),
    'ia_income_level',          public.picklist_value_translate(e.enrollment_income_level,          'incentive_applications','income_level'),
    'ia_heating_type',          public.picklist_value_translate(e.enrollment_heating_type,          'incentive_applications','heating_type'),
    'ia_who_gets_paid',         public.picklist_value_translate(e.enrollment_payee,                 'incentive_applications','who_gets_paid'),
    'ia_tax_classification_type', public.picklist_value_translate(e.enrollment_tax_classification,  'incentive_applications','tax_classification_type'),
    'ia_modeling_software',     COALESCE(
        public.picklist_value_translate(e.enrollment_modeling_software, 'incentive_applications','modeling_software'),
        public.picklist_id_for_value('incentive_applications','modeling_software','Energy Plus')),
    'ia_has_combustion_appliances', public.picklist_id_for_value('incentive_applications','has_combustion_appliances','Yes'),
    'ia_venting_test',        public.picklist_id_for_value('incentive_applications','venting_test','Passed'),
    'ia_spilling_test',       public.picklist_id_for_value('incentive_applications','spilling_test','Passed'),
    'ia_gas_leak_test',       public.picklist_id_for_value('incentive_applications','gas_leak_test','Passed'),
    'ia_undiluted_co_test',   public.picklist_id_for_value('incentive_applications','undiluted_co_test','Passed'),
    'ia_ambient_co_test',     public.picklist_id_for_value('incentive_applications','ambient_co_test','Passed'),
    'ia_mold_moisture',       public.picklist_id_for_value('incentive_applications','mold_moisture','No'),
    'ia_roof_condition',      public.picklist_id_for_value('incentive_applications','roof_condition','Good'),
    'ia_ashrae_62_2',         public.picklist_id_for_value('incentive_applications','ashrae_62_2','yes'),
    'ia_drainage_condition',  public.picklist_id_for_value('incentive_applications','drainage_condition','Good'),
    'ia_disclosed_to_homeowner', public.picklist_id_for_value('incentive_applications','disclosed_to_homeowner','Yes')
  ));
END $function$;
REVOKE ALL ON FUNCTION public.build_ia_payment_request_prefill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_ia_payment_request_prefill(uuid) TO authenticated, service_role;

-- Fill the blanks on the payment requests that already exist. The trigger does
-- the rest of the work on the way through.
UPDATE public.incentive_applications ia
SET ia_has_combustion_appliances = COALESCE(ia_has_combustion_appliances,
      public.picklist_id_for_value('incentive_applications','has_combustion_appliances','Yes'))
WHERE ia.ia_is_deleted IS NOT TRUE
  AND ia.ia_record_type = public.picklist_id_for_value('incentive_applications','record_type','WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST');

DO $$
DECLARE v_blank integer;
BEGIN
  SELECT count(*) INTO v_blank FROM public.incentive_applications ia
   WHERE ia.ia_is_deleted IS NOT TRUE
     AND ia.ia_record_type = public.picklist_id_for_value('incentive_applications','record_type','WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST')
     AND (ia.ia_venting_test IS NULL OR ia.ia_spilling_test IS NULL OR ia.ia_gas_leak_test IS NULL
       OR ia.ia_undiluted_co_test IS NULL OR ia.ia_ambient_co_test IS NULL
       OR ia.ia_mold_moisture IS NULL OR ia.ia_roof_condition IS NULL OR ia.ia_ashrae_62_2 IS NULL
       OR ia.ia_drainage_condition IS NULL OR ia.ia_disclosed_to_homeowner IS NULL
       OR ia.ia_modeling_software IS NULL OR ia.ia_has_combustion_appliances IS NULL);
  IF v_blank > 0 THEN
    RAISE EXCEPTION '% payment request(s) still have a blank Health & Safety or modeling answer', v_blank;
  END IF;
END $$;
