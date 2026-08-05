# ClearResult HEAR — bulk Project Reservation filler

Automates the **Wisconsin IRA Single Family — HEAR** Project Reservation flow on
`focus-ira.clearesult.com`, driven from a CSV exported from LEAP. Built for the
~1,000-in-two-days push.

> **Local tool only.** Runs on your machine. It is NOT part of the LEAP app and
> must never be merged to `master` or deployed. It lives on a feature branch for
> easy `git pull`.

## How it fits together

```
LEAP (enrollment records)  ->  data/projects.csv  ->  Playwright  ->  ClearResult portal
                                        ^
                    field-report.json (from `npm run inspect`) tells us
                    (a) what the LEAP enrollment record type must hold, and
                    (b) how config/fieldmap.js maps CSV -> form fields
```

You log in **once**; the session is saved and reused for the whole batch. CAPTCHA
only appears on account creation (a one-time manual step), not on reservations.

## One-time setup

```bash
cd tools/clearesult-hear-filler
npm install
npx playwright install chromium
```

## Step 1 — log in once

```bash
npm run login
```
A browser opens. Log in by hand (email, password, CAPTCHA). When you can see your
dashboard, return to the terminal and press Enter. Your session is saved to
`.browser-profile/` and reused by every later run.

## Step 2 — capture the real form (do this before anything else)

The reservation pages are behind login, so the exact field names aren't known yet.
This grabs them:

```bash
npm run inspect                      # opens the HEAR start page
# navigate to the exact reservation page, then press Enter
```
It prints every field (label, name, id, type, select options) and writes
`data/field-report.json`. **Run it once per page** of the reservation flow, then
send `data/field-report.json` back — that single file is the spec for both the
LEAP enrollment fields and `config/fieldmap.js`.

## Step 3 — map the fields

Edit `config/fieldmap.js`: one `pages[]` entry per reservation page, each field
`{ selector, type, value }`. `value` is a function of the CSV row. Types:
`text | number | email | tel | select | checkbox | radio | typeahead`
(`typeahead` handles the Google-style address box — type + pick from the dropdown).

## Step 4 — data in

Put the projects in `data/projects.csv` (headers become row keys). See
`data/projects.sample.csv`. Give each row a unique `key` (project/enrollment
number) — it's used for resume + screenshot folders.

## Step 5 — run

```bash
npm run fill:dry                     # fills every page but never submits — ALWAYS do this first
LIMIT=5 npm run fill                 # real submit, first 5 only
npm run fill                         # the whole batch
```
- **Resumable:** progress is written to `data/results.csv`; rows marked `done` are
  skipped on the next run, so you can stop/restart freely.
- **Screenshots:** every page + confirmation (or error) go to
  `data/screenshots/<key>/`.
- Knobs: `LIMIT=n`, `SLOW_MO=250`, `DRY_RUN=1`.

## Alternative — interactive userscript

`userscript/clearesult-hear-fill.user.js` — install in Tampermonkey for a floating
"Fill this page" panel (paste one project's JSON, click Fill). Useful to sanity-check
the field mapping by hand before trusting the bulk runner. Matches fields by visible
label text.

## Safety / etiquette

- Keep a real `SLOW_MO` (100–300ms) during a live batch — don't hammer the portal.
- Always `fill:dry` then `LIMIT=5` before the full run.
- `.browser-profile/`, `data/projects.csv`, results, screenshots, and
  `field-report.json` are git-ignored (they contain session + owner PII).
