-- Add two Wisconsin IRA Multi-Family enrollment record types (terse
-- WI-IRA-MF family naming, matching the existing enrollment record types):
--   1. WI-IRA-MF-APA        (Multi-Family Assessment Pre-Approval)
--   2. WI-IRA-MF-HOMES-PR   (Multi-Family HOMES Project Reservation)
-- Additive: new picklist_values rows scoped to the enrollments record_type
-- picklist, WI state. New record types fall back to the default
-- "Enrollment Layout" (record_type_id IS NULL) until a dedicated layout is
-- authored, so they are usable on create immediately. Idempotent guard so
-- branch-database replays don't duplicate.

insert into public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_state, picklist_sort_order, picklist_is_active,
   picklist_is_default_record_type, picklist_show_in_path)
select v.picklist_object, v.picklist_field, v.picklist_value, v.picklist_label,
       v.picklist_state, v.picklist_sort_order, true, false, true
from (values
  ('enrollments', 'record_type', 'wi-ira-mf-apa',
   'WI-IRA-MF-APA', 'WI', 22),
  ('enrollments', 'record_type', 'wi-ira-mf-homes-pr',
   'WI-IRA-MF-HOMES-PR', 'WI', 24)
) as v(picklist_object, picklist_field, picklist_value, picklist_label,
       picklist_state, picklist_sort_order)
where not exists (
  select 1 from public.picklist_values p
  where p.picklist_object = v.picklist_object
    and p.picklist_field  = v.picklist_field
    and p.picklist_value  = v.picklist_value
);
