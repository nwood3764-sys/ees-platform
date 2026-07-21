// process-photo — extracts EXIF and renders a watermarked variant for an
// already-uploaded photo. Called by the client immediately after upload
// completes. Idempotent: safe to re-invoke (e.g. after work_step_id is set
// to re-render the watermark with the new photo tag).
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!

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
    const origBin = u8ToBinaryString(originalBytes)
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
      const ids = Array.isArray(body.photo_ids) ? body.photo_ids : (body.photo_id ? [body.photo_id] : [])
      if (ids.length === 0) return json({ error: "photo_ids required" }, 400)
      const results = []
      for (const id of ids) {
        try {
          const r = await processPhoto(admin, id)
          results.push({ photo_id: id, ...r })
        } catch (e) {
          results.push({ photo_id: id, watermark_status: "failed", error: (e as Error).message })
        }
      }
      return json({ ok: true, count: results.length, results })
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
    .select("id, storage_bucket, storage_path_original, storage_path_watermarked, apply_watermark, photo_type, work_step_id, related_object, related_id")
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

  // Parse EXIF — full dump. Errors here are non-fatal; we just record empty.
  let exif: Record<string, any> = {}
  try {
    exif = (await exifr.parse(buffer, { gps: true, ifd0: true, exif: true })) || {}
  } catch (_) {
    exif = {}
  }

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
      let img = await Image.decode(buffer)

      // Cap the long edge FIRST so the per-pixel orientation remap below is
      // bounded work, then re-orient. Original is preserved full-res.
      const MAX_EDGE = 2400
      const longEdge = Math.max(img.width, img.height)
      if (longEdge > MAX_EDGE) {
        const scale = MAX_EDGE / longEdge
        img.resize(Math.round(img.width * scale), Math.round(img.height * scale))
      }

      // Apply EXIF orientation so the watermarked variant displays upright (its
      // EXIF tag is stripped by re-encoding). 6="Rotate 90 CW", 8="Rotate 270
      // CW" (=90 CCW), 3=180. Uses the explicit remap (imagescript rotate(90)
      // is unreliable here).
      if (orient === 3) img = rotate180(img)
      else if (orient === 6) img = rotate90(img, true)
      else if (orient === 8) img = rotate90(img, false)

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
      const { bytes: out, ok: exifOk } = embedOriginalExif(buffer, encoded, img.width, img.height)
      wmExifOk = exifOk

      const origPath = photo.storage_path_original
      const baseName = origPath.split("/").pop() || "photo"
      const baseNoExt = baseName.replace(/\.[^.]+$/, "")
      const folder = origPath.replace(/\/original\/[^/]+$/, "/watermarked")
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
