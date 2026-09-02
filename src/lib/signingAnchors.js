// ---------------------------------------------------------------------------
// Signing anchors — the tokens that become fillable fields on a sent document.
//
// A signature document with no anchor is a document nobody can sign: the
// recipient receives the PDF and has nowhere to put a signature, an initial or
// a date. Every one of LEAP's five document templates was in exactly that
// state (Nicholas, 2026-09-02: "Every template, you need at least one
// signature anchor. That has to be mandatory for a signature document").
//
// ONE definition of what an anchor is, shared by the send modal, the template
// editor's warning and the database rule that refuses to activate a signature
// template without one. It mirrors the renderer's own regex in
// supabase/functions/_shared/htmlToPdf.ts — if the three ever disagree, the
// platform accepts a token the PDF will not render, which is the same silent
// failure in a new costume.
//
//   \sig1\      signature, first recipient
//   \initial2\  initials, second recipient in the signing order
//   \date1\     date signed
//   \text1\     free text input
//
// The ordinal is the recipient's position in the signing order, and it is
// REQUIRED: `\sig\` with no number is not an anchor, because there would be
// nobody to attribute the signature to.
// ---------------------------------------------------------------------------

// Must stay identical to ANCHOR_RE in supabase/functions/_shared/htmlToPdf.ts.
export const ANCHOR_PATTERN = 'sig|initial|date|text'
const ANCHOR_RE = /\\(sig|initial|date|text)(\d+)\\/g

/**
 * Every anchor in a template body.
 *
 * @returns { total, maxOrdinal, byOrdinal: Map<ordinal, Set<tabType>> }
 */
export function scanAnchors(bodyHtml) {
  if (typeof bodyHtml !== 'string' || !bodyHtml) {
    return { total: 0, maxOrdinal: 0, byOrdinal: new Map() }
  }
  const byOrdinal = new Map()
  let maxOrdinal = 0
  let total = 0
  ANCHOR_RE.lastIndex = 0
  let m
  while ((m = ANCHOR_RE.exec(bodyHtml)) !== null) {
    total++
    const ord = parseInt(m[2], 10)
    if (!Number.isFinite(ord)) continue
    if (ord > maxOrdinal) maxOrdinal = ord
    const tabType = m[1] === 'sig' ? 'signature' : m[1]
    if (!byOrdinal.has(ord)) byOrdinal.set(ord, new Set())
    byOrdinal.get(ord).add(tabType)
  }
  return { total, maxOrdinal, byOrdinal }
}

/** Whether a body carries at least one anchor — the mandatory minimum. */
export function hasSigningAnchor(bodyHtml) {
  return scanAnchors(bodyHtml).total > 0
}

/**
 * The token the Insert Signature Tab picker writes.
 *
 * Padded with one space each side so the anchor sits inline like a placeholder
 * run — a flush-against-text anchor gets measured against adjacent word
 * boundaries, which produces off-by-a-character geometry in the rendered PDF.
 */
export function signingAnchorToken(tabType, ordinal) {
  return ` \\${tabType}${ordinal}\\ `
}
