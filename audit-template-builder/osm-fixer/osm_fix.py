#!/usr/bin/env python3
"""osm_fix.py — repair DOE Asset Score OpenStudio models so they RUN.

Standard, deterministic repair (runs in seconds, no analysis needed):
  1. Remove Schedule:File objects (dangling external-CSV refs crash E+).
  2. Remove "recirc" PlantLoops — but abort if a water heater would be lost.
  3. Pin every WaterHeaterMixed ambient temperature to a constant 21 C schedule
     (WaterHeater ambient tied to a ThermalZone is the usual run-time failure).
  4. Enable HTML results (HTMLandColumns + AllSummary + monthly meters) so a run
     produces eplustbl.htm.
  5. Forward-translate to IDF and REQUIRE zero errors before writing "runnable".
The weather file is preserved unchanged.

Usage:
    python osm_fix.py model.osm [more.osm ...]        # writes <name>.fixed.osm
    python osm_fix.py -o OUTDIR *.osm                 # write fixed files to OUTDIR
    python osm_fix.py --check model.osm               # diagnose only, write nothing

Requires: pip install openstudio==3.7.0   (SDK only; no EnergyPlus needed)
"""
import argparse, json, os, sys
from collections import Counter

try:
    import openstudio
except ImportError:
    sys.exit("openstudio not installed. Run:  pip install openstudio==3.7.0")

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


def repair(model):
    """Apply the standard repairs in place. Returns a summary dict."""
    s = {"sdk": openstudio.openStudioVersion()}

    # 1. Schedule:File
    sf = model.getScheduleFiles(); s["schedule_file_removed"] = len(sf)
    for x in list(sf):
        x.remove()

    # 2. recirc plant loops (guard water heaters)
    before = {w.handle().__str__() for w in model.getWaterHeaterMixeds()}
    removed = []
    for pl in list(model.getPlantLoops()):
        if "recirc" in pl.nameString().lower():
            removed.append(pl.nameString()); pl.remove()
    lost = before - {w.handle().__str__() for w in model.getWaterHeaterMixeds()}
    if lost:
        raise ValueError("Aborted: removing the recirc loop would delete a water "
                         "heater (%s). Model left unchanged." % ", ".join(lost))
    s["recirc_loops_removed"] = removed

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
    #     accepts 0).
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
    # PTAC/PTHP zone heat pumps: 0-value schedule = cycle (schedule is required).
    pthps = model.getZoneHVACPackagedTerminalHeatPumps()
    if pthps:
        cyc = openstudio.model.ScheduleConstant(model)
        cyc.setName("Fan Cycling (repair)"); cyc.setValue(0.0)
        ftl = openstudio.model.ScheduleTypeLimits(model)   # proper 0/1 mode limits
        ftl.setName("Fan Operating Mode (repair)")
        ftl.setLowerLimitValue(0.0); ftl.setUpperLimitValue(1.0)
        ftl.setNumericType("Discrete"); ftl.setUnitType("Availability")
        cyc.setScheduleTypeLimits(ftl)
        used = 0
        for u in pthps:
            if _fan_can_cycle(u.supplyAirFan()):
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


def process(path, outdir=None, check=False):
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
    s = repair(model); s["file"] = base; s["note"] = note
    stem = base[:-4] if base.lower().endswith(".osm") else base
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
    a = ap.parse_args()
    if a.outdir:
        os.makedirs(a.outdir, exist_ok=True)
    rc = 0
    for f in a.files:
        try:
            s = process(f, a.outdir, a.check)
            print(json.dumps(s, indent=2))
            if not s.get("runnable", True):
                rc = 2
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"file": os.path.basename(f), "error": str(e)}, indent=2))
            rc = 2
    return rc


if __name__ == "__main__":
    sys.exit(main())
