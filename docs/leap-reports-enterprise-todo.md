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
- [x] Pie/donut rebuilt with an HTML legend (Inter names, mono numbers), a
      responsive row/column layout measured from the tile, and a tail that folds
      into "Other" past six wedges. **PR #675.**
- [ ] Same audit for bar/line: axis titles, label density, legend placement.
- [ ] **The chart palette fails the dataviz validator** and needs a decision.
      `CHART_COLORS` = `#3ecf8e,#7eb3e8,#1e466b,#a78bfa,#2aab72,#5eead4,#8fa0b8`
      returns FAIL on the lightness band (`#1e466b` too dark at 0.384,
      `#5eead4` too light at 0.855), FAIL on the chroma floor (`#7eb3e8`,
      `#1e466b` and `#8fa0b8` read as gray), and WARN on contrast (six of seven
      below 3:1 against the surface). CVD separation passes. Fixing it means
      re-stepping the series hues platform-wide, inside the no-red/orange rule —
      a visible change to every chart, so it is Nicholas's call, not a silent
      one.

## 3. Column widths that stay

- [x] Reports — drag a header edge, saved on the report. **PR #631.**
- [x] Saved list views — widths saved with the view. (Another session, PR #618.)
- [x] **Dashboard table widgets** — drag to resize, saved on the widget's own
      config. **PR #673.**
- [x] Every table surface now uses ONE resize definition
      (`src/lib/columnWidths.js`). **PR #673.**

## 3b. Object grouping

- [x] The primary-object picker grouped by OBJECT_CATALOG's internal categories
      ("CRM & Enrollment", "Data", "User Interface") — filing nobody outside
      Object Manager has ever seen. It groups by the object's real module now.
      **PR #679.**
- [ ] **The service-provider objects have no module in the nav registry**, so
      they group under "Setup & configuration" even though a Service Providers
      module exists. Registering them in `src/lib/objectNav.js` fixes the group
      AND their record navigation, which today falls back to the Field module.

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
