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
// 2026-09-05 — RELATED TO. Nicholas: "I want to be able to put communications
// on wherever I want: on projects, on work orders, on anything… Why are there
// limits?" The limit was this list: a thread could only belong to an object
// with its own column on `conversations`. A thread now carries a polymorphic
// Related To (`conv_related_object` + `conv_related_id`, Salesforce's WhatId)
// and can be related to ANY object that has a record page. The database
// decides which (conversation_related_to_objects()); the client no longer
// keeps a list of objects at all — only the twelve foreign-key columns, kept
// because they still carry the owner-chain rule, the state-scope paths and
// the account roll-up. A Related To that names a foreign-key-backed object
// also fills its column (the database trigger does it), so every reader that
// knew the columns keeps working.
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

// The two objects a thread can never be Related To — a rule, not a list: a
// person on a thread is not a record the thread belongs to, and a thread about
// a thread is its messages. The database applies the same two exclusions.
export const RELATED_TO_NEVER = Object.freeze(['users', 'conversations'])

/**
 * True when a Communications card can be placed on this object. Any object
 * with a record page qualifies; the layout editor is only ever opened for
 * one, and the database refuses an object it cannot relate a thread to.
 */
export function objectCanHoldConversations(object) {
  return Boolean(object && typeof object === 'string' && !RELATED_TO_NEVER.includes(object))
}

/**
 * What a Communications card stores so the record page can find the thread:
 * the object it sits on (Related To), plus the object's own column on
 * conversations when it has one (null for the sixty-odd objects reached only
 * through Related To).
 */
export function conversationAnchorConfig(object) {
  return { related_object: object, fk: OBJECT_CONVERSATION_FK[object] || null }
}

/**
 * The record a reply on this thread should be sent from: its Related To when
 * it has one, else the most specific foreign-key anchor it carries (a thread
 * from before Related To existed, or one fetched without the new columns).
 *
 * Returns null when the thread carries none — the caller must say so rather
 * than send from nowhere, because an unanchored send disappears from every
 * record page.
 */
export function resolveAnchorFromConversation(conversation) {
  if (!conversation) return null
  if (conversation.conv_related_object && conversation.conv_related_id) {
    return { anchorObject: conversation.conv_related_object, anchorRecordId: conversation.conv_related_id }
  }
  for (const { object, fk } of CONVERSATION_ANCHORS) {
    const id = conversation[fk]
    if (id) return { anchorObject: object, anchorRecordId: id }
  }
  return null
}
