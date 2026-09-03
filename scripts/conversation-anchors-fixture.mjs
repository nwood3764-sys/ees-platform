// Fixture test for the one definition of what a conversation can be anchored to.
//
// The rule this pins: the objects that can hold a Communications card, the
// column on `conversations` that anchors a thread to each, and the order a
// reply resolves them in, are ONE fact with ONE definition.
//
// Before 2026-09-03 it was written down eight times — two CASE blocks and a
// parameter list in the database, an ordered if/else chain in
// conversationsService, two column lists in the same file,
// OBJECT_CONVERSATION_FK in layoutCards, FK_TO_ANCHOR_OBJECT in
// ConversationPanel, and ANCHOR_FK_PARAM in two edge functions — which is why
// adding enrollments took eight edits and why the card could be offered on an
// object whose threads nothing could fetch.
//
// The controls here are the two ways this goes wrong silently: a thread whose
// anchor column was never SELECTed reads as unanchored, and a thread carrying
// several anchors sent from the wrong one goes out of the wrong mailbox.
//
// Run with:  node scripts/conversation-anchors-fixture.mjs

import {
  CONVERSATION_ANCHORS,
  OBJECT_CONVERSATION_FK,
  FK_TO_ANCHOR_OBJECT,
  objectCanHoldConversations,
  resolveAnchorFromConversation,
} from '../src/lib/conversationAnchors.js'

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

// ─── The objects, and the two that this change is about ──────────────────────

check('enrollments can hold a Communications card', objectCanHoldConversations('enrollments'), true)
check('incentive applications can hold one', objectCanHoldConversations('incentive_applications'), true)
check('an enrollment thread is anchored on enrollment_id',
  OBJECT_CONVERSATION_FK.enrollments, 'enrollment_id')
check('an object with no anchor is refused, not guessed',
  objectCanHoldConversations('work_steps'), false)
check('an unknown object is refused', objectCanHoldConversations('not_a_table'), false)
check('no object is missing', CONVERSATION_ANCHORS.length, 12)

// Every object the database can anchor a thread to — conversations' own
// foreign keys, minus users and picklist_values — read back from prod on
// 2026-09-03. The client map must name exactly these.
const ANCHORS_IN_THE_DATABASE = [
  'accounts', 'assessments', 'buildings', 'contacts', 'enrollments',
  'incentive_applications', 'opportunities', 'projects', 'properties',
  'service_appointments', 'units', 'work_orders',
]
check('the client names exactly the objects the database anchors',
  CONVERSATION_ANCHORS.map(a => a.object).sort(), ANCHORS_IN_THE_DATABASE)

// ─── The two maps are one map ────────────────────────────────────────────────

check('object → fk → object round-trips for every anchor',
  CONVERSATION_ANCHORS.filter(a => FK_TO_ANCHOR_OBJECT[OBJECT_CONVERSATION_FK[a.object]] !== a.object),
  [])
check('no two objects share an anchor column',
  new Set(CONVERSATION_ANCHORS.map(a => a.fk)).size, CONVERSATION_ANCHORS.length)
check('no object is listed twice',
  new Set(CONVERSATION_ANCHORS.map(a => a.object)).size, CONVERSATION_ANCHORS.length)

// The column is always the singular of the table plus _id. Named here because
// the layout palette writes widget_config.fk from it, and a column that does
// not exist produces a card that silently lists nothing.
const singular = (table) => table.endsWith('ies')
  ? `${table.slice(0, -3)}y`
  : table.replace(/s$/, '')
check('every anchor column follows the naming convention',
  CONVERSATION_ANCHORS.filter(a => a.fk !== `${singular(a.object)}_id`).map(a => a.object),
  [])

// ─── The order is the answer to "reply from where?" ──────────────────────────

check('a thread carrying only a property replies from the property',
  resolveAnchorFromConversation({ property_id: 'p1' }),
  { anchorObject: 'properties', anchorRecordId: 'p1' })

check('a work order thread replies from the work order, not the property it sits on',
  resolveAnchorFromConversation({ property_id: 'p1', account_id: 'a1', work_order_id: 'w1' }),
  { anchorObject: 'work_orders', anchorRecordId: 'w1' })

check('an enrollment outranks the property and the account beneath it',
  resolveAnchorFromConversation({ property_id: 'p1', account_id: 'a1', enrollment_id: 'e1' }),
  { anchorObject: 'enrollments', anchorRecordId: 'e1' })

check('an incentive application outranks the enrollment it came from',
  resolveAnchorFromConversation({ enrollment_id: 'e1', incentive_application_id: 'i1' }),
  { anchorObject: 'incentive_applications', anchorRecordId: 'i1' })

check('a service appointment is the most specific anchor of all',
  resolveAnchorFromConversation({
    contact_id: 'c1', account_id: 'a1', property_id: 'p1', project_id: 'pr1',
    work_order_id: 'w1', service_appointment_id: 's1',
  }),
  { anchorObject: 'service_appointments', anchorRecordId: 's1' })

check('a contact-only thread still resolves', resolveAnchorFromConversation({ contact_id: 'c1' }),
  { anchorObject: 'contacts', anchorRecordId: 'c1' })

// CONTROL — the failure that must stay loud. A thread with no anchor must come
// back null so the reply path can refuse it by name; anything else sends an
// email that appears on no record page.
check('a thread with no anchor resolves to nothing',
  resolveAnchorFromConversation({ conv_subject: 'orphan' }), null)
check('a null thread resolves to nothing', resolveAnchorFromConversation(null), null)
check('an anchor column present but empty does not count',
  resolveAnchorFromConversation({ work_order_id: null, property_id: 'p1' }),
  { anchorObject: 'properties', anchorRecordId: 'p1' })

// CONTROL — the row shape the panel actually holds. A thread fetched without
// its anchor column reads as unanchored, which is the defect the derived
// column list exists to prevent: resolving against a row that carries only the
// pre-2026-09-03 columns must NOT find the enrollment it really has.
const rowMissingTheNewColumn = { id: 'c1', property_id: 'p1' }
check('a row fetched without enrollment_id cannot report the enrollment',
  resolveAnchorFromConversation(rowMissingTheNewColumn).anchorObject, 'properties')

console.log(failures === 0
  ? `conversation-anchors fixture: ${checks} checks passed`
  : `conversation-anchors fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
