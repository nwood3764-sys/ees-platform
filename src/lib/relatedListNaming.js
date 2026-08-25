import { humanizeObjectLabel } from './objectNav.js'

// ---------------------------------------------------------------------------
// relatedListNaming — how the Add Related List picker names a RELATIONSHIP.
//
// A related list is named for the object it lists: "Contacts", "Opportunities",
// "Properties". That is unambiguous only while the object reaches the layout's
// object one way. Properties reach an Account through TWO lookups — Property
// Account and Property Management Company — so titling both lists "Properties"
// tells the user nothing about which relationship they are looking at, and a
// record page carrying both shows the same heading twice.
//
// Salesforce names the child RELATIONSHIP when an object is related more than
// once, and that is what the picker rows do here: "Properties (Property
// Management Company)" is a row you can tell apart from "Properties (Property
// Account)" before you choose it. The relationship name is the lookup field's
// own label rather than a description of it.
//
// What the CARD is called is not this module's business — the title is
// auto-filled with the object's name and the admin types whatever the people
// reading the record page call it (on an Account: "Properties" and
// "Properties Managed").
//
// The relationship label is derived from the foreign key column so it matches
// the label that field carries on its own object's page layout:
//   properties.property_management_company_id → "Property Management Company"
//   properties.property_account_id            → "Property Account"
//   owner_research_requests.orq_account_id    → "Account"
// A leading segment that is the object's own name is KEPT (that is how those
// fields are already labeled); a leading segment that is an abbreviation of
// the table name — orq_, spa_, wo_ — is a column-naming prefix, not part of
// the field's name, so it is dropped.
// ---------------------------------------------------------------------------

// Crude singular of one table-name word — enough to tell "property" from
// "properties" and "account" from "accounts".
function singularizeWord(word) {
  const w = String(word || '').toLowerCase()
  if (w.endsWith('ies') && w.length > 3) return `${w.slice(0, -3)}y`
  if (w.endsWith('sses') || w.endsWith('ches') || w.endsWith('shes')) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

// Is this leading FK segment the object's own name — property_ on properties,
// efr_ on efr_reports — rather than a column-naming abbreviation?
function segmentIsObjectWord(segment, tableName) {
  const seg = singularizeWord(segment)
  return String(tableName || '')
    .split('_')
    .filter(Boolean)
    .some(word => singularizeWord(word) === seg)
}

// Do this segment's letters run through the table name in order? That is what
// makes orq_ an abbreviation of owner_research_requests and spa_ one of
// service_provider_applications, while parent_ is simply a word.
function lettersRunThroughTableName(segment, tableName) {
  const table = String(tableName || '').replace(/[^a-z]/gi, '').toLowerCase()
  let at = 0
  for (const ch of String(segment || '').toLowerCase()) {
    at = table.indexOf(ch, at)
    if (at < 0) return false
    at += 1
  }
  return true
}

// A leading segment that is the table's column-naming prefix — the orq_ in
// orq_approved_account_id — is plumbing, not part of the field's name.
// Length is the guard that keeps real modifier words (parent_, approved_,
// primary_) out of it.
const MAX_PREFIX_ABBREVIATION_LENGTH = 5

function isColumnPrefixAbbreviation(segment, tableName) {
  if (!segment || segment.length > MAX_PREFIX_ABBREVIATION_LENGTH) return false
  if (segmentIsObjectWord(segment, tableName)) return false
  return lettersRunThroughTableName(segment, tableName)
}

/**
 * The relationship's name, taken from the foreign key column — the label that
 * lookup field carries on the object it lives on.
 * Returns '' when the column says nothing beyond its prefix.
 */
export function relationshipLabelFromFk(targetTable, fkColumn) {
  const segments = String(fkColumn || '').split('_').filter(Boolean)
  if (!segments.length) return ''
  if (segments.length > 1 && segments[segments.length - 1] === 'id') segments.pop()
  if (segments.length > 1 && isColumnPrefixAbbreviation(segments[0], targetTable)) segments.shift()
  if (!segments.length) return ''
  return humanizeObjectLabel(segments.join('_'))
}

/**
 * Title for a related list showing `targetTable` through `fkColumn`.
 * `ambiguous` — true when more than one foreign key on that table points at
 * the layout's object, which is exactly when the object name alone is not a
 * name. Pass the count with `fkCount` instead if that is what you hold.
 */
export function relatedListTitle(targetTable, fkColumn, { ambiguous = false, fkCount = null } = {}) {
  const objectLabel = humanizeObjectLabel(targetTable)
  if (!objectLabel) return ''
  const isAmbiguous = fkCount == null ? !!ambiguous : fkCount > 1
  if (!isAmbiguous) return objectLabel
  const relationship = relationshipLabelFromFk(targetTable, fkColumn)
  // A relationship that only restates the object (units.unit_id) adds nothing.
  if (!relationship || singularizeWord(relationship) === singularizeWord(objectLabel)) return objectLabel
  return `${objectLabel} (${relationship})`
}
