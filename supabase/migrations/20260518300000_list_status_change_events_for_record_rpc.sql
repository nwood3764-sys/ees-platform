-- =========================================================================
-- list_status_change_events_for_record(p_object, p_record_id)
--
-- Returns status_change_events rows for a single record, with picklist
-- labels for the from/to statuses, the transition label and record number
-- from the authorizing status_transitions edge, and the actor name from
-- the public.users table. Patterned on list_email_sends_for_record.
--
-- SECURITY INVOKER — RLS on status_change_events (and on the joined
-- tables) controls what the caller can see. Read access on
-- status_change_events is open to authenticated users (per HA-00054);
-- since the caller is already viewing the parent record, they already
-- have visibility into the record's status history.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.list_status_change_events_for_record(
  p_object     text,
  p_record_id  uuid
)
RETURNS TABLE (
  id                     uuid,
  sce_record_number      text,
  sce_created_at         timestamptz,
  sce_note               text,
  sce_status_field       text,
  transition_id          uuid,
  transition_record_number text,
  transition_label       text,
  from_status_label      text,
  to_status_label        text,
  actor_user_id          uuid,
  actor_name             text
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    sce.id,
    sce.sce_record_number,
    sce.sce_created_at,
    sce.sce_note,
    st.st_status_field          AS sce_status_field,
    st.id                       AS transition_id,
    st.st_record_number         AS transition_record_number,
    st.st_transition_label      AS transition_label,
    pv_from.picklist_label      AS from_status_label,
    pv_to.picklist_label        AS to_status_label,
    sce.sce_created_by          AS actor_user_id,
    NULLIF(
      trim(COALESCE(u.user_first_name, '') || ' ' || COALESCE(u.user_last_name, '')),
      ''
    )                           AS actor_name
  FROM public.status_change_events sce
  LEFT JOIN public.status_transitions st
    ON st.id = sce.sce_transition_id
  LEFT JOIN public.picklist_values pv_from
    ON pv_from.id = sce.sce_from_status_id
  LEFT JOIN public.picklist_values pv_to
    ON pv_to.id = sce.sce_to_status_id
  LEFT JOIN public.users u
    ON u.id = sce.sce_created_by
  WHERE sce.sce_object    = p_object
    AND sce.sce_record_id = p_record_id
    AND sce.sce_is_deleted = false
  ORDER BY sce.sce_created_at DESC, sce.sce_record_number DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_status_change_events_for_record(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.list_status_change_events_for_record(text, uuid) IS
  'Returns status_change_events for a single record with joined transition label, from/to status labels, and actor name. Powers the Status changes feed within ActivityTimeline.';
