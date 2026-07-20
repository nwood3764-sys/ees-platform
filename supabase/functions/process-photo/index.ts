// process-photo — extracts EXIF and renders a watermarked variant for an
// already-uploaded photo. Called by the client immediately after upload
// completes. Idempotent: safe to re-invoke (e.g. after work_step_id is set
// to re-render the watermark with the new photo tag).
//
// v8: the watermark tag now also resolves from vehicle_activity_items
// (Daily Vehicle Inspection checklist photos carry the item name, e.g.
// "Tire - Driver Front"). Source committed to the repo as of this version —
// it was previously deployed-only.
//
// Inputs (JSON body):
//   { photo_id: uuid }
//
// Behavior:
//   1. Verify caller can SELECT the photos row (uses caller's JWT against RLS).
//   2. Download original from storage (service role).
//   3. Parse EXIF with exifr — persist to photos.{taken_at, latitude,
//      longitude, altitude, camera_make, camera_model, orientation, exif_raw}.
//   4. If apply_watermark=true: re-orient by EXIF orientation, draw a
//      semi-transparent dark strip across the bottom, render three lines of
//      white bold text (photo tag, date/time UTC, GPS coords),
//      encode as JPEG quality 85, upload to .../watermarked/{filename},
//      and persist storage_path_watermarked.
//   5. The original is NEVER modified. EXIF is preserved on the original
//      bytes verbatim. Watermarked variant has its EXIF stripped (which is
//      fine — the original is the evidentiary source of truth).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts"
import exifr from "npm:exifr@7.1.3"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!

// Watermark font: a Latin subset of Liberation Sans Bold, provisioned into
// our own private `templates` bucket at fonts/watermark-font.ttf (source of
// truth committed to the repo at public/fonts/watermark-font.ttf, PR #122).
// Loaded from our storage — never a third-party URL: the previous
// GitHub-hosted Inter fetch started returning 404 and silently failed every
// watermark render. Cached in module scope across warm invocations.
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405)
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "missing authorization" }, 401)

    // Caller-scoped client — used to verify SELECT access on the photo row
    // (i.e. the user is allowed to see this photo per RLS).
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return json({ error: "invalid token" }, 401)

    // Service role — used for storage operations and the photo row update,
    // since we want the update to succeed regardless of which authenticated
    // role is calling. Auth is already proven above.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const body = (await req.json().catch(() => ({}))) as { photo_id?: string }
    if (!body.photo_id) return json({ error: "photo_id required" }, 400)

    // Verify caller can read this photo per RLS.
    const { data: visible } = await userClient
      .from("photos")
      .select("id")
      .eq("id", body.photo_id)
      .maybeSingle()
    if (!visible) return json({ error: "forbidden or not found" }, 403)

    // Load full photo row with service role.
    const { data: photo, error: photoErr } = await admin
      .from("photos")
      .select("id, storage_bucket, storage_path_original, storage_path_watermarked, apply_watermark, photo_type, work_step_id, related_object, related_id")
      .eq("id", body.photo_id)
      .maybeSingle()
    if (photoErr) return json({ error: photoErr.message }, 500)
    if (!photo) return json({ error: "photo not found" }, 404)
    if (!photo.storage_bucket || !photo.storage_path_original) {
      return json({ error: "photo has no original storage path" }, 400)
    }

    await admin
      .from("photos")
      .update({ watermark_status: "processing", watermark_error: null })
      .eq("id", photo.id)

    // Download original.
    const { data: blob, error: dlErr } = await admin.storage
      .from(photo.storage_bucket)
      .download(photo.storage_path_original)
    if (dlErr || !blob) {
      await markFailed(admin, photo.id, dlErr?.message || "download failed")
      return json({ error: "download failed" }, 500)
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
    const orient = typeof exif.Orientation === "number" ? exif.Orientation : null

    // Resolve photo tag — the step/item name takes precedence over photo_type.
    let photoTag = photo.photo_type || "Photo"
    if (photo.work_step_id) {
      const { data: step } = await admin
        .from("work_steps")
        .select("work_step_name, work_step_template_id")
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
    } else if (photo.related_object === "vehicle_activity_items" && photo.related_id) {
      // Daily Vehicle Inspection checklist photo — tag with the item name
      // (e.g. "Tire - Driver Front", "New Damage Check").
      const { data: vai } = await admin
        .from("vehicle_activity_items")
        .select("vai_name")
        .eq("id", photo.related_id)
        .maybeSingle()
      if (vai?.vai_name) photoTag = vai.vai_name
    }

    // Watermark rendering. Wrap in try/catch — a failed render still saves
    // EXIF data and marks watermark_status=failed; the gallery falls back
    // to the original.
    let watermarkPath: string | null = null
    let newStatus = "skipped"
    let renderError: string | null = null

    if (photo.apply_watermark) {
      try {
        const img = await Image.decode(buffer)

        // Apply EXIF orientation so the watermarked variant displays
        // correctly without relying on the orientation tag (which we strip
        // by re-encoding).
        if (orient === 3) img.rotate(180)
        else if (orient === 6) img.rotate(90)
        else if (orient === 8) img.rotate(270)

        // Cap watermarked variant at 2400px on the long edge to keep memory
        // and encode time bounded. Original is preserved full-res.
        const MAX_EDGE = 2400
        const longEdge = Math.max(img.width, img.height)
        if (longEdge > MAX_EDGE) {
          const scale = MAX_EDGE / longEdge
          img.resize(Math.round(img.width * scale), Math.round(img.height * scale))
        }

        // Build the three watermark lines.
        const tagLine = String(photoTag).slice(0, 80)
        const dateLine = takenAt ? formatDateUtc(takenAt) : "Date unknown"
        let gpsLine = "GPS unavailable"
        if (lat !== null && lng !== null) {
          gpsLine = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
          if (alt !== null) gpsLine += `  ·  ${Math.round(alt)} m`
        }

        // Strip dimensions: 22% of image height, semi-transparent dark grey.
        const stripH = Math.max(110, Math.round(img.height * 0.22))
        const stripY = img.height - stripH
        const strip = new Image(img.width, stripH)
        // Image.fill(color) — color is 0xRRGGBBAA. Dark navy 80% opacity.
        strip.fill(rgba(13, 26, 46, 0.78))
        img.composite(strip, 0, stripY)

        // Render text. Font size scales with image width.
        const fontBuf = await getFont(admin)
        const fontSize = Math.max(22, Math.round(img.width * 0.028))
        const lineGap = Math.round(fontSize * 0.45)
        const padX = Math.round(img.width * 0.025)
        const padY = Math.round(stripH * 0.12)

        const tagImg  = await Image.renderText(fontBuf, fontSize * 1.1, tagLine,  rgba(255, 255, 255, 1))
        const dateImg = await Image.renderText(fontBuf, fontSize,       dateLine, rgba(255, 255, 255, 0.92))
        const gpsImg  = await Image.renderText(fontBuf, fontSize,       gpsLine,  rgba(255, 255, 255, 0.92))

        let cy = stripY + padY
        img.composite(tagImg, padX, cy);  cy += tagImg.height + lineGap
        img.composite(dateImg, padX, cy); cy += dateImg.height + lineGap
        img.composite(gpsImg, padX, cy)

        const out = await img.encodeJPEG(85)

        // watermarked path: replace /original/ with /watermarked/ and force .jpg ext
        const origPath = photo.storage_path_original
        const baseName = origPath.split("/").pop() || "photo"
        const baseNoExt = baseName.replace(/\.[^.]+$/, "")
        const folder = origPath.replace(/\/original\/[^/]+$/, "/watermarked")
        watermarkPath = `${folder}/${baseNoExt}.jpg`

        const { error: upErr } = await admin.storage
          .from(photo.storage_bucket)
          .upload(watermarkPath, out, {
            contentType: "image/jpeg",
            upsert: true,
          })
        if (upErr) throw upErr

        newStatus = "done"
      } catch (e) {
        renderError = (e as Error).message || String(e)
        newStatus = "failed"
        watermarkPath = null
      }
    }

    // Persist EXIF + watermark result. Note: jsonb can't take Date directly,
    // so we serialise exif via JSON.parse(JSON.stringify(...)) which converts
    // Dates to ISO strings.
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
    if (updErr) return json({ error: updErr.message }, 500)

    return json({
      ok: true,
      photo_id: photo.id,
      watermark_status: newStatus,
      watermark_error: renderError,
      exif_keys: Object.keys(exif),
      taken_at: takenAt instanceof Date ? takenAt.toISOString() : null,
      latitude: lat,
      longitude: lng,
    })
  } catch (err) {
    console.error("process-photo fatal", err)
    return json({ error: (err as Error).message || String(err) }, 500)
  }
})

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
  // 'Apr 26, 2026 · 2:30 PM UTC'
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
