"""Generate column-add migration AND layout migration for one object end-to-end.

Usage:
  python autogen.py <anura_table> <sf_object>

Reads:
  - /home/claude/sf_metadata/objects/<sf_object>.object  (custom-object schema, optional)
  - /home/claude/sf_metadata/layouts/<sf_object>-*.layout (layouts XML)
  - Anura DB current columns (passed via env or hardcoded list)

Outputs:
  - /tmp/<anura_table>_alter.sql  — column-adds
  - /tmp/<anura_table>_layouts.sql — page_layouts seed
"""
import os, re, sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {'sf': 'http://soap.sforce.com/2006/04/metadata'}

sys.path.insert(0, '/home/claude')
import sf_layout_translator
import importlib; importlib.reload(sf_layout_translator)
from sf_layout_translator import (
    SF_TO_ANURA_TABLE, ANURA_TO_SF_TABLE, PREFIX, FIELD_MAP, ALWAYS_SKIP,
    translate_object,
)

LAYOUTS_DIR = '/home/claude/sf_metadata/layouts'
OBJECTS_DIR = '/home/claude/sf_metadata/objects'


def load_sf_field_schema(sf_object):
    path = Path(OBJECTS_DIR) / f"{sf_object}.object"
    if not path.exists(): return {}
    tree = ET.parse(path)
    out = {}
    for f in tree.getroot().findall('sf:fields', NS):
        n = f.find('sf:fullName', NS); t = f.find('sf:type', NS)
        if n is None or t is None: continue
        ref = f.find('sf:referenceTo', NS); ln = f.find('sf:length', NS)
        prec = f.find('sf:precision', NS); sc = f.find('sf:scale', NS)
        formula = f.find('sf:formula', NS); summ = f.find('sf:summarizedField', NS)
        label = f.find('sf:label', NS)
        out[n.text] = {
            'type': t.text,
            'label': label.text if label is not None else n.text,
            'ref': ref.text if ref is not None else None,
            'len': int(ln.text) if ln is not None else None,
            'precision': int(prec.text) if prec is not None else None,
            'scale': int(sc.text) if sc is not None else None,
            'formula': formula.text if formula is not None else None,
            'summary': summ.text if summ is not None else None,
        }
    return out


def sf_type_to_pg(meta):
    if not meta: return 'text'
    t = meta.get('type', '')
    if t == 'Checkbox':       return 'boolean'
    if t == 'Date':           return 'date'
    if t == 'DateTime':       return 'timestamp with time zone'
    if t == 'Time':           return 'time'
    if t == 'Currency':
        return f"numeric({meta.get('precision') or 18},{meta.get('scale') or 2})"
    if t == 'Number':
        scale = meta.get('scale') or 0; prec = meta.get('precision') or 18
        return 'integer' if scale == 0 and prec <= 9 else f"numeric({prec},{scale})"
    if t == 'Percent':
        return f"numeric({meta.get('precision') or 5},{meta.get('scale') or 2})"
    if t in ('Text','AutoNumber','Email','Phone','Url'):  return 'text'
    if t in ('TextArea','LongTextArea','Html'):           return 'text'
    if t in ('Picklist','MultiselectPicklist'):           return 'text'
    if t in ('Lookup','MasterDetail'):                     return 'uuid'
    if t == 'Summary':                                    return 'numeric(18,2)'
    if t == 'Location':                                   return 'jsonb'
    return 'text'


def snake(s):
    s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', s)
    s = re.sub(r'([a-z\d])([A-Z])', r'\1_\2', s)
    return s.lower().replace('__','_').strip('_')


def all_referenced_fields(sf_object):
    out = set()
    for lf in os.listdir(LAYOUTS_DIR):
        if not lf.startswith(f"{sf_object}-"): continue
        t = ET.parse(f"{LAYOUTS_DIR}/{lf}")
        for fe in t.getroot().iter():
            if fe.tag.endswith('}field') and fe.text:
                out.add(fe.text)
    return out


def map_or_default(sf, anura_table, custom_overrides):
    """Return the Anura column name this SF field should map to."""
    full_map = {**FIELD_MAP.get(anura_table, {}), **custom_overrides}
    if sf in full_map: return full_map[sf]
    if sf in ALWAYS_SKIP: return None
    if sf.endswith('__c'):
        base = sf[:-3]
        return f"{PREFIX[anura_table]}{snake(base)}"
    return None


def build_alter_and_field_map(anura_table, sf_object, current_columns, extra_overrides):
    """Returns (alter_sql, full_field_map, missing_list)"""
    schema = load_sf_field_schema(sf_object)
    referenced = all_referenced_fields(sf_object)
    full_map = {}
    missing = []
    skip_compounds = {'MailingAddress','BillingAddress','ShippingAddress','OtherAddress'}
    for sf in sorted(referenced):
        if sf in skip_compounds: continue
        target = map_or_default(sf, anura_table, extra_overrides)
        if target is None:
            continue
        full_map[sf] = target
        if target not in current_columns:
            missing.append((sf, target, sf_type_to_pg(schema.get(sf, {})), schema.get(sf, {})))

    # Generate ALTER
    if not missing:
        alter = f"-- All SF Layout fields already exist as Anura columns for {anura_table}.\n"
    else:
        lines = [f"ALTER TABLE public.{anura_table}"]
        parts = []
        for sf, col, pg_type, meta in missing:
            parts.append(f"  ADD COLUMN IF NOT EXISTS {col:55s} {pg_type}")
        lines.append(',\n'.join(parts) + ';')
        for sf, col, pg_type, meta in missing:
            if meta.get('type') == 'Summary' or meta.get('formula'):
                lines.append(f"COMMENT ON COLUMN public.{anura_table}.{col} IS 'SF formula/rollup field. Populated by future trigger or view.';")
        alter = '\n'.join(lines) + '\n'
    return alter, full_map, missing


def run(anura_table, sf_object, current_columns, layout_to_rt, extra_overrides):
    alter, full_map, missing = build_alter_and_field_map(
        anura_table, sf_object, current_columns, extra_overrides)
    # Inject full map into FIELD_MAP for translator
    sf_layout_translator.FIELD_MAP[anura_table] = {
        **sf_layout_translator.FIELD_MAP.get(anura_table, {}),
        **full_map,
    }
    # The translator's anura_columns set must include columns we're about to add
    cols = current_columns | {m[1] for m in missing}
    sql, skipped = translate_object(
        anura_table=anura_table,
        anura_columns=cols,
        layouts_dir=LAYOUTS_DIR,
        sf_rt_label_to_picklist_value=layout_to_rt,
    )
    Path(f"/tmp/{anura_table}_alter.sql").write_text(alter)
    Path(f"/tmp/{anura_table}_layouts.sql").write_text(sql)
    return alter, sql, missing, skipped
