# Salesforce → Anura Layout & Schema Importer

This directory holds the translator that converts Salesforce metadata XML
(layouts + custom-object schemas) into Anura migrations.

## Status

DONE — 4 of 22 SF SObjects fully imported:
- accounts (8 layouts, 132 fields, 32 new cols)
- contacts (6 layouts, 203 fields, 41 new cols)
- properties (5 layouts, 166 fields, 1 new col: property_market_type)
- buildings (5 layouts, 150 fields, 0 new cols — already complete)

PARTIAL — opportunities (170 cols, 28 active SF record types):
- 3 of 24 mappable layouts applied:
  - Opportunity Layout (master fallback)
  - Multifamily
  - 45L Retroactive Tax Credit
- 21 layouts pending — see `pending-opportunities-batch-{2,3,4}.sql`
  - batch-2: MFES-2023, MFES-2023-Equipment, MFES-2024, MFES-2024-Equipment, MFES-2025-Equipment, MFES-Mechanical
  - batch-3: PACE-CO, PACE-IL, PACE-WI, TAX-CREDIT-179D (and dup Multifamily, Opportunity Layout — skip those)
  - batch-4: TruTeam Illinois, WI-IRA-FOE-SF-HOMES, WI-IRA-HEAR, WI-IRA-HOMES, WI-IRA-MF-HOMES-Audit, WI-IRA-SF-HOMES-AUDIT
  - Missing from staged batches: Denver-Audit, Denver-Building Electrification Rebates, Denver-EFR, FOE-2024-WI, MFES-2022 — regenerate via runner.py

PENDING — 17 SObjects to go:
1. Finish opportunities (apply pending batches; regenerate Denver/FOE/MFES-2022)
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
- snake_case conversion handles acronym runs: `Active_PACE_Program__c` → `active_pace_program`,
  `Cooling_Equipment_Capacity_BTUs__c` → `cooling_equipment_capacity_btus`

`autogen.py` — unified per-object workflow:
- Reads custom-object schema (if available) for accurate field types
- `find_missing_fields()` diffs SF layout fields vs Anura columns
- `emit_alter_table()` generates ALTER statements with inferred PG types
  (Checkbox→boolean, Date→date, Number→integer/numeric, Currency→numeric(p,s),
  Picklist→text, Lookup/MasterDetail→uuid, Summary→numeric(18,2) [rollup])
- `run()` does end-to-end: introspection → ALTER + layouts SQL

`runner.py` — thin wrapper that injects EXTRA mappings into FIELD_MAP at runtime.

`auto_translate.py` — earlier helper, now superseded by autogen.py.

## SF metadata source

Workbench `metadata/retrieve` was used to fetch:
- `objects/<Object>__c.object` — custom object schemas (field types, refs, lengths)
- `layouts/<Object>-<Layout Name>.layout` — layout XMLs

These files are NOT committed to this repo. They live in `/home/claude/sf_metadata/`
in the working session. Use the Workbench package.xml from a prior session to refetch
if needed:
- types: CustomObject (Account, Contact, Opportunity, WorkOrder, Property__c, Building__c, ...)
- types: Layout (with `<members>*</members>` to grab all)

## Standing rules (memory-locked)

- ALL record types & layouts must come from Nicholas's actual SF data
- When SF references a field Anura lacks, ADD the column (don't skip)
- Picklist values stay TEXT until CustomField metadata gives the value definitions
- Lookups → uuid (FK target may need explicit assignment later)
- Rollups (Total_*, Number_of_*, Amount_of_*) → numeric placeholder + COMMENT
  noting future trigger/view
- Compound SF fields (BillingAddress, MailingAddress) skipped — covered by
  individual per-axis columns (billing_street, billing_city, ...)
- Apply migrations directly to production (no Supabase dev branches)

## Workflow per object

1. Pull current Anura schema:
   `SELECT column_name FROM information_schema.columns WHERE table_name='X'`
2. Run `autogen.find_missing_fields()` to find SF fields without Anura columns
3. Apply ALTER TABLE migration adding the missing columns (autogen emits this SQL)
4. Build a `LAYOUT_TO_RT` map (SF layout filename label → Anura `picklist_value`)
   - Skip orphan layouts (label='SKIP') if no matching active RT exists
5. Build EXTRA mapping dict for any SF→Anura name overrides not derivable
6. Call `runner.run(table, current_columns, LAYOUT_TO_RT, EXTRA, '/tmp/X.sql')`
7. Apply the generated SQL via Supabase MCP `apply_migration`
   (split into chunks if >60KB)
8. Verify with `SELECT count(*) FROM page_layouts WHERE page_layout_object='X' AND is_deleted=false`

## Resuming

In a fresh session, copy these files from this folder back to /home/claude:
```bash
cp /path/to/anura/tools/sf-import/*.py /home/claude/
```
Then refetch SF metadata to /home/claude/sf_metadata/ if needed.
