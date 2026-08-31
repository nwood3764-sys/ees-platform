-- One dashboard filter, the right column on every object.
--
-- Nicholas, 2026-08-31: "all dashboards need the filter... The user needs to be
-- able to put any kind of filter they want on, not just the state filter."
--
-- A dashboard filter carried ONE column name and handed it to every widget.
-- A widget whose report sits on another object simply does not have that
-- column, and the runner's rule for a filter it cannot apply is to skip it.
-- So on a dashboard mixing properties, opportunities and enrollments, setting
-- State to NC filtered the property widgets and left the rest showing every
-- state, with nothing on screen to say so — numbers quietly answering
-- different questions, side by side.
--
-- Salesforce solves this by letting one filter name its equivalent field per
-- object. dfilt_field_map is that: { "<table>": "<column>" }, with
-- dfilt_field_name as the fallback for any object it does not name.
--
-- NULL on every filter written before this, and NULL is correct there: the
-- filter then reaches exactly the objects that spell its column the same way,
-- which is what it already did.

alter table public.dashboard_filters
  add column if not exists dfilt_field_map jsonb;

comment on column public.dashboard_filters.dfilt_field_map is
  'Per-object column equivalents for this filter: {"<table>": "<column>"}. An object not named here falls back to dfilt_field_name; an object where neither resolves to a real column is not filtered (and the editor says so).';
