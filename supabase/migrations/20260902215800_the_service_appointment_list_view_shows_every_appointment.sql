-- The Service Appointments tab is the service appointments LIST VIEW.
--
-- Nicholas, 2026-09-02, in the Field module: "Isn't this supposed to be the
-- service appointment list view? Why can't I ever see past service
-- appointments? It just gives me a dropdown for future."
--
-- The tab named after the object rendered a dispatcher's INBOX — scheduled
-- appointments from now through a 7/14/30/60-day window, and nothing else. It
-- could not show a past appointment by construction. And since all 104 service
-- appointments on this database are in the past (102) or carry no scheduled
-- time (2), and zero are in the future, the tab was empty on every one of those
-- four dropdown settings. Every appointment in the platform was unreachable
-- from the tab named after them.
--
-- The code change puts the object's real list view on that tab and moves the
-- inbox to its own tab, named for what it does. This migration does the three
-- data halves:
--
--   1. the Appointment Inbox tab, ordered next to the list it complements;
--   2. four purpose-built saved views for service appointments — including the
--      Past view the complaint asks for by name;
--   3. seven OTHER saved views, on five objects, whose filters have never once
--      been applied.
--
-- On (3): a saved list view stores its filters as {field, op, value}. Seven
-- views seeded before the universal list view existed stored {field, operator,
-- value} and named columns the list does not have (`status`, `scheduled_date`).
-- The evaluator reads `op`, finds nothing, and falls through to "matches" — so
-- "To Be Verified" listed every work order, "Corrections Needed" listed every
-- work order, and "Assessments To Be Reviewed" listed every assessment. A view
-- that shows everything under a name that promises a subset is the same defect
-- as the tab above: the screen says one thing and shows another. Fixed in place
-- rather than deleted, so the views people have starred keep their identity.
--
-- Two of them also named a status that no longer exists. Work order statuses
-- are "To Be Verified", not "Work Order To Be Verified" — the object's name is
-- not part of the value. And "Project In Progress" was retired earlier today
-- when the project lifecycle was cut to seven statuses; its successor is
-- "Project Underway", so the view is renamed to say so rather than keeping a
-- name whose status is gone.
--
-- No DDL. Nothing is deleted.

BEGIN;

-- ─── 1. The Appointment Inbox tab ────────────────────────────────────────────
-- Placed immediately after Service Appointments: the list is the object, the
-- inbox is the week ahead, and they are read together. Appending it instead
-- (which is what an unconfigured code tab does) would have put the dispatcher's
-- board at the far end of the strip, past Time Sheets.

UPDATE module_sections
   SET ms_sort_order = ms_sort_order + 1
 WHERE ms_module_id = 'field'
   AND ms_is_deleted IS NOT TRUE
   AND ms_sort_order >= 2;

INSERT INTO module_sections (
  ms_record_number, ms_module_id, ms_section_id, ms_label,
  ms_sort_order, ms_is_visible, ms_is_system, ms_object_table
)
SELECT '', 'field', 'appointment_inbox', 'Appointment Inbox', 2, true, true, NULL
 WHERE NOT EXISTS (
   SELECT 1 FROM module_sections
    WHERE ms_module_id = 'field' AND ms_section_id = 'appointment_inbox'
      AND ms_is_deleted IS NOT TRUE
 );

-- ─── 2. Saved views for service appointments ─────────────────────────────────
-- The object had none at all, so its list opened with whatever the schema
-- happened to derive and no way to ask the two questions a person actually has:
-- what happened, and what is coming.
--
-- The date filters are RELATIVE literals, not calendar dates. "Today's Service
-- Appointments" has to be true tomorrow as well; a fixed date would be a view
-- that is correct for one morning and a lie for the rest of the platform's
-- life. The literals are resolved at run time by the same date kernel the
-- report builder uses (src/lib/reportFilters.js) — there is one definition of
-- "before today" on this platform, not two.
--
-- "All Service Appointments" sorts first alphabetically, which is the view a
-- list opens on, and it carries no filter — so the tab now answers the original
-- complaint on first paint: every appointment, most recent first.

DO $$
DECLARE
  v_owner uuid;
  v_columns jsonb := jsonb_build_array(
    'id', 'name', 'sa_status__label',
    'sa_scheduled_start_time', 'sa_scheduled_end_time',
    'work_type_id__rel__work_type_name',
    'work_order_id__rel__work_order_name',
    'sa_owner__label'
  );
  v_seeded int;
BEGIN
  SELECT id INTO v_owner FROM users WHERE user_record_number = 'USR-00007';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Could not resolve the seeding owner (USR-00007)';
  END IF;

  INSERT INTO saved_list_views (
    list_view_record_number, list_view_name, list_view_object, list_view_module,
    list_view_filters, list_view_sort_field, list_view_sort_direction,
    list_view_visible_columns, list_view_is_shared, list_view_owner, list_view_created_by
  )
  SELECT '', v.name, 'service_appointments', 'field',
         v.filters, 'sa_scheduled_start_time', v.dir,
         v_columns, true, v_owner, v_owner
    FROM (VALUES
      ('All Service Appointments',
       '[]'::jsonb, 'desc'),
      ('Past Service Appointments',
       jsonb_build_array(jsonb_build_object(
         'field', 'sa_scheduled_start_time', 'label', 'Scheduled Start Time',
         'op', 'lt', 'value', 'TODAY')), 'desc'),
      ('Today''s Service Appointments',
       jsonb_build_array(jsonb_build_object(
         'field', 'sa_scheduled_start_time', 'label', 'Scheduled Start Time',
         'op', 'equals', 'value', 'TODAY')), 'asc'),
      ('Upcoming Service Appointments',
       jsonb_build_array(jsonb_build_object(
         'field', 'sa_scheduled_start_time', 'label', 'Scheduled Start Time',
         'op', 'from', 'value', 'TODAY')), 'asc')
    ) AS v(name, filters, dir)
   WHERE NOT EXISTS (
     SELECT 1 FROM saved_list_views s
      WHERE s.list_view_object = 'service_appointments'
        AND s.list_view_name = v.name
        AND s.is_deleted IS NOT TRUE
   );

  SELECT count(*) INTO v_seeded
    FROM saved_list_views
   WHERE list_view_object = 'service_appointments' AND is_deleted IS NOT TRUE;
  IF v_seeded < 4 THEN
    RAISE EXCEPTION 'Expected at least 4 service appointment views, found %', v_seeded;
  END IF;
END $$;

-- ─── 3. The seven views whose filters never ran ──────────────────────────────

UPDATE saved_list_views SET list_view_filters = jsonb_build_array(jsonb_build_object(
         'field', 'work_order_status__label', 'label', 'Status',
         'op', 'equals', 'value', 'To Be Verified'))
 WHERE list_view_record_number = 'LV-00002';

UPDATE saved_list_views SET list_view_filters = jsonb_build_array(jsonb_build_object(
         'field', 'work_order_status__label', 'label', 'Status',
         'op', 'equals', 'value', 'Corrections Needed'))
 WHERE list_view_record_number = 'LV-00003';

-- "today" was already what this view meant; it simply had no way to say it.
UPDATE saved_list_views SET list_view_filters = jsonb_build_array(
         jsonb_build_object('field', 'work_order_status__label', 'label', 'Status',
                            'op', 'equals', 'value', 'In Progress'),
         jsonb_build_object('field', 'work_order_scheduled_start_date', 'label', 'Scheduled Start Date',
                            'op', 'equals', 'value', 'TODAY')),
       list_view_sort_field = 'work_order_scheduled_start_date'
 WHERE list_view_record_number = 'LV-00004';

UPDATE saved_list_views SET list_view_filters = jsonb_build_array(jsonb_build_object(
         'field', 'project_status__label', 'label', 'Status',
         'op', 'equals', 'value', 'Project To Be Scheduled'))
 WHERE list_view_record_number = 'LV-00006';

-- The status this view named was retired today. Renamed to its successor
-- rather than left pointing at a value no project can hold.
UPDATE saved_list_views SET list_view_filters = jsonb_build_array(jsonb_build_object(
         'field', 'project_status__label', 'label', 'Status',
         'op', 'equals', 'value', 'Project Underway')),
       list_view_name = 'Projects Underway'
 WHERE list_view_record_number = 'LV-00007';

-- Two values, so the op is `equals` with an array — the list's own spelling of
-- "is any of these". `in` is the report builder's vocabulary and means nothing
-- here.
UPDATE saved_list_views SET list_view_filters = jsonb_build_array(jsonb_build_object(
         'field', 'dfr_status__label', 'label', 'Status',
         'op', 'equals', 'value', jsonb_build_array('Open', 'In Progress')))
 WHERE list_view_record_number = 'LV-00102';

-- This one stored a picklist UUID as its value. The list filters on the LABEL,
-- which is what the row shows and what a person types — an id could never match.
UPDATE saved_list_views SET list_view_filters = jsonb_build_array(jsonb_build_object(
         'field', 'assessment_status__label', 'label', 'Status',
         'op', 'equals', 'value', 'To Be Reviewed'))
 WHERE list_view_record_number = 'LV-00103';

-- ─── Assertions ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_dead int;
  v_bad_status int;
BEGIN
  -- No live saved view may still carry the `operator` spelling: it is read by
  -- nothing, so such a filter matches every row and the view lies about itself.
  SELECT count(*) INTO v_dead
    FROM saved_list_views s,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(s.list_view_filters) = 'array'
                THEN s.list_view_filters
                ELSE coalesce(s.list_view_filters -> 'filters', '[]'::jsonb) END) f
   WHERE s.is_deleted IS NOT TRUE
     AND f ? 'operator' AND NOT (f ? 'op');
  IF v_dead > 0 THEN
    RAISE EXCEPTION '% saved list view filter(s) still use the unread `operator` key', v_dead;
  END IF;

  -- Every status value a live view filters on must be a value that exists.
  SELECT count(*) INTO v_bad_status
    FROM saved_list_views s,
         LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(s.list_view_filters) = 'array'
                THEN s.list_view_filters
                ELSE coalesce(s.list_view_filters -> 'filters', '[]'::jsonb) END) f
   WHERE s.is_deleted IS NOT TRUE
     AND f ->> 'field' LIKE '%\_status\_\_label'
     AND EXISTS (
       -- Every value the filter names, whether it holds one or several.
       SELECT 1
         FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(f -> 'value') = 'array'
                     THEN f -> 'value'
                     ELSE jsonb_build_array(f ->> 'value') END) AS want(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM picklist_values p
           WHERE p.picklist_field = replace(f ->> 'field', '__label', '')
             AND p.picklist_value = want.value
        )
     );
  IF v_bad_status > 0 THEN
    RAISE EXCEPTION '% saved view(s) filter on a status value that does not exist', v_bad_status;
  END IF;

  -- The inbox tab exists exactly once and sits beside the list it complements.
  IF (SELECT count(*) FROM module_sections
       WHERE ms_module_id = 'field' AND ms_section_id = 'appointment_inbox'
         AND ms_is_deleted IS NOT TRUE) <> 1 THEN
    RAISE EXCEPTION 'the Appointment Inbox tab was not registered exactly once';
  END IF;
  IF (SELECT ms_sort_order FROM module_sections
       WHERE ms_module_id = 'field' AND ms_section_id = 'service_appointments'
         AND ms_is_deleted IS NOT TRUE)
     >= (SELECT ms_sort_order FROM module_sections
          WHERE ms_module_id = 'field' AND ms_section_id = 'appointment_inbox'
            AND ms_is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'the Appointment Inbox tab must follow Service Appointments';
  END IF;
END $$;

COMMIT;
