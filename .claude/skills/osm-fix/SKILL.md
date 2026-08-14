---
name: osm-fix
description: Repair DOE Asset Score OpenStudio (.osm) models so they run in OpenStudio/EnergyPlus. Use whenever the user uploads or points at .osm file(s) and asks to convert, fix, repair, or "make it run." Fixes the water-heater failures (ambient temp, recirc loops), removes dangling Schedule:File refs, enables HTML output, and verifies a clean forward-translate. Fast and deterministic — do NOT re-derive the repair.
---

# OSM Fix — convert DOE Asset Score models so they run

The repair is a **single deterministic script run (~3 seconds per file)**. Do not
explore, diagnose by hand, or re-derive anything for the normal case. Just run it.

## Do this

```
python audit-template-builder/osm-fixer/osm_fix.py -o <scratchpad_dir> <uploaded.osm> [more.osm ...]
```

It writes `<name>.fixed.osm` for each input and prints a JSON summary. Then:

1. Confirm each result shows `"runnable": true` and `"translate_errors": []`.
2. Send the `.fixed.osm` file(s) back with `SendUserFile` (display: attach).
3. One-line report: water heaters fixed, recirc loops removed (if any), weather
   file preserved, 0 translation errors. Done.

Requires `pip install openstudio==3.7.0` (SDK only; already available in this
environment). The script pins nothing itself — if a model is newer than the SDK,
it says so; bump the pin in `audit-template-builder/osm-fixer/service/requirements.txt`.

## What the script does (so you can explain it if asked)

1. Removes `Schedule:File` objects (dangling external-CSV refs crash EnergyPlus).
2. Removes `PlantLoop`s whose name contains "recirc" — **aborts if a water heater
   would be lost** (never deletes equipment).
3. Pins every `WaterHeaterMixed` ambient temperature to a constant 21 °C schedule
   (ambient tied to a `ThermalZone` is the usual EnergyPlus run-time failure — it
   often translates fine but won't run).
4. Enables HTML results (`HTMLandColumns` + `AllSummary` + monthly meters).
5. Forward-translates to IDF and only reports `runnable` when there are 0 errors.
   The weather file is preserved unchanged.

Two `[utilities.idf.WorkspaceObject] ... "Always On/Off ... cannot be located"`
messages are **normal** — the translator auto-generates those schedules; they are
not errors and don't block the run.

## Only if a model still fails (`runnable: false`)

Then diagnose — read the actual `translate_errors`, find the class of failure
(usually an ambient ThermalZone, a Schedule:File, or a plant-loop node), extend
`audit-template-builder/osm-fixer/osm_fix.py` to fix that *category*, and re-run.
Add a comment for the new failure mode so the script accumulates the knowledge.

## Re-modeling (NOT the default — only when explicitly asked)

Splitting the DOE zoning into individual units (e.g. "make it 8 separate units,
each with its own HVAC + water heater") is a **separate, explicit** request, not
part of a normal conversion. When asked:
- Preserve the whole-building totals exactly: floor area, exterior wall/window/roof
  area, internal loads, **total DHW draw** (split it — never duplicate, or you
  double the hot-water energy), and total water-heater volume/capacity.
- HVAC is autosized, so cloned air loops resize to their zones automatically.
- `airLoop.clone(model)` + `addBranchForZone(zone)` clones a ducted air handler
  onto a new zone; `plantLoop.clone(model)` clones the water-heater supply side
  (pump + heater + setpoint mgr) with an empty demand side — add a
  `WaterUseConnections` + `WaterUseEquipment` for the unit's own draw.
- Verify before/after totals match and forward-translate is clean before sending.
