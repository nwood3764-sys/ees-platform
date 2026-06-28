-- Seed data cleanup sweep before Salesforce data import.
-- Audit performed 2026-05-23: 31 tables had seed-flagged active rows totaling ~258 rows.
-- 21 non-seed actives preserved (Lutheran Social Services prospect tree:
--   ACC-00021, PROP-00017, SA-00128/129 + 4 conversations, 7 messages,
--   4 status_change_events, 2 SA assignments).
--
-- 27 tables get SOFT delete (recycle bin preserved; restorable).
-- 4 tables (cfp_projects, envelope_events, notification_logs, service_appointment_tokens)
-- have no soft-delete column and get HARD delete.
--
-- Reason text for all deletions: 'Seed data cleanup pre-import 2026-05-23'

-- Capture before-counts for verification
CREATE TEMP TABLE _seed_sweep_audit (
  table_name text PRIMARY KEY,
  before_seed_active bigint,
  after_seed_active bigint,
  rows_affected bigint
) ON COMMIT DROP;

DO $audit$
DECLARE r RECORD; cnt bigint; del_col text;
BEGIN
  FOR r IN
    SELECT c.relname AS t
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND a.attname='is_seed_data' AND NOT a.attisdropped
  LOOP
    SELECT a.attname INTO del_col
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=r.t AND NOT a.attisdropped AND a.attname LIKE '%is_deleted'
    ORDER BY length(a.attname) LIMIT 1;
    IF del_col IS NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE is_seed_data = true', r.t) INTO cnt;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I WHERE is_seed_data = true AND %I = false', r.t, del_col) INTO cnt;
    END IF;
    INSERT INTO _seed_sweep_audit(table_name, before_seed_active) VALUES (r.t, cnt);
  END LOOP;
END $audit$;

-- ============================================================
-- SOFT DELETE: 27 tables with `*is_deleted` columns
-- ============================================================

-- Tables with full audit cols (delete_col + deleted_at + deletion_reason)
UPDATE accounts SET account_is_deleted=true, account_deleted_at=now(), account_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND account_is_deleted=false;
UPDATE assessments SET assessment_is_deleted=true, assessment_deleted_at=now(), assessment_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND assessment_is_deleted=false;
UPDATE buildings SET building_is_deleted=true, building_deleted_at=now(), building_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND building_is_deleted=false;
UPDATE contacts SET contact_is_deleted=true, contact_deleted_at=now(), contact_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND contact_is_deleted=false;
UPDATE efr_reports SET efr_is_deleted=true, efr_deleted_at=now(), efr_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND efr_is_deleted=false;
UPDATE envelope_recipients SET is_deleted=true, deleted_at=now(), deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND is_deleted=false;
UPDATE envelopes SET is_deleted=true, deleted_at=now(), deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND is_deleted=false;
UPDATE incentive_applications SET ia_is_deleted=true, ia_deleted_at=now(), ia_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND ia_is_deleted=false;
UPDATE materials_request_line_items SET mrli_is_deleted=true, mrli_deleted_at=now(), mrli_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND mrli_is_deleted=false;
UPDATE materials_requests SET mr_is_deleted=true, mr_deleted_at=now(), mr_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND mr_is_deleted=false;
UPDATE opportunities SET opportunity_is_deleted=true, opportunity_deleted_at=now(), opportunity_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND opportunity_is_deleted=false;
UPDATE product_items SET product_item_is_deleted=true, product_item_deleted_at=now(), product_item_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND product_item_is_deleted=false;
UPDATE projects SET project_is_deleted=true, project_deleted_at=now(), project_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND project_is_deleted=false;
UPDATE properties SET property_is_deleted=true, property_deleted_at=now(), property_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND property_is_deleted=false;
UPDATE service_appointment_assignments SET saa_is_deleted=true, saa_deleted_at=now(), saa_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND saa_is_deleted=false;
UPDATE service_appointments SET sa_is_deleted=true, sa_deleted_at=now(), sa_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND sa_is_deleted=false;
UPDATE time_sheet_entries SET tse_is_deleted=true, tse_deleted_at=now(), tse_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND tse_is_deleted=false;
UPDATE time_sheets SET ts_is_deleted=true, ts_deleted_at=now(), ts_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND ts_is_deleted=false;
UPDATE units SET unit_is_deleted=true, unit_deleted_at=now(), unit_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND unit_is_deleted=false;
UPDATE vehicle_activities SET va_is_deleted=true, va_deleted_at=now(), va_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND va_is_deleted=false;
UPDATE work_orders SET work_order_is_deleted=true, work_order_deleted_at=now(), work_order_deletion_reason='Seed data cleanup pre-import 2026-05-23' WHERE is_seed_data=true AND work_order_is_deleted=false;

-- Tables with delete_col + deleted_at but no deletion_reason
UPDATE documents SET is_deleted=true, deleted_at=now() WHERE is_seed_data=true AND is_deleted=false;
UPDATE payment_receipts SET is_deleted=true, deleted_at=now() WHERE is_seed_data=true AND is_deleted=false;
UPDATE portal_users SET is_deleted=true, deleted_at=now() WHERE is_seed_data=true AND is_deleted=false;
UPDATE project_payment_requests SET is_deleted=true, deleted_at=now() WHERE is_seed_data=true AND is_deleted=false;

-- Tables with delete_col only (no deleted_at, no deletion_reason)
UPDATE email_sends SET is_deleted=true WHERE is_seed_data=true AND is_deleted=false;
UPDATE property_programs SET is_deleted=true WHERE is_seed_data=true AND is_deleted=false;

-- ============================================================
-- HARD DELETE: 4 tables with no soft-delete column
-- ============================================================
DELETE FROM envelope_events WHERE is_seed_data = true;
DELETE FROM notification_logs WHERE is_seed_data = true;
DELETE FROM service_appointment_tokens WHERE is_seed_data = true;
DELETE FROM cfp_projects WHERE is_seed_data = true;

-- ============================================================
-- Verification: after-counts on all 31 tables
-- ============================================================
DO $verify$
DECLARE r RECORD; cnt bigint; del_col text;
BEGIN
  FOR r IN SELECT table_name FROM _seed_sweep_audit LOOP
    SELECT a.attname INTO del_col
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=r.table_name AND NOT a.attisdropped AND a.attname LIKE '%is_deleted'
    ORDER BY length(a.attname) LIMIT 1;
    IF del_col IS NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE is_seed_data = true', r.table_name) INTO cnt;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I WHERE is_seed_data = true AND %I = false', r.table_name, del_col) INTO cnt;
    END IF;
    UPDATE _seed_sweep_audit
       SET after_seed_active = cnt,
           rows_affected = before_seed_active - cnt
     WHERE table_name = r.table_name;
  END LOOP;
END $verify$;

-- Halt if any table still has seed-flagged active rows
DO $check$
DECLARE leftover bigint;
BEGIN
  SELECT SUM(after_seed_active) INTO leftover FROM _seed_sweep_audit;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'Seed sweep incomplete: % seed-flagged active rows remain', leftover;
  END IF;
  RAISE NOTICE 'Seed sweep complete: 0 seed-flagged active rows remain across % tables', (SELECT count(*) FROM _seed_sweep_audit);
END $check$;
