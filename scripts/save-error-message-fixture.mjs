// Fixture test for what a failed save says to the person who made it.
//
// Nicholas, 2026-08-25, hitting Save As on a report: "it gave me a big error
// about duplicate." What reached the screen was the database's own words —
// `duplicate key value violates unique constraint
// "report_filters_rfilt_report_id_rfilt_filter_index_key"`. A constraint name
// is a fact about the schema, not something to hand a user.
//
// What this pins: each write failure LEAP can actually run into says what
// happened and what to do; the raw text is kept as `detail` rather than
// swallowed; and an error nobody has classified keeps its own message instead
// of being flattened into a useless "something went wrong".
//
// Run with:  node scripts/save-error-message-fixture.mjs

import { describeSaveError } from '../src/lib/saveErrorMessage.js'

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
const opts = { object: 'report' }

// ── The failure Nicholas hit ────────────────────────────────────────────────
const dupe = describeSaveError({
  code: '23505',
  message: 'duplicate key value violates unique constraint "report_filters_rfilt_report_id_rfilt_filter_index_key"',
}, opts)
check('a duplicate is classified as one', dupe.kind, 'duplicate')
check('the message says report, not a table name', dupe.message.includes('This report'), true)
check('the message never quotes the constraint', /constraint|rfilt_|_key/.test(dupe.message), false)
check('the message says what to do', dupe.message.includes('save again'), true)
check('the raw text is kept as detail', dupe.detail.includes('report_filters_rfilt_report_id_rfilt_filter_index_key'), true)

// ── The other write failures LEAP can actually produce ──────────────────────
check('a foreign key violation names the real problem',
  describeSaveError({ code: '23503', message: 'insert or update on table "reports" violates foreign key constraint' }, opts).kind,
  'reference')
check('a not-null violation is a missing field',
  describeSaveError({ code: '23502', message: 'null value in column "rpt_name" of relation "reports" violates not-null constraint' }, opts).kind,
  'required')
check('and it names the empty field',
  describeSaveError({ code: '23502', message: 'null value in column "rpt_name" of relation "reports" violates not-null constraint' }, opts)
    .message.includes('rpt_name'),
  true)
check('a check violation is an unacceptable value',
  describeSaveError({ code: '23514', message: 'new row violates check constraint "reports_rpt_format_check"' }, opts).kind,
  'invalid')
check('RLS refusal is a permission problem, not a bug',
  describeSaveError({ code: '42501', message: 'permission denied for table reports' }, opts).kind,
  'not_allowed')
check('and it says who to ask',
  describeSaveError({ code: '42501', message: 'permission denied' }, opts).message.includes('administrator'),
  true)
check('an expired session says the work is still on screen',
  describeSaveError({ code: 'PGRST301', message: 'JWT expired' }, opts).message.includes('still on screen'),
  true)
check('a value too long for its column',
  describeSaveError({ code: '22001', message: 'value too long for type character varying(60)' }, opts).kind, 'too_long')
check('a number out of range',
  describeSaveError({ code: '22003', message: 'numeric field overflow' }, opts).kind, 'out_of_range')

// ── No error code to go on ──────────────────────────────────────────────────
// A thrown Error (an RPC re-raise, a fetch failure) carries no PostgREST code.
check('a duplicate with no code is still recognised from its text',
  describeSaveError(new Error('duplicate key value violates unique constraint "x"'), opts).kind, 'duplicate')
check('row-level security wording is recognised',
  describeSaveError(new Error('new row violates row-level security policy for table "reports"'), opts).kind, 'not_allowed')
check('a network failure says the changes are still on screen',
  describeSaveError(new Error('Failed to fetch'), opts).kind, 'offline')
check('and so does Safari\'s wording for it',
  describeSaveError(new Error('Load failed'), opts).kind, 'offline')

// ── Never make an error LESS informative ────────────────────────────────────
const odd = describeSaveError(new Error('clone_report: source report 123 not found or deleted'), opts)
check('an unclassified error keeps its own message', odd.message, 'clone_report: source report 123 not found or deleted')
check('and is marked as unclassified', odd.kind, 'unknown')
check('an error with no message at all still says something',
  describeSaveError(null, opts).message, 'This report could not be saved.')
check('the object name is used verbatim',
  describeSaveError({ code: '23505', message: 'duplicate key' }, { object: 'dashboard' }).message.includes('This dashboard'), true)
check('with no object named it says record',
  describeSaveError({ code: '23505', message: 'duplicate key' }).message.includes('This record'), true)
check('details and hints are carried into detail',
  describeSaveError({ code: '23503', message: 'violates foreign key constraint', details: 'Key (rpt_folder_id)=(abc) is not present', hint: 'Pick a folder' }, opts).detail,
  'violates foreign key constraint — Key (rpt_folder_id)=(abc) is not present — Pick a folder')
check('no detail at all is said plainly',
  describeSaveError({ code: '23505', message: '' }, opts).detail, 'No further detail.')

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} FAILED`)
  process.exit(1)
}
