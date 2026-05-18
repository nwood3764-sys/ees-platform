-- =========================================================================
-- status_transitions: per-(object, status_field) directed graph of allowed
-- status transitions. Backs the Lifecycle Builder admin pane. A NULL
-- st_from_status_id encodes the initial-creation transition into the
-- lifecycle. Both endpoints must reference picklist_values rows whose
-- (picklist_object, picklist_field) match the row's (st_object,
-- st_status_field) — enforced by a trigger.
-- =========================================================================

CREATE SEQUENCE IF NOT EXISTS public.seq_status_transitions;

CREATE TABLE public.status_transitions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  st_record_number            text NOT NULL,
  st_object                   text NOT NULL,
  st_status_field             text NOT NULL,
  st_from_status_id           uuid     REFERENCES public.picklist_values(id),
  st_to_status_id             uuid NOT NULL REFERENCES public.picklist_values(id),
  st_transition_label         text NOT NULL,
  st_description              text,
  st_sort_order               integer NOT NULL DEFAULT 0,
  st_is_active                boolean NOT NULL DEFAULT true,
  st_owner                    uuid NOT NULL REFERENCES public.users(id),
  st_created_by               uuid NOT NULL REFERENCES public.users(id),
  st_created_at               timestamptz NOT NULL DEFAULT now(),
  st_updated_by               uuid     REFERENCES public.users(id),
  st_updated_at               timestamptz,
  st_is_deleted               boolean NOT NULL DEFAULT false,
  st_deleted_at               timestamptz,
  st_deleted_by               uuid     REFERENCES public.users(id),
  st_deletion_reason          text,
  CONSTRAINT st_no_self_loop CHECK (st_from_status_id IS DISTINCT FROM st_to_status_id)
);

COMMENT ON TABLE public.status_transitions IS 'Per-(object, status_field) directed graph of allowed status transitions. NULL st_from_status_id = initial creation transition.';

-- Auto-numbering: ST-#####
CREATE OR REPLACE FUNCTION public.set_status_transition_record_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.st_record_number := generate_record_number('ST-', 'seq_status_transitions');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_status_transition_rn
  BEFORE INSERT ON public.status_transitions
  FOR EACH ROW EXECUTE FUNCTION public.set_status_transition_record_number();

-- Integrity: both endpoints must reference picklist rows whose
-- (picklist_object, picklist_field) equal this row's (st_object,
-- st_status_field). Trigger runs BEFORE INSERT/UPDATE so violations
-- surface as a clean error instead of a corrupted row.
CREATE OR REPLACE FUNCTION public.validate_status_transition_endpoints()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_to_object   text;
  v_to_field    text;
  v_from_object text;
  v_from_field  text;
BEGIN
  SELECT picklist_object, picklist_field INTO v_to_object, v_to_field
  FROM public.picklist_values WHERE id = NEW.st_to_status_id;
  IF v_to_object IS NULL THEN
    RAISE EXCEPTION 'st_to_status_id does not reference an existing picklist value';
  END IF;
  IF v_to_object <> NEW.st_object OR v_to_field <> NEW.st_status_field THEN
    RAISE EXCEPTION 'st_to_status_id picklist is on (%, %) but transition is on (%, %)',
      v_to_object, v_to_field, NEW.st_object, NEW.st_status_field;
  END IF;
  IF NEW.st_from_status_id IS NOT NULL THEN
    SELECT picklist_object, picklist_field INTO v_from_object, v_from_field
    FROM public.picklist_values WHERE id = NEW.st_from_status_id;
    IF v_from_object IS NULL THEN
      RAISE EXCEPTION 'st_from_status_id does not reference an existing picklist value';
    END IF;
    IF v_from_object <> NEW.st_object OR v_from_field <> NEW.st_status_field THEN
      RAISE EXCEPTION 'st_from_status_id picklist is on (%, %) but transition is on (%, %)',
        v_from_object, v_from_field, NEW.st_object, NEW.st_status_field;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_status_transition_endpoint_check
  BEFORE INSERT OR UPDATE ON public.status_transitions
  FOR EACH ROW EXECUTE FUNCTION public.validate_status_transition_endpoints();

-- Block hard deletes platform-wide
CREATE TRIGGER trg_status_transition_no_hard_delete
  BEFORE DELETE ON public.status_transitions
  FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- One row per (object, status_field, from, to) when not deleted; supports
-- restoration without collision with active rows
CREATE UNIQUE INDEX status_transitions_unique_edge
  ON public.status_transitions (st_object, st_status_field, COALESCE(st_from_status_id, '00000000-0000-0000-0000-000000000000'::uuid), st_to_status_id)
  WHERE st_is_deleted = false;

CREATE INDEX status_transitions_object_field_idx
  ON public.status_transitions (st_object, st_status_field)
  WHERE st_is_deleted = false;

CREATE INDEX status_transitions_from_idx
  ON public.status_transitions (st_from_status_id)
  WHERE st_is_deleted = false;

CREATE INDEX status_transitions_to_idx
  ON public.status_transitions (st_to_status_id)
  WHERE st_is_deleted = false;

ALTER TABLE public.status_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_select_status_transitions ON public.status_transitions
  FOR SELECT USING (true);

CREATE POLICY app_insert_status_transitions ON public.status_transitions
  FOR INSERT WITH CHECK (app_user_can('status_transitions', 'create'));

CREATE POLICY app_update_status_transitions ON public.status_transitions
  FOR UPDATE USING (app_user_can('status_transitions', 'update'))
                WITH CHECK (app_user_can('status_transitions', 'update'));

CREATE POLICY app_delete_status_transitions ON public.status_transitions
  FOR DELETE USING (app_user_can('status_transitions', 'delete'));
