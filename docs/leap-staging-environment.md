# LEAP Staging Environment

A persistent, full **copy of production** (schema **and** data) where you can
safely test edits and builds without touching the live site. Refreshed from
production on demand.

- **Staging database:** Supabase project `LEAP Staging` (ref `xlieenkfhypqhevmwxzi`)
- **Staging website:** a Netlify site that builds the `staging` git branch and
  points at the staging database (set up once — see below)
- **Refresh mechanism:** the **Refresh Staging Database** GitHub Action
  (`.github/workflows/refresh-staging.yml`)

---

## How it works

Production and staging are two completely separate Supabase databases.
The website code is identical; only the database it talks to differs (controlled
by `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).

When you want staging to reflect current production data, you run the **Refresh
Staging Database** Action. It runs on GitHub's servers (which can reach the
databases) and:

1. Rebuilds the staging schema from `supabase/migrations/` (the baseline + any
   later migrations).
2. Copies all production data into staging (`pg_dump` → `psql`), with triggers
   disabled during load so audit/soft-delete logic doesn't fire.

The refresh takes a few minutes. Your data never passes through any chat or
third party — it goes directly database-to-database inside GitHub's runner.

---

## One-time setup

### 1. Add two repository secrets
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add both (get each from the project's Supabase dashboard →
**Project Settings → Database → Connection string → "Session pooler" (URI)**,
filling in the real database password):

| Secret name | From which Supabase project |
|---|---|
| `PROD_DB_URL` | production (`flyjigrijjjtcsvpgzvk`) |
| `STAGING_DB_URL` | `LEAP Staging` (`xlieenkfhypqhevmwxzi`) |

> Use the **Session pooler** string (host `aws-0-us-east-2.pooler.supabase.com`,
> port `5432`) — the direct connection is IPv6-only and won't work from CI.

### 2. Create the staging website (Netlify)
Netlify → **Add new site → Import an existing project → GitHub →
`nwood3764-sys/ees-platform`**, then:
- **Branch to deploy:** `staging`
- **Build command:** `npm run build:safe`  •  **Publish directory:** `dist`
- Site name: e.g. `staging-ees-ops` → `https://staging-ees-ops.netlify.app`

The `staging` branch already carries a `netlify.toml` pointed at the staging
database, so the staging site automatically uses staging data. (Production's
`master` branch is untouched and keeps pointing at production.)

---

## Day-to-day

- **Refresh staging data:** GitHub → **Actions → Refresh Staging Database →
  Run workflow**. (Claude can also trigger this for you.)
- **Test a change in staging:** push it to the `staging` branch → the staging
  site rebuilds with your change against staging data. When you're happy, bring
  the change into `master` (production) via a normal PR.

## Costs
- The staging Supabase project: ~**$10/month** (Pro plan).
- Keep staging access locked down — it holds a real copy of customer data.
