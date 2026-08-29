// ---------------------------------------------------------------------------
// fileKinds — what a file IS, said plainly.
//
// A tile that cannot show a picture should name the format and stop:
// "AutoCAD", "PDF". Not an apology, not a diagnosis, and never a button asking
// the person to run the app's job again (Nicholas, 2026-08-24: "Either renders
// or it doesn't, and just says the file extension, like the AutoCAD. Just say
// AutoCAD" / "you're putting way too much on the user to refresh and try
// again").
//
// The distinction that drives the whole UI:
//
//   not an image        a PDF or a DWG in a photo gallery is not a failure —
//                       it is a document someone filed under photos. Name it.
//                       There is nothing to fix and nothing to offer.
//   an image that
//   would not render    a real problem. The only honest ask is a fresh upload,
//                       because retrying the same bytes changes nothing.
// ---------------------------------------------------------------------------

// Formats a browser can paint directly.
const BROWSER_IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico',
])

// Camera formats that are images but need converting before a browser shows
// them. These are rendered on the device; a failure here is a real fault.
const CONVERTIBLE_IMAGE_EXTENSIONS = new Set(['heic', 'heif', 'tif', 'tiff'])

// Video containers a phone or a laptop produces. `.mov` is the iPhone default
// and `.3gp` still turns up from older Android handsets; both are as much
// evidence as a JPEG is, so they are recognised by name and not left to be
// guessed at from a mime type the browser may not have set.
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', '3gp', 'mkv', 'mpeg', 'mpg'])

// Everything worth naming by the application that made it. Extension → label.
const FORMAT_LABELS = {
  dwg: 'AutoCAD', dxf: 'AutoCAD', rvt: 'Revit', skp: 'SketchUp',
  pdf: 'PDF',
  doc: 'Word', docx: 'Word', rtf: 'Word',
  xls: 'Excel', xlsx: 'Excel', csv: 'Spreadsheet',
  ppt: 'PowerPoint', pptx: 'PowerPoint',
  psd: 'Photoshop', ai: 'Illustrator', indd: 'InDesign', eps: 'EPS',
  zip: 'Archive', rar: 'Archive', '7z': 'Archive',
  mp4: 'Video', mov: 'Video', webm: 'Video', avi: 'Video', '3gp': 'Video',
  m4v: 'Video', mkv: 'Video', mpeg: 'Video', mpg: 'Video',
  mp3: 'Audio', wav: 'Audio', m4a: 'Audio',
  txt: 'Text', xml: 'XML', json: 'JSON',
  heic: 'HEIC', heif: 'HEIF', tif: 'TIFF', tiff: 'TIFF',
  jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP',
  bmp: 'Bitmap', svg: 'SVG', avif: 'AVIF',
  osm: 'OpenStudio', idf: 'EnergyPlus', hpxml: 'HPXML',
}

/** Lowercase extension from a path or filename, without the dot. */
export function extensionOf(pathOrName) {
  const s = String(pathOrName ?? '').split('?')[0].split('#')[0]
  const base = s.split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * Is this something a photo gallery could ever display? True for browser image
 * formats and for camera formats we convert. False for a PDF, a drawing, a
 * spreadsheet — those are documents, not photos.
 */
export function isImageFile(pathOrName, mimeType) {
  const mime = String(mimeType ?? '').toLowerCase()
  if (mime.startsWith('image/')) return true
  // A non-image mime that is actually stated wins over the extension: a PDF
  // labelled application/pdf is a PDF whatever it is called.
  if (mime && !mime.startsWith('image/') && mime !== 'application/octet-stream') return false
  const ext = extensionOf(pathOrName)
  return BROWSER_IMAGE_EXTENSIONS.has(ext) || CONVERTIBLE_IMAGE_EXTENSIONS.has(ext)
}

/**
 * Is this a video? The counterpart to isImageFile, and the reason both exist:
 * a video is EVIDENCE — a 360 pan of an attic, a walk through a mechanical
 * room — and must never be lumped in with the PDFs and drawings as "not a
 * photo". Before 2026-08-27 it was: dropping a video on a Photos card filed it
 * as a nondescript attachment and told the person they had misfiled it.
 *
 * Same precedence as isImageFile — a mime type that actually says what the file
 * is beats the extension, and only a missing or generic mime falls through to
 * the name.
 */
export function isVideoFile(pathOrName, mimeType) {
  const mime = String(mimeType ?? '').toLowerCase()
  if (mime.startsWith('video/')) return true
  if (mime && mime !== 'application/octet-stream') return false
  return VIDEO_EXTENSIONS.has(extensionOf(pathOrName))
}

/** True for an image a browser cannot paint until it is converted. */
export function needsConversion(pathOrName, mimeType) {
  if (!isImageFile(pathOrName, mimeType)) return false
  const ext = extensionOf(pathOrName)
  if (CONVERTIBLE_IMAGE_EXTENSIONS.has(ext)) return true
  const mime = String(mimeType ?? '').toLowerCase()
  return mime === 'image/heic' || mime === 'image/heif'
}

/**
 * A short, human name for the format — what the tile prints when there is no
 * picture to show. Falls back to the bare extension in capitals, which still
 * beats a generic "unsupported": an unknown ".xyz" reads as XYZ.
 */
export function fileTypeLabel(pathOrName, mimeType) {
  const ext = extensionOf(pathOrName)
  if (ext && FORMAT_LABELS[ext]) return FORMAT_LABELS[ext]
  const mime = String(mimeType ?? '').toLowerCase()
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('video/')) return 'Video'
  if (mime.startsWith('audio/')) return 'Audio'
  if (ext) return ext.toUpperCase()
  return 'File'
}
