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

// ───────────────────────────────────────────────────────────────────────────
// Unmatched Inbox triage — Communications Module v1 Slice 4
//
// Inbound emails that fail all three resolution rules in the inbound-email-
// webhook (plus-address, In-Reply-To/References, sender→contact→thread) land
// in `unmatched_inbox` with ui_status='awaiting_triage'. The triage UI lets a
// coordinator either link the row to an existing conversation or dismiss it.
//
// Three writes are wrapped here so the UI doesn't have to know the column
// names or the linkage rules:
//   • fetchUnmatchedInbox      — list, filterable by status, newest first
//   • linkUnmatchedToConversation — attach to an existing thread (creates the
//                                    messages row and stamps ui_status='linked')
//   • dismissUnmatchedRow      — stamp ui_status='dismissed' with a reason
// ───────────────────────────────────────────────────────────────────────────

const UNMATCHED_COLUMNS = [
  'id',
  'ui_record_number',
  'ui_channel',
  'ui_received_at',
  'ui_from_address',
  'ui_to_address',
  'ui_subject',
  'ui_body_preview',
  'ui_provider',
  'ui_provider_message_id',
  'ui_in_reply_to_header',
  'ui_references_header',
  'ui_status',
  'ui_linked_conversation_id',
  'ui_linked_at',
  'ui_linked_by',
  'ui_dismissed_reason',
  'ui_created_at',
].join(', ')

/**
 * Fetch unmatched_inbox rows. Defaults to status='awaiting_triage' (the queue
 * a coordinator works through). Pass status=null to see everything.
 */
export async function fetchUnmatchedInbox({ status = 'awaiting_triage', limit = 100 } = {}) {
  let q = supabase
    .from('unmatched_inbox')
    .select(UNMATCHED_COLUMNS)
    .eq('ui_is_deleted', false)
  if (status) q = q.eq('ui_status', status)
  q = q.order('ui_received_at', { ascending: false, nullsFirst: false }).limit(limit)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Recent email conversations for the link-picker. Returns the threads on
 * (and immediately around) the same mailbox so coordinators can pick the
 * right target without scrolling 1000 rows.
 */
export async function fetchRecentEmailConversations({ ourAddress = null, limit = 50 } = {}) {
  let q = supabase
    .from('conversations')
    .select('id, conv_record_number, conv_subject, conv_customer_address, conv_our_address, conv_last_message_at')
    .eq('conv_channel', 'email')
    .eq('conv_is_deleted', false)
  if (ourAddress) {
    // strip plus-addressing — the unmatched row's to_address may carry +c_xxx
    const at = ourAddress.indexOf('@')
    let baseOurs = ourAddress
    if (at > 0) {
      const local = ourAddress.slice(0, at)
      const domain = ourAddress.slice(at)
      const plus = local.indexOf('+')
      if (plus >= 0) baseOurs = `${local.slice(0, plus)}${domain}`
    }
    q = q.eq('conv_our_address', baseOurs)
  }
  q = q.order('conv_last_message_at', { ascending: false, nullsFirst: false }).limit(limit)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Link an unmatched_inbox row to an existing conversation. Inserts the
 * inbound message onto the target thread (carrying the original Message-ID,
 * subject, body, from/to) and stamps the unmatched row with ui_status='linked'.
 *
 * The two writes happen sequentially rather than in a single RPC for now —
 * an RPC wrapper is a follow-up cleanup; v1 keeps the SQL surface small.
 */
export async function linkUnmatchedToConversation({ unmatchedId, conversationId }) {
  if (!unmatchedId) throw new Error('unmatchedId required')
  if (!conversationId) throw new Error('conversationId required')

  // Fetch the unmatched row in full
  const { data: ui, error: uiErr } = await supabase
    .from('unmatched_inbox')
    .select(UNMATCHED_COLUMNS + ', ui_raw_payload')
    .eq('id', unmatchedId)
    .maybeSingle()
  if (uiErr) throw uiErr
  if (!ui) throw new Error('Unmatched row not found')
  if (ui.ui_status === 'linked') throw new Error('This row has already been linked')

  // Resolve caller's public.users.id for the audit cols
  const { data: { user: authUser } } = await supabase.auth.getUser()
  let callerUserId = null
  if (authUser?.id) {
    const { data: u } = await supabase
      .from('users').select('id').eq('auth_user_id', authUser.id).maybeSingle()
    callerUserId = u?.id || null
  }

  // Idempotency: if the same provider_message_id already exists in messages,
  // don't double-insert — just stamp the unmatched row and return.
  if (ui.ui_provider_message_id) {
    const { data: existing } = await supabase
      .from('messages')
      .select('id')
      .eq('msg_provider_message_id', ui.ui_provider_message_id)
      .eq('msg_is_deleted', false)
      .maybeSingle()
    if (existing) {
      await supabase.from('unmatched_inbox').update({
        ui_status: 'linked',
        ui_linked_conversation_id: conversationId,
        ui_linked_at: new Date().toISOString(),
        ui_linked_by: callerUserId,
        ui_updated_by: callerUserId,
      }).eq('id', unmatchedId)
      return { messageId: existing.id, alreadyExisted: true }
    }
  }

  // Insert the message onto the target thread
  const { data: msg, error: msgErr } = await supabase.from('messages').insert({
    msg_record_number:       '',
    conversation_id:         conversationId,
    msg_direction:           'inbound',
    msg_channel:             ui.ui_channel || 'email',
    msg_from_address:        ui.ui_from_address,
    msg_to_address:          ui.ui_to_address,
    msg_subject:             ui.ui_subject,
    msg_body:                ui.ui_body_preview || '(linked from unmatched inbox — body preview only)',
    msg_provider:            ui.ui_provider || 'microsoft_graph',
    msg_provider_message_id: ui.ui_provider_message_id,
    msg_status:              'received',
    msg_status_updated_at:   new Date().toISOString(),
    msg_external_message_id: ui.ui_provider_message_id,
    msg_created_by:          callerUserId,
    msg_updated_by:          callerUserId,
  }).select('id').single()
  if (msgErr) throw msgErr

  // Stamp the unmatched row as linked
  const { error: stampErr } = await supabase.from('unmatched_inbox').update({
    ui_status: 'linked',
    ui_linked_conversation_id: conversationId,
    ui_linked_at: new Date().toISOString(),
    ui_linked_by: callerUserId,
    ui_updated_by: callerUserId,
  }).eq('id', unmatchedId)
  if (stampErr) throw stampErr

  return { messageId: msg.id, alreadyExisted: false }
}

/**
 * Dismiss an unmatched_inbox row without linking — for spam, irrelevant
 * forwards, etc. Reason is required so the audit trail captures why.
 */
export async function dismissUnmatchedRow({ unmatchedId, reason }) {
  if (!unmatchedId) throw new Error('unmatchedId required')
  const trimmed = (reason || '').trim()
  if (!trimmed) throw new Error('Dismissal reason required')

  const { data: { user: authUser } } = await supabase.auth.getUser()
  let callerUserId = null
  if (authUser?.id) {
    const { data: u } = await supabase
      .from('users').select('id').eq('auth_user_id', authUser.id).maybeSingle()
    callerUserId = u?.id || null
  }

  const { error } = await supabase.from('unmatched_inbox').update({
    ui_status: 'dismissed',
    ui_dismissed_reason: trimmed,
    ui_updated_by: callerUserId,
  }).eq('id', unmatchedId)
  if (error) throw error
}

// ───────────────────────────────────────────────────────────────────────────
// Attachments — Communications Module v1 Slice 5
//
// Storage layout: bucket `communications-attachments`, key
//   {conversation_id}/{message_id}/{uuid}-{filename}
// Each row is linked from public.message_attachments. Bucket is non-public —
// downloads go through signed URLs minted at view time.
//
// Allowed types (extension + MIME) and 25 MB inline / signed-link threshold
// match the leap-communications-module-1.md spec. ma_virus_scan_status
// defaults to 'pending' — the ClamAV edge function that flips it to 'clean'
// or 'infected' is a follow-up slice. For v1, attachments display in the
// timeline immediately with a pending-scan badge.
// ───────────────────────────────────────────────────────────────────────────

const ATTACHMENT_MAX_INLINE_BYTES = 25 * 1024 * 1024

const ATTACHMENT_BUCKET = 'communications-attachments'

// Conservative allow-list — common business document and image formats.
// Mirrors the spec. Anything outside this set is refused at upload with a
// clear toast.
const ATTACHMENT_ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
  'png', 'jpg', 'jpeg', 'heic', 'heif', 'gif', 'webp',
  'csv', 'tsv', 'txt', 'md',
  'zip',
])

// Block executables / scripts outright — even if disguised by extension.
const ATTACHMENT_BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'sh', 'ps1', 'vbs', 'js', 'jar', 'dll', 'msi',
  'app', 'scr', 'cmd', 'com', 'cpl', 'reg', 'wsf', 'wsh',
])

function extensionOf(filename) {
  if (!filename) return ''
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

/**
 * Pre-flight validation a caller can run before staging an attachment in the
 * compose modal. Throws a descriptive Error if the file is refused. Used by
 * the modal's file-input change handler.
 */
export function validateAttachmentFile(file) {
  if (!file) throw new Error('No file selected')
  const ext = extensionOf(file.name)
  if (ATTACHMENT_BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Refused: .${ext} files are blocked for security.`)
  }
  if (ext && !ATTACHMENT_ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Refused: .${ext} is not in the allowed file types (PDF, Office, images, CSV, TXT, ZIP).`)
  }
  // 100 MB hard ceiling regardless of inline vs signed-link — the signed-link
  // path is the way around the 25 MB Graph cap but we still cap total size.
  const HARD_MAX = 100 * 1024 * 1024
  if (file.size > HARD_MAX) {
    throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the 100 MB limit.`)
  }
  return true
}

/**
 * Upload a single attachment to Supabase Storage and create the
 * message_attachments row linking it to the message. Returns the
 * attachment row.
 *
 * Delivery method is picked automatically:
 *   • <= 25 MB → 'inline'      (in real-mode Graph send: attached on the
 *                                 outgoing email's `attachments` array)
 *   • >  25 MB → 'signed_link' (in real-mode Graph send: body gets a
 *                                 30-day signed URL appended)
 *
 * In mock-mode the file is uploaded and the row written exactly as in real
 * mode; only the Graph send call is skipped (the same way send-email-v1
 * works today).
 */
export async function uploadAttachmentForMessage({ messageId, conversationId, file }) {
  if (!messageId)       throw new Error('messageId required')
  if (!conversationId)  throw new Error('conversationId required')
  validateAttachmentFile(file)

  // Resolve caller for audit cols
  const { data: { user: authUser } } = await supabase.auth.getUser()
  let callerUserId = null
  if (authUser?.id) {
    const { data: u } = await supabase
      .from('users').select('id').eq('auth_user_id', authUser.id).maybeSingle()
    callerUserId = u?.id || null
  }

  // Build storage key — conversation_id / message_id / <uuid>-filename
  const uniquePrefix = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  // Sanitize the filename for the storage key — keep the original on the row
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const storagePath = `${conversationId}/${messageId}/${uniquePrefix}-${safeName}`

  // Upload
  const { error: upErr } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

  // Decide delivery method
  const deliveryMethod = file.size > ATTACHMENT_MAX_INLINE_BYTES ? 'signed_link' : 'inline'
  // Signed-link path stamps an expiry 30 days out; inline leaves it null.
  const signedLinkExpiresAt = deliveryMethod === 'signed_link'
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : null

  const { data: row, error: rowErr } = await supabase.from('message_attachments').insert({
    ma_message_id:            messageId,
    ma_storage_path:          storagePath,
    ma_file_name:             file.name,
    ma_file_size_bytes:       file.size,
    ma_mime_type:             file.type || null,
    ma_delivery_method:       deliveryMethod,
    ma_virus_scan_status:     'pending',
    ma_signed_link_expires_at: signedLinkExpiresAt,
    ma_created_by:            callerUserId,
    ma_updated_by:            callerUserId,
  }).select('*').single()
  if (rowErr) {
    // Try to clean up the orphaned storage object so we don't leak
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]).catch(() => {})
    throw new Error(`Attachment row insert failed: ${rowErr.message}`)
  }
  return row
}

/**
 * List attachments for one or many messages. Used by the timeline renderer
 * to show paperclip + filename + size below the body bubble. Returns
 * { [messageId]: [attachmentRow, ...] } for efficient batch fetching.
 */
export async function fetchAttachmentsForMessages(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return {}
  const { data, error } = await supabase
    .from('message_attachments')
    .select('id, ma_message_id, ma_storage_path, ma_file_name, ma_file_size_bytes, ma_mime_type, ma_delivery_method, ma_virus_scan_status, ma_signed_link_expires_at, ma_created_at')
    .in('ma_message_id', messageIds)
    .eq('ma_is_deleted', false)
    .order('ma_created_at', { ascending: true })
  if (error) throw error
  const out = {}
  for (const row of (data || [])) {
    if (!out[row.ma_message_id]) out[row.ma_message_id] = []
    out[row.ma_message_id].push(row)
  }
  return out
}

/**
 * Mint a short-lived signed URL for downloading one attachment. The bucket
 * is non-public — every view goes through this. 5-minute TTL is plenty for
 * a click → open flow and won't survive being shared in a chat.
 */
export async function createAttachmentSignedUrl(attachmentRow) {
  if (!attachmentRow?.ma_storage_path) throw new Error('attachment row missing storage path')
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(attachmentRow.ma_storage_path, 5 * 60)
  if (error) throw new Error(`Signed URL failed: ${error.message}`)
  return data?.signedUrl || null
}

/**
 * Soft-delete an attachment. Storage object is left in place — recovery and
 * audit-trail completeness wins over storage-cost optimization until cleanup
 * is its own dedicated chore.
 */
export async function softDeleteAttachment({ attachmentId, reason }) {
  if (!attachmentId) throw new Error('attachmentId required')
  const { data: { user: authUser } } = await supabase.auth.getUser()
  let callerUserId = null
  if (authUser?.id) {
    const { data: u } = await supabase
      .from('users').select('id').eq('auth_user_id', authUser.id).maybeSingle()
    callerUserId = u?.id || null
  }
  const { error } = await supabase.from('message_attachments').update({
    ma_is_deleted:      true,
    ma_deleted_at:      new Date().toISOString(),
    ma_deleted_by:      callerUserId,
    ma_deletion_reason: (reason || '').trim() || null,
    ma_updated_by:      callerUserId,
  }).eq('id', attachmentId)
  if (error) throw error
}

// =============================================================================
// Email template loaders for the rich-text composer
// =============================================================================
//
// fetchActiveEmailTemplates returns Active (publishable) templates available
// for compose. We do not (yet) filter by anchor object — the template
// configuration captures intent loosely and the merge field resolver gates
// what actually renders. A future slice will narrow by record type when
// templates routinely carry that scope; for now Active is the right filter.

export async function fetchActiveEmailTemplates({ anchorObject } = {}) {
  // email_templates.status is a uuid FK to picklist_values — must filter
  // by the resolved label, not the raw value.
  const { data, error } = await supabase
    .from('email_templates')
    .select(`
      id,
      et_record_number,
      name,
      description,
      related_object,
      template_default_outbound_mailbox_id,
      template_ai_assist_allowed,
      template_locked_regions,
      status:picklist_values!status ( picklist_label )
    `)
    .eq('is_deleted', false)
    .order('name', { ascending: true })
  if (error) throw error
  // Active rows only, and (if an anchorObject is supplied) filter to
  // templates whose related_object matches — send-email-v1 enforces the
  // same match server-side and rejects with 400 if they disagree, so
  // hiding mismatched templates at the picker keeps the UX clean.
  return (data || []).filter(r => {
    if ((r.status?.picklist_label || '').toLowerCase() !== 'active') return false
    if (anchorObject && r.related_object && r.related_object !== anchorObject) return false
    return true
  })
}

// fetchEmailTemplate returns one template by id, including the locked-region
// jsonb. Used by the composer when the user picks a template from the
// dropdown.

export async function fetchEmailTemplate(templateId) {
  if (!templateId) throw new Error('templateId required')
  const { data, error } = await supabase
    .from('email_templates')
    .select(`
      id,
      et_record_number,
      name,
      description,
      subject,
      body_html,
      template_default_outbound_mailbox_id,
      template_ai_assist_allowed,
      template_locked_regions
    `)
    .eq('id', templateId)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Template-driven send. Hands an email_template_id plus a map of editable
 * region content to send-email-v1, which assembles the final body
 * server-side from the template's locked regions + the provided editable
 * regions and validates that locked content appears verbatim.
 *
 * The map shape is { [region_id]: html_string }. Region ids must match
 * the editable regions declared in template_locked_regions.
 */
export async function sendTemplateEmail({
  anchorObject,
  anchorRecordId,
  to,                  // { email, name? }
  emailTemplateId,
  editableRegions,     // { [region_id]: html_string }
  outboundMailboxId,   // optional — template's default wins if omitted
  contactId,
  subjectOverride,     // optional — user-edited subject line
}) {
  if (!anchorObject || !anchorRecordId) throw new Error('anchor record required')
  if (!emailTemplateId)                  throw new Error('emailTemplateId required')
  if (!to?.email)                        throw new Error('Recipient email required')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.email))
    throw new Error('Recipient email is not a valid address')

  const payload = {
    anchor_object:    anchorObject,
    anchor_record_id: anchorRecordId,
    to: { email: to.email, name: to.name || to.email },
    email_template_id: emailTemplateId,
    editable_regions:  editableRegions || {},
    subject:           subjectOverride || undefined,
    outbound_mailbox_id: outboundMailboxId || undefined,
    contact_id:          contactId || undefined,
  }
  const { data, error } = await supabase.functions.invoke('send-email-v1', { body: payload })
  if (error) throw new Error(error.message || 'Send failed at the network layer')
  if (data?.status === 'failed') {
    const reason = data.failure_reason || 'Send failed'
    const err = new Error(reason)
    err.payload = data
    throw err
  }
  return data
}

/**
 * Free-form send variant that accepts pre-rendered HTML directly (vs the
 * legacy plain-text path which auto-wraps). Used by the TipTap composer
 * in free-form mode.
 */
export async function sendNewEmailHtml({
  anchorObject,
  anchorRecordId,
  to,
  subject,
  bodyHtml,
  outboundMailboxId,
  contactId,
}) {
  if (!anchorObject || !anchorRecordId) throw new Error('anchor record required')
  if (!to?.email) throw new Error('Recipient email required')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.email))
    throw new Error('Recipient email is not a valid address')
  const trimmedSubject = (subject || '').trim()
  if (!trimmedSubject) throw new Error('Subject required')
  if (!bodyHtml || !bodyHtml.replace(/<[^>]*>/g, '').trim()) {
    throw new Error('Message body required')
  }
  if (!outboundMailboxId) throw new Error('Outbound mailbox required')

  const payload = {
    anchor_object:       anchorObject,
    anchor_record_id:    anchorRecordId,
    to: { email: to.email, name: to.name || to.email },
    subject:             trimmedSubject,
    body_html:           bodyHtml,
    outbound_mailbox_id: outboundMailboxId,
    contact_id:          contactId || undefined,
  }
  const { data, error } = await supabase.functions.invoke('send-email-v1', { body: payload })
  if (error) throw new Error(error.message || 'Send failed at the network layer')
  if (data?.status === 'failed') {
    const reason = data.failure_reason || 'Send failed'
    const err = new Error(reason)
    err.payload = data
    throw err
  }
  return data
}

// Tiny formatter for display
export function formatBytes(n) {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
