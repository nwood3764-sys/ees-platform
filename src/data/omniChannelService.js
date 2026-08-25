// -----------------------------------------------------------------------------
// omniChannelService.js — the data layer for the omni-channel Conversations
// area on a record.
//
// Nicholas, 2026-08-25: "we definitely need to make sure we have one omni
// channel for communication and tracking area for reach. For contacts and
// accounts."
//
// Three RLS-respecting RPCs (migration omni_channel_communication_rpcs):
//   list_communication_timeline   — email + text threads AND logged calls, one
//                                   time-ordered feed; an account rolls up its
//                                   contacts'
//   resolve_email_participants    — who each address on a dropped email is
//   import_email_into_conversation— file the email and keep the participants
//
// None of the matching logic lives here. What an address means depends on
// contacts and accounts the browser cannot see past RLS, so it is decided in
// the database and this module only carries the answer.
// -----------------------------------------------------------------------------

import { supabase } from '../lib/supabase'

/**
 * The unified feed for one record.
 * @param {string} object        table name, e.g. 'contacts'
 * @param {string} recordId      uuid
 * @param {string|null} channelFilter  'email' | 'sms' to narrow to one channel.
 *        A narrowed panel shows conversations ONLY — a logged call is not an
 *        email thread, and showing it under an "Email" heading would be a lie
 *        about the channel.
 */
export async function fetchCommunicationTimeline(object, recordId, channelFilter = null) {
  if (!object || !recordId) return []
  const { data, error } = await supabase.rpc('list_communication_timeline', {
    p_object: object,
    p_id: recordId,
    p_channel_filter: channelFilter || null,
  })
  if (error) throw error
  return data || []
}

/** Who each address belongs to, before anything is written. */
export async function resolveEmailParticipants(addresses) {
  const list = (addresses || []).filter(Boolean)
  if (!list.length) return []
  const { data, error } = await supabase.rpc('resolve_email_participants', {
    p_addresses: list,
  })
  if (error) throw error
  return data || []
}

/**
 * File one parsed email onto a record.
 * @param {object} args
 * @param {string} args.targetObject  table the email is being filed on
 * @param {string} args.targetId      that record's uuid
 * @param {ParsedEmail} args.parsed   from droppedEmail.js
 * @returns the RPC's own summary: conversation_id, message_id, direction,
 *          what it matched, and was_duplicate when the email was already filed.
 */
export async function importParsedEmail({ targetObject, targetId, parsed }) {
  if (!targetObject || !targetId) throw new Error('A record is required to file an email against.')
  if (!parsed?.from?.address) throw new Error('The email has no readable sender address, so it cannot be filed.')

  // The stored body prefers the HTML the sender actually wrote; the plain-text
  // alternative is the fallback, and it is rendered as text either way by the
  // panel's existing sanitiser.
  const body = parsed.bodyHtml || parsed.bodyText || ''

  const { data, error } = await supabase.rpc('import_email_into_conversation', {
    p_target_object:       targetObject,
    p_target_id:           targetId,
    p_from_address:        parsed.from.address,
    p_from_name:           parsed.from.name || null,
    p_to:                  parsed.to || [],
    p_cc:                  parsed.cc || [],
    p_subject:             parsed.subject || null,
    p_body:                body,
    p_sent_at:             parsed.sentAt || null,
    p_internet_message_id: parsed.internetMessageId || null,
    p_import_source:       parsed.source || 'eml_file',
    p_file_name:           parsed.fileName || null,
  })
  if (error) throw error
  return data
}

/** Every participant LEAP recorded for one imported message. */
export async function fetchMessageParticipants(messageId) {
  if (!messageId) return []
  const { data, error } = await supabase
    .from('message_participants')
    .select('id, mpart_role, mpart_address, mpart_display_name, mpart_matched_object, mpart_matched_id, mpart_match_basis, mpart_is_ees_side, contact_id, account_id')
    .eq('message_id', messageId)
    .eq('mpart_is_deleted', false)
    .order('mpart_role', { ascending: true })
  if (error) throw error
  return data || []
}
