"""Master orchestration v2.

For each pending Anura table:
  1. Build LAYOUT_TO_RT from active picklist_values + SF layout filenames
     - Exact label match (normalized) -> RT picklist_value
     - Generic master layouts ("X Layout", "Master") -> None (master fallback)
     - Community/Subcontractor/* portal-only layouts -> SKIP
     - No match -> SKIP
  2. Print summary
"""
import os, re, sys, json, shutil
sys.path.insert(0, '/home/claude/anura/tools/sf-import')
sys.path.insert(0, '/home/claude')

shutil.copy('/home/claude/anura/tools/sf-import/sf_layout_translator.py',
            '/home/claude/sf_layout_translator.py')

ACTIVE_RTS = json.load(open('/home/claude/active_rts.json'))

def normalize(s):
    return re.sub(r'[\s\-_\u2013\u2014]+', '', s.lower())

MASTER_LAYOUT_PATTERNS = [
    re.compile(r'^.*\s+Layout$', re.I),
    re.compile(r'^Master$', re.I),
]

ALWAYS_SKIP_PATTERNS = [
    re.compile(r'.*Community.*', re.I),
    re.compile(r'.*SubContractor.*', re.I),
    re.compile(r'.*Subcontractor.*', re.I),
    re.compile(r'.*ReadOnly.*', re.I),
]

EXCEPTION_KEEP = {
    ('incentives', 'Subcontractor Incentive Layout'): True,
}

# Per-table explicit overrides: layout label -> picklist_value (or None for master, 'SKIP' to skip)
# Applied LAST after auto-match attempts.
OVERRIDES = {
    'opportunities': {
        '45L Retroactive Tax Credit': 'X45L_Retroactive_Tax_Credit',
    },
    'assessments': {
        'Nicor Rebuilding Together Assessment': 'Nicor_Rebuilding_Together',
    },
    'work_orders': {
        'Exhuast Fan Replacement': 'Exhaust_Fan_Replacement',  # SF typo
    },
    'diagnostic_tests': {
        'CAZ Test-In': 'CAZTI',
        'CAZ Test-Out': 'CAZTO',
    },
    'efr_reports': {
        'Electrification Feasibility Report Application': 'EFR_Application',
        'Electrification Feasibility Report': 'EFR_Report',
    },
    'time_sheet_entries': {
        # 'Salaried Time Sheet Layout' is misnamed in SF — it's actually for Salaried Time Sheet Entries
        'Salaried Time Sheet Layout': 'Salaried_Time_Sheet_Entry',
        'Anura Time Sheet Entry Layout': None,  # generic master fallback
    },
}

# Suffixes to strip when initial match fails (try without them, in order)
SUFFIX_STRIPS = [' Layout', ' Custom Layout', ' Page Layout', ' Standard']

def build_layout_to_rt(anura_table, sf_object):
    rts = [r for r in ACTIVE_RTS if r['o'] == anura_table]
    norm_to_rt = {}
    for r in rts:
        norm_to_rt[normalize(r['l'])] = r['v']
        norm_to_rt[normalize(r['v'])] = r['v']
    layouts_dir = '/home/claude/sf_metadata/layouts'
    layout_files = sorted([f for f in os.listdir(layouts_dir)
                           if f.startswith(f"{sf_object}-") and f.endswith('.layout')])
    overrides = OVERRIDES.get(anura_table, {})
    out = {}
    for lf in layout_files:
        label = lf.replace(f"{sf_object}-", '').replace('.layout', '')

        # 1. Per-table override wins over everything
        if label in overrides:
            out[label] = overrides[label]
            continue

        # 2. Skip patterns
        skip_match = any(p.match(label) for p in ALWAYS_SKIP_PATTERNS)
        if skip_match and not EXCEPTION_KEEP.get((anura_table, label)):
            out[label] = 'SKIP'
            continue

        # 3. Direct normalized match
        n = normalize(label)
        if n in norm_to_rt:
            out[label] = norm_to_rt[n]
            continue

        # 4. Try stripping common suffixes and re-match
        matched = False
        for suf in SUFFIX_STRIPS:
            if label.endswith(suf):
                stripped = label[:-len(suf)].strip()
                ns = normalize(stripped)
                if ns in norm_to_rt:
                    out[label] = norm_to_rt[ns]
                    matched = True
                    break
        if matched:
            continue

        # 5. Master pattern -> NULL fallback
        if any(p.match(label) for p in MASTER_LAYOUT_PATTERNS):
            out[label] = None
            continue

        # 6. No match
        out[label] = 'SKIP'
    return out, layout_files

TARGETS = [
    ('opportunities', 'Opportunity'),
    ('projects', 'Project__c'),
    ('assessments', 'Assessment__c'),
    ('work_orders', 'WorkOrder'),
    ('equipment', 'Equipment__c'),
    ('equipment_activities', 'Equipment_Activity__c'),
    ('mechanical_equipment', 'Mechanical_Equipment__c'),
    ('vehicle_activities', 'Vehicle_Activity__c'),
    ('diagnostic_tests', 'Diagnostic_Test__c'),
    ('incentives', 'Incentive__c'),
    ('incentive_applications', 'Incentive_Application__c'),
    ('time_sheets', 'Anura_Time_Sheet__c'),
    ('time_sheet_entries', 'Anura_Time_Sheet_Entry__c'),
    ('occurrences', 'Occurrence__c'),
    ('gps_points', 'GPS_Point__c'),
    ('efr_reports', 'Electrification_Feasibility_Report__c'),
    ('products', 'Product2'),
    ('work_steps', 'WorkStep'),
]

if __name__ == '__main__':
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for tbl, sf_obj in TARGETS:
        if only and tbl != only:
            continue
        ltr, files = build_layout_to_rt(tbl, sf_obj)
        skipped = [l for l, v in ltr.items() if v == 'SKIP']
        master = [l for l, v in ltr.items() if v is None]
        mapped = [(l, v) for l, v in ltr.items() if v not in (None, 'SKIP')]
        print(f"\n=== {tbl} ({sf_obj}): {len(mapped)} mapped, {len(master)} master, {len(skipped)} skipped, total={len(ltr)} ===")
        for l in master:    print(f"  [M] {l}")
        for l, v in mapped: print(f"  [+] {l}  ->  {v}")
        for l in skipped:   print(f"  [-] {l}")
