// Fixture test for the module tab-strip merge.
//
// The rule that is easy to get wrong: a tab the admin REMOVED must stay
// removed. The merge appends code tabs the config does not mention (so a tab
// new in code appears without seeding), and a removed tab is also "not
// mentioned" — so without the removed set it comes straight back and Remove
// silently does nothing (Nicholas, 2026-08-29, removing EFR Reports from
// Qualification, a code-backed tab).
//
// Run with: node scripts/module-tabs-fixture.mjs

import { mergeModuleTabs } from '../src/lib/moduleTabs.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) { failures += 1; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}
const ids = (tabs) => tabs.map(t => t.id)

const CODE = [
  { id: 'home', label: 'Home' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'efr', label: 'EFR Reports' },
]
const row = (sectionId, extra = {}) => ({
  sectionId, label: sectionId, sortOrder: 0, visible: true, objectTable: null, removed: false, ...extra,
})

// ── No config at all ───────────────────────────────────────────────────────
check('no config renders the code tabs', ids(mergeModuleTabs(CODE, [])), ['home', 'opportunities', 'efr'])
check('null config renders the code tabs', ids(mergeModuleTabs(CODE, null)), ['home', 'opportunities', 'efr'])

// ── The rule this exists for ───────────────────────────────────────────────
{
  const cfg = [
    row('home', { sortOrder: 0 }),
    row('opportunities', { sortOrder: 1 }),
    row('efr', { sortOrder: 2, removed: true, visible: false }),
  ]
  check('a REMOVED code-backed tab does not come back',
    ids(mergeModuleTabs(CODE, cfg)), ['home', 'opportunities'])
}
{
  // The same shape, but the removed row omitted entirely — which is what the
  // fetch used to return. This is the case that resurrected the tab.
  const cfg = [row('home', { sortOrder: 0 }), row('opportunities', { sortOrder: 1 })]
  check('an UNMENTIONED code tab IS appended (new in code, not yet seeded)',
    ids(mergeModuleTabs(CODE, cfg)), ['home', 'opportunities', 'efr'])
}

// ── Hidden is not removed ──────────────────────────────────────────────────
{
  const cfg = [row('home'), row('opportunities', { sortOrder: 1 }), row('efr', { sortOrder: 2, visible: false })]
  check('a hidden tab is not rendered', ids(mergeModuleTabs(CODE, cfg)), ['home', 'opportunities'])
  check('but a hidden tab is not treated as removed either — it stays configured',
    mergeModuleTabs(CODE, cfg).length, 2)
}

// ── Order, labels, object tabs ─────────────────────────────────────────────
{
  const cfg = [
    row('opportunities', { sortOrder: 0, label: 'Deals' }),
    row('home', { sortOrder: 1 }),
    row('efr', { sortOrder: 2, removed: true }),
  ]
  const tabs = mergeModuleTabs(CODE, cfg)
  check('config order wins', ids(tabs), ['opportunities', 'home'])
  check('config label wins over the code label', tabs[0].label, 'Deals')
}
{
  const cfg = [row('home'), row('units', { sortOrder: 1, label: 'Units', objectTable: 'units' })]
  const tabs = mergeModuleTabs(CODE, cfg)
  check('an object-backed tab renders with no code section',
    ids(tabs), ['home', 'units', 'opportunities', 'efr'])
  check('and carries its object table', tabs[1].objectTable, 'units')
}
{
  // A configured tab the code no longer declares, and which is not
  // object-backed, cannot render — nothing knows how to draw it.
  const cfg = [row('home'), row('retired_thing', { sortOrder: 1 })]
  check('a configured tab with no code section and no object is skipped',
    ids(mergeModuleTabs(CODE, cfg)).includes('retired_thing'), false)
}

// ── Never leave a module with no navigation ────────────────────────────────
{
  const cfg = CODE.map((s, i) => row(s.id, { sortOrder: i, removed: true }))
  check('removing everything falls back to the code tabs rather than an empty strip',
    ids(mergeModuleTabs(CODE, cfg)), ['home', 'opportunities', 'efr'])
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) { console.error(`${failures} failing`); process.exit(1) }
