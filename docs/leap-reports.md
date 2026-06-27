# LEAP — Reports & Dashboards

Reports and dashboards are a core module — not an afterthought. Every role in LEAP has access to reports and dashboards relevant to their work, with field-level security enforced. Financial tier fields are only visible in reports to users who have the appropriate permission.

---

## Report Builder

Lives in LEAP Admin. End users build reports without writing SQL. Report Builder manages:

- Object selection — choose the primary object and related objects to include
- Field selection — drag fields from any related object into the report
- Filters — filter by any field, any operator, any value
- Grouping — group by any field for summary reports
- Sorting — sort by any field ascending or descending
- Format — tabular (rows), summary (grouped with subtotals), matrix (rows and columns)
- Cross-object reporting — one report can span opportunities, projects, work orders, incentive applications, payments, and any other related objects
- Saved reports — named, owned, organized into folders by module and role
- Report folders — organized by module and role, with sharing controls

**Report types:**
- Tabular — flat list of records with columns
- Summary — grouped records with subtotals and totals
- Matrix — rows and columns with aggregate values
- Joined — multiple report blocks in one report

---

## Dashboards

Built from saved reports. Configurable per role. Dashboard Builder manages:

- Widget types — bar chart, line chart, pie chart, donut chart, metric counter, funnel, table, gauge
- Each widget is powered by a saved report
- Dashboard layout — drag and drop widget arrangement
- Role-specific dashboards — each role has a default dashboard configured in LEAP Admin
- User-customizable — users can add, remove, and rearrange widgets within their permissions
- Refresh rate — configurable per dashboard

**Standard dashboards by role:**
- Admin — system-wide metrics across all modules
- Program Manager — incentive pipeline, application statuses by program, payment request aging
- Project Manager — opportunity pipeline, project status board, open work orders, overdue tasks
- Project Coordinator — daily work order status, verification queue, corrections needed, upcoming deadlines
- Director of Field Services — today's active teams, implementation status by project, vehicle activity

---

## Scheduled Reports

Any saved report can be scheduled for automatic delivery.

Scheduled report configuration:
- Report — any saved report
- Frequency — daily, weekly, monthly, or custom schedule
- Day and time — specific day of week or month, specific time
- Format — PDF or CSV attachment
- Recipients — named users, roles, or external email addresses
- Subject line and message — customizable per scheduled report
- Owner — person responsible for the scheduled report

**Standard scheduled reports:**
- Weekly project status report — every Monday morning to Program Managers
- Daily overdue tasks report — every morning to Project Coordinators
- Monthly incentive pipeline — first of every month to Admin
- Weekly work order verification queue — every Monday to Project Coordinators
- Monthly payment request aging — first of every month to Admin and Program Managers
- Weekly team productivity report — every Friday to Director of Field Services

---

## Report Rules

- Field-level security applies to all reports — financial tier fields only appear in reports for users with the appropriate permission tier
- Reports are owned by a named user
- Reports can be shared with specific users or roles
- Scheduled reports run automatically — no manual action required
- All reports are built on the LEAP database — no data leaves the system except via scheduled email delivery
- Cross-object reports follow the same row-level security as the rest of LEAP — users only see records they have access to
