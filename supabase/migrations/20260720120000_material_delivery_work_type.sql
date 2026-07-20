-- =============================================================================
-- Material Delivery work type (Nicholas, 2026-07-20) — the next
-- technician-creatable work type after Building Access, per the final
-- reviewed step list:
--
--   1. Materials Photo                 — the actual materials as they arrived
--   2. Delivery Ticket Photo           — packing slip / BOL
--   3. Delivery Details                — fields: Delivered By (free text:
--                                        UPS, FedEx, freight company, driver),
--                                        Received By (LEAP user select),
--                                        Material Delivered (picklist — NO
--                                        "Miscellaneous" option, ever),
--                                        Quantity Received (number)
--   4. Damaged Materials Photos        — photograph EVERY damaged item
--                                        (unlimited); when nothing is damaged
--                                        the technician marks the step Not
--                                        Applicable with the standard reason
--                                        flow. Completing this step (= damage
--                                        documented) auto-routes a task to the
--                                        work order's Project Coordinator.
--   5. Materials Stored & Secured Photo — where they were placed, plus a
--                                        free-text Storage Location field
--                                        (rack/shelf structure comes later
--                                        with the inventory build).
--
-- Two small generic capabilities added (both reusable, nothing hardcoded):
--   • 'select' work-step field type — options are picklist_values rows under
--     picklist_object='work_step_fields', picklist_field=<the field's name> —
--     admin-manageable like every other picklist.
--   • work_step_templates.wst_completion_notifies_project_coordinator — any
--     step template flagged true routes a High task to the work order's
--     Project Coordinator the moment the step completes (fallback: work
--     order owner). Used here for damage; reusable for Incident Report etc.
-- =============================================================================

-- ── 'select' field type ──────────────────────────────────────────────────────
ALTER TABLE public.work_step_template_fields
  DROP CONSTRAINT work_step_template_fields_wstf_field_type_check;
ALTER TABLE public.work_step_template_fields
  ADD CONSTRAINT work_step_template_fields_wstf_field_type_check
  CHECK (wstf_field_type = ANY (ARRAY['number'::text, 'text'::text, 'select'::text, 'user_multiselect'::text, 'key_source'::text]));

-- save_work_step_field_value: validate 'select' values against the field's
-- admin-managed option list. (Full function replaced; only the select branch
-- is new — everything else is byte-identical to the previous version.)
CREATE OR REPLACE FUNCTION public.save_work_step_field_value(p_step_id uuid, p_template_field_id uuid, p_value text)
RETURNS TABLE(step_id uuid, status text, outcome text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor    uuid := public.current_app_user_id();
  v_step     public.work_steps;
  v_field    public.work_step_template_fields;
  v_cur      text;
  v_txt      text := nullif(trim(coalesce(p_value, '')), '');
  v_num      numeric;
  v_existing uuid;
BEGIN
  SELECT * INTO v_step FROM public.work_steps WHERE id = p_step_id AND work_step_is_deleted IS NOT TRUE;
  IF v_step.id IS NULL THEN
    RETURN QUERY SELECT p_step_id, NULL::text, 'error', 'Work step not found or deleted'; RETURN;
  END IF;

  v_actor := COALESCE(v_actor, v_step.work_step_owner, v_step.work_step_created_by);

  SELECT * INTO v_field FROM public.work_step_template_fields
   WHERE id = p_template_field_id AND wstf_is_deleted IS NOT TRUE AND wstf_is_active IS TRUE
     AND work_step_template_id = v_step.work_step_template_id;
  IF v_field.id IS NULL THEN
    RETURN QUERY SELECT p_step_id, NULL::text, 'error', 'Field does not belong to this work step'; RETURN;
  END IF;

  SELECT picklist_value INTO v_cur FROM public.picklist_values WHERE id = v_step.work_step_status;
  IF v_cur IN ('Completed','Verified','Not Applicable') THEN
    RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
      format('Step is %s — its values are locked', v_cur);
    RETURN;
  END IF;

  IF v_txt IS NULL THEN
    RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
      format('Enter a value for "%s"', v_field.wstf_field_label);
    RETURN;
  END IF;

  IF v_field.wstf_field_type = 'number' THEN
    BEGIN
      v_num := replace(v_txt, ',', '')::numeric;
    EXCEPTION WHEN others THEN
      RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
        format('"%s" must be a number', v_field.wstf_field_label);
      RETURN;
    END;
    IF v_num < 0 THEN
      RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
        format('"%s" must be zero or greater', v_field.wstf_field_label);
      RETURN;
    END IF;
    v_txt := NULL;
  ELSE
    v_num := NULL;
    -- 'select' values must be one of the field's active options.
    IF v_field.wstf_field_type = 'select' AND NOT EXISTS (
      SELECT 1 FROM public.picklist_values pv
      WHERE pv.picklist_object = 'work_step_fields'
        AND pv.picklist_field = v_field.wstf_field_name
        AND pv.picklist_value = v_txt
        AND pv.picklist_is_active IS TRUE
    ) THEN
      RETURN QUERY SELECT p_step_id, v_cur, 'blocked',
        format('"%s" must be one of the listed options', v_field.wstf_field_label);
      RETURN;
    END IF;
  END IF;

  SELECT id INTO v_existing FROM public.work_step_field_values
   WHERE work_step_id = p_step_id AND work_step_template_field_id = p_template_field_id
     AND wsfv_is_deleted IS NOT TRUE
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.work_step_field_values
       SET wsfv_numeric_value = v_num, wsfv_text_value = v_txt,
           wsfv_updated_by = v_actor, wsfv_updated_at = now()
     WHERE id = v_existing;
  ELSE
    INSERT INTO public.work_step_field_values
      (wsfv_record_number, wsfv_owner, wsfv_created_by,
       work_step_id, work_step_template_field_id, wsfv_numeric_value, wsfv_text_value)
    VALUES ('', v_actor, v_actor, p_step_id, p_template_field_id, v_num, v_txt);
  END IF;

  RETURN QUERY SELECT p_step_id, v_cur, 'success',
    format('"%s" saved', v_field.wstf_field_label);
END;
$function$;

-- ── Picklists ────────────────────────────────────────────────────────────────
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
VALUES ('work_orders', 'record_type', 'material_delivery', 'Material Delivery', true,
        (SELECT COALESCE(max(picklist_sort_order),0)+1 FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='record_type'),
        'c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- Material Delivered options — deliberately NO "Miscellaneous". Every
-- delivery names a real category; Admin extends the list in LEAP Admin.
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
VALUES
  ('work_step_fields', 'material_delivered', 'Attic Insulation',      'Attic Insulation',      true, 10,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'material_delivered', 'Wall Insulation',       'Wall Insulation',       true, 20,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'material_delivered', 'Pipe Insulation',       'Pipe Insulation',       true, 30,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'material_delivered', 'Air Sealing Materials', 'Air Sealing Materials', true, 40,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'material_delivered', 'Exhaust Fans',          'Exhaust Fans',          true, 50,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'material_delivered', 'Shower Heads',          'Shower Heads',          true, 60,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'material_delivered', 'Faucet Aerators',       'Faucet Aerators',       true, 70,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'material_delivered', 'HVAC Equipment',        'HVAC Equipment',        true, 80,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'material_delivered', 'Tools',                 'Tools',                 true, 90,  'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('work_step_fields', 'material_delivered', 'Safety Equipment',      'Safety Equipment',      true, 100, 'c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- ── Step-completion → Project Coordinator task (generic, flag-driven) ────────
ALTER TABLE public.work_step_templates
  ADD COLUMN wst_completion_notifies_project_coordinator boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.work_step_templates.wst_completion_notifies_project_coordinator IS
  'When true, completing a step from this template routes a High task to the work order''s Project Coordinator (fallback: work order owner). Used for exception steps like Damaged Materials Photos.';

CREATE OR REPLACE FUNCTION public.notify_project_coordinator_on_step_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_new_status text;
  v_old_status text;
  v_flag       boolean;
  v_wo         public.work_orders%ROWTYPE;
  v_reviewer   uuid;
BEGIN
  IF NEW.work_step_is_deleted IS TRUE THEN RETURN NULL; END IF;
  IF NEW.work_step_status IS NOT DISTINCT FROM OLD.work_step_status THEN RETURN NULL; END IF;

  SELECT picklist_value INTO v_new_status FROM public.picklist_values WHERE id = NEW.work_step_status;
  IF v_new_status IS DISTINCT FROM 'Completed' THEN RETURN NULL; END IF;
  SELECT picklist_value INTO v_old_status FROM public.picklist_values WHERE id = OLD.work_step_status;
  IF v_old_status = 'Completed' THEN RETURN NULL; END IF;

  SELECT wst_completion_notifies_project_coordinator INTO v_flag
  FROM public.work_step_templates WHERE id = NEW.work_step_template_id;
  IF v_flag IS NOT TRUE THEN RETURN NULL; END IF;

  SELECT wo.* INTO v_wo
  FROM public.work_orders wo
  JOIN public.work_plans wp ON wp.id = NEW.work_plan_id
  WHERE wo.id = wp.work_order_id AND wo.work_order_is_deleted IS NOT TRUE;
  IF v_wo.id IS NULL THEN RETURN NULL; END IF;

  v_reviewer := COALESCE(v_wo.project_coordinator_id, v_wo.work_order_owner);
  IF v_reviewer IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.tasks (subject, description, status, priority, owner_id, created_by_id,
                            related_object, related_id, is_automated, automation_rule, due_date)
  VALUES (
    format('%s — %s on %s', NEW.work_step_name, v_wo.work_order_record_number, COALESCE(v_wo.work_order_property_name, 'the property')),
    format('Step "%s" was completed on %s (%s) — review the photos and comment, and follow up (e.g. reorder damaged materials). Open the work order: /work_orders/%s',
           NEW.work_step_name, v_wo.work_order_record_number, v_wo.work_order_name, v_wo.id),
    'Open', 'High', v_reviewer, COALESCE(NEW.work_step_updated_by, NEW.work_step_owner),
    'work_orders', v_wo.id, true, 'work_step_completion_pc_notification',
    (now() AT TIME ZONE 'America/Chicago')::date
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_project_coordinator_on_step_completion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_work_steps_pc_completion_notification
AFTER UPDATE ON public.work_steps
FOR EACH ROW EXECUTE FUNCTION public.notify_project_coordinator_on_step_completion();

-- ── Work type + plan template + steps + fields ───────────────────────────────
DO $$
DECLARE
  v_nick   uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_lead   uuid := '4a93279e-f88e-4f12-9db8-6bd4e0e80262'; -- Lead Technician
  v_psl    uuid := '7495dd05-ec12-4dc0-ad07-db53daf78487'; -- Project Site Lead
  v_photo  uuid := '16130b3e-e416-4d92-bf23-ec0f8aeee3e1'; -- Photo evidence type
  v_rt     uuid;
  v_wpt    uuid;
  v_wt     uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid;
BEGIN
  SELECT id INTO v_rt FROM picklist_values
  WHERE picklist_object='work_orders' AND picklist_field='record_type' AND picklist_value='material_delivery';

  INSERT INTO work_plan_templates (wpt_record_number, wpt_name, wpt_description, wpt_is_active, wpt_owner, wpt_created_by)
  VALUES ('', 'Material Delivery - Standard',
          'Photo-evidenced material receiving: materials as arrived, delivery ticket, delivery details (delivered by / received by / material / quantity), damaged-materials documentation (N/A when nothing damaged), and stored-and-secured photo with storage location.',
          true, v_nick, v_nick)
  RETURNING id INTO v_wpt;

  INSERT INTO work_step_templates (wst_record_number, wst_name, wst_description, wst_is_active,
    wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id, wst_photos_required_count,
    wst_owner, wst_created_by)
  VALUES ('', 'Materials Photo', 'Photograph the actual materials as they arrived, before unloading or putting anything away.', true,
    v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO v_s1;

  INSERT INTO work_step_templates (wst_record_number, wst_name, wst_description, wst_is_active,
    wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id, wst_photos_required_count,
    wst_owner, wst_created_by)
  VALUES ('', 'Delivery Ticket Photo', 'Photograph the delivery ticket / packing slip / bill of lading showing the supplier and quantities.', true,
    v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO v_s2;

  INSERT INTO work_step_templates (wst_record_number, wst_name, wst_description, wst_is_active,
    wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id, wst_photos_required_count,
    wst_owner, wst_created_by)
  VALUES ('', 'Delivery Details', 'Record who delivered (UPS, FedEx, freight company, supplier driver), who received, what material was delivered, and the quantity counted against the ticket.', true,
    v_lead, v_psl, NULL, 0, v_nick, v_nick)
  RETURNING id INTO v_s3;

  INSERT INTO work_step_templates (wst_record_number, wst_name, wst_description, wst_is_active,
    wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id, wst_photos_required_count,
    wst_completion_notifies_project_coordinator, wst_owner, wst_created_by)
  VALUES ('', 'Damaged Materials Photos', 'Photograph EVERY damaged item — add as many photos as needed, there is no limit — and describe the damage. If nothing is damaged, mark this step Not Applicable with the reason "No damaged materials". Completing this step notifies the Project Coordinator.', true,
    v_lead, v_psl, v_photo, 1, true, v_nick, v_nick)
  RETURNING id INTO v_s4;

  INSERT INTO work_step_templates (wst_record_number, wst_name, wst_description, wst_is_active,
    wst_assigned_owner_role_id, wst_verifier_role_id, wst_required_evidence_type_id, wst_photos_required_count,
    wst_owner, wst_created_by)
  VALUES ('', 'Materials Stored & Secured Photo', 'Photograph the materials where they were placed, stored, and secured, and record the storage location.', true,
    v_lead, v_psl, v_photo, 1, v_nick, v_nick)
  RETURNING id INTO v_s5;

  INSERT INTO work_plan_template_entries (wpte_record_number, wpte_name, wpte_created_by, work_plan_template_id, work_step_template_id, wpte_execution_order)
  VALUES
    ('', 'Materials Photo', v_nick, v_wpt, v_s1, 1),
    ('', 'Delivery Ticket Photo', v_nick, v_wpt, v_s2, 2),
    ('', 'Delivery Details', v_nick, v_wpt, v_s3, 3),
    ('', 'Damaged Materials Photos', v_nick, v_wpt, v_s4, 4),
    ('', 'Materials Stored & Secured Photo', v_nick, v_wpt, v_s5, 5);

  INSERT INTO work_step_template_fields (wstf_record_number, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_is_required, wstf_unit, wstf_sort_order, wstf_owner, wstf_created_by)
  VALUES
    ('', v_s3, 'Delivered By',       'delivered_by',       'text',             true, NULL, 1, v_nick, v_nick),
    ('', v_s3, 'Received By',        'received_by',        'user_multiselect', true, NULL, 2, v_nick, v_nick),
    ('', v_s3, 'Material Delivered', 'material_delivered', 'select',           true, NULL, 3, v_nick, v_nick),
    ('', v_s3, 'Quantity Received',  'quantity_received',  'number',           true, NULL, 4, v_nick, v_nick),
    ('', v_s5, 'Storage Location',   'storage_location',   'text',             true, NULL, 1, v_nick, v_nick);

  INSERT INTO work_types (work_type_record_number, work_type_name, work_type_description, work_type_is_active,
    work_type_duration_minutes, work_type_default_work_plan_template_id, work_type_default_work_order_record_type,
    work_type_is_technician_creatable, work_type_owner, work_type_created_by)
  VALUES ('', 'Material Delivery',
          'Receive a material delivery on site or at the shop: photograph the materials and ticket, record delivered by / received by / material / quantity, document any damage, and photograph the stored and secured materials with their storage location.',
          true, 30, v_wpt, v_rt, true, v_nick, v_nick)
  RETURNING id INTO v_wt;
END $$;

NOTIFY pgrst, 'reload schema';
