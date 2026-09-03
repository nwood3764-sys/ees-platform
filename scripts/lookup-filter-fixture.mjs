// Fixture: a lookup offers only the people who can actually hold the field.
//
// Nicholas, 2026-09-02, creating an Insulation Removal work order: "there's a
// whole bunch of people under the assigned technician that aren't technicians.
// Only technicians and people that can get work orders, like our users, should
// show up under the assigned technician picklist."
//
// assigned_technician_id is an FK to public.users and always has been, so the
// picker was never offering contacts. It was offering EVERY user, because
// fetchLookupOptions selects the target table with no filter beyond its
// soft-delete column — on production that is 13 people including three Admins,
// a Program Manager and an Operations Manager, none of whom take a work order.
//
// The scope is a declared property of the FIELD (field_metadata.fm_lookup_
// filter), not a hardcoded list in the client and not an edit to each of the
// ten work-order layouts that carry the column.
//
// Run with:  node scripts/lookup-filter-fixture.mjs

import { readFileSync } from 'node:fs'

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

// ── The real production user list, verbatim ────────────────────────────────
const USERS = [
  { name: 'Brittin Wood',   role: 'Admin',                  user_is_field_technician: true,  user_is_active: true },
  { name: 'Lucas Wood',     role: 'Admin',                  user_is_field_technician: true,  user_is_active: true },
  { name: 'Nicholas Wood',  role: 'Admin',                  user_is_field_technician: true,  user_is_active: true },
  { name: 'Alexis Williams',role: 'Lead Technician',        user_is_field_technician: true,  user_is_active: true },
  { name: 'Frog Wood',      role: 'Lead Technician',        user_is_field_technician: true,  user_is_active: true },
  { name: 'Logan Wood',     role: 'Project Site Lead',      user_is_field_technician: true,  user_is_active: true },
  { name: 'Roman Rufino',   role: 'Project Site Lead',      user_is_field_technician: true,  user_is_active: true },
  { name: 'Javier Martinez',role: 'Team Lead',              user_is_field_technician: true,  user_is_active: true },
  { name: 'Kenji Chen',     role: 'Team Lead',              user_is_field_technician: true,  user_is_active: true },
  { name: 'Daniel Okonkwo', role: 'Technician in Training', user_is_field_technician: true,  user_is_active: true },
  { name: 'Nicholas Wood (legacy)', role: 'Admin',          user_is_field_technician: false, user_is_active: true },
  { name: 'James',          role: 'Operations Manager',     user_is_field_technician: false, user_is_active: true },
  { name: 'Keegan Byrnes',  role: 'Program Manager',        user_is_field_technician: false, user_is_active: true },
]

// The filter the migration stores, applied the way fetchLookupOptions applies
// it: every key an equality match, on top of the soft-delete filter.
const FILTER = { user_is_field_technician: true, user_is_active: true }
const applyFilter = (rows, filter) =>
  !filter ? rows
    : rows.filter(r => Object.entries(filter).every(([k, v]) => r[k] === v))

// ── What the picker offers ─────────────────────────────────────────────────
{
  const offered = applyFilter(USERS, FILTER)
  check('the picker narrows to the field technicians', offered.length, 10)
  check('CONTROL: with no filter it offers every user, which is the bug',
    applyFilter(USERS, null).length, 13)

  const names = offered.map(u => u.name)
  check('the three who do not take work orders are gone',
    ['Keegan Byrnes', 'James', 'Nicholas Wood (legacy)'].filter(n => names.includes(n)), [])
  check('Roman is offered', names.includes('Roman Rufino'), true)
  check('Logan is offered', names.includes('Logan Wood'), true)

  // The flag is a JOB FACT, not a role. An Admin who carries a work order is
  // still a technician; deriving this from the role would drop three people.
  check('an Admin who is flagged as a field technician IS offered',
    names.includes('Brittin Wood'), true)
  const byRole = USERS.filter(u => /Technician|Team Lead|Site Lead/.test(u.role))
  check('CONTROL: deriving it from the role instead loses the working Admins',
    byRole.length, 7)
  check('...which is fewer than the stored fact gives', byRole.length < offered.length, true)

  // Every offered person must be able to sign in and be given work.
  check('nobody inactive is ever offered',
    offered.every(u => u.user_is_active), true)
  // And the picker must not be empty — an unfillable field is worse than a
  // long one.
  check('the picker is not empty', offered.length > 0, true)
}

// ── The filter application itself ──────────────────────────────────────────
{
  check('an absent filter changes nothing', applyFilter(USERS, null).length, USERS.length)
  check('an empty filter changes nothing', applyFilter(USERS, {}).length, USERS.length)
  check('a filter naming a column no row has yields nothing, and says so plainly',
    applyFilter(USERS, { not_a_column: true }).length, 0)
  check('two keys are ANDed, not ORed',
    applyFilter(USERS, { user_is_field_technician: true, user_is_active: false }).length, 0)
}

// ── The wiring ─────────────────────────────────────────────────────────────
{
  const svc = readFileSync(new URL('../src/data/layoutService.js', import.meta.url), 'utf8')
  check('the layout overlays the field-declared filter',
    /async function applyLookupFilters\(objectName, sectionList\)/.test(svc), true)
  check('...and it runs as part of building the layout',
    /await applyLookupFilters\(objectName,/.test(svc), true)
  check('it reads the declaration from field_metadata, not a hardcoded list',
    /fm_column, fm_lookup_filter/.test(svc), true)
  check('the option fetch applies it',
    /const \{ search = null, includeId = null, filter = null \} = opts/.test(svc), true)
  check('...on top of the soft-delete filter, never instead of it',
    /if \(isDeletedCol\) query = query\.eq\(isDeletedCol, false\)[\s\S]{0,600}?if \(filter && typeof filter === 'object'\)/.test(svc), true)
  check('a failed lookup-filter read leaves lookups unscoped rather than empty',
    /catch \{ return sectionList \}/.test(svc), true)

  const rd = readFileSync(new URL('../src/components/RecordDetail.jsx', import.meta.url), 'utf8')
  const passes = (rd.match(/lookup_filter \? \{ filter: [^}]*\} : \{\}/g) || []).length
    + (rd.match(/\.\.\.\(f\.lookup_filter \? \{ filter: f\.lookup_filter \} : \{\}\)/g) || []).length
    + (rd.match(/\.\.\.\(field\.lookup_filter \? \{ filter: field\.lookup_filter \} : \{\}\)/g) || []).length
  check('every option-fetching call site forwards the filter', passes >= 5, true)
  check('the record page carries the filter through its lookup field list',
    /filter: f\.lookup_filter \|\| null/.test(rd), true)
}

console.log(failures === 0
  ? `lookup-filter fixture: ${checks} checks passed`
  : `lookup-filter fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
