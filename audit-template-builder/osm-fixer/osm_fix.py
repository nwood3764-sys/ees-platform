#!/usr/bin/env python3
"""osm_fix.py — repair DOE Asset Score OpenStudio models so they RUN.

Standard, deterministic repair (runs in seconds, no analysis needed):
  1. Remove Schedule:File objects (dangling external-CSV refs crash E+).
  2. Remove "recirc" PlantLoops — but abort if a water heater would be lost.
     (The generator emits them with the pump alone on the supply side and the
     tank on the demand side, so the loop has no heat source; see repair().)
  3. Pin every WaterHeaterMixed ambient temperature to a constant 21 C schedule
     (WaterHeater ambient tied to a ThermalZone is the usual run-time failure).
  4. Let cyclable supply fans cycle with their coil instead of running 24/7
     (UnitarySystem, PTHP and PTAC — the last covers multifamily models, which
     have no air loop at all).
  5. Enable HTML results (HTMLandColumns + AllSummary + monthly meters) so a run
     produces eplustbl.htm.
  6. Forward-translate to IDF and REQUIRE zero errors before writing "runnable".
The weather file is preserved unchanged.

Usage:
    python osm_fix.py model.osm [more.osm ...]        # writes <name>.fixed.osm
    python osm_fix.py -o OUTDIR *.osm                 # write fixed files to OUTDIR
    python osm_fix.py --check model.osm               # diagnose only, write nothing
    python osm_fix.py --preserve-recirc model.osm     # keep central-DHW recirc
                                                      # distribution losses

Requires: pip install openstudio==3.11.0   (SDK only; no EnergyPlus needed)
"""
import argparse, json, os, sys
from collections import Counter

try:
    import openstudio
except ImportError:
    sys.exit("openstudio not installed. Run:  pip install openstudio==3.11.0")

AMB_C = 21.0


def _load(path):
    m = openstudio.model.Model.load(path)
    if m.is_initialized():
        return m.get(), None
    tr = openstudio.osversion.VersionTranslator()
    m = tr.loadModel(path)
    if m.is_initialized():
        return m.get(), "version-translated to %s" % openstudio.openStudioVersion()
    raise ValueError(
        "Could not load model — it may be newer than the installed OpenStudio SDK "
        "(%s). Install an SDK >= the model version." % openstudio.openStudioVersion())


def _translate_errors(model):
    ft = openstudio.energyplus.ForwardTranslator()
    ws = ft.translateModel(model)
    return [e.logMessage() for e in ft.errors()], len(ws.objects())


def _capture_recirc_distribution_pipes(model):
    """Record the distribution piping on each "recirc" loop, and which service
    loop its water heater actually serves, BEFORE the recirc loop is removed."""
    carried = []
    for pl in model.getPlantLoops():
        if "recirc" not in pl.nameString().lower():
            continue
        comps = list(pl.supplyComponents()) + list(pl.demandComponents())
        # The tank's use-side loop (plantLoop()) is the DHW service loop; the
        # recirc loop is its source-side loop, so skip that one.
        service = None
        for c in comps:
            w = c.to_WaterHeaterMixed()
            if w.is_initialized() and w.get().plantLoop().is_initialized():
                cand = w.get().plantLoop().get()
                if cand.handle().__str__() != pl.handle().__str__():
                    service = cand
                    break
        for c in comps:
            p = c.to_PipeIndoor()
            if not p.is_initialized():
                continue
            p = p.get()
            carried.append({
                "name": p.nameString(), "from_loop": pl.nameString(),
                "service": service, "construction": p.construction(),
                "zone": p.ambientTemperatureZone(),
                "diameter_m": p.pipeInsideDiameter(), "length_m": p.pipeLength(),
            })
    return carried


def _restore_recirc_distribution_pipes(model, carried):
    """Re-create captured distribution pipes on the DEMAND side of the service
    loop. Returns a list of what was kept (or why it could not be)."""
    kept = []
    for c in carried:
        if c["service"] is None:
            kept.append({"pipe": c["name"], "kept": False,
                         "reason": "no service loop found for the water heater"})
            continue
        np_ = openstudio.model.PipeIndoor(model)
        np_.setName("%s (recirculation losses)" % c["name"])
        if c["construction"].is_initialized():
            np_.setConstruction(c["construction"].get())
        np_.setPipeInsideDiameter(c["diameter_m"])
        np_.setPipeLength(c["length_m"])
        if c["zone"].is_initialized():
            np_.setEnvironmentType("Zone")
            np_.setAmbientTemperatureZone(c["zone"].get())
        ok = c["service"].addDemandBranchForComponent(np_)
        if not ok:
            np_.remove()
        kept.append({"pipe": c["name"], "kept": bool(ok),
                     "length_m": round(c["length_m"], 1),
                     "moved_to": c["service"].nameString()})
    return kept


def repair(model, preserve_recirc=False):
    """Apply the standard repairs in place. Returns a summary dict.

    preserve_recirc=True additionally carries a central-DHW recirculation loop's
    distribution-loss piping onto the service loop before the broken loop is
    deleted (see step 2b), so the tank still pays for those losses.
    """
    s = {"sdk": openstudio.openStudioVersion()}

    # 1. Schedule:File
    sf = model.getScheduleFiles(); s["schedule_file_removed"] = len(sf)
    for x in list(sf):
        x.remove()

    # 2. recirc plant loops (guard water heaters)
    #
    # What is actually wrong with them: on a CENTRAL DHW building the Asset
    # Score generator emits the recirculation loop with the circulating pump
    # alone on the SUPPLY side and the water heater on the DEMAND side (i.e.
    # connected through the tank's SOURCE side, which means "this loop feeds
    # heat to the tank"). So the loop is a heating plant loop with a setpoint
    # manager, a design exit temperature and NO heat source on its supply side.
    # It has nothing that can meet the setpoint, which is why the model dies.
    # Deleting the loop is the deterministic fix and never removes equipment —
    # the tank stays on its own service loop (guarded below).
    before = {w.handle().__str__() for w in model.getWaterHeaterMixeds()}
    carried = _capture_recirc_distribution_pipes(model) if preserve_recirc else []
    removed = []
    for pl in list(model.getPlantLoops()):
        if "recirc" in pl.nameString().lower():
            removed.append(pl.nameString()); pl.remove()
    lost = before - {w.handle().__str__() for w in model.getWaterHeaterMixeds()}
    if lost:
        raise ValueError("Aborted: removing the recirc loop would delete a water "
                         "heater (%s). Model left unchanged." % ", ".join(lost))
    s["recirc_loops_removed"] = removed

    # 2b. Optional: keep the recirculation DISTRIBUTION LOSSES.
    #
    # The deleted loop carries the Pipe:Indoor that represents the building's
    # uninsulated hot-water distribution main — on a central-DHW multifamily
    # building that pipe is hundreds of metres long and its standby loss is a
    # large share of annual DHW energy. Dropping the loop drops that load, so
    # the model runs but UNDER-reports DHW. Re-create the pipe as a parallel
    # branch on the DEMAND side of the loop the tank actually serves: the loss
    # then becomes a load the tank has to make up, which is what a recirc loop
    # physically is. (A pipe on a demand branch is an ordinary construct — every
    # plant loop already carries a Pipe:Adiabatic demand bypass.)
    s["recirc_distribution_pipes_kept"] = _restore_recirc_distribution_pipes(
        model, carried) if preserve_recirc else []

    # 3. WaterHeaterMixed ambient -> constant 21 C schedule
    amb = openstudio.model.ScheduleConstant(model)
    amb.setName("WH Ambient 21C (repair)"); amb.setValue(AMB_C)
    tl = openstudio.model.ScheduleTypeLimits(model)
    tl.setName("Temperature (repair)"); tl.setUnitType("Temperature")
    amb.setScheduleTypeLimits(tl)
    n = 0
    for w in model.getWaterHeaterMixeds():
        w.setAmbientTemperatureIndicator("Schedule")
        w.setAmbientTemperatureSchedule(amb)
        try:
            w.resetAmbientTemperatureThermalZone()
        except Exception:
            pass
        n += 1
    s["water_heaters_fixed"] = n

    # 3b. Fan operating mode. DOE Asset Score models set each UnitarySystem's
    # supply-fan operating mode to "Always_On" (continuous), so the fan runs 24/7
    # and its energy can swamp the real heating/cooling load shape. Let cyclable
    # fans cycle with the coil — but the EnergyPlus-VALID way, which differs by
    # component:
    #   * AirLoopHVAC:UnitarySystem — CLEAR the operating-mode schedule. A blank
    #     schedule means "cycle with the coil". Assigning a constant-0 schedule
    #     instead makes E+ fatal at RUN time (verified on real files):
    #       "UnitarySys::processInputSpec ... Supply Air Fan Operating Mode
    #        Schedule ... contains values that are <= 0 and/or > 1"
    #       "Fatal: getUnitarySystemInputData: previous errors cause termination"
    #     — it passes forward-translation but dies in the simulation. (0 is a
    #     rejected VALUE here, not the way to request cycling.)
    #   * PTAC/PTHP zone units REQUIRE an operating-mode schedule; for those a
    #     0-value schedule = cycle with the coil (a different E+ input path that
    #     accepts 0). BOTH kinds must be covered: a DOE Asset Score multifamily
    #     model is PTAC + electric baseboard with NO air loop and NO
    #     UnitarySystem anywhere, and every PTAC ships with operating mode
    #     "Always_On", so its fan runs 8,760 h/yr regardless of coil demand.
    #     Handling only PTHP left that whole building type unfixed.
    # Only a Fan:OnOff can cycle; a Fan:ConstantVolume must stay continuous, so
    # leave it alone (townhome furnace + split-AC systems use Fan:ConstantVolume).
    def _fan_can_cycle(fan):
        # Accept either an HVACComponent or an optional<HVACComponent>; only a
        # Fan:OnOff may run in a cycling operating mode.
        if hasattr(fan, "is_initialized"):
            if not fan.is_initialized():
                return False
            fan = fan.get()
        return fan.to_FanOnOff().is_initialized()

    nf = 0
    cv = 0
    for u in model.getAirLoopHVACUnitarySystems():
        if _fan_can_cycle(u.supplyFan()):
            try:
                u.resetSupplyAirFanOperatingModeSchedule(); nf += 1   # blank = cycle
            except Exception:
                pass
        else:
            cv += 1
    # PTAC/PTHP zone units: 0-value schedule = cycle (the schedule is required).
    ptunits = [(u, u.supplyAirFan()) for u in
               model.getZoneHVACPackagedTerminalHeatPumps()]
    ptunits += [(u, u.supplyAirFan()) for u in
                model.getZoneHVACPackagedTerminalAirConditioners()]
    if ptunits:
        cyc = openstudio.model.ScheduleConstant(model)
        cyc.setName("Fan Cycling (repair)"); cyc.setValue(0.0)
        ftl = openstudio.model.ScheduleTypeLimits(model)   # proper 0/1 mode limits
        ftl.setName("Fan Operating Mode (repair)")
        ftl.setLowerLimitValue(0.0); ftl.setUpperLimitValue(1.0)
        ftl.setNumericType("Discrete"); ftl.setUnitType("Availability")
        cyc.setScheduleTypeLimits(ftl)
        used = 0
        for u, fan in ptunits:
            if _fan_can_cycle(fan):
                try:
                    u.setSupplyAirFanOperatingModeSchedule(cyc); nf += 1; used += 1
                except Exception:
                    pass
            else:
                cv += 1
        if used == 0:
            cyc.remove(); ftl.remove()
    s["fans_set_to_cycling"] = nf
    s["constant_volume_fans_left_continuous"] = cv

    # 4. HTML output + AllSummary + monthly meters
    ots = model.getOutputControlTableStyle()
    ots.setColumnSeparator("HTMLandColumns"); ots.setUnitConversion("None")
    srep = model.getOutputTableSummaryReports()
    if not any(g.getString(0).get() == "AllSummary" for g in srep.extensibleGroups()):
        srep.pushExtensibleGroup(["AllSummary"])
    for fuel in ("Electricity:Facility", "NaturalGas:Facility", "Heating:Electricity",
                 "Cooling:Electricity", "InteriorLights:Electricity",
                 "InteriorEquipment:Electricity", "Fans:Electricity", "Pumps:Electricity",
                 "WaterSystems:Electricity", "Heating:NaturalGas", "WaterSystems:NaturalGas"):
        mt = openstudio.model.OutputMeter(model); mt.setName(fuel)
        mt.setReportingFrequency("Monthly")
    model.getSimulationControl().setRunSimulationforWeatherFileRunPeriods(True)
    return s


def process(path, outdir=None, check=False, preserve_recirc=False):
    model, note = _load(path)
    base = os.path.basename(path)
    if check:
        errs, nobj = _translate_errors(model)
        return {"file": base, "note": note,
                "water_heaters": len(model.getWaterHeaterMixeds()),
                "wh_ambient": dict(Counter(w.ambientTemperatureIndicator()
                                           for w in model.getWaterHeaterMixeds())),
                "recirc_loops": [p.nameString() for p in model.getPlantLoops()
                                 if "recirc" in p.nameString().lower()],
                "translate_errors": errs, "idf_objects": nobj,
                "runnable": len(errs) == 0}
    s = repair(model, preserve_recirc=preserve_recirc)
    s["file"] = base; s["note"] = note
    stem = base[:-4] if base.lower().endswith(".osm") else base
    if preserve_recirc:
        stem += ".recirc"
    out = os.path.join(outdir, stem + ".fixed.osm") if outdir else \
        os.path.join(os.path.dirname(path), stem + ".fixed.osm")
    if not model.save(out, True):
        raise ValueError("failed to write %s" % out)
    errs, nobj = _translate_errors(model)
    wf = model.weatherFile()
    s["weather_file"] = wf.get().path().get().__str__() if (
        wf.is_initialized() and wf.get().path().is_initialized()) else None
    s["translate_errors"] = errs; s["idf_objects"] = nobj
    s["runnable"] = len(errs) == 0; s["output"] = out
    return s


def main():
    ap = argparse.ArgumentParser(description="Repair DOE Asset Score .osm files so they run.")
    ap.add_argument("files", nargs="+", help="one or more .osm files")
    ap.add_argument("-o", "--outdir", help="write fixed files here (default: beside each input)")
    ap.add_argument("--check", action="store_true", help="diagnose only; write nothing")
    ap.add_argument("--preserve-recirc", action="store_true",
                    help="keep central-DHW recirculation distribution losses: move the "
                         "loop's Pipe:Indoor onto the service loop's demand side instead "
                         "of deleting it with the broken loop")
    a = ap.parse_args()
    if a.outdir:
        os.makedirs(a.outdir, exist_ok=True)
    rc = 0
    for f in a.files:
        try:
            s = process(f, a.outdir, a.check, a.preserve_recirc)
            print(json.dumps(s, indent=2))
            if not s.get("runnable", True):
                rc = 2
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"file": os.path.basename(f), "error": str(e)}, indent=2))
            rc = 2
    return rc


if __name__ == "__main__":
    sys.exit(main())
