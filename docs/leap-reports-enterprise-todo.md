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
- [x] **The chart palette re-stepped.** DECIDED 2026-08-31 (Nicholas: "re-step
      all seven"). The old set
      `#3ecf8e,#7eb3e8,#1e466b,#a78bfa,#2aab72,#5eead4,#8fa0b8` failed every
      computable check: two colours outside the OKLCH lightness band, three
      below the chroma floor (they read as gray), six under 3:1 against the
      white card. Now
      `#009c65,#623e96,#1398e2,#813075,#7a89e7,#008d9b,#b776d4` — all seven
      clear 3:1 on both card surfaces, sit in the band and above the floor, and
      every adjacent pair AND every pie ring from 2 to 7 slices separates by at
      least ΔE 9.2 under simulated protanopia and deuteranopia. Guarded by
      `scripts/chart-palette-fixture.mjs` (66 checks, with the old palette as a
      positive control that must fail).
      Three findings worth keeping: seven identities cannot ride on hue alone
      (deuteranopia collapses red-green, so the set alternates a light and a
      deep tier); a pie is a RING, so slot 1 borders every other slot at some
      series count, which is why only one green is allowed and why it must be
      slot 1; and the emerald had to go deeper than the `#3ecf8e` UI accent,
      which cannot clear 3:1 on white at its own lightness.
- [x] **Cycling removed.** `seriesColor(i)` in `src/data/constants.js` returns
      the slot colour and, past the seventh, a deliberate neutral — never a
      wrap. Caught live on an 8-row funnel where "Westminster Company" came out
      the same emerald as "Lutheran Social Services". All 43 call sites across
      9 files route through it; pinned in the palette fixture.
- [x] **Pie/funnel legend grows with the tile.** It was a hard 210px column, so
      widening a widget widened the CHART and the names stayed truncated
      forever (Nicholas: "even when I made the element way wider, it's still
      cutting off the names").
- [x] **Legend layout is honoured literally.** "Right" set in the editor was
      arriving at the BOTTOM on the rendered page, because a width threshold
      silently re-laid the widget out and the runner's tile is narrower than
      the canvas tile. `right`/`bottom` are now literal everywhere; responsive
      behaviour is an explicit third choice (`auto`).
- [x] **Independent legend switches** — count and percentage are separate
      toggles, and the numbers can sit before or after the name.
- [x] **Funnel rebuilt.** Labels inside the bands in contrast-picked ink, no
      leader lines (they were what ran off the tile), a 38% floor so a small
      stage is a visible band rather than a hairline stem, and the names in the
      shared legend. One legend definition (`SeriesLegend`) now serves the pie,
      donut and funnel.
- [x] **Every chart audited by rendering all 30 widget types and looking at
      them.** Four real defects, none of which reading the code would have
      found:
      (1) **A gauge widget CRASHED on any real dashboard** — it recomputed its
      number from `result.rows`, but the runner sends it down the
      single-aggregate query, which returns no rows at all. "Cannot read
      properties of undefined". Every other single-value widget beside it read
      `aggregatedSingle`; only the gauge did not.
      (2) **The palette re-step never reached half the charts** — bar, line,
      area, waterfall, pareto, combo, sparkline, gauge, ranked list and both
      heatmaps still drew the old `#3ecf8e` UI accent, so a bar and a stacked
      bar on one dashboard were two different greens. `CHART_INK` now.
      (3) **Long category labels truncated to "Enrollmen…" on every vertical
      chart.** Angled at 30° now, above 12 characters only.
      (4) **The rose chart had the pie's old disease** (leader lines, a legend
      paginated to "1/4") and the **sunburst knotted its labels** in the centre.
      Both use the shared legend now.
      Also: heatmaps got a real single-hue sequential ramp, and combo's legend
      names the measure instead of saying "Bars".
- [x] **`npm run verify:charts`** renders all 30 types, fails on any widget
      that throws, any that fails to render, and any that paints nothing — and
      feeds the single-value widgets exactly what their query shape returns,
      which is the only way the gauge crash is visible.
- [ ] Axis titles are still absent everywhere (the dataviz mark spec calls for
      them where the unit is not obvious).
- [ ] ~~`CHART_COLORS[i % length]` cycles.~~ An 8th series wraps to slot 1 and
      gets an identical colour to the first — the palette is meant to be
      assigned in fixed order and never cycled. Six modules do this inline. The
      pie widget already folds its tail into "Other"; the others should either
      fold too or render the overflow as a neutral, never as a duplicate.

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

## 3c. Dashboard filters

Nicholas, 2026-08-31: *"we definitely need a dashboard-level filter for states
and things, just like Salesforce"*, then *"all dashboards need the filter. I'm
looking at the enrollment dashboard. Do you see a filter there? I don't see it.
The user needs to be able to put any kind of filter they want on, not just the
state filter."*

- [x] **A filter names its column per object** (`dfilt_field_map`). One control
      filters properties by `property_state` and opportunities by
      `opportunity_state`. Before this a filter carried ONE column name and a
      widget whose object lacked it was silently skipped — DSH-00010's Pipeline
      by Stage widget was showing every state next to four widgets scoped to NC.
- [x] **A real field picker**, grouped by the objects the dashboard's widgets
      report on, replacing the free-text box for a raw column name. Picking a
      field proposes the equivalent on every other object and states coverage:
      "Applies to Properties, Opportunities. Not applied to Work Orders."
- [x] **"Not filtered by X" on the widget itself** — a filter a widget's object
      cannot answer is still dropped (the only safe thing), but it no longer
      does so invisibly.
- [x] **The value dropdown shows names, not uuids.**
      `dashboard_filter_distinct_values` resolves a picklist or lookup column
      through its target, so Status and Record Type are pickable at all. It also
      lost its `anon` EXECUTE grant.
- [x] **Every dashboard carries a filter**: Enrollment and Qualification take
      Status (their widgets are single-object), Program Operations takes State.
- [ ] Filters are per-dashboard, not per-viewer: there is no "my default filter
      value", and no equivalent of Salesforce's dashboard "view as" role.
- [ ] An on-canvas filter widget still names one column and cannot be mapped
      across objects the way a bar filter can.

## 3d. Field-level security — the one that outranked everything

Found by auditing rather than guessing, 2026-08-31, and built the same day.

- [x] **Financial tiers are enforced, not just declared.** CLAUDE.md has
      described Tier 1 / 2 / 3 since the platform's first week. All 96
      populated `field_metadata` rows carried tier 1, and NO read path
      consulted the column — so any user who could build a report could put
      gross margin, labour cost or the agreed subcontractor payout on one.
      Now: `roles.role_max_financial_tier` (what a role sees) +
      `field_metadata.fm_financial_tier` (what a field is), one decision
      function, and `app_user_restricted_fields(object)` as the single
      question every read path asks. 96 fields at tier 2, 15 at tier 3.
- [x] **Record pages came free** — the tier is applied inside
      `app_user_field_permissions`, the RPC every page layout already calls,
      as a hard floor that an explicit "visible" grant cannot override.
- [x] **Reports enforce it twice**, because there are two different leaks: the
      field picker never offers a restricted column (filtered at
      `describeColumns`, the choke point everything derives from), AND a
      SAVED report drops them at run time — an Admin builds it, a technician
      runs it, and the picker never saw that field.
- [ ] **Column-level database privileges.** The decision is the database's and
      every app read path honours it, but LEAP's users all share the
      `authenticated` Postgres role, so a determined user with the anon key
      could still select a restricted column through PostgREST directly. The
      real fix is revoking those columns from `authenticated` and serving them
      through a definer view. Worth doing before any external/portal user gets
      reporting.
- [ ] Dashboards: a widget whose measure is a restricted field should say so
      rather than erroring or showing an empty tile.

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
