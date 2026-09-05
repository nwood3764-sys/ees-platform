// =============================================================================
// The wording of a signature request lives in the database.
//
// Nicholas, 2026-09-05, looking at the email a property owner actually
// received: "where do I adjust this email template, because this needs some
// work? ... is this a template, or do we just change the wording directly? I
// need to know."
//
// It was neither. The whole message was composed by a function in this edge
// function's source, so changing a sentence meant a code change and an edge
// function deploy — which is exactly the thing that left the LEAP Assistant's
// fix inert for five days. It is an `email_templates` row now (ET-, Setup ->
// Communication Templates), so the wording is a data edit.
//
// THE FAILURE DIRECTION IS ALWAYS "SEND", NEVER "DO NOT SEND". A missing,
// archived or unreadable template falls back to the built-in wording rather
// than holding the request: a property owner not receiving the document is a
// worse outcome than receiving it in the default words, and that is precisely
// the failure this whole workstream started with (ENV-00014, which read Sent
// and delivered nothing).
//
// Two rules on substitution, and both matter:
//
//   1. VALUES ARE HTML-ESCAPED, the template body is not. The template is
//      authored by an admin and is HTML on purpose; the values come off
//      records — a property named `Smith & Sons <Holdings>` must not be able
//      to close a tag or break the layout. The signing URL is the one
//      exception and is escaped for an attribute rather than for text, since
//      it IS a URL and must stay one.
//   2. A TOKEN NOBODY SUPPLIED RENDERS EMPTY, and never as `{{...}}`. A
//      customer seeing raw braces reads as a broken system; a slightly terse
//      sentence does not. `renderedTokens` reports what was dropped so a send
//      can log it rather than lose it silently.
// =============================================================================

/** The one template this pipeline reads. Matched on `email_templates.name`. */
export const SIGNATURE_REQUEST_TEMPLATE_NAME = 'Signature Request'

/** Escape a value being placed into element text or an attribute. */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The token map a signature request is rendered with.
 *
 * Deliberately built from what send-envelope actually HOLDS, rather than from
 * what would read nicely: a token the pipeline cannot fill is a blank in a
 * customer's email. `record.name` is the Related To record's own name, which
 * on an enrollment is already the property address — LEAP derives it that way
 * — so the message can name the building without this function learning how to
 * walk to a property.
 */
export function signatureRequestTokens(p) {
  const full = String(p.recipientName || '').trim()
  const first = full.split(/\s+/)[0] || full
  return {
    'recipient.first_name': first,
    'recipient.name':       full,
    'document.name':        p.documentName || '',
    'record.name':          p.recordLabel || '',
    'record.number':        p.recordNumber || '',
    'sender.name':          p.senderName || '',
    'signing_url':          p.signingUrl || '',
    'company.name':         p.companyName || 'Energy Efficiency Services',
  }
}

/**
 * Substitute `{{token}}` throughout a template.
 *
 * @returns {{text: string, missing: string[]}}  `missing` names every token the
 *          template asked for that nothing supplied — reported, not thrown,
 *          because a half-filled sentence still delivers the document.
 */
export function renderTemplate(template, tokens, opts = {}) {
  const raw = opts.raw === true          // true for a plain-text body
  const missing = []
  const text = String(template == null ? '' : template).replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    (_m, key) => {
      if (!Object.prototype.hasOwnProperty.call(tokens, key)) {
        missing.push(key)
        return ''
      }
      const v = tokens[key]
      return raw ? String(v == null ? '' : v) : escapeHtml(v)
    },
  )
  return { text, missing: [...new Set(missing)] }
}

/**
 * Decide whether a template row may be used for a send.
 *
 * A row that is soft-deleted, not Active, or carries no body is not a template
 * — it is a half-authored draft, and a draft must never reach a customer. Each
 * refusal is NAMED so the send can log why it fell back rather than leaving
 * somebody wondering which of the two wordings went out.
 */
export function templateUsability(row, activeStatusValue) {
  if (!row)                                   return { usable: false, reason: 'no template row' }
  if (row.is_deleted === true)                return { usable: false, reason: 'template is deleted' }
  if (!row.body_html || !String(row.body_html).trim())
    return { usable: false, reason: 'template has no body' }
  if (activeStatusValue && activeStatusValue !== 'Active')
    return { usable: false, reason: `template status is ${activeStatusValue}` }
  return { usable: true, reason: null }
}
