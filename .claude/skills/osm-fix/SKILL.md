---
name: osm-fix
description: Repair DOE Asset Score OpenStudio (.osm) models so they run in OpenStudio/EnergyPlus. Use whenever the user uploads or points at .osm file(s) and asks to convert, fix, repair, or "make it run." Fixes the water-heater failures (ambient temp, recirc loops), lets 24/7 supply fans cycle, removes dangling Schedule:File refs, enables HTML output, and verifies a clean forward-translate. Fast and deterministic — do NOT re-derive the repair.
---

# OSM Fix — convert DOE Asset Score models so they run

The repair is a **single deterministic script run (~3 seconds per file)**. Do not
explore, diagnose by hand, or re-derive anything for the normal case. Just run it.

## Do this

```
python audit-template-builder/osm-fixer/osm_fix.py -o <scratchpad_dir> <uploaded.osm> [more.osm ...]
```

Add `--preserve-recirc` when the building has **central domestic hot water**
(see "Central DHW" below) — it writes `<name>.recirc.fixed.osm` alongside.

It writes `<name>.fixed.osm` for each input and prints a JSON summary. Then:

1. Confirm each result shows `"runnable": true` and `"translate_errors": []`.
2. Send the `.fixed.osm` file(s) back with `SendUserFile` (display: attach).
3. One-line report: water heaters fixed, recirc loops removed (if any), weather
   file preserved, 0 translation errors. Done.

Requires `pip install openstudio==3.11.0` (SDK only). **A fresh container does
not have it — install it first**, and install a version **>= the model's own
version** (line 3 of the .osm is the version identifier). The script pins
nothing itself: a newer-than-SDK model is refused with a clear message; bump
`audit-template-builder/osm-fixer/service/requirements.txt` when models move up.

There is **no EnergyPlus binary in this environment and none can be installed**
(the GitHub release assets are blocked by the network policy and there is no
PyPI build). So the gate is a zero-error forward-translate, not a simulation —
say so rather than claiming a model "ran".

## What the script does (so you can explain it if asked)

1. Removes `Schedule:File` objects (dangling external-CSV refs crash EnergyPlus).
2. Removes `PlantLoop`s whose name contains "recirc" — **aborts if a water heater
   would be lost** (never deletes equipment).
3. Pins every `WaterHeaterMixed` ambient temperature to a constant 21 °C schedule
   (ambient tied to a `ThermalZone` is the usual EnergyPlus run-time failure — it
   often translates fine but won't run).
4. Lets cyclable supply fans cycle with their coil instead of running 8,760 h/yr:
   `AirLoopHVAC:UnitarySystem` (clear the schedule — a 0-value schedule is a
   RUN-time fatal there), and `ZoneHVAC:PackagedTerminal{HeatPump,AirConditioner}`
   (0-value schedule, which those DO accept). **PTAC matters**: a multifamily
   Asset Score model is PTAC + electric baseboard with no air loop and no
   UnitarySystem anywhere, so a fixer that only knew UnitarySystem/PTHP left
   every apartment building's fans running 24/7 and blew up the "Other" bucket.
5. Enables HTML results (`HTMLandColumns` + `AllSummary` + monthly meters).
6. Forward-translates to IDF and only reports `runnable` when there are 0 errors.
   The weather file is preserved unchanged.

Two `[utilities.idf.WorkspaceObject] ... "Always On/Off ... cannot be located"`
messages are **normal** — the translator auto-generates those schedules; they are
not errors and don't block the run.

## Central DHW — what the recirc loop actually is, and what deleting it costs

Why those loops fail: the generator puts the **circulating pump alone on the
supply side** and the **water heater on the demand side** (connected through the
tank's *source* side, i.e. "this loop feeds heat to the tank"). The result is a
heating plant loop carrying a setpoint manager and a design exit temperature
with **no heat source on its supply side** — it can never meet setpoint. The
tank is fine; it lives on its own service loop, which is why deleting the recirc
loop is safe and never removes equipment.

What deleting it costs: the loop also carries the `Pipe:Indoor` that represents
the building's **uninsulated hot-water distribution main** — on a central-DHW
multifamily building that is hundreds of metres of pipe, and its standby loss is
a large share of annual DHW energy. Delete it and the model runs but
**under-reports DHW**, which matters when the output is an audit report.

`--preserve-recirc` re-creates that pipe (same construction, diameter, length,
ambient zone) as a parallel branch on the **demand** side of the loop the tank
actually serves, so the loss becomes a load the tank makes up — which is what a
recirculation loop physically is. A pipe on a demand branch is an ordinary
construct (every plant loop already carries a `Pipe:Adiabatic` demand bypass).
**Unverified without an EnergyPlus run**: whether the demand branch draws enough
flow for the pipe's loss to register at full magnitude. Tell the user to compare
`WaterSystems:NaturalGas` between the two files on their own run.

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
