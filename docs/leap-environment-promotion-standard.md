# LEAP Environment & Promotion Standard

The rules for moving changes between **staging** and **production** without ever
losing production data. Read this before applying any schema change, running any
data script, or promoting code. This is a standing standard, not a one-time
handoff.

---

## The two environments

| | Production | Staging |
|---|---|---|
| Supabase project | `flyjigrijjjtcsvpgzvk` | `LEAP Staging` (`xlieenkfhypqhevmwxzi`) |
| Git branch deployed | `master` | `staging` |
| Netlify site | `ees-ops.netlify.app` | `ees-platform-staging.netlify.app` |
| Holds | Real customer records (source of truth) | A disposable copy for testing |

Same code, different database — only `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
differ (the `staging` branch carries a `netlify.toml` pointed at the staging DB).

---

## The one principle: code/schema flow **up**, data flows **down** — never crossed

```
   CODE + SCHEMA  ───promote──▶   PRODUCTION
   (staging → master, PR)          (source of truth for DATA)
                                          │
                                          │ Refresh Staging Database (GitHub Action)
                                          ▼
                                       STAGING   ◀── wiped & reloaded from prod
```

- **Refresh only ever goes production → staging.** It rebuilds the staging
  schema from `supabase/migrations/` and copies a fresh snapshot of production
  data in. It **wipes staging** and **never writes to production**.
- Nothing in the staging path — not a code push, not a refresh — can touch,
  overwrite, or delete a production record. They are different databases.

---

## Three categories of change

### 1. Code / UI (React, pages, logic)
- Build on the `staging` branch, test on `ees-platform-staging.netlify.app`.
- Promote with a PR `staging` → `master`.
- **Production-data risk: none.** A Netlify deploy is static files; it cannot
  alter database rows.

### 2. Schema (tables, columns, RPCs, triggers, RLS policies)
- Write an **additive** migration file in `supabase/migrations/`.
- Apply it to the **staging DB first**, verify, then apply the *same file* to
  production.
- **Additive only — this is the rule that protects prod data:** new
  tables/columns/RPCs/policies only. Never `DROP` a column or table that holds
  data; never `DELETE`/`TRUNCATE` rows. To retire a field, stop using it and
  soft-deprecate — do not drop it.
- After any DDL: re-issue REVOKE/GRANT, `NOTIFY pgrst, 'reload schema'`, and run
  `get_advisors(security)` (only NEW findings beyond the ~179 baseline matter).

### 3. Configuration & records — **built once, in production**
This covers work types, work plans, **work-order templates, work-step
templates**, picklist values, record types, status lifecycles, *and* all real
records (opportunities, projects, work orders, etc.).
- **The admin builds these directly in production, once, through LEAP Admin.**
  That is their permanent home. Do **not** double-build them in staging.
- This is safe by design — it is the everyday-admin layer, not schema surgery:
  - **Additive** — a new work plan / template / picklist value sits *alongside*
    the existing ones; it doesn't change or replace anything, and a new template
    is inert until it's attached to a job.
  - **Soft-delete everywhere** (`block_hard_delete`) — "delete" only hides the
    row (recycle bin); nothing is truly lost.
  - **Validation + required fields** block malformed saves; **field history /
    audit trail** logs every change, so it's reversible.
  - Same model as a Salesforce admin configuring picklists, page layouts, and
    record types live in production every day.
- Staging only ever holds a *copy* of this config — pulled **down** from
  production by a Refresh. Never copy staging config/records **up** into prod.

---

## Hard guarantees (what will never happen)

1. A staging code push or staging data refresh writes **nothing** to the
   production database.
2. No destructive DDL (`DROP`/`TRUNCATE`) or destructive DML (`DELETE` of real
   rows) is ever run against production.
3. No staging → production data copy is ever run.
4. Production has `block_hard_delete()` on **every** table — all deletions are
   soft-deletes, so even an accident is recoverable.

---

## "Out of sync" is expected and safe

Staging drifts from production between refreshes (users keep adding records in
prod; staging is a point-in-time copy). **Drift never endangers production.**
When you want staging current again, run **Actions → Refresh Staging Database**
(or ask Claude to trigger it). Remember: a refresh **wipes staging**, so any
test config built only in staging is disposable — anything meant to last must
become a migration or be built in production.

---

## Everyday playbooks

**Ship a UI/logic change**
1. Commit to a feature branch → merge into `staging` → test on the staging site.
2. PR `staging` (or the feature branch) → `master`. Production auto-deploys.

**Ship a schema change**
1. Write an additive migration in `supabase/migrations/`.
2. Apply to staging DB → verify with an explicit `SELECT`.
3. Apply the same file to production → `get_advisors(security)`.
4. Commit the migration; it travels to staging automatically on the next refresh.

**Build new work-order / work-step templates (or other config)**
1. Build them in **production** through LEAP Admin — once. It's additive,
   validated, and soft-delete protected, so it's safe (this is normal admin
   work, like configuring Salesforce in production).
2. No staging step, no re-creating, no double build.

**Make staging current**
- Run the Refresh Staging Database Action. (Wipes & reloads staging from prod.)

---

See also: `leap-staging-environment.md` (refresh mechanism + one-time setup) and
`leap-dev-workflow.md` (sandbox → prod migration workflow).
