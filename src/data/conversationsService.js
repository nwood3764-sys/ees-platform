// ---------------------------------------------------------------------------
// conversationsService — thin data layer for the ConversationPanel widget.
//
// Backs the Salesforce Service Cloud Messaging-style split-pane that lives
// in the 'Conversations' section on contact / account / project /
// service_appointment page layouts.
//
// Responsibilities split clearly:
//   • fetchConversationsForParent — left-pane list of threads for one parent
//   • fetchMessagesForConversation — right-pane message body
//   • markConversationRead — clear inbound_unread_count via existing RPC
//   • sendReplyToConversation — composer Send button → send-notification-sms v2
//
// The conversation/messages tables already enforce row-level security via
// app_user_can, so these calls do not need additional permission checks here.
// The send path runs as service-role via the edge function and is gated by
// session presence at the page level.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'

const CONV_COLUMNS = [
  'id',
  'conv_record_number',
  'conv_channel',
  'conv_our_address',
  'conv_customer_address',
  'conv_status',
  'conv_subject',
  'conv_last_message_at',
  'conv_last_message_direction',
  'conv_last_message_preview',
  'conv_inbound_unread_count',
  'contact_id',
  'account_id',
  'project_id',
  'service_appointment_id',
].join(', ')

const MSG_COLUMNS = [
  'id',
  'msg_record_number',
  'conversation_id',
  'msg_direction',
  'msg_channel',
  'msg_from_address',
  'msg_to_address',
  'msg_subject',
  'msg_body',
  'msg_provider',
  'msg_provider_message_id',
  'msg_status',
  'msg_status_updated_at',
  'msg_provider_error_message',
  'msg_provider_error_code',
  'msg_sent_at',
  'msg_delivered_at',
  'msg_created_at',
  'msg_created_by',
].join(', ')

// FK columns we know how to filter by. Defensive guard so an admin pointing
// the widget at an arbitrary FK doesn't silently fall through.
const SUPPORTED_FK = new Set([
  'contact_id',
  'account_id',
  'project_id',
  'service_appointment_id',
])

/**
 * Threads for the parent record, newest activity first.
 * @param {string} fk             FK column on conversations (one of the four)
 * @param {string} parentId       UUID of the parent record
 * @param {string|null} channelFilter   Optional 'sms' | 'email' to narrow the
 *                                      list to one channel. Null/undefined
 *                                      returns all channels.
 */
export async function fetchConversationsForParent(fk, parentId, channelFilter = null) {
  if (!fk || !parentId) return []
  if (!SUPPORTED_FK.has(fk)) {
    throw new Error(`ConversationPanel: unsupported FK '${fk}'. Expected one of ${[...SUPPORTED_FK].join(', ')}.`)
  }
  let q = supabase
    .from('conversations')
    .select(CONV_COLUMNS)
    .eq(fk, parentId)
    .eq('conv_is_deleted', false)
  if (channelFilter) {
    q = q.eq('conv_channel', channelFilter)
  }
  const { data, error } = await q
    .order('conv_last_message_at', { ascending: false, nullsFirst: false })
    .limit(50)
  if (error) throw error
  return data || []
}

/**
 * Full message body for one thread, ordered oldest → newest so the timeline
 * reads top-down. Soft-deleted messages are filtered out.
 */
export async function fetchMessagesForConversation(conversationId) {
  if (!conversationId) return []
  const { data, error } = await supabase
    .from('messages')
    .select(MSG_COLUMNS)
    .eq('conversation_id', conversationId)
    .eq('msg_is_deleted', false)
    .order('msg_created_at', { ascending: true })
    .limit(500)
  if (error) throw error
  return data || []
}

/**
 * Clear the unread badge on a thread. Wraps mark_conversation_read RPC
 * (idempotent — safe to call on every thread open).
 */
export async function markConversationRead(conversationId) {
  if (!conversationId) return
  const { error } = await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  })
  // Non-fatal: the unread counter is a UX nicety, not a correctness gate.
  // If the RPC ever returns an error we log it and let the user proceed.
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('mark_conversation_read failed', error)
  }
}

/**
 * Send an outbound reply on an existing thread. Routes through the
 * channel-appropriate edge function:
 *   • SMS  → send-notification-sms v2 (writes notification_logs + messages)
 *   • Email → send-email-v1 (writes messages + conversations only, free-form)
 *
 * Both paths flip msg_status from queued → sent / failed via the edge function.
 *
 * Returns the edge function's JSON payload so the caller can inspect
 * mock-vs-real mode + provider_message_id.
 */
export async function sendReplyToConversation(conversation, bodyText, opts = {}) {
  if (!conversation?.id) throw new Error('conversation required')
  const trimmed = (bodyText || '').trim()
  if (!trimmed) throw new Error('Message body is empty')

  const channel = conversation.conv_channel

  // ── SMS path ────────────────────────────────────────────────────────
  if (channel === 'sms') {
    const customerPhone = conversation.conv_customer_address
    const ourPhone = conversation.conv_our_address
    if (!customerPhone || !/^\+[1-9]\d{6,14}$/.test(customerPhone)) {
      throw new Error('Customer phone on this thread is not a valid E.164 number.')
    }

    const payload = {
      trigger_event: 'dispatcher_reply',
      recipient_phone: customerPhone,
      body_text: trimmed,
      from_number: ourPhone || undefined,
      contact_id: conversation.contact_id || undefined,
      account_id: conversation.account_id || undefined,
      project_id: conversation.project_id || undefined,
      service_appointment_id: conversation.service_appointment_id || undefined,
    }
    const { data, error } = await supabase.functions.invoke('send-notification-sms', {
      body: payload,
    })
    if (error) throw new Error(error.message || 'Send failed at the network layer')
    if (data?.status === 'failed') {
      const reason = data.failure_reason || 'Send failed'
      const err = new Error(reason)
      err.code = data.failure_code || null
      err.payload = data
      throw err
    }
    return data
  }

  // ── Email path ──────────────────────────────────────────────────────
  if (channel === 'email') {
    const customerEmail = conversation.conv_customer_address
    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      throw new Error('Customer email on this thread is not a valid email address.')
    }
    // Anchor — the caller must supply this for email; conversations carry the
    // four canonical FKs but the spec says every email is anchored to a record
    // and send-email-v1 enforces it. Resolve from the conversation's own FKs
    // in priority order: service_appointment > project > account > contact.
    let anchorObject = null
    let anchorRecordId = null
    if (opts.anchorObject && opts.anchorRecordId) {
      anchorObject = opts.anchorObject
      anchorRecordId = opts.anchorRecordId
    } else if (conversation.service_appointment_id) {
      anchorObject = 'service_appointments'
      anchorRecordId = conversation.service_appointment_id
    } else if (conversation.project_id) {
      anchorObject = 'projects'
      anchorRecordId = conversation.project_id
    } else if (conversation.account_id) {
      anchorObject = 'accounts'
      anchorRecordId = conversation.account_id
    } else if (conversation.contact_id) {
      anchorObject = 'contacts'
      anchorRecordId = conversation.contact_id
    } else {
      throw new Error('Email reply requires an anchor record but the thread has no project/account/contact/service_appointment.')
    }

    // Reply subject default: "Re: <original subject>" if not already prefixed.
    const baseSubject = (conversation.conv_subject || '').trim() || '(no subject)'
    const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`

    // Find the outbound mailbox by matching the thread's our_address.
    let outboundMailboxId = opts.outboundMailboxId || null
    if (!outboundMailboxId && conversation.conv_our_address) {
      // Strip plus-addressing before matching (assessments+c_abc@... → assessments@...)
      const baseOurs = stripPlusAddress(conversation.conv_our_address)
      const { data: mailbox } = await supabase
        .from('outbound_mailboxes')
        .select('id')
        .eq('obm_address', baseOurs)
        .eq('obm_is_active', true)
        .eq('obm_is_deleted', false)
        .maybeSingle()
      outboundMailboxId = mailbox?.id || null
    }

    const payload = {
      anchor_object: anchorObject,
      anchor_record_id: anchorRecordId,
      to: { email: customerEmail, name: opts.recipientName || customerEmail },
      subject,
      body_html: textToMinimalHtml(trimmed),
      outbound_mailbox_id: outboundMailboxId || undefined,
      contact_id: conversation.contact_id || undefined,
    }
    const { data, error } = await supabase.functions.invoke('send-email-v1', {
      body: payload,
    })
    if (error) throw new Error(error.message || 'Send failed at the network layer')
    if (data?.status === 'failed') {
      const reason = data.failure_reason || 'Send failed'
      const err = new Error(reason)
      err.payload = data
      throw err
    }
    return data
  }

  throw new Error(`Replies on '${channel}' threads are not supported.`)
}

/**
 * Active outbound mailboxes for the Compose Email mailbox picker.
 * Soft-deleted and inactive rows are excluded.
 */
export async function fetchOutboundMailboxes() {
  const { data, error } = await supabase
    .from('outbound_mailboxes')
    .select('id, obm_record_number, obm_address, obm_display_name, obm_state, obm_program_id')
    .eq('obm_is_active', true)
    .eq('obm_is_deleted', false)
    .order('obm_state', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Send a brand-new email (no existing thread) anchored to a parent record.
 * Routes through send-email-v1 in free-form mode (subject + body_html).
 *
 * The edge function:
 *   • resolves the outbound mailbox (explicit id wins, then state lookup)
 *   • calls find_or_create_conversation to thread on customer + our address
 *   • inserts the messages row in 'queued'
 *   • flips to 'sent' (mock mode → mock-<uuid>, real mode → graph-<uuid>)
 *   • updates conversation rollup via the AFTER INSERT trigger
 *
 * Returns the edge function's JSON payload — caller surfaces mode (mock/real),
 * conversation_id (to navigate to the new thread), and provider_message_id.
 */
export async function sendNewEmail({
  anchorObject,
  anchorRecordId,
  to,            // { email, name? }
  subject,
  bodyText,      // plain text — auto-wrapped to minimal HTML
  outboundMailboxId,
  contactId,
}) {
  if (!anchorObject || !anchorRecordId) throw new Error('anchor record required')
  if (!to?.email) throw new Error('Recipient email required')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.email)) throw new Error('Recipient email is not a valid address')
  const trimmedSubject = (subject || '').trim()
  if (!trimmedSubject) throw new Error('Subject required')
  const trimmedBody = (bodyText || '').trim()
  if (!trimmedBody) throw new Error('Message body required')
  if (!outboundMailboxId) throw new Error('Outbound mailbox required')

  const payload = {
    anchor_object: anchorObject,
    anchor_record_id: anchorRecordId,
    to: { email: to.email, name: to.name || to.email },
    subject: trimmedSubject,
    body_html: textToMinimalHtml(trimmedBody),
    outbound_mailbox_id: outboundMailboxId,
    contact_id: contactId || undefined,
  }
  const { data, error } = await supabase.functions.invoke('send-email-v1', {
    body: payload,
  })
  if (error) throw new Error(error.message || 'Send failed at the network layer')
  if (data?.status === 'failed') {
    const reason = data.failure_reason || 'Send failed'
    const err = new Error(reason)
    err.payload = data
    throw err
  }
  return data
}

// ── Helpers ────────────────────────────────────────────────────────────

// Strip plus-addressing (assessments+c_8f3a2b1d@ees-wi.org → assessments@ees-wi.org)
// so we can match the conversation's our_address back to its underlying mailbox.
function stripPlusAddress(address) {
  if (!address) return ''
  const at = address.indexOf('@')
  if (at < 0) return address
  const local = address.slice(0, at)
  const domain = address.slice(at)
  const plus = local.indexOf('+')
  if (plus < 0) return address
  return `${local.slice(0, plus)}${domain}`
}

// Plain text → minimal HTML for Graph's HTML body requirement.
// Preserves line breaks via white-space:pre-wrap and entity-escapes &<>.
function textToMinimalHtml(text) {
  if (!text) return ''
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111;white-space:pre-wrap;">${escaped}</div>`
}

/**
 * Channel-aware display helper for the thread list.
 * Returned shape: { label, iconPath, color, bg }
 */
export function describeChannel(channel) {
  switch (channel) {
    case 'sms':
      return {
        label: 'SMS',
        // chat bubble icon
        iconPath: 'M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z',
        color: '#2aab72',
        bg: '#e8f8f2',
      }
    case 'email':
      return {
        label: 'Email',
        iconPath: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6',
        color: '#1a5a8a',
        bg: '#e8f3fb',
      }
    default:
      return {
        label: channel || 'Message',
        iconPath: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
        color: '#4a5e7a',
        bg: '#f0f3f8',
      }
  }
}

/**
 * Direction-aware bubble styling.
 *   outbound = us → customer (right aligned, emerald wash)
 *   inbound  = customer → us (left aligned, sky wash)
 */
export function describeDirection(direction) {
  if (direction === 'outbound') {
    return {
      label: 'Outbound',
      align: 'flex-end',
      bg: '#e8f8f2',
      border: '#bfe7d3',
      color: '#0d1a2e',
      meta: '#1a7a4e',
    }
  }
  return {
    label: 'Inbound',
    align: 'flex-start',
    bg: '#e8f3fb',
    border: '#c4dcee',
    color: '#0d1a2e',
    meta: '#1a5a8a',
  }
}
