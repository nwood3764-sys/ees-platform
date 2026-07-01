"""Repair an Asset-Score-exported OpenStudio .osm, run EnergyPlus, and return
results in the shape the Audit Template Builder front end expects.

Why this shape (and not raw eplustbl.htm):
    The front end's parseOpenStudio() keys on the OpenStudio *Results reporting
    measure* HTML (captions like "Electricity Consumption (kWh)" and toggle
    labels like "EUI - Electricity"). That HTML is produced by a Ruby measure
    run through the OpenStudio CLI. The pip-installed `openstudio` Python SDK
    (pinned to 3.11.0 per the build spec) has no Ruby measure runtime, so it
    cannot regenerate that exact HTML. The native EnergyPlus tabular report
    (eplustbl.htm) uses different headings the parser would not match.

    So instead of returning HTML, we read the authoritative EnergyPlus SQLite
    output (eplusout.sql) and return JSON with the SAME keys parseOpenStudio()
    returns:

        { elec:[12 kWh], gas:[12 therms], name,
          elecEnd:{endUse: kWh}, gasEnd:{endUse: therms},
          elecMonthly:{endUse: [12 kWh]}, gasMonthly:{endUse: [12 therms]} }

    The front end's .osm branch assigns this object straight into data[key], so
    energy scaling, the BuildingSync XML, and the utility xlsx all work unchanged.
    We still emit eplustbl.htm into the run directory for human debugging.

Verified recipe (build spec section 2): OpenStudio SDK 3.11.0 <-> EnergyPlus
25.2.0. The two model repairs below are required or EnergyPlus fails fatally.
"""

import json
import os
import re
import subprocess
import sys

import openstudio

# --- Unit conversions (SQL meter values are Joules) ----------------------------
J_PER_KWH = 3_600_000.0
J_PER_THERM = 105_505_585.257  # 100,000 Btu * 1055.05585262 J/Btu

MONTHS = 12

ENERGYPLUS_BIN = os.environ.get("AUDIT_ENERGYPLUS_BIN", "energyplus")
DEFAULT_EPW = os.environ.get(
    "AUDIT_EPW",
    "/app/weather/USA_WI_Milwaukee-Mitchell.Intl.AP.726400_TMY3.epw",
)

# Per-end-use meters requested at Monthly frequency. Names are the friendly
# end-use labels the front end's auditEndUses() regexes expect (e.g. /^Heating/,
# /Interior Lighting/, /Interior Equipment/, /Water Systems/).
ELEC_END_USE_METERS = {
    "Heating:Electricity": "Heating",
    "Cooling:Electricity": "Cooling",
    "InteriorLights:Electricity": "Interior Lighting",
    "ExteriorLights:Electricity": "Exterior Lighting",
    "InteriorEquipment:Electricity": "Interior Equipment",
    "ExteriorEquipment:Electricity": "Exterior Equipment",
    "Fans:Electricity": "Fans",
    "Pumps:Electricity": "Pumps",
    "HeatRejection:Electricity": "Heat Rejection",
    "Humidifier:Electricity": "Humidification",
    "HeatRecovery:Electricity": "Heat Recovery",
    "WaterSystems:Electricity": "Water Systems",
    "Refrigeration:Electricity": "Refrigeration",
    "Cogeneration:Electricity": "Generators",
}
GAS_END_USE_METERS = {
    "Heating:NaturalGas": "Heating",
    "Cooling:NaturalGas": "Cooling",
    "InteriorEquipment:NaturalGas": "Interior Equipment",
    "ExteriorEquipment:NaturalGas": "Exterior Equipment",
    "WaterSystems:NaturalGas": "Water Systems",
    "Cogeneration:NaturalGas": "Generators",
}
FACILITY_ELEC = "Electricity:Facility"
FACILITY_GAS = "NaturalGas:Facility"


def load_model(osm_path):
    """Load an .osm, version-translating if it was saved by an older SDK."""
    vt = openstudio.osversion.VersionTranslator()
    opt = vt.loadModel(openstudio.path(osm_path))
    if not opt.is_initialized():
        raise RuntimeError(f"could not load OpenStudio model: {osm_path}")
    return opt.get()


def repair_model(m):
    """Apply the two repairs that the Asset-Score-exported .osm files need.

    Both are applied identically to baseline and improved models, so energy
    savings stay clean; only absolute energy is marginally affected (and the
    whole app scales energy to the Asset Score EUI anyway).
    """
    notes = []

    # Repair 1 - broken Schedule:File ("water issue"). A "SHW Ambient
    # Temperature" Schedule:File points at a CSV that is not shipped with the
    # .osm (empty File Name -> fatal). Replace with a constant 21 C ambient
    # schedule on each water heater.
    n_sched = 0
    for sf in m.getScheduleFiles():
        sf.remove()
        n_sched += 1
    for wh in m.getWaterHeaterMixeds():
        amb = openstudio.model.ScheduleConstant(m)
        nm = wh.name().get() if wh.name().is_initialized() else "WaterHeater"
        amb.setName(nm + " Ambient 21C")
        amb.setValue(21.0)
        wh.setAmbientTemperatureSchedule(amb)
        wh.setAmbientTemperatureIndicator("Schedule")
    notes.append(f"removed {n_sched} Schedule:File; set water-heater ambient to 21C")

    # Repair 2 - incomplete service-hot-water recirculation PlantLoop (missing
    # operation scheme -> fatal). Remove any plant loop whose name says "recirc".
    n_loops = 0
    for pl in m.getPlantLoops():
        nm = pl.name().get() if pl.name().is_initialized() else ""
        if "recirc" in nm.lower():
            pl.remove()
            n_loops += 1
    notes.append(f"removed {n_loops} recirculation plant loop(s)")
    return notes


def add_outputs(m):
    """Request the tabular report and the monthly meters we read back from SQL.

    Done through the SDK, never by text-appending to the IDF: appending a second
    OutputControl:Table:Style when the model already has one is fatal.
    """
    style = m.getOutputControlTableStyle()
    style.setColumnSeparator("HTMLandColumns")  # produces eplustbl.htm

    reports = m.getOutputTableSummaryReports()
    have = {
        reports.getString(i).get()
        for i in range(reports.numFields())
        if reports.getString(i).is_initialized()
    }
    if "AllSummary" not in have:
        reports.pushExtensibleGroup(["AllSummary"])

    # Monthly meters: facility totals + per end use, for both fuels.
    meters = [FACILITY_ELEC, FACILITY_GAS]
    meters += list(ELEC_END_USE_METERS.keys())
    meters += list(GAS_END_USE_METERS.keys())
    for name in meters:
        om = openstudio.model.OutputMeter(m)
        om.setName(name)
        om.setReportingFrequency("Monthly")


def translate(m, idf_path):
    ft = openstudio.energyplus.ForwardTranslator()
    ft.setExcludeSQliteOutputReport(False)  # ensure eplusout.sql is written
    ws = ft.translateModel(m)
    ws.save(openstudio.path(idf_path), True)


def run_energyplus(idf_path, epw_path, rundir):
    os.makedirs(rundir, exist_ok=True)
    proc = subprocess.run(
        [ENERGYPLUS_BIN, "-w", epw_path, "-d", rundir, "-r", idf_path],
        capture_output=True,
        text=True,
    )
    tail = (proc.stdout or "") + (proc.stderr or "")
    # A clean run prints "EnergyPlus Completed Successfully -- N Warning;
    # 0 Severe Errors". Check the phrase, not a raw count of the word "Severe"
    # (the summary lines contain it).
    if "0 Severe Errors" not in tail:
        raise RuntimeError(
            "EnergyPlus did not complete with 0 Severe Errors:\n" + tail[-2000:]
        )
    return tail


def _monthly_meter(sql, meter_name):
    """Return 12 monthly values (Joules) for a meter, or None if absent.

    IntervalType=3 selects the monthly run-period rows in the Time table.
    """
    query = (
        "SELECT rmd.Value FROM ReportMeterData rmd "
        "JOIN ReportMeterDataDictionary d "
        "ON rmd.ReportMeterDataDictionaryIndex=d.ReportMeterDataDictionaryIndex "
        "JOIN Time t ON rmd.TimeIndex=t.TimeIndex "
        f"WHERE d.Name='{meter_name}' AND t.IntervalType=3 "
        "ORDER BY t.Month"
    )
    res = sql.execAndReturnVectorOfDouble(query)
    if res.is_initialized():
        vals = list(res.get())
        if len(vals) == MONTHS:
            return vals
    return None


def results_from_sql(sql_path, building_name):
    sql = openstudio.SqlFile(openstudio.path(sql_path))
    if not sql.connectionOpen():
        raise RuntimeError(f"could not open SQL results: {sql_path}")

    def monthly(name, divisor):
        j = _monthly_meter(sql, name)
        if j is None:
            return None
        return [round(v / divisor, 3) for v in j]

    elec = monthly(FACILITY_ELEC, J_PER_KWH) or [0.0] * MONTHS
    gas = monthly(FACILITY_GAS, J_PER_THERM) or [0.0] * MONTHS

    elec_monthly, elec_end = {}, {}
    for meter, label in ELEC_END_USE_METERS.items():
        vals = monthly(meter, J_PER_KWH)
        if vals and any(v != 0 for v in vals):
            elec_monthly[label] = vals
            elec_end[label] = round(sum(vals), 3)

    gas_monthly, gas_end = {}, {}
    for meter, label in GAS_END_USE_METERS.items():
        vals = monthly(meter, J_PER_THERM)
        if vals and any(v != 0 for v in vals):
            gas_monthly[label] = vals
            gas_end[label] = round(sum(vals), 3)

    sql.close()
    return {
        "elec": elec,
        "gas": gas,
        "name": building_name,
        "elecEnd": elec_end,
        "gasEnd": gas_end,
        "elecMonthly": elec_monthly,
        "gasMonthly": gas_monthly,
    }


def run(osm_path, epw_path=None, workdir=None):
    """Full pipeline: load -> repair -> outputs -> translate -> run -> read SQL.

    Returns (results_dict, htm_path, notes).
    """
    epw_path = epw_path or DEFAULT_EPW
    if not os.path.exists(epw_path):
        raise RuntimeError(f"weather file not found: {epw_path}")
    workdir = workdir or os.path.dirname(os.path.abspath(osm_path)) or "."

    m = load_model(osm_path)
    notes = repair_model(m)
    add_outputs(m)

    idf_path = os.path.join(workdir, "model.idf")
    rundir = os.path.join(workdir, "rundir")
    translate(m, idf_path)
    run_energyplus(idf_path, epw_path, rundir)

    sql_path = os.path.join(rundir, "eplusout.sql")
    if not os.path.exists(sql_path):
        raise RuntimeError("EnergyPlus produced no SQL output (eplusout.sql)")

    b = m.building()
    name = None
    if b.is_initialized() and b.get().name().is_initialized():
        name = b.get().name().get()

    results = results_from_sql(sql_path, name)
    htm_path = os.path.join(rundir, "eplustbl.htm")
    return results, (htm_path if os.path.exists(htm_path) else None), notes


def _cli():
    if len(sys.argv) < 2:
        print("usage: python repair_and_run.py model.osm [weather.epw]", file=sys.stderr)
        sys.exit(2)
    osm = sys.argv[1]
    epw = sys.argv[2] if len(sys.argv) > 2 else None
    results, htm, notes = run(osm, epw)
    for n in notes:
        print("repair:", n, file=sys.stderr)
    if htm:
        print("tabular report:", htm, file=sys.stderr)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    _cli()
