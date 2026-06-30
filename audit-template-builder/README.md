# Audit Template Builder

A standalone web app that turns DOE Asset Score + OpenStudio inputs into DOE
**Audit Template** (BuildingSync 2.6.0 XML) + **Portfolio Manager utility**
(xlsx) outputs for the IRA HOMES 50121 program, with all energy scaled to match
the Asset Score EUI.

> **Standalone by design.** This app is completely separate from the LEAP
> platform and its Supabase project. It has its own Netlify site and (optionally)
> its own backend. LEAP integration is a deliberate later step — do not wire this
> into LEAP production.

## What it does

Upload four files for one building — two Asset Score Report PDFs (baseline +
improved) and two OpenStudio inputs (baseline + improved) — and the app produces:

- Baseline + improved **Audit Template** BuildingSync 2.6.0 XML (each separately
  importable as its own building record),
- Baseline + improved **utility xlsx** in Portfolio Manager's "Energy Use By
  Calendar Month" format, and
- On-screen **copy-paste field cards** for the Audit Template / Benchmarking
  screens.

The core feature: OpenStudio and Asset Score use different engines and don't
agree, and the Asset Score is the document of record — so each fuel's monthly
profile is scaled to hit the Asset Score per-fuel EUI × floor area, preserving
monthly shape. The resulting EUI reads exactly what's on the Asset Score PDF.

The OpenStudio input can be either the **Results HTML** (already simulated, parsed
in-browser) or a raw **`.osm`** model (sent to the runner, which runs EnergyPlus).

## Architecture

```
  frontend/ (static, Netlify)            runner/ (container, Fly.io)
  ┌──────────────────────────┐  POST .osm  ┌───────────────────────────┐
  │ index.html               │ ──────────► │ Flask /run-osm            │
  │  - pdf.js Asset Score     │             │  - repairs the .osm        │
  │  - parse Results HTML      │ ◄────────── │  - runs EnergyPlus 25.2.0  │
  │  - scale energy to EUI     │  results    │  - returns results JSON    │
  │  - build XML + xlsx        │   JSON      └───────────────────────────┘
  └──────────────────────────┘
```

- **`frontend/`** — the whole app. Static HTML, pdf.js + SheetJS from a CDN, no
  build step. Works with **zero backend** when you upload Results HTML; the
  runner is only needed for the `.osm` path.
- **`runner/`** — containerized EnergyPlus 25.2.0 + OpenStudio SDK 3.11.0. Only
  exists to simulate a raw `.osm`. See `runner/README.md`.
- **`validation/`** — offline BuildingSync 2.6.0 XSD check for generated XML.

## Deploy runbook

1. **Runner** (only needed for the `.osm` path):
   ```bash
   cd runner
   fly launch --no-deploy      # set the app name in fly.toml first
   fly secrets set ALLOWED_ORIGIN="https://audit-template.ees-wi.org"
   fly deploy
   curl https://<app>.fly.dev/health     # -> ok
   ```
2. **Front end**: set `window.AUDIT_RUNNER_URL` in `frontend/config.js` to the
   Fly URL (leave `""` to disable the `.osm` path). Deploy `frontend/` as its
   **own** Netlify site (e.g. `audit-template.ees-wi.org`) — not the LEAP site.
3. **End-to-end check**: upload 4 files (PDF ×2, `.osm` or Results HTML ×2) →
   download XML ×2 + xlsx ×2 → confirm the EUI matches the Asset Score PDF and
   the XML imports into the DOE Audit Template.

## Conversions & constants (verified, do not re-derive)

- 1 kWh = 3.412 kBtu; 1 therm = 100 kBtu; OpenStudio "MBtu" = MMBtu (×10 = therms).
- EIA WI residential rates: $0.188/kWh, $0.97/therm (cost is for completeness;
  HOMES rebate uses MMBtu savings, not cost).
- BuildingSync namespace `http://buildingsync.net/schemas/bedes-auc/2019`,
  version 2.6.0.

## Notes / gotchas

- Floor area uses the Asset Score page-1 (laser) value, not the block-derived
  later-page figure.
- Conditioned Heated/Cooled area and General Building Shape are **not** on any
  input file — the front end shows them as confirm-prompts, never auto-filled.
- Metered scenarios get dropped on Audit Template XML import — which is why the
  utility xlsx carries the monthly data.
- The utility xlsx sheet must be named `Consumption Info` with the exact row-6
  headers (including the embedded newline) or ESPM rejects it.

## Known follow-ups (pre-existing in the ported front end)

`buildSingleXML()` currently hardcodes `FloorsAboveGrade = 2` and the time-series
`year = 2024`, although `floorsAbove` is parsed from the PDF and the metered
window is computed from today's date elsewhere. These were carried over verbatim
from the original `index.html` ("port as-is"); fixing them to use the parsed
`floorsAbove` and the metered window's year is a recommended one-line follow-up.
