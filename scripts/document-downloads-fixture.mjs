// Fixture test for downloading documents out of a record's Documents card.
//
// The gap this covers (Nicholas, 2026-08-24): the Documents card had no
// multi-select and no download action at all — a file came down one at a time
// through the preview modal's "Open in new tab". Selecting nine Asset Score
// files and pressing Download now zips them, so the naming rules below are
// what stand between a real program filename and a zip full of "document",
// "document", "document".
//
// Run with:  node scripts/document-downloads-fixture.mjs

import {
  splitFileName,
  documentFileName,
  uniqueEntryName,
  documentsZipName,
  pruneSelectedIds,
} from '../src/lib/documentDownloads.js'

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

// ── splitFileName ──────────────────────────────────────────────────────────
check('splits a plain extension', splitFileName('report.pdf'), { base: 'report', ext: '.pdf' })
check('splits on the LAST dot only',
  splitFileName('101111_Queens_Court_recommend_36582.fixed.osm'),
  { base: '101111_Queens_Court_recommend_36582.fixed', ext: '.osm' })
check('no dot means no extension', splitFileName('Asset Score Report'),
  { base: 'Asset Score Report', ext: '' })
// A trailing sentence fragment is not an extension — splitting here would put
// " Janesville" where the suffix belongs.
check('a long tail is not an extension', splitFileName('1837 Alden Rd. Janesville'),
  { base: '1837 Alden Rd. Janesville', ext: '' })
check('a non-alphanumeric tail is not an extension', splitFileName('Rev. 2 (final)'),
  { base: 'Rev. 2 (final)', ext: '' })
check('a trailing dot is not an extension', splitFileName('draft.'),
  { base: 'draft.', ext: '' })
check('a dotfile keeps its whole name', splitFileName('.osm'), { base: '.osm', ext: '' })

// ── documentFileName ───────────────────────────────────────────────────────
// The nine real files on 101 - 111 Queens Court survive verbatim.
check('a real program filename is unchanged',
  documentFileName({ name: '101 - 111 Queens Court - Rocky Mount - Improved - Asset Score Report.pdf' }),
  '101 - 111 Queens Court - Rocky Mount - Improved - Asset Score Report.pdf')
check('a weather file is unchanged',
  documentFileName({ name: 'USA_NC_Rocky.Mount-Wilson.AP.723068_TMY3.epw' }),
  'USA_NC_Rocky.Mount-Wilson.AP.723068_TMY3.epw')
check('a model file is unchanged',
  documentFileName({ name: '101111_Queens_Court_current_36582.fixed.osm' }),
  '101111_Queens_Court_current_36582.fixed.osm')

// A name is never allowed to write outside the zip's root.
check('path separators are flattened',
  documentFileName({ name: '../../etc/passwd.pdf' }), '..-..-etc-passwd.pdf')
check('a windows path is flattened',
  documentFileName({ name: 'C:\\Users\\nick\\report.pdf' }), 'C-Users-nick-report.pdf')

check('unsafe characters are dropped',
  documentFileName({ name: 'Invoice #12/2026 <final>?.pdf' }), 'Invoice 12-2026 final.pdf')
check('runs of whitespace collapse',
  documentFileName({ name: 'Baseline   and    Improved.pdf' }), 'Baseline and Improved.pdf')

// Truncation must never cost the extension — a .pdf that lost its suffix
// opens in nothing.
const long = `${'A'.repeat(140)}.pdf`
check('a long base is truncated', documentFileName({ name: long }), `${'A'.repeat(90)}.pdf`)
check('a truncated name keeps its extension',
  documentFileName({ name: long }).endsWith('.pdf'), true)

// Nothing usable in the name still yields a file you can open, identified by
// the record it came from rather than a bare "document".
check('a nameless document falls back to its id',
  documentFileName({ id: 'abc-123' }), 'document-abc-123')
check('an all-unsafe name falls back to its id',
  documentFileName({ id: 'abc-123', name: '★★★' }), 'document-abc-123')
check('no name and no id still names the file', documentFileName({}), 'document')
check('an undefined document does not throw', documentFileName(undefined), 'document')

// ── uniqueEntryName ────────────────────────────────────────────────────────
// Two uploads of the same file must both land in the zip — silently
// overwriting one is how a submission goes out short a document.
check('a free name is returned as-is', uniqueEntryName('report.pdf', new Set()), 'report.pdf')
check('a collision is numbered before the extension',
  uniqueEntryName('report.pdf', new Set(['report.pdf'])), 'report (2).pdf')
check('numbering continues past the second copy',
  uniqueEntryName('report.pdf', new Set(['report.pdf', 'report (2).pdf'])), 'report (3).pdf')
check('an extensionless collision still numbers',
  uniqueEntryName('report', new Set(['report'])), 'report (2)')
check('an array of used names works too',
  uniqueEntryName('report.pdf', ['report.pdf']), 'report (2).pdf')
check('the used set is not mutated', (() => {
  const used = new Set(['report.pdf'])
  uniqueEntryName('report.pdf', used)
  return used.size
})(), 1)

// ── documentsZipName ───────────────────────────────────────────────────────
check('the card title names the zip', documentsZipName('Documents'), 'documents.zip')
check('a multi-word title hyphenates',
  documentsZipName('Program Applications'), 'program-applications.zip')
check('punctuation is dropped', documentsZipName('Owner Docs (2026)'), 'owner-docs-2026.zip')
check('a blank title falls back', documentsZipName(''), 'documents.zip')
check('an unusable title falls back', documentsZipName('★'), 'documents.zip')
check('an undefined title falls back', documentsZipName(undefined), 'documents.zip')

// ── pruneSelectedIds ───────────────────────────────────────────────────────
check('live selections are kept', pruneSelectedIds(['a', 'b'], ['a', 'b', 'c']), ['a', 'b'])
check('a deleted row is dropped', pruneSelectedIds(['a', 'z'], ['a', 'b']), ['a'])
check('order is preserved', pruneSelectedIds(['c', 'a'], ['a', 'b', 'c']), ['c', 'a'])
// A different record loading into the same card clears the selection outright,
// so a bulk action can never reach rows the user never saw.
check('nothing available clears the selection', pruneSelectedIds(['a'], []), [])
check('an empty selection stays empty', pruneSelectedIds([], ['a']), [])

if (failures > 0) {
  console.error(`\ndocument-downloads fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`document-downloads fixture: ${checks} checks passed`)
