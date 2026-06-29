# LEAP Builder Rearchitecture — WYSIWYG Drag-and-Drop (Handoff)

**Status:** Phases 0–3 SHIPPED to production. Phase 4 decided (see below). Rearchitecture functionally complete.
**Author of handoff:** prior session (2026-06-29). Read this top-to-bottom before starting.

---

## Phase 4 plan (record page layouts) — NEW builder, section model (2026-06-29, supersedes the earlier "declined")

Nicholas: build the new builder; existing is disposable; most-robust enterprise, no band-aids.

**Critical constraint:** page layouts render through `src/components/RecordDetail.jsx` — a **6,421-line live renderer on every record page in every module**. The layout *data* is seed, but this renderer is core production code. And page layouts are genuinely **section-based** (Sections → Columns → Fields + related lists / reports / file galleries / conversation panels / status paths) — the correct Salesforce model, NOT the free-tile grid dashboards/home use.

**Decision:** build the new three-pane page-layout builder on the **section/field model the live renderer already understands**, so RecordDetail is NOT rewritten (the free-tile route would force a rewrite of the app's most critical component — unacceptable risk). The "new builder" = consistent palette/canvas/inspector UX + dnd-kit (touch/keyboard) + **all** widget types editable on-canvas (today only `field_group` is; related_list/report/file_gallery/conversation_panel/status_path are modal-only).

**Build outline (additive; replace `LayoutEditor` entry in `ObjectDetail` only when verified):**
1. Page-layout component registry (field, field_group, related_list, report, file_gallery, conversation_panel, status_path) for a **section-aware** canvas.
2. Section-based canvas (sections as containers with 1–2 columns; dnd-kit for field tiles + widget + section reorder) — reuse the sound patterns in the existing `LayoutCanvas` but on dnd-kit and with all widget types inline-editable.
3. Inspector per widget type (field options, related-list columns/sort, report picker, etc.).
4. Persist via the existing `pageLayoutBuilderService` (sections + widgets + `widget_config.fields`) — **no schema change, no renderer change**, so existing record pages are untouched.
5. Swap the `ObjectDetail` → Page Layouts entry to the new editor once verified on staging.

Data model: `page_layouts` → `page_layout_sections` (section_order, section_columns, section_tab, collapsible) → `page_layout_widgets` (widget_type, widget_position, widget_size, widget_config{fields:[…]}). Service: `fetchLayoutForEdit` + granular create/update/reorder section/widget fns.

**Help articles published (prod):** HA-00113 (Dashboard canvas), HA-00114 (Home Page canvas), HA-00115 (Report builder live preview + formulas) — satisfies the ship-cycle help-article requirement for the shipped builders.

---

## Formula engine — full mathjs/formulajs swap (2026-06-29, supersedes the earlier deviation)

The earlier session extended the legacy evaluator to avoid breaking saved formulas. Nicholas confirmed Reports has **only seed data — no real reports or formulas** — so that constraint doesn't apply, and per "build the most robust enterprise functionality," the engine was swapped to the **full §8 stack**:
- `src/lib/formula/engine.js` — a **sandboxed mathjs instance** (`import`/`createUnit`/`evaluate`/`parse`/… disabled inside expressions; programmatic parsing uses a captured reference) with the **entire @formulajs/formulajs library (371 Excel functions)** registered. Compile-cached; Excel blank-as-0 scope semantics; `evaluateFormula`/`validateFormula`/`FORMULA_FUNCTIONS`/`ALL_FUNCTION_NAMES`.
- `lib/reportFormulaEval` is now a thin adapter over the engine (the custom mini-parser is gone), so reports evaluate via mathjs and the editor validates against the exact same evaluator.
- Deps `vendor-formula` (mathjs+formulajs, ~233 KB gz) + `vendor-codemirror` are isolated leaf chunks (verified acyclic — no TDZ; `decimal.js` path-bound so it doesn't collide with recharts' `decimal.js-light`). `ConfiguredHome` lazy-loads ReportRunner/ReportBuilder so the engine stays **off the Home page load** — only loads when a report opens.
- Unit-verified: arithmetic, IF/AND/OR, text (LEFT/CONCATENATE/UPPER), ROUND, blank-as-0, summary scope, and validation (syntax + unknown-field).
- **CodeMirror 6 visual editor** ✅ — `src/lib/formula/FormulaEditor.jsx`: syntax highlighting (functions / fields / strings / numbers / operators), inline **autocomplete** over field names + the curated functions + the full 371-function library, bracket-closing, and a live **Check syntax** indicator (validates against the engine). Lazy-loaded in `ReportBuilder` (replaces the textarea + insert-pickers). Headless-verified: mounts, highlights, valid/invalid detection, 0 crashes. **§8 formula engine is complete.**

---

## Phase 3 progress (Reports) — in flight

- **Drag-and-drop field selection** ✅ — the report builder's Selected Fields list is now a dnd-kit `SortableList` (drag grip to reorder) instead of up/down buttons. Additive, prod-safe.
- **Live preview from unsaved config** — pending. Needs `reportsService.runReport` refactored to run an in-memory definition (it currently loads from the DB); being built additively (`runReportDefinition`) so the existing `runReport` is unchanged. Staging-validated before prod.
- **Formula engine + visual editor (§8)** ✅ — the calculated-field editor now has a Salesforce-style **insert-field** and **insert-function** picker (categorized, with descriptions) and a live **Check syntax** indicator, plus an expanded function library (38 functions: CASE, LEFT/RIGHT/MID, CONTAINS/BEGINS/ENDS/SUBSTITUTE, CEILING/FLOOR/MOD/POWER/SQRT, BLANKVALUE/ISBLANK/ISNUMBER, WEEKDAY/ADDDAYS/DATEVALUE, …).
  - **Library deviation from decision #2 (deliberate, flagged):** I did **not** swap in mathjs + @formulajs/formulajs. The existing `lib/reportFormulaEval` is a clean sandboxed recursive-descent parser with Salesforce-flavored semantics (`=` equality, `AND`/`OR` infix keywords, `+` string-concat, divide-by-zero → null). mathjs uses incompatible syntax/semantics, so adopting it would **break every existing saved formula** — a violation of the hard "additive, never break" rule. Instead I **extended the existing evaluator** (new functions are purely additive; all existing formulas verified unchanged) and built the visual editor + `validateExpression` on the *same* parser, so the editor and runtime are guaranteed consistent. CodeMirror was likewise skipped in favor of insert-pickers + validation (no heavy dep / TDZ surface) — the field/function pickers + syntax check are the 80/20 of the Salesforce formula editor. If true Excel/mathjs parity is later required, it's a deliberate follow-up with a formula-migration pass, not a silent breaking swap.
- **Live preview from unsaved config** ✅ — `runReport` was split into a thin loader + `runReportDefinition(loaded, …)`; a new `buildReportDefinition()` mirrors `saveReport`'s builder→DB-row mapping (verified it provides a superset of every `rfilt_`/`rgr_`/`rcf_` field the runner reads). The report builder now previews the **unsaved** in-editor config (debounced 500ms), works for brand-new reports, and writes nothing back (`reportId: null` skips the Last-Run update). `runReport`'s behavior is unchanged — existing reports/dashboards unaffected.

---

## Phase 2 progress (branch `claude/builder-rearchitecture-phase-0-qt1949`, staging only)

Home pages now use the LEAP Canvas too. The key move was **generalizing the canvas into a per-surface engine** (the §4a intent): the shell (palette / grid / inspector / save / geometry) is surface-agnostic and consumes a **registry** object; a surface is now "a registry + an adapter."

- **Registry abstraction** — `src/builder/registries/`: `registryHelpers.js` (makeHelpers/fieldVisible), `dashboardRegistry.jsx` (the widget entries + report-binding inspector + LiveWidgetPreview), `homeRegistry.jsx` (home components + source-picker inspector + HomeComponentRenderer-backed preview). Shared inspector controls in `src/builder/inspectorControls.jsx`. `LeapCanvas`/`Palette`/`CanvasGrid`/`Inspector` now take a `registry` (+ `sources`) prop — no surface specifics in the shell.
- **selfChrome** — home components are self-contained cards (HomeComponentRenderer wraps each), so the home registry sets `selfChrome: true` and the canvas renders a bare selection wrapper + drag grip instead of its own header (no double card). Dashboard widgets keep the Title/Subtitle/Footer chrome.
- **Home adapter** — `src/builder/adapters/homePageAdapter.js`: load/save via the existing `fetchHomePage`/`save_home_page` RPC; geometry rides in `hpc_config._geometry`; canvas pages save as the `single`/`main` template and are positioned purely by geometry. No schema change (`hpc_source_id` confirmed uuid; we store the source UUID, fixing the legacy builder's record-number bug).
- **Editor** — `src/modules/admin/HomePageCanvasEditor.jsx`: list → New/Edit → canvas; page name in header; module/role/active/default in the inspector's page-settings view. Replaces `HomePageBuilder` at Setup → User Interface → Home Pages.
- **Viewer honors geometry** — `ConfiguredHome` places components by `_geometry` on the 12-col grid when present (view == build); legacy template/region pages (HP-00005/6, no geometry) render exactly as before.

`HomePageBuilder.jsx` is now unreferenced (kept as rollback alongside `DashboardEditor.jsx`; delete both once Phases 1–2 are confirmed). **Next:** Phase 3 (Reports — drag fields, live preview, formula engine).

---

## Phase 1 progress (branch `claude/builder-rearchitecture-phase-0-qt1949`, staging only)

The headline win: the form-driven `DashboardEditor` ("weird list view") is **replaced** by the LEAP Canvas wired to the real dashboards tables. Built on Phase 0, additive, no schema change.

- **Shared renderers** — extracted `DashboardRunner`'s widget renderers into `src/modules/DashboardWidgetView.jsx` (`WidgetBody` + `buildChartData`). The runner and the builder now render widgets through the *same* code (behavior-preserving for the runner).
- **Live WYSIWYG previews** — `src/builder/LiveWidgetPreview.jsx`: report-bound canvas tiles fetch real report data (same `runReport`/`runWidgetAggregate` fast-path as the runner) and render the real widget, driven by the unsaved config. What you build is what ships.
- **Persistence adapter** — `src/builder/adapters/dashboardAdapter.js`: loads a dashboard into the canvas and saves it back via the existing `saveDashboard`. Geometry (`{x,y,w,h}` on the 12-col grid) and the Salesforce Title/Subtitle/Footer chrome are stored in `dw_widget_config` under namespaced keys (`_geometry`/`_subtitle`/`_footer`) — they survive `saveDashboard`'s delete-and-reinsert, need no migration (verified: no trigger on `dashboard_widgets`, free jsonb), and the runner falls back cleanly when absent.
- **Runner honors geometry** — `DashboardRunner` places widgets by `_geometry` on a 12-col CSS grid (view == build) and shows subtitle/footer, **only when present**. Existing dashboards (DSH-00009/10) have no `_geometry` (verified on staging) → they render exactly as before.
- **The editor** — `src/modules/DashboardCanvasEditor.jsx`: three-pane canvas + dashboard settings (name in header; description/folder/filters in the inspector's no-selection view; filters reorder via dnd-kit). Repointed both entry points (`ReportsModule`, `ConfiguredHome`) from `DashboardEditor` to it. `DashboardEditor.jsx` is now unreferenced (kept temporarily as rollback; delete once Phase 1 is confirmed).

**Next:** confirm on staging (build/save/view a dashboard round-trip), then Phase 2 (Home pages) reuses the same canvas + adapter pattern. Help article lands with the Phase 1 master ship.

---

## Phase 0 progress (branch `claude/builder-rearchitecture-phase-0-qt1949`, staging only)

Foundation shipped to the **staging** site (NOT master — held for Nicholas to test):

- **Libraries added safely** (decision #2): `react-grid-layout` (grid canvas + resize + palette drag-in) and `@dnd-kit/{core,sortable,utilities}` (sortable/nested lists). Isolated in `vite.config.js` as `vendor-grid` / `vendor-dndkit`. Verified the built import graph is a **DAG** — no `vendor-react`/`vendor-recharts` → grid/dndkit back-edge — so the TDZ white-screen hazard (§5) cannot occur. `build:safe` green; headless Chromium render confirmed 0 TDZ/init errors and a working canvas. (Formula-engine deps — CodeMirror/mathjs/formulajs, §8 — are deferred to their own focused increment so ~1 MB of unused vendor code isn't shipped before that subsystem exists.)
- **Geometry model** (`src/builder/geometry.js`): explicit `{x,y,w,h}` grid units on a 12-col responsive grid, plus legacy `dw_position_row/col/width` ⇄ grid conversion so Phase 1 can read/write existing dashboards without breaking the runner.
- **Component registry** (`src/builder/componentRegistry.jsx`): the single declarative source of truth. Seeded with the dashboard widget family (metric, gauge, bar, line, pie, donut, funnel, table, ranked_list) + content components (heading, rich_text, spacer). Each entry's `configSchema` auto-generates the inspector; `Preview` renders the canvas tile. Adding a widget = one entry.
- **LEAP Canvas shell** (`src/builder/LeapCanvas.jsx` + `Palette.jsx`, `CanvasGrid.jsx`, `Inspector.jsx`, `SortableList.jsx`): the three-pane editor — palette (registry-driven, drag or click to add) / live RGL canvas (drag-move, resize, select) / schema-driven inspector (+ dnd-kit reorderable layer list). Surface-agnostic; configured by initial components/layout + an `onSave`.
- **Surfaced** at **Setup → User Interface → "Builder Studio (Preview)"** (`src/modules/admin/BuilderStudio.jsx`), lazy-loaded, **in-memory sandbox only** — writes nothing. The legacy `DashboardEditor`/`DashboardRunner` and every shipped dashboard are **untouched** (the one "additive, never break" constraint from decision #5).

**Next (Phase 1):** wire the canvas to the real `dashboards`/`dashboard_widgets`/`dashboard_filters` tables via a persistence adapter (reuse `loadDashboard`/`saveDashboard`), port the inspector previews to reuse `DashboardRunner`'s recharts renderers, then replace the `DashboardEditor` entry points. Help article for the builder is deferred to the Phase 1 **master** ship (per the ship cycle, help articles land with the production feature, not the staging preview).

---

## 1. The vision (what we're building)

Replace LEAP's current form-driven builders with **true WYSIWYG, Salesforce-parity drag-and-drop builders**. The mental model is identical across every surface — a **three-pane editor**:

- **Left rail — Component palette.** Draggable widget/component chips, grouped by category. You drag one onto the canvas.
- **Center — Live canvas.** The *actual rendered page* (not a list/form). Drop widgets, drag to reposition, drag handles to resize. What you see is what ships. Responsive.
- **Right rail — Inspector.** With a widget selected: pick its report/data source, set filters, ranges/thresholds (gauge min/mid/max), measure + group-by, title, conditional formatting, etc.

This model powers **all four surfaces**, which today are four disconnected subsystems:
1. **Dashboards** (mirror Salesforce Dashboard builder)
2. **Home pages** (mirror Salesforce Lightning App Builder)
3. **Reports** (mirror Salesforce Lightning Report Builder — fields, filters, groupings, summary formulas)
4. **Record page layouts** (mirror Salesforce Page Layout editor / Dynamic Forms)

The user's words: the current dashboard Edit drops you into "*some kind of weird list section view that's extremely crazy and difficult to look at … has nothing to do with a real page layout.*" That weird screen is `DashboardEditor.jsx` (a row/col form). It is the #1 thing to replace.

We also want **more widget components than Salesforce ships**, **all field types**, and **calculated/formula fields**.

---

## 2. What shipped just before this handoff (context)

Two production fixes (PR #11, live on `ees-ops.netlify.app`):
- **Dashboard filter override** — dashboard filter columns now override a report's own saved filter on the same column (`reportsService.runReport` / `runWidgetAggregate` gained an `overrideFields` param; `DashboardRunner` passes its filter columns). Fixed the Outreach Dashboard STATE filter (All → 10,964 instead of being pinned to NC 5,014).
- **Enrollment home page** — the Enrollment module (`OutreachModule.jsx`, route `/m/enrollment`) now resolves to its own home page (HP-00005 / DSH-00009) instead of the Outreach dashboard.

These touched the *runtime* (`DashboardRunner`, `reportsService`). The rearchitecture is mostly about the *builders*. The runners are in better shape than the builders and can be largely reused.

---

## 3. Current-state architecture map (the truth on the ground)

Every builder reinvents its own drag-and-drop with **native HTML5 events**; there is **no shared DnD library** and **no grid/resize library** in `package.json` (no `dnd-kit`, `react-dnd`, `react-grid-layout`, `react-beautiful-dnd`). This is the root of the inconsistency.

### 3a. Dashboards
- **Runner:** `src/modules/DashboardRunner.jsx` — solid. Loads dashboard → fetches each widget's report (server-side `report_aggregate` fast-path for charts) → renders in a CSS grid → drill-to-record on segment click. **Reuse this.**
- **Builder:** `src/modules/DashboardEditor.jsx` (~540 lines) — **the "weird list view."** Pure form. Widgets are a list; positioning is numeric `dw_position_row`/`dw_position_col` computed from array order; reorder via up/down buttons. **No drag, no canvas, no live preview.** Replace entirely.
- **Widget types (8):** `table`, `metric`, `bar`, `line`, `pie`, `donut`, `funnel`, `gauge`, plus `ranked_list`.
- **DB:** `dashboards` (`dash_columns`, `dash_layout` jsonb — *exists but unused*), `dashboard_widgets` (`dw_position_row/col`, `dw_width/dw_height` — *width/height largely unused*, `dw_widget_config` jsonb), `dashboard_filters` (`dfilt_field_name`, `dfilt_operator`, `dfilt_default_value`, `dfilt_options`).
- **Pain:** no free positioning/resize; flat unvalidated `dw_widget_config`; filters are single-value dropdown/text only (no multi-select, ranges, conditional logic); no responsive layout.

### 3b. Home pages
- **Viewer:** `src/components/ConfiguredHome.jsx` — resolves a page via `resolve_home_page_for_module` RPC (role + module), renders regions from a template, renders each component via `HomeComponentRenderer`. **Reuse.**
- **Renderer:** `src/modules/admin/HomeComponentRenderer.jsx` — `EmbeddedDashboard` dynamically imports `DashboardRunner`; so a home page already embeds dashboards. Component types (8): `dashboard`, `report_chart`, `list_view`, `task_list`, `metric_card`, `gauge`, `percentage_card`, `rich_text`.
- **Builder:** `src/modules/admin/HomePageBuilder.jsx` — *closest thing to WYSIWYG today*: palette (left) + template canvas (center) + properties (right), using basic HTML5 drag onto fixed regions.
- **Templates:** `src/modules/admin/homePageTemplates.js` — **4 hardcoded templates** (`single`, `two_thirds_one_third`, `two_equal`, `three_equal`). Regions/flex fixed in code.
- **DB:** `home_pages` (`hp_template`, `hp_role_id`, `hp_module_id`, `hp_is_default`), `home_page_components` (`hpc_region`, `hpc_type`, `hpc_source_id`, `hpc_config`, `hpc_sort_order`).
- **Pain:** only 4 fixed templates (no custom regions / adjustable proportions); component config is mostly just a source-ID picker + title; primitive drag; no cross-region move; `rich_text` likely not wired; no mobile variant.

### 3c. Reports
- **Builder:** `src/modules/ReportBuilder.jsx` (~1,317 lines) — Salesforce-style 40/60 split with tabs (Fields, Filters, Groupings, Calculated Fields, Settings) and a related-object field tree (3 levels). **But field selection is button-based, not drag**, and **preview only updates after save.**
- **Runner:** `src/modules/ReportRunner.jsx` (~882 lines) — tabular / summary (subtotals) / matrix (pivot); CSV/Excel/PDF export. **Reuse.**
- **Service:** `src/data/reportsService.js` (~1,840 lines) — the engine. FK label resolution, picklist resolution, cross-filters, runtime prompts, `report_aggregate` RPC.
- **Calculated fields:** exist (`report_calculated_fields`, row + summary scope, text-formula expressions via `lib/reportFormulaEval`). Aggregations limited to count/sum/avg/min/max.
- **DB:** `reports`, `report_filters` (incl. cross-filters, runtime prompts), `report_groupings`, `report_calculated_fields`.
- **Pain:** no visual/drag field selection; formula fields are raw text (no builder/autocomplete); no distinct-count/percentile; matrix limited to one measure; no derived grouping (e.g. "month of date"); `format_options` stored but ignored by the runner; preview not live.

### 3d. Record page layouts
- **Editor:** `src/modules/admin/LayoutEditor.jsx` (~1,616 lines) + `src/modules/admin/LayoutCanvas.jsx` — **the most advanced builder today**: a real WYSIWYG canvas where `field_group` widgets show fields as draggable tiles, with a sticky unplaced-field palette. Uses native HTML5 drag with a custom MIME type `application/x-leap-canvas` and payload kinds (`palette`/`field`/`section`). Optimistic updates.
- **Widget types:** `field_group` (the only canvas-editable one), `related_list`, `conversation_panel`, `file_gallery`, `report`, `status_path`, `partition_history` (these render as placeholder tiles; still edited via modal).
- **DB:** `page_layouts`, `page_layout_sections` (`section_order`, `section_columns`, collapsibility), `page_layout_widgets` (`widget_type`, `widget_position`, `widget_size`, `widget_config` jsonb with a `fields` array).
- **Pain:** only `field_group` is canvas-editable (others = modal); no sub-grouping inside a field_group; no touch support; optimistic-only (stale on write failure); no field-set presets.

> **Key insight:** `LayoutCanvas.jsx` already proves the team can build a real WYSIWYG canvas. Its patterns (palette → canvas drop, tile drag, optimistic persist) are the seed for the unified engine — but it's hand-rolled HTML5 DnD that won't scale to free grid positioning + resize + touch.

### 3e. Admin surface
- `src/modules/admin/SetupHome.jsx` + `setupTree.js` — Salesforce-style two-pane Setup. Builders are **hardcoded** in the tree + a `NodeContent` switch (no registry/plugin system). Page layouts & home pages live under "User Interface"; Reports/Dashboards are in main app nav.

---

## 4. Target architecture (the unifying idea)

Today: 4 builders, 4 hand-rolled DnD implementations, 4 config models. Target: **one canvas engine + one component registry**, specialized per surface.

### 4a. A single "LEAP Canvas" engine
A reusable component that renders the three-pane editor (palette / live canvas / inspector) and emits a layout. Each surface configures it with:
- which **component registry** entries are allowed,
- the **data binding** model (dashboards/home bind to reports; page layouts bind to record fields),
- the **persistence adapter** (which tables to write).

### 4b. A component registry (single source of truth)
One declarative registry describing every widget/component:
```
{ id, label, icon, category, defaultSize {w,h}, minSize, maxSize,
  dataSource: 'report' | 'object-field' | 'none',
  configSchema,            // drives the Inspector form automatically
  Renderer,                // the live component (reuse DashboardRunner widget renderers)
  Inspector }              // optional custom inspector; else generated from configSchema
```
Both the **palette** (left) and the **inspector** (right) are generated from this registry. Adding a new widget = one registry entry, not edits across a builder + runner + switch statement. This is the central lever for "more widgets than Salesforce."

### 4c. Geometry model
Move from `row/col + array order` to explicit grid geometry per widget: `{ x, y, w, h }` in grid units, with responsive breakpoint overrides. `dashboards.dash_layout` (jsonb, currently unused) and `dashboard_widgets.dw_width/dw_height` are already there to hold this. Page layouts get the same treatment so field_groups and other widgets share one geometry contract.

### 4d. Reuse the runtime
`DashboardRunner`'s widget renderers, `ReportRunner`, and `reportsService` are healthy. The rearchitecture is **builders + a shared canvas + a registry**, reusing the runners. Don't rewrite the engine.

---

## 5. Technical recommendations

- **Grid canvas (dashboards, home pages):** adopt **`react-grid-layout`** — free positioning, resize handles, responsive breakpoints, and external drag-in from a palette (`isDroppable` + `onDrop`). This is the closest off-the-shelf match to Salesforce's dashboard/App-Builder canvas and saves enormous effort.
- **Palette / sortable tiles / nested (reports fields, page-layout sections):** adopt **`dnd-kit`** — modern, touch + keyboard accessible, great for sortable lists and nested structures.
- **Possible unification:** we *could* standardize on `dnd-kit` everywhere with a custom grid, but `react-grid-layout` is worth the second dependency for the grid surfaces. Decide in Phase 0.
- **⚠️ Vite hazard (from CLAUDE.md):** new shared deps can trigger circular vendor-chunk TDZ errors. Add these deps in isolation, lazy-load the heavy builder bundles, and run `npm run build:safe` + smoke-load before relying on anything. Never bare `npm run build`.
- **Schema-validated configs:** give each widget type a config schema (the registry's `configSchema`); validate on save (extend the existing `trg_validate_dashboard_widget_config` trigger pattern). Kills the "flat unvalidated jsonb" problem.
- **Live preview:** the canvas IS the preview. For reports specifically, drive the preview off the in-editor (unsaved) config instead of the persisted record (current `ReportBuilder` previews only after save).
- **Mobile/responsive:** bake breakpoint layouts into the geometry model from day one (react-grid-layout supports this natively) rather than retrofitting.

---

## 6. Proposed phased build plan

> Recommended order. Rationale: home pages embed dashboards, dashboards embed reports — so build the shared canvas against **Dashboards first** (it also kills the worst Edit screen), then reuse it upward.

- **Phase 0 — Foundation.** Pick DnD/grid libs (recommend `react-grid-layout` + `dnd-kit`), add them safely (build:safe), build the **LEAP Canvas** shell (palette / canvas / inspector) and the **component registry** scaffolding. Migrate geometry to `{x,y,w,h}` (use `dash_layout` / `dw_*`). No behavior change to runners.
- **Phase 1 — Dashboards.** Replace `DashboardEditor` with the canvas. Port the 8 existing widget types into registry entries reusing `DashboardRunner`'s renderers. Inspector: report picker, measure/group-by, filters, gauge ranges, conditional formatting. **This is the headline win.**
- **Phase 2 — Home pages.** Replace fixed templates with a flexible canvas (custom regions / adjustable columns). Reuse the registry; add component types beyond Salesforce.
- **Phase 3 — Reports.** Drag-based field selection, live preview, visual formula builder (autocomplete over fields/functions), more aggregations (distinct count, percentile), derived groupings, field-level formatting in the runner.
- **Phase 4 — Record page layouts.** Fold `LayoutCanvas` into the unified engine; make all widget types (not just `field_group`) canvas-configurable; field-set presets; touch support.
- **Cross-cutting:** a **builder registry** in Setup so new builders/components are additive (no core switch edits); version history/audit for builder edits.

Each phase ships independently and is additive (per CLAUDE.md: never break existing functionality). Help articles required per user-facing feature, same session.

---

## 7. Widget / component library — FULL CATALOG (decided: build all)

**Decision (Nicholas, 2026-06-29): ship the full widget library — every widget we can think of.** Robust, modern, first-class. Each is one **registry entry** (§4b); build them as the registry matures (Phase 1 covers the chart/metric/table core; richer ones follow but all are in scope). Organized as a build checklist:

**Metrics & KPIs**
- Single metric / big number; KPI with target & % attainment; scorecard with period-over-period comparison + delta + sparkline; multi-stat strip (several KPIs in one tile); ratio/conversion metric.

**Charts**
- Bar (vertical/horizontal), stacked bar, 100%-stacked bar, grouped/clustered bar; line, multi-series line, area, stacked area; combo (bar + line, dual-axis); pie, donut (with center metric); scatter, bubble; histogram; box-and-whisker; waterfall; radar/spider; funnel; pyramid; pareto; candlestick/range (where relevant); sparkline (inline).

**Tables & lists**
- Tabular table; pivot/matrix (multi-measure); "lightning table" with inline **conditional formatting** (color scales, data bars, icon sets); ranked list / leaderboard; list-view embed with quick filters; grouped/summary table with subtotals; editable grid (inline edit back to records).

**Distribution & relationship**
- Heatmap; correlation matrix; tree map; sunburst; sankey/flow; network/graph; chord.

**Time & process**
- Timeline; Gantt / project schedule; calendar / agenda; activity feed; cohort / retention grid; trend-over-time with forecast band.

**Goal & progress**
- Gauge (radial, with min/mid/max thresholds); linear progress / bullet chart; goal tracker; progress ring; status path / pipeline stages.

**Geospatial**
- Map with pins / clustering (reuse Leaflet — see `OutreachMap.jsx`); choropleth / region heat map; territory map.

**Content & layout**
- Rich text / markdown; heading/divider/spacer; image / logo; video; iframe / external embed; button / quick-action; link list; tabs / accordion container; section/column container (nested layout).

**Record & operational (esp. home pages & record page layouts)**
- Record detail mini-card; field group; related list; recent records; task list / my tasks; approvals queue; chatter/conversation panel; file gallery; notes; report chart embed; dashboard embed.

**Advanced / analytical**
- Pivot with drill-down; comparison (this period vs last, vs target, vs cohort); anomaly/outlier highlight; what-if / parameterized metric (driven by a dashboard control); custom-formula metric (powered by the §8 engine).

If something useful isn't listed, it's still in scope — the registry makes adding one cheap. Treat this as the starting build checklist, not a ceiling.

---

## 8. Calculated / formula fields — FULL ENGINE (decided)

**Decision (Nicholas, 2026-06-29): build the full formula engine now.** Salesforce/Excel-grade, with an **open-source expression editor**. No phased "summary-formula first." This is a first-class subsystem, not a band-aid. Current state to replace: report-level text-formula fields evaluated in `lib/reportFormulaEval` with a limited function set and no editor UI.

### Scope (true Salesforce + Excel parity)
- Full **function library**: math, logical (`IF`/`CASE`/`AND`/`OR`/nested), text, date/time, statistical, lookup, conversion — Excel-function breadth plus Salesforce operators.
- **Cross-field references** (incl. related-object fields via the existing `via_path` mechanism), **row scope** and **summary/group scope**, a **type system** (number, currency, percent, date, datetime, text, boolean) with type checking and field-level formatting actually applied in the runner (today `format_options` is stored but ignored — fix that).
- **Visual editor UX** like Salesforce's formula editor: insert-field picker, categorized insert-function picker with descriptions/signatures, **autocomplete + syntax highlighting**, **live validation/type errors**, and a "Check syntax" affordance.
- Calculated fields usable as **report columns/groupings AND as widget measures** (so a dashboard KPI can be a formula). This is why the engine is a **foundation piece** (build in Phase 0), not buried in the Reports phase.

### Recommended open-source libraries (all permissive — safe for a proprietary platform)
- **Editor:** **CodeMirror 6** (MIT) — embeddable, custom language + autocomplete API, syntax highlighting. (Monaco/MIT is the heavier alternative; CM6 is the right weight for an in-app formula bar.)
- **Engine / function library:** **mathjs** (Apache-2.0) for the parser + math/logic/units + custom-function registration, complemented by **@formulajs/formulajs** (MIT) for Excel-function parity (SUM, IF, VLOOKUP-style, TEXT, DATE families, etc.). A thin LEAP resolver maps field tokens → row/group values and enforces the type system.
- **Parsing primitive (if we want our own AST):** **jsep** (MIT).
- **⚠️ Avoid HyperFormula** for the engine — it's powerful and Excel-compatible but **GPLv3-or-commercial**; using it in a proprietary app means buying a commercial license. Default to mathjs + formulajs unless Nicholas wants to license HyperFormula.
- Same Vite-hazard caution as §5: add deps in isolation, lazy-load, `build:safe` before relying on them.

### Architecture notes
- Persist formulas as text expressions (as today) but compile to an AST once and cache; evaluate row-scope per detail row and summary-scope per group + grand total (mirrors current `evaluateRowExpression` / `evaluateSummaryExpression` split).
- Sandbox evaluation (no arbitrary JS — only the whitelisted function library) for safety.
- Keep `report_calculated_fields` as the store; extend with whatever the type system needs.

---

## 9. Decisions

**ALL DECIDED (Nicholas, 2026-06-29) — spec is complete; next session executes.**
- **#1 Build order** — **Dashboards first** (creates the shared canvas + kills the worst Edit screen), then Home → Reports → Page Layouts.
- **#2 Libraries — APPROVED:** `react-grid-layout` (grid canvas + resize + palette drag-in) + `dnd-kit` (sortable/nested) + CodeMirror 6 + mathjs + @formulajs/formulajs (formula engine). Add per §5/§8, observing the Vite-hazard caution (add in isolation, lazy-load, `build:safe`).
- **#3 Calculated fields — FULL engine now** (Salesforce/Excel-grade, OSS editor). See §8.
- **#4 Widgets — FULL catalog** (every widget; build them all). See §7.
- **#5 Unified, greenfield** — one canvas engine + registry for all surfaces. The current builders are *unusable*, so **do not preserve them** — replace the builder UIs wholesale. (Preserve only the **data** + **runtime**: existing dashboards/reports/home pages — DSH-00009/10, RPT-00036/37, HP-00005/6 — must keep rendering via the reused runners; this is the one "additive, don't break" constraint that still applies.)

---

## 10. Optional resources that would sharpen the spec (none are blockers)

- A few **screenshots of the exact Salesforce screens** to mirror (Dashboard component editor, Lightning App Builder, Lightning Report Builder, Dynamic Forms) — removes pixel-level ambiguity.
- A current-Salesforce **builder-UX research pass** (Lightning App Builder, Dashboard editor, Report Builder summary formulas, Dynamic Forms) — can be done in-session to mirror live behavior rather than from memory.
- Nicholas's **widget wishlist** and **calc-field ceiling** (§7, §8).

---

## 11. Files the next session will touch most

| Concern | Files |
|---|---|
| Dashboard builder (replace) | `src/modules/DashboardEditor.jsx` |
| Dashboard runtime (reuse) | `src/modules/DashboardRunner.jsx` |
| Home builder / viewer | `src/modules/admin/HomePageBuilder.jsx`, `src/components/ConfiguredHome.jsx`, `src/modules/admin/HomeComponentRenderer.jsx`, `src/modules/admin/homePageTemplates.js` |
| Report builder / runtime | `src/modules/ReportBuilder.jsx`, `src/modules/ReportRunner.jsx`, `src/data/reportsService.js`, `src/lib/reportFormulaEval*` |
| Page layout builder | `src/modules/admin/LayoutEditor.jsx`, `src/modules/admin/LayoutCanvas.jsx`, `src/data/pageLayoutBuilderService.js` |
| Setup surfacing | `src/modules/admin/SetupHome.jsx`, `src/modules/admin/setupTree.js` |
| New (to create) | shared LEAP Canvas engine + component registry |

DB tables in scope: `dashboards`, `dashboard_widgets`, `dashboard_filters`, `home_pages`, `home_page_components`, `reports`, `report_filters`, `report_groupings`, `report_calculated_fields`, `page_layouts`, `page_layout_sections`, `page_layout_widgets`.
