-- =========================================================================
-- status_change_events: structured audit trail of every successful
-- change_record_status invocation. Stores the (object, record_id) tuple
-- plus the transition row that authorized the change, the from/to
-- statuses, an optional human note, and standard audit columns.
--
-- Distinct from the generic audit_log/field_history captures because:
--   1. The transition_id provides direct traceability back to the
--      Lifecycle Builder edge that authorized the change
--   2. Allows attaching a human note to the change at the moment it
--      happens (audit_log only captures the bare field diff)
--   3. Powers per-record status timelines and cycle-time reports
--      without joining audit_log on string-shaped field names
-- =========================================================================

CREATE SEQUENCE IF NOT EXISTS public.seq_status_change_events;

CREATE TABLE public.status_change_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sce_record_number      text NOT NULL,
  sce_object             text NOT NULL,
  sce_record_id          uuid NOT NULL,
  sce_transition_id      uuid NOT NULL REFERENCES public.status_transitions(id),
  sce_from_status_id     uuid          REFERENCES public.picklist_values(id),
  sce_to_status_id       uuid NOT NULL REFERENCES public.picklist_values(id),
  sce_note               text,
  sce_created_by         uuid NOT NULL REFERENCES public.users(id),
  sce_created_at         timestamptz NOT NULL DEFAULT now(),
  sce_is_deleted         boolean NOT NULL DEFAULT false,
  sce_deleted_at         timestamptz,
  sce_deleted_by         uuid REFERENCES public.users(id),
  sce_deletion_reason    text
);

COMMENT ON TABLE public.status_change_events IS 'Structured audit trail of change_record_status invocations. One row per successful status change, linked to the status_transitions edge that authorized it.';

CREATE OR REPLACE FUNCTION public.set_status_change_event_record_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sce_record_number := generate_record_number('SCE-', 'seq_status_change_events');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sce_rn
  BEFORE INSERT ON public.status_change_events
  FOR EACH ROW EXECUTE FUNCTION public.set_status_change_event_record_number();

CREATE TRIGGER trg_sce_no_hard_delete
  BEFORE DELETE ON public.status_change_events
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

CREATE INDEX status_change_events_record_idx
  ON public.status_change_events (sce_object, sce_record_id, sce_created_at DESC)
  WHERE sce_is_deleted = false;

CREATE INDEX status_change_events_transition_idx
  ON public.status_change_events (sce_transition_id)
  WHERE sce_is_deleted = false;

ALTER TABLE public.status_change_events ENABLE ROW LEVEL SECURITY;

-- Read is open; INSERT happens only through change_record_status
-- (SECURITY DEFINER). No public INSERT/UPDATE/DELETE policies means
-- direct authenticated mutations are rejected — exactly what we want.
CREATE POLICY app_select_status_change_events ON public.status_change_events
  FOR SELECT USING (true);

-- =========================================================================
-- Replace change_record_status to (a) accept an optional note parameter
-- and (b) INSERT a status_change_events row after the status update.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.change_record_status(
  p_object        text,
  p_status_field  text,
  p_record_id     uuid,
  p_to_status_id  uuid,
  p_note          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        uuid;
  v_updated_by_col text;
  v_updated_at_col text;
  v_table_prefix   text;
  v_current_status uuid;
  v_transition_id  uuid;
  v_transition_label text;
  v_pv_object      text;
  v_pv_field       text;
  v_pv_value       text;
  v_sql            text;
  v_event_id       uuid;
BEGIN
  SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.app_user_can(p_object, 'update') THEN
    RAISE EXCEPTION 'User does not have update permission on %', p_object
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT picklist_object, picklist_field, picklist_value
    INTO v_pv_object, v_pv_field, v_pv_value
  FROM public.picklist_values WHERE id = p_to_status_id;
  IF v_pv_object IS NULL THEN
    RAISE EXCEPTION 'p_to_status_id does not reference an existing picklist value';
  END IF;
  IF v_pv_object <> p_object OR v_pv_field <> p_status_field THEN
    RAISE EXCEPTION 'p_to_status_id (% on %.%) does not match transition scope %.%',
      v_pv_value, v_pv_object, v_pv_field, p_object, p_status_field;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=p_object AND column_name=p_status_field
  ) THEN
    RAISE EXCEPTION 'Column %.% does not exist', p_object, p_status_field;
  END IF;

  v_table_prefix := regexp_replace(p_object, 's$', '');

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=p_object
               AND column_name = v_table_prefix || '_updated_by') THEN
    v_updated_by_col := v_table_prefix || '_updated_by';
    v_updated_at_col := v_table_prefix || '_updated_at';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=p_object
                  AND column_name = 'updated_by') THEN
    v_updated_by_col := 'updated_by';
    v_updated_at_col := 'updated_at';
  ELSE
    v_updated_by_col := NULL;
    v_updated_at_col := NULL;
  END IF;

  EXECUTE format('SELECT %I FROM public.%I WHERE id = $1', p_status_field, p_object)
    INTO v_current_status USING p_record_id;

  SELECT id, st_transition_label INTO v_transition_id, v_transition_label
  FROM public.status_transitions
  WHERE st_object         = p_object
    AND st_status_field   = p_status_field
    AND st_to_status_id   = p_to_status_id
    AND st_from_status_id IS NOT DISTINCT FROM v_current_status
    AND st_is_active      = true
    AND st_is_deleted     = false
  LIMIT 1;

  IF v_transition_id IS NULL THEN
    RAISE EXCEPTION 'No active transition exists for %.% from % to %',
      p_object, p_status_field,
      COALESCE(v_current_status::text, '(initial creation)'),
      p_to_status_id::text
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_updated_by_col IS NOT NULL THEN
    v_sql := format(
      'UPDATE public.%I SET %I = $1, %I = $2, %I = now() WHERE id = $3',
      p_object, p_status_field, v_updated_by_col, v_updated_at_col
    );
    EXECUTE v_sql USING p_to_status_id, v_user_id, p_record_id;
  ELSE
    v_sql := format('UPDATE public.%I SET %I = $1 WHERE id = $2', p_object, p_status_field);
    EXECUTE v_sql USING p_to_status_id, p_record_id;
  END IF;

  INSERT INTO public.status_change_events (
    sce_record_number, sce_object, sce_record_id, sce_transition_id,
    sce_from_status_id, sce_to_status_id, sce_note, sce_created_by
  ) VALUES (
    '', p_object, p_record_id, v_transition_id,
    v_current_status, p_to_status_id,
    NULLIF(btrim(p_note), ''),
    v_user_id
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'ok',                true,
    'transition_id',     v_transition_id,
    'transition_label',  v_transition_label,
    'from_status_id',    v_current_status,
    'to_status_id',      p_to_status_id,
    'event_id',          v_event_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_record_status(text, text, uuid, uuid, text) TO authenticated;

-- The old 4-arg signature would shadow the new 5-arg one for PostgREST's
-- function-resolution rules. Drop it so the new signature is canonical.
DROP FUNCTION IF EXISTS public.change_record_status(text, text, uuid, uuid);
