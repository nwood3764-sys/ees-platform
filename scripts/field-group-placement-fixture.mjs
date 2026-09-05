// Fixture: a field goes where you drop it, and nothing else moves.
//
// Nicholas, 2026-09-05, in the page-layout editor on the assessments
// WI-IRA-MF-HOMES-AUDIT layout: "In hindsight, it's not even allowing me to
// move it. I just moved the building over to the right, and it moved the
// property, the building, and the project back to the left."
//
// Two defects in one sentence, and the CONTROLS below reproduce both from the
// real field array that layout stores on production.
//
//   1. A one-slot forward drag was a NO-OP. The editor resolved a drop as
//      "insert before the tile you landed on" and computed that index in the
//      array with the dragged field ALREADY REMOVED, so dropping Building on
//      the tile to its right put it back exactly where it started.
//      `legacyInsertBeforeByName` is that code, kept in the source it
//      disproves; if it ever stops returning the input unchanged this fixture
//      is modelling something other than the reported bug.
//
//   2. Everything after the drop changed column. A field's position is its
//      index (2026-09-03, deliberately — one fact), so the section is a
//      reading-order flow and pulling a field out of the middle shifts every
//      field after it by one, which in two columns flips left and right for
//      each of them.
//
// The fix is that a drop can now name a CELL. Dropping on a cell swaps the two
// occupants — nothing else in the section moves, ever — while the insertion
// lines in the gutters keep the re-flowing behaviour for reordering. Both are
// checked here against the production arrays, together with the invariant that
// makes the swap trustworthy: every field the section did not name keeps the
// exact row and column it had.
//
// Run with:  node scripts/field-group-placement-fixture.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { packFieldGroupRows, fieldColumnPositions } from '../src/lib/fieldGroupLayout.js'
import {
  FIELD_CELL_PREFIX, FIELD_INSERT_PREFIX, FIELD_BLANK_PREFIX, FIELD_ZONE_SUFFIX,
  fieldCellDragId, fieldInsertDropId, fieldBlankDropId, fieldZoneDropId, parseFieldDropId,
  applyFieldDropWithinGroup, moveFieldToSlot, swapFieldCells, trimTrailingSpacers,
  removeFieldAt, insertFieldIntoGroup, isSpacer, legacyInsertBeforeByName,
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
// page_layout_widgets.widget_config on 2026-09-05. Short names here; the real
// column names are in the layout and none of this rule looks at them.
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

// Where every named field sits, so "nothing else moved" can be asserted as a
// fact about the rendered grid rather than about the array.
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
function movedFields(before, after) {
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

// ── 1. CONTROL — the drag that did nothing ──────────────────────────────────
// "It's not even allowing me to move it." Building is at index 2 and Project,
// the tile to its right, is at index 3. Under the old rule that drop is the
// identity function.
const legacyOneRight = legacyInsertBeforeByName(INFORMATION, 'Building', 'Project')
check('CONTROL: the old rule made a one-slot forward drag a literal no-op',
  grid(legacyOneRight), BEFORE)
check('CONTROL: and it moved nothing at all', movedFields(INFORMATION, legacyOneRight), [])

// A longer forward drag landed one cell SHORT of the tile it was dropped on:
// dropping Building on AssessorName put it before GasFuelProvider.
const legacyFar = legacyInsertBeforeByName(INFORMATION, 'Building', 'AssessorName')
check('CONTROL: a longer forward drag landed one cell short of the target',
  grid(legacyFar)[3], ['Building', 'AssessorName'])
check('CONTROL: and it re-columned every field it passed',
  movedFields(INFORMATION, legacyFar),
  ['Building', 'GasFuelProvider', 'Project', 'Property', 'PropertyContact'])

// ── 2. The drag he was actually trying to make ──────────────────────────────
// Building onto the cell to its right. A cell drop is a swap.
const swapped = applyFieldDropWithinGroup(INFORMATION, 2, { kind: 'cell', index: 3 })
check('Building moves to the right-hand column', grid(swapped)[1], ['Project', 'Building'])
check('and exactly the two fields named change position',
  movedFields(INFORMATION, swapped), ['Building', 'Project'])
check('every other row is untouched',
  grid(swapped).filter((_, i) => i !== 1), BEFORE.filter((_, i) => i !== 1))

// A swap is symmetric and reversible — dragging it back restores the section.
check('dragging it back restores the section exactly',
  applyFieldDropWithinGroup(swapped, 3, { kind: 'cell', index: 2 }), INFORMATION)

// A swap across rows is still just the two cells.
const across = applyFieldDropWithinGroup(INFORMATION, 2, { kind: 'cell', index: 7 })
check('a swap four rows down still moves only the two fields',
  movedFields(INFORMATION, across), ['AssessorName', 'Building'])
check('Building lands in the exact cell it was dropped on',
  positions(across).Building, '4:2')

// ── 3. Swapping a field with an empty slot ──────────────────────────────────
// The spacer at index 9 is the blank beside "Date Of Iq Assessment". Dropping
// End Time (index 12) onto it puts End Time there and leaves a blank behind —
// which, being trailing, is trimmed rather than stored.
const intoSpacer = applyFieldDropWithinGroup(INFORMATION, 12, { kind: 'cell', index: 9 })
check('a field dropped on an empty slot takes it', grid(intoSpacer)[4], ['DateOfIq', 'EndTimeOfIq'])
check('and the two trailing blanks it left collapse away', grid(intoSpacer), [
  ['Name', 'Opportunity'],
  ['Building', 'Project'],
  ['PropertyContact', 'Property'],
  ['GasFuelProvider', 'AssessorName'],
  ['DateOfIq', 'EndTimeOfIq'],
  ['StartTimeOfIq', '—'],
])
ok('a trailing spacer is not stored — the renderer pads a short row itself',
  !isSpacer(intoSpacer[intoSpacer.length - 1]))

// ── 4. The blank at the end of a short row is a real target ─────────────────
// The last row is "End Time | blank". Dropping Building there is the placement
// that was inexpressible before: it must land in the RIGHT column and leave
// its own cell empty, not append and land on the left.
const intoBlank = applyFieldDropWithinGroup(INFORMATION, 2, { kind: 'blank', index: 13 })
check('a field dropped on the blank half of a row lands in that half',
  grid(intoBlank)[6], ['EndTimeOfIq', 'Building'])
check('and the cell it came from is left empty, not closed up',
  grid(intoBlank)[1], ['·', 'Project'])
check('nothing between the two cells moved',
  movedFields(INFORMATION, intoBlank), ['Building'])

// A blank in the MIDDLE of a group — the row a full-width field cut short —
// resolves to the index of the field that follows it, not to the end.
const WITH_FULL_WIDTH = [F('A'), { ...F('Wide'), full_width: true }, F('B')]
check('a full-width field leaves a blank mid-section',
  grid(WITH_FULL_WIDTH), [['A', '—'], ['Wide'], ['B', '—']])
check('a field dropped into that blank fills it',
  grid(applyFieldDropWithinGroup(WITH_FULL_WIDTH, 2, { kind: 'blank', index: 1 })),
  [['A', 'B'], ['Wide']])

// ── 5. The insertion line still re-flows, which is the point of having it ───
// Dropping Building on the line before AssessorName (slot 7) moves it there.
// Unlike the old rule it lands where the line was, and unlike a swap it does
// re-column what it passed — that is the gesture's whole purpose.
const inserted = applyFieldDropWithinGroup(INFORMATION, 2, { kind: 'insert', index: 7 })
check('an insert lands the field immediately before the line it was dropped on',
  grid(inserted)[3], ['Building', 'AssessorName'])
ok('an insert is allowed to re-flow the fields it passed',
  movedFields(INFORMATION, inserted).length > 1)

// The off-by-one, stated directly: a forward insert must not lose a slot.
check('inserting at the line just after a field is a no-op, not a shift',
  moveFieldToSlot(INFORMATION, 2, 3), INFORMATION)
check('inserting at the line just before a field is a no-op too',
  moveFieldToSlot(INFORMATION, 2, 2), INFORMATION)
check('a forward insert of one full slot really moves one slot',
  grid(moveFieldToSlot(INFORMATION, 2, 4))[1], ['Project', 'Building'])
check('a backward insert lands before the target', moveFieldToSlot(INFORMATION, 3, 0)[0].name, 'Project')

// ── 6. Dropping on the group itself appends ─────────────────────────────────
const appended = applyFieldDropWithinGroup(INFORMATION, 0, { kind: 'zone', index: -1 })
check('a drop with no cell under it appends', appended[appended.length - 1].name, 'Name')

// ── 7. Moving a field to ANOTHER section is a move, not a swap ──────────────
const OCCUPANCY = [F('SqFt'), F('Units'), F('AtticUnits'), F('Bedrooms')]
const taken = removeFieldAt(INFORMATION, 2)
check('the field leaves its old section', taken.field.name, 'Building')
ok('and the section it left closes up rather than keeping a hole',
  !isSpacer(taken.fields[2]) && taken.fields[2].name === 'Project')
check('it lands at the cell it was dropped on in the new section',
  insertFieldIntoGroup(OCCUPANCY, taken.field, { kind: 'cell', index: 1 }).map(f => f.name),
  ['SqFt', 'Building', 'Units', 'AtticUnits', 'Bedrooms'])
check('an empty slot in the receiving section is filled, not displaced',
  insertFieldIntoGroup([F('SqFt'), SP, F('Units')], taken.field, { kind: 'cell', index: 1 }).map(f => f.name),
  ['SqFt', 'Building', 'Units'])
check('a drop on the receiving section itself appends',
  insertFieldIntoGroup(OCCUPANCY, taken.field, { kind: 'zone', index: -1 }).length, 5)

// ── 8. Guards on the primitives ─────────────────────────────────────────────
check('swapping a cell with itself changes nothing', swapFieldCells(INFORMATION, 3, 3), INFORMATION)
check('an out-of-range swap changes nothing', swapFieldCells(INFORMATION, 3, 99), INFORMATION)
check('an out-of-range drag changes nothing',
  applyFieldDropWithinGroup(INFORMATION, 99, { kind: 'cell', index: 1 }), INFORMATION)
check('a drop with no target changes nothing',
  applyFieldDropWithinGroup(INFORMATION, 1, null), INFORMATION)
check('a drop on a cell past the end of the array changes nothing',
  applyFieldDropWithinGroup(INFORMATION, 1, { kind: 'cell', index: 42 }), INFORMATION)
check('trailing spacers are dropped', trimTrailingSpacers([F('A'), SP, SP]).length, 1)
check('an interior spacer is kept — it is the blank an admin placed',
  trimTrailingSpacers([F('A'), SP, F('B')]).length, 3)
check('a group of nothing but spacers collapses', trimTrailingSpacers([SP, SP]), [])

// ── 9. The id grammar ───────────────────────────────────────────────────────
// A section key never contains "::", which is what makes the trailing number
// unambiguous. The blank needs a prefix of its own: a blank at index 13 of a
// 13-entry array and a field at index 13 would otherwise be the same id and
// mean opposite things.
check('a cell id round-trips', parseFieldDropId(fieldCellDragId('sec-7', 4)),
  { kind: 'cell', sectionKey: 'sec-7', index: 4 })
check('an insertion line id round-trips', parseFieldDropId(fieldInsertDropId('sec-7', 0)),
  { kind: 'insert', sectionKey: 'sec-7', index: 0 })
check('a blank id round-trips', parseFieldDropId(fieldBlankDropId('sec-7', 13)),
  { kind: 'blank', sectionKey: 'sec-7', index: 13 })
check('a group id round-trips', parseFieldDropId(fieldZoneDropId('sec-7')),
  { kind: 'zone', sectionKey: 'sec-7', index: -1 })
ok('a blank id is not read as a cell id', !fieldBlankDropId('s', 1).startsWith(FIELD_CELL_PREFIX))
check('a section drag id is not a field target', parseFieldDropId('sec::sec-7'), null)
check('a widget drag id is not a field target', parseFieldDropId('wgt::3'), null)
check('a malformed id is refused rather than guessed at', parseFieldDropId('fld::sec-7'), null)
check('a negative index is refused', parseFieldDropId('fld::sec-7::-1'), null)

// ── 10. The editor really uses this, and nothing re-introduces the old rule ──
const EDITOR = src('src/modules/admin/LayoutCanvasEditor.jsx')
ok('the editor resolves field drops through the shared rule',
  /from '\.\.\/\.\.\/lib\/fieldGroupPlacement'/.test(EDITOR))
ok('the editor no longer resolves a field drop by looking a NAME up in the remainder',
  !/fields\.findIndex\(f => f\.name === overName\)/.test(EDITOR))
ok('field cells are not sortable — a sortable previews an insertion, and a cell drop is a swap',
  !/useSortable\(\{ id: field\.name \}\)/.test(EDITOR) && !/rectSortingStrategy/.test(EDITOR))
ok('the field family resolves collisions by pointer, or the narrow insertion line never wins',
  /pointerWithin\(\{ \.\.\.args, droppableContainers \}\)/.test(EDITOR))
ok('the insertion line is checked before the cell it overlays',
  EDITOR.indexOf('FIELD_INSERT_PREFIX)') < EDITOR.indexOf('FIELD_CELL_PREFIX) ||'))
ok('an empty slot can be added, so a blank cell is authorable and not only inherited',
  /\+ Empty slot/.test(EDITOR))
ok('an empty slot can be dragged to the cell it should blank',
  /function SpacerTile\(\{ sectionKey, index, onRemove \}\)/.test(EDITOR))
ok('the two gestures are stated on screen, not left to be discovered',
  /to swap the two/.test(EDITOR) && /on the line between fields/.test(EDITOR))
ok('the id prefixes the editor filters on are the ones the rule defines',
  /FIELD_BLANK_PREFIX/.test(EDITOR) && /FIELD_ZONE_SUFFIX/.test(EDITOR))
ok('the placement rule is pure — it imports nothing',
  !/^import /m.test(src('src/lib/fieldGroupPlacement.js')))

console.log(failures === 0
  ? `field-group-placement fixture: ${checks} checks passed`
  : `field-group-placement fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
