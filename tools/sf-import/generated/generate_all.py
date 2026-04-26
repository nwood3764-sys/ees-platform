"""Generate alter+layouts SQL for all pending Anura tables.

Uses the layout_to_rt mapping from orchestrate.py and current schema columns
to produce /tmp/<table>_alter.sql and /tmp/<table>_layouts.sql files.
"""
import os, sys, json, shutil
sys.path.insert(0, '/home/claude')
sys.path.insert(0, '/home/claude/anura/tools/sf-import')

# Make sf_layout_translator findable
shutil.copy('/home/claude/anura/tools/sf-import/sf_layout_translator.py',
            '/home/claude/sf_layout_translator.py')

from orchestrate import build_layout_to_rt, TARGETS
from autogen import run as autogen_run

# Load current columns
COLS = json.load(open('/home/claude/current_columns.json'))

# Per-table extra mappings (over and above what's in FIELD_MAP and auto-derive)
# These handle SF field names where the auto-derive (snake_case + prefix) would fail.
EXTRAS = {
    # Most tables auto-derive correctly. Add overrides here as we encounter issues.
    'projects': {
        'Name': 'project_name',
        'OwnerId': 'project_owner',
        'Description': 'project_description',
        'CreatedDate': 'project_created_at',
        'CreatedById': 'project_created_by',
        'LastModifiedDate': 'project_updated_at',
        'LastModifiedById': 'project_updated_by',
    },
    'assessments': {
        'Name': 'assessment_name',
        'OwnerId': 'assessment_owner',
    },
    'work_orders': {
        'Subject': 'work_order_subject',
        'Description': 'work_order_description',
        'Priority': 'work_order_priority',
        'Status': 'work_order_status',
        'OwnerId': 'work_order_owner',
        'StartDate': 'work_order_start_datetime',
        'EndDate': 'work_order_end_datetime',
        'Duration': 'work_order_duration',
        'DurationType': 'work_order_duration_type',
        'WorkTypeId': 'work_type_id',
        'AccountId': 'work_order_account_id',
        'ContactId': 'contact_id',
        'CaseId': None,  # not relevant
        'Pricebook2Id': None,
        'Address': None,  # SF compound
        'City': None, 'State': None, 'Country': None, 'PostalCode': None, 'Street': None,
        'Latitude': None, 'Longitude': None, 'GeocodeAccuracy': None,
    },
    'equipment': {
        'Name': 'equipment_name',
        'OwnerId': 'equipment_owner',
    },
    'equipment_activities': {
        'Name': 'ea_name',
        'OwnerId': 'ea_owner',
    },
    'mechanical_equipment': {
        'Name': 'me_name',
        'OwnerId': 'me_owner',
    },
    'vehicle_activities': {
        'Name': 'va_name',
        'OwnerId': 'va_owner',
    },
    'diagnostic_tests': {
        'Name': 'diagnostic_name',
        'OwnerId': 'diagnostic_owner',
    },
    'incentives': {
        'Name': 'incentive_name',
        'OwnerId': 'incentive_owner',
    },
    'incentive_applications': {
        'Name': 'ia_name',
        'OwnerId': 'ia_owner',
    },
    'time_sheets': {
        'Name': 'ts_name',
        'OwnerId': 'ts_owner',
    },
    'time_sheet_entries': {
        'Name': 'tse_name',
        'OwnerId': 'tse_owner',
    },
    'occurrences': {
        'Name': 'occurrence_name',
        'OwnerId': 'occurrence_owner',
    },
    'gps_points': {
        'Name': 'gps_name',
        'OwnerId': 'gps_owner',
    },
    'efr_reports': {
        'Name': 'efr_name',
        'OwnerId': 'efr_owner',
    },
    'products': {
        'Name': 'product_name',
        'Description': 'product_description',
        'IsActive': 'product_is_active',
        'IsArchived': 'product_is_archived',
        'Family': 'product_family',
        'ProductCode': 'product_code',
        'StockKeepingUnit': 'product_sku',
        'OwnerId': 'product_owner',
        'QuantityUnitOfMeasure': 'product_quantity_unit_of_measure',
    },
    'work_steps': {
        'Name': 'work_step_name',
        'Description': 'work_step_description',
        'OwnerId': 'work_step_owner',
        'Status': 'work_step_status',
        'StartTime': 'work_step_start_time',
        'EndTime': 'work_step_end_time',
        'WorkOrderId': 'work_order_id',
        'WorkPlanId': 'work_plan_id',
        'WorkStepTemplateId': 'work_step_template_id',
        'ExecutionOrder': 'work_step_execution_order',
    },
    'opportunities': {
        # opportunities already has 25 in FIELD_MAP — no extras needed
    },
}

def generate(table, sf_object):
    cols = set(COLS.get(table, []))
    if not cols:
        return None
    layout_to_rt, _ = build_layout_to_rt(table, sf_object)
    extras = EXTRAS.get(table, {})
    try:
        alter, sql, missing, skipped = autogen_run(table, sf_object, cols, layout_to_rt, extras)
        # Write
        with open(f'/tmp/{table}_alter.sql', 'w') as f:
            f.write(alter)
        with open(f'/tmp/{table}_layouts.sql', 'w') as f:
            f.write(sql)
        with open(f'/tmp/{table}_skipped.txt', 'w') as f:
            f.write('\n'.join(skipped))
        return {
            'table': table,
            'sf': sf_object,
            'alter_chars': len(alter),
            'layouts_chars': len(sql),
            'missing_cols': len(missing),
            'skipped_fields': len(skipped),
            'mapped_layouts': sum(1 for v in layout_to_rt.values() if v not in (None, 'SKIP')),
            'master_layouts': sum(1 for v in layout_to_rt.values() if v is None),
            'skipped_layouts': sum(1 for v in layout_to_rt.values() if v == 'SKIP'),
        }
    except Exception as e:
        return {'table': table, 'sf': sf_object, 'error': str(e)}

if __name__ == '__main__':
    only = sys.argv[1] if len(sys.argv) > 1 else None
    results = []
    for tbl, sf_obj in TARGETS:
        if only and tbl != only:
            continue
        if tbl not in COLS:
            print(f"SKIP {tbl}: no current columns loaded")
            continue
        r = generate(tbl, sf_obj)
        results.append(r)
        if r and 'error' in r:
            print(f"  {tbl}: ERROR {r['error']}")
        else:
            print(f"  {tbl:25s}: alter={r['alter_chars']:6d}c, layouts={r['layouts_chars']:7d}c, "
                  f"missing_cols={r['missing_cols']:3d}, mapped={r['mapped_layouts']:2d}, "
                  f"master={r['master_layouts']}, skip={r['skipped_layouts']:2d}, "
                  f"skipped_fields={r['skipped_fields']:3d}")
    # Summary
    print("\n=== TOTAL ===")
    total = sum(r.get('layouts_chars', 0) for r in results if 'layouts_chars' in r)
    print(f"  Total layout SQL: {total} chars across {len(results)} tables")
