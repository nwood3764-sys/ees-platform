# Audit Template XML — generate and validate offline

Two scripts that together let you reproduce and check the 50121 XML the front end
produces without clicking through the live tool. Use them whenever a field in the
DOE Audit Template reads wrong: regenerate here, inspect the XML, fix
`build50121XML` in `frontend/index.html`, regenerate, confirm.

```bash
pip install lxml requests playwright pypdf
```

## 1. Generate — `generate_50121.py`

Runs `build50121XML()` headlessly. It serves `frontend/` over localhost, loads
`index.html` in Chromium with the blocked CDN scripts stubbed (nothing in the XML
path uses them), feeds in the four source documents, and writes both XMLs.

```bash
python generate_50121.py \
  --as-base Baseline_AssetScore.pdf --as-imp Improved_AssetScore.pdf \
  --os-base baseline_results.html   --os-imp improved_results.html \
  --out /tmp/xml --dump-parsed
```

- Asset Score PDFs are text-extracted with `pypdf` and reassembled line-by-line
  the way pdf.js does (group by y, sort by x), so `parseAssetScore` sees the same
  text the browser gives it. `--as-base-text` / `--as-imp-text` take pre-extracted
  text instead.
- OpenStudio inputs are the **Results HTML** reports. A raw `.osm` needs the
  EnergyPlus runner (see `../runner/`); this script does not call it.
- `--fixture fixture_example.json` skips parsing entirely and injects
  `{asBase, asImp, osBase, osImp}` directly — useful for isolating an XML-build
  bug from a parsing bug, and for a quick smoke test with no source files.
- `--dump-parsed` also writes `parsed-data.json`, i.e. exactly what
  `build50121XML` read. If a value is wrong there, the bug is in the parser; if it
  is right there and wrong in the XML, the bug is in the XML build.
- Set `CHROMIUM_PATH` to use a pre-installed browser instead of a
  Playwright-managed download; otherwise a `/opt/pw-browsers/chromium*` build is
  picked up automatically.

## 2. Validate — `validate_buildingsync.py`

```bash
python validate_buildingsync.py /tmp/xml/baseline_50121.xml
```

Checks against BuildingSync 2.6.0, fully offline after a one-time download. It
caches `BuildingSync.xsd` and the gbXML 6.01 schema it imports under
`.schema-cache/` (git-ignored) and repoints the gbXML import at the local copy.

Use this rather than calling `xmllint` against the cached XSD directly — the
cached schema still carries a remote `schemaLocation` for the gbXML import, so
`xmllint` fails to compile it. This script does the rewrite.

## Scope

Both are structural checks. The authoritative acceptance test is importing the
XML into the DOE Audit Template under **Buildings → Import**; some import-dialect
behaviors (e.g. metered scenarios being dropped on import) are not expressed in
the XSD.
