---
name: osm-fix
description: Repair DOE Asset Score OpenStudio (.osm) models so they run in OpenStudio/EnergyPlus. Use whenever the user uploads or points at .osm file(s) and asks to convert, fix, repair, or "make it run." Fixes the water-heater failures (ambient temp, recirc loops), lets 24/7 supply fans cycle, removes dangling Schedule:File refs, enables HTML output, and verifies a clean forward-translate. Fast and deterministic — do NOT re-derive the repair.
---

# OSM Fix — repair a DOE Asset Score model so it runs

**The job is: file in, one fixed file out.** The user is going to open the result
in OpenStudio and run it. They are not asking for an analysis, a choice, or a
tour of the repo. Do the repair and hand back the file.

## Do this

**1. Make sure the SDK matches the model.** A fresh container has no
`openstudio` at all, and the version must be **>= the model's own version** or
it refuses to load (`Version extracted from file '3.11.0' is not supported`).
Line 3 of any `.osm` is its version identifier:

```
head -3 <uploaded.osm>                  # -> e.g. 3.11.0
pip install openstudio==3.11.0          # install >= that version
```

**2. Run the fixer.** One deterministic script run, ~3 s per file:

```
python audit-template-builder/osm-fixer/osm_fix.py -o <outdir> <uploaded.osm> [more.osm ...]
```

**3. Confirm** each result shows `"runnable": true` and `"translate_errors": []`.

**4. Rename the output to something the user can recognise** — the model id and
the building, e.g. `36630_5513_N_Hopkins_FIXED.osm`. The upload's own name is a
UUID hash and is useless to them.

**5. Send exactly one file per input** with `SendUserFile` (`display: attach`).

**6. Report in a few lines**: what was fixed, one line each, then "open it in
OpenStudio and run it; send me any errors and I'll fix them and send a new
file." Nothing else.

## Hard rules for the hand-back

- **One file. Never a choice.** Do not produce variants, do not ask which one
  they want, do not hand back a fork for the user to adjudicate. If there is a
  judgment call, make it — the standard repair is always the right default —
  and note the consequence in one sentence at the end.
- **Never mention repo internals.** The hosted fixer service, PR numbers,
  `osm_fix.py` internals, commits, the skill file itself: none of that is what
  the user is doing. They uploaded a model and want it back working.
- **Don't explain unless asked.** Name the defects that were fixed in one line
  each. Save the mechanism for when they ask "why."
- **Never tell them to run it and report back as a substitute for finishing.**
  If the fixer reports `runnable: false`, diagnose and fix it before sending
  anything (see below).

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

## The two fan settings, because they get confused

A PTAC/PTHP has an **availability schedule** ("is the unit allowed to run" —
correctly on 24/7 in an apartment; never touch it) and a **supply air fan
operating mode schedule**, which is *not* a run schedule at all. It is the
FAN ON / FAN AUTO switch: `>0` = blower runs continuously whenever the unit is
available, `0` = blower cycles with the coil. DOE ships `Always_On`, so the fan
ran every hour of the year while only the coil followed the load. The repair
sets fan-auto, which is what the real equipment does.

Consequence worth stating once if the user asks: these PTACs also carry an
autosized outdoor-air rate, so cycling the fan means outdoor air now enters only
when the unit runs. Modeled heating load drops along with fan energy. That is
the correction, not a new error.

## Central DHW — what the recirc loop is, and what removing it costs

Why those loops fail: the generator puts the **circulating pump alone on the
supply side** and the **water heater on the demand side** (connected through the
tank's *source* side, i.e. "this loop feeds heat to the tank"). The result is a
heating plant loop carrying a setpoint manager and a design exit temperature
with **no heat source on its supply side** — it can never meet setpoint. The
tank is fine; it lives on its own service loop, which is why deleting the recirc
loop is safe and never removes equipment.

What removing it costs: the loop also carries the `Pipe:Indoor` representing the
building's **uninsulated hot-water distribution main** — on a central-DHW
multifamily building that is hundreds of metres of pipe, and its standby loss is
a large share of annual DHW energy. Remove it and the model runs but
**under-reports DHW**, which matters when the output is an audit report.

`--preserve-recirc` re-creates that pipe (same construction, diameter, length,
ambient zone) as a parallel branch on the **demand** side of the loop the tank
actually serves, so the loss becomes a load the tank makes up — which is what a
recirculation loop physically is.

**Do NOT offer this unprompted, and never send it as a second file.** Ship the
standard repair, and close with one line: if DHW gas reads low in the report,
the deleted distribution piping is why and it can be put back. Only run
`--preserve-recirc` if they come back and say the number is low. It is
**unverified by simulation** — whether the demand branch draws enough flow for
the loss to register at full magnitude is unknown — so say that when you use it.

## No EnergyPlus in this environment

There is no E+ binary and **none can be installed**: the GitHub release assets
are blocked by the sandbox network policy (403 from the proxy, not from GitHub)
and there is no PyPI build. The gate is therefore a zero-error forward-translate,
not a simulation. Never claim a model "ran" or quote energy results. The user
runs it in OpenStudio; that is the workflow.

If they want simulations run here, the fix is to widen the environment's network
policy or bake EnergyPlus into the container image — offer that, don't improvise.

## Only if a model still fails (`runnable: false`)

Then diagnose before sending anything. Read the actual `translate_errors`, find
the class of failure (usually an ambient ThermalZone, a Schedule:File, or a
plant-loop node), extend `audit-template-builder/osm-fixer/osm_fix.py` to fix
that *category*, and re-run. Add a comment for the new failure mode so the
script accumulates the knowledge, and update this file.

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
