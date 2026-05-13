# EES Platform — Task List

Live task list. Updated as each commit lands. **Maintained by Claude** as part
of every working session — every completed step gets reflected here before
the next one starts.

## Format

- `[x]` = done and committed (commit hash in trailing parens)
- `[~]` = in progress (uncommitted changes on disk)
- `[ ]` = not started
- `[blocked]` = blocked on external dependency

**Self-referential hashes:** A commit can't know its own hash in advance, so
when a TASKS.md update lands in the same commit as the work it describes,
the entry uses `(this commit)` as a placeholder. A follow-up chore commit
runs `git log -1 --format=%H` and substitutes the real hash. Twice now this
has become two commits per change — that's the cost, accept it. The
alternative (separate chore commit *before* the work) leaves a dangling
"in progress" entry, which is worse.

## Active backlog

### Reports module — dispatcher feature parity
- [ ] **PDF attachments in scheduled-report dispatcher** — session-sized, needs page-layout work for rendering tabular/summary/matrix reports to PDF. Today the dispatcher throws explicitly when `sr_format='pdf'`.
- [~] **Dispatcher runner up to feature parity with in-app runner** — multi-hop via_path done (commit `8034885`; dispatcher v6 deployed). Custom filter logic done (commit `9f69b48`; dispatcher v7 deployed). Related-field filters/sorts done (commit `6857310`; dispatcher v8 deployed). Cross-filters done (commit `05f582f`; dispatcher v9 deployed). Calculated fields done (this commit; dispatcher v10 deployed — row-scope only, summary calc fields skipped with a warning since the dispatcher only outputs flat tabular data). **PARENT TASK CLOSED on next commit.** Full parity achieved with the in-app runner's tabular path.

### Permissions & RLS
- [blocked] **Layered RLS sweep using `app_user_in_scope`** — deferred until first portal user invited. Today all authenticated internal users see all rows on business tables via `authenticated_write_sweep_all_business_tables`.

### Project Report Generator
- [blocked] **PRG Phase 3 — documents FK columns** — `documents.project_report_template_id` + `documents.project_report_template_snapshot_id` FK columns reverted earlier. Needs Supabase CLI redeploy of the 86KB `generate-project-report` Edge Function (MCP can't redeploy at that size).
- [x] **PRG merge field substitution for `custom_text` sections** — already implemented in `generate-project-report/index.ts` at `substituteMergeFields()`. `{{path.to.field}}` syntax resolved via `resolveMergeField` against the expanded RenderCtx. Unknown placeholders render inline as `[unknown: {{path}}]` for author visibility.

### Recycle Bin
- [x] **Phase 1 — view + restore** (commit `293e435` + `4ff648a` for field-history)
- [x] **Phase 2 — permanent purge with admin gate** (commit `718c37d`)
- [x] **Cross-table search: 'All Tables' mode** — `fetchDeletedRecordsAcrossTables` fans out across the curated 29-table list in parallel (per-table cap 50), merges + sorts by deletedAt desc. UI gets a new "— All tables —" option in the dropdown that toggles a wider column set with the Object column, and surfaces a small object-name badge in the Quick Restore footer row. Per-row restore/purge dispatches to the row's own `_table`.
- [ ] **Cascade rule per spec: parent restore restores children together** — investigated this session. Current schema has zero FK CASCADE on delete (everything is NO ACTION), and there's no batch-id tracking. Implementing properly needs either (a) walking parent-child topology in a SECURITY DEFINER function with depth limits, or (b) adding `deletion_batch_id` column on every soft-deletable table. Both are sizeable. Deferring until soft-delete cascade pain is real \u2014 today most soft-deletes are smoke-test artifacts; production usage may not need this.

### Audit + field history
- [x] Audit triggers on Reports + Permission Builder tables (commit `f9fb5ab`)
- [x] Audit triggers on permission/scope/portal tables (commit `b0f0f5d`)
- [x] Audit triggers on PRT family (commit `5dc957c`)
- [x] Audit triggers on envelope family (commit `05a903b`)
- [x] Field-history registrations for permission/scope/portal columns (commit `4ff648a`)
- [x] Field-history registrations for PRT + envelope columns (commit `0f6e53c`)
- [x] **Audit triggers on folder + folder-share + help tables** (commit `c4da7be` — 9 tables: report_folders, dashboard_folders, four folder-share junctions, help_articles, help_article_anchors, object_chat_enabled). Final pass; every remaining unaudited table is skip-by-design (audit streams, snapshots, transient OAuth, unbuilt modules).
- [x] AuditLogPane with object/record/action filters (commit `52b453d`)

### Save As / Clone parity
- [x] `clone_report` + ReportBuilder Save As button (prior session)
- [x] `clone_dashboard` + DashboardEditor Save As button (commit `b2549fc`)
- [x] `clone_scheduled_report` + ScheduleEditor Save As button (commit `41d3c0a`)
- [x] `clone_permission_set` + PermissionSetEditor Clone button (commit `a64932b`)

### Setup home
- [x] Health-summary strip + clickable Most Visited cards (commit `fbb199f`)
- [x] **`admin_health_summary` recycle-bin total undercounts** (commit `8af706f`) — RPC was summing across 20 tables but the bin dropdown shows 29; aligned the UNION ALL to all 29. Smoke-tested: total = 14.

### Dispatcher (scheduled reports)
- [x] CSV attachments (prior session)
- [x] XLSX attachments via SheetJS (commit `4b9cb5b`)
- [x] `validateReport()` fail-loud + soft-warning paths (prior session)
- [ ] PDF attachments (see "Reports module — dispatcher feature parity" above)

## Major unbuilt (each is a multi-session commitment)

- [ ] **Templates Builder dedicated module** — today document/email templates are managed inside record-detail views; Salesforce parity wants a dedicated module
- [ ] **Lifecycle Builder** — define per-object status transitions, automation triggers, ownership rules
- [ ] **Automation Builder** — Salesforce Flow Builder equivalent (record-change triggers, scheduled actions, multi-step flows)
- [ ] **EES AI assistant** — Claude-API-backed in-app assistant per `anura-ai-spec.md`
- [ ] **E-signature workflow polish** — schema exists (envelopes/recipients/tabs), workflow needs front-end completion
- [ ] **Portal subdomain deployments** — `owner.ees-ops.netlify.app`, `partner.ees-ops.netlify.app`, etc.
- [ ] **Field Mobile PWA** — purpose-built mobile per `anura-field-mobile.md`
- [ ] **Azure AD / LEAP integration** — app pending Nicholas's manual setup at entra.microsoft.com

## Completed (chronological, most recent first)

- `(this commit)` dispatcher v10 — row-scope calculated field support (full port of `evaluateRowExpression` from `src/lib/reportFormulaEval.js`: tokenizer + recursive-descent parser + AST evaluator + Salesforce-flavored function library). Closes the entire "Dispatcher runner feature parity with in-app runner" backlog item.
- `542bc82` chore: backfill TASKS.md commit hash for 05f582f
- `05f582f` dispatcher v9 — cross-filter support (pre-query Set<uuid> via discover-link-FK + sub-filters; with/without filter on primary rows)
- `11151ab` chore: backfill TASKS.md commit hash for 6857310
- `6857310` dispatcher v8 — related-field filters/sorts support (one-hop via PostgREST `fk.field` syntax in fast path; multi-hop via slow-path fetch-then-filter + client-side comparator)
- `2afad5b` chore: backfill TASKS.md commit hash for 9f69b48
- `9f69b48` dispatcher v7 — custom filter logic support (slow-path: fetch then evaluate in-memory via ported applyFilterLogic + evalFilterOnRow)
- `8034885` dispatcher v6 — multi-hop via_path support (recursive embed tree, chain-walk in CSV/XLSX builders, validateReport no longer warns on multi-hop)
- `8af706f` admin_health_summary recycle-bin total aligned with the 29-table dropdown
- `6b4d0d2` chore: backfill TASKS.md commit hash for ea766b0
- `ea766b0` Recycle Bin cross-table 'All tables' mode + `fetchDeletedRecordsAcrossTables` helper
- `39632a3` chore: backfill TASKS.md commit hash for c4da7be
- `c4da7be` audit triggers on folder + folder-share + help tables (9 tables) — closes the unaudited-tables scan; remaining gaps are skip-by-design
- `eb07ab6` add TASKS.md — live working task list
- `0f6e53c` field-history tracking on PRT + envelope columns (27 columns / 6 tables)
- `05a903b` audit triggers on envelope family (3 tables)
- `fbb199f` Setup Home health strip + clickable Most Visited cards
- `5dc957c` audit triggers on PRT family (4 tables)
- `718c37d` Recycle Bin Phase 2 — permanent purge with admin gate
- `4ff648a` field-history tracking on permission/scope/portal columns (18 columns / 6 tables)
- `293e435` Recycle Bin Phase 1 — view + restore
- `52b453d` AuditLogPane with object/record/action filters
- `1339bbf` fetchAuditLog filter params + performer name resolution
- `b0f0f5d` audit triggers on permission/scope/portal tables (6 tables)
- `a64932b` clone_permission_set + Clone button
- `41d3c0a` clone_scheduled_report + Save As button
- `b2549fc` clone_dashboard + Save As button
- `f9fb5ab` audit triggers on Reports + Permission Builder tables (11 tables)
- `4b9cb5b` XLSX attachment support in dispatcher
