-- A calculated field can carry a grand total.
--
-- Selected fields have had a Total control since the report builder shipped
-- (rpt_selected_fields[].summarize), and the viewer's footer honours it. A
-- CALCULATED field could not: report_calculated_fields had nowhere to store the
-- choice, so a Margin or Cost per Unit column — exactly the kind of column
-- someone wants a bottom line for — was the one column that could never have
-- one.
--
-- The viewer needed no new arithmetic: resolveDisplay() already evaluates a
-- calc column's expression per row and returns a number, so the existing
-- summarizer works on it the moment the column carries a mode. This is the
-- storage that was missing.

alter table public.report_calculated_fields
  add column if not exists rcf_summarize text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_calculated_fields_summarize_check') then
    alter table public.report_calculated_fields
      add constraint report_calculated_fields_summarize_check
      check (rcf_summarize is null or rcf_summarize in ('sum','avg','min','max','count'));
  end if;
end $$;

comment on column public.report_calculated_fields.rcf_summarize is
  'Grand-total mode for this calculated column: sum | avg | min | max | count. NULL means no total, which is what every calculated field had before this column existed.';
