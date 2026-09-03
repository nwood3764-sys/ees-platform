// Document types, in words.
//
// `documents.document_type` is free text holding an internal slug —
// 'reservation_hpxml', 'audit_template_report', 'assessment_asset_score'. The
// slug is stamped by whichever document SLOT a file was uploaded into (see
// src/lib/documentSlots.js), or by the generator that produced it. Nothing ever
// translated it, so every screen printed the slug raw: a column headed "Type"
// reading `reservation_customer_report`.
//
// Nicholas, 2026-08-27, from an enrollment record: "where did these types come
// in?… I don't understand that. When the type is like a PDF or Word document."
// Two fair complaints in one. A person reading "Type" expects either the kind
// of document or the file format, and an internal slug is neither.
//
// So a document type is now a value-keyed picklist — rows in `picklist_values`
// under (documents, document_type), exactly as `photos.photo_type` already
// works — and every screen renders the LABEL. Keyed by value rather than by id
// because the column stores the slug: the generators, the slot cards and the
// storage layer all write and match on it, and re-typing the column to a uuid
// FK would rewrite all of them to buy nothing a label doesn't.
//
// An unregistered slug is never printed raw either — it is humanized, with
// LEAP's acronyms kept upper-case. A type nobody has labelled yet still reads
// as words.
//
// Pure: no React, no Supabase. Pinned by scripts/document-types-fixture.mjs.

import { CATCH_ALL_DOCUMENT_TYPE } from './documentSlots.js'

// Tokens that are acronyms, not words. Written as they are written in the
// programs LEAP runs: an HPXML file, a W-9, a certificate of insurance.
const ACRONYMS = new Map([
  ['hpxml', 'HPXML'], ['xml', 'XML'], ['pdf', 'PDF'], ['csv', 'CSV'],
  ['xlsx', 'XLSX'], ['docx', 'DOCX'], ['w9', 'W-9'], ['coi', 'COI'],
  ['sow', 'SOW'], ['qi', 'QI'], ['hes', 'HES'], ['ira', 'IRA'],
  ['hud', 'HUD'], ['li', 'LI'], ['mf', 'MF'], ['sf', 'SF'],
  ['ees', 'EES'], ['ahri', 'AHRI'], ['id', 'ID'], ['epa', 'EPA'],
  ['doe', 'DOE'], ['ashrae', 'ASHRAE'], ['hvac', 'HVAC'], ['dhw', 'DHW'],
  // The two IRA programme names. A registered label is the real answer for a
  // document type (see 20260903001834), but a slug nobody registered must not
  // print "Hear Proposal" — the verb — in a column headed Type.
  ['homes', 'HOMES'], ['hear', 'HEAR'],
])

/**
 * A readable name for a slug nobody has registered: underscores become spaces,
 * words are capitalized, acronyms are kept upper-case.
 *
 *   'audit_template_report'  → 'Audit Template Report'
 *   'reservation_hpxml'      → 'Reservation HPXML'
 *   'payment_w9'             → 'Payment W-9'
 */
export function humanizeDocumentType(value) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return ''
  return raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => {
      const acronym = ACRONYMS.get(part.toLowerCase())
      if (acronym) return acronym
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * What to show for one document's type.
 *
 * `registry` is a Map (or plain object) of slug → label, loaded from
 * picklist_values. Returns null for a type that names no kind of file — an
 * empty value, or the 'attachment' catch-all sentinel — so a caller renders
 * nothing rather than the word "attachment", which tells a reader less than a
 * blank does.
 */
export function documentTypeLabel(value, registry) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw || raw === CATCH_ALL_DOCUMENT_TYPE) return null
  const registered = lookup(registry, raw)
  if (registered) return registered
  return humanizeDocumentType(raw)
}

function lookup(registry, key) {
  if (!registry) return null
  if (registry instanceof Map) {
    const v = registry.get(key)
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  if (typeof registry === 'object') {
    const v = registry[key]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  return null
}

/**
 * The options a document-slot picker offers: every registered type, plus any
 * slug already in use on this layout that nobody registered (so configuring a
 * slot never silently drops the type it already had).
 *
 * `registered` is [{ value, label }] from picklist_values, in the order the
 * picklist declares. `inUse` is any slugs found on the layout's own cards.
 * The catch-all is always first and named for what it does.
 */
export function documentTypeOptions(registered, inUse) {
  const options = [{
    value: CATCH_ALL_DOCUMENT_TYPE,
    label: 'Any document (catch-all)',
    isCatchAll: true,
  }]
  const seen = new Set([CATCH_ALL_DOCUMENT_TYPE])

  for (const row of registered || []) {
    const value = String(row?.value || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    options.push({
      value,
      label: String(row?.label || '').trim() || humanizeDocumentType(value),
      isCatchAll: false,
    })
  }

  for (const value of inUse || []) {
    const v = String(value || '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    options.push({ value: v, label: humanizeDocumentType(v), isCatchAll: false, unregistered: true })
  }

  return options
}
