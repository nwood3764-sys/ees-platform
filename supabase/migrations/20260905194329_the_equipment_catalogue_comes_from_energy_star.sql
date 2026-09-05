-- The equipment catalogue comes from ENERGY STAR.
--
-- Nicholas, 2026-09-05: "We need ducted and ductless systems. That's it. I don't
-- need any crazy shit. In furnaces." And, on the sizing check: "after we make a
-- selection, we're going to run it through [the cold-climate list] and get the
-- results ... to make sure that it's providing proper heating and cooling."
--
-- ── Why this table was empty and what fills it ────────────────────────────
--
-- public.products has carried the whole equipment column set since the baseline
-- -- manufacturer, model number, series, ducting configuration, capacity at
-- 47/17/5 degrees, efficiency at 5 degrees, the seasonal ratings, the
-- certificate number and links. Not one product row carried a single one of
-- those values. The shape was right and there was no data in it.
--
-- The data comes from the EPA's own published list of certified equipment
-- (data.energystar.gov, dataset w7cv-9xjt for heat pumps and i97v-e8au for
-- furnaces). It is free, documented, licensed for reuse, and refreshed daily.
-- Verified live on 2026-09-05 before this was written: it publishes heating
-- output at 47, 17 AND 5 degrees plus efficiency at 5 degrees, which is the
-- whole cold-weather sizing question and the one thing that could have forced a
-- paid subscription somewhere else.
--
-- The public cold-climate list every contractor knows is fed from the SAME
-- manufacturer filings (that changed in April 2025), so checking a chosen unit
-- against these numbers is the same check as looking it up on that website --
-- done inside LEAP, against numbers we hold, with the public page linked for
-- anyone who wants to see it for themselves.
--
-- ── One row per MACHINE, not one row per certificate ──────────────────────
--
-- The published list has 281,975 rows and that is NOT 281,975 machines. A
-- certificate covers one outdoor unit paired with one indoor coil, so a ducted
-- outdoor unit is listed once for every coil it is certified against. Measured
-- live:
--
--   Ducted heat pumps      263,483 rows  ->   2,608 outdoor units
--   Ductless heat pumps     17,639 rows  ->   5,727 outdoor units
--   Packaged (also ducted)     853 rows  ->     384 outdoor units
--   Furnaces                 3,220 rows  ->   1,573 models
--
-- About 10,000 machines. Small. So the catalogue is NOT limited by
-- manufacturer: every certified ducted and ductless heat pump and every
-- certified furnace comes in, and the short list an auditor sees is produced by
-- filtering at selection time, not by leaving equipment out of the database.
--
-- Which certificate represents a machine is a real decision and is written down
-- rather than implied: the pairing with the HIGHEST heating output at 5
-- degrees, because sizing asks whether the unit can carry the heating load when
-- it is coldest. The certificate number it came from is stored on the product,
-- so the pairing is named and can be checked, never assumed.
--
-- Not in scope, by instruction: packaged terminal units (the through-the-wall
-- kind), water heaters, appliances.

BEGIN;

-- ── 1. The words an equipment record is described in ──────────────────────
--
-- These four columns have existed as lookups since the baseline and NOT ONE of
-- them had a single value to choose from, so nothing could ever be recorded in
-- them. Seeded from the published list's own vocabulary, so an imported value
-- never needs translating -- except the ducting configuration, which is
-- deliberately Nicholas's two words rather than the three the source uses.

INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_by)
SELECT v.obj, v.fld, v.val, v.lbl, true, v.ord,
       (SELECT id FROM public.users WHERE user_email = 'nicholas.wood@ees-wi.org' LIMIT 1)
FROM (VALUES
  -- How the equipment moves air. Two words, because those are the two kinds
  -- EES installs; the source's three product types map onto them below.
  ('products','product_ducting_configuration','Ducted','Ducted',1),
  ('products','product_ducting_configuration','Ductless','Ductless',2),

  -- What kind of machine it is.
  ('products','product_equipment_category','Heat Pump','Heat Pump',1),
  ('products','product_equipment_category','Furnace','Furnace',2),

  -- How the compressor runs. A machine that can run at part load holds a
  -- steadier temperature and is sized differently, so this is a sizing input
  -- and not a nicety.
  ('products','product_variable_capacity','Continuously Variable','Continuously Variable',1),
  ('products','product_variable_capacity','Two-Stage','Two-Stage',2),
  ('products','product_variable_capacity','Single Stage','Single Stage',3),

  -- The refrigerant. Stored on its own rather than inside the source's single
  -- combined string, which reads "R-454B (GWP:470 | Lower GWP)".
  ('products','product_refrigerant_type','R-454B','R-454B',1),
  ('products','product_refrigerant_type','R-410A','R-410A',2),
  ('products','product_refrigerant_type','R-32','R-32',3)
) AS v(obj, fld, val, lbl, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
   WHERE p.picklist_object = v.obj
     AND p.picklist_field  = v.fld
     AND p.picklist_value  = v.val
);

-- ── 2. Where the published rows land before anything is believed ──────────
--
-- Same shape the HUD property import already uses: land the source's own rows
-- untouched, then match and promote in a second, checkable step. The raw
-- payload is kept because it is the evidence that a value in LEAP came from
-- somewhere, and because the source adds columns without warning.

CREATE TABLE IF NOT EXISTS public.energy_star_equipment_import_rows (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  esr_dataset         text        NOT NULL,   -- 'heat_pumps' | 'furnaces'
  esr_source_id       text        NOT NULL,   -- the source's own row id
  esr_certificate_number text,
  esr_brand           text,
  esr_model_number    text,
  esr_payload         jsonb       NOT NULL,
  esr_fetched_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS energy_star_equipment_import_rows_source_key
  ON public.energy_star_equipment_import_rows (esr_dataset, esr_source_id);
CREATE INDEX IF NOT EXISTS energy_star_equipment_import_rows_model
  ON public.energy_star_equipment_import_rows (esr_dataset, esr_brand, esr_model_number);

ALTER TABLE public.energy_star_equipment_import_rows ENABLE ROW LEVEL SECURITY;

-- Nobody reads this through the app. It is import scratch, and the equipment a
-- person actually sees is on products.
CREATE POLICY energy_star_import_rows_admin_only
  ON public.energy_star_equipment_import_rows
  FOR ALL TO authenticated
  USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

COMMIT;
