// Fixture test for the filter option rule (src/lib/picklistFilterOptions.js).
//
// The defect this pins: getPicklistOptions() filters to picklist_is_active and
// fed BOTH the picklist editors and the list-view filter. The Technicians tab
// (Field module, which is the contacts object list) showed seven contacts
// reading "Technician" under Contact Record Type while the filter for that
// column offered only the five active values — so records that were plainly on
// screen could not be filtered to (Nicholas, 2026-09-02).
//
// Built from the real production contacts.record_type value set: 5 active,
// 26 retired, of which exactly one (TECHNICIAN, 7 contacts) is still carried
// by live records.
//
// Run with: node scripts/picklist-filter-options-fixture.mjs

import { mergeFilterOptions } from '../src/lib/picklistFilterOptions.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}
const labels = rows => rows.map(r => r.label)

// ── The real prod contacts.record_type set (trimmed to what matters here) ────
const CONTACT_RECORD_TYPES = [
  { id: 'fbecd588', label: 'Program Contact',          value: 'PROGRAM-CONTACT',          isActive: true  },
  { id: '75d64a84', label: 'Property Owner Contact',   value: 'PROPERTY-OWNER-CONTACT',   isActive: true  },
  { id: '6fd47271', label: 'Service Provider Contact', value: 'SERVICE-PROVIDER-CONTACT', isActive: true  },
  { id: '75b52f5d', label: 'Standard Contact',         value: 'STANDARD-CONTACT',         isActive: true  },
  { id: '628b98e3', label: 'Utility Contact',          value: 'UTILITY-CONTACT',          isActive: true  },
  { id: 'c040ba82', label: 'Technician',               value: 'TECHNICIAN',               isActive: false },
  { id: '76850116', label: 'Team Lead',                value: 'TEAM-LEAD',                isActive: false },
  { id: '263c4d2d', label: 'Lead Technician',          value: 'LEAD-TECHNICIAN',          isActive: false },
  { id: 'b48ab575', label: 'Technician in Training',   value: 'TECHNICIAN-IN-TRAINING',   isActive: false },
  { id: 'fca5f554', label: 'Standard',                 value: 'STANDARD',                 isActive: false },
  { id: 'b552be98', label: 'Tenant',                   value: 'TENANT',                   isActive: false },
]
// Only TECHNICIAN is carried by a live contact.
const IN_USE = ['c040ba82', '75d64a84', '75b52f5d']

// ── The reported case ───────────────────────────────────────────────────────
{
  const opts = mergeFilterOptions(CONTACT_RECORD_TYPES, IN_USE)
  check('the reported case: Technician is offered to the filter',
    labels(opts).includes('Technician'), true)
  check('and it is marked retired, so the dropdown can say why',
    opts.find(o => o.label === 'Technician').retired, true)
  check('the five live choices come first, in order',
    labels(opts).slice(0, 5),
    ['Program Contact', 'Property Owner Contact', 'Service Provider Contact', 'Standard Contact', 'Utility Contact'])
  check('the retired-but-used value sits below them, not among them',
    labels(opts).slice(5), ['Technician'])
  check('every live value is marked not-retired',
    opts.slice(0, 5).every(o => o.retired === false), true)
}

// ── A retired value nothing carries is NOT offered ──────────────────────────
// It can only ever match zero rows, and a filter that returns nothing reads as
// broken. Team Lead / Lead Technician / Technician in Training are retired AND
// unused, so they must not appear even though they look just like Technician.
{
  const opts = mergeFilterOptions(CONTACT_RECORD_TYPES, IN_USE)
  for (const dead of ['Team Lead', 'Lead Technician', 'Technician in Training', 'Tenant', 'Standard']) {
    check(`retired and unused is dropped: ${dead}`, labels(opts).includes(dead), false)
  }
  check('so the whole list is exactly six entries', opts.length, 6)
}

// ── An active value is offered whether or not any record carries it ─────────
// Filtering to a value with no rows yet is a legitimate question ("has anyone
// been filed as a Program Contact?"); the answer is an empty list, not a
// missing option.
{
  const opts = mergeFilterOptions(CONTACT_RECORD_TYPES, ['c040ba82'])
  check('unused ACTIVE values are still offered',
    labels(opts),
    ['Program Contact', 'Property Owner Contact', 'Service Provider Contact', 'Standard Contact', 'Utility Contact', 'Technician'])
}

// ── The editors are unaffected: this rule never makes a retired value pickable
// The editor list is the active set, which is what mergeFilterOptions returns
// when the in-use lookup finds nothing at all.
{
  const opts = mergeFilterOptions(CONTACT_RECORD_TYPES, [])
  check('no value in use -> exactly the active list (what an editor offers)',
    labels(opts),
    ['Program Contact', 'Property Owner Contact', 'Service Provider Contact', 'Standard Contact', 'Utility Contact'])
  check('and nothing in it is retired', opts.every(o => o.retired === false), true)
}

// ── The in-use lookup failing must never LOSE the working filter ────────────
// A null list means the RPC did not answer. Falling back to the active values
// leaves the filter exactly as it was before this existed — degraded, never
// broken.
{
  for (const [label, arg] of [['null', null], ['undefined', undefined]]) {
    const opts = mergeFilterOptions(CONTACT_RECORD_TYPES, arg)
    check(`in-use lookup returned ${label} -> active list, no throw`,
      labels(opts),
      ['Program Contact', 'Property Owner Contact', 'Service Provider Contact', 'Standard Contact', 'Utility Contact'])
  }
}

// ── Two values sharing a LABEL are one choice ───────────────────────────────
// The filter matches on the displayed text, so offering the label twice asks
// the user to choose between two identical rows. The active spelling wins.
{
  const clashing = [
    { id: 'a1', label: 'Technician', value: 'TECHNICIAN-NEW', isActive: true  },
    { id: 'c040ba82', label: 'Technician', value: 'TECHNICIAN', isActive: false },
  ]
  const opts = mergeFilterOptions(clashing, ['c040ba82'])
  check('a label is offered once', labels(opts), ['Technician'])
  check('and it is the active spelling that survives', opts[0].value, 'TECHNICIAN-NEW')
  check('so it is not marked retired', opts[0].retired, false)
}
{
  const twoRetiredSameLabel = [
    { id: 'r1', label: 'Retired Thing', value: 'RETIRED-A', isActive: false },
    { id: 'r2', label: 'Retired Thing', value: 'RETIRED-B', isActive: false },
  ]
  check('two retired values sharing a label collapse to one',
    mergeFilterOptions(twoRetiredSameLabel, ['r1', 'r2']).length, 1)
}

// ── Ids are compared as strings, not by reference ───────────────────────────
// The RPC returns uuids; a numeric or mixed-type id must still match.
{
  const rows = [{ id: 7, label: 'Seven', value: 'SEVEN', isActive: false }]
  check('a non-string id still matches an in-use entry',
    labels(mergeFilterOptions(rows, ['7'])), ['Seven'])
}

// ── Junk in the value list cannot break the dropdown ────────────────────────
{
  const messy = [null, undefined, { id: 'x', isActive: true }, { id: 'y', label: 'Real', isActive: true }]
  check('rows with no label are skipped rather than rendered blank',
    labels(mergeFilterOptions(messy, [])), ['Real'])
  check('a non-array value list returns nothing rather than throwing',
    mergeFilterOptions(null, ['c040ba82']), [])
}

// ── POSITIVE CONTROL: the pre-fix rule must fail the reported case ──────────
// This is the code that shipped: the filter took the editors' active-only
// list. If this ever starts offering Technician, the control is broken and the
// checks above prove nothing.
{
  const preFix = CONTACT_RECORD_TYPES.filter(v => v.isActive)
  check('CONTROL: the old active-only list could not offer Technician',
    preFix.map(v => v.label).includes('Technician'), false)
  check('CONTROL: and it is the five values Nicholas saw in the dropdown',
    preFix.map(v => v.label),
    ['Program Contact', 'Property Owner Contact', 'Service Provider Contact', 'Standard Contact', 'Utility Contact'])
}

console.log(`picklist-filter-options-fixture: ${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
