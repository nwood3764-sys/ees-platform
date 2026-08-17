-- The opportunity -> project name cascade was inert.
--
-- trg_project_name was declared column-scoped:
--
--   BEFORE INSERT OR UPDATE OF opportunity_id, project_record_type
--
-- so it only fired when a project was re-pointed at a different opportunity or
-- given a different record type. cascade_derived_name() (migration
-- 20260817160500) propagates a rename by performing a NO-OP write on each live
-- child, which changes neither of those columns — so the child trigger never
-- fired and projects never recomposed. Everything below a project inherits from
-- the project name, so work orders were stranded too.
--
-- Found by the property backfill: PROP-23587 became "1837 Alden Road -
-- Janesville" and its building and opportunity followed, but PROJ-00025 stayed
-- "1837 Alden Rd - Janesville - 1 - ..." and its work orders with it.
--
-- Every other derive-name trigger in the platform is plain BEFORE INSERT OR
-- UPDATE. This one now matches, which is what makes the cascade reach projects.
-- derive_project_name() itself is unchanged.
DROP TRIGGER IF EXISTS trg_project_name ON public.projects;
CREATE TRIGGER trg_project_name
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.derive_project_name();

-- Recompose projects, which cascades on to their work orders.
--
-- PROJ-00038 is deliberately excluded. It carries three "Building Access" work
-- orders (WO-00131/132/135, 5 completed steps each) whose record type is not in
-- the record_type_eligibility matrix for an "MF-Exhaust Fan Replacement" project,
-- so enforce_work_order_record_type_eligibility() rejects ANY write to them —
-- including a no-op cascade write. That is pre-existing data/config to resolve
-- deliberately (either Building Access becomes eligible on this project record
-- type, or those work orders belong on a different project); loosening the
-- validation rule to get a rename through would be the wrong fix.
UPDATE public.projects
   SET project_name = project_name
 WHERE project_is_deleted IS NOT TRUE
   AND project_record_number <> 'PROJ-00038';

NOTIFY pgrst, 'reload schema';
