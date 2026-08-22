// Fixture test for the in-page navigation trail.
//
// The rule: leaving a record goes BACK to the screen the user came from, and a
// Back/Forward restores the module + section a record URL can't carry. Run with
//   node scripts/nav-trail-fixture.mjs
//
// Cases mirror the real flow that broke (Nicholas, 2026-08-22: on an assessment,
// Back landed on a module Home page instead of the property he came from).

import { createNavTrail, entryKeyFor } from '../src/lib/navTrail.js'

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

const list = (module, section) => ({ activeModule: module, section, subsection: null, selectedRecord: null })
const rec = (module, section, table, id) => ({
  activeModule: module, section, subsection: null, selectedRecord: { table, id, mode: 'view' },
})

// ── Entry keys ──────────────────────────────────────────────────────────────
check('key: a record entry is keyed by table:id',
  entryKeyFor(rec('enrollment', 'properties', 'properties', 'p1')), 'properties:p1')
check('key: a list entry has no key', entryKeyFor(list('enrollment', 'properties')), null)
check('key: a create (no id) has no key',
  entryKeyFor({ selectedRecord: { table: 'properties', id: null, mode: 'create' } }), null)

// ── The flow that broke: list → property → assessment ───────────────────────
{
  const t = createNavTrail()
  t.push(list('enrollment', null), '/m/enrollment')
  t.push(list('enrollment', 'properties'), '/m/enrollment/properties')
  t.push(rec('enrollment', 'properties', 'properties', 'p1'), '/properties/p1')
  t.push(rec('enrollment', 'properties', 'assessments', 'a1'), '/assessments/a1')

  check('leaving the assessment steps back exactly one screen', t.stepsBackToPreviousScreen(), 1)

  // Browser Back to the property: the URL alone says nothing about the section.
  const urlDerived = { activeModule: 'enrollment', section: null, subsection: null,
    selectedRecord: { table: 'properties', id: 'p1', mode: 'view' } }
  const restored = t.restore(2, '/properties/p1', urlDerived)
  check('Back restores the section the record was opened from', restored.section, 'properties')
  check('Back restores the module the user was browsing in', restored.activeModule, 'enrollment')
  check('Back leaves the record itself alone', restored.selectedRecord.id, 'p1')
  check('Back moves the trail position', t.index, 2)
  check('from the property, one more step back reaches the list', t.stepsBackToPreviousScreen(), 1)
}

// ── A record's own tab entries are stepped over in one go ───────────────────
{
  const t = createNavTrail()
  t.push(list('enrollment', 'properties'), '/m/enrollment/properties')
  t.push(rec('enrollment', 'properties', 'properties', 'p1'), '/properties/p1')
  t.push(rec('enrollment', 'properties', 'assessments', 'a1'), '/assessments/a1')
  t.pushSub('/assessments/a1?tab=Related')
  t.pushSub('/assessments/a1?tab=Activity')
  check('a tab sub-entry inherits the record key', t.entries[t.index].key, 'assessments:a1')
  check('a tab sub-entry inherits the section', t.entries[t.index].section, 'properties')
  check('leaving the record skips BOTH tab entries and the record itself',
    t.stepsBackToPreviousScreen(), 3)
}

// ── Nothing to go back to ───────────────────────────────────────────────────
{
  const t = createNavTrail()
  check('an empty trail has no previous screen', t.stepsBackToPreviousScreen(), 0)
  t.push(rec('qualification', null, 'assessments', 'a1'), '/assessments/a1')
  check('a deep link (single entry) has no previous screen', t.stepsBackToPreviousScreen(), 0)
  t.pushSub('/assessments/a1?tab=Related')
  check('a deep link plus its own tab still has no previous screen',
    t.stepsBackToPreviousScreen(), 0)
}

// ── A new navigation drops the forward stack ────────────────────────────────
{
  const t = createNavTrail()
  t.push(list('enrollment', 'properties'), '/m/enrollment/properties')
  t.push(rec('enrollment', 'properties', 'properties', 'p1'), '/properties/p1')
  t.push(rec('enrollment', 'properties', 'assessments', 'a1'), '/assessments/a1')
  t.restore(1, '/properties/p1', rec('enrollment', null, 'properties', 'p1'))   // Back
  t.push(rec('enrollment', 'properties', 'buildings', 'b1'), '/buildings/b1')   // new branch
  check('the forward entry is dropped', t.entries.length, 3)
  check('the new entry is current', t.index, 2)
  check('back from the new branch reaches the property', t.stepsBackToPreviousScreen(), 1)
}

// ── restore() only trusts an entry that matches ─────────────────────────────
{
  const t = createNavTrail()
  t.push(list('enrollment', 'properties'), '/m/enrollment/properties')
  t.push(rec('enrollment', 'properties', 'properties', 'p1'), '/properties/p1')
  const urlDerived = { activeModule: 'enrollment', section: null, subsection: null,
    selectedRecord: { table: 'properties', id: 'p1', mode: 'view' } }
  check('an unknown index (a reload, an older session) changes nothing',
    t.restore(undefined, '/properties/p1', urlDerived).section, null)
  check('an out-of-range index changes nothing',
    t.restore(99, '/properties/p1', urlDerived).section, null)
  check('an index whose entry is a different path changes nothing',
    t.restore(0, '/properties/p1', urlDerived).section, null)
  check('the matching index restores the context',
    t.restore(1, '/properties/p1', urlDerived).section, 'properties')
}

// ── A repeated push collapses (React double-invokes updaters in StrictMode) ─
{
  const t = createNavTrail()
  t.push(list('enrollment', 'properties'), '/m/enrollment/properties')
  t.push(rec('enrollment', 'properties', 'properties', 'p1'), '/properties/p1')
  t.push(rec('enrollment', 'properties', 'properties', 'p1'), '/properties/p1')
  check('the duplicate push does not add an entry', t.entries.length, 2)
  check('back still reaches the list, not the same record again',
    t.stepsBackToPreviousScreen(), 1)
  t.pushSub('/properties/p1?tab=Related')
  t.pushSub('/properties/p1?tab=Related')
  check('a duplicate tab push does not add an entry', t.entries.length, 3)
  check('back from the tab still reaches the list', t.stepsBackToPreviousScreen(), 2)
}

// ── replace() overwrites in place (create → view after a save) ──────────────
{
  const t = createNavTrail()
  t.push(list('field', 'projects'), '/m/field/projects')
  t.push(rec('field', 'projects', 'projects', 'j1'), '/projects/j1')
  t.replace(rec('field', 'projects', 'projects', 'j2'), '/projects/j2')
  check('replace does not add an entry', t.entries.length, 2)
  check('replace updates the current entry', t.entries[1].key, 'projects:j2')
  check('back still reaches the list behind it', t.stepsBackToPreviousScreen(), 1)
}

console.log(failures === 0
  ? `nav-trail fixture: ${checks} checks passed`
  : `nav-trail fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
