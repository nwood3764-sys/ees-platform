-- Relax NOT NULL on work_orders.building_id and work_orders.unit_id. Many
-- legitimate work orders happen at the property level (e.g. ASHRAE Level 1
-- assessment of the whole property) or at the project level with no
-- specific building yet (shop-kit equipment WO). The original schema
-- required these via NOT NULL, which the seed data happened to satisfy by
-- populating them for every test row — but that doesn't match how the
-- platform is actually used.
--
-- project_id, opportunity_id, property_id stay NOT NULL: every WO has a
-- parent project (which has an opportunity) and a physical location
-- (property), even if no specific building/unit is named.

ALTER TABLE public.work_orders ALTER COLUMN building_id DROP NOT NULL;
ALTER TABLE public.work_orders ALTER COLUMN unit_id     DROP NOT NULL;
