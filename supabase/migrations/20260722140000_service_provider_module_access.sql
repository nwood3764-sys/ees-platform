-- ============================================================================
-- Service Provider Portal + Intake — Phase 4b: module access
-- ----------------------------------------------------------------------------
-- Grants the new 'providers' nav module (Service Provider Applications review
-- queue) to the manager roles who review subcontractor signups. Admins already
-- see every module via the '*' sentinel in my_accessible_modules().
-- ============================================================================

INSERT INTO public.role_module_access (id, rma_role_id, rma_module_id, rma_can_access, created_at, is_deleted)
SELECT gen_random_uuid(), r.id, 'providers', true, now(), false
FROM public.roles r
WHERE r.role_name IN ('Program Manager', 'Project Manager', 'Project Coordinator', 'Director of Field Services')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_module_access x
    WHERE x.rma_role_id = r.id AND x.rma_module_id = 'providers' AND x.is_deleted = false
  );
