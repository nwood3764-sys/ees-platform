# LEAP — Program Manager Portal

**Status:** BUILT 2026-08-25 and live on prod, end to end. No program manager has been invited yet — grants are chosen record by record in LEAP, and which ones get exposed is a business decision made per record.
**First and only tenant for now:** Everblue.
**Related:** `docs/leap-property-owner-portal.md` (the portal this borrows its navigation from), `docs/leap-portals.md` (the standing portal spec).

---

## 1. Vision / goal

A program manager signs in and reviews the work: the photos, documents, forms and reports for the specific assessments and projects EES has shared with them — and nothing else. They never see LEAP's internal screens, never navigate our object model, and never change anything.

Nicholas, 2026-08-24: *"They really just need to see the photos, documents, forms, and any reports. I just don't want them to be in our software... This is just a portal for viewing only. They can download stuff if we give them permission, but we want a record if they download stuff."*

---

## 2. Why this is a third model, not a variation

Both existing portals scope by **belonging**:

| Portal | You see… | Mechanism |
|---|---|---|
| Property Owner | properties **you own** | property grants + publication flags |
| Service Provider | work orders **assigned to you** | your provider account |
| **Program Manager** | records **we hand you** | explicit per-record grants |

Everblue owns nothing and is assigned nothing. They oversee records belonging to *many different owners, across accounts*. Neither existing grant table fits, and bending the property-grant table into it would be a workaround: the thing being shared is a **record**, not a property subtree.

---

## 3. What a grant actually reaches

This is the part the data dictated rather than the design.

**Evidence does not hang off assessments or projects.** Verified 2026-08-24:

- `documents.related_object` only ever holds `accounts | enrollments | opportunities | properties | work_orders | work_steps`. **Zero** documents are attached to an assessment or a project.
- `photos.related_object` only ever holds `work_orders | work_steps`; 678 photos hang off work steps.

So a granted record resolves downward before it shows anything:

```
grant: assessment ──> project_id ──> work orders ──> work steps ──> photos
                 └──> building_id                             └──> documents
grant: project   ──────────────────> work orders ──> work steps ──> photos
                                                              └──> documents
```

All 18 live assessments carry both `project_id` and `building_id`, so the chain always resolves today. **An assessment grant and a project grant therefore reach almost the same subtree** — the assessment adds its own fields and its building context, the project adds the work orders. Worth knowing before anyone assumes they are two different scopes.

---

## 4. Navigation — deliberately not our screens

Same mental model as the Property Owner Portal, because it works and it is already familiar: **pick a property → pick a building → see what is underneath**. The tree is *derived from the granted records*, not from property ownership:

- Properties shown = the distinct properties of the granted assessments/projects.
- Buildings shown = the distinct buildings beneath those.
- Under a building: the granted assessments and projects, then work orders, then work steps with their photos and documents.

Nothing that isn't reachable from a grant appears anywhere — no search across LEAP, no record pages, no related lists, no picklists, no edit controls.

---

## 5. Read-only, and downloads are a privilege

- **Read-only by construction.** No writes of any kind in v1. The portal issues no INSERT/UPDATE path at all, so there is nothing to forget to lock.
- **Download is a separate permission**, off by default. A program manager can always *view* what they are granted; downloading the underlying file is granted deliberately.
- **Every download is logged** — who, which file, which record, when. This is the requirement that dictates the architecture:

> A signed URL minted in the browser cannot be logged. So files must be served by a purpose-built edge function that writes the log row **before** it returns the URL — the same shape as `portal-photo-urls`, which already resolves a caller to a portal user, re-checks their scope server-side, and signs with the service role. Storage stays locked to internal staff (2026-08-18); the program portal never touches `supabase.storage` directly.

Viewing a photo inline and downloading the original are different acts: inline viewing uses a short-lived watermarked URL, download returns the original and writes the log.

---

## 6. Proposed schema

| Artifact | Purpose |
|---|---|
| `accounts` row for **Everblue** | record type `Program Administrator` or `Program Implementer` (both exist, both currently unused — see Decisions) |
| `portal_users.record_type` = **Program Manager User** | third value alongside Property Owner User / Provider User |
| `portal_users.portal_role` = **Program Manager**, **Program Reviewer** | reviewer = view only; manager = view + download, subject to the flag |
| **`portal_record_grants`** (PRG-) | the new grant table: portal user + object + record id + `prg_allow_download` + audit/soft-delete. Polymorphic on purpose — assessments and projects today, more objects later without a new table each time |
| **`portal_download_log`** (PDL-) | one row per download: portal user, object, record id, document/photo id, filename, when. Written only by the edge function |
| `get_program_portal_data()` | one SECURITY DEFINER read, mirroring `get_portal_project_tracker`: resolves grants → the property/building tree → work orders → steps → photos/documents |
| `program-portal-file` (edge function) | resolves caller → portal user → grant, checks `prg_allow_download`, writes `portal_download_log`, returns a short-lived signed URL |
| `/program-portal` | the surface, alongside `/project-portal` and `/provider-portal` |

**Reused as-is, not rebuilt:** the invite flow shape (`portal_invite_create` sibling), the admin **View As** machinery (`portal_view_as_start` + `p_view_as_portal_user_id`), the login gate and status vocabulary, and the signed-URL pattern.

**Deliberately NOT reused:** the property-grant table, and the `Include in Property Owner Portal` flags. For this portal the grant *is* the affirmative act — you hand-pick each record — so a second publication checkbox on every object would be clutter with no added safety.

---

## 7. Field exposure

Field-level financial tiers are still unbuilt platform-wide, so the read RPC returns an **explicit whitelist** of fields rather than "the record minus financials." Nothing about contract value, cost, margin or incentive amount is in the whitelist. Opportunities are out of scope entirely in v1 for the same reason.

---

## 8. Phased build

**Phases 1–3 shipped together on 2026-08-25** — viewing photos needs signed URLs just as downloading does, so splitting "view" from "files" would have shipped a portal that renders nothing.

- Everblue (ACC-07622, Program Implementer), the Program Manager User record type, the Program Manager / Program Reviewer roles.
- `portal_record_grants` (PRG-) and `portal_download_log` (PDL-).
- `get_program_portal_data()` — the single read.
- `program-portal-file` — the only route to a byte, view and download.
- `/program-portal` — the surface: property → building → assessment, reports, work steps, photos, lightbox.
- **Manage Shared Records** on a Program Manager User: search every assessment and project, share one at a time, revoke by soft-delete.
- **View Portal as This User** routes by record type, so a program manager opens `/program-portal` and an owner opens `/project-portal`.
- Download permission is tickable at both levels — a *Portal Access* section on the account and on the portal user layouts.

**Phase 4 — the invitation.** Not done. Everblue has no contact record and no portal user yet; `portal_invite_create` is property-grant shaped and would need a sibling for program managers. Testing today goes through admin View As, which needs no invitation at all.

---

## 9. Decisions

- **DECIDED 2026-08-24 (Nicholas):** objects are **energy assessments and projects only**, and **only the specific record IDs EES selects** — never all assessments or all projects.
- **DECIDED:** a grant carries everything beneath it — work steps, photos, documents, forms, reports.
- **DECIDED:** navigation mirrors the owner portal (property → building → contents), not LEAP's internal screens.
- **DECIDED:** totally read-only.
- **DECIDED:** downloads require explicit permission and every download is recorded.
- **OPEN — Everblue's account record type:** `Program Administrator` or `Program Implementer`? Both exist and carry zero accounts, so whichever is chosen defines the convention.
- **OPEN — what "reports" means concretely.** Candidates: generated PDFs stored as `documents` on work orders/steps, the `efr_reports` object, and program submittal documents. Which of these should Everblue see?
- **OPEN — is download permission per grant or per portal user?** Per grant is finer (share ten records, allow download of two); per user is simpler. Recommendation: per grant, defaulting off.

---

## 10. File + DB-table index

**Likely files:** `src/main.jsx` (route), `src/pages/ProgramPortalRoot.jsx` (new), `src/data/programPortalService.js` (new), `src/modules/PortalModule.jsx` (a Program Manager Portals section), `supabase/functions/program-portal-file/index.ts` (new).

**Tables:** `accounts` · `contacts` · `portal_users` · `portal_record_grants` (new) · `portal_download_log` (new) · `assessments` · `projects` · `work_orders` · `work_steps` · `photos` · `documents` · `properties` · `buildings` · `portal_view_as_sessions`
