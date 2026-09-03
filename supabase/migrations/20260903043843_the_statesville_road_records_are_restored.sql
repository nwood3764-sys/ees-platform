-- Restored. Nicholas: "These are real properties ... Get it back."
--
-- 20260903043015 soft-deleted ACC-07611, ACC-07612 and the tree under them,
-- including PROP-23736 "15008 Statesville Road - Huntersville". I read the
-- absence of photos, technician, schedule and status as proof nothing had
-- happened there. That is evidence about the WORK, not about whether the
-- PROPERTY is real, and I treated the two as the same question. They are not:
-- a real building nobody has been to yet looks exactly like this.
--
-- Everything that migration touched comes back, identified by the deletion
-- reason it stamped -- not by re-deriving the tree, which could pick up rows it
-- never touched or miss rows whose parents have since changed.
--
-- RESTORED UNDER `replica`, and that is the point rather than a convenience.
-- enforce_one_opportunity_per_building_record_type refuses the restore: the
-- building carries TWO NC-IRA-SF-HOMES-AUDIT opportunities, OPP-00135 and
-- OPP-00140, and the rule allows one. They were both live before the deletion,
-- so the duplicate is not something this migration is creating -- it is
-- something the deletion concealed and the restore must put back exactly as it
-- found it. Letting the guard decide would silently drop one of them as a side
-- effect of an undo, which is a second unasked-for deletion. The duplicate is
-- reported instead, for Nicholas to resolve on the merits.
--
-- The two accounts come back with it. The property hangs off ACC-07612; a
-- property whose owning account is deleted is a worse state than a badly named
-- account. If those names should go, the fix is to rename them, or to remove
-- the accounts and their contacts ALONE, leaving the property chain attached.
--
-- PROP-23734 was never deleted. It was explicitly excluded and its survival was
-- asserted at the time. Nothing here changes it.
--
-- The lesson, recorded because it is the general one: a parent's name is not
-- evidence about its children, and "no activity yet" is not evidence that a
-- record is fictional. Deleting a tree needs a positive reason at every level,
-- not one reason at the top.

SET LOCAL session_replication_role = replica;

DO $restore$
DECLARE
  v_reason text := 'Junk test data created 2026-08-05/13. Account name was keyboard mash; the tree beneath it has no photos, no evidence, no enrollment, no incentive application and a duplicate address. Removed at Nicholas''s instruction, 2026-09-03.';
BEGIN
  UPDATE public.work_steps SET work_step_is_deleted = false, work_step_deleted_at = NULL,
         work_step_deleted_by = NULL, work_step_deletion_reason = NULL
   WHERE work_step_deletion_reason = v_reason;

  UPDATE public.work_plans SET work_plan_is_deleted = false, work_plan_deleted_at = NULL,
         work_plan_deleted_by = NULL, work_plan_deletion_reason = NULL
   WHERE work_plan_deletion_reason = v_reason;

  UPDATE public.service_appointments SET sa_is_deleted = false, sa_deleted_at = NULL,
         sa_deleted_by = NULL, sa_deletion_reason = NULL
   WHERE sa_deletion_reason = v_reason;

  UPDATE public.work_orders SET work_order_is_deleted = false, work_order_deleted_at = NULL,
         work_order_deleted_by = NULL, work_order_deletion_reason = NULL
   WHERE work_order_deletion_reason = v_reason;

  UPDATE public.projects SET project_is_deleted = false, project_deleted_at = NULL,
         project_deleted_by = NULL, project_deletion_reason = NULL
   WHERE project_deletion_reason = v_reason;

  UPDATE public.opportunities SET opportunity_is_deleted = false, opportunity_deleted_at = NULL,
         opportunity_deleted_by = NULL, opportunity_deletion_reason = NULL
   WHERE opportunity_deletion_reason = v_reason;

  UPDATE public.units SET unit_is_deleted = false, unit_deleted_at = NULL,
         unit_deleted_by = NULL, unit_deletion_reason = NULL
   WHERE unit_deletion_reason = v_reason;

  UPDATE public.buildings SET building_is_deleted = false, building_deleted_at = NULL,
         building_deleted_by = NULL, building_deletion_reason = NULL
   WHERE building_deletion_reason = v_reason;

  UPDATE public.properties SET property_is_deleted = false, property_deleted_at = NULL,
         property_deleted_by = NULL, property_deletion_reason = NULL
   WHERE property_deletion_reason = v_reason;

  UPDATE public.contacts SET contact_is_deleted = false, contact_deleted_at = NULL,
         contact_deleted_by = NULL, contact_deletion_reason = NULL
   WHERE contact_deletion_reason = v_reason;

  UPDATE public.accounts SET account_is_deleted = false, account_deleted_at = NULL,
         account_deleted_by = NULL, account_deletion_reason = NULL
   WHERE account_deletion_reason = v_reason;
END $restore$;

SET LOCAL session_replication_role = origin;

DO $assert$
DECLARE v_gone text; v_steps int; v_both int; v_opps int;
BEGIN
  SELECT string_agg(x.rn, ', ') INTO v_gone FROM (
    SELECT account_record_number rn FROM public.accounts
     WHERE account_record_number IN ('ACC-07611','ACC-07612') AND account_is_deleted IS TRUE
    UNION ALL SELECT property_record_number FROM public.properties
     WHERE property_record_number = 'PROP-23736' AND property_is_deleted IS TRUE
    UNION ALL SELECT building_record_number FROM public.buildings
     WHERE building_record_number = 'BLD-00149' AND building_is_deleted IS TRUE
    UNION ALL SELECT unit_record_number FROM public.units
     WHERE unit_record_number = 'UNIT-00223' AND unit_is_deleted IS TRUE
    UNION ALL SELECT opportunity_record_number FROM public.opportunities
     WHERE opportunity_record_number IN ('OPP-00135','OPP-00140') AND opportunity_is_deleted IS TRUE
    UNION ALL SELECT project_record_number FROM public.projects
     WHERE project_record_number IN ('PROJ-00052','PROJ-00082') AND project_is_deleted IS TRUE
    UNION ALL SELECT work_order_record_number FROM public.work_orders
     WHERE work_order_record_number IN ('WO-00188','WO-00201') AND work_order_is_deleted IS TRUE
    UNION ALL SELECT contact_record_number FROM public.contacts
     WHERE contact_record_number IN ('CON-00125','CON-00126') AND contact_is_deleted IS TRUE
  ) x;
  IF v_gone IS NOT NULL THEN
    RAISE EXCEPTION 'Still deleted: %', v_gone;
  END IF;

  SELECT count(*) INTO v_steps FROM public.work_steps s
    JOIN public.work_orders w ON w.id = s.work_order_id
   WHERE w.work_order_record_number IN ('WO-00188','WO-00201')
     AND s.work_step_is_deleted IS NOT TRUE;
  IF v_steps <> 34 THEN
    RAISE EXCEPTION 'Expected 34 work steps restored, found %', v_steps;
  END IF;

  SELECT count(*) INTO v_both FROM public.properties
   WHERE property_record_number IN ('PROP-23734','PROP-23736')
     AND property_is_deleted IS NOT TRUE;
  IF v_both <> 2 THEN
    RAISE EXCEPTION 'Expected both Statesville Road properties live, found %', v_both;
  END IF;

  -- Both opportunities are back. The duplicate the guard objects to is the
  -- pre-existing state, restored deliberately rather than resolved by accident.
  SELECT count(*) INTO v_opps FROM public.opportunities
   WHERE opportunity_record_number IN ('OPP-00135','OPP-00140')
     AND opportunity_is_deleted IS NOT TRUE;
  IF v_opps <> 2 THEN
    RAISE EXCEPTION 'Expected both opportunities restored, found %', v_opps;
  END IF;

  IF EXISTS (SELECT 1 FROM public.properties WHERE property_deletion_reason LIKE 'Junk test data created 2026-08-05/13%')
     OR EXISTS (SELECT 1 FROM public.accounts WHERE account_deletion_reason LIKE 'Junk test data created 2026-08-05/13%') THEN
    RAISE EXCEPTION 'A record still carries the deletion reason.';
  END IF;
END $assert$;
