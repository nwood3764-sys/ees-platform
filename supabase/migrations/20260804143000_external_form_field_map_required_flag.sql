-- Pre-approval form field-completeness check: mark which mapped form fields are
-- required so the client can block opening the Focus On Energy form and instead
-- list the still-blank fields for the user to complete first. Data-driven — an
-- admin can toggle efm_is_required per field with no code change.
ALTER TABLE public.external_form_field_map
  ADD COLUMN IF NOT EXISTS efm_is_required boolean NOT NULL DEFAULT false;

-- The substantive fields the program requires. The payment-address block is
-- conditional (only when "payment address different" is Yes), so it is NOT
-- marked required here.
UPDATE public.external_form_field_map m
SET efm_is_required = true
FROM public.external_form_targets t
WHERE t.id = m.efm_target_id
  AND t.eft_key = 'wi_ira_mf_homes_assessment_preapproval'
  AND m.efm_is_deleted IS NOT TRUE
  AND m.efm_leap_field IN (
    'enrollment_contractor_name',
    'enrollment_contractor_email',
    'enrollment_contractor_primary_address_line1',
    'enrollment_contractor_primary_city',
    'enrollment_contractor_primary_state',
    'enrollment_contractor_primary_zip',
    'enrollment_owner_organization',
    'enrollment_property_addresses',
    'enrollment_property_type',
    'enrollment_units_per_building',
    'enrollment_modeling_approach',
    'enrollment_number_of_buildings',
    'enrollment_requested_incentive_amount',
    'enrollment_property_lea_numbers',
    'enrollment_building_details',
    'enrollment_estimated_assessment_date'
  );

-- Surface field_label + required in the map the client reads.
CREATE OR REPLACE FUNCTION public.get_external_form_map(p_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'key',              t.eft_key,
      'name',             t.eft_name,
      'kind',             t.eft_kind,
      'base_url',         t.eft_base_url,
      'provider',         t.eft_form_provider,
      'external_form_id', t.eft_external_form_id,
      'object',           t.eft_object,
      'record_type',      t.eft_record_type,
      'submit_note',      t.eft_submit_note,
      'fields', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'leap_field',       m.efm_leap_field,
                 'param',            m.efm_external_param,
                 'transform',        m.efm_value_transform,
                 'option_value_map', m.efm_option_value_map,
                 'field_label',      m.efm_field_label,
                 'required',         m.efm_is_required
               ) ORDER BY m.efm_sort_order, m.efm_record_number)
        FROM public.external_form_field_map m
        WHERE m.efm_target_id = t.id AND m.efm_is_active AND m.efm_is_deleted IS NOT TRUE
      ), '[]'::jsonb)
    )
    FROM public.external_form_targets t
    WHERE t.eft_key = p_key AND t.eft_is_active AND t.eft_is_deleted IS NOT TRUE
    LIMIT 1
  ), '{}'::jsonb);
$function$;

NOTIFY pgrst, 'reload schema';
