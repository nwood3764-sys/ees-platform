// =============================================================================
// signature-request-template-fixture — the wording of a signature request is
// data, and substituting into it cannot break the email or the send.
//
// Nicholas, 2026-09-05, on the email a property owner received: "where do I
// adjust this email template ... is this a template, or do we just change the
// wording directly? I need to know." It was neither — the message was composed
// in the edge function's source, so a sentence was a deploy.
//
// Three things must hold, and each has a way of going wrong that reaches a
// customer:
//
//   1. A VALUE CANNOT BREAK THE HTML. Values come off records; a property
//      called `Smith & Sons <Holdings>` must not close a tag. The template
//      body is trusted (an admin wrote it, it IS html); the values are not.
//   2. AN UNSUPPLIED TOKEN RENDERS EMPTY, never `{{...}}`. Raw braces in a
//      customer's inbox read as a broken system.
//   3. A DRAFT NEVER SENDS, AND A MISSING TEMPLATE NEVER BLOCKS. The failure
//      direction is always "send in the built-in words" — the whole reason
//      this workstream exists is a signing request that read Sent and
//      delivered nothing.
//
// Node 20 compatible on purpose: netlify.toml pins NODE_VERSION = 20, which
// cannot import a .ts module, so the rules live in a plain .js file.
// =============================================================================

import {
  SIGNATURE_REQUEST_TEMPLATE_NAME,
  escapeHtml,
  renderTemplate,
  signatureRequestTokens,
  templateUsability,
} from '../supabase/functions/send-envelope/emailTemplate.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (n, ok) => { ok ? (pass++, console.log(`PASS  ${n}`)) : (fail++, console.log(`FAIL  ${n}`)) }

// ── 1. A value cannot break the html ───────────────────────────────────────
const nasty = 'Smith & Sons <Holdings> "LLC" \'x\''
check('& is escaped',  escapeHtml(nasty).includes('&amp;'))
check('< is escaped',  !escapeHtml(nasty).includes('<'))
check('> is escaped',  !escapeHtml(nasty).includes('>'))
check('" is escaped',  !escapeHtml(nasty).includes('"'))
check("' is escaped",  !escapeHtml(nasty).includes("'"))
check('null escapes to empty, not the word null', escapeHtml(null) === '')
check('undefined escapes to empty',              escapeHtml(undefined) === '')

const injected = renderTemplate(
  '<p>Hi {{recipient.first_name}}, about {{record.name}}.</p>',
  signatureRequestTokens({ recipientName: 'Dennis Hanson', recordLabel: '</p><script>alert(1)</script>' }),
).text
check('a value carrying markup cannot open a tag', !injected.includes('<script'))
check('the template\'s own markup is left alone',  injected.startsWith('<p>Hi Dennis,'))

// ── 2. An unsupplied token renders empty, never braces ─────────────────────
const partial = renderTemplate('A {{record.name}} B {{nothing.here}} C', { 'record.name': 'X' })
check('a supplied token substitutes',          partial.text.includes('A X B'))
check('an unsupplied token renders empty',     partial.text === 'A X B  C')
check('no braces survive into the email',      !partial.text.includes('{{'))
check('the missing token is reported by name', partial.missing.includes('nothing.here'))
check('a supplied token is not reported missing', !partial.missing.includes('record.name'))

check('whitespace inside the braces is tolerated',
  renderTemplate('{{ record.name }}', { 'record.name': 'X' }).text === 'X')
check('a token is reported once however often it appears',
  renderTemplate('{{a}}{{a}}{{a}}', {}).missing.length === 1)
check('a template with no tokens is returned unchanged',
  renderTemplate('<p>Plain</p>', {}).text === '<p>Plain</p>')
check('an empty template renders empty, not a crash',
  renderTemplate('', {}).text === '' && renderTemplate(null, {}).text === '')

// The plain-text alternative must NOT be html-escaped — an ampersand in a URL
// or a name would otherwise print as &amp; in a text email.
check('raw mode does not escape',
  renderTemplate('{{u}}', { u: 'https://x/y?a=1&b=2' }, { raw: true }).text === 'https://x/y?a=1&b=2')
check('html mode DOES escape the same value',
  renderTemplate('{{u}}', { u: 'https://x/y?a=1&b=2' }).text.includes('&amp;'))

// ── The token map is built from what the pipeline actually holds ───────────
const t = signatureRequestTokens({
  recipientName: 'Dennis Hanson',
  senderName:    'Nicholas Wood',
  documentName:  'IRA Multifamily HEAR Proposal',
  recordLabel:   '570 Clark Street - Wisconsin IRA Multifamily Income Qualification',
  recordNumber:  'ENR-00077',
  signingUrl:    'https://leap.energyefficiencyservices.org/sign/ENV-00016/abc',
})
check('first name is the first word',        t['recipient.first_name'] === 'Dennis')
check('full name is kept too',               t['recipient.name'] === 'Dennis Hanson')
check('the record name is available',        t['record.name'].startsWith('570 Clark Street'))
check('the record number is available',      t['record.number'] === 'ENR-00077')
check('the signing url is available',        t['signing_url'].includes('/sign/'))
check('the company defaults to EES',         t['company.name'] === 'Energy Efficiency Services')
check('a one-word name is its own first name',
  signatureRequestTokens({ recipientName: 'Cher' })['recipient.first_name'] === 'Cher')
check('an empty name does not produce undefined',
  signatureRequestTokens({})['recipient.first_name'] === '')
check('a name with extra spaces still resolves',
  signatureRequestTokens({ recipientName: '  Dennis   Hanson ' })['recipient.first_name'] === 'Dennis')

// The company name must never be the forbidden platform-era word.
check('the company token is never the retired name',
  !/anura/i.test(t['company.name']))

// ── 3. A draft never sends; a missing template never blocks ────────────────
const good = { body_html: '<p>x</p>', is_deleted: false }
check('an Active template with a body is usable',     templateUsability(good, 'Active').usable === true)
check('a Draft template is refused',                  templateUsability(good, 'Draft').usable === false)
check('an Archived template is refused',              templateUsability(good, 'Archived').usable === false)
check('the refusal names the status',                 /Draft/.test(templateUsability(good, 'Draft').reason))
check('a deleted template is refused',                templateUsability({ ...good, is_deleted: true }, 'Active').usable === false)
check('a template with no body is refused',           templateUsability({ body_html: '', is_deleted: false }, 'Active').usable === false)
check('a template with a whitespace body is refused', templateUsability({ body_html: '   \n ', is_deleted: false }, 'Active').usable === false)
check('no row at all is refused, by name',            /no template row/.test(templateUsability(null, null).reason))
check('a usable template carries no reason',          templateUsability(good, 'Active').reason === null)

// ── The edge function actually behaves this way ────────────────────────────
const fn = readFileSync(new URL('../supabase/functions/send-envelope/index.ts', import.meta.url), 'utf8')
check('send-envelope imports the shared rules',
  /from "\.\/emailTemplate\.js"/.test(fn))
check('the shared module is .js, so Node 20 can run this fixture',
  /emailTemplate\.js/.test(fn) && !/emailTemplate\.ts/.test(fn))
check('a missing template falls back to the built-in wording, it does not throw',
  /renderEmailHtml\(\{/.test(fn) && /built-in \(\$\{usable\.reason\}\)/.test(fn))
check('a subject the sender typed still wins over the template',
  /subject: body\.subject \|\| wording\.subject \|\| subject/.test(fn))
check('a message the sender typed still wins over the template',
  /body\.message\n?\s*\/\//.test(fn) || /\? renderEmailHtml\(\{/.test(fn))
check('the template is looked up by name, never by a seeded id',
  /\.eq\("name", SIGNATURE_REQUEST_TEMPLATE_NAME\)/.test(fn))
check('the record label is resolved through email_log_target, not a new query',
  /rpc\("email_log_target"/.test(fn))
check('losing the record label cannot lose the send',
  /catch \(_e\) \{[\s\S]{0,400}Not fatal/.test(fn))
check('the template name constant is a single definition',
  SIGNATURE_REQUEST_TEMPLATE_NAME === 'Signature Request')

console.log(`signature-request-template-fixture: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
if (fail) process.exit(1)
