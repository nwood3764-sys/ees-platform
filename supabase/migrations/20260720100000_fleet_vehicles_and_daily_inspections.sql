-- =============================================================================
-- Fleet workstream: Daily Vehicle Inspection (Nicholas, 2026-07-20 — the
-- parked workstream, now called for).
--
-- The baseline already ships `vehicles` and `vehicle_activities` complete with
-- record numbers, RLS, role access, audit triggers, and picklists — so this
-- migration is purely ADDITIVE on top of them:
--
--   • "Daily Inspection" activity type + record type. One record covers the
--     whole day (odometer/gas start + return legs), matching the paper forms
--     it replaces.
--   • Start/return leg columns + attestation on vehicle_activities
--     (existing va_odometer_reading serves as the start reading).
--   • vehicle_inspection_item_templates (VIT-) — admin-manageable checklist
--     config, scopable per vehicle type: box trucks get 6 tire photos (rear
--     duals inner+outer), other types get 4.
--   • vehicle_activity_items (VAI-) — the instantiated checklist on one
--     inspection. Photos attach through the photos table
--     (related_object='vehicle_activity_items') into the new fleet-evidence
--     bucket.
-- =============================================================================

-- ── Picklist additions ───────────────────────────────────────────────────────
INSERT INTO public.picklist_values (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_created_by)
VALUES
  ('vehicle_activities', 'va_activity_type', 'Daily Inspection', 'Daily Inspection', true, 5, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('vehicle_activities', 'record_type', 'daily_inspection', 'Daily Inspection', true, 5, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('vehicle_activities', 'gas_level', 'E',   'E',   true, 10, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('vehicle_activities', 'gas_level', '1/4', '1/4', true, 20, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('vehicle_activities', 'gas_level', '1/2', '1/2', true, 30, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('vehicle_activities', 'gas_level', '3/4', '3/4', true, 40, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'),
  ('vehicle_activities', 'gas_level', 'F',   'F',   true, 50, 'c5a01ec8-960f-42ab-8a9e-a49822de89af');

-- ── Additive columns on vehicle_activities ───────────────────────────────────
ALTER TABLE public.vehicle_activities
  ADD COLUMN va_odometer_return  numeric,
  ADD COLUMN va_gas_level_start  uuid REFERENCES public.picklist_values(id),
  ADD COLUMN va_gas_level_return uuid REFERENCES public.picklist_values(id),
  ADD COLUMN va_attested_at      timestamptz,
  ADD COLUMN va_attested_by      uuid REFERENCES public.users(id);

COMMENT ON COLUMN public.vehicle_activities.va_odometer_return IS
  'Return-leg odometer for Daily Inspection activities; va_odometer_reading holds the start reading.';

-- ── New tables ───────────────────────────────────────────────────────────────
CREATE SEQUENCE public.seq_vehicle_activity_items;
CREATE SEQUENCE public.seq_vehicle_inspection_item_templates;

CREATE TABLE public.vehicle_inspection_item_templates (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viit_record_number        text NOT NULL DEFAULT '',
  viit_name                 text NOT NULL,
  viit_description          text,
  viit_leg                  text NOT NULL CHECK (viit_leg IN ('pre_trip','return')),
  viit_sort_order           integer NOT NULL,
  viit_photos_required      integer NOT NULL DEFAULT 0,
  viit_requires_condition   boolean NOT NULL DEFAULT true,
  -- NULL = applies to every vehicle type; else the vehicle_type picklist ids
  -- it applies to (how box trucks get their 6-tire set while others get 4).
  viit_vehicle_type_ids     uuid[],
  viit_is_active            boolean NOT NULL DEFAULT true,
  viit_owner                uuid NOT NULL REFERENCES public.users(id),
  viit_created_by           uuid REFERENCES public.users(id),
  viit_created_at           timestamptz NOT NULL DEFAULT now(),
  viit_updated_by           uuid REFERENCES public.users(id),
  viit_updated_at           timestamptz,
  viit_is_deleted           boolean NOT NULL DEFAULT false,
  viit_deleted_at           timestamptz,
  viit_deleted_by           uuid REFERENCES public.users(id),
  viit_deletion_reason      text
);

CREATE TABLE public.vehicle_activity_items (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vai_record_number         text NOT NULL DEFAULT '',
  vai_name                  text NOT NULL,
  vehicle_activity_id       uuid NOT NULL REFERENCES public.vehicle_activities(id),
  inspection_item_template_id uuid REFERENCES public.vehicle_inspection_item_templates(id),
  vai_leg                   text NOT NULL CHECK (vai_leg IN ('pre_trip','return')),
  vai_sort_order            integer NOT NULL,
  vai_photos_required       integer NOT NULL DEFAULT 0,
  vai_requires_condition    boolean NOT NULL DEFAULT true,
  vai_condition             text CHECK (vai_condition IN ('ok','needs_repair')),
  vai_comment               text,
  vai_completed_at          timestamptz,
  vai_created_by            uuid REFERENCES public.users(id),
  vai_created_at            timestamptz NOT NULL DEFAULT now(),
  vai_updated_by            uuid REFERENCES public.users(id),
  vai_updated_at            timestamptz,
  vai_is_deleted            boolean NOT NULL DEFAULT false,
  vai_deleted_at            timestamptz,
  vai_deleted_by            uuid REFERENCES public.users(id),
  vai_deletion_reason       text
);
CREATE INDEX idx_vai_activity ON public.vehicle_activity_items (vehicle_activity_id, vai_sort_order);

-- ── Record-number triggers ───────────────────────────────────────────────────
CREATE FUNCTION public.set_vai_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public','pg_catalog'
AS $$ BEGIN IF NEW.vai_record_number IS NULL OR NEW.vai_record_number = '' THEN NEW.vai_record_number := generate_record_number('VAI-', 'seq_vehicle_activity_items'); END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_vai_rn BEFORE INSERT ON public.vehicle_activity_items FOR EACH ROW EXECUTE FUNCTION public.set_vai_record_number();

CREATE FUNCTION public.set_viit_record_number() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public','pg_catalog'
AS $$ BEGIN IF NEW.viit_record_number IS NULL OR NEW.viit_record_number = '' THEN NEW.viit_record_number := generate_record_number('VIT-', 'seq_vehicle_inspection_item_templates'); END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_viit_rn BEFORE INSERT ON public.vehicle_inspection_item_templates FOR EACH ROW EXECUTE FUNCTION public.set_viit_record_number();

-- ── Audit / delete protection (platform-standard generic triggers) ───────────
CREATE TRIGGER trg_audit_vehicle_activity_items AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_activity_items FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();
CREATE TRIGGER trg_audit_vehicle_inspection_item_templates AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_inspection_item_templates FOR EACH ROW EXECUTE FUNCTION public.log_audit_and_field_history();
CREATE TRIGGER trg_vehicle_activity_items_no_hard_delete BEFORE DELETE ON public.vehicle_activity_items FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();
CREATE TRIGGER trg_vehicle_inspection_item_templates_no_hard_delete BEFORE DELETE ON public.vehicle_inspection_item_templates FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- ── RLS (vehicles + vehicle_activities already have theirs) ─────────────────
ALTER TABLE public.vehicle_activity_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_inspection_item_templates ENABLE ROW LEVEL SECURITY;

-- Items ride the vehicle_activities object permission — they are that record.
CREATE POLICY app_select_vehicle_activity_items ON public.vehicle_activity_items FOR SELECT USING ((SELECT app_user_can('vehicle_activities','read')));
CREATE POLICY app_insert_vehicle_activity_items ON public.vehicle_activity_items FOR INSERT WITH CHECK ((SELECT app_user_can('vehicle_activities','create')));
CREATE POLICY app_update_vehicle_activity_items ON public.vehicle_activity_items FOR UPDATE USING ((SELECT app_user_can('vehicle_activities','update')));
CREATE POLICY app_delete_vehicle_activity_items ON public.vehicle_activity_items FOR DELETE USING ((SELECT app_user_can('vehicle_activities','delete')));

CREATE POLICY app_select_viit ON public.vehicle_inspection_item_templates FOR SELECT USING ((SELECT app_user_can('vehicle_inspection_item_templates','read')));
CREATE POLICY app_insert_viit ON public.vehicle_inspection_item_templates FOR INSERT WITH CHECK ((SELECT app_user_can('vehicle_inspection_item_templates','create')));
CREATE POLICY app_update_viit ON public.vehicle_inspection_item_templates FOR UPDATE USING ((SELECT app_user_can('vehicle_inspection_item_templates','update')));
CREATE POLICY app_delete_viit ON public.vehicle_inspection_item_templates FOR DELETE USING ((SELECT app_user_can('vehicle_inspection_item_templates','delete')));

GRANT SELECT, INSERT, UPDATE ON public.vehicle_activity_items, public.vehicle_inspection_item_templates TO authenticated;
GRANT USAGE ON SEQUENCE public.seq_vehicle_activity_items, public.seq_vehicle_inspection_item_templates TO authenticated;

-- Templates are Admin-managed config; internal roles read them.
INSERT INTO public.role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete, roa_created_by)
SELECT r.id, 'vehicle_inspection_item_templates', true, false, false, false, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM public.roles r
WHERE r.role_name IN ('Director of Field Services','Program Manager','Project Coordinator','Project Manager',
                      'Project Site Lead','Lead Technician','Team Lead','Technician in Training','Shop Steward');

-- ── fleet-evidence storage bucket (mirrors work-evidence policies) ───────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('fleet-evidence', 'fleet-evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY fleet_evidence_authenticated_read   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'fleet-evidence');
CREATE POLICY fleet_evidence_authenticated_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'fleet-evidence');
CREATE POLICY fleet_evidence_authenticated_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'fleet-evidence') WITH CHECK (bucket_id = 'fleet-evidence');
CREATE POLICY fleet_evidence_authenticated_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'fleet-evidence');

-- ── Seed the Daily Inspection checklist (Nicholas's merged final list) ───────
-- Tire scoping uses the EXISTING vehicle_type picklist: Box Truck gets the
-- 6-tire dual-rear set; Van / Cargo Van / Pickup Truck / Sedan get 4 tires.
DO $$
DECLARE
  v_nick uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_box uuid;
  v_std uuid[];
BEGIN
  SELECT id INTO v_box FROM picklist_values
  WHERE picklist_object='vehicles' AND picklist_field='vehicle_type' AND picklist_value='Box Truck';

  SELECT array_agg(id) INTO v_std FROM picklist_values
  WHERE picklist_object='vehicles' AND picklist_field='vehicle_type'
    AND picklist_value IN ('Van','Cargo Van','Pickup Truck','Sedan');

  INSERT INTO vehicle_inspection_item_templates
    (viit_record_number, viit_name, viit_description, viit_leg, viit_sort_order, viit_photos_required, viit_requires_condition, viit_vehicle_type_ids, viit_owner, viit_created_by)
  VALUES
  ('', 'Odometer & Dash Photo - Start', 'Photograph the dash showing the odometer, fuel gauge, and any lit alerts. Enter the odometer reading and gas level in the fields above.', 'pre_trip', 10, 1, false, NULL, v_nick, v_nick),
  ('', 'Dash Alerts Check', 'Are any alert lights lit? OK = none lit. Needs Repair = list every lit alert in the comment.', 'pre_trip', 20, 0, true, NULL, v_nick, v_nick),
  ('', 'Front of Vehicle Photo', 'Full front of the vehicle, plate visible.', 'pre_trip', 30, 1, false, NULL, v_nick, v_nick),
  ('', 'Driver Side Photo', 'Full driver side, bumper to bumper.', 'pre_trip', 40, 1, false, NULL, v_nick, v_nick),
  ('', 'Rear of Vehicle Photo', 'Full rear of the vehicle.', 'pre_trip', 50, 1, false, NULL, v_nick, v_nick),
  ('', 'Passenger Side Photo', 'Full passenger side, bumper to bumper.', 'pre_trip', 60, 1, false, NULL, v_nick, v_nick),
  ('', 'New Damage Check', 'Any new damage before using this vehicle? OK = none. Needs Repair = photograph EVERY damage point (add as many photos as needed) and describe in the comment.', 'pre_trip', 70, 0, true, NULL, v_nick, v_nick),
  ('', 'Tire - Driver Front', 'Photo of the driver front tire; check inflation and tread.', 'pre_trip', 80, 1, true, v_std, v_nick, v_nick),
  ('', 'Tire - Driver Rear', 'Photo of the driver rear tire; check inflation and tread.', 'pre_trip', 82, 1, true, v_std, v_nick, v_nick),
  ('', 'Tire - Passenger Front', 'Photo of the passenger front tire; check inflation and tread.', 'pre_trip', 84, 1, true, v_std, v_nick, v_nick),
  ('', 'Tire - Passenger Rear', 'Photo of the passenger rear tire; check inflation and tread.', 'pre_trip', 86, 1, true, v_std, v_nick, v_nick),
  ('', 'Tire - Driver Front', 'Photo of the driver front tire; check inflation and tread.', 'pre_trip', 80, 1, true, ARRAY[v_box], v_nick, v_nick),
  ('', 'Tire - Passenger Front', 'Photo of the passenger front tire; check inflation and tread.', 'pre_trip', 82, 1, true, ARRAY[v_box], v_nick, v_nick),
  ('', 'Tire - Driver Side Rear Exterior', 'Photo of the driver side rear OUTER dual; check inflation and tread.', 'pre_trip', 84, 1, true, ARRAY[v_box], v_nick, v_nick),
  ('', 'Tire - Driver Side Rear Interior', 'Photo of the driver side rear INNER dual; check inflation and tread.', 'pre_trip', 86, 1, true, ARRAY[v_box], v_nick, v_nick),
  ('', 'Tire - Passenger Side Rear Exterior', 'Photo of the passenger side rear OUTER dual; check inflation and tread.', 'pre_trip', 88, 1, true, ARRAY[v_box], v_nick, v_nick),
  ('', 'Tire - Passenger Side Rear Interior', 'Photo of the passenger side rear INNER dual; check inflation and tread.', 'pre_trip', 90, 1, true, ARRAY[v_box], v_nick, v_nick),
  ('', 'Windows - Clean and No Cracks', 'Windows clean inside and out, windshield free of cracks. Photo of the windshield.', 'pre_trip', 100, 1, true, NULL, v_nick, v_nick),
  ('', 'Windshield Wipers - Clean, Not Stuck', 'Wipers clean and not stuck to the windshield. Photo.', 'pre_trip', 110, 1, true, NULL, v_nick, v_nick),
  ('', 'Dash Cam - Powered On and Operational', 'Dash cam powered on and recording. Photo of the dash cam screen on.', 'pre_trip', 120, 1, true, NULL, v_nick, v_nick),
  ('', 'Oil Gauge Check', 'Oil level reads in range. Photo of the gauge/dipstick.', 'pre_trip', 130, 1, true, NULL, v_nick, v_nick),
  ('', 'First Aid Kit Available', 'First aid kit present and stocked. Photo.', 'pre_trip', 140, 1, true, NULL, v_nick, v_nick),
  ('', 'Fire Extinguisher Available', 'Fire extinguisher present, pinned, and charged. Photo of the gauge.', 'pre_trip', 150, 1, true, NULL, v_nick, v_nick),
  ('', 'Headlights - Hi and Lo Beam', 'Both beams function. Photo with headlights on.', 'pre_trip', 160, 1, true, NULL, v_nick, v_nick),
  ('', 'Turn Signals Function', 'All four corners flash.', 'pre_trip', 170, 0, true, NULL, v_nick, v_nick),
  ('', 'Mirrors Function and Clean', 'Mirrors intact, adjustable, and clean.', 'pre_trip', 180, 0, true, NULL, v_nick, v_nick),
  ('', 'Odometer & Dash Photo - Return', 'Photograph the dash on return showing the odometer and fuel gauge. Enter the return odometer reading and gas level in the fields above.', 'return', 200, 1, false, NULL, v_nick, v_nick),
  ('', 'Gassed Up on Return', 'Vehicle refueled for the next crew?', 'return', 210, 0, true, NULL, v_nick, v_nick),
  ('', 'Exterior and Interior Clean', 'Exterior and interior clean on return. Photo of the cab.', 'return', 220, 1, true, NULL, v_nick, v_nick),
  ('', 'Tools & Materials Organized, Secured & Put Away', 'Cargo area organized and secured. Photo.', 'return', 230, 1, true, NULL, v_nick, v_nick),
  ('', 'Sweep Floor', 'Cab and cargo floors swept.', 'return', 240, 0, true, NULL, v_nick, v_nick),
  ('', 'Toss Garbage', 'All garbage removed from the vehicle.', 'return', 250, 0, true, NULL, v_nick, v_nick);
END $$;

NOTIFY pgrst, 'reload schema';
