// ─── photoCompression.js ─────────────────────────────────────────────────────
// Client-side photo shrink for evidence uploads, built for slow job-site
// cellular uplinks: a 5–8 MB phone original becomes a ~400–800 KB JPEG
// (long edge capped, quality re-encoded) BEFORE it ever leaves the device,
// which is where virtually all of the perceived "upload is slow" time goes.
//
// The platform's hard requirement is that EXIF survives — GPS + timestamp
// above all (process-photo extracts them server-side and they anchor the
// evidence). Canvas re-encoding strips EXIF, so this module:
//
//   1. Extracts the original JPEG's APP1 (Exif) segment BYTES verbatim.
//   2. Decodes the image with EXIF orientation applied (pixels upright).
//   3. Re-encodes via canvas at capped size, then splices the original APP1
//      back in right after the SOI marker — GPS, timestamps, camera fields
//      all byte-identical to what the camera wrote.
//   4. Patches exactly ONE value inside the copied EXIF: Orientation → 1,
//      because the pixels are now physically upright; leaving the original
//      rotation flag would double-rotate in every EXIF-aware viewer.
//
// Fail-safe by design: ANY doubt — non-JPEG input, EXIF we can't parse,
// canvas failure, or a "compressed" result that isn't meaningfully smaller —
// returns the ORIGINAL file untouched, so the worst case is today's
// behavior, never corrupted evidence.

const LONG_EDGE_MAX   = 2048   // px — plenty for insulation/fixture evidence review
const JPEG_QUALITY    = 0.82
const SKIP_UNDER_BYTES = 700 * 1024 // small files aren't worth touching
const MIN_SAVINGS      = 0.85  // keep result only if ≤85% of original size

// ── JPEG byte helpers (pure functions, unit-testable in Node) ───────────────

// Return {start, length} of the APP1/Exif segment in a JPEG buffer, or null.
export function findExifSegment(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null // not SOI
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null // lost sync
    const marker = bytes[i + 1]
    if (marker === 0xda || marker === 0xd9) return null // SOS/EOI: image data begins, no EXIF found
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]   // includes the 2 length bytes
    if (segLen < 2 || i + 2 + segLen > bytes.length) return null
    if (marker === 0xe1 &&
        bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && // "Ex"
        bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66 && // "if"
        bytes[i + 8] === 0x00 && bytes[i + 9] === 0x00) {
      return { start: i, length: 2 + segLen }
    }
    i += 2 + segLen
  }
  return null
}

// In a copied APP1/Exif segment, set IFD0's Orientation tag (0x0112) to 1.
// Mutates `seg` in place. Returns true if the tag was found and patched, or
// was absent (absent = fine, viewers assume 1); false when the TIFF structure
// can't be parsed safely — caller should then abandon compression.
export function patchOrientationToOne(seg) {
  // Segment layout: FF E1 <len:2> "Exif\0\0" <TIFF...>
  const tiff = 10 // offset of TIFF header within the segment
  if (seg.length < tiff + 8) return false
  const little = seg[tiff] === 0x49 && seg[tiff + 1] === 0x49       // "II"
  const big    = seg[tiff] === 0x4d && seg[tiff + 1] === 0x4d       // "MM"
  if (!little && !big) return false
  const u16 = (o) => little ? (seg[o] | (seg[o + 1] << 8)) : ((seg[o] << 8) | seg[o + 1])
  const u32 = (o) => little
    ? (seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16) | (seg[o + 3] << 24)) >>> 0
    : ((seg[o] << 24) | (seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]) >>> 0
  if (u16(tiff + 2) !== 0x002a) return false
  const ifd0 = tiff + u32(tiff + 4)
  if (ifd0 + 2 > seg.length) return false
  const entryCount = u16(ifd0)
  for (let n = 0; n < entryCount; n++) {
    const e = ifd0 + 2 + n * 12
    if (e + 12 > seg.length) return false
    if (u16(e) === 0x0112) { // Orientation, SHORT, count 1, value inline
      if (little) { seg[e + 8] = 1; seg[e + 9] = 0 }
      else        { seg[e + 8] = 0; seg[e + 9] = 1 }
      return true
    }
  }
  return true // no orientation tag → nothing to patch
}

// Splice an APP1/Exif segment into a JPEG right after SOI. Returns a new
// Uint8Array, or null if the target isn't a JPEG.
export function spliceExifIntoJpeg(jpegBytes, exifSeg) {
  if (jpegBytes.length < 2 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) return null
  const out = new Uint8Array(jpegBytes.length + exifSeg.length)
  out.set(jpegBytes.subarray(0, 2), 0)
  out.set(exifSeg, 2)
  out.set(jpegBytes.subarray(2), 2 + exifSeg.length)
  return out
}

// ── Browser-side compression ────────────────────────────────────────────────

async function decodeUpright(file) {
  // 'from-image' bakes the EXIF rotation into the pixels, which is exactly
  // why the spliced EXIF gets its Orientation patched to 1 afterwards.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch { /* fall through to <img> path */ }
  }
  // <img> decoding applies EXIF orientation by default in modern browsers
  // (CSS image-orientation: from-image is the default).
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image decode failed')) }
    img.src = url
  })
}

/**
 * Shrink a JPEG evidence photo for upload, preserving its EXIF verbatim.
 * Returns a new File, or the ORIGINAL file whenever compression is not
 * applicable or not clearly worth it. Never throws.
 */
export async function compressPhotoForUpload(file) {
  try {
    if (!file || file.type !== 'image/jpeg' || file.size < SKIP_UNDER_BYTES) return file

    const originalBytes = new Uint8Array(await file.arrayBuffer())
    const exifLoc = findExifSegment(originalBytes)
    // No EXIF to preserve is unexpected for camera captures — compress anyway,
    // there's simply nothing to splice.
    let exifSeg = null
    if (exifLoc) {
      exifSeg = originalBytes.slice(exifLoc.start, exifLoc.start + exifLoc.length)
      if (!patchOrientationToOne(exifSeg)) return file // unparseable EXIF → don't touch the photo
    }

    const img = await decodeUpright(file)
    const w = img.width || img.naturalWidth
    const h = img.height || img.naturalHeight
    if (!w || !h) return file
    const scale = Math.min(1, LONG_EDGE_MAX / Math.max(w, h))
    const outW = Math.max(1, Math.round(w * scale))
    const outH = Math.max(1, Math.round(h * scale))

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, outW, outH)
    if (typeof img.close === 'function') img.close()

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) return file

    let outBytes = new Uint8Array(await blob.arrayBuffer())
    if (exifSeg) {
      const spliced = spliceExifIntoJpeg(outBytes, exifSeg)
      if (!spliced) return file
      outBytes = spliced
    }
    if (outBytes.length >= file.size * MIN_SAVINGS) return file // not worth it

    return new File([outBytes], file.name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}
