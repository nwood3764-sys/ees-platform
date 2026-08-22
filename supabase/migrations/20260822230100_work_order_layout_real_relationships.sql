-- ---------------------------------------------------------------------------
-- Work order layouts point at real relationships, not import text
--
-- Nicholas, 2026-08-22, from the Service Appointment Information section on
-- WO-00204: "why aren't the assigned to, assigned technician, or assigned
-- subcontractor fields users? They have to be related lists. They can't be
-- text fields. How did we already solve this... and these fields should be
-- deleted."
--
-- We had already solved it. Every one of those fields exists twice on
-- work_orders: once as a text column carried over from the Salesforce import,
-- and once as the real relationship. The layouts were bound to the text half.
-- All seven text columns hold ZERO values across all 109 live work orders —
-- staff have been typing into fields that were never read, and the record page
-- showed empty boxes for facts the platform already had.
--
--   work_order_assigned_to             -> work_order_owner                       (users)
--   work_order_assigned_technician     -> assigned_technician_id                 (users)
--   work_order_assigned_subcontractor  -> work_order_service_provider_account_id (accounts)
--   work_order_subcontractor_assigned_date -> work_order_subcontractor_assigned_at (timestamptz)
--   work_order_service_appointment     -> the Service Appointments related list, which
--                                         every one of these layouts already carries
--   work_order_property_name           -> property_id  (buildings/units hang off it)
--   work_order_building                -> building_id
--
-- The last two are worse than dead: work_order_property_name / _building are
-- denormalized mirrors that work_order_inherit_parent_fields() rewrites on
-- every save, so anything typed into them was silently overwritten.
--
-- Also dropped: assigned_subcontractor_id, a bare uuid with no foreign key, no
-- rows, and no layout — superseded by work_order_service_provider_account_id.
--
-- Dependency sweep before dropping: 0 functions, 0 views, 0 reports, 0 report
-- filters, 0 saved list views, 0 field_metadata rows reference any of the six
-- dropped columns. Only the layouts rewritten here.
-- ---------------------------------------------------------------------------

DO $do$
DECLARE
  v_rule   record;
  v_widget record;
  v_field  jsonb;
  v_out    jsonb;
  v_present text[];
  v_replaced integer := 0;
  v_removed  integer := 0;
BEGIN
  FOR v_rule IN
    SELECT * FROM (VALUES
      ('work_order_property_name',              'property_id',                            'Property',               'lookup'),
      ('work_order_building',                   'building_id',                            'Building',               'lookup'),
      ('work_order_assigned_to',                'work_order_owner',                       'Work Order Owner',       'lookup'),
      ('work_order_assigned_technician',        'assigned_technician_id',                 'Assigned Technician',    'lookup'),
      ('work_order_assigned_subcontractor',     'work_order_service_provider_account_id', 'Assigned Subcontractor', 'lookup'),
      ('work_order_subcontractor_assigned_date','work_order_subcontractor_assigned_at',   'Subcontractor Assigned', 'datetime'),
      ('work_order_service_appointment',        NULL,                                     NULL,                     NULL)
    ) AS t(legacy, replacement, label, ftype)
  LOOP
    FOR v_widget IN
      SELECT w.id, w.widget_config, s.page_layout_id
        FROM page_layout_widgets w
        JOIN page_layout_sections s ON s.id = w.section_id AND COALESCE(s.is_deleted,false) = false
        JOIN page_layouts l ON l.id = s.page_layout_id AND COALESCE(l.is_deleted,false) = false
       WHERE COALESCE(w.is_deleted,false) = false
         AND w.widget_type = 'field_group'
         AND l.page_layout_object = 'work_orders'
         AND w.widget_config @> jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('name', v_rule.legacy)))
    LOOP
      -- What the layout ALREADY shows, so a replacement never lands twice.
      SELECT array_agg(f2->>'name') INTO v_present
        FROM page_layout_widgets w2
        JOIN page_layout_sections s2 ON s2.id = w2.section_id AND COALESCE(s2.is_deleted,false) = false
        CROSS JOIN LATERAL jsonb_array_elements(w2.widget_config->'fields') f2
       WHERE s2.page_layout_id = v_widget.page_layout_id
         AND COALESCE(w2.is_deleted,false) = false
         AND w2.widget_type = 'field_group';

      v_out := '[]'::jsonb;
      FOR v_field IN SELECT f FROM jsonb_array_elements(v_widget.widget_config->'fields') f LOOP
        IF v_field->>'name' <> v_rule.legacy THEN
          v_out := v_out || jsonb_build_array(v_field);
        ELSIF v_rule.replacement IS NOT NULL
              AND NOT (v_rule.replacement = ANY(COALESCE(v_present, ARRAY[]::text[]))) THEN
          -- Swap in place: the replacement keeps the legacy field's column and
          -- position, so the section reads the same, only with a live field.
          v_out := v_out || jsonb_build_array(
            (v_field - 'lookup_dependency' - 'related')
            || jsonb_build_object('name', v_rule.replacement,
                                  'label', v_rule.label,
                                  'type',  v_rule.ftype));
          v_replaced := v_replaced + 1;
        ELSE
          v_removed := v_removed + 1;  -- dead field, or the real one is already shown
        END IF;
      END LOOP;

      UPDATE page_layout_widgets
         SET widget_config = jsonb_set(widget_config, '{fields}', v_out),
             updated_at = now()
       WHERE id = v_widget.id;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Work order layouts: % field(s) repointed, % dead field(s) removed.', v_replaced, v_removed;
END $do$;

-- Now that the layouts point at the real relationships, the import text is
-- unreferenced. Every one of these is empty on all 109 live work orders.
ALTER TABLE public.work_orders
  DROP COLUMN IF EXISTS work_order_assigned_to,
  DROP COLUMN IF EXISTS work_order_assigned_technician,
  DROP COLUMN IF EXISTS work_order_assigned_subcontractor,
  DROP COLUMN IF EXISTS work_order_service_appointment,
  DROP COLUMN IF EXISTS work_order_subcontractor_assigned_date,
  DROP COLUMN IF EXISTS assigned_subcontractor_id;

-- ---------------------------------------------------------------------------
-- Re-run the parent-chain scope sweep. Layouts that just gained Property or
-- Building now satisfy dependencies they could not before — "Work Order
-- Layout", the default that WO-00204 uses, had no Property field at all, which
-- is why its Unit picker listed every unit in the platform.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_rule    record;
  v_widget  record;
  v_field   jsonb;
  v_out     jsonb;
  v_layout_cols text[];
  v_ok      boolean;
  v_dep     text;
  v_touched integer := 0;
BEGIN
  FOR v_rule IN
    SELECT * FROM (VALUES
      ('work_orders', 'unit_id',        'units_for_building',          ARRAY['building_id','property_id']),
      ('work_orders', 'building_id',    'buildings_for_property',      ARRAY['property_id']),
      ('work_orders', 'project_id',     'projects_for_opportunity',    ARRAY['opportunity_id']),
      ('work_orders', 'opportunity_id', 'opportunities_for_property',  ARRAY['property_id']),
      ('work_orders', 'contact_id',     'contacts_for_property_chain', ARRAY['property_id'])
    ) AS t(obj, field, kind, depends_on)
  LOOP
    FOR v_widget IN
      SELECT w.id, w.widget_config, l.id AS layout_id
        FROM page_layout_widgets w
        JOIN page_layout_sections s ON s.id = w.section_id AND COALESCE(s.is_deleted,false) = false
        JOIN page_layouts l ON l.id = s.page_layout_id AND COALESCE(l.is_deleted,false) = false
       WHERE COALESCE(w.is_deleted,false) = false
         AND w.widget_type = 'field_group'
         AND l.page_layout_object = v_rule.obj
         AND w.widget_config @> jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('name', v_rule.field)))
    LOOP
      SELECT array_agg(f2->>'name') INTO v_layout_cols
        FROM page_layout_widgets w2
        JOIN page_layout_sections s2 ON s2.id = w2.section_id AND COALESCE(s2.is_deleted,false) = false
        CROSS JOIN LATERAL jsonb_array_elements(w2.widget_config->'fields') f2
       WHERE s2.page_layout_id = v_widget.layout_id
         AND COALESCE(w2.is_deleted,false) = false
         AND w2.widget_type = 'field_group';

      v_ok := true;
      FOREACH v_dep IN ARRAY v_rule.depends_on LOOP
        IF NOT (v_dep = ANY(COALESCE(v_layout_cols, ARRAY[]::text[]))) THEN
          v_ok := false;
        END IF;
      END LOOP;
      CONTINUE WHEN NOT v_ok;

      v_out := '[]'::jsonb;
      FOR v_field IN SELECT f FROM jsonb_array_elements(v_widget.widget_config->'fields') f LOOP
        IF v_field->>'name' = v_rule.field AND NOT (v_field ? 'lookup_dependency') THEN
          v_field := v_field
            || jsonb_build_object('type', 'lookup')
            || jsonb_build_object('lookup_dependency', jsonb_build_object(
                 'kind', v_rule.kind,
                 'depends_on', to_jsonb(v_rule.depends_on)));
          v_touched := v_touched + 1;
        END IF;
        v_out := v_out || jsonb_build_array(v_field);
      END LOOP;

      UPDATE page_layout_widgets
         SET widget_config = jsonb_set(widget_config, '{fields}', v_out),
             updated_at = now()
       WHERE id = v_widget.id;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Scoped % further child lookup field(s).', v_touched;
END $do$;

NOTIFY pgrst, 'reload schema';
