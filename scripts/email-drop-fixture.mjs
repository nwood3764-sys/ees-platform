// Fixture test for filing a dropped email.
//
// Nicholas, 2026-08-25: "I need to be able to drag over an email and add it to
// a contact record or an account in the Conversations tab, and it logs it
// correctly by reading who's involved."
//
// "Who's involved" is only as good as the parse, so this pins the parse — and
// pins the .msg path by BUILDING a real OLE2 compound file in memory and
// reading it back. Reading the format spec is not proof that the reader works;
// a byte stream it has to walk is.
//
//   node scripts/email-drop-fixture.mjs

import {
  parseAddressList, decodeMimeWords, parseEmlText, parseDraggedText,
  normalizeParsedEmail, participantAddresses, parsedEmailBlockers,
  isEmailAddress, emailFileKind, parseEmailDate,
} from '../src/lib/emailMessageParse.js'
import { parseOutlookMsg, isCompoundFile } from '../src/lib/outlookMsgParse.js'
import {
  buildCompoundFile, propertiesStream, isoToFileTime, substg, strProp, ascii,
} from './lib/outlookMsgFixtureFile.mjs'

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
function checkTrue(label, actual) { check(label, !!actual, true) }

// ── Address lists ───────────────────────────────────────────────────────────
// The comma inside a quoted display name is the case that turns one person
// into two and files the email against a contact who was never on it.
check('address: quoted comma in a display name stays one person',
  parseAddressList('"Wood, Nicholas" <nicholas.wood@ees-wi.org>, jane@westminstercompany.com'),
  [{ name: 'Wood, Nicholas', address: 'nicholas.wood@ees-wi.org' },
   { name: '', address: 'jane@westminstercompany.com' }])

check('address: bare address with no display name',
  parseAddressList('ira@ees-wi.org'), [{ name: '', address: 'ira@ees-wi.org' }])

check('address: semicolon separator (Outlook writes these)',
  parseAddressList('a@x.com; b@y.com').map(p => p.address), ['a@x.com', 'b@y.com'])

check('address: the same address twice collapses to one',
  parseAddressList('Jane <j@x.com>, jane <J@X.com>').length, 1)

check('address: an Outlook X.500 path is not an address',
  parseAddressList('/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP/CN=RECIPIENTS/CN=abc'), [])

check('address: a sentence in the To line yields nobody',
  parseAddressList('Undisclosed recipients'), [])

check('address: mailto: prefix stripped',
  parseAddressList('<mailto:x@y.com>'), [{ name: '', address: 'x@y.com' }])

check('isEmailAddress rejects a value with no dot in the domain',
  isEmailAddress('nick@localhost'), false)
check('isEmailAddress rejects an unresolved angle bracket',
  isEmailAddress('<a@b.com'), false)
check('isEmailAddress accepts a plus-addressed mailbox',
  isEmailAddress('nick+leap@ees-wi.org'), true)

// ── RFC 2047 ────────────────────────────────────────────────────────────────
check('mime words: base64 display name decodes',
  decodeMimeWords('=?utf-8?B?SmFuZSBIZW5kZXJzb24=?= <j@x.com>'), 'Jane Henderson <j@x.com>')
check('mime words: quoted-printable underscore is a space',
  decodeMimeWords('=?utf-8?Q?Jane_Henderson?='), 'Jane Henderson')
check('mime words: adjacent encoded words join without the folding space',
  decodeMimeWords('=?utf-8?Q?Jane?= =?utf-8?Q?_Henderson?='), 'Jane Henderson')
check('mime words: plain text is untouched',
  decodeMimeWords('Jane Henderson'), 'Jane Henderson')

// ── .eml ────────────────────────────────────────────────────────────────────
const EML = [
  'Return-Path: <JHenderson@westminstercompany.com>',
  'Message-ID:',
  ' <AAMkAGI2@westminstercompany.com>',
  'Date: Tue, 11 Aug 2026 09:32:14 -0500',
  'From: =?utf-8?B?SmFuZSBIZW5kZXJzb24=?= <JHenderson@westminstercompany.com>',
  'To: "WI IRA Correspondence" <ira@ees-wi.org>, "Wood, Nicholas"',
  ' <nicholas.wood@ees-wi.org>',
  'Cc: assistant@westminstercompany.com, ira@ees-wi.org',
  'Subject: =?utf-8?Q?RE=3A_Multifamily_audit_scheduling?=',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="_000_bound_"',
  '',
  '--_000_bound_',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Following up on the audit dates for 931 Tessie Street =E2=80=94 the 18th w=',
  'orks for us.',
  '',
  '--_000_bound_',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<p>Following up on the audit dates.</p>',
  '',
  '--_000_bound_--',
  '',
].join('\r\n')

const eml = parseEmlText(EML, { fileName: 'RE Multifamily audit scheduling.eml' })
check('eml: sender address', eml.from.address, 'JHenderson@westminstercompany.com')
check('eml: sender display name decoded', eml.from.name, 'Jane Henderson')
check('eml: subject decoded', eml.subject, 'RE: Multifamily audit scheduling')
check('eml: folded To header read as two people',
  eml.to.map(p => p.address), ['ira@ees-wi.org', 'nicholas.wood@ees-wi.org'])
check('eml: an address on both To and Cc counts once, as a To',
  eml.cc.map(p => p.address), ['assistant@westminstercompany.com'])
check('eml: folded Message-ID', eml.internetMessageId, '<AAMkAGI2@westminstercompany.com>')
check('eml: Date parsed to an instant', eml.sentAt, '2026-08-11T14:32:14.000Z')
check('eml: html alternative is what gets stored',
  eml.bodyHtml.trim(), '<p>Following up on the audit dates.</p>')
checkTrue('eml: quoted-printable soft break rejoined in the text alternative',
  eml.bodyText.includes('the 18th works for us'))
checkTrue('eml: quoted-printable UTF-8 em dash decoded',
  eml.bodyText.includes('—'))
check('eml: no blockers', parsedEmailBlockers(eml), [])
check('eml: every address, sender first',
  participantAddresses(eml),
  ['JHenderson@westminstercompany.com', 'ira@ees-wi.org',
   'nicholas.wood@ees-wi.org', 'assistant@westminstercompany.com'])

// A single-part message still has to produce a body.
const SIMPLE = 'From: a@b.com\r\nTo: c@d.com\r\nSubject: Hi\r\n\r\nJust checking in.\r\n'
const simple = parseEmlText(SIMPLE)
check('eml: single-part body', simple.bodyText.trim(), 'Just checking in.')
checkTrue('eml: a missing Date is a warning, not a failure',
  simple.warnings.some(w => w.includes('Date')))
check('eml: a missing Date leaves sentAt null so the server can decide', simple.sentAt, null)

// An attachment part must not become the body.
const WITH_ATTACHMENT = [
  'From: a@b.com', 'To: c@d.com', 'Subject: Invoice',
  'Content-Type: multipart/mixed; boundary="B"', '',
  '--B', 'Content-Type: text/plain', '', 'See attached.', '',
  '--B', 'Content-Type: text/plain; name="notes.txt"',
  'Content-Disposition: attachment; filename="notes.txt"', '',
  'THIS IS THE ATTACHMENT', '', '--B--', '',
].join('\r\n')
check('eml: an attached text file is not the body',
  parseEmlText(WITH_ATTACHMENT).bodyText.trim(), 'See attached.')

// A message with no sender cannot be attributed to anyone.
const NO_SENDER = parseEmlText('To: c@d.com\r\nSubject: Orphan\r\n\r\nbody\r\n')
checkTrue('eml: no sender is a blocker',
  parsedEmailBlockers(NO_SENDER).some(b => b.includes('sender')))

check('date: a trailing timezone comment does not defeat the parse',
  parseEmailDate('Tue, 11 Aug 2026 09:32:14 -0500 (CDT)'), '2026-08-11T14:32:14.000Z')
check('date: unparseable input is null, never today', parseEmailDate('sometime last week'), null)

// ── Drags that carried no file ──────────────────────────────────────────────
const DRAG_TEXT = [
  'From: Jane Henderson <JHenderson@westminstercompany.com>',
  'Sent: Tuesday, August 11, 2026 9:32 AM',
  'To: WI IRA Correspondence <ira@ees-wi.org>',
  'Cc: assistant@westminstercompany.com',
  'Subject: RE: Multifamily audit scheduling',
  '',
  'Following up on the audit dates.',
].join('\n')
const dragged = parseDraggedText(DRAG_TEXT)
check('dragged text: sender read', dragged.from.address, 'JHenderson@westminstercompany.com')
check('dragged text: recipients read', dragged.to.map(p => p.address), ['ira@ees-wi.org'])
check('dragged text: subject read', dragged.subject, 'RE: Multifamily audit scheduling')
check('dragged text: source is recorded honestly', dragged.source, 'dragged_text')
checkTrue('dragged text: warns there is no Message-ID to dedupe on',
  dragged.warnings.some(w => w.includes('Message-ID')))
check('dragged text: a note with no From line is not an email',
  parseDraggedText('Call Jane back about the audit'), null)
check('dragged text: empty drag is not an email', parseDraggedText(''), null)

// ── Normalization ───────────────────────────────────────────────────────────
const norm = normalizeParsedEmail({
  from: { name: '  Jane  ', address: 'j@x.com' },
  to: ['a@x.com', { name: 'B', address: 'b@x.com' }, { address: 'not-an-address' }, { address: 'a@x.com' }],
  cc: [{ address: 'b@x.com' }, { address: 'c@x.com' }],
  subject: '  RE:   spaced   out  ',
  internetMessageId: 'bare-id@x.com',
})
check('normalize: string recipients accepted', norm.to.map(p => p.address), ['a@x.com', 'b@x.com'])
check('normalize: a Cc who is also a To is dropped from Cc', norm.cc.map(p => p.address), ['c@x.com'])
check('normalize: subject whitespace collapsed', norm.subject, 'RE: spaced out')
check('normalize: Message-ID gains its angle brackets', norm.internetMessageId, '<bare-id@x.com>')
check('normalize: sender name trimmed', norm.from.name, 'Jane')

// ── File routing ────────────────────────────────────────────────────────────
check('routing: .msg by name', emailFileKind({ name: 'note.msg', type: '' }), 'msg')
check('routing: .msg by Outlook mime type',
  emailFileKind({ name: 'virtual', type: 'application/vnd.ms-outlook' }), 'msg')
check('routing: .eml by name', emailFileKind({ name: 'note.eml', type: '' }), 'eml')
check('routing: message/rfc822', emailFileKind({ name: 'x', type: 'message/rfc822' }), 'eml')
check('routing: a photo is not an email', emailFileKind({ name: 'attic.jpg', type: 'image/jpeg' }), null)
check('routing: a PDF is not an email', emailFileKind({ name: 'report.pdf', type: 'application/pdf' }), null)

// ═══════════════════════════════════════════════════════════════════════════
// Outlook .msg — build a real compound file, then read it back.
// ═══════════════════════════════════════════════════════════════════════════


const submit = isoToFileTime('2026-08-11T14:32:14.000Z')
const MSG_BUFFER = buildCompoundFile([
  strProp('0037', 'RE: Multifamily audit scheduling'),
  strProp('1000', 'Following up on the audit dates.'),
  substg('1013', '0102', ascii('<p>Following up on the audit dates.</p>')),
  strProp('0C1A', 'Jane Henderson'),
  strProp('0C1F', '/O=EXCHANGELABS/OU=EAG/CN=RECIPIENTS/CN=JHENDERSON'),
  strProp('5D01', 'JHenderson@westminstercompany.com'),
  strProp('007D', [
    'Message-ID: <AAMkAGI2@westminstercompany.com>',
    'Date: Tue, 11 Aug 2026 09:32:14 -0500',
    'From: Jane Henderson <JHenderson@westminstercompany.com>',
    'To: WI IRA Correspondence <ira@ees-wi.org>',
    'Cc: assistant@westminstercompany.com',
  ].join('\r\n')),
  {
    name: '__recip_version1.0_#00000000',
    type: 'storage',
    children: [
      strProp('3001', 'WI IRA Correspondence'),
      strProp('3002', 'SMTP'),
      strProp('39FE', 'ira@ees-wi.org'),
      { name: '__properties_version1.0', type: 'stream', data: propertiesStream(8, [{ id: 0x0c15, type: 0x0003, lo: 1 }]) },
    ],
  },
  {
    name: '__recip_version1.0_#00000001',
    type: 'storage',
    children: [
      strProp('3001', 'Nicholas Wood'),
      strProp('3002', 'SMTP'),
      strProp('39FE', 'nicholas.wood@ees-wi.org'),
      { name: '__properties_version1.0', type: 'stream', data: propertiesStream(8, [{ id: 0x0c15, type: 0x0003, lo: 2 }]) },
    ],
  },
  {
    name: '__recip_version1.0_#00000002',
    type: 'storage',
    children: [
      strProp('3001', 'Quiet Auditor'),
      strProp('3002', 'SMTP'),
      strProp('39FE', 'bcc@westminstercompany.com'),
      { name: '__properties_version1.0', type: 'stream', data: propertiesStream(8, [{ id: 0x0c15, type: 0x0003, lo: 3 }]) },
    ],
  },
  { name: '__properties_version1.0', type: 'stream',
    data: propertiesStream(32, [{ id: 0x0039, type: 0x0040, lo: submit.lo, hi: submit.hi }]) },
])

checkTrue('msg: the built file has a compound-file signature', isCompoundFile(MSG_BUFFER))
const msg = parseOutlookMsg(MSG_BUFFER, { fileName: 'RE Multifamily audit scheduling.msg' })
check('msg: subject', msg.subject, 'RE: Multifamily audit scheduling')
check('msg: sender takes the SMTP property, not the X.500 path',
  msg.from.address, 'JHenderson@westminstercompany.com')
check('msg: sender display name', msg.from.name, 'Jane Henderson')
check('msg: To recipient from its own storage', msg.to.map(p => p.address), ['ira@ees-wi.org'])
// The Cc list is the UNION of both sources: Nicholas comes from the recipient
// storage (type 2 = Cc) and the assistant only from the transport headers. A
// reader that trusted one source would drop one of them.
check('msg: Cc is the union of the recipient storages and the transport headers',
  msg.cc.map(p => p.address),
  ['nicholas.wood@ees-wi.org', 'assistant@westminstercompany.com'])
checkTrue('msg: a Bcc recipient is not filed as a participant',
  !participantAddresses(msg).some(a => a.startsWith('bcc@')))
check('msg: send time from PR_CLIENT_SUBMIT_TIME', msg.sentAt, '2026-08-11T14:32:14.000Z')
check('msg: Message-ID from the transport headers',
  msg.internetMessageId, '<AAMkAGI2@westminstercompany.com>')
check('msg: HTML body', msg.bodyHtml, '<p>Following up on the audit dates.</p>')
check('msg: plain body', msg.bodyText, 'Following up on the audit dates.')
check('msg: source recorded', msg.source, 'outlook_msg_file')
check('msg: no blockers', parsedEmailBlockers(msg), [])

// A SENT item: no transport headers at all, so the recipient storages are the
// only record of who it went to.
const SENT_BUFFER = buildCompoundFile([
  strProp('0037', 'RE: Multifamily audit scheduling'),
  strProp('1000', 'Dates confirmed for the 18th.'),
  strProp('0C1A', 'WI IRA Correspondence'),
  strProp('5D01', 'ira@ees-wi.org'),
  {
    name: '__recip_version1.0_#00000000',
    type: 'storage',
    children: [
      strProp('3001', 'Jane Henderson'),
      strProp('3002', 'SMTP'),
      strProp('3003', 'JHenderson@westminstercompany.com'),
      { name: '__properties_version1.0', type: 'stream', data: propertiesStream(8, [{ id: 0x0c15, type: 0x0003, lo: 1 }]) },
    ],
  },
  { name: '__properties_version1.0', type: 'stream',
    data: propertiesStream(32, [{ id: 0x0039, type: 0x0040, lo: submit.lo, hi: submit.hi }]) },
])
const sent = parseOutlookMsg(SENT_BUFFER, { fileName: 'sent.msg' })
check('msg (sent item): sender is our mailbox', sent.from.address, 'ira@ees-wi.org')
check('msg (sent item): recipient survives with no transport headers',
  sent.to.map(p => p.address), ['JHenderson@westminstercompany.com'])
check('msg (sent item): no Message-ID is honest, not invented', sent.internetMessageId, '')

// A file that is not a compound file must fail loudly rather than half-parse.
let threw = false
try { parseOutlookMsg(new Uint8Array(1024).buffer, { fileName: 'x.msg' }) } catch { threw = true }
checkTrue('msg: a file that is not an Outlook message throws', threw)

// ── Result ──────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\n${failures} of ${checks} checks failed.`)
  process.exit(1)
}
console.log(`email-drop-fixture: ${checks} checks passed.`)
