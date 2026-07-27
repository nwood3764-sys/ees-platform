-- SUPERSEDED — intentional no-op. (Kept as a placeholder; already applied to
-- production before being superseded.)
--
-- This migration originally re-ran the property "Systems Information" widget
-- rewrite because the first pass (20260727002412) targeted widgets by hardcoded
-- id and missed the recreated Multifamily widget. 20260727002412 has since been
-- corrected to resolve the target widgets DYNAMICALLY (layout object + name +
-- section label), so it now rewrites both widgets on its own.
--
-- It must stay a no-op on replay: a concurrent migration (20260727005116, the
-- page-layout FK-validation fix) has a timestamp between 20260727002412 and
-- this one and replaces validate_page_layout_widget_config() WITHOUT the
-- child_lookup branch. Writing child_lookup widget config here would fail that
-- intermediate validator. The authoritative merged validator (pg_catalog FK
-- logic + child_lookup) and a final idempotent re-assert of both widgets live
-- in 20260727014522, which runs after every 2026-07-27 migration.

select 1;
