-- Report Builder open items: Top-N row limit + summary group HAVING filter.
--
-- rpt_row_limit  — cap the number of detail rows a report returns (Salesforce
--                  "Row Limit" / Top-N). NULL = no cap (existing behavior).
-- rgr_group_filter_op / rgr_group_filter_value — per row-grouping HAVING filter:
--                  hide groups whose measure fails the comparison (e.g. keep
--                  only groups with COUNT >= 5). Op compares the report's
--                  measure (count/sum/avg/min/max) for each group against the
--                  value. NULL op = no group filter.
--
-- All additive and nullable — no existing report changes behavior.

alter table public.reports
  add column if not exists rpt_row_limit integer;

alter table public.report_groupings
  add column if not exists rgr_group_filter_op text,
  add column if not exists rgr_group_filter_value numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'report_groupings_rgr_group_filter_op_check'
  ) then
    alter table public.report_groupings
      add constraint report_groupings_rgr_group_filter_op_check
      check (rgr_group_filter_op is null
             or rgr_group_filter_op in ('gt','gte','lt','lte','eq','ne'));
  end if;
end $$;

comment on column public.reports.rpt_row_limit is
  'Top-N row cap for the report; NULL means no limit.';
comment on column public.report_groupings.rgr_group_filter_op is
  'HAVING comparison op for this grouping (gt/gte/lt/lte/eq/ne) against the group measure; NULL = no group filter.';
comment on column public.report_groupings.rgr_group_filter_value is
  'HAVING threshold value compared to the group measure.';
