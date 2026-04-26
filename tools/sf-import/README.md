# Salesforce → Anura Layout & Schema Importer

This directory holds the translator that converts Salesforce metadata XML
(layouts + custom-object schemas) into Anura migrations.

## Status (as of this commit)

DONE — 4 of 22 SF SObjects fully imported:
- accounts (8 layouts, 32 new cols)
- contacts (6 layouts, 41 new cols)
- properties (5 layouts, 1 new col)
- buildings (4 layouts, 0 new cols)

PARTIAL — opportunities:
- 138 cols added via `opportunities_add_sf_custom_fields` migration
- 2 of 24 mappable layouts applied (45L Retroactive Tax Credit, Denver-Audit)
- 22 layouts still pending — see `pending-opportunities-batch-{2,3,4}.sql`

PENDING:
1. Apply opportunities batches 2, 3, 4 (already SQL-ready in this folder)
2. projects (22 layouts) — column adds + layouts
3. assessments, work_orders (15 + 15 layouts)
4. equipment, equipment_activities, mechanical_equipment (5+7+8)
5. vehicle_activities, diagnostic_tests (6+5)
6. incentives, incentive_applications (3+9)
7. time_sheets, time_sheet_entries (3+4)
8. occurrences, gps_points, efr_reports, products, work_steps (~13 total)

## How the translator works

`sf_layout_translator.py` — main module:
- `SF_TO_ANURA_TABLE` / `ANURA_TO_SF_TABLE` — name mappings
- `PREFIX` — column prefix per Anura table
- `FIELD_MAP` — explicit SF field → Anura column overrides (overrides ALWAYS_SKIP)
- `ALWAYS_SKIP` — system fields we never surface
- `translate_object(table, anura_columns, layouts_dir, layout_to_rt_map)` — emits
  the layout migration SQL

`auto_translate.py` — helper:
- `parse_object_metadata(table)` — for custom objects, reads the .object file
  and returns {sf_field: {type, label}}
- `collect_layout_fields(table)` — returns all SF field names referenced
- `sf_field_to_anura_col(sf_field, table)` — acronym-aware snake_case derivation:
  `Active_PACE_Program__c` → `property_active_pace_program`
  `Cooling_Equipment_Capacity_BTUs__c` → `property_cooling_equipment_capacity_btus`

## Standing rules (memory-locked)

- ALL record types & layouts must come from Nicholas's actual SF data
- When SF references a field Anura lacks, ADD the column (don't skip)
- Picklist values stay TEXT until CustomField metadata gives the value definitions
- Lookups → uuid (FK target may need explicit assignment later)
- Rollups (Total_*, Number_of_*, Amount_of_*) → numeric placeholder + COMMENT
  noting future trigger/view
- Compound SF fields (BillingAddress, MailingAddress) skipped — covered by
  individual per-axis columns (billing_street, billing_city, ...)

## Workflow per object

1. Pull current Anura schema:
   `SELECT column_name FROM information_schema.columns WHERE table_name='X'`
2. Run `auto_translate.py X` to find missing fields
3. Write ALTER TABLE migration adding the missing columns
4. Update FIELD_MAP in `sf_layout_translator.py` for any non-derived mappings
5. Build LAYOUT_TO_RT mapping (SF layout name → Anura record_type picklist_value)
6. Call `translate_object()` to generate layout SQL
7. Apply via Supabase MCP `apply_migration`
8. Verify with SELECT count of layouts/sections/widgets
