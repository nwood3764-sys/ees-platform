# EES Platform — Task List

Live task list. Updated as each commit lands. **Maintained by Claude** as part
of every working session — every completed step gets reflected here before
the next one starts.

## Format

- `[x]` = done and committed (commit hash in trailing parens)
- `[~]` = in progress (uncommitted changes on disk)
- `[ ]` = not started
- `[blocked]` = blocked on external dependency

## Active backlog

### Reports module — dispatcher feature parity
- [ ] **PDF attachments in scheduled-report dispatcher** — session-sized, needs page-layout work for rendering tabular/summary/matrix reports to PDF. Today the dispatcher throws explicitly when `sr_format='pdf'`.
- [ ] **Dispatcher runner up to feature parity with in-app runner** — multi-hop via_path, cross-filters, filter logic, calc fields all degrade or fail in the dispatcher's `validateReport()` today (success_with_warnings or report_error). Bringing parity unblocks more reports being scheduled.

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
