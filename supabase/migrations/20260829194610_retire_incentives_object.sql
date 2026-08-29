-- =============================================================================
-- Retire the `incentives` object; the Incentives module keeps its name and is
-- rolled up on incentive_applications instead.
--
-- Nicholas, 2026-08-29, from Object Manager: "It looks like we have two objects
-- for incentives… I think this object is really irrelevant… get rid of all this
-- stuff that just says incentives and go back to incentive applications," then,
-- confirming the shape: "we need the module and everything, because we really
-- need to replace it with the Incentive Application object and roll it all up
-- to that module on the home screen."
--
-- They were never duplicates of one another. `incentive_applications` is the
-- live object — 10 records, its own 9-stage status path, the program × stage
-- submittal matrix, the state and program record-type rules shipped 08-23/08-24.
-- `incentives` is a Salesforce-shaped table from the baseline import (Franklin
-- work order number, solutions advisor, commission amount, incentive cycle):
-- fully built — 3 page layouts, 12 picklist values, 10 role-access grants,
-- 5 policies, 9 triggers, 2 state-scope resolution paths — and never used once.
-- Zero records, and no foreign key anywhere in the platform points at it.
--
-- What made it confusing today rather than merely dormant: a module tab added
-- to Incentives this afternoon was bound to it, so the module's own tab opened
-- an empty list of an object with the same name as the module.
--
-- The table is DROPPED (this cannot be undone; there is nothing in it to lose).
-- Its configuration rows are soft-deleted / deactivated in place, per the
-- platform's soft-delete rule — they are records, and records are never hard
-- deleted here. role_object_access is the exception: it carries no soft-delete
-- column, and a grant on an object that no longer exists is not a record worth
-- keeping, so those rows go.
-- =============================================================================

DO $$
DECLARE
  v_rows bigint;
BEGIN
  -- Refuse to run at all if somebody has created an incentive in the meantime.
  -- Dropping a table with records in it is not what was authorised.
  EXECUTE 'SELECT count(*) FROM public.incentives' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'incentives holds % row(s) — retiring the object would destroy real records. Stopping.', v_rows;
  END IF;
END $$;

-- Configuration: soft-deleted / deactivated, not erased.
UPDATE public.page_layouts
   SET is_deleted = true,
       deletion_reason = 'Incentives object retired 2026-08-29 — replaced by Incentive Applications'
 WHERE page_layout_object = 'incentives'
   AND is_deleted IS NOT TRUE;

UPDATE public.picklist_values
   SET picklist_is_active = false
 WHERE picklist_object = 'incentives'
   AND picklist_is_active IS NOT FALSE;

UPDATE public.record_state_scope_sources
   SET rsss_is_active = false,
       rsss_is_deleted = true,
       rsss_deleted_at = now(),
       rsss_deletion_reason = 'Incentives object retired 2026-08-29 — table dropped'
 WHERE rsss_object_name = 'incentives'
   AND rsss_is_deleted IS NOT TRUE;

-- A grant on an object that no longer exists is not a record.
DELETE FROM public.role_object_access WHERE roa_object_name = 'incentives';

-- The object itself. CASCADE takes its 5 policies and 9 triggers with it.
DROP TABLE IF EXISTS public.incentives CASCADE;

-- The trigger functions that existed only to serve it. Each was verified to be
-- referenced by no trigger on any other table before this migration was written.
DROP FUNCTION IF EXISTS public.set_incentive_record_number() CASCADE;
DROP FUNCTION IF EXISTS public.enforce_rt__incentives() CASCADE;
DROP FUNCTION IF EXISTS public.stamp_incentives_audit_fields() CASCADE;
DROP FUNCTION IF EXISTS public.enforce_status_lock_incentives() CASCADE;
-- Two arguments, not one: the generated state-scope resolvers take
-- (p_id uuid, p_states text[]). A one-argument DROP IF EXISTS matches nothing
-- and reports success, which the assertion below is what caught.
DROP FUNCTION IF EXISTS public.record_state_scope_incentives(uuid, text[]) CASCADE;

-- The module tab that pointed at it now points at Incentive Applications.
-- Written idempotently: this reproduces on a branch database what was applied
-- to production directly, and does nothing where the row is already correct.
UPDATE public.module_sections
   SET ms_section_id   = 'applications',
       ms_label        = 'Incentive Applications',
       ms_object_table = 'incentive_applications',
       ms_is_system    = true,
       ms_sort_order   = 1
 WHERE ms_module_id = 'incentives'
   AND ms_object_table = 'incentives'
   AND ms_is_deleted IS NOT TRUE;

UPDATE public.module_sections SET ms_sort_order = 2
 WHERE ms_module_id = 'incentives' AND ms_section_id = 'requests';
UPDATE public.module_sections SET ms_sort_order = 3
 WHERE ms_module_id = 'incentives' AND ms_section_id = 'received';

-- Assert the object is gone rather than assuming it: a DROP that silently did
-- not happen would leave the platform advertising an object nobody can reach.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'incentives') THEN
    RAISE EXCEPTION 'incentives table still exists after DROP';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('set_incentive_record_number', 'enforce_rt__incentives',
                                  'stamp_incentives_audit_fields', 'enforce_status_lock_incentives',
                                  'record_state_scope_incentives')) THEN
    RAISE EXCEPTION 'an incentives-only function survived the drop';
  END IF;
  -- The live object is untouched.
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'incentive_applications') THEN
    RAISE EXCEPTION 'incentive_applications is missing — wrong table was dropped';
  END IF;
END $$;
