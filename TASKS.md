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
runs `git log -1 --format=%H` and substitutes the real hash.

## Standing protocols

- **Documentation discipline:** every shipped feature that affects user behavior gets a help article in the same session — anchored to the relevant route, object, or concept so the in-app HelpIcon surfaces it in context. Don't go crazy; only document where users would intuitively reach for help. Required pieces per article: `ha_title`, `ha_summary` (search-friendly), `ha_body_markdown`, and at least one `help_article_anchors` row.
- **Migrations: production-only.** No Supabase dev branches. Always verify with a SELECT after `apply_migration`. Use `apply_migration` for DDL, `execute_sql` for reads.
- **Communication:** one yes/no question at a time. Make a recommendation, ask for approval. No multiple choice.

---

## Up next (open backlog)

### Foundation — start importing real data
- [ ] **Data import: property hierarchy first** — start with Property Owners → Properties → Buildings → Units (via the `accounts` and property tables), then Accounts, Contacts, then Opportunities → Projects → Work Orders. Always import a parent before its children. Format of source export TBD — needs SF CSV/JSON from Nicholas. Production data verified safe to add: schema is stable; renames/type changes/backfills are mechanical (~5 min each); no work blocked by populated tables. Destructive column drops always require a `SELECT COUNT(*)` check-in first per the safety rule.

### Permissions (continuation)
- [ ] **Field-level enforcement on the frontend** — `field_visible` and `field_editable` resolver functions exist in the DB but `RecordDetail.jsx` and widgets don't call them. Today field-level security is queryable but not enforced in the UI. Multi-session backlog item; pairs with the Permission Builder Field Permissions tab UI.
- [blocked] **Row-scoping policies for external portal users** — Property Owner, Property Manager, Subcontractor Partner roles have zero `role_object_access` rows so they're fully locked out at the object level. Activate when subcontractor portal subdomain is built — each gets scoped row-level policies via the resolver functions already in place.

### Help system & documentation
- [ ] **Help articles for remaining shipped features** — ongoing protocol per standing rule. Outstanding: Recycle Bin (restore + purge workflow), Page Layouts / Object Manager (admin editing), Reports module (build, schedule, filters, groupings, calc fields), Dashboards (widgets + folder shares), Audit Log (what's tracked, search), Field History (which fields, viewing), Document/Email Templates (merge fields, publish/lock, snapshots), E-Signature / Envelopes (send, sign, void, lifecycle). Authoring opportunistically as we touch each feature; not a single-session push.

### Recycle Bin
- [ ] **Cascade rule per spec: parent restore restores children together** — investigated previously. Current schema has zero FK CASCADE on delete (all NO ACTION), no batch-id tracking. Implementing properly needs either (a) walking parent-child topology in a SECURITY DEFINER function with depth limits, or (b) adding `deletion_batch_id` on every soft-deletable table. Both sizeable. Deferring until soft-delete cascade pain is real.

### Major unbuilt (each is a multi-session commitment)
- [ ] **Templates Builder dedicated module** — today document/email templates are managed inside record-detail views; Salesforce parity wants a dedicated module
- [ ] **Lifecycle Builder** — define per-object status transitions, automation triggers, ownership rules
- [ ] **Automation Builder** — Salesforce Flow Builder equivalent (record-change triggers, scheduled actions, multi-step flows)
- [ ] **EES AI assistant** — Claude-API-backed in-app assistant per `anura-ai-spec.md`
- [ ] **E-signature workflow polish** — schema exists (envelopes/recipients/tabs), workflow needs front-end completion
- [ ] **Portal subdomain deployments** — `owner.ees-ops.netlify.app`, `partner.ees-ops.netlify.app`, etc.
- [ ] **Field Mobile PWA** — purpose-built mobile per `anura-field-mobile.md`; includes photo compression at upload + watermarking pipeline
- [ ] **Azure AD / LEAP integration** — app pending Nicholas's manual setup at entra.microsoft.com

### Long-term cleanup (not urgent)
- [ ] **`cfp_*` tables permission policies** — two Cap Forecasting Pipeline tables still have `USING (true)` policies (isolated feature, not in main app flow). Replace with role-aware policies when CFP feature is touched again.

---

## Recently completed (this session — 2026-05-14)

- [x] **Help frontend — context-aware ? button + /help full center** (`345cc34`) — added `HelpTopbarButton` in topbar right corner (every page), opens HelpPanel with anchors derived from current page via `useCurrentPageAnchors` hook. HelpPanel upgraded with top search box, footer "Browse all help articles" link, and search-mode swap. New `HelpCenterPage` at `/help` and `/help/<slug>` — sidebar by category, search, reading pane, audience filter. `urlNav.js` routes `/help/*` outside module switch.
- [x] **HA-00013 "Finding Help — The Help Center and the Help Button"** — documents both entry points for users. Audience='all'. Anchored to module:home, help-system concepts, and /help route.
- [x] **Help articles for Project Reports** (`df6ea44`) — HA-00009/00010/00011/00012 (Generate / Authoring / Publish Workflow / Photo Variants).
- [x] **Help articles for permission sweep** (`fc625bd`) — HA-00006/00007/00008 (changelog / per-role defaults / troubleshooting runbook).
- [x] **Permission sweep — role-based RLS enforced on all business tables** (`af31b82`, migrations `20260514204537` + `20260514204558`) — seeded `role_object_access` with 65 readable tables × 9 internal roles × 4 actions matrix; dropped 51 `internal_staff_*` permissive overrides. Net: every authenticated request flows through `app_user_can()`. Admin short-circuits true; external roles fully locked out until portal ships.
- [x] **PRG Phase 3 — documents FK columns** (`13d7560`, PRG v16) — `documents.project_report_template_id` + `documents.project_report_template_snapshot_id` FK columns (both nullable, ON DELETE SET NULL), 2 partial indexes, check constraint `documents_prtsn_implies_prt_chk`. Edge fn populates both on insert. Verified live with PROJ-00001 against PRT-00001 v2.

## Completed (chronological, most recent first)

- `8c47b67` dispatcher v10 — row-scope calculated field support
- `542bc82` chore: backfill TASKS.md commit hash for 05f582f
- `05f582f` dispatcher v9 — cross-filter support
- `11151ab` chore: backfill TASKS.md commit hash for 6857310
- `6857310` dispatcher v8 — related-field filters/sorts support
- `2afad5b` chore: backfill TASKS.md commit hash for 9f69b48
- `9f69b48` dispatcher v7 — custom filter logic support
- `8034885` dispatcher v6 — multi-hop via_path support
- `8af706f` admin_health_summary recycle-bin total aligned with 29-table dropdown
- `6b4d0d2` chore: backfill TASKS.md commit hash for ea766b0
- `ea766b0` Recycle Bin cross-table 'All tables' mode
- `39632a3` chore: backfill TASKS.md commit hash for c4da7be
- `c4da7be` audit triggers on folder + folder-share + help tables (9 tables)
- `eb07ab6` add TASKS.md — live working task list
- `0f6e53c` field-history tracking on PRT + envelope columns
- `05a903b` audit triggers on envelope family (3 tables)
- `fbb199f` Setup Home health strip + clickable Most Visited cards
- `5dc957c` audit triggers on PRT family (4 tables)
- `718c37d` Recycle Bin Phase 2 — permanent purge with admin gate
- `4ff648a` field-history tracking on permission/scope/portal columns
- `293e435` Recycle Bin Phase 1 — view + restore
- `52b453d` AuditLogPane with object/record/action filters
- `1339bbf` fetchAuditLog filter params + performer name resolution
- `b0f0f5d` audit triggers on permission/scope/portal tables (6 tables)
- `a64932b` clone_permission_set + Clone button
- `41d3c0a` clone_scheduled_report + Save As button
- `b2549fc` clone_dashboard + Save As button
- `f9fb5ab` audit triggers on Reports + Permission Builder tables (11 tables)
- `4b9cb5b` XLSX attachment support in dispatcher
