// ---------------------------------------------------------------------------
// fileDragOut — dragging a stored file OUT of LEAP.
//
// Nicholas (2026-09-01), on the Focus on Energy payment request Jotform:
// "another workaround is if we can just have the user click and drag the file
// from LEAP over to the JotForm. Currently, I can't drag files off of LEAP."
//
// A file upload is the one part of an external form that no pre-filled URL can
// ever reach — browsers forbid a page from putting bytes into a file input, and
// that is a security rule, not a limitation of the form. So the supporting
// documents have to travel by hand. Today they travel the long way: download
// to disk, find the download, browse to it in the other tab. Dragging is the
// short way, and it is the browser's own supported mechanism.
//
// THE MECHANISM. On `dragstart`, a page may write the `DownloadURL` format:
//
//     "<mime>:<filename>:<absolute url>"
//
// The browser then treats the drag as carrying a FILE it has not fetched yet,
// and fetches it when the drag is dropped. Chrome and Edge implement this;
// Firefox and Safari do not, so those get a plain link drag instead of a file
// (`text/uri-list`), which is why every format is written and none is assumed.
//
// TWO RULES THIS MODULE EXISTS TO ENFORCE, both of which are silent when
// broken — a failed drag reports nothing at all:
//
//   1. THE COLONS ARE STRUCTURAL. The format is split on its first two colons,
//      so a colon in the FILENAME eats the head of the URL and the browser
//      fetches a nonsense address. Names come from what a person typed at
//      upload time, so this is a matter of when, not if.
//
//   2. IT MUST BE AN ABSOLUTE URL, never a storage path. `documents.file_url`
//      and `photos.file_url` hold a PATH inside a private bucket, not an
//      address — the same trap the property owner portal shipped with, where
//      every image rendered broken because a path was handed to the browser as
//      if it were a URL. A path dragged out fetches the site root and drops a
//      copy of LEAP's index page named after the document. Refuse it here, so
//      a caller that reaches for the wrong column drags nothing rather than
//      dropping a plausible-looking wrong file into a program submission.
//
// WHERE THE DROPPED FILE CAN ACTUALLY LAND — measured, not assumed. Driven in
// a real Chromium (CDP drag interception, so this is the drag the browser
// itself started, not a synthetic event):
//
//   dropped on the OS      the browser fetches the URL and writes the file.
//   (desktop, a folder)    This is what DownloadURL exists for, and it is the
//                          reason this module exists: one gesture instead of
//                          download, then find the download.
//
//   dropped on another     the drop target received ONLY `text/plain` and
//   WEB PAGE's dropzone    `text/uri-list` — `dataTransfer.files` was EMPTY.
//                          Chrome does not resolve a DownloadURL into a File
//                          for a page. So dragging straight from LEAP into an
//                          external form's upload box hands that form a link
//                          it will ignore; the file still has to go via the
//                          desktop. Do NOT "fix" this by reordering formats or
//                          adding more — the limit is the browser's.
//
// The signed URL must ALSO be unexpired at the moment the gesture starts:
// `dragstart` is synchronous and cannot await a re-sign. The caller re-signs
// before the drag can begin (on hover) and asks `canDragOut` here.
//
// No React, no network — value in, value out, so
// scripts/file-drag-out-fixture.mjs can pin it.
// ---------------------------------------------------------------------------

/** The drag format Chrome/Edge read as "this drag carries a file". */
export const DOWNLOAD_URL_FORMAT = 'DownloadURL'

/** What a file of unknown type is called. Chrome refuses an empty mime. */
export const FALLBACK_MIME_TYPE = 'application/octet-stream'

// Enough to name what LEAP actually stores and hands to a program: the report
// and model formats, the office formats a submittal arrives in, and the camera
// formats an evidence photo downloads as. Anything else drags as a generic
// binary, which downloads correctly and simply carries no type label.
const MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', xml: 'application/xml', json: 'application/json',
  zip: 'application/zip',
}

/** The extension of a filename, lowercased, without its dot. '' when absent. */
function extensionOf(fileName) {
  const s = String(fileName ?? '').split('?')[0].split('#')[0]
  const dot = s.lastIndexOf('.')
  if (dot <= 0 || dot === s.length - 1) return ''
  const ext = s.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : ''
}

/**
 * True when `url` is an absolute http(s) address the browser can fetch on its
 * own. A storage path, a blob:/data: URL, or anything else is refused — see
 * rule 2 above.
 */
export function isDraggableFileUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The filename the dropped file lands under, made safe for the DownloadURL
 * format and for a filesystem. Colons and path separators are removed (rule 1);
 * so are the control characters that would break the drag payload's line.
 */
export function dragOutFileName(fileName, url) {
  const cleaned = String(fileName ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[:\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned) return cleaned
  // Nothing usable was given: fall back to the last path segment of the URL,
  // which is the storage object's own name, and only then to a bare word.
  try {
    const tail = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
    const safe = tail.replace(/[:\\/]+/g, '-').trim()
    if (safe) return safe
  } catch { /* not a URL we can read a name out of */ }
  return 'download'
}

/**
 * The mime type to advertise: the stored one when it really is a mime type,
 * otherwise one derived from the extension, otherwise the generic binary.
 * A stored value is only trusted when it has the `type/subtype` shape — the
 * column is filled from `File.type`, which is '' for anything the uploading
 * browser did not recognise.
 */
export function dragOutMimeType(fileName, storedMimeType) {
  const stored = String(storedMimeType ?? '').trim()
  if (/^[\w.+-]+\/[\w.+-]+$/.test(stored)) return stored
  return MIME_BY_EXTENSION[extensionOf(fileName)] || FALLBACK_MIME_TYPE
}

/**
 * The `DownloadURL` payload for a file, or null when the file cannot be
 * dragged (no address, or an address that is not one).
 */
export function downloadUrlPayload({ fileName, url, mimeType } = {}) {
  if (!isDraggableFileUrl(url)) return null
  return `${dragOutMimeType(fileName, mimeType)}:${dragOutFileName(fileName, url)}:${url}`
}

/** Whether a row can be dragged out at all — drives the `draggable` attribute. */
export function canDragOut(url) {
  return isDraggableFileUrl(url)
}

/**
 * Write a file drag onto a `dragstart` event's DataTransfer. Returns true when
 * the drag will carry a FILE, false when it carries only a link or nothing.
 *
 * Every format is written independently and each write is allowed to fail on
 * its own: a browser that rejects the `DownloadURL` format throws on setData
 * for it, and losing the link fallback to that throw would mean a browser
 * without file-drag support drags nothing at all.
 */
export function applyFileDragOut(dataTransfer, { fileName, url, mimeType } = {}) {
  if (!dataTransfer) return false
  const payload = downloadUrlPayload({ fileName, url, mimeType })
  if (!payload) return false

  // The link fallbacks first, so they survive a throw from the file format.
  try { dataTransfer.setData('text/uri-list', url) } catch { /* format refused */ }
  try { dataTransfer.setData('text/plain', url) } catch { /* format refused */ }

  let carriesFile = false
  try {
    dataTransfer.setData(DOWNLOAD_URL_FORMAT, payload)
    carriesFile = true
  } catch { /* Firefox and Safari: link drag only */ }

  try { dataTransfer.effectAllowed = 'copy' } catch { /* read-only in some hosts */ }
  return carriesFile
}
