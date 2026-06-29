-- =============================================================================
-- Opportunities — optional unit-level linkage
--
-- Multi-family IRA programs track an opportunity per UNIT per program
-- (HOMES / HEAR), not just per building. opportunities already carry
-- property_id and building_id; this adds an optional unit_id so an
-- opportunity can be pinned to a specific unit. Nullable Lookup (not a
-- required Master-Detail) — single-family / building-level opportunities
-- simply leave it null. Additive; nothing existing changes.
-- =============================================================================

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.units(id);

CREATE INDEX IF NOT EXISTS idx_opportunities_unit_id
  ON public.opportunities (unit_id)
  WHERE unit_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
