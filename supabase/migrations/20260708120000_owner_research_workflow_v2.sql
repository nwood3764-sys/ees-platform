-- =====================================================================
-- Owner Research → Outreach Workflow — v2
--
-- Phase 1+2 schema for the staged research pipeline and review queue
-- (see docs/leap-owner-research-workflow.md):
--
--   * owner_research_requests gains stage-machine columns — each request
--     now walks Owner Identification → Organization Research →
--     Decision Maker Discovery → Contact Info Gathering, one edge-fn
--     invocation per stage (fresh time budget), with every stage's
--     output persisted as a stored fact in orq_stage_results.
--   * Org-approval columns — an identified owner organization is staging
--     data until a reviewer approves it; approval matches/creates the
--     Account and records it on the request.
--   * owner_research_candidates gains orc_rejected_reason for explicit,
--     auditable rejection from the review queue.
--   * Picklist seeds — new request statuses (In Progress / Ready for
--     Review), stage names, org-approval statuses, and candidate
--     Approved/Rejected statuses. All admin-manageable; nothing
--     hardcoded in app logic.
-- =====================================================================

-- --- owner_research_requests: stage machine + org approval ---------------
ALTER TABLE public.owner_research_requests
  ADD COLUMN IF NOT EXISTS orq_stage text,
  ADD COLUMN IF NOT EXISTS orq_stage_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS orq_stage_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS orq_org_approval_status text,
  ADD COLUMN IF NOT EXISTS orq_approved_account_id uuid REFERENCES public.accounts(id);

CREATE INDEX IF NOT EXISTS idx_orq_org_approval_status
  ON public.owner_research_requests (orq_org_approval_status)
  WHERE orq_org_approval_status IS NOT NULL;

-- --- owner_research_candidates: explicit rejection ------------------------
ALTER TABLE public.owner_research_candidates
  ADD COLUMN IF NOT EXISTS orc_rejected_reason text;

-- --- Picklist seeds --------------------------------------------------------
INSERT INTO public.picklist_values (id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
SELECT gen_random_uuid(), v.obj, v.fld, v.val, v.val, true, v.ord
FROM (VALUES
  -- Request statuses: Submitted (10) → In Progress (12) → Ready for
  -- Review (14) → Completed (20) / No Results (30) / Failed (40)
  ('owner_research_requests','orq_status','Research Request In Progress',        12),
  ('owner_research_requests','orq_status','Research Request Ready for Review',   14),
  -- Research stages (state machine order)
  ('owner_research_requests','orq_stage','Owner Identification',      10),
  ('owner_research_requests','orq_stage','Organization Research',     20),
  ('owner_research_requests','orq_stage','Decision Maker Discovery',  30),
  ('owner_research_requests','orq_stage','Contact Info Gathering',    40),
  -- Identified-organization approval lifecycle
  ('owner_research_requests','orq_org_approval_status','Organization Approval Pending', 10),
  ('owner_research_requests','orq_org_approval_status','Organization Approved',         20),
  ('owner_research_requests','orq_org_approval_status','Organization Rejected',         30),
  -- Candidate review outcomes (queue): Found (10) → Approved (25) sits
  -- beside Enriched (20) / Promoted to Contact (30); Rejected (50) after
  -- Dismissed (40)
  ('owner_research_candidates','orc_status','Research Candidate Approved', 25),
  ('owner_research_candidates','orc_status','Research Candidate Rejected', 50)
) AS v(obj, fld, val, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object = v.obj AND p.picklist_field = v.fld AND p.picklist_value = v.val
);

NOTIFY pgrst, 'reload schema';
