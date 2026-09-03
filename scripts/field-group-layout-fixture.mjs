// Fixture: a field group's rows never stagger.
//
// Nicholas, 2026-09-03, looking at an account's "Service Provider Information"
// section: "We shouldn't have staggered rows on page layouts. If something's
// like two or three lines, the other ones just need to adjust... There's only
// one field on each side, but they're staggered. This can't happen."
//
// The section held exactly two fields, stored like this:
//
//     [ { name: 'account_fein',               column: 2 },
//       { name: 'account_tax_classification', column: 1 } ]
//
// Two facts described one position — the INDEX (reading order) and a `column`
// number — and nothing kept them in agreement. The page-layout editor wrote
// `column` as a column-FILL model; the record page read it as a row-MAJOR grid
// and set `grid-column-start` from it. CSS grid can only place an item in a
// cell at or after its cursor, so the field pinned to column 1 could not go
// beside the one pinned to column 2 that preceded it: it dropped to the next
// row and left the cell next to its neighbour empty. Two fields, four quarters,
// two blank.
//
// The CONTROL cases below run that OLD placement over the same configs and MUST
// come back with holes. If they ever stop producing holes this fixture is
// modelling something other than CSS grid's sparse packing and every check
// under it is worthless.
//
// The other half of "staggered" — a two-line value pushing its own separator
// below its neighbour's — is a rendering fact (one rule per ROW, cells
// stretched), not a placement one, so it is proved in a real browser by
// `npm run verify:page-layout-alignment`. Reading the CSS is not verification.
//
// Run with:  node scripts/field-group-layout-fixture.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  packFieldGroupRows, resolveFieldGroupColumns, fieldColumnPositions,
  fieldSpansRow, fieldsForRenderedColumns, isLayoutSpacer, rowHasContent,
  FIELD_GROUP_DEFAULT_COLUMNS, FIELD_GROUP_MIN_COLUMN_WIDTH,
} from '../src/lib/fieldGroupLayout.js'

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

// ── The pre-fix placement, kept here as a CONTROL ───────────────────────────
// CSS grid, `grid-auto-flow: row`, every item carrying an explicit
// grid-column-start. Sparse packing: the cursor never moves backwards, so an
// item whose column has already been passed starts a new row and the cells it
// skipped stay empty. `holes` is what a reader sees as the stagger.
function placeTheOldWay(fields, columns = 2) {
  let row = 0
  let col = 1
  // `interior` is a slot skipped to get to a field that comes AFTER it — the
  // gap that reads as a stagger. `trailing` is the unused tail of the last row,
  // which the new rule pads with a blank cell so the row's rule still spans the
  // section. Both were blank quarters on Nicholas's screenshot.
  let interior = 0
  const placed = []
  for (const f of fields) {
    const want = f.full_width ? 1 : (f.column === 2 ? 2 : 1)
    const span = f.full_width ? columns : 1
    if (want < col || (span > 1 && col > 1)) { interior += (columns - col + 1); row += 1; col = 1 }
    if (want > col) { interior += want - col; col = want }
    placed.push({ name: f.name, row, column: col, span })
    col += span
    if (col > columns) { row += 1; col = 1 }
  }
  const trailing = col > 1 ? columns - col + 1 : 0
  return { placed, interior, trailing, total: interior + trailing }
}

const grid = (fields, columns) =>
  packFieldGroupRows(fields, columns).map(r => r.cells.map(c => (c.blank ? '—' : c.field.name)))

// ── 1. The reported section ─────────────────────────────────────────────────
const REPORTED = [
  { name: 'account_fein', label: 'Tax Identification FEIN', column: 2 },
  { name: 'account_tax_classification', label: 'Tax Classification', column: 1 },
]
const reportedOld = placeTheOldWay(REPORTED, 2)
check('CONTROL — the reported section painted 2 blank quarters before the fix',
  [reportedOld.interior, reportedOld.trailing, reportedOld.total], [1, 1, 2])
check('CONTROL — FEIN sat alone on row 0, right-hand slot',
  reportedOld.placed[0], { name: 'account_fein', row: 0, column: 2, span: 1 })
check('CONTROL — Tax Classification was pushed to row 1',
  reportedOld.placed[1].row, 1)

// Post-migration the section stores the two fields in reading order with no
// `column` at all. One row, both fields, nothing blank.
const REPORTED_FIXED = [
  { name: 'account_tax_classification', label: 'Tax Classification' },
  { name: 'account_fein', label: 'Tax Identification FEIN' },
]
check('the reported section is one row of two fields',
  grid(REPORTED_FIXED, 2), [['account_tax_classification', 'account_fein']])

// ── 2. No hole, ever, whatever order the columns were written in ────────────
// Every stored `column` sequence that produced a stagger on prod, replayed.
// The old placement must leave holes; the new rule must not, and must keep the
// fields in the order they are read in.
const REAL_SEQUENCES = [
  { label: 'accounts · Service Provider Information', cols: 2, columns: [2, 1] },
  { label: 'accounts · System Information',           cols: 2, columns: [2, 2, 1, 2, 1, 1] },
  { label: 'properties · Property Characteristics',   cols: 2, columns: [1, 1, 2, 2, 1] },
  { label: 'units · Unit Information',                cols: 2, columns: [1, 2, 2, 1] },
  { label: 'products · Manufacture Information',      cols: 2, columns: [null, null, null, null, null, null, null, null, null, null, 2] },
  { label: 'enrollments · Information',               cols: 2, columns: [null, null, null, 1, 2, 1, null] },
  { label: 'buildings · Utility Information',         cols: 2, columns: [2, 2, 1, 1] },
  { label: 'incentive_applications · Incentive Info', cols: 2, columns: [2, 1, 1] },
]
for (const seq of REAL_SEQUENCES) {
  const fields = seq.columns.map((c, i) => (c == null ? { name: `f${i}` } : { name: `f${i}`, column: c }))
  const old = placeTheOldWay(fields, seq.cols)
  ok(`CONTROL — ${seq.label} used to skip a slot to reach a later field`, old.interior > 0)

  // The new rule reads no `column` at all, so the same field list packs tight.
  const stripped = fields.map(({ column, ...rest }) => rest)   // eslint-disable-line no-unused-vars
  const rows = packFieldGroupRows(stripped, seq.cols)
  const cellsPerRow = rows.map(r => r.cells.reduce((n, c) => n + c.span, 0))
  check(`${seq.label} — every row is exactly ${seq.cols} slots wide`,
    cellsPerRow, rows.map(() => seq.cols))
  const blanksBeforeEnd = rows.slice(0, -1).flatMap(r => r.cells).filter(c => c.blank).length
  check(`${seq.label} — no blank slot before the last row`, blanksBeforeEnd, 0)
  const readBack = rows.flatMap(r => r.cells.filter(c => !c.blank).map(c => c.field.name))
  check(`${seq.label} — reading order is the array order`, readBack, stripped.map(f => f.name))
}

// ── 3. A short final row is padded, not left ragged ─────────────────────────
// "If something's like two or three lines, the other ones just need to adjust":
// a row that runs out of fields still spans the section, so its rule runs edge
// to edge instead of stopping halfway across.
check('a 5-field 2-column group pads its last row',
  grid([1, 2, 3, 4, 5].map(i => ({ name: `f${i}` })), 2),
  [['f1', 'f2'], ['f3', 'f4'], ['f5', '—']])
check('a lone field fills its row with one blank beside it',
  grid([{ name: 'only' }], 2), [['only', '—']])
check('a 1-column section never pads', grid([{ name: 'a' }, { name: 'b' }], 1), [['a'], ['b']])

// ── 4. Full width ───────────────────────────────────────────────────────────
ok('full_width is what makes a field span', fieldSpansRow({ full_width: true }))
ok('a plain field does not span', !fieldSpansRow({ name: 'x' }))
check('a full-width field takes the whole row and starts a fresh one',
  grid([{ name: 'a' }, { name: 'wide', full_width: true }, { name: 'b' }], 2),
  [['a', '—'], ['wide'], ['b', '—']])
check('a full-width field at the start of a row does not orphan the row above',
  grid([{ name: 'a' }, { name: 'b' }, { name: 'wide', full_width: true }], 2),
  [['a', 'b'], ['wide']])
check('the spanning cell really spans every column',
  packFieldGroupRows([{ name: 'wide', full_width: true }], 3)[0].cells[0].span, 3)
check('full_width in a 1-column section is still one slot',
  packFieldGroupRows([{ name: 'wide', full_width: true }], 1)[0].cells[0].span, 1)

// ── 5. Spacers hold a slot ──────────────────────────────────────────────────
// The migration wrote 72 of these: the blanks at the bottom of the shorter
// column of a column-fill layout, made explicit so the layout kept its shape
// when `column` was dropped. A spacer is a field like any other to the packer —
// it occupies a slot. It carries no name, which is what keeps the DB's
// widget-config validator from checking it against the object's columns.
const WITH_SPACER = [
  { name: 'contact_first_name' }, { name: 'contact_email' }, { name: 'contact_account_id' },
  { name: 'contact_title' }, { name: 'contact_phone' }, { name: 'contact_department' },
  { name: 'contact_last_name' }, { name: 'contact_mobile_phone' }, { name: 'contact_reports_to_id' },
  { type: 'spacer' }, { type: 'spacer' }, { name: 'contact_linkedin' },
]
const spacerRows = packFieldGroupRows(WITH_SPACER, 3)
check('a column-fill layout keeps its shape through spacers', spacerRows.length, 4)
check('the spacers hold the two slots ahead of the field they preserve',
  spacerRows[3].cells.map(c => (c.blank ? '—' : (c.field.name || 'spacer'))),
  ['spacer', 'spacer', 'contact_linkedin'])
check('a spacer occupies one slot, so the columns above stay in line',
  spacerRows.map(r => r.cells.reduce((n, c) => n + c.span, 0)), [3, 3, 3, 3])

// A real, whole column-fill section: an account's billing address is a stack in
// column 1 beside contact methods in column 2 and relationships in column 3.
// The migration linearised it; packing it back must rebuild the same grid.
const ACCOUNT_INFORMATION = [
  'account_name', 'account_phone', 'parent_account_id',
  'billing_street', 'account_email', 'account_contact_id',
  'billing_city', 'account_website', null,
  'billing_state', null, null,
  'billing_zip',
].map(n => (n == null ? { type: 'spacer' } : { name: n }))
check('the account billing address is still a column, not scattered across rows',
  grid(ACCOUNT_INFORMATION, 3).map(r => r[0]),
  ['account_name', 'billing_street', 'billing_city', 'billing_state', 'billing_zip'])
check('and its last row is padded out to the full three columns',
  grid(ACCOUNT_INFORMATION, 3)[4], ['billing_zip', '—'])
check('the padding is one cell spanning the two empty columns',
  packFieldGroupRows(ACCOUNT_INFORMATION, 3)[4].cells[1].span, 2)

// ── 5b. A section that reflows narrower drops its spacers ───────────────────
// Found in Chromium, not by reading: at 480px the three-column account section
// collapsed to two, its three spacers repacked, two of them landed together and
// painted a row with nothing in it — an empty band between Billing State and
// Billing Zip. A spacer holds a slot in the shape the section was DESIGNED at;
// once that shape is gone it means nothing.
const declared3 = { declaredColumns: 3 }
check('at the designed column count the spacers are kept',
  fieldsForRenderedColumns(ACCOUNT_INFORMATION, { columns: 3, ...declared3 }).length,
  ACCOUNT_INFORMATION.length)
check('reflowed to two columns, the spacers are dropped',
  fieldsForRenderedColumns(ACCOUNT_INFORMATION, { columns: 2, ...declared3 }).map(f => f.name),
  ACCOUNT_INFORMATION.filter(f => f.name).map(f => f.name))
const railRows = packFieldGroupRows(
  fieldsForRenderedColumns(ACCOUNT_INFORMATION, { columns: 2, ...declared3 }), 2)
ok('and no row in the rail is left empty', railRows.every(rowHasContent))
check('the rail lays the ten real fields out in five full rows',
  railRows.map(r => r.cells.filter(c => !c.blank).length), [2, 2, 2, 2, 2])
ok('a row holding only spacers is not drawn',
  !rowHasContent({ cells: [{ field: { type: 'spacer' } }, { blank: true, field: null }] }))
ok('a row holding a real field is drawn',
  rowHasContent({ cells: [{ field: { name: 'a' } }, { blank: true, field: null }] }))
ok('a spacer is recognised by its type', isLayoutSpacer({ type: 'spacer' }))
ok('a real field is not a spacer', !isLayoutSpacer({ name: 'account_fein', type: 'text' }))
// The index alignment that makes the drop safe: the record page filters its
// already-rendered {field, el} pairs through the SAME call, so a dropped spacer
// cannot shift the elements out from under the cells.
const PAIRS = ACCOUNT_INFORMATION.map((f, i) => ({ field: f, el: `el${i}` }))
const keptPairs = fieldsForRenderedColumns(PAIRS, { columns: 2, ...declared3, fieldOf: (p) => p.field })
check('the rendered elements stay aligned with the fields they belong to',
  keptPairs.map(p => p.field.name), ACCOUNT_INFORMATION.filter(f => f.name).map(f => f.name))

// ── 6. How many columns actually render ─────────────────────────────────────
check('a 2-column section in the main flow renders 2',
  resolveFieldGroupColumns({ declared: 2, containerWidth: 800 }), 2)
check('a 3-column section in the 480px right rail renders 2',
  resolveFieldGroupColumns({ declared: 3, containerWidth: 480 }), 2)
check('any section on a phone renders 1',
  resolveFieldGroupColumns({ declared: 3, containerWidth: 350 }), 1)
check('the declared count is a ceiling — a wide card does not invent a 4th column',
  resolveFieldGroupColumns({ declared: 2, containerWidth: 2000 }), 2)
check('before the container is measured the declared count stands',
  resolveFieldGroupColumns({ declared: 3, containerWidth: null }), 3)
check('a section declaring nothing falls back to two',
  resolveFieldGroupColumns({ declared: null, containerWidth: 800 }), FIELD_GROUP_DEFAULT_COLUMNS)
check('a section declaring one column stays at one however wide it gets',
  resolveFieldGroupColumns({ declared: 1, containerWidth: 1600 }), 1)
check('a zero-width container (detached / hidden) does not collapse to zero columns',
  resolveFieldGroupColumns({ declared: 2, containerWidth: 0 }), 2)
// Pinned to the rail, not to a round number: the right rail is 480px and the
// section card inside it takes 1px of border on each side, so 478px must still
// resolve to two columns. A 240 threshold missed it by 2px — measured in
// Chromium, not guessed.
check('the 478px a 2-column section really gets in the right rail resolves to 2',
  resolveFieldGroupColumns({ declared: 2, containerWidth: 478 }), 2)
check('a phone still resolves to 1',
  resolveFieldGroupColumns({ declared: 2, containerWidth: 350 }), 1)
ok('the fitting width is the one the record page uses', FIELD_GROUP_MIN_COLUMN_WIDTH === 230)

// ── 7. Positions ────────────────────────────────────────────────────────────
const POS = fieldColumnPositions([{ name: 'a' }, { name: 'b' }, { name: 'c' }], 2)
check('field 0 is row 1 column 1', POS.get(0), { row: 1, column: 1, span: 1 })
check('field 1 is row 1 column 2', POS.get(1), { row: 1, column: 2, span: 1 })
check('field 2 wraps to row 2 column 1', POS.get(2), { row: 2, column: 1, span: 1 })

// ── 7b. A placeholder section name is not a name ────────────────────────────
// The audit of every layout on 2026-09-03 found 35 sections across 10 objects
// still carrying "New Section" — the label the canvas editor's Add Section
// button writes — each painting that as a heading on a live record page. It is
// the same fact as the "Untitled Section" placeholder the renderer already
// treated as unnamed, so it now gets the same treatment.
const RECORD_DETAIL_SRC = src('src/components/RecordDetail.jsx')
ok('both placeholder section names are treated as unnamed',
  /SECTION_NAME_PLACEHOLDERS = new Set\(\['untitled section', 'new section'\]\)/.test(RECORD_DETAIL_SRC))
ok('and the header is shown only when a section is really named',
  /const hasTitle = !!rawLabel && !SECTION_NAME_PLACEHOLDERS\.has\(rawLabel\.toLowerCase\(\)\)/.test(RECORD_DETAIL_SRC))
ok('the editor still writes that placeholder, which is why the renderer must know it',
  /label: 'New Section'/.test(src('src/modules/admin/LayoutCanvasEditor.jsx')))

// ── 8. Nothing reads or writes a stored column any more ─────────────────────
// The whole point is that the second fact is gone. If a `column` is read back
// into placement, or written by a save, the two models are in play again and
// the stagger returns — which is how it survived a previous round of fixes.
const EDITOR = src('src/modules/admin/LayoutCanvasEditor.jsx')
ok('the record page no longer sets grid-column-start from a field',
  !/gridColumnStart/.test(RECORD_DETAIL_SRC))
ok('the record page no longer reads f.column', !/\bf\.column\b/.test(RECORD_DETAIL_SRC))
ok('the layout editor no longer filters fields by column',
  !/f\.column\s*\|\|\s*1/.test(EDITOR))
ok('the layout editor no longer stamps a column onto a newly placed field',
  !/label: humanize\([^)]*\), column: 1/.test(EDITOR))
ok('both surfaces render from the shared rule',
  /from '\.\.\/lib\/fieldGroupLayout'/.test(RECORD_DETAIL_SRC) &&
  /from '\.\.\/\.\.\/lib\/fieldGroupLayout'/.test(EDITOR))
ok('the field cell no longer carries its own bottom border — the row does',
  /borderBottom: `1px solid \$\{C\.border\}`,\n        \}\}>\n          \{row\.cells/.test(RECORD_DETAIL_SRC))

console.log(failures === 0
  ? `field-group-layout fixture: ${checks} checks passed`
  : `field-group-layout fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
