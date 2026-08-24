// ─── heifRendition.js ────────────────────────────────────────────────────────
// Turn a HEIC/HEIF capture into a JPEG the rest of the platform can actually
// work with — decoded ON THE DEVICE, because nothing downstream can.
//
// Why this exists (2026-08-24). iPhones shoot HEIC by default ("High
// Efficiency"). Every HEIC ever uploaded to LEAP failed processing with
// "Unsupported image type": imagescript, which process-photo renders the
// watermark with, reads JPEG/PNG/GIF only. With no watermarked variant, the
// gallery fell back to putting the .heic original in an <img>, and no desktop
// browser can paint that — 66 evidence photos on one work order rendered as
// broken tiles even though downloading them opened the picture fine.
//
// The obvious fix — teach process-photo to decode HEIC — was built and does
// work, but only for the lightest captures. A 4032x3024 iPhone frame first ran
// the edge worker out of MEMORY, and once that was solved it ran out of CPU
// TIME: HEVC decode cost scales with bitstream complexity, so a plain wall
// decodes inside the budget and a detailed room does not. Half the photos on a
// job would process and half would not, unpredictably. That path stays in place
// as a fallback for light files, but it cannot be the answer.
//
// The device has no such ceiling, and this app ALREADY re-encodes JPEGs on the
// device before upload (see photoCompression.js) for exactly the cellular-uplink
// reason. So a HEIC upload now carries two objects: the untouched HEIC original,
// still the archival source of truth, and this decoded JPEG rendition beside it.
// process-photo reads the PIXELS from the rendition and the EXIF from the
// original, so GPS and capture time stay byte-accurate camera data and nothing
// about the evidence chain is weakened.
//
// Fail-safe by design: every failure path returns null and the caller uploads
// the original anyway. Documentation is never blocked (Nicholas, 2026-07-14) —
// a photo that lands unrendered can be repaired later, a photo never taken
// cannot.

// Long edge of the rendition. process-photo caps its watermarked output at
// 2400px, so anything above that is thrown away downstream; matching it keeps
// the rendition an exact stand-in for the pixels the server would have decoded.
export const RENDITION_LONG_EDGE = 2400
export const RENDITION_QUALITY = 0.9

// ── Format sniffing (pure) ──────────────────────────────────────────────────
// Sniff the BYTES, never the extension or the MIME type. Chrome on Windows
// reports an empty File.type for .heic — every one of the 66 rows this defect
// produced has mime_type NULL — and a file picked out of a folder can be named
// anything at all.
//
// ISO base media file format: bytes 4..8 are "ftyp", 8..12 the major brand.
const HEIF_BRANDS = [
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs',
  'mif1', 'msf1', 'avif', 'avis',
]

export function isHeifBytes(bytes) {
  if (!bytes || bytes.length < 16) return false
  const tag = (a, b) => {
    let s = ''
    for (let i = a; i < b; i++) s += String.fromCharCode(bytes[i])
    return s
  }
  if (tag(4, 8) !== 'ftyp') return false
  return HEIF_BRANDS.includes(tag(8, 12))
}

// Name/type check, used only to decide whether reading the header is worth it.
// Deliberately permissive: a false positive costs one 16-byte sniff.
export function looksLikeHeifName(name = '', type = '') {
  const n = String(name).toLowerCase()
  const t = String(type).toLowerCase()
  return n.endsWith('.heic') || n.endsWith('.heif') || n.endsWith('.hif') ||
         t === 'image/heic' || t === 'image/heif' || t === 'image/heic-sequence'
}

// Storage key for the rendition, alongside the original it was decoded from:
//   work_orders/<id>/originals/<uuid>.heic
//   work_orders/<id>/renditions/<uuid>.jpg
// A separate folder (not a suffix on the original's key) so an object listing
// makes it obvious which files are captures and which are derived.
export function renditionPathFor(originalPath) {
  if (!originalPath) return null
  const base = originalPath.split('/').pop() || 'photo'
  const stem = base.replace(/\.[^.]+$/, '')
  const folder = originalPath.replace(/\/originals?\/[^/]+$/, '/renditions')
  if (folder === originalPath) return null // not a path shape we recognise
  return `${folder}/${stem}.jpg`
}

// Target dimensions for a source of sw x sh, long edge capped at maxEdge.
export function renditionDimensions(sw, sh, maxEdge = RENDITION_LONG_EDGE) {
  if (!sw || !sh) return null
  const scale = Math.min(1, maxEdge / Math.max(sw, sh))
  return {
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  }
}

// Which stored object should an <img> actually point at?
//
// Preference order, and the reason for each step:
//   1. storage_path_watermarked — the evidence view: carries the visible step /
//      location / date / GPS tag, and is always a JPEG.
//   2. storage_path_rendition   — device-decoded JPEG for an original the
//      server cannot read. Present while a HEIC is awaiting its watermark, and
//      the reason a HEIC capture is visible at all.
//   3. storage_path_original    — ONLY when a browser can paint it.
//
// That last condition is the whole point. The old code fell through to the
// original unconditionally, so a HEIC with no watermarked variant put a .heic
// in an <img> and the tile rendered as a broken image with nothing explaining
// why — the file downloaded and opened perfectly, which made it look like a
// gallery bug rather than an unprocessed photo. Never hand the browser bytes it
// cannot paint; say the photo is not rendered yet instead.
export function browserRenderablePath(path) {
  if (!path) return false
  const ext = String(path).toLowerCase().split('?')[0].split('.').pop()
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'].includes(ext)
}

export function displayPathForPhoto(photo) {
  if (!photo) return null
  if (photo.storage_path_watermarked) return photo.storage_path_watermarked
  if (photo.storage_path_rendition) return photo.storage_path_rendition
  if (browserRenderablePath(photo.storage_path_original)) return photo.storage_path_original
  return null
}

// ── Decoding (browser only) ─────────────────────────────────────────────────
// libheif-js is the reference emscripten build of libheif (LGPL-3.0, used
// unmodified). ~1.3 MB, so it is imported lazily and lands in its own chunk —
// a session that never touches a HEIC never downloads it.
let heifModulePromise = null
function loadHeifModule() {
  if (!heifModulePromise) {
    heifModulePromise = import('libheif-js/wasm-bundle.js')
      .then(m => m?.default ?? m)
      .catch(err => { heifModulePromise = null; throw err })
  }
  return heifModulePromise
}

/**
 * Decode HEIF bytes to a JPEG Blob.
 *
 * @param {Uint8Array|ArrayBuffer} input  raw HEIF file bytes
 * @param {Object} [opts]
 * @param {number} [opts.maxEdge]  long-edge cap (default RENDITION_LONG_EDGE)
 * @param {number} [opts.quality]  JPEG quality 0..1 (default RENDITION_QUALITY)
 * @returns {Promise<Blob|null>}   null on any failure — never throws
 */
export async function decodeHeifToJpegBlob(input, opts = {}) {
  const maxEdge = opts.maxEdge ?? RENDITION_LONG_EDGE
  const quality = opts.quality ?? RENDITION_QUALITY
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!isHeifBytes(bytes)) return null
  if (typeof document === 'undefined') return null

  let decoder = null
  let frames = null
  try {
    const libheif = await loadHeifModule()
    decoder = new libheif.HeifDecoder()
    frames = decoder.decode(bytes)
    if (!frames || frames.length === 0) return null
    const frame = frames[0]
    const sw = frame.get_width()
    const sh = frame.get_height()
    if (!sw || !sh) return null

    // libheif writes row-major RGBA, which is exactly ImageData's layout.
    const rgba = new Uint8ClampedArray(sw * sh * 4)
    const ok = await new Promise((resolve) => {
      try {
        frame.display({ width: sw, height: sh, data: rgba }, (out) => resolve(!!out))
      } catch { resolve(false) }
    })
    if (!ok) return null

    const full = document.createElement('canvas')
    full.width = sw
    full.height = sh
    const fullCtx = full.getContext('2d')
    if (!fullCtx) return null
    fullCtx.putImageData(new ImageData(rgba, sw, sh), 0, 0)

    // Scale through drawImage rather than sampling by hand: the browser's
    // resampler is both better and far faster than anything we would write.
    const dims = renditionDimensions(sw, sh, maxEdge)
    let out = full
    if (dims.width !== sw || dims.height !== sh) {
      out = document.createElement('canvas')
      out.width = dims.width
      out.height = dims.height
      const ctx = out.getContext('2d')
      if (!ctx) return null
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(full, 0, 0, dims.width, dims.height)
    }

    const blob = await new Promise(resolve => out.toBlob(resolve, 'image/jpeg', quality))
    // No EXIF is spliced in here on purpose. The HEIC original is uploaded
    // alongside and process-photo reads the camera metadata out of THAT, so the
    // rendition only ever has to carry pixels — and there is exactly one
    // implementation of HEIF EXIF extraction in the platform, server-side.
    return blob || null
  } catch {
    return null
  } finally {
    try { for (const f of (frames || [])) f?.free?.() } catch { /* noop */ }
  }
}

/**
 * Convenience wrapper over a File. Returns null when the file is not HEIF or
 * cannot be decoded, so callers can treat "no rendition" as the normal path.
 */
export async function heifRenditionForFile(file, opts = {}) {
  if (!file) return null
  try {
    // Read the header first and only pull the whole file once it really is HEIF.
    const header = new Uint8Array(await file.slice(0, 32).arrayBuffer())
    if (!isHeifBytes(header)) return null
    const bytes = new Uint8Array(await file.arrayBuffer())
    return await decodeHeifToJpegBlob(bytes, opts)
  } catch {
    return null
  }
}
