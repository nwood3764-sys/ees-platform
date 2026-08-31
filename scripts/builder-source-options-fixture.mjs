// Fixture test for the builder picker option rule (src/lib/builderSourceOptions.js).
//
// The defect this pins: every LEAP service row carries a DISPLAY id under `id`
// (a record number, or the uuid's first 8 characters uppercased) and the real
// uuid under `_id`. A <select> bound to a uuid FK must take `_id`. The
// home-page editor mapped dashboards, reports and list views from `_id` and
// roles from `id`, so assigning a Role wrote the Admin role's display id
// FA6C5203 into hp_role_id and the save died on the RPC's ::uuid cast
// (Nicholas, 2026-08-31, Enrollment Home).
//
// Run with: node scripts/builder-source-options-fixture.mjs

import {
  isUuid, optionRowId, optionRowLabel, toSourceOptions, assertUuidOrNull,
} from '../src/lib/builderSourceOptions.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}
function throws(label, fn, mustMention) {
  checks += 1
  try {
    fn()
    failures += 1
    console.error(`FAIL  ${label}\n      expected a thrown error, nothing was thrown`)
  } catch (err) {
    for (const needle of [].concat(mustMention)) {
      if (!String(err.message).includes(needle)) {
        failures += 1
        console.error(`FAIL  ${label}\n      error did not mention ${JSON.stringify(needle)}\n      actual   ${err.message}`)
        return
      }
    }
  }
}

// The real values from the failing save: the Admin role, and the display id the
// picker sent in its place.
const ADMIN_ROLE_UUID = 'fa6c5203-e449-4ef8-9a1c-49046a6f4994'
const ADMIN_DISPLAY_ID = 'FA6C5203'

// ── isUuid ─────────────────────────────────────────────────────────────────
check('a uuid is a uuid', isUuid(ADMIN_ROLE_UUID), true)
check('an uppercase uuid is a uuid', isUuid(ADMIN_ROLE_UUID.toUpperCase()), true)
check('the truncated display id is NOT a uuid', isUuid(ADMIN_DISPLAY_ID), false)
check('a record number is NOT a uuid', isUuid('DSH-00010'), false)
check('a uuid missing a group is not a uuid', isUuid('fa6c5203-e449-4ef8-9a1c'), false)
check('a uuid with a trailing group is not a uuid', isUuid(`${ADMIN_ROLE_UUID}-0000`), false)
check('null is not a uuid', isUuid(null), false)
check('undefined is not a uuid', isUuid(undefined), false)
check('empty string is not a uuid', isUuid(''), false)
check('a non-string is not a uuid', isUuid(123), false)
check('surrounding whitespace is tolerated', isUuid(` ${ADMIN_ROLE_UUID} `), true)

// ── optionRowId: the rule itself ───────────────────────────────────────────
// fetchRoles() returns exactly this shape. `id` is the trap.
const ADMIN_ROW = { id: ADMIN_DISPLAY_ID, _id: ADMIN_ROLE_UUID, name: 'Admin', status: 'Active' }
check('a role row resolves to its uuid, never its display id', optionRowId(ADMIN_ROW), ADMIN_ROLE_UUID)
check('the display id is not what a role row resolves to', optionRowId(ADMIN_ROW) === ADMIN_DISPLAY_ID, false)

// fetchDashboards() — display id is a record number here, same trap.
const DASH_ROW = { id: 'DSH-00010', _id: '11111111-2222-4333-8444-555555555555', name: 'Outreach Dashboard' }
check('a dashboard row resolves to its uuid, not DSH-00010',
  optionRowId(DASH_ROW), '11111111-2222-4333-8444-555555555555')

// A service that never took on a display id returns the uuid as `id`.
check('a row whose `id` IS a uuid resolves to it',
  optionRowId({ id: ADMIN_ROLE_UUID, name: 'Admin' }), ADMIN_ROLE_UUID)

// The case that must not become an option.
check('a row carrying ONLY a display id resolves to null',
  optionRowId({ id: ADMIN_DISPLAY_ID, name: 'Admin' }), null)
check('_id wins even when it disagrees with a uuid-shaped id',
  optionRowId({ id: '99999999-9999-4999-8999-999999999999', _id: ADMIN_ROLE_UUID }), ADMIN_ROLE_UUID)
check('a null row resolves to null', optionRowId(null), null)
check('a non-object resolves to null', optionRowId('DSH-00010'), null)
check('an empty row resolves to null', optionRowId({}), null)

// ── optionRowLabel: the spellings the four services use ────────────────────
check('name is the label', optionRowLabel({ name: 'Outreach Dashboard' }, 'Dashboard'), 'Outreach Dashboard')
check('label is read when name is absent (list views)', optionRowLabel({ label: 'Needs Action' }, 'List View'), 'Needs Action')
check('role_name is read when both are absent', optionRowLabel({ role_name: 'Admin' }, 'Role'), 'Admin')
check('name wins over label', optionRowLabel({ name: 'A', label: 'B' }, 'X'), 'A')
check('a blank name falls back rather than rendering empty', optionRowLabel({ name: '   ' }, 'Role'), 'Role')
check('a nameless row falls back to the kind', optionRowLabel({}, 'Dashboard'), 'Dashboard')
check('a null row falls back to the kind', optionRowLabel(null, 'Report'), 'Report')

// ── toSourceOptions ────────────────────────────────────────────────────────
check('roles map to uuid-valued options',
  toSourceOptions([ADMIN_ROW, { id: 'AB12CD34', _id: '22222222-3333-4444-8555-666666666666', name: 'Project Manager' }], 'Role'),
  [{ id: ADMIN_ROLE_UUID, name: 'Admin' }, { id: '22222222-3333-4444-8555-666666666666', name: 'Project Manager' }])

// The positive control: the mapping the editor used to do. If `toSourceOptions`
// ever starts passing display ids through, this check goes red.
{
  const brokenMapping = [ADMIN_ROW].map(r => ({ id: r.id, name: r.name }))
  check('the OLD hand-rolled mapping produced a non-uuid option value (control)',
    isUuid(brokenMapping[0].id), false)
  check('the shared rule does not', isUuid(toSourceOptions([ADMIN_ROW], 'Role')[0].id), true)
}

check('a row with no resolvable uuid is dropped, not offered',
  toSourceOptions([{ id: ADMIN_DISPLAY_ID, name: 'Admin' }, DASH_ROW], 'Dashboard'),
  [{ id: '11111111-2222-4333-8444-555555555555', name: 'Outreach Dashboard' }])
check('an empty list is an empty list', toSourceOptions([], 'Role'), [])
check('a null list is an empty list', toSourceOptions(null, 'Role'), [])
check('a non-array is an empty list', toSourceOptions({ id: 'x' }, 'Role'), [])

// ── assertUuidOrNull: the save-path guard ──────────────────────────────────
check('no role selected passes through as null', assertUuidOrNull(null, 'Role'), null)
check('an empty selection passes through as null', assertUuidOrNull('', 'Role'), null)
check('undefined passes through as null', assertUuidOrNull(undefined, 'Role'), null)
check('a real uuid passes through', assertUuidOrNull(ADMIN_ROLE_UUID, 'Role'), ADMIN_ROLE_UUID)
check('a uuid is trimmed', assertUuidOrNull(` ${ADMIN_ROLE_UUID} `, 'Role'), ADMIN_ROLE_UUID)
throws('the exact failing value is refused, and the error names the field',
  () => assertUuidOrNull(ADMIN_DISPLAY_ID, 'Role'), ['Role', ADMIN_DISPLAY_ID])
throws('a record number reaching a uuid column is refused',
  () => assertUuidOrNull('DSH-00010', 'Dashboard source'), ['Dashboard source', 'DSH-00010'])
throws('a number is refused', () => assertUuidOrNull(42, 'Role'), 'Role')

// ── Two dashboard components on one page ───────────────────────────────────
// Nicholas read the error as a limit on adding a second Dashboard. It is not:
// nothing in the save path is per-type, home_page_components carries no unique
// constraint, and save_home_page simply inserts each element in a loop. Pinned
// so a future reader does not invent a restriction that never existed.
{
  const twoDashboards = [
    { type: 'dashboard', title: 'Enrollment Overview', dataSourceId: '11111111-2222-4333-8444-555555555555' },
    { type: 'dashboard', title: 'Outreach Dashboard', dataSourceId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb' },
  ]
  check('two dashboard components both validate',
    twoDashboards.map(c => assertUuidOrNull(c.dataSourceId, `${c.title} source`)),
    ['11111111-2222-4333-8444-555555555555', '77777777-8888-4999-8aaa-bbbbbbbbbbbb'])
  check('two dashboards bound to the SAME dashboard also validate',
    [twoDashboards[0], { ...twoDashboards[1], dataSourceId: twoDashboards[0].dataSourceId }]
      .map(c => assertUuidOrNull(c.dataSourceId, `${c.title} source`)),
    ['11111111-2222-4333-8444-555555555555', '11111111-2222-4333-8444-555555555555'])
  check('an unbound second dashboard is allowed through as null (— Select —)',
    assertUuidOrNull(null, 'Dashboard source'), null)
}

console.log(`builder-source-options-fixture: ${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
