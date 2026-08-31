-- Help article for dashboard filters, plus a correction to HA-00113, which
-- described the old free-text field box and the rule that produced the defect
-- ("applies to every widget whose report has that field" — true, and silently
-- so).

insert into public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_category, ha_audience,
  ha_is_published, ha_body_markdown
) values (
  '', 'dashboard-filters',
  'Dashboard filters — one control across objects that name the field differently',
  'Add a filter above a dashboard, pick the field once, and let each widget use the matching field on its own object.',
  'Reports & Dashboards', 'internal', true,
$md$
# Dashboard filters

A dashboard filter sits in a bar above the widgets. Set it, click **Apply**, and
every widget re-runs scoped to your choice.

## Adding one

1. Open the dashboard and click **Edit**.
2. Click an empty part of the canvas so no widget is selected — the inspector
   shows the dashboard's own settings.
3. Under **Filters**, click **+ Add**.
4. Give it a **label** (this is what the reader sees — "State", "Status",
   "Program") and pick a **field**.

The field list is grouped by the objects this dashboard's widgets actually
report on, so you are choosing a real field, not typing a column name.

## One filter, several objects

A dashboard usually mixes objects. The Outreach dashboard has four widgets on
Properties and one on Opportunities. Those two objects hold the same fact — the
state — under different names: `property_state` and `opportunity_state`.

When you pick a field, LEAP proposes the matching field on every other object on
the dashboard and tells you what it found:

> Applies to **Properties, Opportunities**. Not applied to **Work Orders** —
> those widgets show every record.

Click **Set fields per object** to change any of them by hand, or set one to
**— Not filtered —** if the filter genuinely should not narrow that object.

## When a widget cannot be filtered

Some objects have no equivalent field. Work orders have no state column;
enrollments have no state column either. A widget like that shows a small note
on its own face:

> Not filtered by State

That is deliberate. The widget is showing every record, and it says so rather
than sitting beside a filtered neighbour looking identical.

## Choosing from real values

Tick **Choose from values in the data** and the reader gets a dropdown built
from what is actually in the records — resolved to names, so a Status or Record
Type filter lists "WI-IRA-MF-HOMES", not an ID. Leave it unticked for a free-text
box (useful for a number or a date, where a list of every value is no help).

Leave **Default** empty unless you genuinely want the dashboard to open already
narrowed. A default hides records from a reader who never chose it.

## Which dashboards have one

Every dashboard carries at least one filter:

| Dashboard | Filter | Reaches |
|---|---|---|
| Outreach Dashboard | State | Properties and Opportunities |
| Program Operations Overview | State | Properties and Opportunities |
| Qualification Overview | Status | Assessments |
| Enrollment Overview | Status | Enrollments |

Add more the same way — a filter can be on any field the dashboard's reports
carry, not only state.

## Related

- **Building Dashboards with the LEAP Canvas** — the widget builder itself.
- **Dashboards — assembling reports into grid widgets** — folders and sharing.
$md$
);

update public.help_articles
   set ha_body_markdown = replace(
         ha_body_markdown,
         'Click an empty area so nothing is selected — the inspector shows page settings: **Description**, **Folder**, and **Filters** (drag to reorder). A filter applies to every widget whose report has that field.',
         'Click an empty area so nothing is selected — the inspector shows page settings: **Description**, **Folder**, and **Filters** (drag to reorder). Pick a filter''s field from the grouped list of fields the dashboard''s reports carry; LEAP maps it to the matching field on each other object and states which widgets it reaches. See **Dashboard filters** for the full behaviour.'
       ),
       ha_updated_at = now()
 where ha_record_number = 'HA-00113'
   and ha_is_deleted = false;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.help_articles
   where ha_slug = 'dashboard-filters' and ha_is_deleted = false;
  if v_n <> 1 then raise exception 'Expected 1 dashboard-filters article, found %', v_n; end if;
  select count(*) into v_n from public.help_articles
   where ha_record_number = 'HA-00113' and ha_body_markdown like '%See **Dashboard filters**%';
  if v_n <> 1 then raise exception 'HA-00113 was not corrected'; end if;
end $$;
