-- ============================================================================
-- picklist_value_record_type_assignments_v1
--
-- Junction table that scopes picklist values to specific record types. Used
-- first by the StatusPathWidget on projects (36 active project_status values
-- across 17 record types creates a cramped, undifferentiated chevron strip),
-- but applies to any picklist field on any object with record types.
--
-- Universal-fallback rule: a picklist value with zero rows in this junction
-- is treated as "applies to all record types". This makes the migration
-- non-destructive — every existing project_status value continues to render
-- on every layout until someone explicitly scopes it. Admins author scopes
-- incrementally without breaking any workflow.
--
-- A picklist value with one or more rows in this junction renders ONLY on
-- record types it's explicitly assigned to.
--
-- Both columns FK to picklist_values.id because record_type values are also
-- stored as picklist_values rows (with picklist_field='record_type' on the
-- target object).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.picklist_value_record_type_assignments (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pvrta_record_number           text NOT NULL DEFAULT '',
  pvrta_picklist_value_id       uuid NOT NULL REFERENCES public.picklist_values(id) ON DELETE CASCADE,
  pvrta_record_type_id          uuid NOT NULL REFERENCES public.picklist_values(id) ON DELETE CASCADE,
  pvrta_owner                   uuid REFERENCES public.users(id),
  pvrta_created_by              uuid REFERENCES public.users(id),
  pvrta_created_at              timestamptz NOT NULL DEFAULT now(),
  pvrta_updated_by              uuid REFERENCES public.users(id),
  pvrta_updated_at              timestamptz NOT NULL DEFAULT now(),
  pvrta_is_deleted              boolean NOT NULL DEFAULT false,
  pvrta_deleted_at              timestamptz,
  pvrta_deleted_by              uuid REFERENCES public.users(id),
  pvrta_deletion_reason         text,
  is_seed_data                  boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS pvrta_unique_active_edge
  ON public.picklist_value_record_type_assignments (pvrta_picklist_value_id, pvrta_record_type_id)
  WHERE pvrta_is_deleted = false;

CREATE INDEX IF NOT EXISTS pvrta_picklist_value_id_idx
  ON public.picklist_value_record_type_assignments (pvrta_picklist_value_id)
  WHERE pvrta_is_deleted = false;

CREATE INDEX IF NOT EXISTS pvrta_record_type_id_idx
  ON public.picklist_value_record_type_assignments (pvrta_record_type_id)
  WHERE pvrta_is_deleted = false;

CREATE SEQUENCE IF NOT EXISTS public.seq_pvrta_record_number AS bigint START 1;

CREATE OR REPLACE FUNCTION public.generate_pvrta_record_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.pvrta_record_number IS NULL OR NEW.pvrta_record_number = '' THEN
    NEW.pvrta_record_number := 'PVRTA-' || LPAD(nextval('public.seq_pvrta_record_number')::text, 4, '0');
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_pvrta_record_number ON public.picklist_value_record_type_assignments;
CREATE TRIGGER trg_pvrta_record_number
  BEFORE INSERT ON public.picklist_value_record_type_assignments
  FOR EACH ROW EXECUTE FUNCTION public.generate_pvrta_record_number();

CREATE OR REPLACE FUNCTION public.touch_pvrta_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  NEW.pvrta_updated_at := now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_pvrta_touch_updated_at ON public.picklist_value_record_type_assignments;
CREATE TRIGGER trg_pvrta_touch_updated_at
  BEFORE UPDATE ON public.picklist_value_record_type_assignments
  FOR EACH ROW EXECUTE FUNCTION public.touch_pvrta_updated_at();

ALTER TABLE public.picklist_value_record_type_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pvrta_select_authenticated ON public.picklist_value_record_type_assignments;
CREATE POLICY pvrta_select_authenticated
  ON public.picklist_value_record_type_assignments
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS pvrta_insert_via_app_user_can ON public.picklist_value_record_type_assignments;
CREATE POLICY pvrta_insert_via_app_user_can
  ON public.picklist_value_record_type_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.app_user_can('picklist_value_record_type_assignments', 'create'));

DROP POLICY IF EXISTS pvrta_update_via_app_user_can ON public.picklist_value_record_type_assignments;
CREATE POLICY pvrta_update_via_app_user_can
  ON public.picklist_value_record_type_assignments
  FOR UPDATE
  TO authenticated
  USING (public.app_user_can('picklist_value_record_type_assignments', 'edit'))
  WITH CHECK (public.app_user_can('picklist_value_record_type_assignments', 'edit'));

DROP POLICY IF EXISTS pvrta_delete_via_app_user_can ON public.picklist_value_record_type_assignments;
CREATE POLICY pvrta_delete_via_app_user_can
  ON public.picklist_value_record_type_assignments
  FOR DELETE
  TO authenticated
  USING (public.app_user_can('picklist_value_record_type_assignments', 'delete'));

INSERT INTO public.role_object_access (
  roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete
)
SELECT r.id, 'picklist_value_record_type_assignments', true, true, true, true
FROM public.roles r
WHERE r.role_name = 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_object_access x
    WHERE x.roa_role_id = r.id AND x.roa_object_name = 'picklist_value_record_type_assignments'
  );

-- Resolver: picklist values for an (object, field, record_type) triple,
-- applying the universal-fallback rule. Returns picklist rows sorted by
-- picklist_sort_order with a scope_mode flag for diagnostic display.
CREATE OR REPLACE FUNCTION public.picklist_values_for_record_type(
  p_object       text,
  p_field        text,
  p_record_type  uuid
)
RETURNS TABLE (
  id                  uuid,
  picklist_value      text,
  picklist_label      text,
  picklist_sort_order integer,
  scope_mode          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    pv.id,
    pv.picklist_value,
    pv.picklist_label,
    pv.picklist_sort_order,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.picklist_value_record_type_assignments a
       WHERE a.pvrta_picklist_value_id = pv.id
         AND a.pvrta_is_deleted = false
    ) THEN 'scoped' ELSE 'universal' END AS scope_mode
  FROM public.picklist_values pv
  WHERE pv.picklist_object = p_object
    AND pv.picklist_field  = p_field
    AND pv.picklist_is_active = true
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.picklist_value_record_type_assignments a
         WHERE a.pvrta_picklist_value_id = pv.id
           AND a.pvrta_is_deleted = false
      )
      OR (
        p_record_type IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.picklist_value_record_type_assignments a
           WHERE a.pvrta_picklist_value_id = pv.id
             AND a.pvrta_record_type_id    = p_record_type
             AND a.pvrta_is_deleted = false
        )
      )
    )
  ORDER BY pv.picklist_sort_order NULLS LAST, pv.picklist_value;
$function$;

GRANT EXECUTE ON FUNCTION public.picklist_values_for_record_type(text, text, uuid) TO authenticated;
