-- =====================================================================
-- 'photo' work-step field type (Nicholas, 2026-07-22): named photo
-- prompts that sit in the screen flow like any other prompt. Each
-- required 'photo' field must have a photo on the step tagged with the
-- field's name (photos.photo_type = wstf_field_name). Reusable for every
-- section that needs specific, labeled photos.
--
-- Applied here to the three mechanical assessment sections: a
-- "Total Equipment Photo" and an "Equipment Nameplate Photo" per system,
-- replacing the single generic required photo.
-- =====================================================================

-- 1. Allow 'photo' as a field type.
ALTER TABLE public.work_step_template_fields
  DROP CONSTRAINT work_step_template_fields_wstf_field_type_check;
ALTER TABLE public.work_step_template_fields
  ADD CONSTRAINT work_step_template_fields_wstf_field_type_check
  CHECK (wstf_field_type = ANY (ARRAY['number'::text, 'text'::text, 'select'::text, 'user_multiselect'::text, 'key_source'::text, 'photo'::text]));

-- 2. Evidence gate: honor required 'photo' fields; exclude them from the
--    required-VALUE check (they carry a photo, not a field value).
CREATE OR REPLACE FUNCTION public._work_step_evidence_gap(p_step work_steps)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_etype       text;
  v_photo_total integer := 0;
  v_before_n    integer := 0;
  v_after_n     integer := 0;
  v_doc_n       integer := 0;
  v_video_n     integer := 0;
  v_req_count   integer := COALESCE(p_step.work_step_photos_required_count, 0);
  v_missing_field text;
  v_missing_photo text;
BEGIN
  SELECT picklist_value INTO v_etype
    FROM public.picklist_values WHERE id = p_step.work_step_required_evidence_type_id;

  SELECT
    count(*),
    count(*) FILTER (WHERE lower(coalesce(photo_type,'')) = 'before'),
    count(*) FILTER (WHERE lower(coalesce(photo_type,'')) = 'after')
  INTO v_photo_total, v_before_n, v_after_n
  FROM public.photos
  WHERE work_step_id = p_step.id AND is_deleted = false;

  IF v_req_count > 0 AND v_photo_total < v_req_count THEN
    RETURN format('Step "%s" requires %s photo(s); %s captured. Capture the remaining photo(s) before completing.',
                  p_step.work_step_name, v_req_count, v_photo_total);
  END IF;

  IF p_step.work_step_photo_before_required AND v_before_n < 1 THEN
    RETURN format('Step "%s" requires a BEFORE photo; none captured. Capture a before photo before completing.',
                  p_step.work_step_name);
  END IF;

  IF p_step.work_step_photo_after_required AND v_after_n < 1 THEN
    RETURN format('Step "%s" requires an AFTER photo; none captured. Capture an after photo before completing.',
                  p_step.work_step_name);
  END IF;

  -- Named photo prompts: each required 'photo' field needs a photo tagged with
  -- its field name (photos.photo_type = wstf_field_name).
  SELECT f.wstf_field_label INTO v_missing_photo
  FROM public.work_step_template_fields f
  WHERE f.work_step_template_id = p_step.work_step_template_id
    AND f.wstf_is_deleted IS NOT TRUE AND f.wstf_is_active IS TRUE
    AND f.wstf_is_required IS TRUE AND f.wstf_field_type = 'photo'
    AND NOT EXISTS (
      SELECT 1 FROM public.photos ph
      WHERE ph.work_step_id = p_step.id AND ph.is_deleted = false
        AND ph.photo_type = f.wstf_field_name
    )
  ORDER BY f.wstf_sort_order
  LIMIT 1;
  IF v_missing_photo IS NOT NULL THEN
    RETURN format('Step "%s" needs the "%s" — capture it before completing.',
                  p_step.work_step_name, v_missing_photo);
  END IF;

  IF v_etype = 'Document Upload' THEN
    SELECT count(*) INTO v_doc_n
    FROM public.documents
    WHERE related_object = 'work_steps' AND related_id = p_step.id AND is_deleted = false;
    IF v_doc_n < 1 THEN
      RETURN format('Step "%s" requires a document upload; none attached. Upload the required document before completing.',
                    p_step.work_step_name);
    END IF;
  END IF;

  IF v_etype = 'Video' THEN
    SELECT count(*) INTO v_video_n
    FROM public.documents
    WHERE related_object = 'work_steps' AND related_id = p_step.id AND is_deleted = false
      AND mime_type ILIKE 'video/%';
    IF v_video_n < 1 THEN
      RETURN format('Step "%s" requires a video; none attached. Record and attach the video before completing.',
                    p_step.work_step_name);
    END IF;
  END IF;

  -- Required value fields (measurements, selects, text) need saved values.
  -- 'photo' fields are handled above, not here.
  SELECT f.wstf_field_label INTO v_missing_field
  FROM public.work_step_template_fields f
  WHERE f.work_step_template_id = p_step.work_step_template_id
    AND f.wstf_is_deleted IS NOT TRUE AND f.wstf_is_active IS TRUE AND f.wstf_is_required IS TRUE
    AND f.wstf_field_type <> 'photo'
    AND NOT EXISTS (
      SELECT 1 FROM public.work_step_field_values v
      WHERE v.work_step_id = p_step.id AND v.work_step_template_field_id = f.id
        AND v.wsfv_is_deleted IS NOT TRUE
        AND (v.wsfv_numeric_value IS NOT NULL
             OR nullif(trim(coalesce(v.wsfv_text_value,'')),'') IS NOT NULL)
    )
  ORDER BY f.wstf_sort_order
  LIMIT 1;
  IF v_missing_field IS NOT NULL THEN
    RETURN format('Step "%s" requires "%s" — enter the value before completing.',
                  p_step.work_step_name, v_missing_field);
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._work_step_evidence_gap(work_steps) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._work_step_evidence_gap(work_steps) TO authenticated, service_role;

-- 3. Add the two named photo prompts to the three mechanical sections,
--    replacing the single generic required photo.
DO $$
DECLARE
  v_nick uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_tpl  uuid;
BEGIN
  FOR v_tpl IN
    SELECT id FROM public.work_step_templates
    WHERE wst_name IN ('Heating System','Cooling System','Water Heating System')
      AND wst_is_deleted IS NOT TRUE
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.work_step_template_fields
      WHERE work_step_template_id = v_tpl AND wstf_field_name = 'total_equipment_photo' AND wstf_is_deleted IS NOT TRUE
    ) THEN
      -- Photos lead the flow: shift existing prompts down, insert photos at 1 & 2.
      UPDATE public.work_step_template_fields
        SET wstf_sort_order = wstf_sort_order + 2
        WHERE work_step_template_id = v_tpl AND wstf_is_deleted IS NOT TRUE;

      INSERT INTO public.work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
      VALUES
        ('', v_tpl, 'Total Equipment Photo',     'total_equipment_photo', 'photo', true, NULL, 1, v_nick, v_nick),
        ('', v_tpl, 'Equipment Nameplate Photo', 'nameplate_photo',       'photo', true, NULL, 2, v_nick, v_nick);

      -- The named photos are the gate now; drop the generic single-photo requirement.
      UPDATE public.work_step_templates
        SET wst_photos_required_count = 0, wst_updated_by = v_nick, wst_updated_at = now()
        WHERE id = v_tpl;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
