// Fixture — what a status chevron is allowed to drop from a stage label.
//
// The rule shortens a chevron by removing the words every stage on the strip
// shares, so nine incentive-application stages stop spending 40px each on the
// words "Incentive Application". The danger is the other direction: a rule
// that strips too eagerly makes two stages read the same, or cuts a word in
// half, or removes grammar that carried the meaning. Every case below is a
// real LEAP status set read off prod on 2026-09-01.

import {
  sharedStatusLabelPrefix,
  shortStatusLabel,
  stripSharedStatusPrefix,
} from '../src/lib/statusPathLabels.js'

let checks = 0, failures = 0
const eq = (label, actual, expected) => {
  checks += 1
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) return
  failures += 1
  console.log(`FAIL  ${label}\n      expected ${e}\n      got      ${a}`)
}

// ── The set that prompted this: incentive_applications.ia_status ──────────
const IA = [
  'Incentive Application To Be Prepared',
  'Incentive Application To Be Verified',
  'Incentive Application To Be Submitted',
  'Incentive Application Submitted — Awaiting Program Response',
  'Incentive Application Pre-Approved',
  'Incentive Application Approved',
  'Incentive Application Corrections Needed',
  'Incentive Application Denied',
  'Incentive Application Withdrawn',
]
eq('incentive application prefix', sharedStatusLabelPrefix(IA), 'Incentive Application')
eq('incentive application stages', stripSharedStatusPrefix(IA), [
  'To Be Prepared', 'To Be Verified', 'To Be Submitted',
  'Submitted — Awaiting Program Response', 'Pre-Approved', 'Approved',
  'Corrections Needed', 'Denied', 'Withdrawn',
])
// Pre-Approved and Approved must stay two different stages: a whole-word rule
// is what keeps "Pre-Approved" out of reach.
eq('a hyphenated stage is never cut mid-word',
  stripSharedStatusPrefix(IA).filter(s => s === 'Approved').length, 1)

// ── enrollments.enrollment_status — one-word object name ──────────────────
const ENROLLMENTS = [
  'Enrollment To Be Prepared', 'Enrollment To Be Verified', 'Enrollment Verified',
  'Enrollment Submitted — Awaiting Program Response', 'Enrollment Approved',
  'Enrollment Corrections Needed', 'Enrollment Denied', 'Enrollment Withdrawn',
]
eq('enrollment prefix', sharedStatusLabelPrefix(ENROLLMENTS), 'Enrollment')
eq('a stranded em dash goes with the prefix',
  shortStatusLabel('Enrollment — Submitted', 'Enrollment'), 'Submitted')

// ── project_payment_requests.ppr_status — two-word object name ────────────
const PPR = [
  'Payment Request To Be Prepared', 'Payment Request To Be Verified',
  'Payment Request To Be Submitted', 'Payment Request Submitted — Awaiting Review',
  'Payment Request Under Review', 'Payment Request Approved',
  'Payment Request Payment Pending', 'Payment Request Payment Received',
  'Payment Request Closed',
]
eq('payment request prefix', sharedStatusLabelPrefix(PPR), 'Payment Request')
eq('a repeated word inside the stage survives',
  shortStatusLabel('Payment Request Payment Pending', 'Payment Request'), 'Payment Pending')

// ── Sets that must come back untouched ────────────────────────────────────
const WORK_ORDERS = [
  'New', 'To Be Scheduled', 'To Be Assigned', 'Assigned', 'To Be Accepted',
  'Scheduled', 'In Progress', 'To Be Verified', 'Corrections Needed', 'Verified',
]
eq('work order statuses share nothing', sharedStatusLabelPrefix(WORK_ORDERS), '')
eq('work order statuses are unchanged', stripSharedStatusPrefix(WORK_ORDERS), WORK_ORDERS)

const OPP_STAGES = [
  'Income Qualification', 'Energy Assessment', 'Energy Modeling',
  'Project Reservation', 'Project Planning', 'Project Implementation',
  'Commissioning & Verification', 'Payment Request Submitted',
  'Final Inspection', 'Payment Issued',
]
eq('opportunity stages are unchanged', stripSharedStatusPrefix(OPP_STAGES), OPP_STAGES)

// Grammar is not an object name. Stripping "To Be" here would leave stages
// that read like adjectives and lose what they are about.
const GRAMMAR = ['To Be Prepared', 'To Be Verified', 'To Be Submitted']
eq('a prefix ending on a function word is refused', sharedStatusLabelPrefix(GRAMMAR), '')
eq('...and the stages are left whole', stripSharedStatusPrefix(GRAMMAR), GRAMMAR)

// ── Safety rules ──────────────────────────────────────────────────────────
eq('a stage is never emptied', sharedStatusLabelPrefix(['Project Closed', 'Project']), '')
eq('one stage has no shared prefix', sharedStatusLabelPrefix(['Incentive Application Denied']), '')
eq('no stages at all', stripSharedStatusPrefix([]), [])
eq('shortening two stages onto one label is refused',
  sharedStatusLabelPrefix(['Audit Report Filed', 'Audit Report filed', 'Audit Report Sent']), '')
eq('matching is case-insensitive, casing comes from the first stage',
  sharedStatusLabelPrefix(['Incentive Application Denied', 'INCENTIVE APPLICATION Approved']),
  'Incentive Application')
eq('a stage that does not carry the prefix is left alone',
  shortStatusLabel('Walk-Away', 'Incentive Application'), 'Walk-Away')
eq('an empty prefix changes nothing', shortStatusLabel('Enrollment Denied', ''), 'Enrollment Denied')
eq('extra whitespace does not defeat the match',
  shortStatusLabel('Incentive   Application   Denied', 'Incentive Application'), 'Denied')

// ── The positive control: the labels as they render today ─────────────────
// The strip's widest chevron before this rule, against after. If the rule ever
// stops shortening, this is the check that says so.
const before = Math.max(...IA.map(s => s.length))
const after = Math.max(...stripSharedStatusPrefix(IA).map(s => s.length))
eq('the widest chevron is materially shorter', after < before - 20, true)

console.log(`status-path-labels-fixture  ${failures ? `${failures} FAILED` : 'all passed'}  (${checks} checks)`)
process.exit(failures ? 1 : 0)
