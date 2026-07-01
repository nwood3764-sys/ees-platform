-- =====================================================================
-- Call logging on records — activities picklists + RPCs (v1)
--
-- Adds the data-layer plumbing for logging calls (and other manual
-- activities) against any record via the polymorphic public.activities
-- table. Nothing is hardcoded: activity_type and direction are seeded as
-- managed picklist values so LEAP Admin can extend/relabel them.
--
--   * picklist_values seed: activities.activity_type + activities.direction
--   * list_activities_for_record()  — RLS-respecting read for the timeline
--   * log_activity()                — RLS-respecting insert, stamps the
--                                     performer from current_app_user_id()
--
-- Both functions are SECURITY INVOKER so the existing app_*_activities RLS
-- policies (app_user_can 'read'/'create') continue to govern access.
-- =====================================================================

-- --- Picklist: activities.activity_type -------------------------------
INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_at)
SELECT gen_random_uuid(), 'activities', 'activity_type', v.value, v.label,
       true, v.sort_order, now()
FROM (VALUES
  ('Call',    'Call',    10),
  ('Email',   'Email',   20),
  ('Meeting', 'Meeting', 30),
  ('Note',    'Note',    40),
  ('Other',   'Other',   50)
) AS v(value, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object = 'activities'
    AND p.picklist_field  = 'activity_type'
    AND p.picklist_value  = v.value
);

-- --- Picklist: activities.direction -----------------------------------
INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_at)
SELECT gen_random_uuid(), 'activities', 'direction', v.value, v.label,
       true, v.sort_order, now()
FROM (VALUES
  ('Outbound', 'Outbound', 10),
  ('Inbound',  'Inbound',  20)
) AS v(value, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object = 'activities'
    AND p.picklist_field  = 'direction'
    AND p.picklist_value  = v.value
);

-- --- Read: list_activities_for_record ---------------------------------
-- Returns the activity feed for one record (calls, notes, etc.), newest
-- first, with the performer's name and — when the activity is linked to a
-- contact via secondary_object='contacts' — the contact's name resolved.
CREATE OR REPLACE FUNCTION public.list_activities_for_record(
  p_related_object text,
  p_related_id     uuid
)
RETURNS TABLE (
  id                uuid,
  activity_type     text,
  subject           text,
  body              text,
  direction         text,
  duration_seconds  integer,
  performed_at      timestamptz,
  performed_by      uuid,
  performed_by_name text,
  secondary_object  text,
  secondary_id      uuid,
  contact_name      text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    a.id, a.activity_type, a.subject, a.body, a.direction,
    a.duration_seconds, a.performed_at, a.performed_by,
    COALESCE(NULLIF(TRIM(COALESCE(u.user_first_name,'') || ' ' ||
                         COALESCE(u.user_last_name,'')), ''),
             u.user_name) AS performed_by_name,
    a.secondary_object, a.secondary_id,
    CASE WHEN a.secondary_object = 'contacts' THEN c.contact_name END AS contact_name
  FROM public.activities a
  LEFT JOIN public.users    u ON u.id = a.performed_by
  LEFT JOIN public.contacts c ON a.secondary_object = 'contacts'
                             AND c.id = a.secondary_id
  WHERE a.related_object = p_related_object
    AND a.related_id     = p_related_id
  ORDER BY a.performed_at DESC NULLS LAST, a.created_at DESC;
$function$;

-- --- Write: log_activity ----------------------------------------------
-- Inserts a manual activity (e.g. a logged call) against a record. The
-- performer is stamped from the current app user; RLS still applies since
-- this is SECURITY INVOKER. Returns the new activity id.
CREATE OR REPLACE FUNCTION public.log_activity(
  p_related_object   text,
  p_related_id       uuid,
  p_activity_type    text,
  p_subject          text        DEFAULT NULL,
  p_body             text        DEFAULT NULL,
  p_direction        text        DEFAULT NULL,
  p_duration_seconds integer     DEFAULT NULL,
  p_performed_at     timestamptz DEFAULT NULL,
  p_secondary_object text        DEFAULT NULL,
  p_secondary_id     uuid        DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_related_object IS NULL OR p_related_id IS NULL OR p_activity_type IS NULL THEN
    RAISE EXCEPTION 'related_object, related_id and activity_type are required';
  END IF;

  INSERT INTO public.activities (
    activity_type, subject, body, related_object, related_id,
    secondary_object, secondary_id, direction, duration_seconds,
    performed_by, performed_at
  ) VALUES (
    p_activity_type, p_subject, p_body, p_related_object, p_related_id,
    p_secondary_object, p_secondary_id, p_direction, p_duration_seconds,
    current_app_user_id(), COALESCE(p_performed_at, now())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_activities_for_record(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_activity(text, uuid, text, text, text, text, integer, timestamptz, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_activities_for_record(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_activity(text, uuid, text, text, text, text, integer, timestamptz, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
