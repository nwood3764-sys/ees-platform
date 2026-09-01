// The Project-Reservation defaults exist in TWO places: the database trigger
// set_enrollment_reservation_defaults, and the create-form mirror in
// RecordDetail.jsx that shows them selected before the first save. Two copies
// of one list is what caused the defect this pins.
//
// A picklist value was renamed in Admin ('Multifamily - Central 5 Units' gained
// a '+'). Both copies still asked for the old spelling, both got null, and both
// assigned null — a lookup that finds nothing is indistinguishable from "no
// default configured", so nothing failed and the field simply stopped filling
// in. find_unresolvable_reservation_defaults() catches a value that stops
// resolving against live data; this catches the two copies disagreeing.

import fs from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
const ok = (label, cond, detail) => {
  if (cond) { pass += 1; return }
  fail += 1
  console.error(`  FAIL ${label}${detail ? `\n    ${detail}` : ''}`)
}

const ROOT = path.resolve(import.meta.dirname, '..')
const jsx = fs.readFileSync(path.join(ROOT, 'src/components/RecordDetail.jsx'), 'utf8')

// The most recent migration that (re)defines the trigger is the live one.
const migDir = path.join(ROOT, 'supabase/migrations')
const trigMig = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort().reverse()
  .find(f => fs.readFileSync(path.join(migDir, f), 'utf8')
    .includes('FUNCTION public.set_enrollment_reservation_defaults()'))
ok('a migration defines set_enrollment_reservation_defaults', !!trigMig)
const sql = fs.readFileSync(path.join(migDir, trigMig), 'utf8')
// Only the trigger body, not the backfill below it.
const body = sql.slice(sql.indexOf('FUNCTION public.set_enrollment_reservation_defaults()'),
                       sql.indexOf('FUNCTION public.find_unresolvable_reservation_defaults()'))

const trigPicklists = new Map()
for (const m of body.matchAll(/picklist_field\s*=\s*'([^']+)'\s+AND\s+picklist_value\s*=\s*'([^']+)'/g)) {
  if (!trigPicklists.has(m[1])) trigPicklists.set(m[1], new Set())
  trigPicklists.get(m[1]).add(m[2])
}
const trigAccounts = new Set([...body.matchAll(/account_name\s*=\s*'([^']+)'/g)].map(m => m[1]))
const trigEmails   = new Set([...body.matchAll(/user_email\s*=\s*'([^']+)'/g)].map(m => m[1]))

ok('the trigger names picklist defaults', trigPicklists.size >= 5, `found ${trigPicklists.size}`)
ok('the trigger names both contractor accounts', trigAccounts.size === 2, [...trigAccounts].join(' | '))
ok('the trigger names the submitter by email', trigEmails.size === 1, [...trigEmails].join(' | '))

// The client mirror's own literals.
const seedBlock = jsx.slice(jsx.indexOf('const seedReservationDefaultsOnCreate'),
                            jsx.indexOf('// Create mode: fetch layout + picklists only'))
ok('the create-form mirror is present', seedBlock.length > 200)

const cliPicklists = [...seedBlock.matchAll(/pv\('([^']+)',\s*'([^']+)'\)/g)].map(m => [m[1], m[2]])
const cliAccounts  = [...seedBlock.matchAll(/acct\('([^']+)'\)/g)].map(m => m[1])
const cliEmails    = [...seedBlock.matchAll(/submitter\('([^']+)'\)/g)].map(m => m[1])

ok('the mirror seeds picklist values', cliPicklists.length >= 4, `found ${cliPicklists.length}`)

// EVERY literal the mirror uses must be one the trigger uses. The mirror may
// cover fewer fields, but it must never name a value the database does not.
for (const [field, value] of cliPicklists) {
  ok(`mirror picklist ${field}='${value}' matches the trigger`,
    trigPicklists.get(field)?.has(value) === true,
    `trigger has ${field}=${[...(trigPicklists.get(field) || [])].map(v => `'${v}'`).join(', ') || '(nothing)'}`)
}
for (const name of cliAccounts) {
  ok(`mirror account '${name}' matches the trigger`, trigAccounts.has(name))
}
for (const email of cliEmails) {
  ok(`mirror submitter '${email}' matches the trigger`, trigEmails.has(email))
}

// The two defaults this session added must be in BOTH copies, or the create
// form shows blank and the record saves filled — the mismatch a user reads as
// "it isn't populating".
ok('modeling software defaults to Energy Plus in the trigger',
  trigPicklists.get('modeling_software')?.has('Energy Plus') === true)
ok('modeling software defaults to Energy Plus in the mirror',
  cliPicklists.some(([f, v]) => f === 'modeling_software' && v === 'Energy Plus'))
ok('the submitter default is in the trigger', trigEmails.has('lucas.wood@ees-wi.org'))
ok('the submitter default is in the mirror', cliEmails.includes('lucas.wood@ees-wi.org'))

// Positive control: the renamed spelling that caused the defect must be gone
// from both copies. Without this the fixture would pass on the broken code,
// since the two copies agreed with each other while agreeing with nothing real.
const STALE = 'Multifamily - Central 5 Units'
const staleInTrigger = new RegExp(`picklist_value\\s*=\\s*'${STALE}'`).test(body)
const staleInMirror  = new RegExp(`pv\\('building_project_type',\\s*'${STALE}'\\)`).test(seedBlock)
ok('the stale building-project-type spelling is gone from the trigger', !staleInTrigger)
ok('the stale building-project-type spelling is gone from the mirror', !staleInMirror)
ok('both copies now name the + spelling',
  trigPicklists.get('building_project_type')?.has('Multifamily - Central 5+ Units') === true &&
  cliPicklists.some(([f, v]) => f === 'building_project_type' && v === 'Multifamily - Central 5+ Units'))

// pg_proc.prosrc holds only the function BODY — the SET clause lives in
// proconfig — so rebuilding this trigger from prosrc alone silently drops its
// search_path and the advisors report function_search_path_mutable. That
// happened once while writing this migration; the check makes it loud.
ok('the trigger declares a fixed search_path',
  /CREATE OR REPLACE FUNCTION public\.set_enrollment_reservation_defaults\(\)[\s\S]{0,200}?SET search_path/.test(sql))

// The guard itself must ship with the trigger, and must read the trigger's
// source rather than repeating the list — a second list is the bug.
ok('the guard function ships in the same migration',
  sql.includes('FUNCTION public.find_unresolvable_reservation_defaults()'))
ok('the guard reads the trigger source instead of repeating the list',
  /prosrc/.test(sql) && /proname\s*=\s*'set_enrollment_reservation_defaults'/.test(sql))
ok('the migration fails if anything is unresolvable',
  /RAISE EXCEPTION 'Reservation defaults still name values that do not resolve/.test(sql))

console.log(`reservation-defaults: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
