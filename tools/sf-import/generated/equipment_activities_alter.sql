ALTER TABLE public.equipment_activities
  ADD COLUMN IF NOT EXISTS ea_equipment_activity_check_in_date_time                timestamp with time zone,
  ADD COLUMN IF NOT EXISTS ea_equipment_activity_check_out_date_time               timestamp with time zone,
  ADD COLUMN IF NOT EXISTS ea_equipment_activity_damage_notes                      text,
  ADD COLUMN IF NOT EXISTS ea_equipment_activity_estimated_cost                    numeric(18,2),
  ADD COLUMN IF NOT EXISTS ea_equipment_activity_related_equipment                 uuid,
  ADD COLUMN IF NOT EXISTS ea_equipment_id                                         text,
  ADD COLUMN IF NOT EXISTS ea_equipment_issue_frequency                            text,
  ADD COLUMN IF NOT EXISTS ea_equipment_location                                   text,
  ADD COLUMN IF NOT EXISTS ea_inventory_inspection_notes                           text,
  ADD COLUMN IF NOT EXISTS ea_tech_name                                            uuid,
  ADD COLUMN IF NOT EXISTS ea_technician                                           text;
COMMENT ON COLUMN public.equipment_activities.ea_equipment_issue_frequency IS 'SF formula/rollup field. Populated by future trigger or view.';
