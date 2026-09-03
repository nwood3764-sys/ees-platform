// Fixture: a finished step stays open until the WORK ORDER is submitted.
//
// Nicholas, 2026-09-03: "I want to make sure that technicians can go back to
// previously completed steps and edit photos... they can add additional photos
// or replace photos. Until they submit the entire work order, they should be
// able to edit and modify steps."
//
// Completing a step was a one-way door. isActionable was
// `!isStepDone(step) && ...`, so the whole capture block — camera, folder
// picker, Complete, Not Applicable — disappeared the moment a step went green.
// A technician who realised in the van that a shot was blurry had no way back
// in, and the only route to fixing it was for a verifier to send the work order
// back with Corrections Needed.
//
// Nothing in the database ever stopped this: photos carry no step-status rule
// at all, and a Project Site Lead can create and update photo rows. The lock
// was entirely in the client.
//
// Run with:  node scripts/step-reopen-fixture.mjs

import { readFileSync } from 'node:fs'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

// The two rules, mirrored from WorkOrderDetail so they can be exercised.
const REOPENABLE_STATUSES = ['completed', 'not applicable']
const isStepReopenable = (step) =>
  REOPENABLE_STATUSES.includes(String(step?.status || '').toLowerCase())
const stepsStayOpenFor = (woStatus) => {
  const s = String(woStatus || '').toLowerCase()
  return !(s.includes('verified') || s.includes('complete') || s.includes('closed'))
}

// ── While the work order is the technician's ───────────────────────────────
for (const s of ['New', 'Scheduled', 'In Progress', 'Corrections Needed', 'Assigned']) {
  check(`work order "${s}": steps stay open`, stepsStayOpenFor(s), true)
}

// ── Once it is handed over, they close ─────────────────────────────────────
for (const s of ['To Be Verified', 'Verified', 'Closed', 'Unable to Complete']) {
  check(`work order "${s}": steps close`, stepsStayOpenFor(s), false)
}
// The two substring traps in those names, called out because getting either
// wrong leaves evidence editable after it has been handed to a verifier.
check('"To Be Verified" closes even though it is not yet Verified',
  stepsStayOpenFor('To Be Verified'), false)
check('"Unable to Complete" closes even though nothing was completed',
  stepsStayOpenFor('Unable to Complete'), false)

// ── Which finished steps reopen ────────────────────────────────────────────
check('a Completed step reopens', isStepReopenable({ status: 'Completed' }), true)
check('a Not Applicable step reopens', isStepReopenable({ status: 'Not Applicable' }), true)
// A verifier's sign-off is not the technician's to undo — that comes back
// through Corrections Needed.
check('a VERIFIED step does not reopen', isStepReopenable({ status: 'Verified' }), false)
check('an unstarted step is not "reopened" — it was never done',
  isStepReopenable({ status: 'New' }), false)
check('a missing status does not throw', isStepReopenable({}), false)
check('a null step does not throw', isStepReopenable(null), false)
check('status matching is case-insensitive', isStepReopenable({ status: 'COMPLETED' }), true)

// ── The combined gate, which is what the card actually asks ────────────────
const actionable = ({ woStatus, step, anyOrder = true, isNext = true }) => {
  const done = ['completed', 'verified', 'not applicable']
    .includes(String(step.status || '').toLowerCase())
  const reopenable = stepsStayOpenFor(woStatus) && isStepReopenable(step)
  return reopenable || (!done && (anyOrder || isNext))
}
check('the reported case: a completed step on an In Progress work order is editable',
  actionable({ woStatus: 'In Progress', step: { status: 'Completed' } }), true)
check('CONTROL: the old rule made that same step dead',
  (() => { const done = true; return !done && true })(), false)
check('a completed step on a SUBMITTED work order is not editable',
  actionable({ woStatus: 'To Be Verified', step: { status: 'Completed' } }), false)
check('an unfinished step is still editable the usual way',
  actionable({ woStatus: 'In Progress', step: { status: 'New' } }), true)
check('a verified step is never editable, even mid-job',
  actionable({ woStatus: 'In Progress', step: { status: 'Verified' } }), false)

// ── The wiring ─────────────────────────────────────────────────────────────
{
  const src = readFileSync(new URL('../src/fieldMobile/WorkOrderDetail.jsx', import.meta.url), 'utf8')
  check('the one-way door is gone',
    /const isActionable = !isStepDone\(step\) &&/.test(src), false)
  check('a reopened step is actionable',
    /const isActionable = reopenable \|\| \(!isStepDone\(step\)/.test(src), true)
  check('the work-order gate exists', /const stepsStayOpen = !\(/.test(src), true)
  check('Verified is excluded from reopening',
    /REOPENABLE_STATUSES = \['completed', 'not applicable'\]/.test(src), true)
  check('a reopened step offers no second Complete button',
    /\{reopened \? \([\s\S]{0,400}?Completed'\} — you can still add or/.test(src), true)
  check('...and no Not Applicable link either', /\{!reopened && \(\s*\n\s*<button\s*\n\s*onClick=\{onMarkNotApplicable\}/.test(src), true)
  check('a photo can be removed, which is what makes "replace" possible',
    /onRemove=\{isActionable \? async \(p\) => \{/.test(src), true)
  check('removal is a SOFT delete, so a mistake is recoverable',
    /await softDeletePhoto\(p\.id\)/.test(src), true)
  check('removal is offered only while the step is editable',
    /onRemove=\{isActionable \?/.test(src), true)
  check('the strip asks before removing', /window\.confirm\('Remove this photo\?/.test(src), true)
}

console.log(failures === 0
  ? `step-reopen fixture: ${checks} checks passed`
  : `step-reopen fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
