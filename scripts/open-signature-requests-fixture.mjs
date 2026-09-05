// =============================================================================
// open-signature-requests-fixture — pressing Send twice does not silently
// create two live signing links.
//
// Nicholas, 2026-09-05, testing the 570 South Clark proposal: "I just sent it
// again, and now I get a 'Send Proposal' pop-up again. I don't know why.
// Wouldn't it need to be a confirmation screen or something? The workflow is
// not to ask the user to resend it."
//
// Each press created ANOTHER envelope with nothing on screen saying one was
// already out. Three now stand on ENR-00077 -- Sent, Declined, Sent -- and a
// recipient holding two live links can sign either, with nothing in the
// platform picking a winner. It is also why the decline rule had to learn that
// a decline on a SUPERSEDED envelope must not move the enrollment: one button
// quietly creating parallel requests is the root of both.
//
// WHICH STATUSES COUNT is the whole decision, so it is pinned here with the
// failure direction stated: an UNKNOWN status warns. Over-warning costs a
// click; under-warning sends a second live link to a customer.
// =============================================================================

import {
  OPEN_ENVELOPE_STATUSES,
  CLOSED_ENVELOPE_STATUSES,
  isOpenSignatureRequest,
  openRequestsIn,
  describeOpenRequests,
} from '../src/lib/openSignatureRequests.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (n, ok) => { ok ? (pass++, console.log(`PASS  ${n}`)) : (fail++, console.log(`FAIL  ${n}`)) }

// ── A live link is out ─────────────────────────────────────────────────────
check('Sent is still out',      isOpenSignatureRequest('Sent') === true)
check('Delivered is still out', isOpenSignatureRequest('Delivered') === true)

// ── An answered or withdrawn request is not ────────────────────────────────
check('Completed is not out — it was signed',   isOpenSignatureRequest('Completed') === false)
check('Declined is not out — it was answered',  isOpenSignatureRequest('Declined') === false)
check('Voided is not out — it was withdrawn',   isOpenSignatureRequest('Voided') === false)
check('Failed is not out — it never dispatched', isOpenSignatureRequest('Failed') === false)

// Sending a fresh request AFTER a decline is a deliberate act, not a
// duplicate, and must not be warned about.
check('a declined request does not warn on the next send',
  openRequestsIn([{ status: 'Declined' }]).length === 0)

// ── The failure direction is WARN ──────────────────────────────────────────
check('an unknown status warns',      isOpenSignatureRequest('Something New') === true)
check('a null status warns',          isOpenSignatureRequest(null) === true)
check('an empty status warns',        isOpenSignatureRequest('') === true)
check('the two status sets are disjoint',
  OPEN_ENVELOPE_STATUSES.every(s => !CLOSED_ENVELOPE_STATUSES.includes(s)))

// ── The real ENR-00077 shape: Sent, Declined, Sent ─────────────────────────
const enr77 = [
  { id: 'a', recordNumber: 'ENV-00014', status: 'Sent',     sentAt: '2026-09-05T19:10:00Z', recipientEmail: 'a@x.com' },
  { id: 'b', recordNumber: 'ENV-00015', status: 'Declined', sentAt: '2026-09-05T19:29:00Z', recipientEmail: 'b@x.com' },
  { id: 'c', recordNumber: 'ENV-00016', status: 'Sent',     sentAt: '2026-09-05T19:50:00Z', recipientEmail: 'c@x.com' },
]
const open77 = openRequestsIn(enr77)
check('the declined one is excluded',           open77.length === 2)
check('the newest open one is first',           open77[0].recordNumber === 'ENV-00016')
check('the decline is not the one offered',     open77.every(r => r.status !== 'Declined'))

// A soft-deleted envelope is not out.
check('a soft-deleted envelope is not out',
  openRequestsIn([{ status: 'Sent', isDeleted: true }]).length === 0)
check('an empty history warns about nothing',   openRequestsIn([]).length === 0)
check('a null history does not throw',          openRequestsIn(null).length === 0)

// ── What the dialog says ───────────────────────────────────────────────────
const one = describeOpenRequests([enr77[2]], { documentNoun: 'proposal' })
check('nothing outstanding says nothing',       describeOpenRequests([]) === null)
check('null says nothing',                      describeOpenRequests(null) === null)
check('the notice names the recipient',         one.includes('c@x.com'))
check('the notice names the document',          one.includes('proposal'))
check('the notice says the old link still works', /still works/.test(one))
check('the notice warns both would stay live',  /both stay live/.test(one))

const many = describeOpenRequests(open77, { documentNoun: 'proposal' })
check('two outstanding are counted',            many.startsWith('2 signature requests'))
check('the most recent recipient is named',     many.includes('c@x.com'))
check('the plural notice says every link works', /Every one of those links still works/.test(many))

// A request with no send time still reads as a sentence.
const undated = describeOpenRequests([{ status: 'Sent', recipientEmail: 'd@x.com' }], {})
check('a request with no timestamp reads "earlier"', undated.includes('earlier'))
check('a request with no recipient still reads',
  describeOpenRequests([{ status: 'Sent' }], {}).includes('the recipient'))

// ── The dialog actually behaves this way ───────────────────────────────────
const modal = readFileSync(new URL('../src/components/SignatureSendModal.jsx', import.meta.url), 'utf8')
check('the modal checks for open requests before sending',
  /fetchOpenSignatureRequests\(spec\.parentObject, recordId\)/.test(modal))
check('each document declares which record it hangs off',
  /parentObject: 'enrollments'/.test(modal) && /parentObject: 'incentive_applications'/.test(modal))
check('the modal offers to resend the existing link',
  /resendSignatureRequest\(target\.id\)/.test(modal))
check('the gate is SOFT — a second send is allowed once acknowledged',
  /openRequests\.length > 0 && !acknowledgedDuplicate/.test(modal))
check('the send button honours the gate',
  /disabled=\{sending \|\| !email\.trim\(\) \|\| blockedByDuplicate\}/.test(modal))

const service = readFileSync(new URL('../src/data/signatureRequestsService.js', import.meta.url), 'utf8')
check('a failed history read cannot block a send',
  /if \(error\) return \[\]/.test(service) && /catch \{\s*return \[\]/.test(service))
check('the resend reads the body status, not just the http status',
  /!resp\.ok \|\| j\.ok === false/.test(service))
check('only live envelopes are considered',
  /\.is\('is_deleted', false\)/.test(service))

console.log(`open-signature-requests-fixture: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
if (fail) process.exit(1)
