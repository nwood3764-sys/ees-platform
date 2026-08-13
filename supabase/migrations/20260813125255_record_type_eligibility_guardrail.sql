-- Record-type eligibility guardrail — Phase 1 of docs/leap-assistant-reliability.md
--
-- Makes invalid parent->child record-type combinations impossible at the DATABASE
-- layer, so the assistant, the manual UI, and imports are all bound identically —
-- the guarantee lives here, not in model intelligence.
--
-- Semantics mirror picklist_value_record_type_assignments (PVRTA): a
-- (parent_object, parent_record_type, child_object) triple with NO active edges is
-- UNCONSTRAINED; once any edge exists, the child's record type MUST match one of
-- them. So this starts fully permissive and only constrains what you seed.
--
-- Enforced with a BEFORE INSERT/UPDATE trigger (additive; does not touch the
-- commit_screen_flow_run write path) — a rejection RAISEs a descriptive error that
-- rides the assistant's existing error -> [system: ...] -> self-correct loop.

CREATE TABLE IF NOT EXISTS public.record_type_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rte_record_number text NOT NULL DEFAULT '',
  rte_parent_object text NOT NULL,
  rte_parent_record_type_id uuid NOT NULL REFERENCES public.picklist_values(id),
  rte_child_object text NOT NULL,
  rte_child_record_type_id uuid NOT NULL REFERENCES public.picklist_values(id),
  rte_is_active boolean NOT NULL DEFAULT true,
  rte_is_deleted boolean NOT NULL DEFAULT false,
  rte_created_at timestamptz NOT NULL DEFAULT now(),
  rte_created_by uuid,
  rte_updated_at timestamptz NOT NULL DEFAULT now(),
  rte_updated_by uuid,
  is_seed_data boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rte_lookup
  ON public.record_type_eligibility (rte_parent_object, rte_parent_record_type_id, rte_child_object)
  WHERE rte_is_active AND NOT rte_is_deleted;

CREATE UNIQUE INDEX IF NOT EXISTS rte_unique_active_edge
  ON public.record_type_eligibility (rte_parent_object, rte_parent_record_type_id, rte_child_object, rte_child_record_type_id)
  WHERE NOT rte_is_deleted;

ALTER TABLE public.record_type_eligibility ENABLE ROW LEVEL SECURITY;

-- Config table: any signed-in app user may read (needed for the future Admin UI);
-- only admins may write.
DROP POLICY IF EXISTS rte_read ON public.record_type_eligibility;
CREATE POLICY rte_read ON public.record_type_eligibility
  FOR SELECT USING (public.current_app_user_id() IS NOT NULL);

DROP POLICY IF EXISTS rte_write ON public.record_type_eligibility;
CREATE POLICY rte_write ON public.record_type_eligibility
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Resolver: is p_child_record_type eligible under p_parent_record_type?
-- No active edges for the triple => unconstrained (returns true). SECURITY DEFINER
-- so enforcement reads config regardless of the caller's RLS.
CREATE OR REPLACE FUNCTION public.record_type_eligible(
  p_parent_object text, p_parent_record_type uuid,
  p_child_object  text, p_child_record_type  uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_parent_record_type IS NULL OR p_child_record_type IS NULL THEN true
    WHEN NOT EXISTS (
      SELECT 1 FROM public.record_type_eligibility e
      WHERE e.rte_parent_object = p_parent_object
        AND e.rte_parent_record_type_id = p_parent_record_type
        AND e.rte_child_object = p_child_object
        AND e.rte_is_active AND NOT e.rte_is_deleted
    ) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.record_type_eligibility e
      WHERE e.rte_parent_object = p_parent_object
        AND e.rte_parent_record_type_id = p_parent_record_type
        AND e.rte_child_object = p_child_object
        AND e.rte_child_record_type_id = p_child_record_type
        AND e.rte_is_active AND NOT e.rte_is_deleted
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.record_type_eligible(text,uuid,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_type_eligible(text,uuid,text,uuid) TO authenticated, service_role;

-- Enforcement: a work order's record type must be eligible under its project's
-- record type. Only fires when both project + record type are set; unconstrained
-- projects (no seeded edges) always pass, so existing writes are unaffected.
CREATE OR REPLACE FUNCTION public.enforce_work_order_record_type_eligibility()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent_rt   uuid;
  v_parent_label text;
  v_child_label  text;
  v_allowed      text;
BEGIN
  IF NEW.project_id IS NULL OR NEW.work_order_record_type IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT project_record_type INTO v_parent_rt FROM public.projects WHERE id = NEW.project_id;
  IF v_parent_rt IS NULL THEN RETURN NEW; END IF;
  IF public.record_type_eligible('projects', v_parent_rt, 'work_orders', NEW.work_order_record_type) THEN
    RETURN NEW;
  END IF;
  SELECT picklist_label INTO v_parent_label FROM public.picklist_values WHERE id = v_parent_rt;
  SELECT picklist_label INTO v_child_label  FROM public.picklist_values WHERE id = NEW.work_order_record_type;
  SELECT string_agg(pv.picklist_label, ', ' ORDER BY pv.picklist_label)
    INTO v_allowed
    FROM public.record_type_eligibility e
    JOIN public.picklist_values pv ON pv.id = e.rte_child_record_type_id
   WHERE e.rte_parent_object = 'projects' AND e.rte_parent_record_type_id = v_parent_rt
     AND e.rte_child_object = 'work_orders' AND e.rte_is_active AND NOT e.rte_is_deleted;
  RAISE EXCEPTION
    'Work order record type "%" is not allowed on a "%" project. Allowed here: %.',
    COALESCE(v_child_label,'(unknown)'), COALESCE(v_parent_label,'(unknown)'),
    COALESCE(v_allowed,'(none configured)');
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_work_order_record_type_eligibility() FROM public, anon;

DROP TRIGGER IF EXISTS trg_wo_record_type_eligibility ON public.work_orders;
CREATE TRIGGER trg_wo_record_type_eligibility
  BEFORE INSERT OR UPDATE OF work_order_record_type, project_id ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_work_order_record_type_eligibility();

-- Seed the first rule: under an MF-Exhaust Fan Replacement project, only exhaust-fan
-- work order record types are allowed. Any other (e.g. air sealing / Advanced
-- Infiltration Reduction) is now rejected.
INSERT INTO public.record_type_eligibility
  (rte_record_number, rte_parent_object, rte_parent_record_type_id, rte_child_object, rte_child_record_type_id, is_seed_data)
VALUES
  ('', 'projects','51a9d875-5788-41c9-a07b-e5336eece94b','work_orders','9a3d6162-5723-4dc5-9c54-78d3e84dcd11', true), -- Exhaust Fan Replacement
  ('', 'projects','51a9d875-5788-41c9-a07b-e5336eece94b','work_orders','b5eb6c49-35e2-4684-a0aa-698c5d9f3cef', true), -- Exhaust Fan vent kit
  ('', 'projects','51a9d875-5788-41c9-a07b-e5336eece94b','work_orders','c372d40f-1ce4-49ac-a66c-60c2794d800c', true)  -- Exhaust Fan CFM Test
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
