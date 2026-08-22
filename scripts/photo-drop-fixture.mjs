// Fixture test for desktop photo drops on a work step prompt.
//
// Nicholas, 2026-08-22: on the desktop the photos for a step are already in a
// folder — he needs to drag them onto the prompt, not click through the file
// dialog one at a time — and when he did use the dialog, the upload ran with
// nothing on screen saying so, which read as a failure.
//
// What matters here is what a drop is allowed to turn into. A drop carries
// whatever the OS put on the clipboard, so anything that isn't a photo has to
// be filtered out BEFORE it is uploaded (the storage bucket's rejection names
// a MIME type, not a file) and the user has to be told it was skipped rather
// than watching it vanish.
//
// Run with:  node scripts/photo-drop-fixture.mjs

import {
  isImageFile,
  imageFilesFrom,
  imageFilesFromDrop,
  dragCarriesFiles,
  uploadProgressLabel,
  uploadResultLabel,
} from '../src/lib/photoDrop.js'

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

const file = (name, type) => ({ name, type })

// ── What counts as a photo ─────────────────────────────────────────────────
check('jpeg by mime', isImageFile(file('a.jpg', 'image/jpeg')), true)
check('png by mime', isImageFile(file('a.png', 'image/png')), true)
check('heic by mime', isImageFile(file('IMG_0001.HEIC', 'image/heic')), true)
// Safari and several file managers hand over an iPhone photo with no type at
// all; the extension is the only thing left to go on.
check('heic with no mime', isImageFile(file('IMG_0001.HEIC', '')), true)
check('jpg with no mime', isImageFile(file('DSC_1234.JPG', '')), true)
check('pdf is not a photo', isImageFile(file('report.pdf', 'application/pdf')), false)
check('video is not a photo', isImageFile(file('clip.mp4', 'video/mp4')), false)
check('spreadsheet is not a photo', isImageFile(file('units.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')), false)
// A dragged FOLDER arrives as a typeless, extensionless File. Uploading it
// creates a 0-byte object that satisfies nothing.
check('a dragged folder is not a photo', isImageFile(file('Site Photos', '')), false)
check('typeless with an unknown extension', isImageFile(file('notes.txt', '')), false)
check('null', isImageFile(null), false)
check('undefined', isImageFile(undefined), false)

// ── Picking the photos out of a selection ──────────────────────────────────
const mixed = [
  file('front.jpg', 'image/jpeg'),
  file('report.pdf', 'application/pdf'),
  file('rear.HEIC', ''),
  file('Site Photos', ''),
  file('roof.png', 'image/png'),
]
check('only the photos, in order',
  imageFilesFrom(mixed).map(f => f.name), ['front.jpg', 'rear.HEIC', 'roof.png'])
check('empty selection', imageFilesFrom([]), [])
check('null selection', imageFilesFrom(null), [])
check('undefined selection', imageFilesFrom(undefined), [])

const drop = imageFilesFromDrop({ files: mixed })
check('drop keeps the photos', drop.files.map(f => f.name), ['front.jpg', 'rear.HEIC', 'roof.png'])
check('drop counts what it skipped', drop.rejected, 2)
check('drop of nothing', imageFilesFromDrop({ files: [] }), { files: [], rejected: 0 })
check('drop with no dataTransfer', imageFilesFromDrop(null), { files: [], rejected: 0 })
check('drop of only non-photos still reports them',
  imageFilesFromDrop({ files: [file('a.pdf', 'application/pdf')] }), { files: [], rejected: 1 })

// ── When the drop zone should light up ─────────────────────────────────────
check('files light it up', dragCarriesFiles({ types: ['Files'] }), true)
check('firefox file drag', dragCarriesFiles({ types: ['application/x-moz-file'] }), true)
// Dragging a text selection or a link across the prompt must NOT arm it.
check('a text selection does not', dragCarriesFiles({ types: ['text/plain'] }), false)
check('a link does not', dragCarriesFiles({ types: ['text/uri-list', 'text/plain'] }), false)
check('no types', dragCarriesFiles({}), false)
check('no dataTransfer', dragCarriesFiles(null), false)

// ── What the screen says while it works ────────────────────────────────────
check('single photo', uploadProgressLabel(0, 1), 'Uploading photo…')
check('batch start', uploadProgressLabel(0, 12), 'Uploading photo 1 of 12…')
check('batch middle', uploadProgressLabel(5, 12), 'Uploading photo 6 of 12…')
// Never "photo 13 of 12" on the last tick.
check('batch end never overshoots', uploadProgressLabel(12, 12), 'Uploading photo 12 of 12…')
check('nothing in flight', uploadProgressLabel(0, 0), '')

check('all uploaded', uploadResultLabel({ uploaded: 12 }), '12 photos uploaded')
check('one uploaded', uploadResultLabel({ uploaded: 1 }), '1 photo uploaded')
check('some failed', uploadResultLabel({ uploaded: 10, failed: 2 }), '10 photos uploaded · 2 failed')
check('some skipped', uploadResultLabel({ uploaded: 3, rejected: 2 }),
  '3 photos uploaded · 2 skipped (not an image)')
check('nothing usable in the drop', uploadResultLabel({ rejected: 4 }), '4 skipped (not an image)')
check('nothing at all', uploadResultLabel({}), '')

if (failures > 0) {
  console.error(`\nphoto-drop fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`photo-drop fixture: ${checks} checks passed`)
