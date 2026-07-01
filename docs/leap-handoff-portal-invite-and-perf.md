# Handoff — Portal invite automation, list-view performance, portal width (2026-07-01)

Written at the end of a long session (branch `claude/portal-stage-bar-data-driven-dmuppm`).
A fresh session should read this top-to-bottom before touching the portal, list views, or the
Add-to-Portal flow. Everything below is live unless marked otherwise.

---

## 0. Environment facts a new session MUST know first

- **Two sites, two branches, two databases — do not confuse them:**
  | Surface | Netlify site | Branch | Supabase project |
  |---|---|---|---|
  | Production | `ees-ops` (id `a278d7b7-9122-4426-b8f9-8f1ec10b679f`) | `master` | prod `flyjigrijjjtcsvpgzvk` |
  | Staging | `ees-platform-staging` (id `37e013b6-926c-4d18-9018-87d3f071c0e1`) | `staging` | staging `xlieenkfhypqhevmwxzi` |
- **The user tests the customer portal on STAGING**, at `https://ees-platform-staging.netlify.app/project-portal`, login **`portal.test@ees-wi.org`**. A whole afternoon was lost because fixes were deployed to prod while the user was looking at staging. **When you change portal/UI, deploy to BOTH master and staging or the user won't see it.**
- **This session's git push is permission-scoped:** pushing to `claude/portal-stage-bar-data-driven-dmuppm` and to `staging` **works**; pushing to `master` returns **HTTP 403** (hard block). Production is reached only by the user (or GitHub MCP when connected) **merging a PR** into `master`. Do not burn time retrying a master push — it will 403.
- `staging` branch has its own `netlify.toml` pointing at the staging DB (`xlieenkfhypqhevmwxzi`). When merging `master` → `staging`, a plain merge preserves it (master doesn't touch netlify.toml). **Verify `netlify.toml` still targets `xlieenkfhypqhevmwxzi` after any staging merge.**
- MCP `apply_migration` / `execute_sql` **time out at 60s** on big backfills but usually **commit server-side anyway** — verify with a follow-up SELECT before re-running. For heavy backfills, split DDL from the UPDATE and use a set-based UPDATE (hash join), not a per-row correlated one.
- Netlify MCP occasionally returns transient 502 — just retry.

---

## 1. What shipped this session (all live on prod `master` @ `6d28b76` AND staging @ `750b0bd`)

### A. Portal invite automation — "Add to Portal" on the CONTACT record
Access is granted **per contact**, in one place. Open a Contact → **Actions → Add to Portal** →
pick portal role (Property Administrator / Property Viewer) → toggle which of the contact's
**account's** properties they can view → optionally send the invite email.

**Hard security rule — a portal user can only ever see properties on their own account —
enforced in three layers:**
1. **Write time:** `portal_invite_create` / `portal_grants_set` validate every property id against
   the portal user's bound account (`portal_users.portal_user_account_id`); one foreign property
   aborts the whole call (proven with a rollback test: 7 own-account props granted, a foreign
   property BLOCKED).
2. **Read time:** `get_portal_project_tracker` re-joins grants to `properties` and filters by the
   user's account (defense in depth) + a suspend/deactivate status gate.
3. **Binding:** each portal user is pinned to one account at creation, never widened.

**Email is opt-in.** `portal_invite_create` only creates a *pending* portal user + grants (no auth
identity, no email). The invitation email is a separate explicit step (`invite-portal-user` edge
function). So the whole flow can be set up and tested without contacting the person.

### B. List-view performance (prod DB, already live regardless of frontend)
- Ordered partial indexes `(name, id) WHERE _is_deleted = false` on properties/buildings/accounts
  → deep-page load 410ms → 16ms (~25×); exact-count → 3ms index-only. **Predicate MUST match the
  app's actual filter (`_is_deleted = false`, plain — NOT `coalesce(...)`) or the planner ignores it.**
- `outreach_properties_v` rewritten: dropped a redundant self-join; `has_active_opportunity` was a
  per-row correlated EXISTS → now a **materialized boolean column** `properties.property_has_active_opportunity`,
  kept correct by trigger `opportunities_active_flag_aiud` (calls `recompute_property_active_opp`),
  indexed `(property_has_active_opportunity, property_name, id) WHERE coalesce(property_is_deleted,false)=false`
  (coalesce predicate here because the VIEW filters with coalesce). This fixed the **Enrollment/Outreach
  Properties "Could not load records — statement timeout"**: count 1453ms → 36ms, page 543ms → 124ms.

### C. Portal full-width
All five portal pages (property, building, project, unit, calendar) use `padding: '22px 32px'`
(full width, no `maxWidth: 1500` cap). Previously property looked wide (dense content filled 1500)
while building/unit looked narrow (sparse content in a centered 1500 column). Now consistent.

### D. Opportunity card (earlier in session, already on prod before this work)
Shows record type + record-type description + right-justified record number; no redundant property/
building name repetition. Data-driven stage bar unchanged.

---

## 2. Database objects added (prod + staging both have these)

Migrations (in `supabase/migrations/`, applied to both DBs):
- `20260701120000_portal_invite_automation.sql` — `portal_users` status picklist (Pending/Invited/
  Active/Suspended/Deactivated); `portal_invite_create(uuid,uuid,uuid[])`, `portal_grants_set(uuid,uuid[])`,
  `portal_revoke_access(uuid,text)` (all SECURITY DEFINER, gated on `app_user_can`, account-scoped);
  hardened `get_portal_project_tracker`. anon revoked, authenticated granted.
- `20260701130000_contact_portal_user_fk_repoint.sql` — `contacts.contact_portal_user_id` FK was
  wrongly pointing at `users`; repointed to `portal_users` ON DELETE SET NULL (0 rows used it).
- `20260701140000_list_view_performance.sql` — ordered indexes + first view rewrite.
- `20260701150000_materialize_has_active_opportunity.sql` — the materialized column + trigger + index.

Edge function `invite-portal-user` (deployed to **both** prod and staging, verify_jwt=true): caller
re-verified via `app_user_can('portal_users','update')`; `auth.admin.inviteUserByEmail` with
redirect to `/project-portal`; writes back `auth_user_id` + status. Source in
`supabase/functions/invite-portal-user/index.ts`.

Helper functions used: `current_app_user_id()` (uuid), `app_user_can(object, action)` — actions are
`read|create|update|delete`. Portal role picklist: `picklist_object='portal_users'`,
`picklist_field='portal_role'` → Property Administrator / Property Viewer.

---

## 3. Key files (frontend)

- `src/data/recordActions.js` — `ADD_TO_PORTAL` action, `applicableObjects: ['contacts']`.
- `src/components/AddToPortalModal.jsx` — contact-centric modal (props `contactId`, `contact`);
  create mode + manage mode (toggle grants / send invite / revoke). No contact-picker.
- `src/components/RecordDetail.jsx` — lazy-loads modal; renders when `tableName === 'contacts'`;
  passes `contactId={recordId} contact={record}`; `onDone` alerts + reloads.
- `src/data/portalService.js` — `fetchPortalRoles`, `fetchAccountProperties`, `fetchPortalUserAccess`,
  `createPortalInvite`, `setPortalGrants`, `revokePortalAccess`, `sendPortalInvite` (+ legacy
  `fetchAccountContacts`, now unused by the modal).
- `src/pages/ProjectPortalRoot.jsx` — five page containers at `padding: '22px 32px'`.
- `src/data/outreachPropertiesService.js` — reads `outreach_properties_v`, filters
  `has_active_opportunity`, paginates via `fetchAllPagedParallel`.

---

## 4. Open / pending (confirm with Nicholas before acting)

- **Josiah's portal setup — DO NOT send his invite until Nicholas has fully tested the flow.**
  His contact is on the Lutheran account (`4bab33e4-ba62-4ec9-815b-8ff3c2bbe737`). Create in test
  mode (send-email OFF) only.
- **List-view performance, phase 2 (the durable fix):** the app still loads ALL rows of a
  table/view into the browser and filters client-side. The DB indexing removed the DB bottleneck,
  but true server-side (keyset) pagination requires rewriting `ListView.jsx` / `objectListService.js`
  / `fetchAllPagedParallel`. Left undone deliberately (bigger change; was the other session's
  domain). Also `fetchAllPagedParallel` fires 8 concurrent auth'd requests → GoTrue navigator-lock
  "steal" contention; server-side pagination would remove that too.
- **Financial visibility tiers (Tier 1/2/3)** — still a hard blocker before external/portal users
  see money fields; `field_metadata` / `field_permissions` are empty.
- Confirm the full-width portal reads correctly on staging with real data (`portal.test@ees-wi.org`).

---

## 5. How to promote / deploy (given the 403)

- Push code to `claude/portal-stage-bar-data-driven-dmuppm` (works) and/or `staging` (works).
- To reach **production**: merge a PR into `master` (user does it, or GitHub MCP `merge_pull_request`
  when the connector is authorized). Netlify auto-deploys on `master` and `staging` pushes.
- **Always deploy portal/UI changes to BOTH master and staging** so the user's staging test site matches prod.
- Verify deploys: Netlify deploy `commit_ref` matches the pushed sha + `state: ready`.
- Ship cycle for DB: `apply_migration` to prod AND staging → SELECT-verify → `get_advisors(security)`
  (baseline is the known ~172 lints; only NEW findings act). Commit author must be
  `Nicholas Wood <nicholas.wood@ees-wi.org>` or Netlify blocks the build.
