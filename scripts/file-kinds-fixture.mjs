// Fixture test for how a file is named when it cannot be shown as a picture.
//
// Nicholas, 2026-08-24, looking at a .dwg and a .pdf sitting in a work step's
// Photos card as two tiles reading "Could not render / Try again":
// "you shouldn't say try again... Either renders or it doesn't, and just says
// the file extension, like the AutoCAD. Just say AutoCAD."
//
// The distinction these pin: a PDF in a photo gallery is not a failed photo,
// it is a document filed in the wrong place. Nothing to retry, nothing to fix
// — name it and move on. An IMAGE that would not render is a real fault.
//
// Run with:  node scripts/file-kinds-fixture.mjs

import { extensionOf, isImageFile, needsConversion, fileTypeLabel } from '../src/lib/fileKinds.js'

let checks = 0, failures = 0
const check = (label, actual, expected) => {
  checks++
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) { failures++; console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`) }
}

// ── Extensions ─────────────────────────────────────────────────────────────
check('extension from a storage path', extensionOf('work_steps/abc/originals/x.dwg'), 'dwg')
check('extension is lowercased', extensionOf('PLAN.PDF'), 'pdf')
check('a dotfile has no extension', extensionOf('.gitignore'), '')
check('a trailing dot is not an extension', extensionOf('name.'), '')
check('no dot at all', extensionOf('README'), '')
check('a dotted folder does not leak into the name', extensionOf('a.b/plan'), '')

// ── What is actually an image ──────────────────────────────────────────────
check('a jpg is an image', isImageFile('a.jpg'), true)
check('a heic is an image', isImageFile('a.heic'), true)
// The two real files that started this.
check('a dwg is not an image', isImageFile('x.dwg'), false)
check('a pdf is not an image', isImageFile('x.pdf', 'application/pdf'), false)
check('a pdf with no mime recorded is still not an image', isImageFile('x.pdf'), false)
// A stated non-image mime beats a misleading name.
check('a pdf named .jpg is still a pdf', isImageFile('sneaky.jpg', 'application/pdf'), false)
// …but octet-stream says nothing, so fall back to the name. This is the case
// that matters: browsers report an empty or generic type for .heic.
check('octet-stream falls back to the extension', isImageFile('a.heic', 'application/octet-stream'), true)
check('an empty mime falls back to the extension', isImageFile('a.png', ''), true)

// ── Which images need converting before a browser can paint them ──────────
check('heic needs conversion', needsConversion('a.heic'), true)
check('tiff needs conversion', needsConversion('a.tif'), true)
check('jpg does not', needsConversion('a.jpg'), false)
check('a non-image never "needs conversion"', needsConversion('a.dwg'), false)

// ── The label the tile prints ──────────────────────────────────────────────
check('a dwg says AutoCAD', fileTypeLabel('x.dwg'), 'AutoCAD')
check('a dxf says AutoCAD too', fileTypeLabel('x.dxf'), 'AutoCAD')
check('a pdf says PDF', fileTypeLabel('x.pdf'), 'PDF')
check('a docx says Word', fileTypeLabel('x.docx'), 'Word')
check('a heic says HEIC', fileTypeLabel('x.heic'), 'HEIC')
// An unknown format still reads better as its own extension than as a generic
// "unsupported file".
check('an unknown extension is printed in capitals', fileTypeLabel('x.xyz'), 'XYZ')
check('mime carries the label when the name has no extension',
  fileTypeLabel('blob', 'application/pdf'), 'PDF')
check('a video is named from its mime', fileTypeLabel('blob', 'video/mp4'), 'Video')
check('nothing to go on still yields a word, never blank', fileTypeLabel('', ''), 'File')

if (failures > 0) {
  console.error(`\nfile-kinds fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`file-kinds fixture: ${checks} checks passed`)
