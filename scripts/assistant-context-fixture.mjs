// Fixture test for what the LEAP assistant is told about the user's screen.
//
// The rule this pins: a related-list screen — Contacts filtered to ONE account —
// carries its parent record's id and label in the URL, and that parent MUST
// reach the model. Run with
//   node scripts/assistant-context-fixture.mjs
//
// The case it is built from (Nicholas, 2026-08-26): standing on Community
// Management Corporation's own contact list, the assistant was handed
// {object:'contacts', record_id:null}, searched, missed, and replied "No
// account found for Community Management Corporation." The account's id was in
// the address bar the entire time.

import { buildAssistantContext, parseLeapReferences, contextForStorage } from '../src/lib/assistantContext.js'

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

const ORIGIN = 'https://leap.energyefficiencyservices.org'
const ACCOUNT_ID = '14ddfac7-488f-4fe8-8f3d-920f74d36cd3'
// The real token from the failing session: {"t":"contacts","fk":"contact_account_id",
// "via":null,"pid":"14ddfac7-…","lbl":"Community Management Corporation"}
const REL_TOKEN =
  'eyJ0IjoiY29udGFjdHMiLCJmayI6ImNvbnRhY3RfYWNjb3VudF9pZCIsInZpYSI6bnVsbCwicGlkIjoiMTRkZGZhYzctNDg4Zi00ZmU4LThmM2QtOTIwZjc0ZDM2Y2QzIiwibGJsIjoiQ29tbXVuaXR5IE1hbmFnZW1lbnQgQ29ycG9yYXRpb24ifQ'
const SCOPED_LIST_URL = `${ORIGIN}/m/enrollment/contacts?rel=${REL_TOKEN}`

const listScope = {
  table: 'contacts', fk: 'contact_account_id', via: null,
  parentId: ACCOUNT_ID, label: 'Community Management Corporation',
}

// ── The screen that broke ───────────────────────────────────────────────────
{
  const ctx = buildAssistantContext({
    selectedRecord: null, listTable: 'contacts', listScope,
    message: "Create this contact for Community Management Corporation. He's the owner.",
    origin: ORIGIN,
  })
  check('the object on screen is still reported', ctx.object, 'contacts')
  check('THE PARENT ACCOUNT IS REPORTED (this is the whole bug)',
    ctx.list_scope, { table: 'contacts', fk: 'contact_account_id', via: null, parent_id: ACCOUNT_ID, parent_label: 'Community Management Corporation' })
  check('no record is claimed open when none is', ctx.record_id, undefined)
}

// ── A scope for a different object is not this screen ───────────────────────
{
  const ctx = buildAssistantContext({
    listTable: 'properties',
    listScope: { table: 'contacts', fk: 'contact_account_id', parentId: ACCOUNT_ID, label: 'X' },
    origin: ORIGIN,
  })
  check('a stale scope for another object is dropped', ctx.list_scope, undefined)
  check('the listed object is still reported', ctx.object, 'properties')
}

// ── An open record still works exactly as before ────────────────────────────
{
  const ctx = buildAssistantContext({
    selectedRecord: { table: 'accounts', id: ACCOUNT_ID, name: 'Community Management Corporation' },
    listTable: 'contacts', origin: ORIGIN,
  })
  check('the open record wins over the list table', ctx.object, 'accounts')
  check('its id is passed', ctx.record_id, ACCOUNT_ID)
  check('its label is passed', ctx.record_label, 'Community Management Corporation')
}

// ── Nothing on screen means nothing claimed ─────────────────────────────────
check('an empty screen yields no context at all',
  buildAssistantContext({ origin: ORIGIN }), null)

// ── A pasted LEAP link is a record reference, not prose ─────────────────────
{
  const refs = parseLeapReferences(
    `You're on the account right now ${SCOPED_LIST_URL}`, ORIGIN)
  check('a pasted scoped-list URL decodes to its parent', refs.scopes.length, 1)
  check('…with the right parent id', refs.scopes[0].parentId, ACCOUNT_ID)
  check('…and the right label', refs.scopes[0].label, 'Community Management Corporation')
  check('…and it is not mistaken for a record link', refs.records.length, 0)
}
{
  const refs = parseLeapReferences(
    `see ${ORIGIN}/contacts/c39a2506-6e24-42ad-aab8-9c75d7f97a86.`, ORIGIN)
  check('a record URL decodes to table + id',
    refs.records.map(r => `${r.table}:${r.id}`), ['contacts:c39a2506-6e24-42ad-aab8-9c75d7f97a86'])
  check('trailing sentence punctuation is not part of the id', refs.records[0].id.endsWith('86'), true)
}
{
  const dupe = `${ORIGIN}/contacts/c39a2506-6e24-42ad-aab8-9c75d7f97a86`
  const refs = parseLeapReferences(`${dupe} and again ${dupe}`, ORIGIN)
  check('the same record linked twice is listed once', refs.records.length, 1)
}

// ── A link to somewhere else is never presented as a LEAP record ────────────
{
  const refs = parseLeapReferences(
    `https://example.com/contacts/c39a2506-6e24-42ad-aab8-9c75d7f97a86`, ORIGIN)
  check('a foreign origin is ignored', refs.records.length, 0)
}
check('plain prose yields no references',
  parseLeapReferences('create a contact for the owner', ORIGIN),
  { records: [], scopes: [] })
check('a non-string message is safe',
  parseLeapReferences(null, ORIGIN), { records: [], scopes: [] })

// ── Pasted references reach the context payload ─────────────────────────────
{
  const ctx = buildAssistantContext({
    listTable: 'contacts',
    message: `You're on the account right now ${SCOPED_LIST_URL}`,
    origin: ORIGIN,
  })
  check('a pasted scope becomes a referenced scope',
    ctx.referenced_scopes, [{ table: 'contacts', fk: 'contact_account_id', via: null, parent_id: ACCOUNT_ID, parent_label: 'Community Management Corporation' }])
}
{
  const ctx = buildAssistantContext({
    listTable: 'contacts',
    message: `link it to ${ORIGIN}/accounts/${ACCOUNT_ID}`,
    origin: ORIGIN,
  })
  check('a pasted record becomes a referenced record',
    ctx.referenced_records, [{ object: 'accounts', record_id: ACCOUNT_ID }])
}

// ── Multi-hop (via) scopes keep their chain ─────────────────────────────────
{
  const ctx = buildAssistantContext({
    listTable: 'units',
    listScope: {
      table: 'units', fk: 'building_id',
      via: [{ table: 'buildings', fk: 'property_id' }],
      parentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', label: '1837 Alden Rd',
    },
    origin: ORIGIN,
  })
  check('the via chain survives', ctx.list_scope.via, [{ table: 'buildings', fk: 'property_id' }])
  check('the parent is the property, by id', ctx.list_scope.parent_id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
}

// ── What gets persisted with the chat turn ──────────────────────────────────
{
  const ctx = buildAssistantContext({ listTable: 'contacts', listScope, origin: ORIGIN })
  check('the stored turn records where the user was',
    contextForStorage(ctx),
    { object: 'contacts', record_id: null, list_scope_parent_id: ACCOUNT_ID, list_scope_parent_label: 'Community Management Corporation' })
  check('no context stores as null', contextForStorage(null), null)
}

console.log(failures === 0
  ? `assistant-context fixture: ${checks} checks passed`
  : `assistant-context fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
