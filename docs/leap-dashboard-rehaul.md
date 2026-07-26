# LEAP Dashboard Rehaul — Enterprise-Class Analytics Builder

Handoff / build spec. Written 2026-07-26 after Nicholas's ruling that the dashboard builder needs to go from "it works" to enterprise-class: *"I'm surprised there's not 25 or more different components that are standard. Look at components similar to what Microsoft uses, what Salesforce uses… this needs to be intuitive and enterprise class. It looks really cartoonish. This probably needs a full rehaul."*

---

## 1. Vision / goal

The LEAP dashboard builder should stand next to Power BI, Salesforce Lightning dashboards, and CRM Analytics without apology:

- **25–40 component types**, grouped the way analysts think (KPIs, comparison, trend, part-to-whole, distribution, tables, filters, content) — not 12.
- **Widgets that fill their tiles** and look designed: data labels, legends, axis titles, number formats (currency/percent/decimals), conditional color rules, target/reference lines — all configurable per widget from the inspector.
- **Real table options**: column picking, sorting, totals, matrix/pivot, conditional cell formatting.
- **Intuitive builder UX**: live previews everywhere (already true), in-place type conversion (shipped, PR #220), sensible defaults, no dead ends.
- Everything stays inside the existing LEAP conventions: registry-driven (nothing hardcoded), Salesforce terminology, LEAP palette (emerald/sky/navy, **no red/orange**), Inter + JetBrains Mono, RLS-respecting queries.

## 2. What just shipped (context)

- **PR #220 (2026-07-26, this session):** in-place widget type conversion — the inspector's new **Widget type** dropdown converts a placed widget between types; report binding + shared config (group by / measure / sort / limit) carry over via `convertConfigForType()`; the canvas grows the tile to the new type's `minSize`. Also fixed the save-blocking bug: `dashboards_dash_columns_check` capped `dash_columns` at 4 while the canvas saves 12 — widened to 1..12 (migration `20260726190000`, applied to prod).
- The builder itself (Phase 0–3 of `leap-builder-rearchitecture.md`) is live: three-pane `LeapCanvas` (palette / react-grid-layout canvas / inspector), registry-driven, live report-backed previews, geometry persisted in `dw_widget_config._geometry`.

## 3. Current-state architecture map (actual code)

**Data/persistence (solid, keep):**
- `dashboards` + `dashboard_widgets` (+ `dashboard_filters`); widget config is free jsonb `dw_widget_config`; `dw_widget_type` text; geometry/chrome under `_geometry`/`_subtitle`/`_footer` namespaced keys. Adapter: `src/builder/adapters/dashboardAdapter.js` (delete-and-reinsert on save — new UUIDs each save, so nothing may key off widget id).
- Query paths in `src/data/reportsService.js`: `runReport` (raw rows) and `runWidgetAggregate` → `report_aggregate` RPC (server-side single group-by + single measure, returns `{label, value, raw_value}`), `dashboard_filter_distinct_values` for filter dropdowns. Dashboard filters override same-column report filters (`overrideFields`).

**Component model (the bottleneck):**
- `src/builder/componentRegistry.jsx` — **12 entries** (metric, gauge, bar, line, pie, donut, funnel, table, ranked_list, heading, rich_text, spacer). One declarative entry = palette chip + inspector form (`configSchema` field descriptors) + canvas preview. This registry design is exactly right — the rehaul is *filling it*, not replacing it.
- `src/builder/registries/dashboardRegistry.jsx` — inspector + live preview wiring; `src/builder/LiveWidgetPreview.jsx` — real-data tile previews (re-fetches on type/config change).

**Renderers (the "cartoonish" part):**
- `src/modules/DashboardWidgetView.jsx` (465 lines) — shared by runner and builder (true WYSIWYG). Uses **Recharts, lazy-loaded** (`src/lib/RechartsLazy`, `vendor-recharts` chunk already isolated — no new TDZ risk).
- Pain points, concretely:
  - Every chart is a **fixed 240px height** inside `ResponsiveContainer width=100%` — a tall tile is mostly whitespace; the funnel in a 6×8 tile renders a small distorted wedge stack (Nicholas's screenshot).
  - **No data labels** (except pie slice names), **no legends, no axis titles, no gridline/tick styling**, default Recharts tooltips (unstyled, not LEAP fonts).
  - **No number formatting**: everything is `toLocaleString()` — no currency, percent, compact (1.2M), or decimal control anywhere.
  - **Single group-by + single measure only** — no stacked/clustered series, no combo, no time bucketing (a "line chart over created month" is impossible; the line chart just plots categories).
  - **No conditional formatting** (metric thresholds, table cell rules), no reference/target lines except the gauge.
  - Table widget = raw report rows, no column selection/sort/totals config (`row_limit` only).
  - Palette `Preview` renderers are fake CSS bars/pies — fine for chips, but they also render on-canvas until a report is bound, which reads as toy-like.
- `report_aggregate` RPC handles: group-by (incl. picklist/FK label resolution), measure, sort, limit. It does **not** handle: two-dimension grouping, time bucketing, multi-measure, binning, no-group single aggregates (metric widget falls back to client-side reduce over `runReport` rows).

## 4. Target architecture + design principles

1. **The registry stays the single lever.** Every new component is one `componentRegistry.jsx` entry; runner/builder/palette/inspector pick it up automatically. New config field types (color-rule editor, column multi-picker, measure list) are added to `inspectorControls.jsx` once and shared.
2. **One themed chart kit, not per-widget styling.** A `src/builder/chartKit/` module wraps Recharts with LEAP-themed primitives: `<LeapTooltip>`, `<LeapLegend>`, axis defaults (Inter 11px, `C.textSecondary` ticks, `C.border` gridlines), the no-red/orange palette, and a shared `formatNumber(value, format)` (number / currency / percent / compact / decimals). Every widget renders through the kit so polish is uniform and bought once.
3. **Charts fill their tiles.** `ResponsiveContainer height="100%"` against the grid tile (the tile already has a real height from `_geometry`); kill every hardcoded 240.
4. **Four new query shapes unlock ~25 widgets** (see §6 research): single aggregate (no group), two-dimension pivot (category × series), time-bucketed (`date_trunc` grain), per-entity multi-measure. Ship them as extensions of the `report_aggregate` RPC family (new SECURITY INVOKER RPCs, RLS-respecting, same label-resolution behavior) — never client-side over full row dumps.
5. **Config is additive jsonb** — new keys in `dw_widget_config` (`series_by`, `date_grain`, `number_format`, `show_data_labels`, `color_rules`, `columns`, …). No schema migration for widget features; existing widgets keep rendering unchanged.
6. **Formatting vocabulary is Salesforce's**: conditional formatting = ranges + colors (blue/navy/emerald only), reference lines, decimal places, show values/percentages, chart palette = LEAP `CHART_COLORS`.

## 5. Phased build plan (each phase additive + independently shippable)

**Phase A — Polish the 9 existing data widgets (the "cartoonish" fix; no new queries).**
Chart kit (themed tooltip/legend/axes/palette/formatters) + fill-height + data labels toggle + axis titles + number format picker (number/currency/percent/compact, decimals) + legend toggle + metric conditional color thresholds + table column picker/sort/totals + funnel fixed (fill height, sorted stages, stage labels + values + % of first). Highest visible impact per hour.

**Phase B — Query shapes.**
`report_aggregate_2d` (category + series pivot), `report_aggregate_time` (date grain param: day/week/month/quarter/year), single-aggregate fast path for metric/gauge/KPI, multi-measure per-entity for scatter. All RLS-respecting SECURITY INVOKER, verified with explicit SELECTs.

**Phase C — Component expansion to 25+** (registry entries riding A+B), in priority order from the vendor research:
- *P1 (table stakes):* stacked bar/column, clustered bar/column, area chart, KPI card (value + target + delta), matrix/pivot table, on-canvas filter widgets (picklist/date-range/toggle — generalizing the existing `dashboard_filter_distinct_values` pattern).
- *P2:* 100% stacked, combo (line+column dual axis), stat-with-sparkline, linear/bullet gauge, treemap, waterfall, heatmap/highlight table, scatter, histogram, sparkline, link/navigation widget, image widget.
- *P3 (later):* pyramid, radar, sankey, bubble, calendar heatmap, state timeline, box plot, geo map (properties by state/county), multi-row card, rating.

**Phase D — Dashboard-level enterprise features.**
Per-widget drill options, dashboard descriptions + refresh timestamp display, scheduled refresh/subscriptions (email a snapshot — rides the existing `dispatch-scheduled-reports` pattern), view-as/dynamic dashboards (financial-tier aware — blocked on the field_permissions build), mobile layout review.

Sequencing: A alone answers "cartoonish." A+B+C(P1) answers "enterprise-class." Ship A first, then B+C(P1) together.

## 6. Technical recommendations (research-backed)

**Component master list (Microsoft / Salesforce / Tableau / Grafana synthesis).** Full 38-component inventory with data shapes, priority tiers, and vendor citations gathered 2026-07-26; the priority tiers above encode it. Key structural finding: only **four new query shapes** are needed beyond the existing grouped aggregate — (1) no-group single aggregate, (2) category × series pivot (the highest-leverage: unlocks 9 widgets), (3) time-bucketed, (4) per-entity multi-measure; binned distribution and raw-interval rows are the only P2/P3 additions beyond those.

**Charting library (researched 2026-07-26): adopt Apache ECharts as the chart engine.**
- **ECharts** (Apache-2.0): the only permissive library covering the entire Salesforce parity list natively — stacked/100%-stacked/grouped bars, combo with dual axis, scatter, gauge, funnel, heatmap, treemap, sankey, cumulative lines, reference lines/bands (`markLine`/`markArea`), data labels with formatters, axis ranges/titles, rich legends. Tree-shakes to ~90–110 KB gz via `echarts/core` + per-chart imports. **Themes are plain JSON registered via `registerTheme()`** — the LEAP palette + Inter becomes one theme object, storable in the DB per the "nothing hardcoded" rule (and Salesforce's 14-palette feature becomes N theme rows). Canvas rendering stays smooth at row volumes where SVG chokes.
- Skip `echarts-for-react` (sluggish maintenance); write a ~60-line `useECharts(ref, option, theme)` hook with a ResizeObserver.
- **Recharts v3** (MIT, ~50 KB) is the runner-up — fastest to build with and shadcn-aligned, but lacks native gauge/heatmap/combo polish/markLine, i.e. we'd hand-roll exactly the enterprise extras that triggered this rehaul. Rejected as the *engine*; the existing Recharts widgets keep working until each is ported.
- Phase A therefore = port the 9 existing renderers onto themed ECharts (all are native ECharts types), which delivers fill-height, labels, legends, tooltips, and formatting in one motion. ECharts gets its own Vite manualChunk and must pass `npm run build:safe` (TDZ trap).

**Table engine: TanStack Table v8 + TanStack Virtual (both MIT).** Headless — grouping/aggregation (sum/avg/min/max), sorting, pagination, selection render entirely in LEAP's design system; conditional cell-format rules become plain render logic driven by `dw_widget_config`. **AG Grid Community is a trap for this use**: row grouping/aggregation/pivot are Enterprise-only (paid), which is precisely the Lightning-table feature set we need.

**Salesforce parity details worth encoding** (from the Help-doc research): Lightning tables do up to 200 rows / 10 columns, group-by any field + up to 9 measure columns, ≤5 conditional-format rules; metrics support conditional highlighting with breakpoint segment ranges; gauges support dynamic targets (target/max from a report metric) + colored segment ranges; charts support show-values/show-percentages, decimals + compact ("1.2k") formatting, custom axis ranges/titles, two-level sort, multiple reference lines, cumulative lines; dashboards support ≤5 filters × 50 values with operators, view-as (our SECURITY INVOKER RPCs already give viewer-RLS semantics), subscriptions with emailed snapshots, visible "As of" refresh timestamp, component descriptions, and a 20-component sanity cap.

**UX patterns to copy** (open-source tools): Grafana's panel editor (live chart center-stage + searchable grouped options rail — the model for our inspector as settings multiply) and its defaults-plus-overrides settings architecture (panel-level unit/decimals/thresholds, then per-series override rules — serializes cleanly into `dw_widget_config`); Metabase's per-widget click behavior (drill menu / custom destination / set-a-dashboard-filter); Superset's filter scoping (each filter declares which widgets it applies to) + cross-filtering (clicking a segment filters sibling widgets).

**Hazards / rules for the build:**
- Vite vendor chunks: any new chart lib must get its own manualChunk and pass `npm run build:safe` (TDZ trap).
- The adapter deletes + reinserts widgets on save — config-jsonb only, never key on widget UUID.
- `report_aggregate` label resolution (picklist/FK) must be replicated in every new RPC, or grouped labels regress to UUIDs.
- Charts must use LEAP `CHART_COLORS`; conditional-formatting "bad" states are sky/navy, never red/orange.
- Financial measures (opportunity amounts etc.) will eventually be tier-gated (Tier 2/3); design `number_format: currency` widgets so server-side tier enforcement can null the measure without breaking the render.

## 7. Decisions

1. **Charting library: adopt Apache ECharts as the engine (port the 9 existing widgets in Phase A) vs. extend Recharts.** Recommendation: **ECharts** — Recharts would leave us hand-building reference lines, conditional segment colors, gauges, heatmaps, and combo charts, i.e. the exact gap that triggered this rehaul; ECharts has them natively under Apache-2.0 with DB-storable JSON themes. Cost: a one-time port of 9 simple renderers behind the existing `WidgetBody` switch (runner + builder share it, so one port covers both). — *pending, Nicholas*
2. **Component breadth target: ship C(P1+P2) ≈ 27 types, hold P3 for demand.** Recommendation: yes. — *pending, Nicholas*
3. **Slicer-style on-canvas filter widgets vs. keeping filters only in the header bar.** Recommendation: build filter *widgets* (Salesforce/Power BI both have them; the header bar stays for global filters). — *pending, Nicholas*

## 8. File + DB-table index

| Area | Path |
|---|---|
| Component registry (the lever) | `src/builder/componentRegistry.jsx` |
| Inspector field controls | `src/builder/inspectorControls.jsx` |
| Dashboard registry (inspector/preview wiring) | `src/builder/registries/dashboardRegistry.jsx` |
| Widget renderers (runner + builder shared) | `src/modules/DashboardWidgetView.jsx` |
| Live preview fetcher | `src/builder/LiveWidgetPreview.jsx` |
| Canvas shell / grid / palette | `src/builder/LeapCanvas.jsx`, `CanvasGrid.jsx`, `Palette.jsx` |
| Persistence adapter | `src/builder/adapters/dashboardAdapter.js` |
| Query layer | `src/data/reportsService.js`; RPCs `report_aggregate`, `dashboard_filter_distinct_values` |
| Recharts lazy wrapper | `src/lib/RechartsLazy` |
| Runner | `src/modules/DashboardRunner.jsx` |
| Tables | `dashboards`, `dashboard_widgets`, `dashboard_filters`, `dashboard_folders` |

---

## Appendix — Component master list (Microsoft / Salesforce / Tableau / Grafana synthesis, 2026-07-26)

Query shapes: **GA** = grouped aggregate (exists today) · **AGG1** = single aggregate, no group · **2DIM** = category × series pivot · **TIME** = date-bucketed · **2MEAS** = per-entity multi-measure · **BIN** = binned distribution · **RAW** = raw rows · **NONE** = config only.

| Component | Data shape | Tier | Query |
|---|---|---|---|
| **KPIs & metrics** | | | |
| Metric / number card (+ conditional color thresholds) | 1 measure | P1 | AGG1 |
| KPI card (value vs target + delta + status) | measure + target + date | P2 | AGG1+TIME |
| Stat with sparkline | measure + date | P2 | AGG1+TIME |
| Radial gauge (dynamic target + segment ranges) | measure + range/target | P1 | AGG1 |
| Linear gauge / bullet | measure + target (opt. per category) | P2 | AGG1/GA |
| Multi-row card / metric list | category + 1–3 measures | P3 | GA |
| Rating (stars/score) | measure + max | P3 | AGG1 |
| **Comparison** | | | |
| Bar (horizontal) / column (vertical) | category + measure(s) | P1 ✅ have | GA |
| Clustered bar/column | category + series + measure | P1 | 2DIM |
| Stacked bar/column | category + series + measure | P1 | 2DIM |
| 100% stacked bar/column | category + series + measure | P2 | 2DIM |
| Radar | grouping + 3+ measures | P3 | GA multi-measure |
| **Trend** | | | |
| Line (multi-series, cumulative option) | date + measure(s) ± series | P1 ✅ have (needs TIME) | TIME/2DIM |
| Area / stacked area | date + series + measure | P2 | TIME/2DIM |
| Combo (line + column, dual axis) | date/category + 2 measure sets | P2 | TIME/2DIM |
| Ribbon | date + series + measure | P3 | 2DIM |
| State timeline | entity + state + intervals | P3 | RAW |
| Sparkline (standalone) | date + measure | P2 | TIME |
| **Part-to-whole** | | | |
| Pie / Donut | category + measure | P1 ✅ have | GA |
| Funnel / Pyramid | ordered category + measure | P1 ✅ have / P3 | GA |
| Treemap | 1–2 category levels + measure | P2 | GA/2DIM |
| Waterfall | category + signed measure | P2 | GA |
| **Distribution** | | | |
| Histogram | numeric field, binned | P2 | BIN |
| Box plot | category + raw numerics | P3 | BIN/RAW |
| Heatmap / highlight table | 2 categories + measure | P2 | 2DIM |
| Calendar heatmap | date + measure | P3 | TIME daily |
| **Relationship** | | | |
| Scatter / bubble | entity + 2–3 measures | P2/P3 | 2MEAS |
| Sankey | source dim + target dim + measure | P3 | 2DIM |
| **Tables & matrices** | | | |
| Data table (columns, sort, totals, conditional cells) | any fields | P1 ✅ have (thin) | RAW |
| Matrix / pivot (row dims × col dims × measures, subtotals) | dims + measures | P1 | 2DIM pivot |
| **Filters & interactivity** | | | |
| Filter widgets (picklist, date range, numeric range, toggle, search) | 1 field each | P1 | distinct-values (exists) |
| Link / navigation widget | config | P2 | NONE |
| **Content & layout** | | | |
| Heading, rich text, spacer | config | P1 ✅ have | NONE |
| Image, container/section | config | P1 | NONE |
| **Specialized (roadmap)** | | | |
| Geo map (properties by state/county), decomposition tree, Gantt | varies | P3 | GA/RAW |

The vendor citations (Microsoft Learn visuals list, Salesforce Help widget/chart pages, Tableau Show Me, Grafana visualizations) are in the session research of 2026-07-26; the structural takeaway is in §6 — four new query shapes unlock everything through P2.
