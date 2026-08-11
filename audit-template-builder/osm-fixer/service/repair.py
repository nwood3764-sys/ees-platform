# repair.py — the OSM repair logic, SDK-based (no text surgery).
#
# Applies the standard EES model-prep repairs so a DOE Asset Score .osm
# translates and runs cleanly in EnergyPlus:
#   1. Remove Schedule:File objects (dangling external-CSV refs crash E+).
#   2. Remove PlantLoop(s) whose name contains "recirc" — the SWH recirculation
#      loop that fails in the translated IDF. The water heater on the main loop
#      is preserved (we abort if a heater would be collaterally removed).
#   3. Pin each WaterHeaterMixed ambient temperature to a constant 21 C schedule
#      (ThermalZone ambient is the other known translation failure).
#   4. Enable HTML results output: OutputControl:Table:Style = HTMLandColumns,
#      the AllSummary report, and monthly end-use meters, so a run produces the
#      eplustbl.htm the Audit Template Builder consumes.
#
# The SDK version should be >= the uploaded model's version; a VersionTranslator
# upgrades older models to the running SDK version. Newer-than-SDK models cannot
# be loaded (report a clear error).

import openstudio


def _load(path):
    """Load an .osm, upgrading older versions via the VersionTranslator.
    Returns (model, note) or raises ValueError with a readable message."""
    # Same-version models load directly; older ones need translation.
    m = openstudio.model.Model.load(path)
    if m.is_initialized():
        return m.get(), None
    tr = openstudio.osversion.VersionTranslator()
    m = tr.loadModel(path)
    if m.is_initialized():
        return m.get(), "version-translated to %s" % openstudio.openStudioVersion()
    raise ValueError(
        "Could not load model — it may be newer than the installed OpenStudio "
        "SDK (%s). Install an SDK version >= the model version." % openstudio.openStudioVersion()
    )


def repair_osm(in_path, out_path):
    """Repair one .osm at in_path, write the corrected model to out_path.
    Returns a dict summary of what changed."""
    model, note = _load(in_path)
    summary = {"sdk_version": openstudio.openStudioVersion(), "note": note}

    # 1. Schedule:File removal
    sfiles = model.getScheduleFiles()
    n_sf = len(sfiles)
    for s in list(sfiles):
        s.remove()
    summary["schedule_file_removed"] = n_sf

    # 2. Recirc PlantLoop removal (guard the water heaters)
    wh_before = {w.handle().__str__() for w in model.getWaterHeaterMixeds()}
    removed = []
    for pl in list(model.getPlantLoops()):
        if "recirc" in pl.nameString().lower():
            removed.append(pl.nameString())
            pl.remove()
    wh_after = {w.handle().__str__() for w in model.getWaterHeaterMixeds()}
    lost = wh_before - wh_after
    if lost:
        raise ValueError(
            "Aborted: removing the recirculation loop would have deleted a "
            "water heater (%s). Model left unchanged." % ", ".join(lost)
        )
    summary["recirc_loops_removed"] = removed

    # 3. WaterHeaterMixed ambient -> constant 21 C schedule
    amb = openstudio.model.ScheduleConstant(model)
    amb.setName("WH Ambient 21C (repair)")
    amb.setValue(21.0)
    tlim = openstudio.model.ScheduleTypeLimits(model)
    tlim.setName("Temperature (repair)")
    tlim.setUnitType("Temperature")
    amb.setScheduleTypeLimits(tlim)
    n_wh = 0
    for w in model.getWaterHeaterMixeds():
        w.setAmbientTemperatureIndicator("Schedule")
        w.setAmbientTemperatureSchedule(amb)
        try:
            w.resetAmbientTemperatureThermalZone()
        except Exception:
            pass
        n_wh += 1
    summary["water_heaters_fixed"] = n_wh

    # 4. HTML results output + AllSummary + monthly meters
    ots = model.getOutputControlTableStyle()
    ots.setColumnSeparator("HTMLandColumns")
    ots.setUnitConversion("None")
    srep = model.getOutputTableSummaryReports()
    if not any(g.getString(0).get() == "AllSummary" for g in srep.extensibleGroups()):
        srep.pushExtensibleGroup(["AllSummary"])
    meters = [
        "Electricity:Facility", "NaturalGas:Facility",
        "Heating:Electricity", "Cooling:Electricity", "InteriorLights:Electricity",
        "InteriorEquipment:Electricity", "Fans:Electricity", "Pumps:Electricity",
        "WaterSystems:Electricity", "Heating:NaturalGas", "WaterSystems:NaturalGas",
    ]
    for fuel in meters:
        mtr = openstudio.model.OutputMeter(model)
        mtr.setName(fuel)
        mtr.setReportingFrequency("Monthly")
    sc = model.getSimulationControl()
    sc.setRunSimulationforWeatherFileRunPeriods(True)
    summary["output_setup"] = "HTMLandColumns + AllSummary + %d monthly meters" % len(meters)

    # Save
    ok = model.save(out_path, True)
    if not ok:
        raise ValueError("Failed to write the repaired model to disk.")

    # Runnability gate: forward-translate to IDF and require zero errors.
    ft = openstudio.energyplus.ForwardTranslator()
    ws = ft.translateModel(model)
    errs = [e.logMessage() for e in ft.errors()]
    summary["idf_objects"] = len(ws.objects())
    summary["translate_errors"] = errs
    wf = model.weatherFile()
    if wf.is_initialized() and wf.get().path().is_initialized():
        summary["weather_file"] = wf.get().path().get().__str__()
    else:
        summary["weather_file"] = None
    summary["runnable"] = len(errs) == 0
    return summary


if __name__ == "__main__":
    import sys, json
    out = repair_osm(sys.argv[1], sys.argv[2])
    print(json.dumps(out, indent=2))
