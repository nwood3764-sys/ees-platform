-- The LEAP Canvas dashboard builder saves dash_columns = 12 (12-column free
-- grid), but the baseline check constraint capped dash_columns at 4 (the old
-- form-driven editor's column model), so canvas dashboards failed to save with
-- "violates check constraint dashboards_dash_columns_check". Widen to 1..12.
ALTER TABLE public.dashboards DROP CONSTRAINT dashboards_dash_columns_check;
ALTER TABLE public.dashboards ADD CONSTRAINT dashboards_dash_columns_check CHECK (dash_columns >= 1 AND dash_columns <= 12);
