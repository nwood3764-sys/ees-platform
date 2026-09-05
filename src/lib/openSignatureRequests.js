// =============================================================================
// Is a signature request already out on this record?
//
// Nicholas, 2026-09-05, testing the 570 South Clark proposal: "I just sent it
// again, and now I get a 'Send Proposal' pop-up again. I don't know why.
// Wouldn't it need to be a confirmation screen or something? The workflow is
// not to ask the user to resend it."
//
// Pressing Send created ANOTHER envelope, every time, with nothing on screen
// saying one was already out. Three now stand on ENR-00077 — Sent, Declined,
// Sent — which is also why the decline rule had to learn that a decline on a
// SUPERSEDED envelope must not move the enrollment. One button quietly
// creating parallel requests is the root of both.
//
// A recipient holding two live links can sign either, and each writes its own
// signed PDF onto the record. Nothing in the platform picks a winner.
//
// WHICH STATUSES MEAN "STILL OUT" IS THE WHOLE DECISION, so it is stated once
// here rather than inline at a call site:
//
//   Sent / Delivered  -> OUT. The link works and nobody has answered.
//   Completed         -> answered, and answered YES. Not out.
//   Declined          -> answered, and answered NO. Not out — sending a fresh
//                        request after a decline is a deliberate act, not a
//                        duplicate.
//   Voided / Failed   -> not out. A voided envelope was withdrawn on purpose,
//                        and a failed one never dispatched.
//
// The failure direction is deliberately "WARN": an unknown status is treated as
// out. Over-warning costs one extra click on a dialog that already shows the
// recipient; under-warning silently sends a second live link to a customer.
// =============================================================================

/** Envelope statuses whose signing link is live and unanswered. */
export const OPEN_ENVELOPE_STATUSES = ['Sent', 'Delivered']

/** Statuses that are a finished answer, or a request that never went out. */
export const CLOSED_ENVELOPE_STATUSES = ['Completed', 'Declined', 'Voided', 'Failed']

/**
 * @param {string|null} status  the envelope's picklist value
 * @returns {boolean} true when a live signing link is outstanding
 */
export function isOpenSignatureRequest(status) {
  const s = String(status || '').trim()
  if (!s) return true                                   // unknown -> warn
  if (CLOSED_ENVELOPE_STATUSES.includes(s)) return false
  return true                                           // Sent, Delivered, anything new
}

/** The open requests among a set of envelope rows, newest first. */
export function openRequestsIn(rows) {
  return (rows || [])
    .filter(r => r && r.isDeleted !== true && isOpenSignatureRequest(r.status))
    .sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')))
}

/**
 * What the dialog says about it.
 *
 * Names the RECIPIENT, because that is the fact a person needs to decide
 * whether this is a duplicate or a deliberate second request to somebody else.
 * A second request to a DIFFERENT address is a normal thing to want, and the
 * wording must not imply otherwise.
 */
export function describeOpenRequests(open, { documentNoun = 'document' } = {}) {
  if (!open || open.length === 0) return null
  const first = open[0]
  const when = first.sentAt ? new Date(first.sentAt) : null
  const whenText = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'earlier'
  const who = first.recipientEmail || first.recipientName || 'the recipient'
  if (open.length === 1) {
    return `A signature request for this ${documentNoun} is already out to ${who}, sent ${whenText}. `
      + 'That link still works. Sending again creates a second one, and both stay live.'
  }
  return `${open.length} signature requests for this ${documentNoun} are already out, the most recent to ${who} on ${whenText}. `
    + 'Every one of those links still works. Sending again adds another.'
}
