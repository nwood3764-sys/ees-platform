# Reports & Dashboards — enterprise parity queue

Raised by Nicholas on 2026-08-31: *"Some of the functionality on dashboards and
reports might need to be audited and made enterprise functionality and custom
ability."* This is the working queue for that, in the order he gave it. Items
are struck through as they ship, with the PR that did it.

## 1. Children and cousins in the field picker — FIRST

- [x] **Child roll-ups** — a child object as an aggregate on the parent's row
      (Units, Sum of Square Feet, Latest Assessment Date). `report_child_rollup`
      RPC, SECURITY INVOKER. **PR #670.**
- [x] **Child rows — "A with B" report types.** One row per child, the parent's
      fields repeated, with an include-parents-with-no-children toggle (outer
      join). **PR #671.**
- [x] **Cousins** — reachable by choosing the other end as the primary object
      (report on Work Orders, pull Building → Property → Account down the parent
      chain). Nothing to build; the picker already walks parents to depth 3.
      Revisit only if a case appears that this cannot express.

## 2. Charts — enterprise layout

- [x] **Pie/donut legend on the right**, values readable. **PR #672.** Labels
      moved inside the slices (≥8%), leader lines gone, legend carries name +
      value + share in aligned columns, with a Legend position control.
- [x] Long category names truncated with the full name on hover. **PR #672.**
- [ ] A slice smaller than a threshold rolls into "Other" rather than drawing a
      label nobody can read.
- [ ] Same audit for bar/line: axis titles, label density, legend placement.

## 3. Column widths that stay

- [x] Reports — drag a header edge, saved on the report. **PR #631.**
- [x] Saved list views — widths saved with the view. (Another session, PR #618.)
- [x] **Dashboard table widgets** — drag to resize, saved on the widget's own
      config. **PR #673.**
- [x] Every table surface now uses ONE resize definition
      (`src/lib/columnWidths.js`). **PR #673.**

## 4. The audit itself

Walk the report builder, the viewer and the dashboard builder against
Salesforce/Power BI parity and write down what is missing, before building. Known
gaps already visible:

- [ ] A calculated field cannot be summarized (the total control is on selected
      fields only), so a formula column can never carry a grand total. NEXT.
- [x] A grouping on a RELATED field was skipped by the select builder, so
      grouping by a parent's column produced "(blank)" headers and collapsed the
      whole report into one group. Fixed — it rides the embed tree, label embed
      included. **PR #674.**
- [ ] Matrix reports have no column widths and no drill-through.
- [ ] Report row limit is a single Top-N; no "show first N per group".
- [ ] Dashboards: no scheduled delivery of a dashboard (reports have it), no
      per-widget "view as" role, no drill-through from a widget into the
      underlying rows beyond the existing cross-filter.

---

Ordering rule for this queue: anything Nicholas hits while using the platform
jumps ahead of anything on this list.
