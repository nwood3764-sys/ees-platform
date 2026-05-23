-- Full clean slate before Salesforce data import. Per Nicholas: "delete all of it.
-- dont keep anything." Sweeps the 21-row Lutheran Social Services prospect tree
-- that the prior seed sweep (`f675d38`) intentionally preserved. After this,
-- every business object table has 0 active rows.
--
-- Soft delete only (recycle bin preserved, restorable). Reason text:
-- 'Full clean slate pre-import 2026-05-23'.
--
-- Affected tables and pre-state row counts:
--   accounts (1), properties (1), service_appointments (2),
--   service_appointment_assignments (2), conversations (4), messages (7),
--   status_change_events (4) = 21 rows total

UPDATE accounts SET account_is_deleted=true, account_deleted_at=now(), account_deletion_reason='Full clean slate pre-import 2026-05-23' WHERE account_is_deleted=false;
UPDATE properties SET property_is_deleted=true, property_deleted_at=now(), property_deletion_reason='Full clean slate pre-import 2026-05-23' WHERE property_is_deleted=false;
UPDATE service_appointments SET sa_is_deleted=true, sa_deleted_at=now(), sa_deletion_reason='Full clean slate pre-import 2026-05-23' WHERE sa_is_deleted=false;
UPDATE service_appointment_assignments SET saa_is_deleted=true, saa_deleted_at=now(), saa_deletion_reason='Full clean slate pre-import 2026-05-23' WHERE saa_is_deleted=false;
UPDATE conversations SET conv_is_deleted=true, conv_deleted_at=now(), conv_deletion_reason='Full clean slate pre-import 2026-05-23' WHERE conv_is_deleted=false;
UPDATE messages SET msg_is_deleted=true, msg_deleted_at=now(), msg_deletion_reason='Full clean slate pre-import 2026-05-23' WHERE msg_is_deleted=false;
UPDATE status_change_events SET sce_is_deleted=true, sce_deleted_at=now(), sce_deletion_reason='Full clean slate pre-import 2026-05-23' WHERE sce_is_deleted=false;

-- Verification: every is_seed_data-bearing table must have 0 active rows
DO $check$
DECLARE r RECORD; cnt bigint; del_col text; leftover bigint := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS t FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND a.attname='is_seed_data' AND NOT a.attisdropped
  LOOP
    SELECT a.attname INTO del_col
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=r.t AND NOT a.attisdropped AND a.attname LIKE '%is_deleted'
    ORDER BY length(a.attname) LIMIT 1;
    IF del_col IS NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', r.t) INTO cnt;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = false', r.t, del_col) INTO cnt;
    END IF;
    IF cnt > 0 THEN
      RAISE NOTICE 'Active rows remaining in %: %', r.t, cnt;
      leftover := leftover + cnt;
    END IF;
  END LOOP;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'Clean slate sweep incomplete: % active rows remain across business object tables', leftover;
  END IF;
  RAISE NOTICE 'Clean slate complete: 0 active rows across all business object tables';
END $check$;
