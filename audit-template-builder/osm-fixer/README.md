# OSM Fixer

A tiny standalone tool that repairs DOE Asset Score **OpenStudio models (`.osm`)**
so they translate and run cleanly in EnergyPlus. Upload one or more `.osm`
files, download them corrected. Same spirit as the Audit Template Builder: a
static front-end plus a small backend.

## Why it needs a backend (not pure HTML)

The repair uses the **OpenStudio SDK** (a compiled C++ library) to edit the
model object-graph correctly — you cannot do this safely with text edits in a
browser, because `.osm` files have cross-referencing object handles. So the tool
is two pieces:

- **`frontend/`** — a static upload/download page (deploy anywhere; e.g. Netlify).
- **`service/`** — a small Flask app that holds the OpenStudio SDK and does the
  repair. Deploy once as a container (e.g. Fly.io / Railway).

The service only **repairs and translates** models — it does **not** run
EnergyPlus, so it doesn't need the EnergyPlus engine (the `openstudio` pip wheel
bundles the SDK alone). Running the corrected model is done by you in OpenStudio
/ your existing runner.

## What it does to each model

1. Removes the water-heater **recirculation `PlantLoop`** (name contains
   "recirc") — the loop that fails EnergyPlus translation. The water heater on
   the main loop is preserved (the repair aborts if a heater would be removed).
2. Pins each `WaterHeaterMixed` **ambient temperature** to a constant 21 °C
   schedule (a `ThermalZone` ambient is the other known translation failure).
3. Removes any `Schedule:File` objects (dangling external-CSV references crash
   EnergyPlus).
4. Enables **HTML results output** — `OutputControl:Table:Style = HTMLandColumns`,
   the `AllSummary` report, and monthly end-use meters — so a run produces the
   `eplustbl.htm` the Audit Template Builder consumes.
5. **Forward-translates the corrected model to IDF and requires zero errors**
   before returning it — so what you download is verified runnable.

The weather-file reference in the model is preserved unchanged (e.g.
`/app/weather/WeatherData/USA_WI_...epw`). Make sure that EPW exists at that path
when you run the model, or repoint the weather file in OpenStudio first.

## Version note

The service pins **`openstudio==3.7.0`** to match the current models. The SDK
version must be **>= the uploaded model's version**; older models are
auto-upgraded by the VersionTranslator. If you start producing models on a newer
OpenStudio, bump the pin in `service/requirements.txt` to match.

## Deploy runbook

### 1. The service (Fly.io example — scale-to-zero, ~free idle)

```bash
cd audit-template-builder/osm-fixer/service
fly launch --no-deploy          # creates the app; keep internal port 8080
fly secrets set ALLOWED_ORIGIN="https://<your-frontend-site>"   # lock CORS to the page
fly deploy
fly status                      # note the https URL, e.g. https://osm-fixer.fly.dev
```

(Railway/Render work the same way — point them at `service/Dockerfile`, expose
port 8080, set `ALLOWED_ORIGIN`.)

Verify: `curl https://<service-url>/health` → `{"ok":true,"sdk":"3.7.0"}`.

### 2. The front-end (Netlify example)

1. Set the service URL: edit `frontend/config.js` →
   `window.OSM_FIXER_URL = "https://<service-url>";`
2. Deploy `frontend/` as its own Netlify site (publish directory `.`, no build).
   Optionally password-protect it like the Audit Template Builder.

### 3. Use it

Open the site → drop `.osm` files → **Fix & download**. One file returns a
corrected `.osm`; multiple return a `.zip` (plus a `repair_summary.json`).

## Local development

```bash
cd audit-template-builder/osm-fixer/service
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python app.py                    # serves on :8080
```

Then set `window.OSM_FIXER_URL = "http://localhost:8080"` in `frontend/config.js`
and open `frontend/index.html`.

## API

- `GET /health` → `{"ok": true, "sdk": "<version>"}`
- `POST /fix` — multipart form, one or more `.osm` files (any field names).
  Returns a single corrected `.osm` (one input) or a `.zip` of corrected models
  + `repair_summary.json` (multiple). For a single file the repair summary is
  also in the `X-OSM-Fixer-Summary` response header (JSON).
