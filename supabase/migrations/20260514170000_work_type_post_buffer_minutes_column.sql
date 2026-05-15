-- Per-work-type buffer time after a work order completes.
-- Default 5 min applied to every existing row. The scheduler engine zero-
-- buffers same-unit transitions automatically; this column governs the
-- inter-unit buffer.
ALTER TABLE work_types
  ADD COLUMN IF NOT EXISTS work_type_post_buffer_minutes integer;

UPDATE work_types SET work_type_post_buffer_minutes = 5
 WHERE work_type_post_buffer_minutes IS NULL;

ALTER TABLE work_types
  ALTER COLUMN work_type_post_buffer_minutes SET DEFAULT 5,
  ALTER COLUMN work_type_post_buffer_minutes SET NOT NULL;

COMMENT ON COLUMN work_types.work_type_post_buffer_minutes IS
'Minutes of buffer added after a work order of this type before the next WO can start. Default 5. The scheduler engine zero-buffers same-unit transitions automatically.';
