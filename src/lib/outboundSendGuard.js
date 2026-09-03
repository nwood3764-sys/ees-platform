// ─── outboundSendGuard.js ────────────────────────────────────────────────────
// Nothing leaves LEAP for a customer without a person seeing who it is going to.
//
// Nicholas, 2026-09-03: "Any outgoing communications, emails, texts, anything
// must be approved by a human first. That's a hard rule for now. Maybe in the
// future we'll release that, but not right now."
//
// The trigger-fired pipeline is gated in the database — enqueue_notification
// holds every message in outbound_message_approvals and only
// approve_outbound_message releases it. That covers everything LEAP decides to
// send on its own, which is where the harm was: a property contact got "Your
// home energy assessment is scheduled" about an insulation removal because a
// field got populated.
//
// This is the other half: the sends a person starts from a screen. Those are
// already human-authored, but "authored" is not "verified" — the address is
// often inherited from a record rather than typed, which is exactly how the
// wrong recipient got picked last time. So every one of them names the
// recipient back to the sender and waits for a yes.
//
// There is ONE definition of that confirmation on purpose. Nine send paths with
// nine hand-written confirm() calls is nine chances for one to be forgotten, and
// scripts/outbound-send-guard-fixture.mjs fails the build if a send path skips
// it — the rule is enforced by the build, not by remembering.

/** Channels LEAP can send on, and how to name them to a person. */
const CHANNEL_NOUN = {
  email: 'email',
  sms: 'text message',
  portal: 'portal notification',
}

/**
 * Ask the sender to confirm an outbound message before it goes.
 *
 * @param {object} o
 * @param {'email'|'sms'|'portal'} o.channel
 * @param {string|string[]} o.to        recipient address(es) — what will actually be used
 * @param {string} [o.subject]          shown when there is one
 * @param {string} [o.context]          e.g. "Reply on the thread with Jane Henderson"
 * @returns {boolean} true when the person said send
 *
 * Returns FALSE when there is no window (a test runner, a server context).
 * That direction is deliberate: with nobody to ask, the answer is not "send".
 */
export function confirmOutboundSend({ channel = 'email', to, subject = null, context = null } = {}) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean).map(String)
  const noun = CHANNEL_NOUN[channel] || 'message'

  // A send with no recipient is never confirmable — it cannot be checked, so it
  // cannot be approved.
  if (recipients.length === 0) return false
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false

  const who = recipients.length === 1
    ? recipients[0]
    : `${recipients.length} recipients:\n  ${recipients.join('\n  ')}`

  const lines = [
    `Send this ${noun} to:`,
    '',
    who,
    '',
  ]
  if (subject) lines.push(`Subject: ${subject}`, '')
  if (context) lines.push(context, '')
  lines.push('Nothing is sent until you approve it.')

  return window.confirm(lines.join('\n'))
}

/** The error every send path raises when the person says no, so the caller can
 *  tell "declined" apart from "failed" and not show a red error for a choice. */
export class OutboundSendDeclined extends Error {
  constructor(message = 'Not sent — you cancelled it.') {
    super(message)
    this.name = 'OutboundSendDeclined'
    this.declined = true
  }
}

/** Confirm, or throw the declined error. The one line a send path adds. */
export function requireOutboundApproval(o) {
  if (!confirmOutboundSend(o)) throw new OutboundSendDeclined()
}
