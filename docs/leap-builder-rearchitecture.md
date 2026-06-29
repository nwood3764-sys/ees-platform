# LEAP Builder Rearchitecture — WYSIWYG Drag-and-Drop (Handoff)

**Status:** Planning / next active workstream. Nothing built yet.
**Author of handoff:** prior session (2026-06-29). Read this top-to-bottom before starting.

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

## 7. Widget / component library — seed wishlist

To be expanded with Nicholas's input ("more than Salesforce"). Starting set:
- **Existing:** metric/KPI, bar, line, pie, donut, funnel, gauge, table, ranked list.
- **Salesforce-parity adds:** stacked/grouped bar, combo (bar+line), scatter, area, pivot/matrix table, scorecard with comparison (period-over-period, % change, sparkline/trend), donut with center metric, "lightning table" with inline conditional formatting.
- **Beyond Salesforce:** map/geo widget (we already use Leaflet — see `OutreachMap.jsx`), cohort/retention grid, heatmap, timeline/Gantt, waterfall, big-number-with-target gauge, list-view embed with quick filters, rich-text/markdown, image/logo, iframe/embed, activity feed, record-detail mini-card.
- Each becomes one **registry entry** (§4b).

---

## 8. Calculated / formula fields

Biggest scope lever. Current state: report-level text-formula calculated fields (row + summary), evaluated in `lib/reportFormulaEval`, limited functions, no UI builder.

Two depths to choose between (**decision to confirm**):
- **(A) Summary-formula tier** — sum/avg/ratio/% of existing columns + simple arithmetic and conditionals. Lower effort; covers most dashboard/report needs.
- **(B) Full Salesforce-style formula engine** — function library (logical, math, text, date), cross-field references, nested conditionals, type system, with a visual builder (insert-field, insert-function, autocomplete, live validation). High effort, true parity.

Recommendation: start with (A) + a visual expression builder UI, architected so the function library can grow toward (B) without a rewrite.

---

## 9. Decisions to confirm before building (put recommendations first)

1. **Build order** — *Recommend: Dashboards first* (shared canvas + worst Edit screen), then Home → Reports → Page Layouts. Confirm or reorder.
2. **DnD/grid libraries** — *Recommend: `react-grid-layout` (grid canvas) + `dnd-kit` (palette/sortable).* OK to add both?
3. **Calculated-field depth** — *Recommend: (A) now, architected toward (B).* Confirm ceiling.
4. **Widget wishlist** — Nicholas to expand §7 with his "more than Salesforce" list (or confirm the seed set as the Phase-1/2 scope).
5. **Unify vs. keep parallel** — *Recommend: one canvas engine + registry powering all surfaces.* Confirm appetite for the refactor vs. per-surface rebuilds.

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
