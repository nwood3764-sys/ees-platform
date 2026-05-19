DO $$
DECLARE
  v_admin_id uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_ha_id    uuid;
BEGIN
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_category, ha_audience,
    ha_summary, ha_body_markdown, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    '', 'bulk-property-import',
    'Bulk Property Import — Owner, Property, Building, Unit from one spreadsheet',
    'Administration', 'admin',
    'How to import dozens or hundreds of properties at once from a single Excel file. Covers the template, the upload + preview flow, address-based deduplication, the per-row resolution dropdowns, and the audit row written for every committed import.',
$body$
# Bulk Property Import

The bulk importer creates Account → Property → Building → Unit records in one pass from a single Excel file. Built for the common case: a property owner hands you a list of 50 properties with multiple buildings each, you need all of it in LEAP without typing each one.

## Where it lives

**Setup → Data → Bulk Property Import.** Four-step wizard: Download template → Upload filled file → Preview & resolve → Confirm.

## The template

The template is a pre-built XLSX with the exact column headers the importer expects, example rows showing the shape, and an Instructions sheet documenting every column. Don't rename the headers — the importer matches on them by name.

**One row per building.** If a property has 3 buildings, that's 3 rows. The Owner Name, Property Name, and Property Address columns are repeated on every row at the same property — the importer deduplicates automatically.

## Columns

- **Owner Name** (required) — creates or matches an Account. Exact match on name after trimming whitespace.
- **Property Name** (required) — displayed on the Property record.
- **Property Street** (required)
- **Property City** (required)
- **Property State** (required, 2-letter code)
- **Property Zip** (optional)
- **Subsidy Type** (optional) — affordability category. Valid values: Section 8 / HUD, LIHTC, NOAH, DAC, NEST Community, Other.
- **Building Name** (required)
- **Year Built** (optional, integer)
- **Unit Count** (required, integer ≥ 1) — the importer auto-creates that many Unit records (Unit 1, Unit 2, …) under the building.
- **Building Notes** (optional)

## Deduplication

Three rules, applied in this order:

1. **Owner Name** — exact match (trim + lowercase + collapse whitespace). "Mercy Housing" and "Mercy Housing Inc." stay separate. Clean variants up before uploading if you want them merged.

2. **Property** — matched on a normalized form of Street + City + State. "123 Main St" and "123 Main Street, Madison, WI" are treated as the same property. The user's original input is stored on the record.

3. **Building** — matched on Property + Building Name (lowercase). Two buildings cannot share a name at the same property.

## The preview screen

After upload, the importer parses the file and runs two passes:

- **Client-side**: checks required fields, validates the state code, validates Unit Count and Year Built ranges, detects in-file duplicates (same building name twice at the same property → error; same property address with different Property Name spellings → warning).
- **Server-side**: calls `preview_property_hierarchy_import` to detect rows whose addresses already exist in LEAP.

Every flagged row gets a status pill (OK / Warning / Error / Skip), an issue list, and an **Action** dropdown:

- **Create** — default for new addresses.
- **Skip** — default when the property already exists in LEAP. Row is ignored.
- **Add building to existing property** — overrides Skip to attach this row's building to an existing LEAP property.
- **Block — building already exists in LEAP** — hard error when the property exists AND the building name exists at it. Must be resolved (Skip or rename the building) before the import button enables.

**"Apply recommended action to all flagged rows"** sets every action dropdown to the server's suggestion in one click. Most imports use this.

## Confirm

The Import button is disabled until every error is resolved. Click it once, the importer commits the entire payload in one transaction. If anything fails mid-way, nothing is written.

## Audit

Every successful import writes a row to `bulk_import_runs` (record number BIR-####) capturing:

- Source filename
- Row count
- Records created (owners, properties, buildings, units)
- The full payload as JSON (including each row's chosen action)
- The IDs of every record created — for review and eventual reversal
- Who imported, when

The audit row survives the seed-data purge so the import history is preserved across go-live.

## What's not in v1

- **Per-unit detail** (unit number, bedrooms, square footage) — units are placeholders for v1. A separate Rent Roll Import will land later for unit-level data.
- **Update existing properties** — the importer only creates new rows or adds buildings to existing properties. Editing existing property fields happens through the regular UI.
- **Reverse an import** — the audit row preserves the created record IDs, but a one-click rollback isn't built yet. Use soft-delete on the records manually if you need to undo.
- **Other object hierarchies** — this is the property-hierarchy importer specifically. Contacts, Opportunities, etc. will get their own importers later.
$body$,
    true,
    v_admin_id, v_admin_id
  )
  RETURNING id INTO v_ha_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_route, haa_created_by) VALUES
    (v_ha_id, 'route', '/admin/bulk_property_import', v_admin_id);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_created_by) VALUES
    (v_ha_id, 'object', 'accounts',           v_admin_id),
    (v_ha_id, 'object', 'properties',         v_admin_id),
    (v_ha_id, 'object', 'buildings',          v_admin_id),
    (v_ha_id, 'object', 'units',              v_admin_id),
    (v_ha_id, 'object', 'bulk_import_runs',   v_admin_id);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_created_by) VALUES
    (v_ha_id, 'concept', 'bulk-import',                v_admin_id),
    (v_ha_id, 'concept', 'property-hierarchy-import',  v_admin_id),
    (v_ha_id, 'concept', 'address-normalization',     v_admin_id),
    (v_ha_id, 'concept', 'address-deduplication',     v_admin_id),
    (v_ha_id, 'concept', 'import-template',           v_admin_id),
    (v_ha_id, 'concept', 'import-preview',            v_admin_id),
    (v_ha_id, 'concept', 'transactional-import',      v_admin_id);
END $$;
