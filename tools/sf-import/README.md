# Salesforce → Anura Layout & Schema Importer

This directory holds the translator that converts Salesforce metadata XML
(layouts + custom-object schemas) into Anura migrations.

## Status

DONE — 22 of 22 SF SObjects fully imported (production):

- accounts (8 layouts, 132 fields, 32 new cols)
- contacts (6 layouts, 203 fields, 41 new cols)
- properties (5 layouts, 166 fields, 1 new col)
- buildings (5 layouts, 150 fields, 0 new cols)
- projects (7 layouts, 40 new cols)
- gps_points (2 layouts, 7 new cols, prefix `gps_`)
- work_steps (2 layouts, 1 new col)
- time_sheets (3 layouts, 5 new cols)
- occurrences (2 layouts, 14 new cols)
- incentives (3 layouts, 16 new cols)
- time_sheet_entries (4 layouts, 16 new cols)
- equipment (3 layouts, 23 new cols)
- equipment_activities (7 layouts, 11 new cols)
- vehicle_activities (5 layouts, 23 new cols)
- diagnostic_tests (5 layouts, 40 new cols)
- products (3 layouts, 26 new cols — SF had 4, one orphan SKIPped)
- mechanical_equipment (8 layouts, 16 new cols)
- efr_reports (2 layouts, 119 new cols)
- work_orders (10 layouts, 32 new cols)
- incentive_applications (9 layouts, 96 new cols)
- assessments (12 layouts, 196 new cols)
- opportunities (24 layouts — DESTRUCTIVE replace; soft-deleted prior 9
  on first chunk, then inserted all 24 across 6 chunks in same session)

Total: 137 page layouts, ~870 columns added across the 22 tables.

## Resume mechanism

The remaining chunks for the last 4 SObjects (work_orders, incentive_applications,
assessments, opportunities — 14 chunks total) were applied via a database-side
helper that fetches each chunk file from the public GitHub repo and executes it:

```sql
SELECT public.apply_sql_from_url(
  'https://raw.githubusercontent.com/nwood3764-sys/anura/master/tools/sf-import/generated/<chunk>.sql'
);
```

The helper relies on the `http` extension (enabled in this project) and a
SECURITY DEFINER function `public.apply_sql_from_url(text)`. This pattern
avoids round-tripping ~50KB of verbose layout SQL through the MCP tool
parameter on every chunk — the database fetches the chunk content directly.

If you ever need to re-run or amend a layout import:
1. Edit / regenerate the chunk file in `generated/`.
2. Push the change to `master`.
3. Call `SELECT public.apply_sql_from_url('<raw github url>');` from the
   Supabase SQL editor or MCP.

## Translator

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

## Workflow per object (when adding a NEW SObject in the future)

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

## Resuming in a fresh session

The translator scripts are committed to this folder. Refetch SF metadata to
`/home/claude/sf_metadata/` if needed via Workbench, copy translator files to
`/home/claude/`, then proceed per the workflow above.
