import { supabase } from '../lib/supabase'
import { getCurrentUserId } from './layoutService'
import { compressPhotoForUpload } from '../lib/photoCompression'
import {
  heifRenditionForFile,
  decodeHeifToJpegBlob,
  renditionPathFor,
  isHeifBytes,
  displayPathForPhoto,
} from '../lib/heifRendition'
import { WORK_ORDER_STEP_KEY, UNASSIGNED_STEP_KEY, UNTAGGED as UNTAGGED_PHOTO_TYPE } from '../lib/photoTags'
import { areSignedUrlsUsable } from '../lib/signedUrlExpiry'

// ---------------------------------------------------------------------------
// storageService.js — uploads, downloads, deletes, and signed URLs for the
// `photos` and `documents` tables, backed by Supabase Storage.
//
// Conventions (matching production schema as of Apr 2026):
//
//   photos
//     storage_bucket           text      always "work-evidence"
//     storage_path_original    text      "work_orders/<uuid>/originals/<photoId>.<ext>"
//     storage_path_watermarked text      written by the process-photo edge fn
//     storage_path_rendition   text      device-decoded JPEG standing in for an
//                                        original the server cannot decode (HEIC)
//     apply_watermark          bool      whether the edge fn should watermark
//     watermark_status         text      'pending' | 'done' | 'error' | null
//     latitude / longitude / altitude / camera_* / orientation / mime_type /
//     exif_raw                            populated by the edge fn from EXIF
//
//   documents
//     storage_bucket           text      varies by related_object
//     storage_path             text      "<related_object>/<related_id>/<docId>__<safe_name>"
//
// Client never writes the watermarked variant or the EXIF columns —
// process-photo is the single source of truth for those.
// ---------------------------------------------------------------------------

// ───────────────────────────────────────────────────────────────────────────
// Bucket routing
// ───────────────────────────────────────────────────────────────────────────

// Photos are LOCKED DOWN to records that represent in-the-field evidence:
// work orders, individual work steps within those orders, and vehicle
// inspections. Anything else with photographic content (property condition,
// signed forms, etc.) belongs in Documents — not Photos.
//
// This is enforced at the JS boundary so a misconfigured page-layout widget
// (e.g. a "Photos" widget seeded onto Properties) fails loudly at upload time
// rather than scattering work-evidence across unrelated buckets.
const PHOTO_ALLOWED_OBJECTS = {
  work_orders:         'work-evidence',
  work_steps:          'work-evidence',
  vehicle_inspections: 'work-evidence',
  // Daily Vehicle Inspection checklist items — fleet evidence lives in its
  // own bucket, separate from job-site work evidence.
  vehicle_activity_items: 'fleet-evidence',
}

export function defaultPhotoBucket(relatedObject) {
  const bucket = PHOTO_ALLOWED_OBJECTS[relatedObject]
  if (!bucket) {
    throw new Error(
      `Photos are only supported on work_orders, work_steps, ` +
      `vehicle_inspections, and vehicle_activity_items. ` +
      `Got related_object="${relatedObject}". ` +
      `For other records, use a Documents widget instead.`
    )
  }
  return bucket
}

// Document buckets fan out by intent. property-documents is the catch-all
// for internal-staff uploads against any record that isn't a program
// application or a portal-originated upload.
const DOCUMENT_BUCKET_BY_OBJECT = {
  incentive_applications: 'program-applications',
  // Step-scoped files (evidence videos, required document uploads) are
  // field evidence — they belong with the step's photos, not in the
  // property paperwork bucket.
  work_steps: 'work-evidence',
  // Everything else falls through to property-documents.
}

export function defaultDocumentBucket(relatedObject) {
  return DOCUMENT_BUCKET_BY_OBJECT[relatedObject] || 'property-documents'
}

// ───────────────────────────────────────────────────────────────────────────
// Path / filename helpers
// ───────────────────────────────────────────────────────────────────────────

function fileExt(name) {
  if (!name) return ''
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Strip path separators, quotes, control chars, and collapse whitespace.
// Storage paths must be URL-safe; collisions are prevented by prefixing the
// generated record id, so this only needs to be readable, not unique.
function safeName(name) {
  if (!name) return 'file'
  return name
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/'"`<>?*|:]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 120) || 'file'
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Fallback (very old browsers) — not cryptographically strong but unique.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

function photoOriginalPath(relatedObject, relatedId, photoId, originalName) {
  const ext = fileExt(originalName) || 'jpg'
  return `${relatedObject}/${relatedId}/originals/${photoId}.${ext}`
}

function documentStoragePath(relatedObject, relatedId, docId, originalName) {
  return `${relatedObject}/${relatedId}/${docId}__${safeName(originalName)}`
}

// ───────────────────────────────────────────────────────────────────────────
// Avatars (user profile photos)
//
// The `avatars` bucket is PUBLIC, so a profile photo is referenced by its
// public URL stored on users.user_profile_photo_url. This replaces the old
// "paste a URL" approach — the user uploads a file and we both store it and
// produce the URL. upsert=true keyed on the user id so re-uploading replaces
// the previous avatar instead of accumulating orphans.
// ───────────────────────────────────────────────────────────────────────────
const AVATAR_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const AVATAR_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']

/**
 * Upload a user avatar to the public `avatars` bucket and return its public URL.
 * @param {Object} args
 * @param {File}   args.file    image File from <input type=file>
 * @param {string} args.userId  public.users.id the avatar belongs to (path key)
 * @returns {Promise<string>}   public URL to store on user_profile_photo_url
 */
export async function uploadAvatar({ file, userId }) {
  if (!file)   throw new Error('A file is required.')
  if (!userId) throw new Error('A user id is required.')
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error(`Image is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 5 MB.`)
  }
  if (file.type && !AVATAR_ALLOWED_MIME.includes(file.type)) {
    throw new Error('Unsupported image type. Use JPG, PNG, WEBP, GIF, or HEIC.')
  }
  const ext = fileExt(file.name) || 'jpg'
  // Stable path per user so re-upload overwrites; cache-buster added to the URL.
  const path = `${userId}/avatar.${ext}`
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: true,
    })
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  const base = data?.publicUrl
  if (!base) throw new Error('Could not resolve the uploaded image URL.')
  // Cache-buster so an overwritten avatar refreshes immediately in the UI.
  return `${base}?v=${Date.now()}`
}

// ───────────────────────────────────────────────────────────────────────────
// Record type icons — custom uploads
// ───────────────────────────────────────────────────────────────────────────
// An admin can upload a custom SVG/PNG icon for a record type (Object Manager
// > Record Types > Icon & Color). Stored in the public `record-type-icons`
// bucket so the badge renders it by URL. The reference kept on the record type
// (picklist_values.picklist_icon) is `upload:<mode>:<publicUrl>` where mode is
// 'mono' (recolored to match the badge via CSS mask) or 'color' (rendered
// as-is). See src/lib/recordTypeIcons.jsx for the render/parse side.
const RECORD_TYPE_ICON_BUCKET = 'record-type-icons'
const RECORD_TYPE_ICON_MAX_BYTES = 512 * 1024 // 512 KB — matches the bucket limit
const RECORD_TYPE_ICON_ALLOWED_MIME = ['image/svg+xml', 'image/png', 'image/webp']

/**
 * Upload a custom record-type icon and return its public URL.
 * @param {Object} args
 * @param {File}   args.file           image File from <input type=file>
 * @param {string} args.recordTypeId   picklist_values.id (path key)
 * @returns {Promise<string>}          public URL to embed in the picklist_icon ref
 */
export async function uploadRecordTypeIcon({ file, recordTypeId }) {
  if (!file)         throw new Error('A file is required.')
  if (!recordTypeId) throw new Error('A record type id is required.')
  if (file.size > RECORD_TYPE_ICON_MAX_BYTES) {
    throw new Error(`Icon is too large (${(file.size / 1024).toFixed(0)} KB). Maximum is 512 KB.`)
  }
  if (file.type && !RECORD_TYPE_ICON_ALLOWED_MIME.includes(file.type)) {
    throw new Error('Unsupported icon type. Upload an SVG, PNG, or WEBP.')
  }
  const ext = fileExt(file.name) || (file.type === 'image/svg+xml' ? 'svg' : 'png')
  // New filename per upload (timestamp) so an overwrite never serves a stale
  // cached asset under the same URL; the record type points at the latest.
  const path = `${recordTypeId}/icon-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from(RECORD_TYPE_ICON_BUCKET)
    .upload(path, file, { contentType: file.type || 'image/svg+xml', upsert: true })
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

  const { data } = supabase.storage.from(RECORD_TYPE_ICON_BUCKET).getPublicUrl(path)
  const url = data?.publicUrl
  if (!url) throw new Error('Could not resolve the uploaded icon URL.')
  return url
}

// ───────────────────────────────────────────────────────────────────────────
// Photos
// ───────────────────────────────────────────────────────────────────────────

// Sorts any step with no execution order to the very end of the roll-up.
const STEP_POSITION_LAST = Number.MAX_SAFE_INTEGER
// Photos on the work order itself belong after every step but ahead of any
// step the roll-up could not resolve.
const STEP_POSITION_WORK_ORDER = Number.MAX_SAFE_INTEGER - 1
// photo_type values that describe no particular subject, so there is no work
// step template field to read a label from.
const GENERIC_PHOTO_TYPES = new Set(['general', 'before', 'after'])

/**
 * Upload a photo file and create the matching row in `photos`.
 *
 * After the row is inserted we fire-and-forget the `process-photo` edge
 * function, which extracts EXIF (lat/long/timestamp/camera/orientation) and,
 * if `apply_watermark` is true, renders a watermarked variant alongside the
 * preserved original. The edge function updates the row with watermark_status
 * and the EXIF columns; the caller does not need to await it.
 *
 * @param {Object} args
 * @param {File}    args.file              the File from <input type=file> or camera capture
 * @param {string}  args.relatedObject     'work_orders' | 'work_steps' | 'vehicle_inspections'
 * @param {string}  args.relatedId         uuid of the parent record
 * @param {string}  [args.workStepId]      optional — only when scoping a photo to one step
 * @param {string}  [args.photoType]       free-form, defaults to 'general'
 * @param {boolean} [args.applyWatermark]  defaults to true
 * @param {string}  [args.caption]         user-entered caption
 * @returns {Promise<Object>}              the inserted photos row (pre-watermarking)
 */
export async function uploadPhoto({
  file,
  relatedObject,
  relatedId,
  workStepId = null,
  photoType = 'general',
  applyWatermark = true,
  caption = null,
}) {
  if (!file) throw new Error('uploadPhoto: file is required')
  if (!relatedObject) throw new Error('uploadPhoto: relatedObject is required')
  if (!relatedId)     throw new Error('uploadPhoto: relatedId is required')

  // Shrink large JPEGs on-device before they cross the (often cellular)
  // uplink — the dominant cost of a slow photo capture in the field. The
  // original EXIF block (GPS, timestamps, camera) is spliced into the
  // compressed file verbatim, and on any doubt the original is uploaded
  // unchanged, so process-photo's EXIF extraction sees the same data
  // either way.
  file = await compressPhotoForUpload(file)

  const bucket = defaultPhotoBucket(relatedObject) // throws if not allowed
  const photoId = newId()
  const path = photoOriginalPath(relatedObject, relatedId, photoId, file.name)

  // A HEIC capture (the iPhone default) is decoded HERE, on the device, and
  // uploaded alongside the untouched original. Nothing server-side can decode
  // it dependably: process-photo can, via libheif, but a 12 MP frame only fits
  // the edge worker's CPU budget when the scene is simple, so half a job's
  // photos would render and half would not. See src/lib/heifRendition.js.
  //
  // Returns null for every non-HEIF file and for any decode that fails, and a
  // missing rendition never blocks the upload — the row still lands and the
  // server still tries.
  const renditionBlob = await heifRenditionForFile(file)
  const renditionPath = renditionBlob ? renditionPathFor(path) : null

  // 1. Upload the original to Storage. upsert=false because we generated a
  //    fresh uuid for the path; a collision would be a logic bug we want to
  //    surface, not silently overwrite.
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`)

  // 1b. Upload the rendition beside it. Best-effort: a failure here costs the
  //     photo its preview, not its existence, so it must not throw.
  let renditionStored = null
  if (renditionBlob && renditionPath) {
    const { error: renErr } = await supabase.storage
      .from(bucket)
      .upload(renditionPath, renditionBlob, { contentType: 'image/jpeg', upsert: true })
    if (renErr) {
      // eslint-disable-next-line no-console
      console.warn('rendition upload failed (non-fatal):', renErr.message)
    } else {
      renditionStored = renditionPath
    }
  }

  // 2. Insert the photos row. photo_number is auto-filled by trigger when
  //    null. mime_type and file_size_bytes are populated client-side because
  //    the edge function may not run (e.g. apply_watermark=false in some
  //    future setting) and these are useful for any consumer.
  const userId = await getCurrentUserId().catch(() => null)
  const insertRow = {
    id: photoId,
    file_url: path,
    storage_bucket: bucket,
    storage_path_original: path,
    storage_path_rendition: renditionStored,
    apply_watermark: !!applyWatermark,
    watermark_status: applyWatermark ? 'pending' : null,
    file_size_bytes: file.size || null,
    mime_type: file.type || null,
    related_object: relatedObject,
    related_id: relatedId,
    work_step_id: workStepId,
    photo_type: photoType,
    caption,
    taken_by: userId,
    // Capture time comes from the PHOTO, never from the upload. process-photo
    // overwrites this with the EXIF DateTimeOriginal whenever the image carries
    // one (the authoritative source). Until it runs — and permanently for an
    // image that has no EXIF date — we seed taken_at from the file's own
    // last-modified time, which for a camera original is when the photo was
    // taken. This is what makes offline / folder / PC uploads correct: a photo
    // shot in the field and uploaded days later from the library or a computer
    // keeps its real capture time instead of being stamped with the upload
    // moment. (compressPhotoForUpload preserves lastModified.)
    taken_at: file?.lastModified ? new Date(file.lastModified).toISOString() : null,
  }

  const { data: photoRow, error: insErr } = await supabase
    .from('photos')
    .insert(insertRow)
    .select()
    .single()
  if (insErr) {
    // Try to clean up the orphaned storage object so we don't leak space.
    // Failure to clean up is non-fatal — the storage object will be
    // sweepable by an admin.
    try { await supabase.storage.from(bucket).remove([path]) } catch { /* noop */ }
    throw new Error(`photos insert failed: ${insErr.message}`)
  }

  // 3. Trigger the edge function to extract EXIF and (optionally) watermark.
  //    Fire-and-forget for most callers: the row is already created and
  //    visible. If the function errors, watermark_status will be set to
  //    'error' and watermark_error will hold the message — the gallery can
  //    show that. The invocation promise is exposed on the returned row as
  //    `_processing` (resolves to the function's result, or null on failure)
  //    so evidence-capture surfaces can await the EXIF outcome — e.g. LEAP
  //    Pad warns the technician when a photo carries no GPS coordinates.
  photoRow._processing = supabase.functions
    .invoke('process-photo', { body: { photo_id: photoRow.id } })
    .then(({ data, error }) => (error ? null : data))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('process-photo invocation failed (non-fatal):', e?.message || e)
      return null
    })

  return photoRow
}

/**
 * Re-run the process-photo edge function for an existing row. Used when the
 * first attempt errored — transient failures (cold start timeout, EXIF parse on
 * an unusual file) and, since 2026-08-24, HEIC originals that predate the
 * device-side rendition.
 *
 * A HEIC row uploaded before renditions existed has no pixels the server can
 * dependably read, so re-invoking alone would fail exactly as it did the first
 * time. Instead the original is pulled back down, decoded HERE (the same
 * decoder the upload path uses — the device has the CPU headroom the edge
 * worker does not), and stored as the row's rendition before the function runs.
 * That repairs the photo in place: no re-upload, no lost capture, and the
 * archival HEIC is never touched.
 *
 * Resets watermark_status to 'pending' so the UI shows the working state.
 */
export async function reprocessPhoto(photoId) {
  if (!photoId) throw new Error('reprocessPhoto: photoId is required')

  const { data: photo, error: readErr } = await supabase
    .from('photos')
    .select('id, storage_bucket, storage_path_original, storage_path_rendition')
    .eq('id', photoId)
    .maybeSingle()
  if (readErr) throw new Error(`photos read failed: ${readErr.message}`)

  const { error: updErr } = await supabase
    .from('photos')
    .update({ watermark_status: 'pending', watermark_error: null })
    .eq('id', photoId)
  if (updErr) throw new Error(`photos update failed: ${updErr.message}`)

  if (photo && !photo.storage_path_rendition) {
    const stored = await buildRenditionForStoredPhoto(photo)
    if (stored) {
      const { error: renErr } = await supabase
        .from('photos')
        .update({ storage_path_rendition: stored })
        .eq('id', photoId)
      if (renErr) throw new Error(`photos rendition update failed: ${renErr.message}`)
    }
  }

  const { error: invErr } = await supabase.functions
    .invoke('process-photo', { body: { photo_id: photoId } })
  if (invErr) throw new Error(`process-photo invocation failed: ${invErr.message}`)
}

/**
 * Download an already-stored original, and if it turns out to be HEIF, decode
 * it on the device and store the JPEG rendition beside it. Returns the stored
 * rendition path, or null when the original needs no rendition (a JPEG) or
 * could not be decoded.
 *
 * Deliberately silent on failure: this runs inside repair flows where the
 * caller's job is to make progress on whatever it can, not to abort a batch.
 */
async function buildRenditionForStoredPhoto(photo) {
  const bucket = photo?.storage_bucket
  const original = photo?.storage_path_original
  if (!bucket || !original) return null
  const target = renditionPathFor(original)
  if (!target) return null
  try {
    const { data: blob, error } = await supabase.storage.from(bucket).download(original)
    if (error || !blob) return null
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (!isHeifBytes(bytes)) return null // JPEG/PNG: the server reads it directly
    const rendition = await decodeHeifToJpegBlob(bytes)
    if (!rendition) return null
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(target, rendition, { contentType: 'image/jpeg', upsert: true })
    if (upErr) return null
    return target
  } catch {
    return null
  }
}

/**
 * Repair every photo on a record that has no usable rendered image — the bulk
 * form of reprocessPhoto, for a card full of HEIC captures uploaded before
 * device-side renditions existed.
 *
 * Sequential on purpose. Each HEIC decode is a multi-megapixel job on the
 * viewer's machine, and running a card's worth in parallel would lock the tab
 * up; one at a time keeps the page responsive and lets `onProgress` report
 * honestly. Returns { repaired, failed }.
 */
export async function repairUnrenderedPhotos(photos, { onProgress, signal } = {}) {
  const todo = (photos || []).filter(p => p && !p.storage_path_watermarked)
  const failedIds = []
  let repaired = 0
  for (let i = 0; i < todo.length; i++) {
    // The card that started this pass can be unmounted mid-run (the user moves
    // to another record). Stop rather than keep decoding for a dead component.
    if (signal?.aborted) break
    try {
      await reprocessPhoto(todo[i].id)
      repaired++
    } catch {
      failedIds.push(todo[i].id)
    }
    if (onProgress) {
      onProgress({ done: i + 1, total: todo.length, repaired, failed: failedIds.length })
    }
  }
  return { repaired, failed: failedIds.length, failedIds }
}

/**
 * List photos attached to a record. Soft-deleted rows are excluded.
 * If `workStepId` is provided, returns only photos scoped to that step.
 */
export async function listPhotos(relatedObject, relatedId, { workStepId = null } = {}) {
  if (!relatedObject || !relatedId) return []
  let q = supabase
    .from('photos')
    .select('*')
    .eq('related_object', relatedObject)
    .eq('related_id', relatedId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
  if (workStepId) q = q.eq('work_step_id', workStepId)
  const { data, error } = await q
  if (error) throw new Error(`photos list failed: ${error.message}`)
  return data || []
}

/**
 * Aggregate every live photo that belongs to a work order — the roll-up the
 * work order's Photos card shows.
 *
 * A work order's photos live at two grains and BOTH belong on the roll-up:
 *
 *   step grain   related_object='work_steps', related_id=<step id>, and the
 *                real FK work_step_id — the evidence a technician captured
 *                against a numbered step of the work plan
 *   order grain  related_object='work_orders', related_id=<work order id> —
 *                a photo attached to the job itself and to no one step (the
 *                Unable to Complete evidence photo, or a file dropped onto
 *                this very card)
 *
 * Reading the FK alone missed both the order-grain photos and any step photo
 * whose FK was never populated, which is why an assessment with 73 photos on
 * its steps showed an empty card. The FK is now guaranteed by
 * trg_photos_sync_work_step_anchor, but this still reads the polymorphic
 * anchor too: the roll-up is correct regardless of which writer produced the
 * row.
 *
 * Each returned row is a photos row plus:
 *   _work_step_id     the owning step's id, or 'work_order' (the filter key)
 *   _work_step_name   the owning step's name, or 'Work Order' (the tag)
 *   _work_step_position  the step's execution order (drives the ordering)
 *   _photo_tag_label  the photo_type's human label, resolved from the work
 *                     step template that asked for it
 *
 * Ordered by work step, then capture time within a step, with the
 * order-grain photos last. Returns raw rows; the caller hydrates signed URLs
 * via hydratePhotoUrls.
 */
export async function listWorkOrderPhotos(workOrderId) {
  if (!workOrderId) return []

  // 1. Steps for this work order (id → name + execution order).
  const { data: steps, error: stepErr } = await supabase
    .from('work_steps')
    .select('id, work_step_name, work_step_execution_order, work_step_plan_execution_order')
    .eq('work_order_id', workOrderId)
  if (stepErr) throw new Error(`work order steps load failed: ${stepErr.message}`)

  const stepIds = (steps || []).map(s => s.id)
  const stepNameById = new Map((steps || []).map(s => [s.id, s.work_step_name]))
  // Position map: the step's execution order in the work plan (what the work
  // step list on the record shows as 1, 2, 3…). Fall back to the plan execution
  // order, then to a large number so any unordered step sinks to the end.
  const stepPosById = new Map((steps || []).map(s => [
    s.id,
    s.work_step_execution_order ?? s.work_step_plan_execution_order ?? STEP_POSITION_LAST,
  ]))

  // 2. Photos, at both grains, in one round trip. The step queries are split
  //    (FK, then polymorphic anchor) rather than OR-ed so neither depends on
  //    the other's index, and rows caught by both are de-duplicated below.
  const photoSelect = () => supabase.from('photos').select('*').eq('is_deleted', false)
  const queries = [
    photoSelect().eq('related_object', 'work_orders').eq('related_id', workOrderId),
  ]
  if (stepIds.length > 0) {
    queries.push(photoSelect().in('work_step_id', stepIds))
    queries.push(photoSelect().eq('related_object', 'work_steps').in('related_id', stepIds))
  }
  const results = await Promise.all(queries)
  const failed = results.find(r => r.error)
  if (failed) throw new Error(`work order photos load failed: ${failed.error.message}`)

  const byId = new Map()
  for (const r of results) for (const p of r.data || []) byId.set(p.id, p)
  const photos = Array.from(byId.values())
  if (photos.length === 0) return []

  // 3. Resolve each photo's tag label from the work step template field that
  //    asked for it, so the gallery shows "Refrigerator Nameplate" instead of
  //    'kitchen_refrigerator_nameplate_photo'.
  const tagLabels = await resolvePhotoTagLabels(photos.map(p => p.photo_type))

  // 4. Tag each photo with its step (or the work order) and sort: by the
  //    step's execution order, then capture time within the step.
  return photos
    .map(p => {
      const stepId = p.work_step_id
        || (p.related_object === 'work_steps' ? p.related_id : null)
      const onAStep = stepId && stepNameById.has(stepId)
      return {
        ...p,
        _work_step_id: onAStep ? stepId : (stepId ? UNASSIGNED_STEP_KEY : WORK_ORDER_STEP_KEY),
        _work_step_name: onAStep ? stepNameById.get(stepId)
          : (stepId ? 'Unassigned step' : 'Work Order'),
        _work_step_position: onAStep
          ? (stepPosById.get(stepId) ?? STEP_POSITION_LAST)
          : (stepId ? STEP_POSITION_LAST : STEP_POSITION_WORK_ORDER),
        _photo_tag_label: tagLabels.get(String(p.photo_type || '').trim()) || null,
      }
    })
    .sort((a, b) => {
      if (a._work_step_position !== b._work_step_position) return a._work_step_position - b._work_step_position
      if (a._work_step_name !== b._work_step_name) return a._work_step_name.localeCompare(b._work_step_name)
      return (a.taken_at || '').localeCompare(b.taken_at || '')
    })
}

/**
 * photo_type → human label. A tag reaches a photo by one of two routes and
 * both are resolved here:
 *
 *   work step template   the named prompt a technician shot against
 *                        ('kitchen_overall_photo' → "Kitchen Overall Photo")
 *   photo tag picklist   a tag applied by hand from the Photos card
 *                        ('Damage or Deficiency' → itself)
 *
 * The template wins where both answer, because that is the wording the
 * technician saw in the field and the wording a program reviewer reads back.
 *
 * Only named tags are looked up; the generic legs ('general' / 'before' /
 * 'after') are labelled by the caller. A miss is not an error — an ad hoc tag
 * simply falls back to a humanized form of its own name.
 */
async function resolvePhotoTagLabels(types) {
  const wanted = Array.from(new Set(
    (types || [])
      .map(t => String(t || '').trim())
      .filter(t => t && !GENERIC_PHOTO_TYPES.has(t))
  ))
  if (wanted.length === 0) return new Map()

  const [templateRes, picklistRes] = await Promise.all([
    supabase
      .from('work_step_template_fields')
      .select('wstf_field_name, wstf_field_label')
      .in('wstf_field_name', wanted)
      .eq('wstf_is_deleted', false),
    supabase
      .from('picklist_values')
      .select('picklist_value, picklist_label')
      .eq('picklist_object', 'photos')
      .eq('picklist_field', 'photo_type')
      .in('picklist_value', wanted),
  ])

  const map = new Map()
  // Picklist first, template second, so the template's wording overwrites.
  for (const row of picklistRes.error ? [] : (picklistRes.data || [])) {
    if (row.picklist_label) map.set(row.picklist_value, row.picklist_label)
  }
  for (const row of templateRes.error ? [] : (templateRes.data || [])) {
    if (row.wstf_field_label) map.set(row.wstf_field_name, row.wstf_field_label)
  }
  return map // labels are a nicety; a failed lookup never sinks the gallery
}

/**
 * The tags a person may apply by hand, from the `photos` / `photo_type`
 * picklist. Admin-managed at Setup → Picklists — nothing here is compiled in,
 * so adding a tag the crew needs is a configuration change, not a deploy.
 *
 * Returns [] rather than throwing: an unreachable picklist should leave the
 * picker empty and honest, not break the Photos card.
 */
export async function fetchPhotoTagOptions() {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('picklist_value, picklist_label, picklist_description, picklist_sort_order')
    .eq('picklist_object', 'photos')
    .eq('picklist_field', 'photo_type')
    .eq('picklist_is_active', true)
    .order('picklist_sort_order', { ascending: true })
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('photo tag options unavailable:', error.message)
    return []
  }
  return (data || []).map(r => ({
    value: r.picklist_value,
    label: r.picklist_label || r.picklist_value,
    description: r.picklist_description || null,
  }))
}

/**
 * Every tag this work order's WORK PLAN offers — the vocabulary that actually
 * describes the job (Nicholas, 2026-08-25: "I need the tags for that work plan
 * to display so any user can select a photo and re-tag it").
 *
 * Two kinds, in the order the plan runs:
 *
 *   the work step itself   "Roof / Ceiling", "Service Hot Water" — the section
 *                          a photo documents, and the same names the assessment
 *                          report groups by, so tagging lines the two up.
 *   its photo prompts      the named shots that step asks for, where it has any.
 *
 * Resolvable from EITHER end: pass the work order, or pass a work step and the
 * work order is looked up from it. That matters because the Photos card lives
 * on both — gating this on work orders alone is why a work step's tag picker
 * showed nothing but generic tags.
 *
 * Returns [] on any failure; a missing group is survivable, a thrown picker is
 * not.
 */
export async function fetchWorkPlanPhotoTags({ workOrderId = null, workStepId = null } = {}) {
  let orderId = workOrderId
  if (!orderId && workStepId) {
    const { data, error } = await supabase
      .from('work_steps')
      .select('work_order_id')
      .eq('id', workStepId)
      .maybeSingle()
    if (error || !data?.work_order_id) return []
    orderId = data.work_order_id
  }
  if (!orderId) return []

  const { data: steps, error: stepErr } = await supabase
    .from('work_steps')
    .select('id, work_step_name, work_step_template_id, work_step_execution_order')
    .eq('work_order_id', orderId)
    .order('work_step_execution_order', { ascending: true })
  if (stepErr || !steps) return []

  const templateIds = Array.from(new Set(steps.map(s => s.work_step_template_id).filter(Boolean)))
  const promptsByTemplate = new Map()
  if (templateIds.length > 0) {
    const { data: fields } = await supabase
      .from('work_step_template_fields')
      .select('work_step_template_id, wstf_field_name, wstf_field_label, wstf_sort_order')
      .in('work_step_template_id', templateIds)
      .eq('wstf_field_type', 'photo')
      .eq('wstf_is_deleted', false)
      .order('wstf_sort_order', { ascending: true })
    for (const f of fields || []) {
      if (!promptsByTemplate.has(f.work_step_template_id)) {
        promptsByTemplate.set(f.work_step_template_id, [])
      }
      promptsByTemplate.get(f.work_step_template_id).push(f)
    }
  }

  // Deduped on BOTH value and label. A step and its single photo prompt often
  // read the same ("Foundation / Floor" the step, "Foundation / Floor" the
  // prompt) while carrying different stored values, so a value-only check
  // leaves the picker showing the same words twice with no way to tell them
  // apart. The step name wins, because it is added first and is the one a
  // person reaches for.
  const seenValues = new Set()
  const seenLabels = new Set()
  const out = []
  const push = (value, label) => {
    const v = String(value || '').trim()
    if (!v) return
    const text = String(label || v).trim()
    if (seenValues.has(v.toLowerCase()) || seenLabels.has(text.toLowerCase())) return
    seenValues.add(v.toLowerCase())
    seenLabels.add(text.toLowerCase())
    out.push({ value: v, label: text })
  }

  for (const step of steps) {
    // The step name first — it is the one a person reaches for.
    push(step.work_step_name, step.work_step_name)
    for (const f of promptsByTemplate.get(step.work_step_template_id) || []) {
      push(f.wstf_field_name, f.wstf_field_label || f.wstf_field_name)
    }
  }
  return out
}

/**
 * Apply a tag to photos — or clear it, by passing null.
 *
 * Re-watermarking is part of the operation, not an afterthought. process-photo
 * prints the tag onto the face of the evidence copy, so a photo whose row says
 * "Damage or Deficiency" while its image still says "general" is a record that
 * disagrees with the file a program reviewer receives. The row is updated
 * first, then each photo is re-rendered.
 *
 * Sequential, because each re-render is an edge-function invocation and a
 * sixty-photo batch fired at once is a thundering herd of cold starts. Returns
 * { tagged, failed }; a failed re-render leaves the row tagged and the photo
 * re-renderable from its own tile, which is better than rolling the tag back.
 */
export async function setPhotoTag(photoIds, tag, { onProgress } = {}) {
  const ids = (photoIds || []).filter(Boolean)
  if (ids.length === 0) return { tagged: 0, failed: 0 }
  const value = tag == null || tag === '' ? UNTAGGED_PHOTO_TYPE : String(tag)

  const { error } = await supabase
    .from('photos')
    .update({ photo_type: value })
    .in('id', ids)
  if (error) throw new Error(`photo tag update failed: ${error.message}`)

  let tagged = 0
  let failed = 0
  for (let i = 0; i < ids.length; i++) {
    // reprocessPhoto, not a raw invoke: it builds the device-side rendition
    // when one is missing, so tagging a HEIC that has never been rendered
    // renders it as well as re-stamping it.
    try { await reprocessPhoto(ids[i]); tagged++ } catch { failed++ }
    if (onProgress) onProgress({ done: i + 1, total: ids.length, tagged, failed })
  }
  return { tagged, failed }
}

/**
 * Soft-delete a photo. The storage objects are intentionally kept so the
 * record remains restorable from the Recycle Bin. Permanent purge is an
 * admin-only path (handled elsewhere).
 */
export async function softDeletePhoto(photoId) {
  if (!photoId) throw new Error('softDeletePhoto: photoId is required')
  const userId = await getCurrentUserId().catch(() => null)
  const { error } = await supabase
    .from('photos')
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
    })
    .eq('id', photoId)
  if (error) throw new Error(`photos soft-delete failed: ${error.message}`)
}

/**
 * Mark (or unmark) a photo for inclusion in the final project report. This is
 * an internal curation flag only — it never appears on the watermark. The RPC
 * stamps who/when on set and clears it on unset.
 *
 * @param {string}  photoId
 * @param {boolean} include
 * @returns {Promise<boolean>} the new flag value
 */
/**
 * Flag (or unflag) a DOCUMENT for the record's final report — the same curation
 * mark photos carry, so the set of things that belong in a deliverable is
 * recorded once instead of re-picked on every generation.
 *
 * Internal only: it never appears on the file and never restricts access.
 */
export async function setDocumentReportInclusion(documentId, include) {
  if (!documentId) throw new Error('setDocumentReportInclusion: documentId is required')
  const { data, error } = await supabase.rpc('set_document_report_inclusion', {
    p_document_id: documentId,
    p_include: !!include,
  })
  if (error) throw new Error(`report inclusion update failed: ${error.message}`)
  return data === true
}

export async function setPhotoReportInclusion(photoId, include) {
  if (!photoId) throw new Error('setPhotoReportInclusion: photoId is required')
  const { data, error } = await supabase.rpc('set_photo_report_inclusion', {
    p_photo_id: photoId,
    p_include: !!include,
  })
  if (error) throw new Error(`report inclusion update failed: ${error.message}`)
  return data === true
}

// ───────────────────────────────────────────────────────────────────────────
// Documents
// ───────────────────────────────────────────────────────────────────────────

/**
 * Upload a document and create the matching row in `documents`.
 *
 * @param {Object} args
 * @param {File}    args.file               the File to upload
 * @param {string}  args.relatedObject      table name of the parent record
 * @param {string}  args.relatedId          uuid of the parent record
 * @param {string}  [args.documentType]     free-form, defaults to 'attachment'
 * @param {string}  [args.name]             display name; falls back to file.name
 * @param {string}  [args.category]         optional secondary categorization
 * @param {string}  [args.programId]        optional FK into programs
 * @returns {Promise<Object>}               the inserted documents row
 */
export async function uploadDocument({
  file,
  relatedObject,
  relatedId,
  documentType = 'attachment',
  name = null,
  category = null,
  programId = null,
}) {
  if (!file) throw new Error('uploadDocument: file is required')
  if (!relatedObject) throw new Error('uploadDocument: relatedObject is required')
  if (!relatedId)     throw new Error('uploadDocument: relatedId is required')

  const bucket = defaultDocumentBucket(relatedObject)
  const docId = newId()
  const path = documentStoragePath(relatedObject, relatedId, docId, file.name)

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`)

  const userId = await getCurrentUserId().catch(() => null)
  const insertRow = {
    id: docId,
    storage_bucket: bucket,
    storage_path: path,
    name: name || file.name || 'Untitled',
    document_type: documentType,
    category,
    program_id: programId,
    file_size_bytes: file.size || null,
    mime_type: file.type || null,
    related_object: relatedObject,
    related_id: relatedId,
    uploaded_by: userId,
  }

  const { data: docRow, error: insErr } = await supabase
    .from('documents')
    .insert(insertRow)
    .select()
    .single()
  if (insErr) {
    try { await supabase.storage.from(bucket).remove([path]) } catch { /* noop */ }
    throw new Error(`documents insert failed: ${insErr.message}`)
  }

  return docRow
}

/** List non-deleted documents attached to a record, newest first. */
export async function listDocuments(relatedObject, relatedId) {
  if (!relatedObject || !relatedId) return []
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('related_object', relatedObject)
    .eq('related_id', relatedId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`documents list failed: ${error.message}`)
  return data || []
}

/** Soft-delete a document. See softDeletePhoto for rationale. */
export async function softDeleteDocument(documentId) {
  if (!documentId) throw new Error('softDeleteDocument: documentId is required')
  const userId = await getCurrentUserId().catch(() => null)
  const { error } = await supabase
    .from('documents')
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
    })
    .eq('id', documentId)
  if (error) throw new Error(`documents soft-delete failed: ${error.message}`)
}

// ───────────────────────────────────────────────────────────────────────────
// Signed URL helpers
//
// All of our content buckets except `avatars` are private, so the gallery
// needs short-lived signed URLs to render. We default to a 1-hour TTL —
// long enough that scrolling through a record doesn't trigger re-signs,
// short enough that a leaked URL isn't a meaningful exposure.
// ───────────────────────────────────────────────────────────────────────────

const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hour

/**
 * Sign a single storage path. Returns null on failure rather than throwing,
 * because a missing or unreadable file should degrade the gallery, not
 * crash the page.
 */
export async function signedUrl(bucket, path, ttl = DEFAULT_SIGNED_URL_TTL_SECONDS, download = null) {
  if (!bucket || !path) return null
  // When `download` is provided, Supabase sets Content-Disposition: attachment
  // with this filename, so the browser's save-as uses the clean display name
  // instead of the collision-prefixed storage key (the `{docId}__` segment).
  const opts = download ? { download } : undefined
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl, opts)
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`signedUrl(${bucket}/${path}) failed:`, error.message)
    return null
  }
  return data?.signedUrl || null
}

/**
 * Batch-sign multiple paths in the same bucket. Returns an array aligned
 * with the input — each entry is either a string URL or null.
 *
 * Supabase's createSignedUrls returns one entry per input even on failure
 * (with `error` set), so we preserve order rather than collapsing.
 */
export async function signedUrls(bucket, paths, ttl = DEFAULT_SIGNED_URL_TTL_SECONDS) {
  if (!bucket || !paths || paths.length === 0) return []
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, ttl)
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`signedUrls(${bucket}) failed:`, error.message)
    return paths.map(() => null)
  }
  return (data || []).map(d => d?.signedUrl || null)
}

/**
 * Resolve the URLs needed to render a list of photos. Returns the input
 * array with each row gaining `_thumbUrl` (the best displayable variant, per
 * displayPathForPhoto) and `_originalUrl` (always the original, whatever its
 * format — downloads and archival links want the real capture).
 *
 * Shaped this way so the gallery component never has to know which bucket
 * a photo lives in or which variant exists — it just renders what's there.
 */
export async function hydratePhotoUrls(photos) {
  if (!photos || photos.length === 0) return []
  // Group by bucket so we can issue one createSignedUrls call per bucket.
  // In practice every photo bucket is 'work-evidence' today, but grouping
  // is correct in case that changes.
  const byBucket = new Map()
  for (const p of photos) {
    if (!p.storage_bucket) continue
    const wantedPath = displayPathForPhoto(p)
    const orig = p.storage_path_original
    if (!byBucket.has(p.storage_bucket)) byBucket.set(p.storage_bucket, new Set())
    if (wantedPath) byBucket.get(p.storage_bucket).add(wantedPath)
    if (orig)       byBucket.get(p.storage_bucket).add(orig)
  }

  // Sign each bucket's paths in one call and build a (bucket,path) → url map.
  const urlMap = new Map() // key: `${bucket}::${path}` → signedUrl
  await Promise.all(Array.from(byBucket.entries()).map(async ([bucket, set]) => {
    const paths = Array.from(set)
    const urls = await signedUrls(bucket, paths)
    paths.forEach((p, i) => urlMap.set(`${bucket}::${p}`, urls[i]))
  }))

  return photos.map(p => {
    const thumbPath = displayPathForPhoto(p)
    return {
      ...p,
      _thumbUrl:    p.storage_bucket && thumbPath
        ? urlMap.get(`${p.storage_bucket}::${thumbPath}`) || null
        : null,
      _originalUrl: p.storage_bucket && p.storage_path_original
        ? urlMap.get(`${p.storage_bucket}::${p.storage_path_original}`) || null
        : null,
    }
  })
}

/**
 * Like hydratePhotoUrls but for documents. Adds TWO signed URLs per row:
 *
 *   _url        — carries the `download` option, so Content-Disposition is
 *                 `attachment; filename="<clean name>"`. Use for download /
 *                 save-as actions; the browser uses the clean display name
 *                 instead of the storage key's `{docId}__`-prefixed segment.
 *   _previewUrl — no download option, so Content-Disposition is `inline`.
 *                 Use for the iframe PDF preview. An `attachment` URL makes
 *                 the browser download rather than render, leaving the iframe
 *                 blank — that's why preview and download need separate URLs.
 *
 * Signed individually (not via batch createSignedUrls) because only the
 * per-call form accepts the download option. Document lists are short, so
 * two calls per row is negligible.
 */
export async function hydrateDocumentUrls(documents) {
  if (!documents || documents.length === 0) return []
  return Promise.all(documents.map(async d => {
    const hasFile = !!(d.storage_bucket && d.storage_path)
    const [url, previewUrl] = hasFile
      ? await Promise.all([
          signedUrl(d.storage_bucket, d.storage_path, DEFAULT_SIGNED_URL_TTL_SECONDS, d.name || undefined),
          signedUrl(d.storage_bucket, d.storage_path, DEFAULT_SIGNED_URL_TTL_SECONDS),
        ])
      : [null, null]
    return { ...d, _url: url, _previewUrl: previewUrl }
  }))
}

// ───────────────────────────────────────────────────────────────────────────
// Point-of-use re-signing
//
// hydrate*Urls above mints URLs when a gallery LOADS. The click that uses one
// can come much later — a record page stays open for hours — and a signed URL
// older than its TTL resolves to a Storage `InvalidJWT` error instead of the
// file. An <iframe> renders that error JSON in place of the PDF; an <img>
// shows a broken image.
//
// So every action that actually opens or downloads a file re-signs first.
// These helpers are cheap no-ops when the URLs on the row are still good —
// they return the SAME object so React re-renders nothing — and issue fresh
// signatures only when `isSignedUrlUsable` says the existing ones are spent.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Return `doc` with `_url` / `_previewUrl` guaranteed usable right now.
 * Returns the input object untouched when the existing URLs are still valid,
 * or when the row carries no file to sign.
 */
export async function freshDocumentUrls(doc) {
  if (!doc) return doc
  if (!doc.storage_bucket || !doc.storage_path) return doc
  if (areSignedUrlsUsable([doc._url, doc._previewUrl])) return doc
  const [hydrated] = await hydrateDocumentUrls([doc])
  return hydrated || doc
}

/**
 * Return `photo` with `_thumbUrl` / `_originalUrl` guaranteed usable right
 * now, on the same terms as freshDocumentUrls.
 */
export async function freshPhotoUrls(photo) {
  if (!photo) return photo
  if (!photo.storage_bucket) return photo
  if (areSignedUrlsUsable([photo._thumbUrl, photo._originalUrl])) return photo
  const [hydrated] = await hydratePhotoUrls([photo])
  return hydrated || photo
}

/**
 * Batch form for a whole gallery or a multi-select download. Re-signs in one
 * round trip per bucket when ANY row has gone stale, and returns the input
 * array unchanged when none has — a bulk download of 60 photos must not fire
 * 60 separate signing calls.
 */
export async function freshPhotoUrlsBatch(photos) {
  if (!photos || photos.length === 0) return photos || []
  const signable = photos.filter(p => p?.storage_bucket)
  if (signable.length === 0) return photos
  const allFresh = signable.every(p => areSignedUrlsUsable([p._thumbUrl, p._originalUrl]))
  if (allFresh) return photos
  return hydratePhotoUrls(photos)
}

/** Batch form of freshDocumentUrls, on the same all-or-nothing terms. */
export async function freshDocumentUrlsBatch(documents) {
  if (!documents || documents.length === 0) return documents || []
  const signable = documents.filter(d => d?.storage_bucket && d?.storage_path)
  if (signable.length === 0) return documents
  const allFresh = signable.every(d => areSignedUrlsUsable([d._url, d._previewUrl]))
  if (allFresh) return documents
  return hydrateDocumentUrls(documents)
}

// ─── Document Template Assets (docx) ───────────────────────────────────
// Authoring-mode .docx files for document_templates. One file per template,
// stored at:
//
//   templates/document_templates/{dt_id}/{timestamp}-{safe_name}
//
// Each upload creates a NEW path (timestamp-prefixed) — we never overwrite.
// Old paths remain in storage and stay valid references for any
// document_template_snapshots that pinned them at publish time. The live
// document_templates.dt_template_asset_path column always points to the
// most recent upload.
//
// Because the lock trigger blocks dt_template_asset_path updates while the
// template is Active, callers must unpublish before re-uploading. The error
// from the trigger surfaces back to the UI naturally.

const DOCX_TEMPLATE_BUCKET = 'templates'

export async function uploadDocumentTemplateAsset(documentTemplateId, file) {
  if (!documentTemplateId) throw new Error('documentTemplateId required')
  if (!file) throw new Error('file required')
  const ext = fileExt(file.name)
  if (ext !== 'docx') {
    throw new Error(`Only .docx files are supported (got .${ext || 'unknown'})`)
  }

  const path = `document_templates/${documentTemplateId}/${Date.now()}-${safeName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from(DOCX_TEMPLATE_BUCKET)
    .upload(path, file, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: false,
    })
  if (uploadError) throw uploadError

  const userId = await getCurrentUserId()
  const { error: rowError } = await supabase
    .from('document_templates')
    .update({
      dt_template_asset_path: path,
      updated_by: userId,
    })
    .eq('id', documentTemplateId)
  if (rowError) {
    // Best-effort cleanup: remove the just-uploaded blob so we don't leave
    // orphaned storage when the row update fails (lock trigger on Active
    // templates is the most common cause).
    try { await supabase.storage.from(DOCX_TEMPLATE_BUCKET).remove([path]) } catch { /* noop */ }
    throw rowError
  }

  return { path, bucket: DOCX_TEMPLATE_BUCKET }
}

export async function signedDocumentTemplateAssetUrl(path, ttl = DEFAULT_SIGNED_URL_TTL_SECONDS) {
  if (!path) return null
  return signedUrl(DOCX_TEMPLATE_BUCKET, path, ttl)
}

/**
 * Copy a document_template_asset to a new path under a different
 * document_template id. Used by the clone flow: after clone_document_template
 * RPC creates the cloned row (with NULL asset path), the FE calls this to
 * mirror the source's asset to the clone, then updates the clone's
 * dt_template_asset_path to the new path.
 *
 * Storage.from().copy() runs server-side so this doesn't transfer bytes
 * through the client.
 */
export async function copyDocumentTemplateAsset(sourcePath, targetDocumentTemplateId) {
  if (!sourcePath || !targetDocumentTemplateId) {
    throw new Error('sourcePath and targetDocumentTemplateId required')
  }
  const filename = sourcePath.split('/').pop() || 'template.docx'
  const targetPath = `document_templates/${targetDocumentTemplateId}/${Date.now()}-${filename}`

  const { error: copyError } = await supabase.storage
    .from(DOCX_TEMPLATE_BUCKET)
    .copy(sourcePath, targetPath)
  if (copyError) throw copyError

  const userId = await getCurrentUserId()
  const { error: rowError } = await supabase
    .from('document_templates')
    .update({
      dt_template_asset_path: targetPath,
      updated_by: userId,
    })
    .eq('id', targetDocumentTemplateId)
  if (rowError) {
    try { await supabase.storage.from(DOCX_TEMPLATE_BUCKET).remove([targetPath]) } catch { /* noop */ }
    throw rowError
  }

  return { path: targetPath, bucket: DOCX_TEMPLATE_BUCKET }
}
