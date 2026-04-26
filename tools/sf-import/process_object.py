"""Process one Anura object's SF layout import end-to-end.

Given:
  - anura_table (e.g. 'properties')
  - sf_object (e.g. 'Property__c')
  - layout_to_rt: dict mapping SF layout filename label → SF picklist_value (or None for fallback, 'SKIP' for orphans)
  - extra_field_map: dict of explicit SF field → Anura column overrides
  - current_columns: set of Anura column names currently in the table

Produces:
  - column_adds.sql — ALTER TABLE statements for missing columns (with inferred types)
  - layouts.sql — page_layouts migration

For custom objects (SF Object ending in __c), reads /home/claude/sf_metadata/objects/<sf_object>.object
to get exact field types. For standard objects (no __c), falls back to type inference from name.
"""
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {'sf': 'http://soap.sforce.com/2006/04/metadata'}

sys.path.insert(0, '/home/claude')
from sf_layout_translator import (
    SF_TO_ANURA_TABLE, ANURA_TO_SF_TABLE, PREFIX, FIELD_MAP, ALWAYS_SKIP,
    parse_layout_xml, sql_escape, jsonb_object,
)

LAYOUTS_DIR = '/home/claude/sf_metadata/layouts'
OBJECTS_DIR = '/home/claude/sf_metadata/objects'


def load_sf_field_schema(sf_object):
    """Read the SF custom object metadata file → {field_name: {type, ref, len, precision, scale}}."""
    path = Path(OBJECTS_DIR) / f"{sf_object}.object"
    if not path.exists():
        return {}
    tree = ET.parse(path)
    out = {}
    for f in tree.getroot().findall('sf:fields', NS):
        name_el = f.find('sf:fullName', NS)
        type_el = f.find('sf:type', NS)
        if name_el is None or type_el is None:
            continue
        ref_el  = f.find('sf:referenceTo', NS)
        len_el  = f.find('sf:length', NS)
        prec_el = f.find('sf:precision', NS)
        scale_el= f.find('sf:scale', NS)
        formula_el= f.find('sf:formula', NS)
        out[name_el.text] = {
            'type': type_el.text,
            'ref': ref_el.text if ref_el is not None else None,
            'len': int(len_el.text) if len_el is not None else None,
            'precision': int(prec_el.text) if prec_el is not None else None,
            'scale': int(scale_el.text) if scale_el is not None else None,
            'formula': formula_el.text if formula_el is not None else None,
        }
    return out


def sf_type_to_pg(sf_meta, sf_field_name):
    """Convert an SF field type to a Postgres column type."""
    if not sf_meta:
        return 'text'  # fallback for no schema available
    t = sf_meta.get('type', '')
    if t == 'Checkbox':       return 'boolean'
    if t == 'Date':           return 'date'
    if t == 'DateTime':       return 'timestamp with time zone'
    if t == 'Time':           return 'time'
    if t == 'Currency':       return f"numeric({sf_meta.get('precision') or 18},{sf_meta.get('scale') or 2})"
    if t == 'Number':
        scale = sf_meta.get('scale') or 0
        prec = sf_meta.get('precision') or 18
        return 'integer' if scale == 0 and prec <= 9 else f"numeric({prec},{scale})"
    if t == 'Percent':        return f"numeric({sf_meta.get('precision') or 5},{sf_meta.get('scale') or 2})"
    if t == 'Email':          return 'text'
    if t == 'Phone':          return 'text'
    if t == 'Url':            return 'text'
    if t == 'Text':           return f"varchar({sf_meta.get('len') or 255})"
    if t == 'TextArea':       return 'text'
    if t == 'LongTextArea':   return 'text'
    if t == 'Html':           return 'text'
    if t == 'Picklist':       return 'text'
    if t == 'MultiselectPicklist': return 'text'
    if t in ('Lookup', 'MasterDetail'): return 'uuid'
    if t == 'Summary':        return 'numeric(18,2)'  # rollup
    if t == 'AutoNumber':     return 'text'
    if t == 'Location':       return 'jsonb'
    return 'text'


def name_to_anura(sf_name, anura_table, extra_map):
    """SF API name → Anura column name (best guess). Returns None if it can't decide."""
    full_map = {**FIELD_MAP.get(anura_table, {}), **(extra_map or {})}
    if sf_name in full_map:
        return full_map[sf_name]
    if sf_name in ALWAYS_SKIP:
        return None
    if sf_name.endswith('__c'):
        base = sf_name[:-3]
        s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', base)
        s = re.sub(r'([a-z\d])([A-Z])', r'\1_\2', s)
        return f"{PREFIX[anura_table]}{s.lower().replace('__','_').strip('_')}"
    return None


def find_missing_fields(anura_table, sf_object, current_columns, extra_map):
    """Return list of (sf_field, anura_col, pg_type, is_rollup) for SF layout fields not in Anura."""
    sf_schema = load_sf_field_schema(sf_object)
    referenced = set()
    for lf in os.listdir(LAYOUTS_DIR):
        if not lf.startswith(f"{sf_object}-"): continue
        t = ET.parse(f"{LAYOUTS_DIR}/{lf}")
        for fe in t.getroot().iter():
            if fe.tag.endswith('}field') and fe.text:
                referenced.add(fe.text)

    missing = []
    full_map = {**FIELD_MAP.get(anura_table, {}), **(extra_map or {})}
    for sf in sorted(referenced):
        # Skip if already mapped to something in the schema
        if sf in full_map:
            target = full_map[sf]
            if target is None or target in current_columns:
                continue
            # mapped to a column not yet in DB — needs adding
            anura_col = target
        elif sf in ALWAYS_SKIP:
            continue
        else:
            anura_col = name_to_anura(sf, anura_table, extra_map)
            if anura_col is None or anura_col in current_columns:
                continue
        meta = sf_schema.get(sf, {})
        pg_type = sf_type_to_pg(meta, sf)
        is_rollup = meta.get('type') == 'Summary' or (meta.get('formula') is not None)
        missing.append((sf, anura_col, pg_type, is_rollup))
    return missing


def emit_alter_table(anura_table, missing):
    """Generate the ALTER TABLE migration."""
    if not missing:
        return f"-- No missing columns for {anura_table}\n"
    lines = [f"ALTER TABLE public.{anura_table}"]
    parts = []
    for sf, col, pg_type, _ in missing:
        parts.append(f"  ADD COLUMN IF NOT EXISTS {col:55s} {pg_type}")
    lines.append(',\n'.join(parts) + ';')
    # Comments for rollups
    for sf, col, pg_type, is_rollup in missing:
        if is_rollup:
            lines.append(f"COMMENT ON COLUMN public.{anura_table}.{col} IS 'SF rollup/formula field. Populated by future trigger or view.';")
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    print("Use as a module — call find_missing_fields() / emit_alter_table() / translate_object()")
