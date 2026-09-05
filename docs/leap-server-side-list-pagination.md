# Server-side list pagination

**Status:** database engine shipped and proven on production (PR #826 and this change). Client not yet wired — nothing calls the engine, deliberately.

**Why this exists:** Nicholas, 2026-09-05, after the Properties list timeout was fixed: *"We need this to work. You keep putting band-aids on."*

---

## 1. Vision

A list asks the database for the page it is showing. Filtering, searching, sorting and counting happen in SQL. The browser holds one page, not the object.

Today every list downloads its whole object. Paging by primary key (PR #817) made that **linear** instead of quadratic — 612 ms per page became 16 ms, and the timeouts stopped — but it did not change *what* is read. Linear still grows: 16,665 properties is ~17 round trips, and the shape does not survive another order of magnitude.

---

## 2. What just shipped

Three functions, all `SECURITY INVOKER` so RLS and the geographic state scope still decide what is visible, all with `anon` revoked, all adding **zero** advisor lints.

| Function | Answers |
|---|---|
| `list_column_display(object, column)` | What a column is filtered and sorted **on**: the label a reader sees, not the uuid stored. Returns the LEFT JOIN, the display expression, the native-typed expression, and the kind. Returns no row for an unknown column, which is how callers refuse. |
| `list_object_page(object, columns, filters, filter_logic, search, search_columns, sort_field, sort_dir, limit, offset)` | One page: filtered, searched, sorted, counted. |
| `list_object_column_options(object, column, limit)` | The distinct values a filter dropdown should offer, over the whole object, as labels. Reports `capped` honestly. |
| `list_soft_delete_column(object)` | The soft-delete column, from `pg_catalog`. Asserted equal to `ees_table_metadata` on every table. |

### Measured on production

| | before | after |
|---|---|---|
| Properties page (100 rows, sorted, counted) | 290 ms | **55 ms** |
| vs. the current full load | 17 requests, 16,665 rows, ~1,000 ms | 1 request, 100 rows |

Two findings that produced most of that, both measured rather than guessed:

1. **Sorting on a cast defeats the index.** `display_expr` casts text columns with `::text`; an index does not match the cast expression, so the planner sorted all 16,665 rows to return 100. `ORDER BY t.property_name::text` = 286 ms; `ORDER BY t.property_name` = **5.6 ms**.
2. **`information_schema` was 89% of the call.** Its constraint views are standard views over `pg_catalog` with wide joins and no useful indexes. Resolving **one** column cost 205 ms. `pg_catalog` is under a millisecond.

### Verified behaviour

Run as a real signed-in Admin under RLS: total 16,665 and NC 3,912 both matching independent counts; `1 OR 2` across two states = 6,295 matching `in (NC,WI)`; sorted by name the first two rows are the same two the list shows today; sort by a picklist **label** works on a uuid column; refusals by name for a dotted field, an unknown operator, a logic expression containing `DROP`, an out-of-range filter index and a semicolon payload; a caller with no resolvable identity sees 0 rows.

---

## 3. The design decision that matters

**The engine refuses what it cannot serve faithfully.**

A partial engine that silently drops a filter it does not understand returns the wrong rows and looks fine. That is worse than the load it replaces. Every filter, sort and search term is checked before any SQL is built; anything not expressible returns `{"supported": false, "reason": …}` and **the caller falls back to the existing client-side path**.

This is what makes incremental rollout safe. A list is either fully served by the database or fully served the old way. Never half.

**Relative dates stay in the browser.** `TODAY`, `LAST_N_DAYS` and the other 21 literals in `src/lib/reportFilters.js` resolve against the *reader's* midnight. Re-implementing them in SQL would be a second definition that disagrees whenever the server and reader are in different timezones. The caller resolves them to absolute bounds and sends timestamps.

---

## 4. Current-state map: what depends on having every row

Mapped from `src/components/ListView.jsx` (4,211 lines). **This is the real scope of the client work** — none of it is optional, because each one silently starts lying rather than erroring when `data` is one page.

| # | Dependency | Where | Server answer |
|---|---|---|---|
| 1 | **Filter dropdown values**, and the text-vs-checklist decision | `deriveColumnOptions`, `objectListService.js:583`; consumed `ListView.jsx:378`, `:2057` | `list_object_column_options` — **shipped** |
| 2 | **"Showing X of Y"**, "Show all N" | `ListView.jsx:3512`, `:3528` | `total` from `list_object_page` — **shipped** |
| 3 | **Select all → bulk edit/delete/clone** | `toggleAllVisible(filtered)`, `:2528`, `:3350` | needs a "select all matching" contract; the RPCs take an explicit uuid list |
| 4 | **Filter diagnostics** ("matches 0 of 6,781") | `:2743-2766` | per-filter counts, or drop the feature under paging |
| 5 | **`fieldsWithNoData`** column markers | `:2709` | already sampled at 500 rows; can stay approximate, but must say so |
| 6 | **Sort semantics** | `listOrder.js:37` | text-compare for *every* type today; SQL sorts numbers and dates natively. **Visible change: 10 now follows 9.** |
| 7 | **Optimistic overlay** for inline cell edits | `:2275`, cleared on `[data]` at `:2311` | page navigation changes `data`, so the overlay is lost; needs keying by row id |
| 8 | **`renderLimit`** "Load 500 more" / "Show all" | `:2769-2774`, `:3504` | becomes page navigation; mobile has **no** load-more control at all today |
| 9 | **Related-field refetch handshake** | `onActiveRelatedFieldsChange` `:2216` ↔ `ObjectListSection.jsx:156` | must become page-scoped |

Two further notes from the map:

- `matchFilter` lives **inside** `ListView.jsx:270-334`, not in a lib. There is no `src/lib/listFilterMatching`. Filter semantics are split across `ListView.jsx`, `listFilterLogic.js`, `reportFilters.js` and `listFilterDates.js`.
- Row shaping (`id`, `_id`, `name`, `<col>__label`, `<fk>__rel__<col>`) happens in `fetchObjectRecords` after the fetch, `objectListService.js:920-961`. **The page path should reuse it, not reimplement it** — extract it as `shapeObjectRows()` and have both callers use it.

---

## 5. Phased build plan

Each phase is independently shippable and additive.

**Phase 1 — engine.** ✅ Shipped. The three functions above.

**Phase 2 — service layer.** `fetchObjectPage(table, {filters, filterLogic, search, sortField, sortDir, limit, offset, activeFields})` in `objectListService.js`. Calls `list_object_page`; on `supported: false`, **falls back to `fetchObjectRecords`** and logs the reason. Extract `shapeObjectRows()` first so labels and related fields resolve identically on 100 rows as on 16,665. Fixture: the fallback fires on a dotted-field filter, and a page's shaped rows are byte-identical to the same rows from the full path.

**Phase 3 — dropdowns.** Point `deriveColumnOptions` at `list_object_column_options` when the list is server-paged. Honour `capped` by offering a text filter instead of a silently-truncated checklist.

**Phase 4 — ListView paging.** Server total, page navigation replacing "Load 500 more", mobile paging (it has none today), overlay keyed by row id. Behind a per-object switch.

**Phase 5 — select-all-matching.** A contract for bulk operations over a filter rather than an id list. This is a **product decision**: does "select all" mean the page or every match? Salesforce means every match, and says so.

**Phase 6 — roll out.** Properties and accounts first. They are the only large user-facing lists: everything else above 1,000 rows is an internal table with no list view (`text_case_normalization_log` 45k, `audit_log` 12k, `page_layout_widgets` 5.6k).

---

## 6. Decisions

1. **Refuse rather than approximate.** — **DECIDED** 2026-09-05. Implemented.
2. **Relative dates resolve in the browser.** — **DECIDED** 2026-09-05. Implemented.
3. **Numbers and dates sort natively, not as text.** — **DECIDED** 2026-09-05, as a correction. It is visible: 10 follows 9. Recorded in the migration.
4. **Roll out per object, not platform-wide.** — **DECIDED** 2026-09-05. `ListView` renders in 22 places; switching all at once is how a list ends up half-migrated.
5. **Does "select all" mean the page or every match?** — **OPEN.** Salesforce means every match. Needs Nicholas.
6. **Keep or drop filter diagnostics under paging?** — **OPEN.** It exists to explain why a list emptied, which is *more* valuable under paging, but costs a per-filter count query.
7. **Compute tier.** — **OPEN, but measure first.** After Phase 4 the database does far less work per list load. Micro is expected to be fine; take the number before spending.

---

## 7. File and table index

| Path | Role |
|---|---|
| `supabase/migrations/20260905180526_a_list_asks_the_database_for_one_page.sql` | the engine |
| `…180727_a_list_page_sorts_on_the_column_not_a_cast_of_it.sql` | the index-usable sort |
| `…180839_the_list_page_reads_the_catalog_directly_not_information_schema.sql` | 290 ms → 55 ms |
| `…181638_a_filter_dropdown_asks_the_database_what_the_values_are.sql` | dropdown options |
| `src/data/objectListService.js` | `fetchObjectRecords` (full load), `deriveColumnOptions`, row shaping |
| `src/components/ListView.jsx` | all nine dependencies above |
| `src/components/ObjectListSection.jsx` | the fetch caller; where a per-object switch goes |
| `src/lib/listOrder.js` | the one text comparator, shared with the loaders |
| `src/lib/listFilterLogic.js`, `reportFilters.js`, `listFilterDates.js` | filter grammar and date literals |
| `src/lib/supabase.js` | `fetchAllKeyset`, the current full-load path |
