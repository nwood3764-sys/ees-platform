# Audit Template Builder — session handoff (2026-08-14)

Long debugging session on the **Audit Template Builder** (`audit-template-builder/frontend/index.html`)
and the **OSM converter** (`audit-template-builder/osm-fixer/osm_fix.py`). Everything below is shipped
to `master` and deployed to `ees-audit-template-builder.netlify.app`.

## What got fixed (all merged, PRs #453–#467)

Verified against the **real 15008 Statesville, Huntersville** building (heat pump, Central DX, electric
water heater) and validated against the BuildingSync 2.6 XSD.

**OSM converter (`osm_fix.py`) + the `osm-fix` skill:**
- Standard repair (fast, deterministic): remove `Schedule:File`, remove "recirc" plant loops (never
  losing a water heater), pin `WaterHeaterMixed` ambient → constant 21 °C schedule, enable HTML output,
  gate on a zero-error forward-translate, preserve the weather file. ~3 s/file.
- **Fan cycling**: DOE models set UnitarySystem supply fans to `Always_On` (24/7) → fans exceed
  heating+cooling and blow up the Audit Template "Other" bucket. Converter now sets the fan operating
  mode to a constant-0 (cycling) schedule.
- A `.claude/skills/osm-fix/SKILL.md` makes future conversions a one-command run.

**XML export (`build50121XML`):**
- Empty `State`/`PostalCode` in the owner block → **schema reject fixed** (omit empty facet-constrained
  elements; `_setOrRemoveInEl` + a final sweep).
- **Two HVAC systems → one**: collapse to a single `HVACSystem` (keep the one with the first heating
  source; delete the rest + orphaned `Delivery`s), then **fully populate the surviving DX cooling**
  (fuel/condition/location/year/qty in XSD order; N/A flags cleared).
- Water heater "No SHW"/AFUE-80 → UEF parse fix (`Water Heater Efficiency 0.89 UEF`); exports 0.89
  **Energy Factor**, electric StorageTank.
- Equipment **year 1988 → 2000** (report Year of Manufacture, not year built) for heating + water heater.
- **WWR** `0.15000000596046448` → clean `0.15` (schema type is decimal; removed the float32 nudge).
- **Door**: stop fabricating `Other`/"Metal door" → real `Insulated metal` (only required >5% wall area).
- **Contacts**: strip the placeholder Energy Auditor contact + its optional `AuditorContactID` ref;
  only the real Owner exports.

## Open / needs the user to verify (next session should start here)

1. **Nicholas must regenerate in the live tool and re-upload to DOE** to confirm every field now reads
   correctly (systems, water heater, years, door, WWR, one system, one contact).
2. **Re-run the fan-corrected 8-unit models** (`35775` baseline, `36520` improved, sent as
   `*_8units_fanfixed.osm`) in OpenStudio to confirm the load shape (fans, "Other") is now sane.
3. **WWR display**: the XML value is a clean decimal `0.15`; if DOE's UI still shows the float32
   expansion, that is a DOE-side rendering quirk, not the file.
4. **DOE contact list cleanup**: the "Mick Pilott – Anura Energy ×15" flood is accumulated in Nicholas's
   DOE account from older-template imports — he cleans that once in DOE; the tool no longer adds junk.
5. **8-unit rebuild path is a one-off**: the 8-unit split was done with an ad-hoc `/tmp/build8.py`
   (not committed). If this building type recurs, consider folding a `--split-units N` option into
   `osm_fix.py` (fan cycling already lives there).
6. **Baseline-only Audit Template export** is still gated on all four files by design (the baseline
   50121 embeds the savings package computed from both models). Revisit only if Nicholas wants a
   report-derived savings path.

## Verification toolkit (recreate in a fresh session)

- **Headless generation**: Playwright at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; stub
  CDN globals (`pdfjsLib`/`JSZip`/`XLSX`/`saveAs`/`html2canvas` via a Proxy, `window.jspdf`), stub
  `fetch` to serve the two `templates/50121_*_template.xml`, then call `build50121XML('baseline')`.
- **Schema validation**: `xmllint --noout --schema /tmp/BuildingSync.xsd <file>` (BuildingSync 2.6 +
  `/tmp/gbxml.xsd`; re-fetch if the scratch files are gone).
- **Real report text**: `pypdf` extracts the Asset Score PDF → parse with the page's `parseAssetScore`.
  The parser is correct; every bug this session was in the XML build, not parsing.
- **OSM inspection**: `openstudio==3.7.0` Python SDK (SDK only, no EnergyPlus — forward-translate to
  check runnability; can't run simulations here).

## Gotcha

Squash-merges make the remote feature branch diverge every PR. Re-sync before each new change:
`git fetch origin master && git checkout -B claude/audit-template-builder-spec-l9jylb origin/master`
(reapply working changes), and push with `--force-with-lease` (the branch's unique commit is always the
just-merged pre-squash one). Commit author must be **Nicholas Wood / nicholas.wood@ees-wi.org**.
