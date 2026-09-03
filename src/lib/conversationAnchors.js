// ---------------------------------------------------------------------------
// conversationAnchors.js — the ONE client-side definition of what a
// conversation can be anchored to.
//
// Nicholas, 2026-09-03: "we need to have a communication on all enrollment
// objects and all incentive record objects."
//
// Adding enrollments meant editing the same fact in eight places: two CASE
// blocks and a parameter list in the database, an ordered if/else chain in
// conversationsService, OBJECT_CONVERSATION_FK in layoutCards,
// FK_TO_ANCHOR_OBJECT in ConversationPanel, and ANCHOR_FK_PARAM in two edge
// functions. The database now derives its answer from the conversations
// table's own foreign keys (conversation_anchor_columns()); this module is the
// client's single copy.
//
// The ORDER is load-bearing and is the one thing the foreign keys cannot say:
// a thread carries several anchors at once (a work order thread also knows its
// property and its account), and a reply must be sent from the MOST SPECIFIC
// record that holds it — that is what decides which mailbox answers and which
// record the reply is filed under. Most specific first, most canonical last.
//
// Pure module: no React, no network. Fixture-tested by
// scripts/conversation-anchors-fixture.mjs.
// ---------------------------------------------------------------------------

/**
 * Every object a conversation can be anchored to, and the column on
 * `conversations` that holds it — in reply-anchor priority order.
 */
export const CONVERSATION_ANCHORS = [
  { object: 'service_appointments',   fk: 'service_appointment_id' },
  { object: 'work_orders',            fk: 'work_order_id' },
  { object: 'assessments',            fk: 'assessment_id' },
  { object: 'incentive_applications', fk: 'incentive_application_id' },
  { object: 'enrollments',            fk: 'enrollment_id' },
  { object: 'projects',               fk: 'project_id' },
  { object: 'opportunities',          fk: 'opportunity_id' },
  { object: 'units',                  fk: 'unit_id' },
  { object: 'buildings',              fk: 'building_id' },
  { object: 'properties',             fk: 'property_id' },
  { object: 'accounts',               fk: 'account_id' },
  { object: 'contacts',               fk: 'contact_id' },
]

/** object → the conversations column that anchors a thread to it. */
export const OBJECT_CONVERSATION_FK = Object.freeze(
  Object.fromEntries(CONVERSATION_ANCHORS.map(a => [a.object, a.fk]))
)

/** The inverse: a card knows its parent only through widget_config.fk. */
export const FK_TO_ANCHOR_OBJECT = Object.freeze(
  Object.fromEntries(CONVERSATION_ANCHORS.map(a => [a.fk, a.object]))
)

/** True when a Communications card can be placed on this object. */
export function objectCanHoldConversations(object) {
  return Boolean(object && OBJECT_CONVERSATION_FK[object])
}

/**
 * The record a reply on this thread should be sent from: the most specific
 * anchor the thread actually carries.
 *
 * Returns null when the thread carries none — the caller must say so rather
 * than send from nowhere, because an unanchored send disappears from every
 * record page.
 */
export function resolveAnchorFromConversation(conversation) {
  if (!conversation) return null
  for (const { object, fk } of CONVERSATION_ANCHORS) {
    const id = conversation[fk]
    if (id) return { anchorObject: object, anchorRecordId: id }
  }
  return null
}
