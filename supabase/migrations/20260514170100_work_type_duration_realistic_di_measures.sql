-- Updated install-time estimates per Nicholas's field reality.
-- Showerhead is 3 min (not 15). Aerators and LED 9W are 2 min each.
-- Thermostat, PTAC, Blower Door unchanged.
UPDATE work_types SET work_type_duration_minutes = 3,
       work_type_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
       work_type_updated_at = now()
 WHERE work_type_record_number = 'WT-00030';

UPDATE work_types SET work_type_duration_minutes = 2,
       work_type_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
       work_type_updated_at = now()
 WHERE work_type_record_number IN ('WT-00008','WT-00013','WT-00043');
