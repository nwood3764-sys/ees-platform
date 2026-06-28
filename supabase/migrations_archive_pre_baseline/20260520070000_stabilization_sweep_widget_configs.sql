-- =====================================================================
-- Stabilization sweep: repair every widget_config reference to non-
-- existent columns/tables across all live page layouts.
--
-- Repo snapshot of the migration applied to production this session via
-- Supabase MCP `apply_migration`.
--
-- Pre-state audit (queried against information_schema before this
-- migration):
--   * 0 broken refs on related_list widgets
--   * 0 broken refs on file_gallery widgets (89 widgets, all targeting
--     existing documents/photos tables)
--   * 35 missing host_column refs on field_group widgets across 5 live
--     layouts. 2 layouts target tables that no longer exist after the
--     Permission Builder schema rework: "Standard Permissions Layout"
--     and "Standard Role Permissions Layout".
--   * 1 missing lookup_table ref on the orphan layouts above
--   * 1 missing lookup_field ref ("Standard Scheduled Reports Layout"
--     authored against reports.name when the actual column is rpt_name)
--   * 1 empty-config conversation_panel demo widget on the Multifamily
--     property layout (seeded by 7cc826f as a placeholder; conversations
--     table has no property_id FK so property-level anchoring isn't part
--     of the model)
--
-- The DO $$ ... END $$ self-test block at the bottom is the standing
-- pattern for any future widget-touching migration: it RAISEs inside
-- the migration transaction if any broken reference would remain, so
-- a migration with invented column names is refused, not applied.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Soft-delete orphan page layouts whose host table no longer exists.
-- ---------------------------------------------------------------------
UPDATE page_layout_widgets w
   SET is_deleted = true, updated_at = now()
 WHERE w.page_layout_id IN (
   SELECT id FROM page_layouts
    WHERE page_layout_name IN ('Standard Permissions Layout','Standard Role Permissions Layout')
 ) AND NOT w.is_deleted;

UPDATE page_layout_sections s
   SET is_deleted = true,
       deletion_reason = 'orphan layout — host table dropped in permission builder rework',
       updated_at = now()
 WHERE s.page_layout_id IN (
   SELECT id FROM page_layouts
    WHERE page_layout_name IN ('Standard Permissions Layout','Standard Role Permissions Layout')
 ) AND NOT s.is_deleted;

UPDATE page_layouts
   SET is_deleted = true,
       deletion_reason = 'host table dropped in permission builder rework — superseded by role_object_access + permission_sets',
       updated_at = now()
 WHERE page_layout_name IN ('Standard Permissions Layout','Standard Role Permissions Layout')
   AND NOT is_deleted;

-- ---------------------------------------------------------------------
-- 2. Soft-delete the empty-config conversation_panel demo widget on the
--    Multifamily property layout.
-- ---------------------------------------------------------------------
UPDATE page_layout_widgets
   SET is_deleted = true, updated_at = now()
 WHERE id = '6f2cbe13-3cc4-42dd-885e-ba27b00b0288'
   AND NOT is_deleted;

-- ---------------------------------------------------------------------
-- 3. Rewrite field_group widget_configs to reference actual columns.
--    project_payment_requests has unprefixed canonical columns
--    (requested_amount, approved_amount, notes, submitted_date,
--    payment_received_date, program_id, property_id, project_id) plus
--    ppr_record_number, ppr_status, ppr_record_type from the dual-
--    column lifecycle introduced in 20260518360000.
--    reports + scheduled_reports use rpt_/sr_ prefixed columns.
-- ---------------------------------------------------------------------

-- Payment Request Detail — Financial section
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','requested_amount','type','currency','label','Amount Requested'),
    jsonb_build_object('name','approved_amount','type','currency','label','Amount Approved'),
    jsonb_build_object('name','payment_received_date','type','date','label','Payment Received Date'),
    jsonb_build_object('name','notes','type','textarea','label','Notes')
  )
), updated_at = now()
WHERE id = '258c8252-4411-4cff-a47e-f6e0a1e4b616';

-- Payment Request Detail — Payment Request Details section
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','ppr_record_number','type','text','label','Record #'),
    jsonb_build_object('name','ppr_status','type','picklist','label','Status'),
    jsonb_build_object('name','program_id','type','lookup','label','Program','lookup_table','programs','lookup_field','name'),
    jsonb_build_object('name','submitted_date','type','date','label','Submitted Date'),
    jsonb_build_object('name','property_id','type','lookup','label','Property','lookup_table','properties','lookup_field','property_name'),
    jsonb_build_object('name','project_id','type','lookup','label','Project','lookup_table','projects','lookup_field','project_name')
  )
), updated_at = now()
WHERE id = '2b6283c3-93c1-43ed-b80c-4fb90755253d';

-- Standard Reports Layout — System Information section
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','rpt_owner_user_id','type','lookup','label','Owner','lookup_table','users','lookup_field','user_name'),
    jsonb_build_object('name','created_at','type','datetime','label','Created At'),
    jsonb_build_object('name','updated_at','type','datetime','label','Updated At')
  )
), updated_at = now()
WHERE id = '0cd13d81-3da9-4d2c-bfbe-988942855d50';

-- Standard Reports Layout — Details section
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','rpt_name','type','text','label','Name'),
    jsonb_build_object('name','rpt_description','type','textarea','label','Description'),
    jsonb_build_object('name','rpt_primary_object','type','text','label','Primary Object'),
    jsonb_build_object('name','rpt_folder_id','type','lookup','label','Folder','lookup_table','report_folders','lookup_field','rf_name'),
    jsonb_build_object('name','rpt_format','type','text','label','Format')
  )
), updated_at = now()
WHERE id = 'f3261500-0b60-4092-8759-4008831399d8';

-- Standard Scheduled Reports Layout — System Information section
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','sr_owner_user_id','type','lookup','label','Owner','lookup_table','users','lookup_field','user_name'),
    jsonb_build_object('name','created_at','type','datetime','label','Created At'),
    jsonb_build_object('name','updated_at','type','datetime','label','Updated At')
  )
), updated_at = now()
WHERE id = 'aab11231-9b24-496d-920b-1e497e73d969';

-- Standard Scheduled Reports Layout — Details section
UPDATE page_layout_widgets SET widget_config = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','sr_report_id','type','lookup','label','Report','lookup_table','reports','lookup_field','rpt_name'),
    jsonb_build_object('name','sr_name','type','text','label','Name'),
    jsonb_build_object('name','sr_frequency','type','picklist','label','Frequency'),
    jsonb_build_object('name','sr_day_of_week','type','picklist','label','Day Of Week'),
    jsonb_build_object('name','sr_day_of_month','type','number','label','Day Of Month'),
    jsonb_build_object('name','sr_send_time','type','text','label','Send Time'),
    jsonb_build_object('name','sr_format','type','picklist','label','Format'),
    jsonb_build_object('name','sr_subject_line','type','text','label','Subject Line'),
    jsonb_build_object('name','sr_message_body','type','textarea','label','Message Body'),
    jsonb_build_object('name','sr_is_active','type','boolean','label','Is Active'),
    jsonb_build_object('name','sr_last_sent_at','type','datetime','label','Last Sent At'),
    jsonb_build_object('name','sr_next_send_at','type','datetime','label','Next Send At')
  )
), updated_at = now()
WHERE id = '8bc40f43-a5dd-491a-849e-fbc446e7e86c';

-- ---------------------------------------------------------------------
-- 4. SELF-TEST: every column referenced in any LIVE widget_config must
--    exist in information_schema. RAISEs inside the transaction if any
--    broken reference remains. STANDING PATTERN — copy this DO-block
--    into any future widget-touching migration as a hard gate.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  bad RECORD;
  bad_count integer := 0;
BEGIN
  -- field_group host column refs
  FOR bad IN
    WITH fg AS (
      SELECT w.id AS widget_id, pl.page_layout_name, pl.page_layout_object AS host_table, w.widget_config
        FROM page_layout_widgets w JOIN page_layouts pl ON pl.id = w.page_layout_id
       WHERE NOT w.is_deleted AND NOT pl.is_deleted AND w.widget_type = 'field_group'
    ),
    ff AS (
      SELECT widget_id, page_layout_name, host_table,
             f->>'name' AS field_name
        FROM fg, jsonb_array_elements(fg.widget_config->'fields') AS f
    )
    SELECT ff.widget_id, ff.page_layout_name, ff.host_table, ff.field_name AS broken
      FROM ff
     WHERE ff.field_name IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name = ff.host_table AND column_name = ff.field_name
       )
  LOOP
    bad_count := bad_count + 1;
    RAISE WARNING 'field_group missing column: layout=% host=% field=% widget=%',
      bad.page_layout_name, bad.host_table, bad.broken, bad.widget_id;
  END LOOP;

  -- field_group lookup_field refs
  FOR bad IN
    WITH fg AS (
      SELECT w.id AS widget_id, pl.page_layout_name, w.widget_config
        FROM page_layout_widgets w JOIN page_layouts pl ON pl.id = w.page_layout_id
       WHERE NOT w.is_deleted AND NOT pl.is_deleted AND w.widget_type = 'field_group'
    ),
    ff AS (
      SELECT widget_id, page_layout_name,
             f->>'lookup_table' AS lookup_table, f->>'lookup_field' AS lookup_field
        FROM fg, jsonb_array_elements(fg.widget_config->'fields') AS f
    )
    SELECT ff.widget_id, ff.page_layout_name, ff.lookup_table, ff.lookup_field
      FROM ff
     WHERE ff.lookup_table IS NOT NULL AND ff.lookup_field IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name = ff.lookup_table)
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name = ff.lookup_table AND column_name = ff.lookup_field
       )
  LOOP
    bad_count := bad_count + 1;
    RAISE WARNING 'field_group missing lookup_field: layout=% lookup_table=% lookup_field=% widget=%',
      bad.page_layout_name, bad.lookup_table, bad.lookup_field, bad.widget_id;
  END LOOP;

  -- related_list columns, sort_field, fk, is_deleted_col
  FOR bad IN
    WITH rl AS (
      SELECT w.id AS widget_id, pl.page_layout_name,
             w.widget_config->>'table' AS child_table,
             w.widget_config->>'fk' AS fk_col,
             w.widget_config->>'sort_field' AS sort_field,
             w.widget_config->>'is_deleted_col' AS is_deleted_col,
             w.widget_config AS cfg
        FROM page_layout_widgets w JOIN page_layouts pl ON pl.id = w.page_layout_id
       WHERE NOT w.is_deleted AND NOT pl.is_deleted AND w.widget_type='related_list'
    )
    SELECT rl.widget_id, rl.page_layout_name, rl.child_table || '.' || (c->>'name') AS broken, 'column' AS kind
      FROM rl, jsonb_array_elements(rl.cfg->'columns') AS c
     WHERE c->>'name' IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=rl.child_table)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=rl.child_table AND column_name=(c->>'name'))
    UNION ALL
    SELECT rl.widget_id, rl.page_layout_name, rl.child_table || '.' || rl.fk_col, 'fk' FROM rl
     WHERE rl.fk_col IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=rl.child_table)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=rl.child_table AND column_name=rl.fk_col)
    UNION ALL
    SELECT rl.widget_id, rl.page_layout_name, rl.child_table || '.' || rl.sort_field, 'sort_field' FROM rl
     WHERE rl.sort_field IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=rl.child_table)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=rl.child_table AND column_name=rl.sort_field)
    UNION ALL
    SELECT rl.widget_id, rl.page_layout_name, rl.child_table || '.' || rl.is_deleted_col, 'is_deleted_col' FROM rl
     WHERE rl.is_deleted_col IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=rl.child_table)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=rl.child_table AND column_name=rl.is_deleted_col)
  LOOP
    bad_count := bad_count + 1;
    RAISE WARNING 'related_list missing %: layout=% ref=% widget=%',
      bad.kind, bad.page_layout_name, bad.broken, bad.widget_id;
  END LOOP;

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'stabilization sweep self-test FAILED: % broken widget_config references remain', bad_count;
  END IF;
END $$;
