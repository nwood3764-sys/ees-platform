#!/usr/bin/env python3
"""
Transform the Manus NC dashboard properties.json into the
import_property_batch RPC input shape, and split into per-state
JSON chunk files small enough to send via execute_sql.

Source schema (from Manus dashboard):
  property_id (int), property_name_clean, address_clean, city_clean,
  county_clean, zip_code, state, lat, lng, total_unit_count,
  est_buildings, property_age_years, organization, organization_normalized,
  contractNumber, contractExpiration, energyBurdenPct, avgMonthlyEnergy,
  is_lihtc, category_clean, soa_clean,
  helene_affected, florence_affected, matthew_affected, dorian_affected

Target shape (RPC contract):
  hud_property_id, lihtc_project_id, owner_name,
  owner_hud_participant_number, property_name, property_aka_name,
  street, city, state, zip, county, latitude, longitude,
  total_units, total_buildings, year_built, subsidy_type,
  hud_contract_number, hud_contract_type, hud_subsidy_type,
  hud_contract_expiration_date,
  doe_lead_energy_burden_score, doe_lead_average_energy_cost,
  doe_lead_low_income_percentage,
  fema_county, fema_state, fema_declaration_count,
  fema_hurricane_declaration_count, fema_most_recent_declaration_date,
  fema_declared_disasters
"""

import json
import math
import os
from collections import Counter
from datetime import date

SRC = "/tmp/nc-property-dashboard/client/src/data/properties.json"
OUT_DIR = "/tmp/leap-import-chunks"
CHUNK_SIZE = 200   # records per chunk — sized to keep each execute_sql call <~500KB

# NC hurricane declarations — used to build pde_fema_declared_disasters
# entries for affected properties.
HURRICANES = [
    ("matthew_affected",  "Hurricane Matthew",  "2016-10-08", "DR-4285-NC"),
    ("florence_affected", "Hurricane Florence", "2018-09-14", "DR-4393-NC"),
    ("dorian_affected",   "Hurricane Dorian",   "2019-09-05", "DR-4465-NC"),
    ("helene_affected",   "Hurricane Helene",   "2024-09-28", "DR-4827-NC"),
]

def safe(v):
    """JSON null-coerce: empty strings, NaN, None all become None."""
    if v is None: return None
    if isinstance(v, float) and math.isnan(v): return None
    if isinstance(v, str) and v.strip() == "": return None
    return v

def derive_year_built(age_years):
    a = safe(age_years)
    if a is None: return None
    try: return int(date.today().year - float(a))
    except (TypeError, ValueError): return None

def transform(rec):
    out = {}

    # HUD identifier — property_id is an integer in the source
    pid = safe(rec.get("property_id"))
    if pid is not None:
        out["hud_property_id"] = str(pid)

    # LIHTC: source has is_lihtc bool but no project_id. Leave null.

    # Owner — no HUD participant number in source; rely on organization name.
    org = safe(rec.get("organization")) or safe(rec.get("organization_normalized"))
    if org:
        out["owner_name"] = org

    # Property
    out["property_name"] = safe(rec.get("property_name_clean")) or "Unnamed HUD Property"
    out["street"]        = safe(rec.get("address_clean"))       or "Unknown"
    out["city"]          = safe(rec.get("city_clean"))          or "Unknown"
    out["state"]         = safe(rec.get("state"))               or "XX"
    out["zip"]           = safe(rec.get("zip_code"))            or "00000"

    county = safe(rec.get("county_clean"))
    if county: out["county"] = county

    lat = safe(rec.get("lat"))
    lng = safe(rec.get("lng"))
    if lat is not None: out["latitude"]  = float(lat)
    if lng is not None: out["longitude"] = float(lng)

    units = safe(rec.get("total_unit_count"))
    if units is not None: out["total_units"] = int(units)

    bldgs = safe(rec.get("est_buildings"))
    if bldgs is not None: out["total_buildings"] = int(bldgs)

    yb = derive_year_built(rec.get("property_age_years"))
    if yb is not None: out["year_built"] = yb

    # Source data
    cnum = safe(rec.get("contractNumber"))
    if cnum: out["hud_contract_number"] = cnum

    cat = safe(rec.get("category_clean"))
    if cat: out["hud_contract_type"] = cat

    soa = safe(rec.get("soa_clean"))
    if soa: out["hud_subsidy_type"] = soa

    cexp = safe(rec.get("contractExpiration"))
    if cexp: out["hud_contract_expiration_date"] = cexp

    eb = safe(rec.get("energyBurdenPct"))
    if eb is not None: out["doe_lead_energy_burden_score"] = float(eb)

    avg = safe(rec.get("avgMonthlyEnergy"))
    if avg is not None: out["doe_lead_average_energy_cost"] = float(avg)

    # FEMA disaster exposure — only emit for NC properties with at
    # least one storm flag true. Other states currently have no
    # disaster data in this source.
    if out["state"] == "NC":
        declarations = []
        for flag, name, dt, decl in HURRICANES:
            if rec.get(flag):
                declarations.append({"declaration": decl, "name": name, "date": dt})
        if declarations:
            out["fema_state"]  = "NC"
            if county: out["fema_county"] = county
            out["fema_declaration_count"] = len(declarations)
            out["fema_hurricane_declaration_count"] = len(declarations)
            out["fema_most_recent_declaration_date"] = max(d["date"] for d in declarations)
            out["fema_declared_disasters"] = declarations

    return out


def main():
    with open(SRC, "r") as f:
        records = json.load(f)
    print(f"Loaded {len(records)} source records.")

    transformed = [transform(r) for r in records]
    state_counts = Counter(r["state"] for r in transformed)
    print(f"State distribution: {dict(state_counts)}")

    fema_count = sum(1 for r in transformed if "fema_declared_disasters" in r)
    print(f"Records with FEMA disaster data: {fema_count}")
    geo_count = sum(1 for r in transformed if "latitude" in r and "longitude" in r)
    print(f"Records with lat/lng: {geo_count}")
    cnum_count = sum(1 for r in transformed if "hud_contract_number" in r)
    print(f"Records with HUD contract number: {cnum_count}")
    owner_count = sum(1 for r in transformed if "owner_name" in r)
    print(f"Records with owner_name: {owner_count}")

    os.makedirs(OUT_DIR, exist_ok=True)
    # Write one combined file for reference, plus per-chunk files for
    # execution.
    with open(os.path.join(OUT_DIR, "all.json"), "w") as f:
        json.dump(transformed, f)

    chunks = [transformed[i:i+CHUNK_SIZE] for i in range(0, len(transformed), CHUNK_SIZE)]
    print(f"Splitting into {len(chunks)} chunks of <= {CHUNK_SIZE} records each.")

    for idx, chunk in enumerate(chunks):
        path = os.path.join(OUT_DIR, f"chunk-{idx:03d}.json")
        with open(path, "w") as f:
            json.dump(chunk, f)
    print(f"Wrote chunks to {OUT_DIR}/")

    # Size check
    largest = 0
    for fn in sorted(os.listdir(OUT_DIR)):
        if fn.startswith("chunk"):
            sz = os.path.getsize(os.path.join(OUT_DIR, fn))
            if sz > largest: largest = sz
    print(f"Largest chunk size: {largest} bytes")

if __name__ == "__main__":
    main()
