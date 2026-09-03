// Fixture: nothing leaves LEAP for a customer without a person seeing who it is
// going to.
//
// Nicholas, 2026-09-03: "Any outgoing communications, emails, texts, anything
// must be approved by a human first. That's a hard rule for now. Maybe in the
// future we'll release that, but not right now."
//
// The trigger-fired pipeline is gated in the DATABASE — enqueue_notification
// holds every message in outbound_message_approvals and only
// approve_outbound_message releases it. That covers everything LEAP decides to
// send on its own, which is where the harm was: a property contact got "Your
// home energy assessment is scheduled" about an insulation removal because a
// field got populated.
//
// This pins the other half — the sends a person starts from a screen. They are
// human-AUTHORED, but authored is not verified: the address is usually
// inherited from a record rather than typed, which is exactly how the wrong
// recipient was picked. The guard names the recipient back to the sender.
//
// The check that matters is the LAST one: it fails the build if any send path
// is added without the guard, so the rule is enforced by the build rather than
// by remembering.
//
// Run with:  node scripts/outbound-send-guard-fixture.mjs

import { readFileSync } from 'node:fs'
import { confirmOutboundSend, requireOutboundApproval, OutboundSendDeclined }
  from '../src/lib/outboundSendGuard.js'

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

// ── With nobody to ask, the answer is never "send" ─────────────────────────
// This runs with no window, which is the server/test case.
check('no window means no send', confirmOutboundSend({ to: 'a@b.com' }), false)
check('...and requireOutboundApproval throws rather than proceeding',
  (() => { try { requireOutboundApproval({ to: 'a@b.com' }); return 'sent' }
           catch (e) { return e.name } })(), 'OutboundSendDeclined')
check('the declined error is distinguishable from a failure',
  new OutboundSendDeclined().declined, true)

// ── A send with no recipient can never be approved ─────────────────────────
// It cannot be checked, so it cannot be confirmed.
const withWindow = (answer, fn) => {
  const had = 'window' in globalThis
  const prev = globalThis.window
  globalThis.window = { confirm: (msg) => { withWindow.lastMessage = msg; return answer } }
  try { return fn() } finally { if (had) globalThis.window = prev; else delete globalThis.window }
}
check('no recipient, no send', withWindow(true, () => confirmOutboundSend({ to: null })), false)
check('an empty recipient list, no send', withWindow(true, () => confirmOutboundSend({ to: [] })), false)
check('a list of blanks, no send', withWindow(true, () => confirmOutboundSend({ to: [null, ''] })), false)

// ── What the person is actually shown ──────────────────────────────────────
check('a confirmed send goes', withWindow(true, () =>
  confirmOutboundSend({ channel: 'email', to: 'josiah.brazle@lsswis.org' })), true)
check('a declined send does not', withWindow(false, () =>
  confirmOutboundSend({ channel: 'email', to: 'josiah.brazle@lsswis.org' })), false)

withWindow(true, () => confirmOutboundSend({
  channel: 'email', to: 'josiah.brazle@lsswis.org', subject: 'Your assessment', context: 'New email',
}))
const msg = withWindow.lastMessage
check('the RECIPIENT is named — the thing that was wrong last time',
  msg.includes('josiah.brazle@lsswis.org'), true)
check('the subject is shown', msg.includes('Your assessment'), true)
check('the context is shown', msg.includes('New email'), true)
check('the channel is named in words, not a code',
  msg.includes('Send this email to'), true)

withWindow(true, () => confirmOutboundSend({ channel: 'sms', to: '+15551234567' }))
check('a text is called a text message', withWindow.lastMessage.includes('text message'), true)

withWindow(true, () => confirmOutboundSend({ to: ['a@b.com', 'c@d.com', 'e@f.com'] }))
check('every recipient is listed, not just a count',
  ['a@b.com', 'c@d.com', 'e@f.com'].every(a => withWindow.lastMessage.includes(a)), true)
check('...and the count is stated too', withWindow.lastMessage.includes('3 recipients'), true)

// ── The build-enforced part ────────────────────────────────────────────────
// Every client call that invokes a customer-facing send function must be
// preceded by the guard. Adding a tenth send path without it fails here.
{
  const FILES = [
    'src/data/conversationsService.js',
    'src/data/serviceProviderService.js',
  ]
  const SEND_FUNCTIONS = ['send-email-v1', 'send-notification-sms']

  let sendCalls = 0
  let guarded = 0
  for (const f of FILES) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    for (const fn of SEND_FUNCTIONS) {
      const re = new RegExp(`functions\\.invoke\\('${fn}'`, 'g')
      let m
      while ((m = re.exec(src)) !== null) {
        sendCalls += 1
        // The guard must appear in the 600 characters before the call — i.e.
        // in the same function, ahead of the send.
        const before = src.slice(Math.max(0, m.index - 600), m.index)
        if (before.includes('requireOutboundApproval(')) guarded += 1
        else console.error(`FAIL  unguarded send in ${f} at offset ${m.index}`)
      }
    }
    if (src.includes('functions.invoke(') && !src.includes("from '../lib/outboundSendGuard'")) {
      failures += 1
      console.error(`FAIL  ${f} sends without importing the guard`)
    }
  }
  check('every customer-facing send path is guarded', guarded, sendCalls)
  check('...and there are send paths to guard (the check is not vacuous)',
    sendCalls >= 7, true)
}

console.log(failures === 0
  ? `outbound-send-guard fixture: ${checks} checks passed`
  : `outbound-send-guard fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
