# Reports & Dashboards — enterprise parity queue

Raised by Nicholas on 2026-08-31: *"Some of the functionality on dashboards and
reports might need to be audited and made enterprise functionality and custom
ability."* This is the working queue for that, in the order he gave it. Items
are struck through as they ship, with the PR that did it.

## 1. Children and cousins in the field picker — FIRST

- [x] **Child roll-ups** — a child object as an aggregate on the parent's row
      (Units, Sum of Square Feet, Latest Assessment Date). `report_child_rollup`
      RPC, SECURITY INVOKER. **PR #670.**
- [ ] **Child rows — "A with B" report types.** One row per child, the parent's
      fields repeated, with an include-parents-with-no-children toggle (outer
      join). This is the half that changes what a row IS, which is why it is
      separate: groupings, row counts, totals and the row limit all have to
      follow the child.
- [x] **Cousins** — reachable by choosing the other end as the primary object
      (report on Work Orders, pull Building → Property → Account down the parent
      chain). Nothing to build; the picker already walks parents to depth 3.
      Revisit only if a case appears that this cannot express.

## 2. Charts — enterprise layout

- [ ] **Pie/donut legend on the right**, values readable. Today the labels are
      leader-lined around the circle and overlap each other at anything past
      four slices; the legend under the chart shows ONE series at a time behind
      a 1/5 pager, which is not a legend.
- [ ] Long category names truncated with the full name on hover, not clipped
      mid-word.
- [ ] A slice smaller than a threshold rolls into "Other" rather than drawing a
      label nobody can read.
- [ ] Same audit for bar/line: axis titles, label density, legend placement.

## 3. Column widths that stay

- [x] Reports — drag a header edge, saved on the report. **PR #631.**
- [x] Saved list views — widths saved with the view. (Another session, PR #618.)
- [ ] **Dashboard table widgets** — no resize at all today, and no persistence.
      Widths belong on the widget's own config, the same way the report's live
      on the report.
- [ ] Confirm every table surface uses ONE resize definition
      (`src/lib/columnWidths.js`) rather than growing a third copy.

## 4. The audit itself

Walk the report builder, the viewer and the dashboard builder against
Salesforce/Power BI parity and write down what is missing, before building. Known
gaps already visible:

- [ ] A calculated field cannot be summarized (the Σ control is on selected
      fields only), so a formula column can never carry a grand total.
- [ ] A grouping on a RELATED field is skipped by the select builder, so
      grouping by a parent's column the report does not display produces empty
      group headers.
- [ ] Matrix reports have no column widths and no drill-through.
- [ ] Report row limit is a single Top-N; no "show first N per group".
- [ ] Dashboards: no scheduled delivery of a dashboard (reports have it), no
      per-widget "view as" role, no drill-through from a widget into the
      underlying rows beyond the existing cross-filter.

---

Ordering rule for this queue: anything Nicholas hits while using the platform
jumps ahead of anything on this list.
