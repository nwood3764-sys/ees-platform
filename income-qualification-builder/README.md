# HUD Multifamily Income Qualification Builder (WI + NC)

Live at **https://ees-income-qualification-builder.netlify.app/**

A single self-contained `index.html`: the application plus the HUD / LIHTC /
USDA property dataset — **6,371 properties (4,388 NC · 1,983 WI)** — inlined as
a JavaScript constant. Nothing compiles; the file is the deliverable.

Given a property it produces the categorical income-qualification packet: a
one-pager PDF, a combined PDF packet, the Tenant Data Sheet (XLSX), Property
Data + definitions (XLSX), supporting-data CSVs, a categorical proof sheet, and
the pre-filled Focus on Energy application form / JotForm hand-off.

## Why it lives in the repo

It did not, until 2026-09-02. The site was a **hand-uploaded file** — no repo
link, no history, no way to rebuild it. `commit_ref` on its only deploy
(2026-08-30) was `null`. When the live copy stopped working there was nothing
to diff it against and nothing to redeploy, which is the failure this directory
exists to prevent. The file that works is now the file in version control.

## Deploying

The site is **not yet linked to this repo** — that is a one-time setting in the
Netlify UI (Site configuration → Build & deploy → Continuous deployment):

| Setting | Value |
|---|---|
| Repository | `nwood3764-sys/ees-platform` |
| Branch | `master` |
| **Base directory** | `income-qualification-builder` |
| Build command | *(leave empty — set by `netlify.toml`)* |
| Publish directory | `income-qualification-builder` |

Once linked, every push to `master` that touches this directory redeploys the
site, and pushes that don't touch it are cancelled for free by the `ignore`
rule in `netlify.toml`. Until it is linked, the only route is dragging
`index.html` onto the site's Deploys tab.

## External dependencies

Three libraries load from cdnjs at runtime — jsPDF 2.5.1, SheetJS 0.18.5 and
ExcelJS 4.4.0. They are **not** bundled.

If cdnjs is unreachable the page still renders completely and the property
search still works, so nothing looks wrong — but every export depends on a
global that never arrived. Before 2026-09-02 each of those buttons threw and
did nothing at all, with no message: `Cannot destructure property 'jsPDF' of
'window.jspdf' as it is undefined`, `XLSX is not defined`, `ExcelJS is not
defined`. `exportLibReady()` now names what failed to load instead. **The
guard is not a substitute for the libraries** — if this recurs in normal use,
vendor the three files into this directory rather than widening the guard.
