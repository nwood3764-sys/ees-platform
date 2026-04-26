"""
Full per-object SF → Anura import workflow.

Usage: python3 auto_translate.py <anura_table>

For one object:
1. Parse SF .object file → get all custom fields with types + labels
2. Parse all SF layout files for that object → get fields actually used
3. Diff vs current Anura schema → identify missing columns
4. Generate column-add migration with proper Postgres types from SF types
5. Generate layout migration mapping SF fields → Anura columns

Output: /tmp/<table>_columns.sql, /tmp/<table>_layouts.sql, /tmp/<table>_field_map.py
"""
import sys
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, '/home/claude')
from sf_layout_translator import (
    SF_TO_ANURA_TABLE, ANURA_TO_SF_TABLE, PREFIX, FIELD_MAP, ALWAYS_SKIP,
    parse_layout_xml, jsonb_object, sql_escape,
)

NS = {'sf': 'http://soap.sforce.com/2006/04/metadata'}

# ─── SF type → Postgres type ─────────────────────────────────────────────
# Defaults are deliberately conservative; reversible via ALTER COLUMN.
SF_TYPE_TO_PG = {
    'Text':            'text',
    'TextArea':        'text',
    'LongTextArea':    'text',
    'Html':            'text',
    'EncryptedText':   'text',
    'Url':             'text',
    'Email':           'text',
    'Phone':           'text',
    'Picklist':        'text',         # picklist values stored as text; convert to uuid FK later
    'MultiselectPicklist': 'text',
    'Checkbox':        'boolean',
    'Date':            'date',
    'DateTime':        'timestamptz',
    'Time':            'time',
    'Number':          'numeric(18,4)',
    'Currency':        'numeric(18,2)',
    'Percent':         'numeric(8,4)',
    'Lookup':          'uuid',
    'MasterDetail':    'uuid',
    'AutoNumber':      'text',
    'Formula':         'text',          # formulas → cached as text by default
    'Summary':         'numeric(18,2)', # rollup summaries
    'Hierarchy':       'uuid',          # SF hierarchy
    'ExternalLookup':  'text',
    'IndirectLookup':  'text',
    'Location':        'text',          # GeoLocation; would need decomposition if used
}


def sf_field_to_anura_col(sf_field, anura_table):
    """Convert SF field name (FooBar__c or Standard) to Anura column name.
    Adds object prefix if it's a custom field; returns None for fields we skip.

    Splits on existing underscores (SF API names already use them at word boundaries),
    then within each part inserts an underscore before a single capital that follows
    a lowercase letter (camelCase). Acronyms like PACE, HUD, BTUs, AMI stay together.
    """
    if sf_field in ALWAYS_SKIP:
        return None
    if not sf_field.endswith('__c'):
        return None  # standard field → must be hand-mapped in FIELD_MAP

    base = sf_field[:-3]
    parts = base.split('_')
    out = []
    for p in parts:
        # Split before camelCase boundary
        sub = re.sub(r'(?<=[a-z])(?=[A-Z])', '_', p)
        # Split before a capital starting a new word (≥2 lowercase letters follow,
        # so "BTUs" stays as one word but "BTUmeasurement" → "btu_measurement").
        sub = re.sub(r'(?<=[A-Z])(?=[A-Z][a-z]{2,})', '_', sub)
        out.append(sub.lower())
    snake = '_'.join(s for s in out if s)
    return f"{PREFIX[anura_table]}{snake}"


def parse_object_metadata(anura_table):
    """Return dict {sf_field_name: {'type': sf_type, 'label': sf_label}} for the object's CustomObject metadata file."""
    sf_obj = ANURA_TO_SF_TABLE[anura_table]
    obj_path = f"/home/claude/sf_metadata/objects/{sf_obj}.object"
    if not os.path.exists(obj_path):
        return {}  # standard SF object (Account, Contact, etc.) — no .object file
    tree = ET.parse(obj_path)
    out = {}
    for f in tree.getroot().findall('sf:fields', NS):
        name = f.find('sf:fullName', NS)
        if name is None or not name.text:
            continue
        typ = f.find('sf:type', NS)
        label = f.find('sf:label', NS)
        ref_to = f.find('sf:referenceTo', NS)
        out[name.text] = {
            'type':     typ.text if typ is not None else 'Text',
            'label':    label.text if label is not None else name.text,
            'ref_to':   ref_to.text if ref_to is not None else None,
        }
    return out


def collect_layout_fields(anura_table):
    """Return set of all SF field names referenced across all SF layouts for this object."""
    sf_obj = ANURA_TO_SF_TABLE[anura_table]
    fields = set()
    for lf in Path('/home/claude/sf_metadata/layouts').glob(f"{sf_obj}-*.layout"):
        for sec in parse_layout_xml(lf):
            for sf_field, _behavior in sec['fields']:
                fields.add(sf_field)
    return fields


def get_anura_columns(anura_table):
    """Stub — caller fills via Supabase introspection. Here for type completeness."""
    return set()


def generate_column_adds(anura_table, anura_columns, layout_fields, sf_metadata, manual_overrides=None):
    """For each layout-referenced SF field that lacks an Anura column, emit ALTER TABLE ADD COLUMN.

    manual_overrides: dict of {sf_field: anura_col} for special cases.
    Returns: (sql_text, list of (sf_field, anura_col, pg_type))
    """
    manual_overrides = manual_overrides or {}
    additions = []
    skipped_no_meta = []

    for sf in sorted(layout_fields):
        # Already mapped explicitly?
        if sf in FIELD_MAP.get(anura_table, {}):
            target = FIELD_MAP[anura_table][sf]
            if target is None or target in anura_columns:
                continue
            # Mapping exists but column missing — try to add it
            if sf in sf_metadata:
                pg_type = SF_TYPE_TO_PG.get(sf_metadata[sf]['type'], 'text')
                additions.append((sf, target, pg_type, sf_metadata[sf].get('label', sf)))
            continue

        # Hand override?
        if sf in manual_overrides:
            target = manual_overrides[sf]
            if target in anura_columns:
                continue
            if sf in sf_metadata:
                pg_type = SF_TYPE_TO_PG.get(sf_metadata[sf]['type'], 'text')
                additions.append((sf, target, pg_type, sf_metadata[sf].get('label', sf)))
            continue

        if sf in ALWAYS_SKIP:
            continue

        # Custom field — derive name and check
        derived = sf_field_to_anura_col(sf, anura_table)
        if derived is None:
            continue
        if derived in anura_columns:
            continue
        if sf in sf_metadata:
            pg_type = SF_TYPE_TO_PG.get(sf_metadata[sf]['type'], 'text')
            additions.append((sf, derived, pg_type, sf_metadata[sf].get('label', sf)))
        else:
            skipped_no_meta.append(sf)

    if not additions:
        return "-- (no column additions needed)\n", [], skipped_no_meta

    lines = []
    lines.append(f"-- Auto-generated column additions for {anura_table}")
    lines.append(f"-- {len(additions)} new columns from SF Custom fields used in layouts")
    lines.append("")
    lines.append(f"ALTER TABLE public.{anura_table}")
    add_lines = []
    for sf, anura_col, pg_type, label in additions:
        add_lines.append(f"  ADD COLUMN IF NOT EXISTS {anura_col:55s} {pg_type}  -- SF: {sf} ({label})")
    lines.append(",\n".join(add_lines) + ";")
    lines.append("")

    return "\n".join(lines), additions, skipped_no_meta


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 auto_translate.py <anura_table>", file=sys.stderr)
        sys.exit(1)
    table = sys.argv[1]
    print(f"# Object: {table}")
    sf_obj = ANURA_TO_SF_TABLE[table]
    print(f"# SF SObjectType: {sf_obj}")
    meta = parse_object_metadata(table)
    print(f"# Custom fields in SF metadata: {len(meta)}")
    layout_fields = collect_layout_fields(table)
    print(f"# Fields referenced in SF layouts: {len(layout_fields)}")


if __name__ == '__main__':
    main()
