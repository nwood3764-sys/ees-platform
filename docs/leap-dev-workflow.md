# LEAP — Development Workflow (Sandbox → Production)

How changes move from an idea to the live site, and the database equivalent.
This is the LEAP analogue of the Salesforce **build-in-a-sandbox → validate →
deploy-to-production** cycle. Read this before making any change that will reach
`master`.

---

## The mental model (Salesforce → LEAP)

| Salesforce | LEAP | Who does it |
|---|---|---|
| Sandbox org (isolated place to build) | A **git branch** + its **Netlify Deploy Preview** | automatic per branch |
| Sandbox database | A **Supabase preview branch** (isolated DB) | automatic per branch, once branching is on |
| "Validate" / run all tests | `npm run build:safe` (preflight + Vite build + runtime-smoke) | every push |
| Change set | A **Pull Request (PR)** | you open it |
| Inline change-set review | PR diff + line comments | reviewer |
| Deploy to production | **Merge the PR to `master`** → Netlify auto-deploys | clicking Merge |
| Deploy of metadata/schema | Supabase migrations auto-apply to prod on merge | automatic, once branching is on |

The golden rule: **`master` is production.** Every commit on `master`
auto-deploys to the live Netlify site, and (with branching on) every new
migration on `master` runs against the production database. Nothing reaches
`master` except by merging a reviewed PR.

---

## Two layers, two sandboxes

A LEAP change can touch two things, and each has its own isolation:

1. **The app (frontend / React+Vite).** Isolated automatically. The moment you
   push a branch, Netlify builds it at a unique **Deploy Preview URL** that does
   not touch the live site. Open a PR and Netlify posts the preview link on it.

2. **The database (Supabase / Postgres).** *Not* isolated by default — every
   preview points at the one production database unless **Supabase Branching**
   is enabled. Branching gives each git branch a throwaway copy of the database,
   built from the migration files in `supabase/migrations/`, so you can test
   schema changes without touching live data.

---

## Day-to-day flow

```
1. Branch        git checkout master && git pull
                 git checkout -b feature/<short-name>

2. Build         Make changes. For schema, add a NEW file to
                 supabase/migrations/ — never hand-edit the prod DB.

3. Verify        npm run build:safe          # must pass before pushing

4. Push          git push -u origin feature/<short-name>

5. Open PR       PR from feature/<short-name> → master.
                 Netlify posts an app preview; Supabase posts a DB
                 preview (once branching is on). Review the diff.

6. Merge         When the preview looks right and build:safe is green,
                 merge the PR. master auto-deploys to production and
                 the migrations apply to the prod database.

7. Confirm       Load the live site and confirm the change shipped.
```

Branch naming: `feature/<name>`, `fix/<name>`, `schema/<name>`. Keep one PR to
one purpose (build-discipline rule) — don't fold unrelated changes together.

---

## Database best practices (the part that bites people)

- **Every schema change is a migration file** in `supabase/migrations/`, named
  `<timestamp>_<snake_case_description>.sql`. This is the single source of truth
  that lets a preview branch rebuild the schema from scratch. The repo already
  has 180+ of these — keep the discipline.
- **Never run ad-hoc DDL against the production database by hand.** If a change
  isn't in a migration file, a preview branch can't reproduce it and the next
  person's sandbox is wrong.
- **Verify with an explicit `SELECT`** after a migration before relying on it.
- **Re-run the security advisor after any DDL.** Only findings *beyond* the
  known baseline (~179 lints) need action.
- **Seed data for previews** lives in `supabase/seed.sql` — preview databases
  start empty (schema only) unless seeded.
- All the hard-won schema rules (soft-deletes only, `public.users.id` vs
  `auth.users.id`, record-type UUIDs, etc.) live in `CLAUDE.md` and
  `leap-schema-session.md`. Read those before authoring DML.

---

## One-time setup checklist

These are dashboard actions (account-level), done once. Status tracked here.

### A. GitHub — protect `master`  *(prevents accidental direct-to-prod pushes)*
In the GitHub repo → **Settings → Branches → Add branch ruleset** for `master`:
- Require a pull request before merging.
- Require status checks to pass (select the Netlify build check).
- (Optional) Require the branch to be up to date before merging.

### B. Netlify — Deploy Previews  *(usually already on)*
Netlify → **Site configuration → Build & deploy → Deploy Previews**: ensure
"Deploy Previews" is enabled for PRs. Branch deploys can stay off; previews are
enough. Confirm the build command is `npm run build:safe` (it is, in
`netlify.toml`).

### C. Supabase — Branching  *(the database sandbox)*
Requires the Supabase **Pro** plan. Supabase → **Branching** → enable, and
connect the GitHub repo `nwood3764-sys/ees-platform`. After that:
- Opening a PR creates a preview branch DB built from `supabase/migrations/`.
- The preview's connection details are exposed to that branch's build so the
  Netlify preview talks to the preview DB, not prod.
- Merging to `master` runs any new migrations against the production project
  (`flyjigrijjjtcsvpgzvk`).

Until C is enabled, previews are app-only and point at the production database —
safe for UI work, but treat schema migrations on a branch as if they will hit
prod (because on merge, they will).

---

## Quick reference

- Verify before every push: `npm run build:safe` (never bare `npm run build`).
- Fresh clone: `npm install` first.
- Commit author must be `Nicholas Wood <nicholas.wood@ees-wi.org>` or Netlify
  blocks the build.
- Production = `master`. Everything else is a sandbox.
