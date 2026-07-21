-- =============================================================================
-- Work order page layouts: point Project / Opportunity / Property / Building /
-- Unit fields at their real FK columns so they render as hyperlinks.
--
-- Symptom: on a work order record detail the Project showed a name but was not
-- clickable, and the Opportunity was blank — even though project_id and
-- opportunity_id were correctly set on every record. Cause: the field_group
-- widgets displayed the denormalized *text* columns (work_order_project,
-- work_order_opportunity, work_order_property, work_order_building,
-- work_order_unit). The text columns are inconsistently populated (opportunity
-- text is null) and, being plain text, never hyperlink.
--
-- Fix: rewrite those field entries to the corresponding *_id FK lookup columns
-- (type 'lookup' with lookup_table / lookup_field), which the record renderer
-- resolves to a label and a hyperlink. Original label / required flags are
-- preserved. All other fields pass through untouched. Idempotent — layouts
-- already using the FK columns are unaffected.
-- =============================================================================

DO $$
DECLARE
  w          RECORD;
  fld        jsonb;
  mapped     jsonb;
  new_fields jsonb;
BEGIN
  FOR w IN
    SELECT plw.id, plw.widget_config
    FROM public.page_layout_widgets plw
    JOIN public.page_layouts pl ON pl.id = plw.page_layout_id
    WHERE pl.page_layout_object = 'work_orders'
      AND pl.is_deleted IS NOT TRUE
      AND plw.is_deleted IS NOT TRUE
      AND plw.widget_type = 'field_group'
      AND plw.widget_config ? 'fields'
  LOOP
    new_fields := '[]'::jsonb;
    FOR fld IN SELECT * FROM jsonb_array_elements(w.widget_config->'fields')
    LOOP
      mapped := CASE fld->>'name'
        WHEN 'work_order_project'     THEN jsonb_build_object('name','project_id',    'type','lookup','lookup_field','project_name',    'lookup_table','projects')
        WHEN 'work_order_opportunity' THEN jsonb_build_object('name','opportunity_id','type','lookup','lookup_field','opportunity_name','lookup_table','opportunities')
        WHEN 'work_order_property'    THEN jsonb_build_object('name','property_id',   'type','lookup','lookup_field','property_name',   'lookup_table','properties')
        WHEN 'work_order_building'    THEN jsonb_build_object('name','building_id',   'type','lookup','lookup_field','building_name',   'lookup_table','buildings')
        WHEN 'work_order_unit'        THEN jsonb_build_object('name','unit_id',       'type','lookup','lookup_field','unit_name',       'lookup_table','units')
        ELSE NULL
      END;

      IF mapped IS NOT NULL THEN
        IF fld ? 'label'    THEN mapped := mapped || jsonb_build_object('label',    fld->'label');    END IF;
        IF fld ? 'required' THEN mapped := mapped || jsonb_build_object('required', fld->'required'); END IF;
        new_fields := new_fields || mapped;
      ELSE
        new_fields := new_fields || fld;
      END IF;
    END LOOP;

    UPDATE public.page_layout_widgets
       SET widget_config = jsonb_set(widget_config, '{fields}', new_fields),
           updated_at    = now()
     WHERE id = w.id;
  END LOOP;
END $$;
