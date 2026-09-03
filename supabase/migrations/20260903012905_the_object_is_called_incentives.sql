-- =============================================================================
-- The object is called Incentives.
--
-- Nicholas, 2026-09-03: "I want to rename incentives. The name of the object
-- should be incentives, not incentive applications." And, on the enrollment
-- record type WI-IRA-MF: "rename the enrollment Wisconsin IRA Multifamily to
-- read Wisconsin IRA Multifamily Income Qualification."
--
-- WHAT IS RENAMED AND WHAT IS NOT.
--
-- Salesforce keeps an object's LABEL apart from its API NAME, and so does
-- LEAP. What changes is every name a person reads. What does NOT change is the
-- table `incentive_applications`, its `ia_` column prefix, its foreign keys,
-- and the URLs already pointing at it — renaming those would rewrite a hundred
-- references to change a word on a screen, and every one of them is a chance
-- to break a working path.
--
-- The nine STATUS values are renamed, values and labels together, because LEAP
-- names a status `[Object] [State]`: leaving them as "Incentive Application To
-- Be Prepared" under an object called Incentive would break the platform's own
-- naming rule the day the rename shipped. They are safe to rename because the
-- column is a uuid FK — every record, transition and history row points at the
-- id, not the text. Checked first, and found: zero report filters, zero saved
-- list views, zero dashboard widgets and zero page layouts carry the status
-- text, and exactly ONE database function looks a value up by name
-- (inherit_incentive_application_from_enrollment), patched below in the same
-- migration.
--
-- audit_log and field_history keep the words that were on screen when each
-- change was made. That is what a history is.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The nine statuses.
-- -----------------------------------------------------------------------------
UPDATE public.picklist_values
   SET picklist_value = regexp_replace(picklist_value, '^Incentive Application ', 'Incentive '),
       picklist_label = regexp_replace(picklist_label, '^Incentive Application ', 'Incentive ')
 WHERE picklist_object = 'incentive_applications'
   AND picklist_field  = 'ia_status'
   AND picklist_value LIKE 'Incentive Application %';

-- The one function that resolves a status by name rather than by id. Patched
-- in place: the rest of it is inheritance logic this change has no business
-- rewriting.
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'inherit_incentive_application_from_enrollment';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'inherit_incentive_application_from_enrollment is not installed';
  END IF;
  IF v_def NOT LIKE '%Incentive Application To Be Prepared%' THEN
    RETURN;  -- already patched
  END IF;
  v_new := replace(v_def, 'Incentive Application To Be Prepared', 'Incentive To Be Prepared');
  EXECUTE v_new;
END
$do$;

-- -----------------------------------------------------------------------------
-- 2. The names of the artifacts built for this object.
-- -----------------------------------------------------------------------------
UPDATE public.reports
   SET rpt_name = 'Incentives by Status'
 WHERE rpt_name = 'Incentive Applications by Status' AND coalesce(is_deleted, false) = false;

UPDATE public.saved_list_views
   SET list_view_name = replace(replace(list_view_name,
         'Incentive Applications', 'Incentives'), 'Incentive Application', 'Incentive')
 WHERE list_view_name ILIKE '%Incentive Application%';

UPDATE public.page_layouts
   SET page_layout_name = 'Incentive Layout'
 WHERE page_layout_name = 'Incentive Application Layout' AND coalesce(is_deleted, false) = false;

UPDATE public.email_templates
   SET name = replace(name, 'Incentive Application', 'Incentive')
 WHERE name ILIKE '%Incentive Application%';

-- The rename, spelled out once. Used by the help-article pass below and
-- dropped immediately after.
CREATE OR REPLACE FUNCTION public.rename_incentive_application_text(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT replace(replace(replace(replace(replace(replace(COALESCE(p_text, ''),
    'Incentive Applications', 'Incentives'),
    'Incentive applications', 'Incentives'),
    'incentive applications', 'incentives'),
    'Incentive Application',  'Incentive'),
    'Incentive application',  'Incentive'),
    'incentive application',  'incentive');
$function$;

-- -----------------------------------------------------------------------------
-- 3. The help articles, which are what a user reads when they are stuck.
--
-- Corrected in place rather than appended to: an article that names the object
-- by a name the screen no longer shows is a wrong instruction, not a stale one.
-- -----------------------------------------------------------------------------
-- Six spellings, not two: the articles carry "Incentive Applications",
-- "Incentive applications" (mid-sentence bold), and the all-lowercase forms,
-- in titles as well as bodies. A replacement list that covers only the two
-- obvious ones leaves the old name in a heading, which is exactly where a
-- reader looks first. Plural before singular, so "Applications" is never left
-- as a stray "s".
UPDATE public.help_articles
   SET ha_title         = public.rename_incentive_application_text(ha_title),
       ha_summary       = public.rename_incentive_application_text(ha_summary),
       ha_body_markdown = public.rename_incentive_application_text(ha_body_markdown)
 WHERE ha_title ILIKE '%incentive application%'
    OR coalesce(ha_summary, '') ILIKE '%incentive application%'
    OR ha_body_markdown ILIKE '%incentive application%';

-- A one-off, dropped as soon as it has done its work: a permanent function for
-- a rename that happens once would be a trap for the next reader.
DROP FUNCTION public.rename_incentive_application_text(text);

-- -----------------------------------------------------------------------------
-- 4. The enrollment record type WI-IRA-MF.
--
-- The LABEL is what a person reads and what derive_enrollment_name() composes
-- an enrollment's name from; the VALUE is the API name the price books,
-- programme configuration and submittedEnrollment.js key off, so it stays
-- WI-IRA-MF. The three live enrollments on it are touched afterwards so the
-- trigger recomposes their names — a record whose name still reads the old
-- record type is the same wrong-name problem one level down.
-- -----------------------------------------------------------------------------
UPDATE public.picklist_values
   SET picklist_label = 'Wisconsin IRA Multifamily Income Qualification'
 WHERE picklist_object = 'enrollments'
   AND picklist_field  = 'record_type'
   AND picklist_value  = 'WI-IRA-MF';

UPDATE public.enrollments e
   SET enrollment_updated_at = now()
 WHERE e.enrollment_is_deleted = false
   AND e.enrollment_record_type = (
     SELECT id FROM public.picklist_values
     WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type'
       AND picklist_value = 'WI-IRA-MF');

-- -----------------------------------------------------------------------------
-- 5. Prove it.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE v_n int; v_label text;
BEGIN
  SELECT count(*) INTO v_n FROM public.picklist_values
   WHERE picklist_object = 'incentive_applications' AND picklist_field = 'ia_status'
     AND picklist_is_active AND picklist_value LIKE 'Incentive %'
     AND picklist_value NOT LIKE 'Incentive Application%';
  IF v_n <> 9 THEN RAISE EXCEPTION 'expected 9 renamed incentive statuses, found %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.picklist_values
   WHERE picklist_object = 'incentive_applications' AND picklist_field = 'ia_status'
     AND (picklist_value LIKE '%Incentive Application%' OR picklist_label LIKE '%Incentive Application%');
  IF v_n <> 0 THEN RAISE EXCEPTION '% incentive status(es) still carry the old name', v_n; END IF;

  -- Every live record still points at a status that resolves. Renaming the
  -- text must not have orphaned one.
  SELECT count(*) INTO v_n FROM public.incentive_applications ia
   WHERE ia.ia_is_deleted = false AND ia.ia_status IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.picklist_values pv WHERE pv.id = ia.ia_status);
  IF v_n <> 0 THEN RAISE EXCEPTION '% incentive(s) point at a status that no longer exists', v_n; END IF;

  -- The default the inheritance trigger reaches for must still be findable.
  IF NOT EXISTS (
    SELECT 1 FROM public.picklist_values
    WHERE picklist_object = 'incentive_applications' AND picklist_field = 'ia_status'
      AND picklist_value = 'Incentive To Be Prepared' AND picklist_is_active
  ) THEN
    RAISE EXCEPTION 'the renamed default status "Incentive To Be Prepared" does not exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'inherit_incentive_application_from_enrollment'
      AND p.prosrc LIKE '%Incentive Application To Be Prepared%'
  ) THEN
    RAISE EXCEPTION 'the inheritance trigger still looks up the old status name';
  END IF;

  -- Nothing a person reads still says the old name.
  SELECT count(*) INTO v_n FROM public.help_articles
   WHERE ha_is_deleted = false
     AND (ha_title ILIKE '%incentive application%' OR ha_body_markdown ILIKE '%incentive application%');
  IF v_n <> 0 THEN RAISE EXCEPTION '% help article(s) still name the object Incentive Application', v_n; END IF;

  -- The enrollment record type, and the names derived from it.
  SELECT picklist_label INTO v_label FROM public.picklist_values
   WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type' AND picklist_value = 'WI-IRA-MF';
  IF v_label IS DISTINCT FROM 'Wisconsin IRA Multifamily Income Qualification' THEN
    RAISE EXCEPTION 'the WI-IRA-MF record type reads "%"', v_label;
  END IF;

  SELECT count(*) INTO v_n FROM public.enrollments e
   WHERE e.enrollment_is_deleted = false
     AND e.enrollment_record_type = (SELECT id FROM public.picklist_values
       WHERE picklist_object = 'enrollments' AND picklist_field = 'record_type' AND picklist_value = 'WI-IRA-MF')
     AND e.enrollment_name NOT LIKE '%Wisconsin IRA Multifamily Income Qualification';
  IF v_n <> 0 THEN RAISE EXCEPTION '% enrollment(s) still carry the old record type in their name', v_n; END IF;
END
$do$;

NOTIFY pgrst, 'reload schema';
