// ---------------------------------------------------------------------------
// photoDrop — turning a drop or a file picker into the photos we will upload.
//
// On a phone a work step photo is taken with the camera. At a desk it is
// already in a folder: the assessor has 30 photos off a card and wants to drag
// them onto the prompt (Nicholas, 2026-08-22). A drop carries whatever the OS
// put on the clipboard — folders, PDFs, a dragged browser image, a text
// selection — so the drop has to be filtered down to real image files before
// anything is uploaded, and it has to say clearly when a drop contained
// nothing usable rather than silently doing nothing.
//
// Kept free of React and of Supabase so the rules are testable — see
// scripts/photo-drop-fixture.mjs.
// ---------------------------------------------------------------------------

// Extensions we accept when the browser reports no MIME type, which happens
// for HEIC/HEIF off an iPhone and for files dragged from some file managers.
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif',
])

function extensionOf(name) {
  const s = String(name || '')
  const dot = s.lastIndexOf('.')
  return dot > 0 ? s.slice(dot + 1).toLowerCase() : ''
}

/** True when this File is something we can upload as a photo. */
export function isImageFile(file) {
  if (!file) return false
  const type = String(file.type || '').toLowerCase()
  if (type.startsWith('image/')) return true
  // A directory dragged into the browser arrives as a File with no type and
  // no extension; uploading it produces a 0-byte object, so it is excluded.
  if (type) return false
  return IMAGE_EXTENSIONS.has(extensionOf(file.name))
}

/**
 * The image files in a FileList / array, in the order the user chose them.
 * Anything that isn't an image is dropped here rather than failing later at
 * the storage bucket, where the error names a MIME type instead of a file.
 */
export function imageFilesFrom(fileListOrArray) {
  const files = fileListOrArray ? Array.from(fileListOrArray) : []
  return files.filter(isImageFile)
}

/**
 * Pull the image files out of a drop event's dataTransfer. Returns both what
 * we will upload and how many items were rejected, so the caller can say
 * "2 of 5 files weren't images" instead of appearing to lose them.
 *
 * @returns {{files: File[], rejected: number}}
 */
export function imageFilesFromDrop(dataTransfer) {
  const all = dataTransfer?.files ? Array.from(dataTransfer.files) : []
  const files = all.filter(isImageFile)
  return { files, rejected: all.length - files.length }
}

/**
 * True when a dragenter/dragover carries files at all — a text selection or a
 * link dragged across the window should not light up the drop zone.
 */
export function dragCarriesFiles(dataTransfer) {
  if (!dataTransfer) return false
  const types = dataTransfer.types
  if (!types) return false
  const list = Array.from(types)
  return list.includes('Files') || list.includes('application/x-moz-file')
}

/**
 * What to show while an upload runs. One file gets a plain message; a batch
 * gets a count so the assessor can see it moving instead of guessing.
 */
export function uploadProgressLabel(completed, total) {
  const t = Math.max(0, Number(total) || 0)
  if (t === 0) return ''
  if (t === 1) return 'Uploading photo…'
  return `Uploading photo ${Math.min(t, (Number(completed) || 0) + 1)} of ${t}…`
}

/** What to say once a batch finishes, including anything the drop rejected. */
export function uploadResultLabel({ uploaded = 0, failed = 0, rejected = 0 } = {}) {
  const parts = []
  if (uploaded > 0) parts.push(`${uploaded} photo${uploaded === 1 ? '' : 's'} uploaded`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (rejected > 0) parts.push(`${rejected} skipped (not an image)`)
  return parts.join(' · ')
}
