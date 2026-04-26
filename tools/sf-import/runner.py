"""Run translator for one object. Injects EXTRA mapping into FIELD_MAP at runtime."""
import sys, importlib
sys.path.insert(0, '/home/claude')
import sf_layout_translator
importlib.reload(sf_layout_translator)
from sf_layout_translator import translate_object


def run(anura_table, anura_columns, layout_to_rt, extra_field_map, output_path):
    """Inject extra_field_map, run translator, write SQL.
    Returns (sql_chars, skipped_list)."""
    # Merge into module-level FIELD_MAP
    sf_layout_translator.FIELD_MAP[anura_table] = {
        **sf_layout_translator.FIELD_MAP.get(anura_table, {}),
        **extra_field_map,
    }
    sql, skipped = translate_object(
        anura_table=anura_table,
        anura_columns=anura_columns,
        layouts_dir='/home/claude/sf_metadata/layouts',
        sf_rt_label_to_picklist_value=layout_to_rt,
    )
    with open(output_path, 'w') as f:
        f.write(sql)
    return len(sql), skipped
