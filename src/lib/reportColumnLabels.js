// reportColumnLabels — the ONE rule that names a report's columns.
//
// Nicholas, 2026-08-25, from RPT-00041 "Lutheran Social Services
// Opportunities": three columns in a row all headed "NAME". The report was
// showing the property's name, the building's name and the opportunity's
// name, and every header read the same because a column's label was derived
// by stripping the object's own column prefix — `property_name` on
// properties, `building_name` on buildings and `opportunity_name` on
// opportunities all reduce to "Name".
//
// The rule this module holds:
//
//   1. A field reached through a relationship is named for that
//      relationship — the property's name is "Property Name", the
//      building's is "Building Name". The qualifier comes from the FK
//      COLUMN, not the table it points at, so two lookups onto the same
//      object stay distinguishable ("Management Company Name" vs
//      "Account Name" — both are `accounts`).
//   2. A record's own identity field — its name, its record number — is
//      named for its object even on the primary object, because "Name"
//      alone says nothing: "Opportunity Name", never "Name".
//   3. Everything else keeps the short label. A report on opportunities
//      says "Stage" and "Amount", not "Opportunity Stage"; a report on
//      properties says "City", not "Property City".
//   4. No two columns may share a header. When the rule above still
//      collides, the label is widened — the object, then the whole
//      relationship path — until every header in the report is distinct.
//
// A label a person wrote by hand is never overwritten: a stored label is
// replaced only when it is one of the labels this module itself would have
// derived (see `isDerivedLabel`), so curated headers like "ZIP Code" or
// "HUD Property ID" survive.
//
// Pure — no imports, no I/O. Pinned by scripts/report-column-labels-fixture.mjs.

// Words that are shouted, not title-cased, when a column or table name is
// humanized. Same set the record-page navigation uses, plus the report-side
// spellings ("ID", "ZIP") that show up in column names.
const LABEL_ACRONYMS = {
  ahri: 'AHRI', efr: 'EFR', gps: 'GPS', hud: 'HUD', prt: 'PRT',
  ia: 'IA', ppr: 'PPR', sa: 'SA', qc: 'QC', qi: 'QI', pdf: 'PDF',
  url: 'URL', id: 'ID', zip: 'ZIP', hvac: 'HVAC', hers: 'HERS',
  ach: 'ACH', cfm: 'CFM', btu: 'BTU', kwh: 'kWh', roi: 'ROI',
  ami: 'AMI', epa: 'EPA', doe: 'DOE', ada: 'ADA', lihtc: 'LIHTC',
}

// Identity fields — the columns that answer "which record is this?".
// A bare "Name" or "Record Number" header is meaningless, so these always
// carry their object.
const IDENTITY_SUFFIXES = ['name', 'record_number', 'number', 'title', 'subject']

/** Humanize one underscore-separated name: `hud_property_id` → "HUD Property ID". */
export function humanizeWords(raw) {
  if (!raw) return ''
  return String(raw)
    .split('_')
    .filter(Boolean)
    .map(w => LABEL_ACRONYMS[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/**
 * Singular form of a table name — `properties` → `property`, `buildings` →
 * `building`, `addresses` → `address`. Used as the fallback column prefix for
 * tables the platform's prefix map doesn't name.
 */
export function singularizeTable(table) {
  if (!table) return ''
  const t = String(table)
  if (/ies$/.test(t))  return t.replace(/ies$/, 'y')
  if (/sses$/.test(t)) return t.replace(/es$/, '')
  if (/ses$/.test(t))  return t.replace(/es$/, '')
  if (/xes$/.test(t))  return t.replace(/es$/, '')
  if (/s$/.test(t) && !/ss$/.test(t)) return t.replace(/s$/, '')
  return t
}

/** Readable object label for a table — `work_orders` → "Work Orders". */
export function objectLabel(table) {
  return humanizeWords(table)
}

/** Readable singular object label — `work_orders` → "Work Order". */
export function objectSingularLabel(table) {
  return humanizeWords(singularizeTable(table))
}

/**
 * The column prefixes an object's own columns may carry. The platform's
 * prefix map (`guessPrefix`) is authoritative where it has an entry — several
 * objects use a short code (`incentive_applications` → `ia`) that no rule
 * derives — and the singularized table name is the fallback, which is what
 * the convention is everywhere else.
 */
function objectPrefixes(table, prefixFor) {
  const out = []
  const mapped = prefixFor ? prefixFor(table) : null
  if (mapped) out.push(mapped)
  const singular = singularizeTable(table)
  if (singular && !out.includes(singular)) out.push(singular)
  return out
}

/** Strip the object's own column prefix: `property_name` on properties → `name`. */
export function stripObjectPrefix(table, column, { prefixFor } = {}) {
  if (!column) return ''
  const name = String(column)
  for (const p of objectPrefixes(table, prefixFor)) {
    if (name.startsWith(p + '_') && name.length > p.length + 1) {
      return name.slice(p.length + 1)
    }
  }
  return name
}

/** Is this the object's own identity column (its name / record number)? */
export function isIdentityColumn(table, column, opts = {}) {
  const bare = stripObjectPrefix(table, column, opts)
  return IDENTITY_SUFFIXES.includes(bare)
}

/**
 * The short label for a column, with the object's prefix stripped and a
 * trailing `_id` dropped from a lookup — `opportunity_stage` → "Stage",
 * `property_account_id` → "Account".
 */
export function bareFieldLabel(table, column, opts = {}) {
  if (!column) return ''
  let bare = stripObjectPrefix(table, column, opts)
  if (isLookupColumn(column, opts) && /_id$/.test(bare) && bare !== '_id') {
    bare = bare.replace(/_id$/, '')
  }
  if (!bare) bare = String(column)
  return humanizeWords(bare)
}

// A column is a lookup when the caller says so, or when it is a uuid ending
// in `_id`. `property_hud_property_id` is text and keeps its "ID" — it is a
// HUD identifier, not a reference to a LEAP record.
function isLookupColumn(column, opts = {}) {
  if (opts.isLookup != null) return !!opts.isLookup
  if (opts.type && String(opts.type).toLowerCase() === 'uuid') return /_id$/.test(String(column))
  return false
}

/**
 * The label for a relationship hop — the name a related object goes by in
 * THIS report. Derived from the FK column so two lookups onto the same table
 * read differently: `property_management_company_id` → "Management Company",
 * `property_account_id` → "Account", `property_id` → "Property".
 */
export function relationshipLabel(fkColumn, { sourceTable = null, targetTable = null, prefixFor = null } = {}) {
  if (!fkColumn) return targetTable ? objectSingularLabel(targetTable) : ''
  let name = String(fkColumn)
  if (sourceTable) name = stripObjectPrefix(sourceTable, name, { prefixFor })
  name = name.replace(/_id$/, '')
  if (!name) return targetTable ? objectSingularLabel(targetTable) : humanizeWords(fkColumn)
  return humanizeWords(name)
}

/**
 * Normalize a selected-field / grouping descriptor into one shape. Reports
 * saved before the Builder existed carry `field_name` / `field_table`;
 * everything since carries `name` / `table` / `via_path`.
 */
export function normalizeFieldDescriptor(field, primaryObject = null) {
  if (!field) return null
  const name = field.name || field.field_name || null
  if (!name) return null
  const via = field.via_path || field.field_via_path || []
  const viaPath = Array.isArray(via) ? via.filter(Boolean) : []
  // A field with no via_path is a column ON THE PRIMARY OBJECT, whatever the
  // stored `table` says — legacy rows recorded the FK's TARGET table there.
  const table = viaPath.length > 0
    ? (field.table || field.field_table || null)
    : (primaryObject || field.table || field.field_table || null)
  return {
    name,
    table,
    via_path: viaPath,
    type: field.type || field.data_type || null,
    label: field.label || field.field_label || null,
  }
}

/**
 * Derive a column's header, at a given widening level:
 *   0 — the rule (relationship or identity qualifier, else the short label)
 *   1 — always object-qualified
 *   2 — the whole relationship path, then the object
 * Levels above 0 are only reached when a report has two columns that would
 * otherwise share a header.
 */
export function deriveReportColumnLabel(field, opts = {}) {
  const f = normalizeFieldDescriptor(field, opts.primaryObject)
  if (!f) return ''
  const { primaryObject = null, prefixFor = null, level = 0 } = opts
  const table = f.table || primaryObject
  const bare = bareFieldLabel(table, f.name, { prefixFor, type: f.type })

  const qualifiers = []
  if (f.via_path.length > 0) {
    const hops = level >= 2 ? f.via_path : [f.via_path[f.via_path.length - 1]]
    for (let i = 0; i < hops.length; i++) {
      const fk = hops[i]
      // Only the first hop leaves the primary object, so only it can carry
      // the primary object's column prefix.
      const source = (level >= 2 ? i === 0 : f.via_path.length === 1) ? primaryObject : null
      qualifiers.push(relationshipLabel(fk, { sourceTable: source, targetTable: table, prefixFor }))
    }
    if (level >= 1) {
      const obj = objectSingularLabel(table)
      if (obj && !qualifiers.includes(obj)) qualifiers.push(obj)
    }
  } else if (level >= 1 || isIdentityColumn(table, f.name, { prefixFor })) {
    const obj = objectSingularLabel(table)
    if (obj) qualifiers.push(obj)
  }

  return joinLabel(qualifiers, bare)
}

// Join qualifiers onto the short label without stuttering: a qualifier the
// label already starts with is dropped ("Account" + "Account Type" stays
// "Account Type"), and a qualifier identical to the label is dropped too.
function joinLabel(qualifiers, bare) {
  const parts = []
  for (const q of qualifiers) {
    if (!q) continue
    if (parts.includes(q)) continue
    parts.push(q)
  }
  const prefix = parts.join(' ')
  if (!prefix) return bare
  if (!bare) return prefix
  const lowerBare = bare.toLowerCase()
  const lowerPrefix = prefix.toLowerCase()
  if (lowerBare === lowerPrefix) return bare
  if (lowerBare.startsWith(lowerPrefix + ' ')) return bare
  if (lowerPrefix.endsWith(' ' + lowerBare) || lowerPrefix === lowerBare) return prefix
  return `${prefix} ${bare}`
}

/**
 * Would this module have produced `label` for this field? Used to tell a
 * derived label (safe to re-derive, and the reason three columns read "Name")
 * from one a person chose, which is never touched.
 */
export function isDerivedLabel(label, field, opts = {}) {
  if (label == null || String(label).trim() === '') return true
  const f = normalizeFieldDescriptor(field, opts.primaryObject)
  if (!f) return true
  const table = f.table || opts.primaryObject
  const candidates = new Set([
    bareFieldLabel(table, f.name, { prefixFor: opts.prefixFor, type: f.type }),
    deriveReportColumnLabel(field, { ...opts, level: 0 }),
    deriveReportColumnLabel(field, { ...opts, level: 1 }),
    deriveReportColumnLabel(field, { ...opts, level: 2 }),
    humanizeWords(f.name),
    // The pre-2026-08 derivations, both of which produced the bare label.
    String(f.name).replace(/_id$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  ])
  const l = String(label).trim().toLowerCase()
  for (const c of candidates) {
    if (c && String(c).trim().toLowerCase() === l) return true
  }
  return false
}

/**
 * Name every column in a report. Returns the fields with `label` resolved:
 * a hand-written label kept, a derived one re-derived, and any collision
 * widened until every header is distinct.
 */
export function resolveReportColumnLabels(fields, opts = {}) {
  const list = Array.isArray(fields) ? fields : []
  const resolved = list.map(f => {
    const custom = !isDerivedLabel(f?.label ?? f?.field_label, f, opts)
    return {
      field: f,
      custom,
      label: custom
        ? String(f.label ?? f.field_label)
        : deriveReportColumnLabel(f, { ...opts, level: 0 }),
    }
  })

  // Widen only the columns that collide, and only against the headers that
  // are actually in this report — a report with one "Name" column keeps it.
  for (let level = 1; level <= 2; level++) {
    const counts = new Map()
    for (const r of resolved) counts.set(r.label, (counts.get(r.label) || 0) + 1)
    const clashing = resolved.filter(r => !r.custom && counts.get(r.label) > 1)
    if (clashing.length === 0) break
    for (const r of clashing) {
      r.label = deriveReportColumnLabel(r.field, { ...opts, level })
    }
  }

  // Last resort: a report that selects the same field twice, or two columns
  // whose full paths still read alike. Number them so a header is never a
  // guess about which column it belongs to.
  const seen = new Map()
  for (const r of resolved) {
    const n = (seen.get(r.label) || 0) + 1
    seen.set(r.label, n)
    if (n > 1) r.label = `${r.label} (${n})`
  }

  return resolved.map(r => ({ ...r.field, label: r.label }))
}
