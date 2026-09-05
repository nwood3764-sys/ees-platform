// Fixture: a section is COLUMNS, and moving one field moves one field.
//
// Nicholas, 2026-09-05, after three cuts of this: "I can't move one field and
// have five other fields move around. I just don't understand how that's
// logical. For a UI."
//
// He is describing a FLOW. A field's position was its index in one array and
// the renderer packs that array into rows left to right, so pulling a field out
// of the middle shifted every field after it by one — which in a two-column
// section put every one of them on the OTHER SIDE of the card. Moving Building
// one place rewrote five fields' columns. `legacyFlowMove` is that rule, kept
// in the source it disproves; the CONTROLS below replay it over the real
// production array and require it to scatter the section. If it ever stops
// scattering, this fixture has stopped reproducing what was reported.
//
// The rule now reads the section as what it looks like: `cols` independent
// column stacks. A drop names a position in a COLUMN; that column makes room
// below it; the column the field came from closes up; nothing else moves and no
// field ever changes column on its own.
//
// Run with:  node scripts/field-group-placement-fixture.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { packFieldGroupRows, fieldColumnPositions } from '../src/lib/fieldGroupLayout.js'
import {
  FIELD_CELL_PREFIX, FIELD_BLANK_PREFIX, FIELD_COLUMN_END_PREFIX, FIELD_ZONE_SUFFIX,
  fieldCellDragId, fieldBlankDropId, fieldColumnEndDropId, fieldZoneDropId, parseFieldDropId,
  applyFieldDropWithinGroup, removeFieldAt, insertFieldIntoGroup,
  toColumnBands, fromColumnBands, trimTrailingSpacers, isSpacer, legacyFlowMove,
} from '../src/lib/fieldGroupPlacement.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = (rel) => readFileSync(join(here, '..', rel), 'utf8')

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
function ok(label, cond) { check(label, !!cond, true) }

// ── The reported section, exactly as production stores it ───────────────────
// assessments · WI-IRA-MF-HOMES-AUDIT · "Information", 2 columns. Read off
// page_layout_widgets.widget_config on 2026-09-05.
const F = (name) => ({ name, type: 'text', label: name })
const SP = { type: 'spacer' }
const INFORMATION = [
  F('Name'), F('Opportunity'),
  F('Building'), F('Project'),
  F('PropertyContact'), F('Property'),
  F('GasFuelProvider'), F('AssessorName'),
  F('DateOfIq'), SP,
  F('StartTimeOfIq'), SP,
  F('EndTimeOfIq'),
]
const COLS = 2

const grid = (fields, columns = COLS) =>
  packFieldGroupRows(fields, columns).map(r => r.cells.map(c => (
    c.blank ? '—' : (isSpacer(c.field) ? '·' : c.field.name)
  )))

// Which COLUMN every named field is in. "A field never changes column" is a
// claim about this map, so it is what the checks compare.
function columnOf(fields, columns = COLS) {
  const map = fieldColumnPositions(fields, columns)
  const out = {}
  fields.forEach((f, i) => {
    if (!f?.name) return
    const p = map.get(i)
    if (p) out[f.name] = p.column
  })
  return out
}
function changedColumn(before, after) {
  const a = columnOf(before), b = columnOf(after)
  return Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]).sort()
}
function positions(fields, columns = COLS) {
  const map = fieldColumnPositions(fields, columns)
  const out = {}
  fields.forEach((f, i) => {
    if (!f?.name) return
    const p = map.get(i)
    if (p) out[f.name] = `${p.row}:${p.column}`
  })
  return out
}
const moved = (before, after) => {
  const a = positions(before), b = positions(after)
  return Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]).sort()
}

const BEFORE = grid(INFORMATION)
check('the reported section renders as the editor showed it', BEFORE, [
  ['Name', 'Opportunity'],
  ['Building', 'Project'],
  ['PropertyContact', 'Property'],
  ['GasFuelProvider', 'AssessorName'],
  ['DateOfIq', '·'],
  ['StartTimeOfIq', '·'],
  ['EndTimeOfIq', '—'],
])

// ── 1. CONTROL — the flow, which is what was being reported ─────────────────
// Building sits at index 2. Under the flow rule, moving it ANYWHERE re-columns
// everything between its old and new position.
const legacyEnd = legacyFlowMove(INFORMATION, 2, INFORMATION.length)
check('CONTROL: under the flow rule, moving ONE field re-columns eight others',
  changedColumn(INFORMATION, legacyEnd),
  ['AssessorName', 'DateOfIq', 'EndTimeOfIq', 'GasFuelProvider', 'Project', 'Property',
   'PropertyContact', 'StartTimeOfIq'])
ok('CONTROL: and it is the flow that does it, not the distance — a short move scatters too',
  changedColumn(INFORMATION, legacyFlowMove(INFORMATION, 2, 6)).length >= 3)

// ── 2. The reported drag: Building over to the right-hand column ────────────
// Column 2 reads Opportunity / Project / Property / AssessorName. Dropping
// Building on Project puts it at Project's position IN COLUMN 2; column 2 makes
// room below it; column 1 closes up where Building was.
const toProject = applyFieldDropWithinGroup(INFORMATION, COLS, 2, { kind: 'cell', index: 3 })
check('Building lands in the right-hand column, where it was dropped', grid(toProject), [
  ['Name', 'Opportunity'],
  ['PropertyContact', 'Building'],
  ['GasFuelProvider', 'Project'],
  ['DateOfIq', 'Property'],
  ['StartTimeOfIq', 'AssessorName'],
  ['EndTimeOfIq', '—'],
])
check('and Building is the ONLY field that changes column',
  changedColumn(INFORMATION, toProject), ['Building'])
ok('every other field stays in the column it was in',
  Object.entries(columnOf(INFORMATION)).every(([k, v]) => k === 'Building' || columnOf(toProject)[k] === v))

// ── 3. Dropping on an empty slot moves NOTHING else at all ──────────────────
// The spacer at index 9 is the blank beside "Date Of Iq Assessment". A field
// dropped on a blank takes it — there is nothing there to displace.
const intoSpacer = applyFieldDropWithinGroup(INFORMATION, COLS, 12, { kind: 'cell', index: 9 })
check('a field dropped on an empty slot takes that exact cell', grid(intoSpacer), [
  ['Name', 'Opportunity'],
  ['Building', 'Project'],
  ['PropertyContact', 'Property'],
  ['GasFuelProvider', 'AssessorName'],
  ['DateOfIq', 'EndTimeOfIq'],
  ['StartTimeOfIq', '—'],
])
check('and it is the only field that moves at all', moved(INFORMATION, intoSpacer), ['EndTimeOfIq'])
check('dropping a field on the empty slot directly under it in its own column is a no-op',
  applyFieldDropWithinGroup(INFORMATION, COLS, 7, { kind: 'cell', index: 9 }), INFORMATION)

// ── 4. Within one column it is a reorder, and column 2 never notices ────────
const withinColumn = applyFieldDropWithinGroup(INFORMATION, COLS, 12, { kind: 'cell', index: 2 })
check('a field dragged up its own column lands there',
  grid(withinColumn).map(r => r[0]),
  ['Name', 'EndTimeOfIq', 'Building', 'PropertyContact', 'GasFuelProvider', 'DateOfIq', 'StartTimeOfIq'])
check('and NOTHING in the other column moves',
  grid(withinColumn).map(r => r[1]), grid(INFORMATION).map(r => r[1]))
check('no field changed column', changedColumn(INFORMATION, withinColumn), [])

// ── 5. The bottom of a column is reachable ─────────────────────────────────
const toColumnEnd = applyFieldDropWithinGroup(INFORMATION, COLS, 2, { kind: 'columnEnd', band: 0, col: 1 })
check('a field dropped on the strip under a column goes to the bottom of it',
  grid(toColumnEnd).map(r => r[1]),
  ['Opportunity', 'Project', 'Property', 'AssessorName', '·', '·', 'Building'])
check('and only Building changed column', changedColumn(INFORMATION, toColumnEnd), ['Building'])

// ── 6. A drop with no cell under it is the next free cell, not the end ──────
// The last row is "End Time | blank", so the next free cell is that blank —
// which is where a stray drop lands. It must never mean "append and re-flow".
// A drop that lands on no cell states no column, so it does not change one:
// the field goes to the bottom of the column it is already in. A near miss must
// never move a field sideways.
const stray = applyFieldDropWithinGroup(INFORMATION, COLS, 2, { kind: 'zone' })
check('a stray drop sends the field to the bottom of its OWN column',
  grid(stray).map(r => r[0]),
  ['Name', 'PropertyContact', 'GasFuelProvider', 'DateOfIq', 'StartTimeOfIq', 'EndTimeOfIq', 'Building'])
check('and NO field changes column, not even the one that moved',
  changedColumn(INFORMATION, stray), [])
check('the other column is untouched by a stray drop',
  grid(stray).map(r => r[1]), ['Opportunity', 'Project', 'Property', 'AssessorName', '·', '·', '—'])

// ── 7. A drop that changes nothing changes nothing ─────────────────────────
check('dropping a field on itself is a no-op',
  applyFieldDropWithinGroup(INFORMATION, COLS, 2, { kind: 'cell', index: 2 }), INFORMATION)
check('dropping a field on the cell directly under it in its own column is a no-op',
  applyFieldDropWithinGroup(INFORMATION, COLS, 2, { kind: 'cell', index: 4 }), INFORMATION)
check('an out-of-range drag changes nothing',
  applyFieldDropWithinGroup(INFORMATION, COLS, 99, { kind: 'cell', index: 1 }), INFORMATION)
check('a drop with no target changes nothing',
  applyFieldDropWithinGroup(INFORMATION, COLS, 1, null), INFORMATION)

// ── 8. The array round-trips through the columns unchanged ─────────────────
// The columns are a way of READING the stored array, not a second format. If
// the round trip is lossy, every drag silently rewrites the layout.
check('reading the section as columns and writing it back is the identity',
  fromColumnBands(toColumnBands(INFORMATION, COLS), COLS), INFORMATION)
const THREE = [F('A'), F('B'), F('C'), F('D'), F('E'), SP, F('G'), F('H')]
check('…in three columns too', fromColumnBands(toColumnBands(THREE, 3), 3), THREE)
check('…and in one', fromColumnBands(toColumnBands(INFORMATION, 1), 1), INFORMATION)

// ── 9. A full-width field is a row, so it splits the columns into bands ────
const WIDE = [F('A'), F('B'), { ...F('Wide'), full_width: true }, F('C'), F('D')]
check('a full-width field renders as its own row',
  grid(WIDE), [['A', 'B'], ['Wide'], ['C', 'D']])
check('and the columns above it are a separate band from the ones below',
  toColumnBands(WIDE, COLS).map(b => b.type), ['grid', 'full', 'grid'])
check('a field moved within the band below stays below the full-width row',
  grid(applyFieldDropWithinGroup(WIDE, COLS, 4, { kind: 'cell', index: 3 })),
  [['A', 'B'], ['Wide'], ['D', '·'], ['C', '—']])
check('the round trip survives a full-width field', fromColumnBands(toColumnBands(WIDE, COLS), COLS), WIDE)

// ── 10. Across sections it is a move, and the source column closes up ──────
const OCCUPANCY = [F('SqFt'), F('Units'), F('AtticUnits'), F('Bedrooms')]
const taken = removeFieldAt(INFORMATION, COLS, 2)
check('the field leaves its old section', taken.field.name, 'Building')
check('and its column closes up behind it', grid(taken.fields).map(r => r[0]),
  ['Name', 'PropertyContact', 'GasFuelProvider', 'DateOfIq', 'StartTimeOfIq', 'EndTimeOfIq'])
check('the column it did not touch is untouched', grid(taken.fields).map(r => r[1]),
  ['Opportunity', 'Project', 'Property', 'AssessorName', '·', '—'])
check('it lands in the column it was dropped on in the new section',
  grid(insertFieldIntoGroup(OCCUPANCY, COLS, taken.field, { kind: 'cell', index: 1 })),
  [['SqFt', 'Building'], ['AtticUnits', 'Units'], ['·', 'Bedrooms']])
check('a drop on the receiving section itself takes its next free cell',
  grid(insertFieldIntoGroup(OCCUPANCY, COLS, taken.field, { kind: 'zone' })),
  [['SqFt', 'Units'], ['AtticUnits', 'Bedrooms'], ['Building', '—']])

// ── 10b. Deleting a field closes up ITS COLUMN ────────────────────────────
// The × on a tile is the same removal a cross-section drag makes. Splicing the
// raw array instead would pull the whole flow up by one and re-column every
// field after it — the same defect, arriving by a different button.
const deleted = removeFieldAt(INFORMATION, COLS, 2).fields
check('deleting a field closes up its own column', grid(deleted).map(r => r[0]),
  ['Name', 'PropertyContact', 'GasFuelProvider', 'DateOfIq', 'StartTimeOfIq', 'EndTimeOfIq'])
check('and no SURVIVING field changes column',
  changedColumn(INFORMATION, deleted).filter(n => n !== 'Building'), [])
ok('the editor deletes through the shared rule, not by splicing the array',
  /removeFieldAt\(fields, cols, index\)\.fields/.test(src('src/modules/admin/LayoutCanvasEditor.jsx'))
  && !/fields\.filter\(\(_, i\) => i !== index\)/.test(src('src/modules/admin/LayoutCanvasEditor.jsx')))

// ── 11. Trailing spacers are never stored ─────────────────────────────────
check('trailing spacers are dropped', trimTrailingSpacers([F('A'), SP, SP]).length, 1)
check('an interior spacer is kept — it is a blank an admin placed',
  trimTrailingSpacers([F('A'), SP, F('B')]).length, 3)

// ── 12. The id grammar ────────────────────────────────────────────────────
check('a cell id round-trips', parseFieldDropId(fieldCellDragId('sec-7', 4)),
  { kind: 'cell', sectionKey: 'sec-7', index: 4 })
check('a blank id carries its row and column', parseFieldDropId(fieldBlankDropId('sec-7', 6, 1)),
  { kind: 'blank', sectionKey: 'sec-7', row: 6, col: 1 })
check('a column-end id carries its band and column', parseFieldDropId(fieldColumnEndDropId('sec-7', 0, 1)),
  { kind: 'columnEnd', sectionKey: 'sec-7', band: 0, col: 1 })
check('a group id round-trips', parseFieldDropId(fieldZoneDropId('sec-7')),
  { kind: 'zone', sectionKey: 'sec-7' })
ok('a blank id is not read as a cell id', !fieldBlankDropId('s', 1, 0).startsWith(FIELD_CELL_PREFIX))
check('a section drag id is not a field target', parseFieldDropId('sec::sec-7'), null)
check('a widget drag id is not a field target', parseFieldDropId('wgt::3'), null)
check('a malformed id is refused rather than guessed at', parseFieldDropId('fld::sec-7'), null)
check('a blank id missing its column is refused', parseFieldDropId('fldpad::sec-7::3'), null)

// ── 13. The editor really uses this ───────────────────────────────────────
const EDITOR = src('src/modules/admin/LayoutCanvasEditor.jsx')
ok('the editor resolves field drops through the shared rule',
  /from '\.\.\/\.\.\/lib\/fieldGroupPlacement'/.test(EDITOR))
ok('the drop is resolved with the section\'s own column count',
  /applyFieldDropWithinGroup\(srcFields, src\.columns \|\| 2, from\.index, to\)/.test(EDITOR))
ok('NOTHING in the editor trades two fields\' places',
  !/\bswapFieldCells\b/.test(EDITOR) && !/\bswapFieldCells\b/.test(src('src/lib/fieldGroupPlacement.js')))
ok('a near miss inside a section resolves to that section\'s nearest cell, never to the end',
  /closestCenter\(\{ \.\.\.args, droppableContainers: own \}\)/.test(EDITOR))
ok('the field family resolves collisions by pointer first',
  /pointerWithin\(\{ \.\.\.args, droppableContainers \}\)/.test(EDITOR))
ok('field cells are not sortable — a sortable previews a list, and a section is a grid',
  !/useSortable\(\{ id: field\.name \}\)/.test(EDITOR) && !/rectSortingStrategy/.test(EDITOR))
ok('the bottom of every column is a drop target',
  /function ColumnEndStrip\(/.test(EDITOR) && /fieldColumnEndDropId\(sectionKey, band, col\)/.test(EDITOR))
ok('the rule is stated on screen, not left to be discovered',
  /A field never changes column<\/b>/.test(EDITOR))
ok('an empty slot can still be added',  /\+ Empty slot/.test(EDITOR))

console.log(failures === 0
  ? `field-group-placement fixture: ${checks} checks passed`
  : `field-group-placement fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
