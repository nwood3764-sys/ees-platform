// Fixture — the Outlook add-in can file an email onto EVERY object a thread
// can live on, and calls each one what the app calls it.
//
// Nicholas, 2026-09-03: "It needs to have all the objects. Why would you limit
// it to five?" The add-in's picker had six hard-coded <option> tags, the log
// function had a five-object anchor map plus a contacts special case, and the
// search RPC had six branches. Enrollments, incentives, assessments,
// buildings, units and service appointments all carry a Communications card
// and could not be filed onto.
//
// The list is now derived in the database (list_email_log_objects, built from
// conversation_anchor_columns) and the picker asks for it. What this fixture
// guards is the seam that derivation cannot close: the app labels objects from
// src/lib/objectNav.js, while the add-in — static files that cannot import the
// bundle — is told by the database. Those two answers must agree, or the same
// object is called two things on two screens.
//
// The expectations below were read off production on 2026-09-03 with
//   SELECT object_name, label, label_plural FROM list_email_log_objects();
//
// Run with:  node scripts/email-log-targets-fixture.mjs

import { CONVERSATION_ANCHORS, objectCanHoldConversations } from '../src/lib/conversationAnchors.js'
import { objectLabel, objectLabelPlural } from '../src/lib/objectNav.js'

let checks = 0, failures = 0
const eq = (label, actual, expected) => {
  checks += 1
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) return
  failures += 1
  console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
}

// What list_email_log_objects() returns on prod — object, singular, plural.
const FROM_THE_DATABASE = [
  ['accounts',               'Account',             'Accounts'],
  ['assessments',            'Assessment',          'Assessments'],
  ['buildings',              'Building',            'Buildings'],
  ['contacts',               'Contact',             'Contacts'],
  ['enrollments',            'Enrollment',          'Enrollments'],
  ['incentive_applications', 'Incentive',           'Incentives'],
  ['opportunities',          'Opportunity',         'Opportunities'],
  ['projects',               'Project',             'Projects'],
  ['properties',             'Property',            'Properties'],
  ['service_appointments',   'Service Appointment', 'Service Appointments'],
  ['units',                  'Unit',                'Units'],
  ['work_orders',            'Work Order',          'Work Orders'],
]

// ─── Every object, not six — and since 2026-09-05, not twelve ────────────────
//
// list_email_log_objects() now returns every object a thread can be Related
// To (72 on prod: every record-carrying table with a page layout). The twelve
// below are the ones with their own column on conversations; the picker
// offers them AND the sixty-odd others. The client keeps no list of the
// others at all, so what is pinned here is that the twelve are a subset and
// that the labels agree.

eq('the twelve foreign-key-backed objects are exactly the twelve the picker had',
  CONVERSATION_ANCHORS.map(a => a.object).sort(),
  FROM_THE_DATABASE.map(([o]) => o).sort())

// The six it already had must not have been lost…
for (const o of ['opportunities', 'properties', 'accounts', 'contacts', 'projects', 'work_orders']) {
  eq(`${o} is still fileable`, CONVERSATION_ANCHORS.some(a => a.object === o), true)
}
// …and the six it was missing are the point of the change.
for (const o of ['enrollments', 'incentive_applications', 'assessments', 'buildings', 'units', 'service_appointments']) {
  eq(`${o} is fileable now`, CONVERSATION_ANCHORS.some(a => a.object === o), true)
}

// ─── One object, one name, on both surfaces ──────────────────────────────────

for (const [object, singular, plural] of FROM_THE_DATABASE) {
  eq(`${object} is called "${singular}" in the app too`, objectLabel(object), singular)
  eq(`${object} pluralises the same way in the app`, objectLabelPlural(object), plural)
}

// The rename that prompted the override table: the add-in and the app must
// both have stopped saying "Incentive Application".
eq('the renamed object never reads as an application',
  FROM_THE_DATABASE.filter(([, s, p]) => /Application/.test(s) || /Application/.test(p)), [])

// CONTROL — the label is DERIVED, not listed. An object nobody has overridden
// still gets a readable name, which is what lets a new anchor object appear in
// the picker with no code change at all.
eq('an object with no override is humanized from its table name',
  objectLabel('service_appointments'), 'Service Appointment')
eq('and pluralised from it', objectLabelPlural('work_orders'), 'Work Orders')

// CONTROL — the two objects the database refuses by name are refused here
// too; a work step, refused before 2026-09-05, is offered now.
for (const o of ['users', 'conversations']) {
  eq(`${o} is not offered as a place to file an email`, objectCanHoldConversations(o), false)
}
eq('a work step is offered as a place to file an email', objectCanHoldConversations('work_steps'), true)
eq('a work step has no column of its own on conversations',
  CONVERSATION_ANCHORS.some(a => a.object === 'work_steps'), false)

console.log(failures === 0
  ? `email-log-targets fixture: ${checks} checks passed`
  : `email-log-targets fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
