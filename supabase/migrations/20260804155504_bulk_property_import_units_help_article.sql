-- Update HA-00062 (Bulk Property Import) for the new Units sheet, the record-type
-- fixes, and the required Property Zip. Idempotent: only rewrites the body/summary.

UPDATE public.help_articles
SET
  ha_title = 'Bulk Property Import — Owner, Property, Building, Unit from one spreadsheet',
  ha_summary = 'Create Account → Property → Building → Unit records in one pass from an Excel workbook. Buildings come from the Data sheet; real unit names/numbers and attributes come from the Units sheet (or auto-generate from a count).',
  ha_body_markdown = $md$
# Bulk Property Import

The bulk importer creates Account → Property → Building → Unit records in one pass from a single Excel workbook. Built for the common case: a property owner hands you a list of properties with multiple buildings — and now the actual units in each building — and you need all of it in LEAP without typing each one.

## Where it lives

**Setup → Data → Bulk Property Import.** Four-step wizard: Download template → Upload filled file → Preview & resolve → Confirm.

## The workbook

The template is a pre-built XLSX with four tabs:

- **Data** — one row per **building** (Owner, Property, Building, Unit Count).
- **Units** — one row per **unit**, tied to its building. Optional; use it when you want real unit names/numbers and attributes instead of generic placeholders.
- **Instructions** — every column documented.
- **Lists** — the valid picklist values (Unit Record Type, Subsidy Type, State) to copy from.

Don't rename the headers — the importer matches on them by name.

### Data sheet columns

- **Owner Name** (required) — creates or matches an Account.
- **Property Name** (required)
- **Property Street / City / State** (required; State is the 2-letter code)
- **Property Zip** (required) — 5 digits or ZIP+4.
- **Subsidy Type** (optional) — Section 8 / HUD, LIHTC, NOAH, DAC, NEST Community, Public Housing Authority Owned, Other.
- **Building Name** (required)
- **Year Built** (optional, integer)
- **Unit Count** (optional integer ≥ 1) — if you do **not** list the building on the Units sheet, the importer auto-creates this many placeholder units (Unit 1, Unit 2, …). If you **do** list units, those win and the count is ignored. Every building needs either a Unit Count or rows on the Units sheet.
- **Building Notes** (optional)

### Units sheet columns

- **Property Name** + **Building Name** (required) — must match the Data sheet exactly; this is how each unit finds its building.
- **Unit Number** — the unit's identifier (101, 07-2, CR). A unit needs a Unit Name **or** a Unit Number.
- **Unit Name** — an optional label; when Unit Number is blank the name is used as the identifier. Note: LEAP composes each unit's displayed name as *Building - Unit Number* automatically, matching how every existing unit is named, so the number is what matters most.
- **Unit Record Type** — one of ATTIC-SPACE, COMMON-AREA, DWELLING-UNIT, HALLWAY, MECHANICAL-ROOM, OFFICE, STANDARD (see the Lists sheet). Blank defaults to **DWELLING-UNIT**.
- **Bedrooms, Bathrooms, Square Footage, Floor, Unit Notes** — all optional.

## Record types

Imported records get their standard record types automatically: accounts are created as **Property Owner**, properties as **MultiFamily**, and units as whatever you set on the Units sheet (default Dwelling Unit).

## Deduplication

Applied in this order:

1. **Owner Name** — matched by normalized name **across record types** (entity words like LLC / Inc. are ignored), so a company is one account regardless of the role it plays. An existing Property Owner account is reused rather than duplicated.
2. **Property** — matched on a normalized Street + City + State. "123 Main St" and "123 Main Street, Madison, WI" are the same property.
3. **Building** — matched on Property + Building Name. Two buildings can't share a name at one property.
4. **Unit** — matched on Building + Unit Number. Re-running an import adds only the units that don't already exist; it never duplicates a unit or its building.

## The preview screen

After upload the importer parses the file and runs two passes:

- **Client-side** — required fields, ZIP format, state code, Unit Count / Year Built ranges, in-file duplicate buildings, and a summary of any Units-sheet rows that didn't match a building or carry an unrecognized record type.
- **Server-side** — `preview_property_hierarchy_import` flags rows whose addresses already exist in LEAP.

Every flagged row gets a status pill (OK / Warning / Error / Skip), an issue list, and an **Action** dropdown (Create, Skip, Add building to existing property, or Block when a building already exists). The **Units** column shows whether the building's units come from an explicit list ("N listed") or the auto-count ("N auto"). **"Apply recommended action to all flagged rows"** sets every action to the server's suggestion in one click.

## Confirm & audit

The Import button stays disabled until every error is resolved, then commits the whole payload in one transaction — if anything fails mid-way, nothing is written. Every successful import writes a **BIR-####** row to `bulk_import_runs` capturing the source filename, counts, the full JSON payload, and the IDs of every record created.

## What's not in v1

- **Update existing properties** — the importer creates new rows or adds buildings/units to existing ones; editing existing property fields happens through the regular UI.
- **One-click rollback** — the audit row preserves the created record IDs, but undo is manual soft-delete for now.
- **Tenant / income-qualification and utility fields on units** — the Units sheet covers physical attributes; deeper unit data is entered per unit or via a future rent-roll importer.
- **Other object hierarchies** — this is the property-hierarchy importer specifically.
$md$
WHERE ha_record_number = 'HA-00062';
