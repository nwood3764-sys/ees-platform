import { supabase } from '../lib/supabase'
import { getCurrentUserId } from './layoutService'

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
}

export function defaultPhotoBucket(relatedObject) {
  const bucket = PHOTO_ALLOWED_OBJECTS[relatedObject]
  if (!bucket) {
    throw new Error(
      `Photos are only supported on work_orders, work_steps, and ` +
      `vehicle_inspections. Got related_object="${relatedObject}". ` +
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
// Photos
// ───────────────────────────────────────────────────────────────────────────

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

  const bucket = defaultPhotoBucket(relatedObject) // throws if not allowed
  const photoId = newId()
  const path = photoOriginalPath(relatedObject, relatedId, photoId, file.name)

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

  // 2. Insert the photos row. photo_number is auto-filled by trigger when
  //    null. mime_type and file_size_bytes are populated client-side because
  //    the edge function may not run (e.g. apply_watermark=false in some
  //    future setting) and these are useful for any consumer.
  const userId = await getCurrentUserId().catch(() => null)
  const insertRow = {
    id: photoId,
    storage_bucket: bucket,
    storage_path_original: path,
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
    taken_at: new Date().toISOString(),
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
  //    Fire-and-forget: the row is already created and visible. If the
  //    function errors, watermark_status will be set to 'error' and
  //    watermark_error will hold the message — the gallery can show that.
  supabase.functions
    .invoke('process-photo', { body: { photo_id: photoRow.id } })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('process-photo invocation failed (non-fatal):', e?.message || e)
    })

  return photoRow
}

/**
 * Re-run the process-photo edge function for an existing row. Used when the
 * first attempt errored — typically transient failures (cold start timeout,
 * EXIF parse on an unusual file). Resets watermark_status to 'pending' so the
 * UI shows the spinner state again.
 */
export async function reprocessPhoto(photoId) {
  if (!photoId) throw new Error('reprocessPhoto: photoId is required')
  const { error: updErr } = await supabase
    .from('photos')
    .update({ watermark_status: 'pending', watermark_error: null })
    .eq('id', photoId)
  if (updErr) throw new Error(`photos update failed: ${updErr.message}`)
  const { error: invErr } = await supabase.functions
    .invoke('process-photo', { body: { photo_id: photoId } })
  if (invErr) throw new Error(`process-photo invocation failed: ${invErr.message}`)
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
export async function signedUrl(bucket, path, ttl = DEFAULT_SIGNED_URL_TTL_SECONDS) {
  if (!bucket || !path) return null
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl)
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
 * array with each row gaining `_thumbUrl` (watermarked if present, else
 * original) and `_originalUrl` (always the original).
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
    const wantedPath = p.storage_path_watermarked || p.storage_path_original
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
    const thumbPath = p.storage_path_watermarked || p.storage_path_original
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
 * Like hydratePhotoUrls but for documents. Adds `_url` (a signed URL good
 * for either inline preview or download).
 */
export async function hydrateDocumentUrls(documents) {
  if (!documents || documents.length === 0) return []
  const byBucket = new Map()
  for (const d of documents) {
    if (!d.storage_bucket || !d.storage_path) continue
    if (!byBucket.has(d.storage_bucket)) byBucket.set(d.storage_bucket, new Set())
    byBucket.get(d.storage_bucket).add(d.storage_path)
  }
  const urlMap = new Map()
  await Promise.all(Array.from(byBucket.entries()).map(async ([bucket, set]) => {
    const paths = Array.from(set)
    const urls = await signedUrls(bucket, paths)
    paths.forEach((p, i) => urlMap.set(`${bucket}::${p}`, urls[i]))
  }))
  return documents.map(d => ({
    ...d,
    _url: d.storage_bucket && d.storage_path
      ? urlMap.get(`${d.storage_bucket}::${d.storage_path}`) || null
      : null,
  }))
}
