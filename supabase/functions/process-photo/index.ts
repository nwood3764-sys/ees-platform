// process-photo — extracts EXIF and renders a watermarked variant for an
// already-uploaded photo. Called by the client immediately after upload
// completes. Idempotent: safe to re-invoke (e.g. after work_step_id is set
// to re-render the watermark with the new photo tag).
//
// v25 — HEIC/HEIF support:
//   - HEIC originals are decodable, via libheif (WASM), decoded straight to the
//     final watermark size because a full-res intermediate does not fit in an
//     edge worker. iPhones shoot HEIC by
//     default ("High Efficiency") and imagescript cannot read it, so every such
//     upload failed with "Unsupported image type", produced NO watermarked
//     variant, and left the gallery pointing an <img> at the .heic original —
//     which no desktop browser can paint. The file downloaded and opened fine,
//     which is exactly why it read as "broken images".
//   - EXIF comes out of the HEIF container directly (`extractHeifExifTiff`).
//     exifr ships a HEIC parser but its sniff rejects these files outright
//     ("Unknown file format", verified in prod), so GPS and capture time were
//     being lost on every HEIC. Extraction now also retries across exifr's
//     parse modes and reports WHY it came back empty instead of silently
//     collapsing to {}.
//   - HEIF is NOT re-rotated from the EXIF orientation tag: libheif has already
//     applied the container's `irot`, and Apple writes the rotation in both
//     places, so honouring EXIF too would lay every portrait photo on its side.
//   - Watermark path fix: the folder regex looked for "/original/" but every
//     path this platform writes is "/originals/", so the replace never matched
//     and the variant landed at ".../originals/<uuid>.jpg/<uuid>.jpg" — the
//     filename doubled as a folder. New renders write ".../watermarked/<uuid>.jpg".
//     Rows already carrying the doubled key are untouched and still resolve.
//   - PIXELS may come from photos.storage_path_rendition: a JPEG decoded on the
//     device at upload time. The libheif path above works, but only for light
//     captures — a 12 MP frame exceeds this worker's CPU budget whenever the
//     scene is detailed, so it succeeds or fails by subject matter. The device
//     has no such ceiling. EXIF is still read from the ORIGINAL either way.
//
// v9:
//   - Orientation fix: exifr returns EXIF Orientation as a human-readable
//     STRING by default (e.g. "Rotate 90 CW"), not the numeric code. The old
//     `typeof === "number"` guard therefore always saw null and NEVER rotated,
//     so portrait phone photos (orientation 6/8) rendered sideways. Orientation
//     is now normalized from either the numeric code or exifr's string label.
//   - Watermark now includes a location line: Property · Bldg <#> · Unit <#>,
//     resolved from the photo's work order. Strip auto-sizes to its lines.
//   - Batch re-render: an internal service-role path (x-internal-cron-secret
//     matching internal_cron_auth 'photo_rerender') re-processes a list of
//     photo_ids without a per-user JWT, so existing photos can be corrected.
//
// v8: the watermark tag now also resolves from vehicle_activity_items
// (Daily Vehicle Inspection checklist photos carry the item name).
//
// Inputs (JSON body):
//   { photo_id: uuid }                      — single, caller-JWT path
//   { photo_ids: uuid[] }                   — batch, internal-secret path
//
// Behavior (per photo):
//   1. Download original from storage (service role).
//   2. Parse EXIF with exifr — persist to photos.{taken_at, latitude,
//      longitude, altitude, camera_make, camera_model, orientation, exif_raw}.
//   3. If apply_watermark=true: re-orient by EXIF orientation, draw a
//      semi-transparent dark strip across the bottom, render the tag, the
//      location (property/building/unit), date/time UTC, and GPS, encode as
//      JPEG quality 85, upload to .../watermarked/{filename}.
//   4. The original is NEVER modified.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts"
import exifr from "npm:exifr@7.1.3"
import piexif from "npm:piexifjs@1.0.6"
import libheifBundle from "npm:libheif-js@1.18.2/wasm-bundle.js"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!

// ── HEIC / HEIF decoding ────────────────────────────────────────────────────
// imagescript reads JPEG/PNG/GIF only. Apple's default capture format is HEIC,
// so a phone-library or desktop upload of untouched iPhone photos arrives in a
// container imagescript rejects outright. libheif-js is the reference WASM
// build of libheif; the "wasm-bundle" entry point embeds the binary, so there
// is no runtime fetch of a second asset from inside the worker.
//
// Imported statically rather than lazily: the module is bundled into the
// function either way, the emscripten factory costs ~50 ms once per cold
// start, and a static specifier is the only form the deploy bundler is
// guaranteed to resolve. The "/wasm-bundle.js" subpath needs its extension —
// libheif-js publishes no exports map, so bare "/wasm-bundle" does not resolve.
const heifModule: any = (libheifBundle as any)?.default ?? libheifBundle

// ISO base media file format sniff: bytes 4..8 are "ftyp", 8..12 the major
// brand. Covers HEIC (Apple), HEIF and AVIF. Sniffing the BYTES rather than
// trusting the extension or mime_type matters here — the browser reports an
// empty File.type for .heic on several desktop platforms, so mime_type is
// NULL on every row this defect produced.
function isHeifBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false
  const tag = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b))
  if (tag(4, 8) !== "ftyp") return false
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
          "mif1", "msf1", "avif", "avis"].includes(tag(8, 12))
}

// One decoder for the worker's lifetime. libheif-js frees a decode context only
// at the START of the next decode() call, so a worker that decodes and then goes
// idle would hold the whole parsed file in WASM memory; decodeHeifScaled frees
// it explicitly instead, and nulling `decoder` keeps the wrapper's own guard
// from double-freeing on the next call.
const heifDecoder: any = new heifModule.HeifDecoder()

// Decode a HEIC/HEIF straight into an imagescript Image AT THE FINAL SIZE,
// reading the camera's native YCbCr planes rather than asking libheif for RGB.
//
// Both halves of that are forced by the worker's 256 MB memory ceiling, and
// both were established by watching real uploads fail:
//   - Decode-then-resize (what the JPEG path does) needs a full-res RGBA bitmap
//     on the JS side. Removing it fixed the 1 MP-class photos.
//   - Asking libheif for interleaved RGBA still costs 4 bytes/pixel INSIDE the
//     WASM heap — 98 MB for a 24 MP iPhone frame, on top of the YCbCr planes it
//     decodes into first. Every photo over ~2 MB on disk still died with
//     "Memory limit exceeded". The native 4:2:0 planes are 1.5 bytes/pixel, so
//     the same frame costs ~37 MB and nothing is converted twice.
//
// libheif hands the planes back as typed-array VIEWS onto its own heap, so the
// downscale reads straight out of WASM memory and the only JS allocation is the
// finished, already-shrunk bitmap.
//
// Averaging happens in YCbCr and converts once per destination pixel. The
// conversion is affine, so that is exactly equal to converting every source
// pixel and averaging the RGB — at a quarter of the arithmetic. A box average
// rather than point sampling because a 4032 -> 2400 reduction aliases visibly
// and these are evidence photos.

// YCbCr -> RGB coefficients [Kr, Kgb, Kgr, Kb] by nclx matrix_coefficients.
const YCBCR_MATRICES: Record<number, [number, number, number, number]> = {
  1: [1.5748, 0.1873, 0.4681, 1.8556],    // BT.709
  5: [1.402, 0.344136, 0.714136, 1.772],  // BT.470BG (== BT.601)
  6: [1.402, 0.344136, 0.714136, 1.772],  // SMPTE 170M (== BT.601)
  9: [1.4746, 0.16455, 0.57135, 1.8814],  // BT.2020 non-constant luminance
}

// The colour matrix and range are declared in the container's `colr` box
// (meta -> iprp -> ipco -> colr, colour_type "nclx"), so read them rather than
// assume: an iPhone writes BT.709 on some captures and BT.601 on others, and
// picking the wrong one shifts the colour of an evidence photo. When the box is
// absent, matrix 6 / full range is libheif's own default, and using it here was
// verified to reproduce libheif's RGB output to a mean error of 0.6/255.
function readHeifNclx(bytes: Uint8Array): { matrix: number; fullRange: boolean } | null {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const str = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n))
    const head = (off: number) => {
      if (off + 8 > bytes.length) return null
      let size = dv.getUint32(off)
      const type = str(off + 4, 4)
      let h = 8
      if (size === 1) { size = Number(dv.getBigUint64(off + 8)); h = 16 }
      else if (size === 0) size = bytes.length - off
      if (size < h) return null
      return { type, start: off + h, end: off + size }
    }
    const find = (from: number, to: number, type: string) => {
      let o = from
      while (o < to) {
        const x = head(o)
        if (!x) return null
        if (x.type === type) return x
        o = x.end
      }
      return null
    }
    let meta = null
    for (let o = 0; o < bytes.length;) {
      const x = head(o)
      if (!x) break
      if (x.type === "meta") { meta = x; break }
      o = x.end
    }
    if (!meta) return null
    const iprp = find(meta.start + 4, meta.end, "iprp")
    if (!iprp) return null
    const ipco = find(iprp.start, iprp.end, "ipco")
    if (!ipco) return null
    const colr = find(ipco.start, ipco.end, "colr")
    if (!colr || str(colr.start, 4) !== "nclx") return null
    const p = colr.start + 4 // colour_primaries, transfer, matrix, then flags
    return { matrix: dv.getUint16(p + 4), fullRange: (bytes[p + 6] & 0x80) !== 0 }
  } catch (_) {
    return null
  }
}

async function decodeHeifScaled(bytes: Uint8Array, maxEdge: number): Promise<Image> {
  const frames = heifDecoder.decode(bytes)
  if (!frames || frames.length === 0) throw new Error("HEIC contains no decodable image")
  const frame = frames[0]
  let decoded: any = null
  try {
    const raw = heifModule.heif_js_decode_image2(
      frame.handle,
      heifModule.heif_colorspace.heif_colorspace_YCbCr,
      heifModule.heif_chroma.heif_chroma_420,
    )
    if (!raw || raw.code) throw new Error("HEIC pixel decode failed")
    decoded = raw

    let chY: any = null, chCb: any = null, chCr: any = null
    for (const c of raw.channels || []) {
      if (c.id == heifModule.heif_channel.heif_channel_Y) chY = c
      else if (c.id == heifModule.heif_channel.heif_channel_Cb) chCb = c
      else if (c.id == heifModule.heif_channel.heif_channel_Cr) chCr = c
    }
    if (!chY || !chY.data) throw new Error("HEIC decode returned no luma channel")

    const sw = chY.width, sh = chY.height
    if (!sw || !sh) throw new Error("HEIC image has no dimensions")
    const yData = chY.data as Uint8Array, yStride = chY.stride
    // A monochrome HEIC carries no chroma planes; 128/128 is neutral grey.
    const cbData = (chCb?.data ?? null) as Uint8Array | null
    const crData = (chCr?.data ?? null) as Uint8Array | null
    const cStride = chCb?.stride ?? 0
    const cW = chCb?.width ?? 0, cH = chCb?.height ?? 0

    const nclx = readHeifNclx(bytes)
    const [kr, kgb, kgr, kb] = YCBCR_MATRICES[nclx?.matrix ?? 6] || YCBCR_MATRICES[6]
    const fullRange = nclx ? nclx.fullRange : true
    const yScale = fullRange ? 1 : 255 / 219
    const yOffset = fullRange ? 0 : 16
    const cScale = fullRange ? 1 : 255 / 224

    const scale = Math.min(1, maxEdge / Math.max(sw, sh))
    const dw = Math.max(1, Math.round(sw * scale))
    const dh = Math.max(1, Math.round(sh * scale))
    const img = new Image(dw, dh)
    const dst = img.bitmap
    const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0)

    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * sh / dh)
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / dh))
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * sw / dw)
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / dw))
        let sumY = 0, sumCb = 0, sumCr = 0, n = 0
        for (let sy = y0; sy < y1; sy++) {
          const yRow = sy * yStride
          const cRow = cbData ? Math.min(cH - 1, sy >> 1) * cStride : 0
          for (let sx = x0; sx < x1; sx++) {
            sumY += yData[yRow + sx]
            if (cbData && crData) {
              const ci = cRow + Math.min(cW - 1, sx >> 1)
              sumCb += cbData[ci]
              sumCr += crData[ci]
            } else {
              sumCb += 128; sumCr += 128
            }
            n++
          }
        }
        const yv = (sumY / n - yOffset) * yScale
        const cbv = (sumCb / n - 128) * cScale
        const crv = (sumCr / n - 128) * cScale
        const di = (y * dw + x) * 4
        dst[di]     = clamp(yv + kr * crv)
        dst[di + 1] = clamp(yv - kgb * cbv - kgr * crv)
        dst[di + 2] = clamp(yv + kb * cbv)
        dst[di + 3] = 255
      }
    }
    return img
  } finally {
    // Release in reverse order of acquisition, and BEFORE the caller starts
    // encoding, so the JPEG encoder is not competing with live decode planes.
    try { if (decoded?.image) heifModule.heif_image_release(decoded.image) } catch (_) { /* noop */ }
    // A HEIC routinely carries more than one top-level image (primary plus a
    // thumbnail or depth map) and each holds its own handle.
    for (const f of frames) { try { f.free?.() } catch (_) { /* noop */ } }
    try {
      if (heifDecoder.decoder) {
        heifModule.heif_context_free(heifDecoder.decoder)
        heifDecoder.decoder = null
      }
    } catch (_) { /* noop */ }
  }
}

// Pull the EXIF payload out of a HEIF container.
//
// exifr owns a HEIC parser but it never fires on the files this platform
// actually receives — it answers "Unknown file format" (verified in prod on a
// real iPhone upload), because its sniff insists the ftyp COMPATIBLE-brand
// list contains "heic". So walk the ISO base media boxes directly:
//
//   meta -> iinf : find the item whose type is "Exif"        -> item_ID
//   meta -> iloc : find that item_ID's extent                -> offset+length
//   payload      : uint32 "bytes before the TIFF header", then the TIFF block
//
// The bare TIFF block IS something exifr parses happily, so the tag decoding,
// GPS conversion and orientation labelling all stay exifr's job — this only
// finds the bytes. Verified against synthetic containers covering iloc v0/v1/v2,
// infe v2/v3, present/absent base offsets and 4- and 8-byte offset/length
// fields, then end-to-end against the real uploads.
function extractHeifExifTiff(bytes: Uint8Array): Uint8Array | null {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const str = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n))
    const uint = (o: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[o + i]; return v }

    function boxHead(off: number) {
      if (off + 8 > bytes.length) return null
      let size = dv.getUint32(off)
      const type = str(off + 4, 4)
      let head = 8
      if (size === 1) { size = Number(dv.getBigUint64(off + 8)); head = 16 }
      else if (size === 0) size = bytes.length - off
      if (size < head) return null
      return { off, size, type, start: off + head, end: off + size }
    }
    function findBox(from: number, to: number, type: string) {
      let o = from
      while (o < to) {
        const b = boxHead(o)
        if (!b) return null
        if (b.type === type) return b
        o = b.end
      }
      return null
    }

    let meta = null
    for (let o = 0; o < bytes.length;) {
      const b = boxHead(o)
      if (!b) break
      if (b.type === "meta") { meta = b; break }
      o = b.end
    }
    if (!meta) return null
    const metaStart = meta.start + 4 // meta is a FullBox

    const iinf = findBox(metaStart, meta.end, "iinf")
    const iloc = findBox(metaStart, meta.end, "iloc")
    if (!iinf || !iloc) return null

    // iinf: the item declaring item_type "Exif".
    let exifItemId: number | null = null
    {
      const version = bytes[iinf.start]
      let o = iinf.start + 4
      const count = version === 0 ? dv.getUint16(o) : dv.getUint32(o)
      o += version === 0 ? 2 : 4
      for (let i = 0; i < count; i++) {
        const infe = boxHead(o)
        if (!infe) break
        const v = bytes[infe.start]
        if (v >= 2) {
          const idSize = v === 2 ? 2 : 4
          const p = infe.start + 4
          if (str(p + idSize + 2, 4) === "Exif") { exifItemId = uint(p, idSize); break }
        }
        o = infe.end
      }
    }
    if (exifItemId === null) return null

    // iloc: that item's first extent. Field widths are packed into two nibble
    // pairs, and the item_ID / construction-method fields change width by box
    // version — hence the arithmetic rather than fixed offsets.
    let offset = 0, length = 0
    {
      const version = bytes[iloc.start]
      let o = iloc.start + 4
      const offsetSize = bytes[o] >> 4, lengthSize = bytes[o] & 15; o++
      const baseOffsetSize = bytes[o] >> 4
      const indexSize = (version === 1 || version === 2) ? (bytes[o] & 15) : 0; o++
      const idSize = version === 2 ? 4 : 2
      const ctorSize = (version === 1 || version === 2) ? 2 : 0
      const count = version === 2 ? dv.getUint32(o) : dv.getUint16(o)
      o += version === 2 ? 4 : 2
      for (let i = 0; i < count; i++) {
        const id = uint(o, idSize)
        o += idSize + ctorSize + 2 // + data_reference_index
        const baseOffset = baseOffsetSize ? uint(o, baseOffsetSize) : 0
        o += baseOffsetSize
        const extentCount = dv.getUint16(o); o += 2
        if (id === exifItemId && extentCount > 0) {
          offset = baseOffset + uint(o + indexSize, offsetSize)
          length = uint(o + indexSize + offsetSize, lengthSize)
          break
        }
        o += extentCount * (indexSize + offsetSize + lengthSize)
      }
    }
    if (!length || offset + 4 > bytes.length) return null

    const tiffStart = offset + 4 + dv.getUint32(offset)
    const tiffEnd = Math.min(bytes.length, offset + length)
    if (tiffStart >= tiffEnd) return null
    return bytes.subarray(tiffStart, tiffEnd)
  } catch (_) {
    return null
  }
}

// ── EXIF extraction ─────────────────────────────────────────────────────────
// The old single `exifr.parse(..., {gps, ifd0, exif})` call was wrapped in a
// bare catch that turned ANY failure into {}, so a format exifr needed coaxing
// on lost its GPS and capture time with no trace of why. Try the segment-scoped
// parse, then exifr's parse-everything mode, then GPS alone; keep the first
// result that actually carries data and report the last error otherwise.
async function extractExif(bytes: Uint8Array): Promise<{ exif: Record<string, any>; error: string | null }> {
  const attempts: Array<() => Promise<any>> = [
    // HEIF first: exifr's own sniff rejects these files, so hand it the TIFF
    // block lifted straight out of the container.
    async () => {
      const tiff = isHeifBytes(bytes) ? extractHeifExifTiff(bytes) : null
      return tiff ? await exifr.parse(tiff, { gps: true, ifd0: true, exif: true }) : null
    },
    () => exifr.parse(bytes, { gps: true, ifd0: true, exif: true }),
    () => exifr.parse(bytes, true),
    () => exifr.gps(bytes).then((g: any) => (g && g.latitude != null ? { latitude: g.latitude, longitude: g.longitude } : null)),
  ]
  let lastError: string | null = null
  for (const attempt of attempts) {
    try {
      const out = await attempt()
      if (out && Object.keys(out).length > 0) return { exif: sanitizeExif(out), error: null }
    } catch (e) {
      lastError = (e as Error).message || String(e)
    }
  }
  return { exif: {}, error: lastError }
}

// exif_raw is a jsonb column, and the parse-everything mode can return raw
// MakerNote / UserComment byte arrays that are megabytes wide and of no use to
// anyone. Drop long binary blobs; keep every scalar and short value verbatim.
function sanitizeExif(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue
    if (ArrayBuffer.isView(v) || (Array.isArray(v) && v.length > 64)) continue
    if (typeof v === "string" && v.length > 2000) continue
    out[k] = v
  }
  return out
}

const FONT_BUCKET = "templates"
const FONT_PATH = "fonts/watermark-font.ttf"
let cachedFont: Uint8Array | null = null

async function getFont(admin: ReturnType<typeof createClient>): Promise<Uint8Array> {
  if (cachedFont) return cachedFont
  const { data, error } = await admin.storage.from(FONT_BUCKET).download(FONT_PATH)
  if (error || !data) throw new Error(`watermark font download failed: ${error?.message || "no data"}`)
  cachedFont = new Uint8Array(await data.arrayBuffer())
  return cachedFont
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  })
}

// EXIF Orientation → numeric code. exifr returns a human-readable string by
// default (translateValues), so accept both the number and the label. Only the
// rotate-only orientations (3/6/8) are actioned; mirror variants are rare on
// phone cameras and left as-is.
function normalizeOrientation(v: unknown): number | null {
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const s = v.trim().toLowerCase()
    if (s === "horizontal (normal)") return 1
    if (s === "rotate 180") return 3
    if (s === "rotate 90 cw") return 6
    if (s === "rotate 270 cw") return 8
    // Fallback: pull the degrees out of any "... rotate N cw ..." label.
    const m = s.match(/rotate\s+(\d+)\s*cw/)
    if (m) {
      const d = parseInt(m[1], 10)
      if (d === 180) return 3
      if (d === 90) return 6
      if (d === 270) return 8
    }
  }
  return null
}

// Explicit 90°/180° rotation via a direct RGBA bitmap remap. imagescript
// 1.2.17's own rotate(90) resamples/transposes unreliably in this runtime
// (verified), and a getPixelAt/setPixelAt loop is too slow on multi-megapixel
// images (the invocation dies mid-rotate). Operating on the raw Uint8Array is
// ~10× faster and deterministic. Direction verified against the 1-indexed
// reference: cw=true => top→right, left→top (true clockwise). Bitmap is
// row-major RGBA; pixel (x,y) 0-indexed is at offset (y*w + x) * 4.
function rotate90(img: Image, cw: boolean): Image {
  const w = img.width, h = img.height
  const src = img.bitmap
  const out = new Image(h, w) // dimensions swap
  const dst = out.bitmap
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4
      const dx = cw ? (h - 1 - y) : y
      const dy = cw ? x : (w - 1 - x)
      const di = (dy * h + dx) * 4 // out width is h
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3]
    }
  }
  return out
}
function rotate180(img: Image): Image {
  const w = img.width, h = img.height
  const src = img.bitmap
  const out = new Image(w, h)
  const dst = out.bitmap
  const n = w * h
  for (let i = 0; i < n; i++) {
    const si = i * 4, di = (n - 1 - i) * 4
    dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3]
  }
  return out
}

// ── EXIF preservation ───────────────────────────────────────────────────────
// The watermarked variant is re-encoded (imagescript writes no EXIF), which
// would drop the capture timestamp + GPS. Programs that accept these photos
// need BOTH the visible watermark AND accurate EXIF, so we copy the ORIGINAL's
// EXIF verbatim into the watermarked JPEG — no re-derivation, so the metadata
// stays exactly what the camera recorded — changing only:
//   • Orientation → 1 (the pixels are physically rotated upright now, so the
//     original 6/8 flag would make a viewer double-rotate).
//   • PixelXDimension/YDimension → the actual watermarked size (kept honest).
// piexif works on binary strings (one char = one byte).
function u8ToBinaryString(u8: Uint8Array): string {
  let s = ""
  const CHUNK = 0x8000
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)))
  }
  return s
}
function binaryStringToU8(bs: string): Uint8Array {
  const u8 = new Uint8Array(bs.length)
  for (let i = 0; i < bs.length; i++) u8[i] = bs.charCodeAt(i) & 0xff
  return u8
}
// Returns the watermarked bytes with the original's EXIF embedded, or the
// input unchanged if the original carries no readable EXIF (e.g. non-JPEG).
function embedOriginalExif(originalBytes: Uint8Array, watermarkedJpeg: Uint8Array, outW: number, outH: number): { bytes: Uint8Array; ok: boolean } {
  try {
    // EXIF (APP1) lives in the JPEG header, so only the first chunk is needed.
    // Converting the FULL multi-MB original to a string blew the worker memory
    // limit on the largest photos; a 512 KB prefix comfortably covers EXIF +
    // any embedded thumbnail while keeping peak memory small.
    const HEADER = Math.min(originalBytes.length, 512 * 1024)
    const origBin = u8ToBinaryString(originalBytes.subarray(0, HEADER))
    const exifObj = piexif.load(origBin)
    const hasAny = exifObj && (
      (exifObj["Exif"] && Object.keys(exifObj["Exif"]).length) ||
      (exifObj["GPS"] && Object.keys(exifObj["GPS"]).length) ||
      (exifObj["0th"] && Object.keys(exifObj["0th"]).length)
    )
    if (!hasAny) return { bytes: watermarkedJpeg, ok: false }
    exifObj["0th"] = exifObj["0th"] || {}
    exifObj["0th"][piexif.ImageIFD.Orientation] = 1
    exifObj["Exif"] = exifObj["Exif"] || {}
    exifObj["Exif"][piexif.ExifIFD.PixelXDimension] = outW
    exifObj["Exif"][piexif.ExifIFD.PixelYDimension] = outH
    // Thumbnail from the original is stale after re-encode; drop it.
    exifObj["thumbnail"] = null
    exifObj["1st"] = {}
    const exifBytes = piexif.dump(exifObj)
    const merged = piexif.insert(exifBytes, u8ToBinaryString(watermarkedJpeg))
    return { bytes: binaryStringToU8(merged), ok: true }
  } catch (_) {
    return { bytes: watermarkedJpeg, ok: false }
  }
}

// A HEIC original carries its EXIF in an ISOBMFF box, not a JPEG APP1 segment,
// so `embedOriginalExif` (which reads the JPEG header) finds nothing to copy
// and the watermarked evidence file would ship with no capture time and no
// GPS — the two things the incentive programs actually check. Rebuild a
// minimal EXIF block from the values exifr already read OFF THAT SAME FILE.
// Nothing is invented: if the original had no date and no GPS, this returns
// null and the variant stays metadata-free rather than carrying a guess.
function piexifDateString(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}:${p2(d.getUTCMonth() + 1)}:${p2(d.getUTCDate())} ` +
         `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
}
function buildExifFromParsed(
  vals: { takenAt: Date | null; lat: number | null; lng: number | null; alt: number | null; make: string | null; model: string | null },
  outW: number,
  outH: number,
): string | null {
  try {
    const hasDate = vals.takenAt instanceof Date && !isNaN(vals.takenAt.getTime())
    const hasGps = vals.lat !== null && vals.lng !== null
    if (!hasDate && !hasGps) return null

    const zeroth: Record<number, unknown> = {}
    const exifIfd: Record<number, unknown> = {}
    const gpsIfd: Record<number, unknown> = {}

    zeroth[piexif.ImageIFD.Orientation] = 1
    if (vals.make) zeroth[piexif.ImageIFD.Make] = vals.make
    if (vals.model) zeroth[piexif.ImageIFD.Model] = vals.model
    exifIfd[piexif.ExifIFD.PixelXDimension] = outW
    exifIfd[piexif.ExifIFD.PixelYDimension] = outH

    if (hasDate) {
      const ds = piexifDateString(vals.takenAt as Date)
      zeroth[piexif.ImageIFD.DateTime] = ds
      exifIfd[piexif.ExifIFD.DateTimeOriginal] = ds
      exifIfd[piexif.ExifIFD.DateTimeDigitized] = ds
    }
    if (hasGps) {
      const lat = vals.lat as number, lng = vals.lng as number
      gpsIfd[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? "N" : "S"
      gpsIfd[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lat))
      gpsIfd[piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? "E" : "W"
      gpsIfd[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lng))
      if (vals.alt !== null) {
        gpsIfd[piexif.GPSIFD.GPSAltitudeRef] = vals.alt >= 0 ? 0 : 1
        gpsIfd[piexif.GPSIFD.GPSAltitude] = [Math.round(Math.abs(vals.alt) * 100), 100]
      }
    }
    return piexif.dump({ "0th": zeroth, "Exif": exifIfd, "GPS": gpsIfd, "1st": {}, thumbnail: null })
  } catch (_) {
    return null
  }
}

// Leaf of a hierarchical LEAP name: "1837 Alden Rd - Janesville - 1837 - 11"
// -> "11". Building/unit names carry the full path; we want the trailing token.
function leafName(name: string | null | undefined): string | null {
  if (!name) return null
  const parts = String(name).split(" - ")
  const leaf = parts[parts.length - 1]?.trim()
  return leaf || null
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405)
  }

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const body = (await req.json().catch(() => ({}))) as {
      photo_id?: string
      photo_ids?: string[]
    }

    // ── Internal batch path ────────────────────────────────────────────────
    // Re-render a list of photos using the service role, gated by the shared
    // secret in internal_cron_auth. Used to correct/refresh existing photos
    // (no per-user JWT). Never exposed to the browser.
    const presentedSecret = req.headers.get("x-internal-cron-secret") || ""
    if (presentedSecret) {
      const { data: authRow } = await admin
        .from("internal_cron_auth").select("secret").eq("name", "photo_rerender").maybeSingle()
      if (!authRow?.secret || presentedSecret !== authRow.secret) {
        return json({ error: "invalid internal secret" }, 401)
      }
      const requested = Array.isArray(body.photo_ids) ? body.photo_ids : (body.photo_id ? [body.photo_id] : [])
      if (requested.length === 0) return json({ error: "photo_ids required" }, 400)
      // Batch size is bounded by worker MEMORY, not by time. Even decoded at the
      // final size a HEIC costs ~50 MB of WASM heap that is never handed back,
      // so several in one request risk the runtime's memory ceiling.
      //
      // A dead worker is worse than a slow one: processPhoto has already flipped
      // its row to "processing", and NOTHING retries a row in that state, so the
      // photo is stranded silently — which is the failure mode that hid this
      // whole defect in the first place. So: at most four photos, and a HEIC
      // ends the batch there and then. The caller loops on `not_attempted`.
      const MAX_PER_INVOCATION = 4
      const queue = requested.slice(0, MAX_PER_INVOCATION)
      const notAttempted = requested.slice(MAX_PER_INVOCATION)
      const results = []
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i]
        let wasHeif = false
        try {
          const r = await processPhoto(admin, id)
          // Only a DIRECT HEIC decode is expensive enough to end the batch;
          // a rendition-backed photo is an ordinary JPEG render.
          wasHeif = r.source_format === "heif" && r.pixel_source === "original"
          results.push({ photo_id: id, ...r })
        } catch (e) {
          results.push({ photo_id: id, watermark_status: "failed", error: (e as Error).message })
        }
        if (wasHeif) { notAttempted.unshift(...queue.slice(i + 1)); break }
      }
      return json({ ok: true, count: results.length, not_attempted: notAttempted, results })
    }

    // ── Caller-JWT path (single photo) ─────────────────────────────────────
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "missing authorization" }, 401)

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return json({ error: "invalid token" }, 401)

    if (!body.photo_id) return json({ error: "photo_id required" }, 400)

    // Verify caller can read this photo per RLS.
    const { data: visible } = await userClient
      .from("photos")
      .select("id")
      .eq("id", body.photo_id)
      .maybeSingle()
    if (!visible) return json({ error: "forbidden or not found" }, 403)

    const r = await processPhoto(admin, body.photo_id)
    return json({ ok: true, photo_id: body.photo_id, ...r })
  } catch (err) {
    console.error("process-photo fatal", err)
    return json({ error: (err as Error).message || String(err) }, 500)
  }
})

// Core per-photo processing: EXIF extract + watermark render + persist.
// Returns a small status object. Throws only on unexpected failures; a failed
// watermark render is captured and persisted as watermark_status=failed.
async function processPhoto(admin: ReturnType<typeof createClient>, photoId: string) {
  const { data: photo, error: photoErr } = await admin
    .from("photos")
    .select("id, storage_bucket, storage_path_original, storage_path_rendition, storage_path_watermarked, apply_watermark, photo_type, work_step_id, related_object, related_id")
    .eq("id", photoId)
    .maybeSingle()
  if (photoErr) throw new Error(photoErr.message)
  if (!photo) throw new Error("photo not found")
  if (!photo.storage_bucket || !photo.storage_path_original) {
    throw new Error("photo has no original storage path")
  }

  await admin.from("photos").update({ watermark_status: "processing", watermark_error: null }).eq("id", photo.id)

  const { data: blob, error: dlErr } = await admin.storage
    .from(photo.storage_bucket)
    .download(photo.storage_path_original)
  if (dlErr || !blob) {
    await markFailed(admin, photo.id, dlErr?.message || "download failed")
    throw new Error(dlErr?.message || "download failed")
  }
  const buffer = new Uint8Array(await blob.arrayBuffer())

  // Pixels may come from somewhere other than the original. A HEIC capture is
  // decoded on the device at upload and stored as a JPEG rendition beside it
  // (photos.storage_path_rendition), because HEVC decode of a 12 MP frame only
  // fits this worker's CPU budget when the scene happens to be simple. When a
  // rendition exists it is what gets watermarked; EXIF is still read from the
  // ORIGINAL below, so GPS and capture time remain the camera's own bytes.
  let pixelBytes = buffer
  if (photo.storage_path_rendition) {
    const { data: renBlob, error: renErr } = await admin.storage
      .from(photo.storage_bucket)
      .download(photo.storage_path_rendition)
    if (renErr || !renBlob) {
      console.warn(`process-photo ${photoId}: rendition unreadable, falling back to the original — ${renErr?.message || "no data"}`)
    } else {
      pixelBytes = new Uint8Array(await renBlob.arrayBuffer())
    }
  }

  // Parse EXIF — full dump. Errors here are non-fatal; we record empty and
  // keep the reason so an unreadable camera format is diagnosable instead of
  // silently arriving with no GPS.
  const sourceIsHeif = isHeifBytes(buffer)
  const { exif, error: exifError } = await extractExif(buffer)
  if (exifError) console.warn(`process-photo ${photoId}: EXIF unreadable — ${exifError}`)

  const takenAt: Date | null = (exif.DateTimeOriginal as Date) || (exif.CreateDate as Date) || (exif.ModifyDate as Date) || null
  const lat = typeof exif.latitude === "number" ? exif.latitude : null
  const lng = typeof exif.longitude === "number" ? exif.longitude : null
  const alt = typeof exif.GPSAltitude === "number" ? exif.GPSAltitude : null
  const make = exif.Make ? String(exif.Make).trim() : null
  const model = exif.Model ? String(exif.Model).trim() : null
  const orient = normalizeOrientation(exif.Orientation)

  // Resolve photo tag + location (property / building / unit) from the work
  // order behind the step. The step/item name takes precedence for the tag.
  let photoTag = photo.photo_type || "Photo"
  let locLine: string | null = null
  if (photo.work_step_id) {
    const { data: step } = await admin
      .from("work_steps")
      .select("work_step_name, work_step_template_id, work_order_id")
      .eq("id", photo.work_step_id)
      .maybeSingle()
    if (step?.work_step_name) {
      photoTag = step.work_step_name
    } else if (step?.work_step_template_id) {
      const { data: tmpl } = await admin
        .from("work_step_templates")
        .select("wst_name")
        .eq("id", step.work_step_template_id)
        .maybeSingle()
      if (tmpl?.wst_name) photoTag = tmpl.wst_name
    }
    if (step?.work_order_id) {
      const { data: wo } = await admin
        .from("work_orders")
        .select("property_id, building_id, unit_id")
        .eq("id", step.work_order_id)
        .maybeSingle()
      if (wo) {
        const [propRes, bldRes, unitRes] = await Promise.all([
          wo.property_id ? admin.from("properties").select("property_name").eq("id", wo.property_id).maybeSingle() : Promise.resolve({ data: null }),
          wo.building_id ? admin.from("buildings").select("building_name").eq("id", wo.building_id).maybeSingle() : Promise.resolve({ data: null }),
          wo.unit_id ? admin.from("units").select("unit_name").eq("id", wo.unit_id).maybeSingle() : Promise.resolve({ data: null }),
        ])
        const propName = (propRes.data as any)?.property_name || null
        const bldLeaf = leafName((bldRes.data as any)?.building_name)
        const unitLeaf = leafName((unitRes.data as any)?.unit_name)
        const parts: string[] = []
        if (propName) parts.push(String(propName))
        if (bldLeaf) parts.push(`Bldg ${bldLeaf}`)
        if (unitLeaf) parts.push(`Unit ${unitLeaf}`)
        if (parts.length) locLine = parts.join("  ·  ")
      }
    }
  } else if (photo.related_object === "vehicle_activity_items" && photo.related_id) {
    const { data: vai } = await admin
      .from("vehicle_activity_items")
      .select("vai_name")
      .eq("id", photo.related_id)
      .maybeSingle()
    if (vai?.vai_name) photoTag = vai.vai_name
  }

  let watermarkPath: string | null = null
  let newStatus = "skipped"
  let renderError: string | null = null
  let wmExifOk = false

  if (photo.apply_watermark) {
    try {
      // Cap the long edge FIRST so the per-pixel orientation remap below is
      // bounded work. The original is preserved full-res in storage either way.
      // HEIF applies the cap DURING decode (see decodeHeifScaled) because a
      // full-size intermediate does not fit in the worker.
      const MAX_EDGE = 2400
      const pixelsAreHeif = isHeifBytes(pixelBytes)
      let img = pixelsAreHeif
        ? await decodeHeifScaled(pixelBytes, MAX_EDGE)
        : await Image.decode(pixelBytes)
      if (!pixelsAreHeif) {
        const longEdge = Math.max(img.width, img.height)
        if (longEdge > MAX_EDGE) {
          const scale = MAX_EDGE / longEdge
          img.resize(Math.round(img.width * scale), Math.round(img.height * scale))
        }
      }

      // Apply EXIF orientation so the watermarked variant displays upright (its
      // EXIF tag is stripped by re-encoding). 6="Rotate 90 CW", 8="Rotate 270
      // CW" (=90 CCW), 3=180. Uses the explicit remap (imagescript rotate(90)
      // is unreliable here).
      //
      // NOT for HEIF: in that container the display transform is the `irot`
      // property, which libheif has already applied by the time decode returns,
      // and Apple writes the same rotation into EXIF as well. Rotating again on
      // the EXIF tag would turn every portrait photo sideways.
      // Guarded on the ORIGINAL's container, not the pixel source: a rendition
      // is drawn through a canvas that has already applied the HEIF display
      // transform, so it is upright for the same reason the direct decode is.
      if (!sourceIsHeif) {
        if (orient === 3) img = rotate180(img)
        else if (orient === 6) img = rotate90(img, true)
        else if (orient === 8) img = rotate90(img, false)
      }

      const fontBuf = await getFont(admin)
      const fontSize = Math.max(22, Math.round(img.width * 0.028))

      // Watermark lines, top to bottom. Location sits just under the tag.
      const dateLine = takenAt ? formatDateUtc(takenAt) : "Date unknown"
      let gpsLine = "GPS unavailable"
      if (lat !== null && lng !== null) {
        gpsLine = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
        if (alt !== null) gpsLine += `  ·  ${Math.round(alt)} m`
      }
      const lineSpecs: Array<{ text: string; size: number; alpha: number }> = [
        { text: String(photoTag).slice(0, 80), size: Math.round(fontSize * 1.1), alpha: 1 },
      ]
      if (locLine) lineSpecs.push({ text: locLine.slice(0, 90), size: Math.round(fontSize * 0.92), alpha: 0.95 })
      lineSpecs.push({ text: dateLine, size: fontSize, alpha: 0.92 })
      lineSpecs.push({ text: gpsLine, size: fontSize, alpha: 0.92 })

      const rendered = []
      for (const ls of lineSpecs) {
        rendered.push(await Image.renderText(fontBuf, ls.size, ls.text, rgba(255, 255, 255, ls.alpha)))
      }

      const lineGap = Math.round(fontSize * 0.42)
      const padX = Math.round(img.width * 0.025)
      const padY = Math.round(fontSize * 0.7)
      const contentH = rendered.reduce((s, im) => s + im.height, 0) + lineGap * (rendered.length - 1) + padY * 2
      const stripH = Math.min(img.height, Math.max(110, contentH))
      const stripY = img.height - stripH

      const strip = new Image(img.width, stripH)
      strip.fill(rgba(13, 26, 46, 0.45)) // dark navy 45% — light enough to see the image through
      img.composite(strip, 0, stripY)

      let cy = stripY + padY
      for (const im of rendered) {
        img.composite(im, padX, cy)
        cy += im.height + lineGap
      }

      const encoded = await img.encodeJPEG(85)
      // Copy the original camera EXIF (date + GPS) into the watermarked JPEG so
      // the downloadable evidence file has BOTH the visible tag and accurate
      // metadata. Falls back to the plain watermarked bytes if the original has
      // no readable EXIF.
      let { bytes: out, ok: exifOk } = embedOriginalExif(buffer, encoded, img.width, img.height)
      if (!exifOk) {
        // Non-JPEG original (HEIC/HEIF): nothing to copy verbatim, so rebuild
        // the block from what exifr read off that same original.
        const synthesized = buildExifFromParsed({ takenAt, lat, lng, alt, make, model }, img.width, img.height)
        if (synthesized) {
          try {
            out = binaryStringToU8(piexif.insert(synthesized, u8ToBinaryString(encoded)))
            exifOk = true
          } catch (_) { /* keep the plain watermarked bytes */ }
        }
      }
      wmExifOk = exifOk

      const origPath = photo.storage_path_original
      const baseName = origPath.split("/").pop() || "photo"
      const baseNoExt = baseName.replace(/\.[^.]+$/, "")
      // Every path this platform writes is ".../originals/<uuid>.<ext>". The
      // old pattern looked for the singular "/original/", never matched, and
      // left `folder` as the FULL original path — which is how the shipped
      // keys ended up as ".../originals/<uuid>.jpg/<uuid>.jpg".
      const folder = origPath.replace(/\/originals?\/[^/]+$/, "/watermarked")
      watermarkPath = `${folder}/${baseNoExt}.jpg`

      const { error: upErr } = await admin.storage
        .from(photo.storage_bucket)
        .upload(watermarkPath, out, { contentType: "image/jpeg", upsert: true })
      if (upErr) throw upErr

      newStatus = "done"
    } catch (e) {
      renderError = (e as Error).message || String(e)
      newStatus = "failed"
      watermarkPath = null
    }
  }

  const update: Record<string, unknown> = {
    watermark_status: newStatus,
    watermark_error: renderError,
    exif_raw: JSON.parse(JSON.stringify(exif)),
  }
  if (takenAt instanceof Date && !isNaN(takenAt.getTime())) {
    update.taken_at = takenAt.toISOString()
  }
  if (lat !== null) update.latitude = lat
  if (lng !== null) update.longitude = lng
  if (alt !== null) update.altitude = alt
  if (make) update.camera_make = make
  if (model) update.camera_model = model
  if (orient) update.orientation = orient
  if (watermarkPath) update.storage_path_watermarked = watermarkPath

  const { error: updErr } = await admin.from("photos").update(update).eq("id", photo.id)
  if (updErr) throw new Error(updErr.message)

  return {
    watermark_status: newStatus,
    watermark_error: renderError,
    orientation: orient,
    location_line: locLine,
    watermark_exif_embedded: wmExifOk,
    exif_error: exifError,
    source_format: sourceIsHeif ? "heif" : "other",
    pixel_source: pixelBytes === buffer ? "original" : "rendition",
    watermark_path: watermarkPath,
    taken_at: takenAt instanceof Date ? takenAt.toISOString() : null,
  }
}

async function markFailed(admin: ReturnType<typeof createClient>, id: string, msg: string) {
  await admin
    .from("photos")
    .update({ watermark_status: "failed", watermark_error: msg.slice(0, 500) })
    .eq("id", id)
}

// 0xRRGGBBAA packed integer for ImageScript fill/composite.
function rgba(r: number, g: number, b: number, aFloat: number): number {
  const a = Math.max(0, Math.min(255, Math.round(aFloat * 255)))
  return ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)
}

function formatDateUtc(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  return `${fmt.format(d)} UTC`
}
