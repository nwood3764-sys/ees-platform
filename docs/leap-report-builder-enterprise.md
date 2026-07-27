# LEAP Report Builder + Viewer + Dashboards — Enterprise-Class Rebuild

**Owner:** Nicholas Wood · **Started:** 2026-07-27 · **Status:** Active workstream

## 1. Vision

The Report Builder, the report viewer, and the dashboard widgets must feel enterprise-class — Salesforce parity as the floor, with the depth of Tableau and Power BI where it counts. Concretely, a user must be able to: search and filter the field list, pick and reorder columns, sort by any column (and by group aggregate), summarize columns, group and pivot (with date bucketing and subtotals), write Salesforce-style filter logic, and drop the result into dashboard widgets that filter, cross-filter, and drill — all WYSIWYG, where the live preview equals the saved run.

We stay on the **Salesforce three-format model** (Tabular / Summary / Matrix) as the mental model — it matches the rest of the platform and the team's Salesforce background — and reach Tableau/Power BI depth *within* that model. "Joined" reports, geo maps, and a DAX/LOD-class expression engine are explicitly out of baseline.

## 2. What just shipped (PR #237, open against master)

This session, on branch `claude/report-builder-filter-logic-89lvva`:

1. **Shared filter kernel** — `src/lib/reportFilters.js` (new). One source of truth for filter semantics, imported by the builder, the live preview, and the runner so they can't drift: field-kind classification, per-kind operator lists, relative date literals (TODAY / THIS·LAST·NEXT period / LAST·NEXT N …), `parseFilterLogic`/`evaluateLogic` for validated `1 AND (2 OR 3)` expressions, `remapFilterLogic` on delete, and one `evaluateOperator` shared by server-side pushdown and client-side eval. 55-assertion unit suite passing.
2. **Filters tab rebuilt** — numbered rows, searchable field picker spanning related objects, type-scoped operators, multi-value "is any of" chips, from/to ranges, fixed-or-relative date control, and a live-validated **Add Filter Logic** panel with a per-filter legend.
3. **Group-header label fix** — grouping and matrix column-grouping fields now resolve picklist/lookup labels, so "Opportunities by Stage" shows stage names in group headers, not UUIDs. (This was the original bug report.)
4. **Searchable field picker** in Available Fields — search spans the primary object + every related object one hop out (auto-loaded on first keystroke); rows show human labels; already-selected fields marked.
5. **Viewer sort + summarize** — click-to-sort + shift-click multi-sort on Tabular; per-column Summarize (Count/Sum/Avg/Min/Max) with a totals footer.

Help article HA-00146 added. **None of this is in production until #237 merges.**

## 3. Current-state architecture (code-grounded)

### File + table index

| Concern | Path |
|---|---|
| Report Builder UI (5 tabs) | `src/modules/ReportBuilder.jsx` |
| Report Runner / viewer (3 layouts + export) | `src/modules/ReportRunner.jsx` |
| Service layer (query build, run, aggregates) | `src/data/reportsService.js` |
| Filter semantics kernel | `src/lib/reportFilters.js` |
| Formula evaluation | `src/lib/reportFormulaEval` |
| Dashboard component registry (25 widgets) | `src/builder/componentRegistry.jsx` |
| Dashboard inspector/preview wiring | `src/builder/registries/dashboardRegistry.jsx` |
| Widget renderers (shared runner+builder) | `src/modules/DashboardWidgetView.jsx` |
| Dashboard runner (filter bar, grid, drill) | `src/modules/DashboardRunner.jsx` |
| Dashboard canvas editor | `src/modules/DashboardCanvasEditor.jsx` |
| Chart kit (ECharts) | `src/builder/chartKit/` |

**Tables:** `reports`, `report_filters`, `report_groupings`, `report_calculated_fields`, `report_folders` (+ role/user shares), `dashboards`, `dashboard_widgets`, `dashboard_filters`, `dashboard_folders`, `scheduled_reports`, `scheduled_report_runs`.

**Aggregate RPCs:** `report_aggregate`, `report_aggregate_2d`, `report_aggregate_time`, `report_aggregate_single` (+ `_report_agg_*` helpers) — SECURITY INVOKER, RLS-respecting, anon revoked on the newer three. `dashboard_filter_distinct_values` for filter dropdowns.

### Key facts that shape the plan

- **Two aggregation engines.** Reports aggregate **client-side** in the browser (`buildGroupTree`/`applyMeasure`/`computeAggregates`), which handles `via_path` related fields but is capped at a **50,000-row** ceiling. Dashboards aggregate **server-side** via the `report_aggregate*` RPCs, which scale and respect RLS but are **primary-object-only** (group/series/date columns must be direct columns). Unifying on server-side aggregation that also handles joins is the biggest structural decision.
- **Persisted-but-dead columns.** `report_groupings.rgr_date_granularity` and `rgr_sort_by_aggregate` are saved by `saveReport` but have **no builder UI and no runner implementation**. Date bucketing and sort-by-measure are therefore "wire it up," not "design from scratch."
- **Groupings can't reach related objects** in the builder UI (`GroupingsTab` offers only primary columns) even though the DB and runner support `via_path`.
- **`TABLE_NAME_COLUMNS` is a hardcoded allowlist** for FK label resolution in `reportsService.js`; the RPCs derive `*_name` dynamically. So report cells and dashboard labels can disagree for tables not in the list.
- **Matrix is thin** — single measure, no row/column subtotals or grand totals, cells hardcoded to `number` format, O(rows × cells) client-side.
- **Financial-tier / field-level security is not enforced in code** — blocked on the `field_permissions` build; RPCs are row-level (RLS) only.
- **Dashboard adapter deletes + reinserts widgets on save** (new UUIDs), so nothing may key off a widget's identity.

## 4. Target architecture & principles

- **One filter kernel, one aggregation path.** Filter semantics already unified (`reportFilters.js`). Next, converge report + dashboard aggregation on **server-side RPCs that accept `via_path`**, with the client-side path kept only as a fallback for small result sets. This removes the 50k ceiling and the label-disagreement bug in one move.
- **Definition-driven, nothing hardcoded.** Column order, sort, summarize, format, grouping granularity, and conditional formatting all live in the report/widget definition (jsonb), edited in the builder, rendered identically in preview and run. Matches the platform's "nothing hardcoded" rule.
- **WYSIWYG parity.** Every builder control has an immediate effect in the live preview; the viewer is the preview at full size.
- **Salesforce palette + parity.** No red/orange — conditional formatting uses blue/navy/emerald/amber. Status/stage labels always resolve. Explicit names everywhere.

## 5. Phased build plan (each phase independently shippable)

### Phase 1 — Filters & field UX  ✅ SHIPPED (PR #237)
Filter kernel, rebuilt Filters tab, filter logic, searchable field picker, group-header label fix, viewer click-to-sort + column summarize.

### Phase 2 — Groupings depth (builder + runner)
Wire up the dead columns and close the grouping gaps.
- **Date bucketing** — granularity control (Day/Week/Month/Quarter/Year, + Fiscal) per date grouping; `buildGroupTree` buckets on the truncated date, headers labelled per grain.
- **Sort groups by aggregate** — `rgr_sort_by_aggregate` UI + runner (sort group nodes by their subtotal, not just the key).
- **Related-object grouping fields** — let `GroupingsTab` pick from related objects (reuse the Filters tab's field catalog + `via_path`).
- **Automatic per-column subtotals** in Summary — a numeric column with a Summarize set shows its aggregate on every subtotal + grand total row (today only summary calc fields do).
- **Custom picklist sort order** — group keys for picklist columns follow `picklist_values` order, not alphabetical.

### Phase 3 — Group formulas (the analytical layer)
The two functions that most make a summary report feel enterprise-class:
- **% of total / % of parent** (Salesforce `PARENTGROUPVAL`) — implement as `SUM() OVER (PARTITION BY parent_group)` semantics in the summary evaluator.
- **Prior-group delta** (Salesforce `PREVGROUPVAL`) — `LAG()` over ordered peer groups, for period-over-period.
- Restricted to summary-scope formulas at a chosen grouping level, mirroring Salesforce.

### Phase 4 — Matrix & aggregation unification
- **Server-side aggregation accepting `via_path`** — extend the `report_aggregate*` RPCs (or add a joined variant) so grouping/series/date can traverse one+ FK hops; route report summary/matrix through it, drop the 50k ceiling.
- **Matrix subtotals + grand totals**, per-cell number format, and (stretch) multiple measures.
- Retire `TABLE_NAME_COLUMNS` in favor of the dynamic `*_name` derivation the RPCs already use.

### Phase 5 — Viewer polish
- **Conditional formatting** (cell/row color rules — blue/navy/emerald/amber, data-bar style) in Tabular + Summary.
- **Expand/collapse groups** in Summary/Matrix.
- **Per-column number format** (currency/percent/compact) on the report side, reusing dashboards' `formatNumber`.
- **Top-N / row-limit** filter and **filters on aggregates (HAVING)** for summary reports.

### Phase 6 — Dashboards: cascade, cross-filter, drill
- **Cascading dashboard filters** — one filter drives all compatible widgets (generalize the existing override mechanism); replace the raw text `field_name` filter authoring with a real field picker + distinct-source config.
- **Cross-filtering** — click a chart segment to filter sibling widgets on the same dashboard (biggest "modern" win).
- **Drill-through** polish — widget → source report already exists; add per-widget click-behavior config.
- **On-canvas filter/slicer widgets.**
- **True matrix/pivot widget.**

### Phase 7 — Delivery & security (later)
Scheduled subscriptions (infra exists via `dispatch-scheduled-reports`), "view as"/running-user, and financial-tier field gating — gated on the `field_permissions` build.

## 6. Decisions

- **DECIDED (2026-07-27, Nicholas):** stay on the Salesforce three-format model; reach Tableau/Power-BI depth within it. Field search spans the primary object + all related objects.
- **DECIDED:** ECharts is the dashboard chart engine (carried from `leap-dashboard-rehaul.md`).
- **RECOMMENDED, pending confirm:** unify on server-side aggregation with `via_path` support (Phase 4) rather than raising the client-side row ceiling. Removes the 50k cap and the report-vs-dashboard label disagreement.
- **RECOMMENDED:** build Phases 2–3 next (grouping depth + group formulas) — highest ratio of "feels enterprise" to effort, and mostly wiring up columns that already exist.

## 7. Technical hazards

- **Vite vendor-chunk trap** — named imports Vite can't resolve are silently `undefined`; always `npm run build:safe`, never bare `build`.
- **Dashboard adapter reinserts widgets** — don't key anything off widget UUID.
- **`report_filters` is authoritative** for active filters (not the inline `rpt_runtime_prompts` JSON) — query with `is_deleted IS NOT TRUE`.
- **RPC re-grant dance** — after any DROP/CREATE of a function, re-issue REVOKE/GRANT + `NOTIFY pgrst`.
- Advisor baseline ~205; only new lints beyond that set need action.

## 8. File + table index for the next session

Touch most: `src/modules/ReportBuilder.jsx` (GroupingsTab, CalcFieldsTab), `src/modules/ReportRunner.jsx` (SummaryLayout, MatrixLayout, buildGroupTree), `src/data/reportsService.js` (runReportDefinition, the aggregate RPCs + `buildFKLookup`), `src/lib/reportFilters.js`, `src/builder/componentRegistry.jsx`, `src/modules/DashboardRunner.jsx`. DB: `report_groupings` (dead columns), the `report_aggregate*` RPCs, `dashboard_filters`.
