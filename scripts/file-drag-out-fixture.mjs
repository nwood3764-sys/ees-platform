// Fixture test for dragging a stored file OUT of LEAP.
//
// The gap this covers (Nicholas, 2026-09-01): a file upload on an external
// program form is the one field no pre-filled URL can reach, so the supporting
// documents travel by hand — and they could not even be dragged, only
// downloaded and re-found on disk.
//
// Everything checked here fails SILENTLY in a browser when it is wrong: a drag
// that carries a malformed payload simply drops nothing, or drops the wrong
// bytes under the right name. The two that matter are a colon in the filename
// (the payload's own delimiter) and a storage PATH handed over as if it were a
// URL — the second one drops a copy of LEAP's index page named after the
// document, which is worse than dropping nothing because it looks like it
// worked.
//
// Run with:  node scripts/file-drag-out-fixture.mjs

import {
  DOWNLOAD_URL_FORMAT,
  FALLBACK_MIME_TYPE,
  isDraggableFileUrl,
  dragOutFileName,
  dragOutMimeType,
  downloadUrlPayload,
  canDragOut,
  applyFileDragOut,
} from '../src/lib/fileDragOut.js'

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

const SIGNED = 'https://flyjigrijjjtcsvpgzvk.supabase.co/storage/v1/object/sign/property-documents/a/b.pdf?token=eyJhbGc.eyJleHAiOjF9.sig'

// ── isDraggableFileUrl — rule 2, the one that drops a wrong file ───────────
check('a signed https URL is draggable', isDraggableFileUrl(SIGNED), true)
check('plain http is draggable', isDraggableFileUrl('http://example.org/a.pdf'), true)
// documents.file_url / photos.file_url hold a PATH inside a private bucket.
// Dropped as a URL it resolves against the site root and yields LEAP's own
// index page under the document's name.
check('a bucket path is NOT a URL',
  isDraggableFileUrl('property-documents/8f2/W-9.pdf'), false)
check('a leading-slash path is NOT a URL', isDraggableFileUrl('/documents/W-9.pdf'), false)
check('a blob URL is refused', isDraggableFileUrl('blob:https://x/9d2'), false)
check('a data URL is refused', isDraggableFileUrl('data:application/pdf;base64,AAA'), false)
check('javascript: is refused', isDraggableFileUrl('javascript:alert(1)'), false)
check('empty is refused', isDraggableFileUrl(''), false)
check('null is refused', isDraggableFileUrl(null), false)
check('a non-string is refused', isDraggableFileUrl({ url: SIGNED }), false)
check('canDragOut agrees with it', canDragOut(SIGNED) && !canDragOut('a/b.pdf'), true)

// ── dragOutFileName — rule 1, the delimiter ───────────────────────────────
check('an ordinary name is kept',
  dragOutFileName('Asset Score Report.pdf', SIGNED), 'Asset Score Report.pdf')
// The payload is split on its first two colons. A colon here would eat
// "https" and the browser would fetch a nonsense address.
check('a colon becomes a hyphen',
  dragOutFileName('W-9: LSS Housing.pdf', SIGNED), 'W-9- LSS Housing.pdf')
check('a Windows drive colon becomes a hyphen',
  dragOutFileName('C:Invoice.pdf', SIGNED), 'C-Invoice.pdf')
check('path separators become hyphens',
  dragOutFileName('2026/09/invoice.pdf', SIGNED), '2026-09-invoice.pdf')
check('a backslash path becomes hyphens',
  dragOutFileName('docs\\W-9.pdf', SIGNED), 'docs-W-9.pdf')
check('newlines collapse to a space',
  dragOutFileName('Final\nInvoice.pdf', SIGNED), 'Final Invoice.pdf')
check('runs of whitespace collapse',
  dragOutFileName('Final    Invoice.pdf', SIGNED), 'Final Invoice.pdf')
check('surrounding whitespace is trimmed',
  dragOutFileName('  Invoice.pdf  ', SIGNED), 'Invoice.pdf')
// Unicode is left alone: a filesystem takes it, and mangling a name is worse
// than an unusual one.
check('accents and dashes survive',
  dragOutFileName('Résumé – 2026.pdf', SIGNED), 'Résumé – 2026.pdf')
check('a missing name falls back to the object name',
  dragOutFileName('', SIGNED), 'b.pdf')
check('a missing name and an unreadable URL still yield a name',
  dragOutFileName('', 'not a url'), 'download')
check('a URL-encoded object name is decoded',
  dragOutFileName(null, 'https://x/storage/Asset%20Score.pdf'), 'Asset Score.pdf')

// ── dragOutMimeType ───────────────────────────────────────────────────────
check('a real stored mime is trusted',
  dragOutMimeType('scan.bin', 'application/pdf'), 'application/pdf')
check('a stored mime with parameters is trusted',
  dragOutMimeType('a.txt', 'text/plain'), 'text/plain')
// File.type is '' for anything the uploading browser did not recognise, and
// the column stores that verbatim.
check('an empty stored mime falls to the extension',
  dragOutMimeType('report.pdf', ''), 'application/pdf')
check('a null stored mime falls to the extension',
  dragOutMimeType('model.docx', null),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
check('a junk stored mime falls to the extension',
  dragOutMimeType('photo.jpg', 'binary'), 'image/jpeg')
check('an iPhone capture keeps its real type',
  dragOutMimeType('IMG_0042.heic', null), 'image/heic')
check('a 360 capture is a video', dragOutMimeType('attic.mov', null), 'video/quicktime')
// An .osm energy model has no registered type; a generic binary downloads
// correctly and simply carries no label.
check('an unknown extension is a generic binary',
  dragOutMimeType('101111_Queens_Court.osm', null), FALLBACK_MIME_TYPE)
check('no extension at all is a generic binary',
  dragOutMimeType('Asset Score Report', null), FALLBACK_MIME_TYPE)
check('the extension match is case-insensitive',
  dragOutMimeType('REPORT.PDF', null), 'application/pdf')

// ── downloadUrlPayload ────────────────────────────────────────────────────
check('a complete payload',
  downloadUrlPayload({ fileName: 'Asset Score Report.pdf', url: SIGNED }),
  `application/pdf:Asset Score Report.pdf:${SIGNED}`)
// The URL's own colons and query string are NOT a problem: the format is read
// as the first two colons and then everything else.
check('the URL keeps its scheme colon and query',
  downloadUrlPayload({ fileName: 'a.pdf', url: SIGNED }).split(':').slice(2).join(':'),
  SIGNED)
check('a path yields no payload',
  downloadUrlPayload({ fileName: 'W-9.pdf', url: 'property-documents/a/W-9.pdf' }), null)
check('no url yields no payload', downloadUrlPayload({ fileName: 'W-9.pdf' }), null)
check('no arguments yield no payload', downloadUrlPayload(), null)

// ── applyFileDragOut ──────────────────────────────────────────────────────
function fakeDataTransfer({ refuse = [] } = {}) {
  const data = {}
  return {
    data,
    effectAllowed: 'none',
    setData(format, value) {
      if (refuse.includes(format)) throw new Error(`unsupported format ${format}`)
      data[format] = value
    },
  }
}

let dt = fakeDataTransfer()
check('a good file drag reports carrying a file',
  applyFileDragOut(dt, { fileName: 'Asset Score Report.pdf', url: SIGNED }), true)
check('it writes the file format',
  dt.data[DOWNLOAD_URL_FORMAT], `application/pdf:Asset Score Report.pdf:${SIGNED}`)
check('it writes the link fallbacks', [dt.data['text/uri-list'], dt.data['text/plain']],
  [SIGNED, SIGNED])
check('the drag is a copy, never a move', dt.effectAllowed, 'copy')

// Firefox and Safari have no DownloadURL. Losing the link fallback to that
// throw would leave those browsers dragging nothing at all.
dt = fakeDataTransfer({ refuse: [DOWNLOAD_URL_FORMAT] })
check('a browser without file drag reports no file',
  applyFileDragOut(dt, { fileName: 'a.pdf', url: SIGNED }), false)
check('...but still drags the link', dt.data['text/uri-list'], SIGNED)
check('...and still sets the copy effect', dt.effectAllowed, 'copy')

// The reverse: a host that refuses the text formats must not cost us the file.
dt = fakeDataTransfer({ refuse: ['text/uri-list', 'text/plain'] })
check('refused text formats do not cost the file',
  applyFileDragOut(dt, { fileName: 'a.pdf', url: SIGNED }), true)
check('...and the file format is intact', !!dt.data[DOWNLOAD_URL_FORMAT], true)

dt = fakeDataTransfer()
check('an undraggable row writes NOTHING at all',
  applyFileDragOut(dt, { fileName: 'W-9.pdf', url: 'property-documents/a.pdf' }), false)
check('...not even a link', Object.keys(dt.data), [])
check('a missing DataTransfer is survived', applyFileDragOut(null, { url: SIGNED }), false)

if (failures > 0) {
  console.error(`\nfile-drag-out fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`file-drag-out fixture: ${checks} checks passed`)
