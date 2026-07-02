-- =====================================================================
-- Activity multi-relate (Salesforce-style shared activities) — v1
--
-- An activity can now relate to MANY records (the record it was logged on,
-- the contact(s) it's with, and any other opportunity/property/project/etc.
-- the user links). Each linked record's Activity timeline shows the
-- activity — log once, appears everywhere it's connected.
--
--   * activity_relations         — junction (activity <-> record), RLS-guarded
--   * backfill                   — existing activities' anchor + contact
--   * log_activity(…, p_relations jsonb)  — writes the relation rows
--   * list_activities_for_record — now rolls up via the junction
-- =====================================================================

-- --- Junction table ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_relations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id       uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  ar_related_object text NOT NULL,
  ar_related_id     uuid NOT NULL,
  ar_role           text NOT NULL DEFAULT 'related',   -- 'anchor' | 'contact' | 'related'
  ar_created_at     timestamptz NOT NULL DEFAULT now(),
  ar_created_by     uuid,
  UNIQUE (activity_id, ar_related_object, ar_related_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_relations_record
  ON public.activity_relations (ar_related_object, ar_related_id);
CREATE INDEX IF NOT EXISTS idx_activity_relations_activity
  ON public.activity_relations (activity_id);

ALTER TABLE public.activity_relations ENABLE ROW LEVEL SECURITY;

-- Mirror the activities table's permission model (app_user_can('activities', …)).
DROP POLICY IF EXISTS app_select_activity_relations ON public.activity_relations;
DROP POLICY IF EXISTS app_insert_activity_relations ON public.activity_relations;
DROP POLICY IF EXISTS app_update_activity_relations ON public.activity_relations;
DROP POLICY IF EXISTS app_delete_activity_relations ON public.activity_relations;
CREATE POLICY app_select_activity_relations ON public.activity_relations
  FOR SELECT USING ((SELECT app_user_can('activities','read')));
CREATE POLICY app_insert_activity_relations ON public.activity_relations
  FOR INSERT WITH CHECK ((SELECT app_user_can('activities','create')));
CREATE POLICY app_update_activity_relations ON public.activity_relations
  FOR UPDATE USING ((SELECT app_user_can('activities','update')))
             WITH CHECK ((SELECT app_user_can('activities','update')));
CREATE POLICY app_delete_activity_relations ON public.activity_relations
  FOR DELETE USING ((SELECT app_user_can('activities','delete')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_relations TO authenticated;

-- --- Backfill existing activities -------------------------------------
INSERT INTO public.activity_relations (activity_id, ar_related_object, ar_related_id, ar_role, ar_created_by)
SELECT a.id, a.related_object, a.related_id, 'anchor', a.performed_by
FROM public.activities a
WHERE a.related_object IS NOT NULL AND a.related_id IS NOT NULL
ON CONFLICT (activity_id, ar_related_object, ar_related_id) DO NOTHING;

INSERT INTO public.activity_relations (activity_id, ar_related_object, ar_related_id, ar_role, ar_created_by)
SELECT a.id, a.secondary_object, a.secondary_id, 'contact', a.performed_by
FROM public.activities a
WHERE a.secondary_object IS NOT NULL AND a.secondary_id IS NOT NULL
ON CONFLICT (activity_id, ar_related_object, ar_related_id) DO NOTHING;

-- --- Rewrite log_activity to also write the relation rows -------------
DROP FUNCTION IF EXISTS public.log_activity(text, uuid, text, text, text, text, integer, timestamptz, text, uuid);

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
  p_secondary_id     uuid        DEFAULT NULL,
  p_relations        jsonb       DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id   uuid;
  v_me   uuid;
  v_rel  jsonb;
BEGIN
  IF p_related_object IS NULL OR p_related_id IS NULL OR p_activity_type IS NULL THEN
    RAISE EXCEPTION 'related_object, related_id and activity_type are required';
  END IF;
  v_me := current_app_user_id();

  INSERT INTO public.activities (
    activity_type, subject, body, related_object, related_id,
    secondary_object, secondary_id, direction, duration_seconds,
    performed_by, performed_at
  ) VALUES (
    p_activity_type, p_subject, p_body, p_related_object, p_related_id,
    p_secondary_object, p_secondary_id, p_direction, p_duration_seconds,
    v_me, COALESCE(p_performed_at, now())
  )
  RETURNING id INTO v_id;

  INSERT INTO public.activity_relations (activity_id, ar_related_object, ar_related_id, ar_role, ar_created_by)
  VALUES (v_id, p_related_object, p_related_id, 'anchor', v_me)
  ON CONFLICT (activity_id, ar_related_object, ar_related_id) DO NOTHING;

  IF p_secondary_object IS NOT NULL AND p_secondary_id IS NOT NULL THEN
    INSERT INTO public.activity_relations (activity_id, ar_related_object, ar_related_id, ar_role, ar_created_by)
    VALUES (v_id, p_secondary_object, p_secondary_id, 'contact', v_me)
    ON CONFLICT (activity_id, ar_related_object, ar_related_id) DO NOTHING;
  END IF;

  IF p_relations IS NOT NULL AND jsonb_typeof(p_relations) = 'array' THEN
    FOR v_rel IN SELECT * FROM jsonb_array_elements(p_relations) LOOP
      IF (v_rel->>'object') IS NOT NULL AND (v_rel->>'id') IS NOT NULL THEN
        INSERT INTO public.activity_relations (activity_id, ar_related_object, ar_related_id, ar_role, ar_created_by)
        VALUES (v_id, v_rel->>'object', (v_rel->>'id')::uuid,
                COALESCE(NULLIF(v_rel->>'role',''), 'related'), v_me)
        ON CONFLICT (activity_id, ar_related_object, ar_related_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_id;
END;
$function$;

-- --- Roll up: list activities for a record via the junction ----------
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
  JOIN public.activity_relations ar ON ar.activity_id = a.id
                                   AND ar.ar_related_object = p_related_object
                                   AND ar.ar_related_id     = p_related_id
  LEFT JOIN public.users    u ON u.id = a.performed_by
  LEFT JOIN public.contacts c ON a.secondary_object = 'contacts'
                             AND c.id = a.secondary_id
  ORDER BY a.performed_at DESC NULLS LAST, a.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.log_activity(text, uuid, text, text, text, text, integer, timestamptz, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_activity(text, uuid, text, text, text, text, integer, timestamptz, text, uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
