-- The two junk accounts, and everything under them.
--
-- Nicholas: "get rid of the junk accounts and delete any child objects."
--
-- ACC-07611 "ljsdflhjBF" and ACC-07612 "adfz" were typed as SERVICE-PROVIDER,
-- so scoping the contractor picker to that record type promoted two pieces of
-- keyboard-mash from invisible (2 rows in 6,536) to two of the options a person
-- now chooses a contractor from.
--
-- CHECKED BEFORE DELETING, because one of them was not obviously junk beneath
-- the surface: ACC-07612 owns PROP-23736 "15008 Statesville Road - Huntersville"
-- with a building, a unit, two NC-IRA-SF-HOMES-AUDIT opportunities, two
-- projects and two work orders. A real North Carolina address with real
-- programme record types is exactly the shape of something that must not be
-- deleted on the strength of its parent's name.
--
-- It is inert. The work orders have no status, no assigned technician, no
-- scheduled date and ZERO photos; their 34 work steps are the ones the work
-- plan trigger instantiates on creation, not work anybody did. There are no
-- enrollments, no incentive applications, no assessments and no line items
-- anywhere in the tree. And the address is duplicated: PROP-23734 holds the
-- same street, created 65 minutes earlier the same afternoon. Nothing here
-- records that anyone was at that building.
--
-- SOFT DELETE, as everything on this platform is (block_hard_delete). The rows
-- stay recoverable from the recycle bin, and the reason travels with each one
-- so a person finding them later knows what they were and who called it.
--
-- DELIBERATELY NOT TOUCHED: PROP-23734 and its owning account "lucas Wood",
-- the other half of that afternoon's test data. Nicholas named two accounts;
-- deleting a third because it looks similar is the adjacent-record tidying this
-- repo forbids. It is reported instead.

DO $cleanup$
DECLARE
  v_reason text := 'Junk test data created 2026-08-05/13. Account name was keyboard mash; the tree beneath it has no photos, no evidence, no enrollment, no incentive application and a duplicate address. Removed at Nicholas''s instruction, 2026-09-03.';
  v_acct uuid[];
  v_props uuid[];
  v_blds uuid[];
  v_opps uuid[];
  v_wos uuid[];
BEGIN
  SELECT array_agg(id) INTO v_acct FROM public.accounts
   WHERE account_record_number IN ('ACC-07611','ACC-07612') AND account_is_deleted IS NOT TRUE;
  IF v_acct IS NULL THEN RETURN; END IF;

  SELECT array_agg(id) INTO v_props FROM public.properties
   WHERE property_account_id = ANY(v_acct) AND property_is_deleted IS NOT TRUE;
  SELECT array_agg(id) INTO v_blds FROM public.buildings
   WHERE property_id = ANY(COALESCE(v_props,'{}')) AND building_is_deleted IS NOT TRUE;
  SELECT array_agg(id) INTO v_opps FROM public.opportunities
   WHERE (opportunity_account_id = ANY(v_acct) OR property_id = ANY(COALESCE(v_props,'{}')))
     AND opportunity_is_deleted IS NOT TRUE;
  SELECT array_agg(id) INTO v_wos FROM public.work_orders
   WHERE (opportunity_id = ANY(COALESCE(v_opps,'{}')) OR property_id = ANY(COALESCE(v_props,'{}')))
     AND work_order_is_deleted IS NOT TRUE;

  -- Children first, so nothing is left pointing at a deleted parent mid-way.
  UPDATE public.work_steps SET work_step_is_deleted = true, work_step_deleted_at = now(),
         work_step_deletion_reason = v_reason
   WHERE work_order_id = ANY(COALESCE(v_wos,'{}')) AND work_step_is_deleted IS NOT TRUE;

  UPDATE public.work_plans SET work_plan_is_deleted = true, work_plan_deleted_at = now(),
         work_plan_deletion_reason = v_reason
   WHERE work_order_id = ANY(COALESCE(v_wos,'{}')) AND work_plan_is_deleted IS NOT TRUE;

  UPDATE public.service_appointments SET sa_is_deleted = true, sa_deleted_at = now(),
         sa_deletion_reason = v_reason
   WHERE work_order_id = ANY(COALESCE(v_wos,'{}')) AND sa_is_deleted IS NOT TRUE;

  UPDATE public.work_orders SET work_order_is_deleted = true, work_order_deleted_at = now(),
         work_order_deletion_reason = v_reason
   WHERE id = ANY(COALESCE(v_wos,'{}')) AND work_order_is_deleted IS NOT TRUE;

  UPDATE public.projects SET project_is_deleted = true, project_deleted_at = now(),
         project_deletion_reason = v_reason
   WHERE opportunity_id = ANY(COALESCE(v_opps,'{}')) AND project_is_deleted IS NOT TRUE;

  UPDATE public.opportunities SET opportunity_is_deleted = true, opportunity_deleted_at = now(),
         opportunity_deletion_reason = v_reason
   WHERE id = ANY(COALESCE(v_opps,'{}')) AND opportunity_is_deleted IS NOT TRUE;

  UPDATE public.units SET unit_is_deleted = true, unit_deleted_at = now(),
         unit_deletion_reason = v_reason
   WHERE building_id = ANY(COALESCE(v_blds,'{}')) AND unit_is_deleted IS NOT TRUE;

  UPDATE public.buildings SET building_is_deleted = true, building_deleted_at = now(),
         building_deletion_reason = v_reason
   WHERE id = ANY(COALESCE(v_blds,'{}')) AND building_is_deleted IS NOT TRUE;

  UPDATE public.properties SET property_is_deleted = true, property_deleted_at = now(),
         property_deletion_reason = v_reason
   WHERE id = ANY(COALESCE(v_props,'{}')) AND property_is_deleted IS NOT TRUE;

  UPDATE public.contacts SET contact_is_deleted = true, contact_deleted_at = now(),
         contact_deletion_reason = v_reason
   WHERE contact_account_id = ANY(v_acct) AND contact_is_deleted IS NOT TRUE;

  UPDATE public.accounts SET account_is_deleted = true, account_deleted_at = now(),
         account_deletion_reason = v_reason
   WHERE id = ANY(v_acct) AND account_is_deleted IS NOT TRUE;
END $cleanup$;

DO $assert$
DECLARE v_left int; v_junk int; v_survivor int; v_orphan int;
BEGIN
  SELECT count(*) INTO v_left FROM public.accounts
   WHERE account_record_number IN ('ACC-07611','ACC-07612') AND account_is_deleted IS NOT TRUE;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '% junk accounts are still live', v_left;
  END IF;

  -- The picker is the reason this mattered: neither name may appear in it.
  -- Counted by name rather than by total, so adding a real service provider
  -- tomorrow does not break this assertion for no reason.
  SELECT count(*) INTO v_junk FROM public.list_service_provider_accounts(NULL)
   WHERE account_name IN ('adfz','ljsdflhjBF');
  IF v_junk <> 0 THEN
    RAISE EXCEPTION 'The contractor picker still offers a junk account.';
  END IF;

  -- Nothing beyond the named tree was swept up. The other half of that
  -- afternoon's test data is still there, on purpose.
  SELECT count(*) INTO v_survivor FROM public.properties
   WHERE property_record_number = 'PROP-23734' AND property_is_deleted IS NOT TRUE;
  IF v_survivor <> 1 THEN
    RAISE EXCEPTION 'PROP-23734 was deleted; only the two named accounts and their tree should have been.';
  END IF;

  -- And nothing live is left pointing INTO the deleted tree.
  SELECT count(*) INTO v_orphan FROM public.work_orders w
    JOIN public.properties p ON p.id = w.property_id
   WHERE p.property_is_deleted IS TRUE AND w.work_order_is_deleted IS NOT TRUE
     AND p.property_record_number = 'PROP-23736';
  IF v_orphan <> 0 THEN
    RAISE EXCEPTION '% live work orders still hang off the deleted property', v_orphan;
  END IF;
END $assert$;
