// ---------------------------------------------------------------------------
// mergeFieldCatalog.js — relationship map + dynamic field loader for the
// Insert Merge Field picker.
//
// The picker is data-driven. Object groups (Project / Property / Building /
// Work Order / etc.) are declared in MERGE_FIELD_OBJECTS. The field list
// inside each group is fetched at picker open time via
// describe_object_columns() — so adding a new column to a backing table
// makes that field instantly available without a code change.
//
// Token shapes the resolver knows about (mirrored in supabase/functions/
// generate-project-report/index.ts → resolveMergeField):
//
//   Scalar parents:
//     {{<root>.<column>}}        — readField on the related row
//     {{<root>.full_record}}     — project only, "RECORD-NUMBER — Name"
//     {{<root>.full_address}}    — property only, joined address parts
//
//   Collections:
//     {{<root>.count}}           — array length
//     {{<root>.first.<column>}}  — readField on first row (lowest record_number)
//
//   Synthetic (no DB lookup possible):
//     {{report.*}}, {{user.*}}, {{today[.*]}}
//
// Three object kinds:
//   scalar     — single related row reachable from the project graph
//                (property, opportunity, property_owner account, etc.)
//   collection — many rows (work_orders, buildings, units). First-row
//                semantics make collection columns useful in narrative
//                bodies; per-row sections override the first-row default
//                via ctx.currentXxx in the resolver.
//   synthetic  — generated from RenderCtx, not a real table
//
// Adding a new object_key here requires a matching entry in the resolver's
// dispatch map (scalarRoots / collectionRoots) so the renderer can look up
// the row.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'

export const MERGE_FIELD_OBJECTS = [
  // Scalar parents
  { key: 'project',              label: 'Project',              table: 'projects',                  kind: 'scalar' },
  { key: 'property',             label: 'Property',             table: 'properties',                kind: 'scalar' },
  { key: 'property_owner',       label: 'Property Owner',       table: 'accounts',                  kind: 'scalar', description: 'properties.property_account_id' },
  { key: 'property_manager',     label: 'Property Manager',     table: 'accounts',                  kind: 'scalar', description: 'properties.property_managing_account_id' },
  { key: 'project_account',      label: 'Project Account',      table: 'accounts',                  kind: 'scalar', description: 'projects.project_account_id' },
  { key: 'opportunity',          label: 'Opportunity',          table: 'opportunities',             kind: 'scalar', description: 'projects.opportunity_id' },
  { key: 'opportunity_account',  label: 'Opportunity Account',  table: 'accounts',                  kind: 'scalar', description: 'opportunities.opportunity_account_id' },

  // Collections — first-row semantics in narrative bodies; per-row sections
  // override via ctx.currentXxx.
  { key: 'building',             label: 'Building',             table: 'buildings',                 kind: 'collection', description: 'buildings on the property' },
  { key: 'unit',                 label: 'Unit',                 table: 'units',                     kind: 'collection', description: 'units across the property\u2019s buildings' },
  { key: 'work_order',           label: 'Work Order',           table: 'work_orders',               kind: 'collection', description: 'work orders on the project' },
  { key: 'work_step',            label: 'Work Step',            table: 'work_steps',                kind: 'collection', description: 'work steps across all work orders' },
  { key: 'opportunity_line_item',label: 'Opportunity Line Item',table: 'opportunity_line_items',    kind: 'collection', description: 'line items on the source opportunity' },

  // Synthetic — generated from RenderCtx at render time
  { key: 'report',               label: 'Report',               kind: 'synthetic' },
  { key: 'user',                 label: 'User',                 kind: 'synthetic' },
  { key: 'today',                label: 'Today',                kind: 'synthetic' },

  // Signing anchors — NOT merge fields. Literal strings the author types
  // into the .docx at every position where a signer's signature, initials,
  // date, or text input should appear. Survive the docxtemplater merge
  // unchanged (no {{}} delimiters), then get scanned out of the rendered
  // PDF by the signing-portal pipeline to position each signing tab.
  { key: 'signing_anchor',       label: 'Signing Anchors',      kind: 'signing_anchor' },
]

// Synthetic field lists (no DB lookup possible).
const SYNTHETIC_FIELDS = {
  report: [
    { path: 'report.generated_at',           label: 'Generated At' },
    { path: 'report.generated_at_long',      label: 'Generated At (Long)' },
    { path: 'report.generated_at_date',      label: 'Generated Date' },
    { path: 'report.generated_by',           label: 'Generated By' },
    { path: 'report.template_name',          label: 'Template Name' },
    { path: 'report.template_record_number', label: 'Template Number' },
    { path: 'report.template_version',       label: 'Template Version' },
    { path: 'report.work_order_count',       label: 'Work Order Count' },
    { path: 'report.work_step_count',        label: 'Work Step Count' },
    { path: 'report.photo_count',            label: 'Photo Count' },
    { path: 'report.watermark_choice',       label: 'Photo Variant (Watermarked / Original)' },
  ],
  user: [
    { path: 'user.full_name', label: 'Caller Full Name' },
    { path: 'user.email',     label: 'Caller Email' },
  ],
  today: [
    { path: 'today',       label: 'Today (Short)' },
    { path: 'today.long',  label: 'Today (Long)' },
    { path: 'today.iso',   label: 'Today (ISO YYYY-MM-DD)' },
  ],
}

// Signing anchors. Each anchor's `path` is the LITERAL string the author
// places in the .docx — already including the leading/trailing backslashes
// that bracket the anchor token. The picker MUST NOT wrap these in {{}}.
// Five of each kind is the supported ceiling per envelope; multi-signer
// envelopes beyond five recipients would be unusual.
const SIGNING_ANCHOR_FIELDS = [
  { path: '\\sig1\\',     label: 'Signer 1 — Signature',  noBraces: true },
  { path: '\\sig2\\',     label: 'Signer 2 — Signature',  noBraces: true },
  { path: '\\sig3\\',     label: 'Signer 3 — Signature',  noBraces: true },
  { path: '\\sig4\\',     label: 'Signer 4 — Signature',  noBraces: true },
  { path: '\\sig5\\',     label: 'Signer 5 — Signature',  noBraces: true },
  { path: '\\initial1\\', label: 'Signer 1 — Initials',   noBraces: true },
  { path: '\\initial2\\', label: 'Signer 2 — Initials',   noBraces: true },
  { path: '\\initial3\\', label: 'Signer 3 — Initials',   noBraces: true },
  { path: '\\initial4\\', label: 'Signer 4 — Initials',   noBraces: true },
  { path: '\\initial5\\', label: 'Signer 5 — Initials',   noBraces: true },
  { path: '\\date1\\',    label: 'Signer 1 — Date Signed', noBraces: true },
  { path: '\\date2\\',    label: 'Signer 2 — Date Signed', noBraces: true },
  { path: '\\date3\\',    label: 'Signer 3 — Date Signed', noBraces: true },
  { path: '\\date4\\',    label: 'Signer 4 — Date Signed', noBraces: true },
  { path: '\\date5\\',    label: 'Signer 5 — Date Signed', noBraces: true },
]

// Computed (non-column) paths offered alongside a table's real columns.
const COMPUTED_FIELDS = {
  project:  [{ path: 'project.full_record',   label: 'Project (Number — Name)' }],
  property: [{ path: 'property.full_address', label: 'Property Full Address' }],
}

// Suffixes that identify columns we never want to surface in the picker.
// Audit / soft-delete / FK-to-user columns render as raw UUIDs and add noise.
// Picklist FKs are kept — the resolver auto-swaps UUID → label.
const SKIP_COLUMN_SUFFIXES = [
  '_is_deleted', '_deleted_by', '_deleted_at',
  '_created_by', '_updated_by',
]

function shouldSkipColumn(col) {
  if (col.is_primary_key) return true
  if (col.column_name === 'id') return true
  for (const suf of SKIP_COLUMN_SUFFIXES) {
    if (col.column_name.endsWith(suf)) return true
  }
  // FK to a non-picklist table renders as a raw UUID. Skip unless it's a
  // picklist FK — the resolver swaps those for picklist_label automatically.
  if (col.is_foreign_key && col.references_table !== 'picklist_values') return true
  return false
}

// Column name → human label. "project_record_number" → "Record Number"
// (table prefix stripped when redundant with the group label in the UI).
function humanizeColumn(columnName, tablePrefix) {
  let label = columnName
  if (tablePrefix && label.startsWith(tablePrefix + '_')) {
    label = label.slice(tablePrefix.length + 1)
  }
  return label
    .split('_')
    .map(w => w.length === 0 ? w : w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

// Singular column-prefix for a table. Anura's column naming is mostly
// regular (projects → project_*, properties → property_*) but a few
// tables use an abbreviated prefix that doesn't match a naive
// depluralization rule.
function singularizePrefix(table) {
  const overrides = {
    properties:                'property',
    opportunities:             'opportunity',
    incentive_applications:    'ia',
    project_payment_requests:  'ppr',
    payment_receipts:          'payment_receipt',
    opportunity_line_items:    'oli',
  }
  if (overrides[table]) return overrides[table]
  if (table.endsWith('ies'))  return table.slice(0, -3) + 'y'
  if (table.endsWith('s'))    return table.slice(0, -1)
  return table
}

// In-memory cache of describe_object_columns results, scoped to page load.
const _columnCache = new Map()

async function describeObject(tableName) {
  if (_columnCache.has(tableName)) return _columnCache.get(tableName)
  const { data, error } = await supabase.rpc('describe_object_columns', { p_table: tableName })
  if (error) throw error
  const cols = data || []
  _columnCache.set(tableName, cols)
  return cols
}

/**
 * Load the field list for one merge-field object by key. Returns
 * [{ path, label }] ready to render in the picker's right pane.
 *
 * Per-table column metadata is cached so flipping between objects in
 * the picker is instant after the first load.
 */
export async function loadFieldsForObject(key) {
  const obj = MERGE_FIELD_OBJECTS.find(o => o.key === key)
  if (!obj) return []

  if (obj.kind === 'synthetic') {
    return SYNTHETIC_FIELDS[obj.key] || []
  }

  if (obj.kind === 'signing_anchor') {
    return SIGNING_ANCHOR_FIELDS
  }

  const items = []

  // Computed paths (project.full_record, property.full_address) come first.
  if (COMPUTED_FIELDS[obj.key]) {
    for (const c of COMPUTED_FIELDS[obj.key]) items.push(c)
  }

  // Collections expose .count up front, then every column under .first.
  // The resolver also routes plain {{<root>.<col>}} to the first row
  // inside narrative bodies, but the picker is explicit about it so
  // authors understand what they're inserting.
  if (obj.kind === 'collection') {
    items.push({
      path:  `${obj.key}.count`,
      label: `${obj.label} Count`,
    })
  }

  const cols = await describeObject(obj.table)
  const prefix = singularizePrefix(obj.table)
  for (const col of cols) {
    if (shouldSkipColumn(col)) continue
    const fieldPath = obj.kind === 'collection'
      ? `${obj.key}.first.${col.column_name}`
      : `${obj.key}.${col.column_name}`
    items.push({
      path:  fieldPath,
      label: humanizeColumn(col.column_name, prefix),
    })
  }
  return items
}

// Backwards-compat: a few callers may still import the old static catalog
// for synthetic groups only. Table-backed groups load via
// loadFieldsForObject() now.
export const MERGE_FIELD_CATALOG = [
  { group: 'Report', items: SYNTHETIC_FIELDS.report },
  { group: 'User',   items: SYNTHETIC_FIELDS.user },
  { group: 'Today',  items: SYNTHETIC_FIELDS.today },
]
