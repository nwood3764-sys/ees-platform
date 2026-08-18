# LEAP — Property Owner Portal

**Status as of 2026-08-18:** repaired and verified end to end; still viewing-only. Zero owners have logged in yet.
**Spec of record for what it should eventually do:** `docs/leap-portals.md` (unchanged — this doc is the build plan against it).

---

## 1. Vision / goal

A property owner, property manager, or their staff signs in to their own surface and follows their own work without calling anyone: where each program stands, which projects and work orders are underway, the photos captured on site, when the next visit is, and — eventually — uploading what we asked them for and signing what needs signing.

It is an **active working environment, not a read-only window**. Today only the first half of that exists.

---

## 2. What just shipped (2026-08-18)

The portal was built 2026-06-29 → 07-01 and then not touched again for six weeks. Revisiting it turned up that it had **never worked in production** — three independent defects, each fatal on its own, none of which could surface because nobody had ever logged in.

1. **No self-select RLS on `portal_users`.** The portal's `fetchPortalUserSelf()` is a direct, RLS-bound SELECT. `portal_users` carried only the internal-staff policies (`app_user_can(...)`), which evaluate against `public.users` — and a portal user has no `public.users` row. The SELECT returned nothing and the portal bounced straight back to its own login screen, forever. The fix was written on 2026-06-29 and the migration was **never applied to prod**. (`portal_user_property_grants` already had its equivalent; only `portal_users` was missed.)
2. **Login gate compared against a status no portal user has ever carried.** `ProjectPortalRoot` gated on `me.status !== 'Active'`, but the picklist is *Portal User Pending / Invited / Active / Suspended / Deactivated*. Every invited owner would have been told "your portal access is not active." The provider portal, written a month later, had the vocabulary right — the owner portal was never brought forward. The same stale `"Active"` also sat in the `portal-email-visit` edge function.
3. **`get_portal_calendar()` did not exist in prod.** The three migrations that build it were never applied either, so the Calendar tab has always called a function that isn't there. The client try/catches the failure, so it rendered as an *empty calendar* rather than an error — which is exactly why it went unnoticed. `portal-email-visit` (the "email me this visit" button) was likewise in the repo but **never deployed**.

Also fixed in the same pass:

- **Repo ↔ prod migration drift.** Prod's registry carried `portal_tracker_account_scope_hardening` with no file in the repo, so replaying this repo onto a branch database produced the **pre-hardening** tracker — without the `property_account_id` guard. Captured verbatim (byte-verified with `md5(prosrc)`) as a repo migration.
- **A record type that did not exist.** `portal_invite_create` had always written `record_type = 'Portal User'`, but the only value ever seeded was `Provider User`. Added the purpose-named **Property Owner User** record type and pointed the RPC at it. No backfill needed — zero rows carried the old string.
- **Calendar account scoping.** The restored `get_portal_calendar` now carries the same account guard as the tracker, so the two portal reads scope identically instead of the calendar being one guard looser.
- **anon revoked** on both portal reads (they now match `get_provider_portal_data`: authenticated + service_role).
- **Provider logins are refused** by the owner portal, mirroring the owner-login refusal already in the provider portal.
- **Stale admin filter options** in `PortalModule` (Status `['Active','Inactive','Suspended']`, which matched no row; Portal Role missing the two service-provider roles).

**Verified** by impersonating real portal users in rolled-back transactions against real data (PROP-23587, 1837 Alden Road, Janesville):

| Case | Result |
|---|---|
| Owner, correct account, granted the property | self-read returns exactly their own row; tracker 1 property / 1 building / 2 opportunities / WI-IRA-MF-HOMES 10-stage track at *Project Implementation* / 51 work orders; calendar 51 visits, first = "Insulation Removal - Attic", 1837 Alden Road, Janesville, WI 53545 |
| Owner granted a property belonging to **another account** | own row only; tracker **0** properties; calendar **0** visits |
| Suspended owner with a valid grant | `no_portal_user` on both reads |
| Signed-in user who is not a portal user | 0 rows; `no_portal_user` on both reads |

No rows were created — every test transaction rolled back; `portal_user_property_grants` still holds 0 rows. Advisors: **219**, the documented baseline, same known categories.

Help article **HA-00108** rewritten ("The Property Owner Portal") — it still described a hardcoded 10-phase HOMES/HEAR bar and no calendar.

### Round 2, same day — photos, and the storage hole they exposed

With login working, the first real look at the portal showed **every photo as a broken image**. Two defects, one of them serious:

1. **Photos could never have rendered.** `photos.file_url` holds a *storage path* (`work_steps/<id>/originals/<uuid>.jpg`), not a URL, and `work-evidence` is a private bucket. `PhotoStrip` rendered `<img src={path}>`, which the browser resolved against the site root and 404'd. `thumbnail_url` is NULL on all 499 work-step photos, so the fallback was the same path. The internal app never hit this because it resolves paths through `hydratePhotoUrls()` → `createSignedUrl`; the portal was written as though `file_url` were a public URL.
2. **Every private bucket was readable by any authenticated user** — the policies were blanket `TO authenticated USING (bucket_id = '<bucket>')`, for all four verbs. Portal users authenticate through the same Supabase Auth instance and hold the `authenticated` role, so the moment portal login started working, any property owner or service provider could list, download, overwrite, or **delete** every object in `work-evidence`, `property-documents`, `program-applications`, `service-provider-documents`, `templates`, `signatures`, `communications-attachments` and `fleet-evidence` — including other owners' properties. Nothing exploited it: until that day no external user could sign in at all. It was latent, and Lane A is what would have made it live.

Fixed by:

- **Locking every private bucket to internal staff.** Each policy keeps its original bucket condition and gains `current_app_user_id() IS NOT NULL` — true for every internal staff member (they have a `public.users` row), false for every portal user (portal identities live in `portal_users`). Verified: an internal user still sees all 1,238 `work-evidence` objects; a portal-only user now sees **0** objects in **every** bucket. No portal code path is affected — neither portal client touches `supabase.storage` at all. `portal-uploads` was locked the same way deliberately; when Phase 1 builds portal upload it gets its own grant-scoped policy instead of inheriting a blanket one.
- **A purpose-built read route: `portal-photo-urls`.** Takes photo ids, resolves the caller to a portal user, re-resolves each photo server-side through `work_step → work_order → property/building`, filters to that user's grants with the same account guard the two read RPCs apply, and returns 15-minute signed URLs minted with the service role. Prefers the watermarked variant — the copy stamped with the work step name — matching `hydratePhotoUrls`. Ids outside the caller's grants are simply absent from the response.
- **Client**: `PhotoStrip` signs lazily per strip (≈5 photos) through a module-level cache with in-flight de-duplication, so opening one unit doesn't sign the whole portfolio. For the LSS preview that's 351 photos across 46 work orders available, signed a handful at a time.

**Known-bad data noticed in passing, not fixed:** `photos.storage_path_watermarked` is the original path with the filename appended a second time (`…/<uuid>.jpg/<uuid>.jpg`). Objects do exist at those keys, so rendering works, but it is a path-composition bug in `process-photo` worth correcting before the row count grows.

---

## 3. Current-state architecture map

### Client

| Path | What it is |
|---|---|
| `src/main.jsx` (`isProjectPortalRoute`) | Route dispatch. `/project-portal` renders the portal instead of `App` — same bundle, same deploy, no separate site or subdomain. |
| `src/pages/ProjectPortalRoot.jsx` (~1,140 lines) | The entire portal: login gate, tree sidebar, property / building / project / unit pages, calendar view, .ics + Google/Outlook links. One file, all inline styles, no shared components with the staff app beyond `C` (palette) and `supabase`. |
| `src/data/projectPortalService.js` | Data layer + all rollup math (`oppPct`, `buildingStatus`, `propertyPrograms`, `workOrdersByUnit`, …). Pure functions, no tests. |
| `src/modules/PortalModule.jsx` | The **internal** admin side: Portal Users and Partner Organizations lists. |
| `src/components/AddToPortalModal.jsx` | Provisioning UI on a contact: pick role, tick properties, create (no email), then send the invitation as a separate deliberate step. |
| `src/data/portalService.js` | Internal-side reads + the three RPC wrappers. |

### Database

| Object | Notes |
|---|---|
| `portal_users` | External identity. `record_type` is **text**, not a picklist FK (deliberately excluded from the uppercase-hyphen standardization). `portal_role` **is** a uuid FK to `picklist_values`. Statuses are `Portal User …`. |
| `portal_user_property_grants` | The whole authorization model. One row per granted property **or** building (`pug_property_id` / `pug_building_id`). |
| `get_portal_project_tracker()` | SECURITY DEFINER. The entire Projects tree in one call. Scoped by grants **and** by the portal user's account. |
| `get_portal_calendar()` | SECURITY DEFINER. Service appointments on granted work orders. Same two guards. |
| `portal_invite_create` / `portal_grants_set` / `portal_revoke_access` | SECURITY DEFINER provisioning, each permission-gated with `app_user_can`. |
| `invite-portal-user` (edge fn) | Creates the auth identity and emails the set-password link. Service-role key stays server-side. |
| `portal-email-visit` (edge fn) | Emails the signed-in portal user their own visit as an .ics. |

### Pain points, candidly

- **The portal is one 1,140-line file.** Fine at this size, a problem the moment uploads, comments, and signing land. Lane B should extract views before adding features, not after.
- **Opportunities are building-level in the portal**, and the tracker skips any opportunity with a null `building_id`. A property-level opportunity is invisible to the owner. Worth a decision (below).
- **Roles are decorative.** `Property Administrator` and `Property Viewer` exist as picklist values and are stored on the user, but nothing in the UI or either RPC reads them. There is no permission difference whatsoever. The spec's third role, *Regional Decision Maker*, does not exist.
- **Grants can be building-level in the table and both RPCs, but `AddToPortalModal` only ever grants whole properties.** Half a feature.
- **No financial tier enforcement.** `field_metadata` / `field_permissions` are still empty platform-wide. Nothing financial is exposed in the portal today, which is the only reason this isn't already a problem — it becomes a hard blocker the moment payment status is added (Phase 3).
- **`portal-email-visit` sends from a hardcoded `assessments.wi@EES-WI.org`**, bypassing the purpose-aware mailbox routing (`obm_purpose`) that the rest of the email layer uses. Left as-is in the repair — changing which mailbox emails customers is a routing decision, not a bug fix. See Decisions.
- **No tests.** `projectPortalService.js` is pure math with a natural fixture shape and deserves the `scripts/*-fixture.mjs` treatment used by `paperworkModel` and `createRecordFields`.
- **Nothing exercises the portal in CI or in prod.** The reason three fatal defects sat undetected for six weeks is that nothing — no harness, no smoke check, no user — ever ran it. See the self-test recommendation below.

---

## 4. Target architecture + design principles

1. **The grant is the only authority.** No inheritance, no hierarchy, no implicit account-wide access. Both existing reads already work this way; everything added must too.
2. **Every read goes through a SECURITY DEFINER RPC with both guards** (grant + account). Never widen RLS on business tables to reach the portal.
3. **Writes from the portal are narrow, purpose-built RPCs** — never a table-level insert policy for external users. An owner uploading a document calls `portal_upload_document(...)`, which decides what may be attached to what.
4. **Nothing hardcoded.** Programs, stages, required documents, and signature events are all data. The tracker already derives programs from record types; the document and signature layers must do the same.
5. **The portal never becomes a second app.** It shares the palette, the storage buckets, the documents/activities tables, and the e-signature pipeline. Its own code is presentation.
6. **Every portal action lands as a real record** — a `documents` row, an `activities` row, an `envelopes` row — visible on the internal record page with the portal user named as the actor.

---

## 5. Phased build plan (Lane B)

Each phase is additive and independently shippable.

**Phase 0 — Make it provable (small, do first).**
Extract the portal's views out of the single file; add a `scripts/portal-rollups-fixture.mjs` covering `projectPortalService` math; add a `portal-self-test` harness in the spirit of `admin-test-send-email` that provisions a scratch portal user, exercises both reads, and asserts the scoping cases — run after any portal change. This phase is what stops another six-week silent outage.

**Phase 1 — Documents (view + upload).**
Owner sees the documents already attached to their property/project (filtered to an explicit portal-visible flag — *not* everything), and uploads what was requested: enrollment agreements, income qualification statements, HUD/HAF agreements, rent rolls. New: `portal_visible` on documents, `portal_upload_document` RPC, storage policy scoped by grant, an internal notification to the Project Coordinator on upload.

**Phase 2 — E-signature in the portal.**
The pipeline already exists (`envelopes`, `send-envelope`, `signing-portal-*`, and since 2026-07-27 a signing route for generated PDFs). This phase surfaces "waiting for your signature" **inside** the portal rather than only via an emailed link, and lists completed signatures. Mostly wiring, little new machinery.

**Phase 3 — Record-level comments and questions.**
Append-only comments on a specific work order, unit, document, or photo — the spec is explicit that this is *not* an inbox. Visible to the owner and their Project Coordinator, logged as activities, notification to the internal owner. Needs the financial-tier work resolved first if any comment surface exposes amounts.

**Phase 4 — Payment request / incentive receipt status.**
The spec's remaining viewing gap. Depends on Tier 1/2/3 enforcement being real, since this is by definition financial.

**Phase 5 — Roles that mean something.**
Make `Property Administrator` vs `Property Viewer` actually differ (upload/sign/comment vs view), and decide whether *Regional Decision Maker* is a role or just a broader grant set.

---

## 6. Technical recommendations

- **Do not build a second portal app.** Everything above fits the existing surface.
- **Storage:** reuse the existing buckets and the `documents` row convention; scope access by grant in the policy, never by bucket path convention alone.
- **Uploads must never be blocked** by validation the owner can't satisfy — the standing "documentation is never blocked" rule from the field work applies here too. Warn, accept, flag for review.
- **Vite hazard** stands: `npm run build:safe`, never bare `npm run build`.
- **Migration stamps:** real UTC clock time, and check `ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` is empty before committing.
- **After any DDL:** `get_advisors(security)`; baseline is 219, same known categories.
- **Verify the deploy, not the merge** — check the published `commit_ref` via the Netlify API. The primary site is `https://leap.energyefficiencyservices.org` (project `ees-ops`); this environment's network policy blocks fetching the site directly.

---

## 7. Decisions

- **DECIDED 2026-08-18 (Nicholas):** revisit the portal, repair-and-prove first (Lane A), then build the Actions half (Lane B).
- **DECIDED 2026-08-18:** the owner portal gets its own record type, **Property Owner User**, paired with but never sharing anything with `Provider User`. `Portal User Invited` counts as able to sign in (they arrive from the invitation link before anything flips them to Active).
- **DECIDED 2026-08-18:** the calendar read carries the same account guard as the tracker. Both portal reads are authenticated-only; anon revoked.
- **DECIDED 2026-08-18:** private storage buckets are internal-staff only. External users never get direct storage access; portal media is served exclusively through purpose-built, grant-checking edge functions that mint short-lived signed URLs. Portal document upload (Phase 1) follows the same rule — its own grant-scoped policy, never a blanket one.
- **OPEN — `process-photo` watermarked path bug.** `storage_path_watermarked` doubles the filename segment. Harmless today; fix before the photo table grows.
- **OPEN — property-level opportunities.** The tracker requires `building_id`, so an opportunity recorded at property level is invisible to the owner. Recommendation: show it on the property page rather than silently dropping it. Needs Nicholas's call on whether property-level opportunities are legitimate at all.
- **OPEN — `portal-email-visit` sender mailbox.** Hardcoded `assessments.wi@EES-WI.org`; the rest of the email layer routes by `obm_purpose`. Recommendation: route it like everything else, which for WI correspondence means `ira@ees-wi.org`. Not changed unilaterally — it changes which mailbox customers see.
- **OPEN — first real invitation.** Lane A proved the read path without emailing anyone. The first live invite should go to an internal EES address before any real property owner.
- **OPEN — Lane B start.** Awaiting go-ahead; Phase 0 recommended first.

---

## 8. File + DB-table index

**Files:** `src/main.jsx` · `src/pages/ProjectPortalRoot.jsx` · `src/data/projectPortalService.js` · `src/modules/PortalModule.jsx` · `src/components/AddToPortalModal.jsx` · `src/data/portalService.js` · `supabase/functions/invite-portal-user/index.ts` · `supabase/functions/portal-email-visit/index.ts`

**Tables:** `portal_users` · `portal_user_property_grants` · `properties` · `buildings` · `units` · `opportunities` · `projects` · `work_orders` · `work_steps` · `photos` · `service_appointments` · `picklist_values` · `picklist_value_record_type_assignments` · `documents` · `activities` · `envelopes` (Lane B)

**RPCs:** `get_portal_project_tracker()` · `get_portal_calendar()` · `portal_invite_create()` · `portal_grants_set()` · `portal_revoke_access()`

**Help article:** HA-00108 — *The Property Owner Portal*
