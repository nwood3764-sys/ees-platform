import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import { useIsMobile } from '../lib/useMediaQuery'
import {
  UNTAGGED,
  buildStepFilterOptions,
  buildTagChoices,
  buildTagFilterOptions,
  stepEvidenceInSelection,
  filterGalleryPhotos,
  isMeaningfulTag,
  photoTagLabel,
  reconcileSelection,
  selectionLabel,
  toggleSelection,
} from '../lib/photoTags'
import {
  defaultPhotoBucket,
  uploadPhoto,
  listPhotos,
  listWorkOrderPhotos,
  hydratePhotoUrls,
  softDeletePhoto,
  setPhotoReportInclusion,
  setDocumentReportInclusion,
  reprocessPhoto,
  repairUnrenderedPhotos,
  fetchWorkPlanPhotoTags,
  setPhotoTag,
  uploadDocument,
  listDocuments,
  hydrateDocumentUrls,
  softDeleteDocument,
  freshDocumentUrls,
  freshPhotoUrls,
  freshPhotoUrlsBatch,
  freshDocumentUrlsBatch,
} from '../data/storageService'
import { isSignedUrlUsable } from '../lib/signedUrlExpiry'
import { isImageFile, fileTypeLabel } from '../lib/fileKinds'
import { usePhotoRepair } from '../lib/usePhotoRepair'
import {
  documentFileName,
  documentsZipName,
  pruneSelectedIds,
  uniqueEntryName,
} from '../lib/documentDownloads'
import {
  documentSlotType,
  isRequiredDocumentSlot,
  documentSlotHelpText,
  filterSlotDocuments,
} from '../lib/documentSlots'

// ---------------------------------------------------------------------------
// FileGallery — Salesforce-style related-list card for photos and documents.
//
// Rendered on the Related tab of a record, one instance per widget. The
// widget's config.target chooses the mode:
//
//     { target: 'photos',    photo_type, apply_watermark, work_step_id? }
//     { target: 'documents', document_type, category? }
//
// Both modes share the same outer card, header, and drag-and-drop zone.
// Photos render as a thumbnail grid that opens a lightbox; documents
// render as a list with a download/preview action per row.
//
// Photo mode is hard-locked to work_orders / work_steps / vehicle_inspections
// inside storageService — if a layout author drops a Photos widget onto an
// unsupported object, this component renders a friendly "not supported"
// notice instead of breaking the upload flow at runtime.
// ---------------------------------------------------------------------------

// Header colour scheme — emerald wash for photos, sky-blue wash for docs.
// Mirrors the "Documents" section icon in RelatedListWidget so the visual
// language stays consistent.
const HEADER_THEME = {
  photos:    { iconBg: '#e8f8f2', iconColor: '#1a7a4e',
               iconPath: 'M3 7h2l2-3h10l2 3h2v12H3V7z M12 11a4 4 0 100 8 4 4 0 000-8z' },
  documents: { iconBg: '#e8f3fb', iconColor: '#1a5a8a',
               iconPath: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z M14 2v6h6 M9 13h6 M9 17h6' },
}

const ACCEPT_BY_MODE = {
  photos: 'image/*',
  // Documents: no picker filter. The storage bucket governs what's actually
  // allowed, and drag-and-drop bypasses `accept` regardless — so an over-tight
  // filter only hides valid files (video, CAD/.dwg, Matterport/point-cloud
  // exports, 360 captures, archives) from staff in the file dialog. Leaving it
  // unset lets the picker show everything; a rejected type still fails loudly
  // at upload with the bucket's message.
  documents: undefined,
}

// Gallery sizing — a 4-up grid on desktop drops to 3-up on tablet and 2-up
// on mobile via plain CSS grid. We keep the thumbnail aspect 1:1 so the
// grid stays tidy regardless of source orientation; the lightbox shows the
// full-resolution image without cropping.
const THUMB_GAP = 8

// ── Download helpers ────────────────────────────────────────────────────────
// Downloads deliver the WATERMARKED variant — it carries BOTH the visible tag
// (step · property·building·unit · date · GPS), which the incentive programs
// require to accept a photo, AND the original camera EXIF (capture timestamp +
// GPS), which process-photo copies back in verbatim after re-encoding. So the
// downloaded file is a valid submission and its metadata is accurate. The
// pristine original is never modified and remains the archival source of truth.
function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

async function fetchAsBlob(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.blob()
}

// Safe, human-readable filename from the photo's number + work-step tag.
//
// The extension follows the bytes actually being downloaded, which is not
// always JPEG: the watermarked evidence file is, but a photo with no rendered
// variant downloads its ORIGINAL, and for an iPhone capture that is a .heic.
// Naming those .jpg produced a file that opens on a Mac and confuses everything
// else — a mislabelled evidence file is worse than an honestly named one.
function photoFileName(p) {
  const parts = [p.photo_number, p._work_step_name].filter(Boolean)
  const base = (parts.join(' - ') || p.id || 'photo')
    .replace(/[^\w \-().]/g, '').trim().slice(0, 90) || 'photo'
  const source = p._thumbUrl
    ? (p.storage_path_watermarked || p.storage_path_rendition)
    : p.storage_path_original
  const ext = String(source || '').toLowerCase().split('?')[0].split('.').pop()
  return `${base}.${/^[a-z0-9]{2,5}$/.test(ext) ? ext : 'jpg'}`
}

async function downloadSinglePhoto(p) {
  // Re-sign first: the URL on the row was minted when the gallery loaded and
  // may have aged out of its TTL while the user worked on the record.
  const fresh = await freshPhotoUrls(p)
  const u = fresh._thumbUrl || fresh._originalUrl
  if (!u) throw new Error('image not available')
  triggerBlobDownload(await fetchAsBlob(u), photoFileName(fresh))
}

// Zip N watermarked evidence files in-browser (jszip lazy-loaded so it stays
// off the main bundle). Each entry carries the visible tag and the preserved
// EXIF.
async function downloadPhotosZip(photos, zipName) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const used = new Set()
  let added = 0, skipped = 0
  // One batched re-sign for the whole selection, not one per file.
  const rows = await freshPhotoUrlsBatch(photos)
  for (const p of rows) {
    const u = p._thumbUrl || p._originalUrl
    if (!u) { skipped++; continue }
    let blob
    try { blob = await fetchAsBlob(u) } catch { skipped++; continue }
    const name = uniqueEntryName(photoFileName(p), used)
    used.add(name)
    zip.file(name, blob)
    added++
  }
  if (added === 0) throw new Error('no original files could be fetched')
  const out = await zip.generateAsync({ type: 'blob' })
  triggerBlobDownload(out, zipName)
  return { added, skipped }
}

// Documents download as themselves — the stored file, under the name it was
// uploaded with. There is no watermarked variant and nothing is re-encoded, so
// an Asset Score PDF or an .osm model comes back byte-identical to what the
// program will be sent.
async function downloadSingleDocument(d) {
  // Same re-sign-first rule as photos: the URL on the row was minted when the
  // card loaded and a record page stays open for hours.
  const fresh = await freshDocumentUrls(d)
  const u = fresh._url || fresh._previewUrl
  if (!u) throw new Error('file not available')
  triggerBlobDownload(await fetchAsBlob(u), documentFileName(fresh))
}

// Zip a selection of documents in-browser (jszip lazy-loaded, same as the
// photo path, so it stays off the main bundle). One batched re-sign for the
// whole selection rather than one call per file.
async function downloadDocumentsZip(documents, zipName) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const used = new Set()
  let added = 0, skipped = 0
  const rows = await freshDocumentUrlsBatch(documents)
  for (const d of rows) {
    const u = d._url || d._previewUrl
    if (!u) { skipped++; continue }
    let blob
    try { blob = await fetchAsBlob(u) } catch { skipped++; continue }
    const name = uniqueEntryName(documentFileName(d), used)
    used.add(name)
    zip.file(name, blob)
    added++
  }
  if (added === 0) throw new Error('no files could be fetched')
  const out = await zip.generateAsync({ type: 'blob' })
  triggerBlobDownload(out, zipName)
  return { added, skipped }
}

export default function FileGalleryWidget({
  widget, parentTable, parentRecordId, claimedSlotTypes,
}) {
  const config = widget.widget_config || {}
  const target = config.target === 'documents' ? 'documents' : 'photos'
  // Document slots: a gallery naming a `document_type` shows only that kind of
  // file; a catch-all shows everything no sibling slot on the layout claims.
  // See src/lib/documentSlots.js — before 2026-08-25 nothing filtered, so every
  // typed slot on a layout rendered the identical full document list.
  const slotType    = documentSlotType(config)
  const slotHelp    = documentSlotHelpText(config)
  const slotRequired = isRequiredDocumentSlot(config)
  // The claimed-type set comes down as a fresh value on every parent render, so
  // reduce it to a stable string first — a Set in a hook dependency list would
  // re-run the loader forever.
  const claimedKey  = [...(claimedSlotTypes || [])].sort().join('|')
  // Work-order photo galleries aggregate across every step of the work order,
  // tagging each photo with its work step. Active only on a work_orders record
  // with no specific step pinned in config (a step-scoped widget keeps the
  // single-step behavior via listPhotos).
  const isWorkOrderPhotoGallery =
    target === 'photos' &&
    parentTable === 'work_orders' &&
    !config.work_step_id
  const isMobile = useIsMobile()
  const toast = useToast()
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const containerRef = useRef(null)

  const [collapsed, setCollapsed] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [items, setItems]         = useState([])     // photos or documents (hydrated with _url / _thumbUrl)
  // Mirrors `items` for the foreground re-sign below, which reads the current
  // rows from an event handler rather than a render.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [error, setError]         = useState(null)
  const [uploading, setUploading] = useState(0)      // count of in-flight uploads
  const [dragActive, setDragActive] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState(null) // photos only
  const [previewDoc, setPreviewDoc] = useState(null)   // documents only — modal preview
  // {id, name} for one item, or {ids:[...], name} for a selection (bulk delete).
  const [confirmDelete, setConfirmDelete] = useState(null)
  // Multi-select: arrays of chosen ids, empty meaning every one. A reviewer
  // pulls "Roof / Ceiling AND Windows & Doors" out together, not one at a time
  // (Nicholas, 2026-08-22).
  const [stepFilter, setStepFilter] = useState([])  // WO gallery: work step ids
  const [tagFilter, setTagFilter]   = useState([])  // WO gallery: photo_types
  // Multi-select for the bulk actions, in BOTH modes. Documents got it on
  // 2026-08-24 — nine Asset Score files had to be pulled one at a time.
  const [selectMode, setSelectMode]   = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [downloading, setDownloading] = useState(false)
  const [showReportOnly, setShowReportOnly] = useState(false) // filter to report-flagged photos

  const claimedList = useMemo(
    () => (claimedKey ? claimedKey.split('|') : []),
    [claimedKey],
  )

  // Photos-only: detect a misconfigured widget (e.g. on a property) so we
  // can show a clear message instead of letting the user click Upload and
  // see an opaque error. Documents have no such restriction.
  const photoLockoutMessage = useMemo(() => {
    if (target !== 'photos') return null
    try { defaultPhotoBucket(parentTable); return null }
    catch (e) { return e.message }
  }, [target, parentTable])

  const title = widget.widget_title || (target === 'photos' ? 'Photos' : 'Documents')
  const theme = HEADER_THEME[target]

  // ── Loaders ─────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!parentTable || !parentRecordId) return
    setLoading(true)
    setError(null)
    try {
      if (target === 'photos') {
        const rows = isWorkOrderPhotoGallery
          ? await listWorkOrderPhotos(parentRecordId)
          : await listPhotos(parentTable, parentRecordId, {
              workStepId: config.work_step_id || null,
            })
        const hydrated = await hydratePhotoUrls(rows)
        setItems(hydrated)
      } else {
        const all = await listDocuments(parentTable, parentRecordId)
        // Filter BEFORE hydrating: signing a URL costs a round trip, and a slot
        // has no use for the rows belonging to other slots.
        const rows = filterSlotDocuments(all, config, claimedList)
        const hydrated = await hydrateDocumentUrls(rows)
        setItems(hydrated)
      }
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentTable, parentRecordId, target, config.work_step_id, isWorkOrderPhotoGallery,
      slotType, claimedList])

  useEffect(() => { refresh() }, [refresh])

  // A record page is left open for hours, so the URLs signed at load go stale
  // in place — a thumbnail that lazy-loads afterwards would 400. Re-sign the
  // card's rows when the tab returns to the foreground, which is when a long
  // absence ends. The batch helpers return the same array when every URL is
  // still good, so this is a no-op in the common case.
  useEffect(() => {
    let cancelled = false
    async function resignIfStale() {
      if (document.visibilityState === 'hidden') return
      const current = itemsRef.current
      if (!current || current.length === 0) return
      const next = target === 'photos'
        ? await freshPhotoUrlsBatch(current)
        : await freshDocumentUrlsBatch(current)
      // Identity change means something was actually re-signed; and only
      // apply it if the card has not loaded a different set meanwhile.
      if (!cancelled && next !== current && itemsRef.current === current) setItems(next)
    }
    const onForeground = () => { resignIfStale().catch(() => {}) }
    window.addEventListener('focus', onForeground)
    document.addEventListener('visibilitychange', onForeground)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onForeground)
      document.removeEventListener('visibilitychange', onForeground)
    }
  }, [target])

  // Work-order gallery: the two filter dropdowns. A photo carries a work step
  // (where it was captured) and a tag (what it shows) — both are worth
  // filtering by on an assessment that runs to several hundred photos.
  const stepOptions = useMemo(
    () => (isWorkOrderPhotoGallery ? buildStepFilterOptions(items) : []),
    [items, isWorkOrderPhotoGallery])
  const tagOptions = useMemo(
    () => (isWorkOrderPhotoGallery ? buildTagFilterOptions(items) : []),
    [items, isWorkOrderPhotoGallery])

  // A filter pinned to a step or tag that no longer has photos (the last one
  // was deleted, or another record loaded into the same card) falls back to
  // All rather than showing an empty grid with no explanation.
  useEffect(() => {
    setStepFilter(v => {
      const next = reconcileSelection(v, stepOptions)
      return next.length === v.length ? v : next
    })
    setTagFilter(v => {
      const next = reconcileSelection(v, tagOptions)
      return next.length === v.length ? v : next
    })
  }, [stepOptions, tagOptions])

  const visiblePhotos = useMemo(() => {
    if (!isWorkOrderPhotoGallery) {
      return showReportOnly ? items.filter(p => p.include_in_final_report) : items
    }
    return filterGalleryPhotos(items, {
      steps: stepFilter, tags: tagFilter, reportOnly: showReportOnly,
    })
  }, [items, stepFilter, tagFilter, isWorkOrderPhotoGallery, showReportOnly])

  // The rows a bulk action can actually reach: the filtered grid in photo
  // mode, the whole list in document mode (documents carry no filters).
  const visibleItems = target === 'photos'
    ? visiblePhotos
    // Documents carry the same curation flag as photos, so the same "In
    // report" filter applies to them.
    : (showReportOnly ? items.filter(d => d.include_in_final_report) : items)

  // ── Selection + download ────────────────────────────────────────────
  // Drop selections that scroll out of the current filter, or that were just
  // deleted, so the count always matches what's on screen.
  useEffect(() => {
    if (!selectMode) return
    const visibleIds = visibleItems.map(it => it.id)
    setSelectedIds(prev => {
      const next = pruneSelectedIds([...prev], visibleIds)
      return next.length === prev.size ? prev : new Set(next)
    })
  }, [visibleItems, selectMode])

  const toggleSelect = (id) => setSelectedIds(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })
  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()) }
  const selectAllVisible = () => setSelectedIds(new Set(visibleItems.map(it => it.id)))

  // One file downloads as itself; several are zipped. Both modes take the same
  // route so a selection of one never produces a zip holding a single file.
  const handleDownloadSelected = async () => {
    const chosen = visibleItems.filter(it => selectedIds.has(it.id))
    if (chosen.length === 0) return
    const noun = target === 'photos' ? 'photo' : 'document'
    setDownloading(true)
    try {
      if (target === 'photos') {
        if (chosen.length === 1) await downloadSinglePhoto(chosen[0])
        else await downloadPhotosZip(chosen, 'work-order-photos.zip')
      } else {
        if (chosen.length === 1) await downloadSingleDocument(chosen[0])
        else await downloadDocumentsZip(chosen, documentsZipName(title))
      }
      toast.success(`Downloaded ${chosen.length} ${noun}${chosen.length > 1 ? 's' : ''}`)
      exitSelect()
    } catch (e) {
      toast.error(`Download failed: ${e.message || e}`)
    } finally {
      setDownloading(false)
    }
  }

  // Single-row download, from the row's own button and from the preview modal.
  // Kept separate from the selection path so downloading one file never
  // requires entering select mode first.
  const handleDownloadDocument = async (d) => {
    try {
      await downloadSingleDocument(d)
      toast.success(`Downloaded ${d.name || 'document'}`)
    } catch (e) {
      toast.error(`Download failed: ${e.message || e}`)
    }
  }

  // Toggle the internal "include in final report" flag. Optimistic — flips the
  // local row immediately, reverts on failure. Not shown on the watermark.
  const setLocalReportFlag = (rowId, val) =>
    setItems(prev => prev.map(p => p.id === rowId ? { ...p, include_in_final_report: val } : p))
  // One curation flag, two objects. A document belongs in a deliverable for
  // exactly the reasons a photo does, so it is flagged once and the report
  // reads the flag — rather than the person re-picking files on every
  // generation (Nicholas, 2026-08-27).
  const setReportInclusion = (id, include) => (target === 'photos'
    ? setPhotoReportInclusion(id, include)
    : setDocumentReportInclusion(id, include))
  const handleToggleReport = async (row) => {
    const next = !row.include_in_final_report
    setLocalReportFlag(row.id, next)
    try {
      await setReportInclusion(row.id, next)
    } catch (e) {
      setLocalReportFlag(row.id, !next) // revert
      toast.error(e.message || 'Could not update report flag')
    }
  }
  // Flag or unflag every selected photo. Sequential so one failure doesn't
  // leave the rest in an unknown state, and optimistic per row so the grid
  // keeps up with a 40-photo selection.
  const [reportBusy, setReportBusy] = useState(false)
  const [tagPicker, setTagPicker] = useState(null)   // {photos} while choosing a tag
  const [tagPrompts, setTagPrompts] = useState([])       // this work order's own photo prompts
  const [tagBusy, setTagBusy] = useState(null)       // {done,total} while applying
  const selectedPhotos = useMemo(
    () => (target === 'photos' ? visiblePhotos : visibleItems).filter(p => selectedIds.has(p.id)),
    [target, visiblePhotos, visibleItems, selectedIds])
  const selectedAllInReport = selectedPhotos.length > 0
    && selectedPhotos.every(p => p.include_in_final_report)
  const handleReportSelected = async () => {
    if (selectedPhotos.length === 0) return
    const next = !selectedAllInReport
    setReportBusy(true)
    let changed = 0
    let failed = 0
    for (const photo of selectedPhotos) {
      if (!!photo.include_in_final_report === next) continue
      setLocalReportFlag(photo.id, next)
      try {
        await setReportInclusion(photo.id, next)
        changed += 1
      } catch (e) {
        setLocalReportFlag(photo.id, !next)
        failed += 1
      }
    }
    setReportBusy(false)
    if (changed > 0) {
      const noun = target === 'photos' ? 'photo' : 'document'
      toast.success(next
        ? `${changed} ${noun}${changed === 1 ? '' : 's'} added to the final report`
        : `${changed} ${noun}${changed === 1 ? '' : 's'} removed from the final report`)
    }
    if (failed > 0) toast.error(`${failed} could not be updated`)
    if (changed > 0 || failed > 0) exitSelect()
  }

  const reportCount = useMemo(
    () => items.filter(p => p.include_in_final_report).length,
    [items]
  )

  // Photos still being processed won't have their watermarked URL on first
  // load. Poll lightly while any are in flight so the UI catches up when the
  // edge function finishes. 'processing' counts as in flight too: process-photo
  // flips a row to that the moment it picks it up, and a row that never came
  // back from it is exactly the case a viewer is most likely to be watching.
  useEffect(() => {
    if (target !== 'photos') return
    const inFlight = items.some(p => p.watermark_status === 'pending' || p.watermark_status === 'processing')
    if (!inFlight) return
    const t = setTimeout(refresh, 4000)
    return () => clearTimeout(t)
  }, [items, target, refresh])

  // The tag vocabulary belongs to the work plan — its steps and their photo
  // prompts. There is no second, generic list: a photo on a job documents part
  // of that job.
  useEffect(() => {
    if (target !== 'photos') return
    let cancelled = false
    // The work PLAN's own vocabulary — its work steps and their photo prompts.
    // Resolved from either end, because the Photos card lives on the work order
    // AND on each work step; gating this on work orders alone is exactly why a
    // work step's picker showed nothing but generic tags.
    if (parentRecordId && (parentTable === 'work_orders' || parentTable === 'work_steps')) {
      fetchWorkPlanPhotoTags(parentTable === 'work_orders'
        ? { workOrderId: parentRecordId }
        : { workStepId: parentRecordId })
        .then(list => { if (!cancelled) setTagPrompts(list) })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [target, parentTable, parentRecordId])

  // Photos with no displayable image — a HEIC capture whose rendition and
  // watermark were never produced. These are the tiles that used to render as
  // broken images; the card offers to repair them in place.
  const unrenderedPhotos = useMemo(
    () => (target === 'photos' ? items.filter(p => !p._thumbUrl && p.storage_path_original) : []),
    [items, target]
  )
  // ── Upload handlers ─────────────────────────────────────────────────
  const handleFiles = useCallback(async (fileList) => {
    if (!fileList || fileList.length === 0) return
    if (photoLockoutMessage) {
      toast.error(photoLockoutMessage)
      return
    }
    const files = Array.from(fileList)
    const misfiled = []   // non-images filed as documents instead
    let successCount = 0
    let failCount = 0
    setUploading(c => c + files.length)
    try {
      // Sequential upload — keeps memory predictable on mobile and avoids
      // hammering the edge function with N parallel cold starts. Most
      // real-world uploads are 1-3 files at a time.
      for (const file of files) {
        try {
          // A PDF floor plan, a DWG, a spreadsheet — these are documents that
          // happened to be dropped on the Photos card. Taking them as photos
          // produced a tile that could never show anything (Nicholas,
          // 2026-08-24). They are filed as documents on the SAME record
          // instead: documentation is never blocked, it just lands in the
          // right place, and the work step already has a Documents card.
          if (target === 'photos' && !isImageFile(file.name, file.type)) {
            await uploadDocument({
              file,
              relatedObject: parentTable,
              relatedId: parentRecordId,
              documentType: config.document_type || 'attachment',
              category: config.category || null,
              programId: config.program_id || null,
            })
            misfiled.push({ name: file.name, kind: fileTypeLabel(file.name, file.type) })
          } else if (target === 'photos') {
            await uploadPhoto({
              file,
              relatedObject: parentTable,
              relatedId: parentRecordId,
              // A photos card sitting on a WORK STEP's own record page is
              // capturing evidence for that step, so it stamps the FK that the
              // work order roll-up reads. (The database enforces the same
              // invariant — this keeps the row right before it gets there.)
              workStepId: config.work_step_id
                || (parentTable === 'work_steps' ? parentRecordId : null),
              photoType: config.photo_type || 'general',
              applyWatermark: config.apply_watermark !== false,
            })
          } else {
            await uploadDocument({
              file,
              relatedObject: parentTable,
              relatedId: parentRecordId,
              documentType: config.document_type || 'attachment',
              category: config.category || null,
              programId: config.program_id || null,
            })
          }
          successCount++
        } catch (e) {
          failCount++
          // eslint-disable-next-line no-console
          console.error('Upload failed:', file.name, e)
          toast.error(`${file.name}: ${e.message || 'upload failed'}`)
        }
      }
    } finally {
      setUploading(c => Math.max(0, c - files.length))
    }
    if (successCount > 0) {
      if (misfiled.length === successCount) {
        // Everything dropped was a document. Say where it went — silently
        // filing it elsewhere would look like the upload vanished.
        toast.success(misfiled.length === 1
          ? `${misfiled[0].name} is a ${misfiled[0].kind}, not a photo — filed under Documents`
          : `${misfiled.length} files were documents, not photos — filed under Documents`)
      } else if (misfiled.length > 0) {
        toast.success(`Uploaded ${successCount - misfiled.length} photo${successCount - misfiled.length === 1 ? '' : 's'}`)
        toast.success(misfiled.length === 1
          ? `${misfiled[0].name} is a ${misfiled[0].kind} — filed under Documents`
          : `${misfiled.length} of them were documents — filed under Documents`)
      } else {
        toast.success(
          files.length === 1
            ? `Uploaded ${files[0].name}`
            : `Uploaded ${successCount} of ${files.length} files`
        )
      }
      await refresh()
    } else if (failCount > 0) {
      // Errors already toasted per-file above; nothing to add.
    }
  }, [target, parentTable, parentRecordId, config.work_step_id,
      config.photo_type, config.apply_watermark, config.document_type,
      config.category, config.program_id, photoLockoutMessage, toast, refresh])

  // Drag-and-drop wiring. We listen on the card so the user can drop
  // anywhere on the widget, not just in a small zone. The dragActive state
  // dims the card and shows a "Drop to upload" overlay.
  const onDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true) }
  const onDragOver  = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy' }
  const onDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation()
    // Only clear if we're leaving the container itself (not a child).
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget)) {
      setDragActive(false)
    }
  }
  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const onPickerChange = (e) => {
    handleFiles(e.target.files)
    e.target.value = '' // allow same file twice
  }

  // ── Delete / reprocess ──────────────────────────────────────────────
  const performDelete = async () => {
    if (!confirmDelete) return
    const { id, ids, name } = confirmDelete
    // Deleting a selection: soft-delete each one, then report how many landed.
    // Everything here is a soft delete — the rows go to the recycle bin, never
    // out of the database (LEAP never hard-deletes).
    if (Array.isArray(ids)) {
      const del = target === 'photos' ? softDeletePhoto : softDeleteDocument
      const noun = target === 'photos' ? 'photo' : 'document'
      const results = await Promise.allSettled(ids.map(one => del(one)))
      const failed = results.filter(r => r.status === 'rejected').length
      const ok = results.length - failed
      if (ok) toast.success(`Deleted ${ok} ${ok === 1 ? noun : `${noun}s`}`)
      if (failed) toast.error(`${failed} could not be deleted`)
      setConfirmDelete(null)
      setSelectedIds(new Set())
      setSelectMode(false)
      if (lightboxIdx !== null) setLightboxIdx(null)
      if (previewDoc && ids.includes(previewDoc.id)) setPreviewDoc(null)
      await refresh()
      return
    }
    try {
      if (target === 'photos') await softDeletePhoto(id)
      else                     await softDeleteDocument(id)
      toast.success(`Deleted ${name}`)
      setConfirmDelete(null)
      // If we were viewing the deleted item in a modal, close it.
      if (target === 'photos' && lightboxIdx !== null) {
        setLightboxIdx(null)
      }
      if (target === 'documents' && previewDoc?.id === id) {
        setPreviewDoc(null)
      }
      await refresh()
    } catch (e) {
      toast.error(e.message || 'Delete failed')
    }
  }

  const handleReprocess = async (photoId) => {
    // Optimistically flip status first: repairing a HEIC decodes a 12 MP frame
    // in this tab, which takes a beat, and a tile that looks inert while that
    // happens invites a second click.
    setItems(prev => prev.map(p => p.id === photoId
      ? { ...p, watermark_status: 'pending', watermark_error: null }
      : p))
    try {
      await reprocessPhoto(photoId)
      toast.info('Re-processing — will refresh shortly')
    } catch (e) {
      toast.error(e.message || 'Re-processing failed')
      await refresh()
    }
  }

  const handleApplyTag = async (tag) => {
    const photos = tagPicker?.photos || []
    if (photos.length === 0) return
    const ids = photos.map(p => p.id)
    setTagBusy({ done: 0, total: ids.length })
    try {
      const { failed } = await setPhotoTag(ids, tag, {
        onProgress: ({ done, total }) => setTagBusy({ done, total }),
      })
      const label = tag
        ? `Tagged ${ids.length} photo${ids.length === 1 ? '' : 's'}`
        : `Tag removed from ${ids.length} photo${ids.length === 1 ? '' : 's'}`
      toast.success(label)
      // The tag is printed onto the watermark, so the image is being re-rendered
      // behind this. Say so rather than leaving the old stamp on screen looking
      // like the save did not take.
      if (failed > 0) toast.error(`${failed} could not be re-stamped — use Render on those tiles`)
      setTagPicker(null)
      exitSelect()
    } catch (e) {
      toast.error(e.message || 'Tagging failed')
    } finally {
      setTagBusy(null)
      await refresh()
    }
  }

  // Render unrendered photos automatically, as soon as the card sees them.
  // No button, on purpose: a photo with no preview is the app's problem, not a
  // chore for the person looking at it. The decode has to run in a browser —
  // which is why the edge function cannot do it — but this card IS a browser,
  // already open on these photos.
  //
  // The scheduling lives in usePhotoRepair, because getting it wrong is not
  // visible in a screenshot: the first version listed `items` as a dependency
  // and also wrote to `items`, so each pass cancelled itself on its first tick
  // and froze the progress line at 0.
  const { progress: repairBusy, renderingIds } = usePhotoRepair({
    photos: items,
    enabled: target === 'photos',
    runRepair: repairUnrenderedPhotos,
    onRepaired: refresh,
    recordKey: `${parentTable}:${parentRecordId}:${config?.work_step_id || ''}`,
  })

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <>
      {/* Hidden inputs — one for the regular file picker, one for camera
          capture. Triggered by the corresponding header buttons. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_BY_MODE[target]}
        style={{ display: 'none' }}
        onChange={onPickerChange}
      />
      {target === 'photos' && (
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={onPickerChange}
        />
      )}

      <div
        ref={containerRef}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          background: C.card,
          border: `1px solid ${dragActive ? C.emerald : C.border}`,
          borderRadius: 8,
          marginBottom: 12,
          overflow: 'hidden',
          position: 'relative',
          transition: 'border 0.12s',
        }}
      >
        {/* Drag-over overlay */}
        {dragActive && !photoLockoutMessage && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5,
            background: 'rgba(62,207,142,0.08)',
            border: `2px dashed ${C.emerald}`,
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
            fontSize: 14, fontWeight: 600, color: C.emeraldMid,
          }}>
            Drop to upload
          </div>
        )}

        {/* Header */}
        <div
          onClick={() => setCollapsed(c => !c)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px 10px 16px',
            background: '#fafbfd',
            borderBottom: collapsed ? 'none' : `1px solid ${C.border}`,
            cursor: 'pointer', userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 4,
              background: theme.iconBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon path={theme.iconPath} size={12} color={theme.iconColor} />
            </div>
            <span style={{
              fontSize: 13, fontWeight: 600, color: C.textPrimary,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {title}
            </span>
            <span style={{
              background: C.page, color: C.textSecondary,
              fontSize: 11, fontWeight: 600,
              padding: '1px 8px', borderRadius: 10,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {loading ? '…' : items.length}
            </span>
            {slotRequired && !loading && (
              <span style={{
                background: items.length > 0 ? '#e8f8f2' : '#e8f3fb',
                color:      items.length > 0 ? '#1a7a4e' : '#1a5a8a',
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em',
                padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                {items.length > 0 ? 'Attached' : 'Required'}
              </span>
            )}
            {uploading > 0 && (
              <span style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>
                Uploading {uploading}…
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!photoLockoutMessage && target === 'photos' && isMobile && (
              <HeaderButton
                onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click() }}
                primary
                iconPath="M3 7h2l2-3h10l2 3h2v12H3V7z M12 11a4 4 0 100 8 4 4 0 000-8z"
                label="Take"
              />
            )}
            {!photoLockoutMessage && (
              <HeaderButton
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                primary={!isMobile || target !== 'photos'}
                iconPath="M12 5v14M5 12h14"
                label="Upload"
              />
            )}
            <Icon
              path={collapsed ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'}
              size={12} color={C.textMuted}
            />
          </div>
        </div>

        {/* Body */}
        {!collapsed && (
          <div style={{ padding: isMobile ? 12 : 14 }}>
            {slotHelp && (
              <div style={{
                fontSize: 12, lineHeight: 1.5, color: C.textSecondary,
                background: '#f7f9fc',   // design-system card secondary
                border: `1px solid ${C.border}`, borderRadius: 6,
                padding: '8px 10px', marginBottom: 12,
              }}>
                {slotHelp}
              </div>
            )}
            {photoLockoutMessage ? (
              <LockoutNotice message={photoLockoutMessage} />
            ) : loading ? (
              <SkeletonGrid mode={target} isMobile={isMobile} />
            ) : error ? (
              <ErrorNotice message={error} onRetry={refresh} />
            ) : items.length === 0 ? (
              <EmptyState
                target={target}
                message={
                  slotRequired
                    ? 'Required — nothing uploaded yet.'
                    : slotType
                      ? 'Nothing of this kind uploaded yet.'
                      : claimedList.length > 0
                        // A catch-all whose every file is claimed by a slot on
                        // this layout: say so, rather than reading as "there are
                        // no documents on this record" when there plainly are.
                        ? 'No other documents on this record — everything uploaded so far is filed above.'
                        : null
                }
                onPick={() => fileInputRef.current?.click()}
                onCamera={target === 'photos' && isMobile
                  ? () => cameraInputRef.current?.click()
                  : null}
              />
            ) : target === 'photos' ? (
              <>
                {isWorkOrderPhotoGallery && (stepOptions.length > 1 || tagOptions.length > 1) && (
                  <PhotoFilterBar
                    stepOptions={stepOptions}
                    tagOptions={tagOptions}
                    total={items.length}
                    shown={visiblePhotos.length}
                    stepValue={stepFilter}
                    tagValue={tagFilter}
                    onStepChange={setStepFilter}
                    onTagChange={setTagFilter}
                    onClear={() => { setStepFilter([]); setTagFilter([]) }}
                    isMobile={isMobile}
                  />
                )}
                <PhotoToolbar
                  selectMode={selectMode}
                  selectedCount={selectedIds.size}
                  totalCount={visiblePhotos.length}
                  downloading={downloading}
                  reportCount={reportCount}
                  showReportOnly={showReportOnly}
                  onToggleReportFilter={() => setShowReportOnly(v => !v)}
                  onEnterSelect={() => setSelectMode(true)}
                  onCancel={exitSelect}
                  onSelectAll={selectAllVisible}
                  onDownload={handleDownloadSelected}
                  onReportSelected={handleReportSelected}
                  selectedAllInReport={selectedAllInReport}
                  reportBusy={reportBusy}
                  onTagSelected={() => {
                    const chosen = visiblePhotos.filter(p => selectedIds.has(p.id))
                    if (chosen.length > 0) setTagPicker({ photos: chosen })
                  }}
                  onDeleteSelected={() => {
                    const ids = visiblePhotos.filter(p => selectedIds.has(p.id)).map(p => p.id)
                    if (ids.length === 0) return
                    setConfirmDelete({
                      ids,
                      name: `${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}`,
                    })
                  }}
                />
                {/* Photos with no displayable image. Before 2026-08-24 these
                    rendered as broken tiles with nothing to explain them; now
                    the card says what is wrong and fixes it in place. The
                    decode runs in this tab, which is precisely why the server
                    could not do it. */}
                {/* Progress only. A photo that could not be rendered says so
                    on its own tile with the format it is; there is no button
                    here asking anyone to run it again. */}
                {repairBusy && !selectMode && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    margin: '0 0 10px', padding: '9px 12px',
                    background: '#eef4fb', border: `1px solid ${C.sky}`,
                    borderRadius: 6, fontSize: 12.5, color: C.textSecondary,
                  }}>
                    <Icon path="M3 7h2l2-3h10l2 3h2v12H3V7z M12 11a4 4 0 100 8 4 4 0 000-8z"
                      size={14} color="#2a5a8a" />
                    <span style={{ flex: 1, minWidth: 200 }}>
                      Rendering {repairBusy.done} of {repairBusy.total} photo{repairBusy.total === 1 ? '' : 's'}
                      {' '}— they will appear as each one finishes.
                    </span>
                  </div>
                )}
                {visiblePhotos.length === 0 ? (
                  <div style={{ padding: '18px 4px', fontSize: 12.5, color: C.textMuted }}>
                    {showReportOnly
                      ? 'No photos marked for the final report yet. Use the flag on a photo to include it.'
                      : 'No photos match this filter.'}
                  </div>
                ) : (
                <PhotoGrid
                  photos={visiblePhotos}
                  renderingIds={renderingIds}
                  isMobile={isMobile}
                  showStepTag={isWorkOrderPhotoGallery}
                  selectMode={selectMode}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onToggleReport={handleToggleReport}
                  onOpen={(idx) => setLightboxIdx(idx)}
                  onReprocess={handleReprocess}
                  onDelete={(p) => setConfirmDelete({ id: p.id, name: p.photo_number || 'photo' })}
                />
                )}
              </>
            ) : (
              <>
                <DocumentToolbar
                  selectMode={selectMode}
                  selectedCount={selectedIds.size}
                  totalCount={visibleItems.length}
                  downloading={downloading}
                  reportCount={reportCount}
                  showReportOnly={showReportOnly}
                  onToggleReportFilter={() => setShowReportOnly(v => !v)}
                  onReportSelected={handleReportSelected}
                  selectedAllInReport={selectedAllInReport}
                  reportBusy={reportBusy}
                  onEnterSelect={() => setSelectMode(true)}
                  onCancel={exitSelect}
                  onSelectAll={selectAllVisible}
                  onDownload={handleDownloadSelected}
                  onDeleteSelected={() => {
                    const chosen = visibleItems.filter(d => selectedIds.has(d.id))
                    if (chosen.length === 0) return
                    setConfirmDelete({
                      ids: chosen.map(d => d.id),
                      name: chosen.length === 1
                        ? (chosen[0].name || 'document')
                        : `${chosen.length} documents`,
                    })
                  }}
                />
                <DocumentList
                  documents={visibleItems}
                  isMobile={isMobile}
                  selectMode={selectMode}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onPreview={(d) => setPreviewDoc(d)}
                  onDownload={handleDownloadDocument}
                  onToggleReport={handleToggleReport}
                  onDelete={(d) => setConfirmDelete({ id: d.id, name: d.name || 'document' })}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Lightbox — photos only, full-screen overlay */}
      {target === 'photos' && lightboxIdx !== null && visiblePhotos[lightboxIdx] && (
        <Lightbox
          photos={visiblePhotos}
          startIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onIndexChange={setLightboxIdx}
          onTag={(p) => setTagPicker({ photos: [p] })}
          onToggleReport={handleToggleReport}
        />
      )}

      {/* Document preview modal — documents only. Renders PDFs and images
          inline; falls back to a download panel for unsupported types. */}
      {target === 'documents' && previewDoc && (
        <DocumentPreviewModal
          doc={previewDoc}
          onDownload={() => handleDownloadDocument(previewDoc)}
          onClose={() => setPreviewDoc(null)}
        />
      )}

      {/* Tag picker */}
      {tagPicker && (
        <PhotoTagPickerModal
          photos={tagPicker.photos}
          prompts={tagPrompts}
          busy={tagBusy}
          onApply={handleApplyTag}
          onCancel={() => { if (!tagBusy) setTagPicker(null) }}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmDeleteModal
          name={confirmDelete.name}
          target={target}
          count={Array.isArray(confirmDelete.ids) ? confirmDelete.ids.length : 1}
          onConfirm={performDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function HeaderButton({ onClick, primary, iconPath, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: primary ? C.emerald : C.card,
        color: primary ? '#fff' : C.textSecondary,
        border: primary ? 'none' : `1px solid ${C.border}`,
        borderRadius: 5,
        padding: '4px 10px',
        fontSize: 11.5,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 4,
        fontWeight: 500,
      }}
      onMouseEnter={(e) => {
        if (primary) e.currentTarget.style.background = '#2aab72'
        else { e.currentTarget.style.background = '#eef2f7'; e.currentTarget.style.borderColor = C.borderDark }
      }}
      onMouseLeave={(e) => {
        if (primary) e.currentTarget.style.background = C.emerald
        else { e.currentTarget.style.background = C.card; e.currentTarget.style.borderColor = C.border }
      }}
    >
      <Icon path={iconPath} size={11} color={primary ? '#fff' : C.textSecondary} />
      {label}
    </button>
  )
}

function LockoutNotice({ message }) {
  return (
    <div style={{
      padding: '20px 16px',
      borderRadius: 6,
      background: '#e8f1fb',
      border: '1px solid #7eb3e8',
      color: '#1e466b',
      fontSize: 12.5, lineHeight: 1.55,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>This widget is misconfigured.</div>
      {message}
    </div>
  )
}

function ErrorNotice({ message, onRetry }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 6,
      background: '#e8f1fb',
      border: '1px solid #bcd9f2',
      color: '#1a5a8a',
      fontSize: 12.5,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <span>Failed to load: {message}</span>
      <button
        onClick={onRetry}
        style={{
          background: '#fff', color: '#1a5a8a',
          border: '1px solid #bcd9f2', borderRadius: 4,
          padding: '3px 9px', fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
        }}
      >Retry</button>
    </div>
  )
}

function EmptyState({ target, onPick, onCamera, message }) {
  return (
    <div style={{
      padding: '28px 16px',
      textAlign: 'center',
      color: C.textMuted,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 13 }}>
        {message || `No ${target === 'photos' ? 'photos' : 'documents'} on this record yet.`}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {onCamera && (
          <button
            onClick={onCamera}
            style={{
              background: C.emerald, color: '#fff',
              border: 'none', borderRadius: 6,
              padding: '8px 14px', fontSize: 13, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500,
            }}
          >
            <Icon path="M3 7h2l2-3h10l2 3h2v12H3V7z M12 11a4 4 0 100 8 4 4 0 000-8z" size={13} color="#fff" />
            Take Photo
          </button>
        )}
        <button
          onClick={onPick}
          style={{
            background: C.page, color: C.textSecondary,
            border: `1px solid ${C.border}`, borderRadius: 6,
            padding: '8px 14px', fontSize: 13, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500,
          }}
        >
          <Icon path="M12 5v14M5 12h14" size={12} color={C.textSecondary} />
          {target === 'photos' ? 'Upload Photos' : 'Upload Files'}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>
        …or drop files anywhere on this card
      </div>
    </div>
  )
}

function SkeletonGrid({ mode, isMobile }) {
  const count = mode === 'photos' ? 4 : 3
  return mode === 'photos' ? (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: THUMB_GAP,
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          aspectRatio: '1 / 1',
          background: '#eef2f7',
          borderRadius: 6,
          animation: 'pulse 1.4s ease-in-out infinite',
        }} />
      ))}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
      `}</style>
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          height: 40, background: '#eef2f7', borderRadius: 6,
          animation: 'pulse 1.4s ease-in-out infinite',
        }} />
      ))}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
      `}</style>
    </div>
  )
}

// PhotoFilterBar — the work order roll-up's filters.
//
// Two dropdowns rather than a chip per value: an assessment work order runs
// 15+ steps and dozens of distinct photo tags, and a chip row that long
// pushed the photos themselves below the fold. Each option carries its own
// count, so the closed dropdown doubles as a summary of what the work order
// actually holds, and Clear appears only once something is filtered.
function FilterSelect({ label, value, onChange, options, allLabel, isMobile }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const chosen = Array.isArray(value) ? value : []
  const active = chosen.length > 0

  // Close on an outside click or Escape. A popover that traps the page is
  // worse than the native select it replaced.
  useEffect(() => {
    if (!open) return
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      flex: '1 1 210px', minWidth: 0, position: 'relative',
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600, color: C.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          flex: 1, minWidth: 0, height: 30,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
          padding: '0 9px', cursor: 'pointer', textAlign: 'left',
          border: `1px solid ${active || open ? C.emeraldMid : C.border}`,
          background: active ? '#e8f8f0' : C.card,
          color: active ? '#1a7a4f' : C.textSecondary,
          borderRadius: 6, fontSize: 12.5,
          fontWeight: active ? 600 : 500, fontFamily: 'inherit',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectionLabel(chosen, options, allLabel)}
        </span>
        <Icon path="M6 9l6 6 6-6" size={12} color={active ? '#1a7a4f' : C.textSecondary} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          style={{
            position: 'absolute', top: 34, left: 0, right: 0, zIndex: 60,
            background: C.card, border: `1px solid ${C.borderDark}`, borderRadius: 8,
            boxShadow: '0 8px 24px rgba(13,26,46,0.16)',
            maxHeight: isMobile ? '52vh' : 320, overflowY: 'auto', padding: 4,
          }}
        >
          {/* Clearing every checkbox already means "all", so this is the same
              action — named, rather than left for the user to work out. */}
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              appearance: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
              border: 'none', background: chosen.length === 0 ? '#e8f8f0' : 'transparent',
              color: chosen.length === 0 ? '#1a7a4f' : C.textSecondary,
              fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
              padding: '7px 9px', borderRadius: 6,
            }}
          >
            {allLabel}
          </button>
          <div style={{ height: 1, background: C.border, margin: '4px 2px' }} />
          {options.map(o => {
            const isOn = chosen.includes(o.id)
            return (
              <label
                key={o.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 9px', borderRadius: 6, cursor: 'pointer',
                  background: isOn ? '#e8f8f0' : 'transparent',
                  fontSize: 12.5, color: C.textPrimary,
                }}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => onChange(toggleSelection(chosen, o.id))}
                  style={{ width: 15, height: 15, accentColor: C.emeraldMid, flex: '0 0 auto', cursor: 'pointer' }}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.label || o.name}
                </span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted }}>
                  {o.count}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PhotoFilterBar({
  stepOptions, tagOptions, total, shown,
  stepValue, tagValue, onStepChange, onTagChange, onClear, isMobile,
}) {
  const filtered = (stepValue?.length || 0) > 0 || (tagValue?.length || 0) > 0
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      flexWrap: 'wrap', marginBottom: 12,
      padding: isMobile ? 10 : '9px 11px',
      background: '#f7f9fc', // card secondary
      border: `1px solid ${C.border}`, borderRadius: 8,
    }}>
      {stepOptions.length > 1 && (
        <FilterSelect
          label="Work step"
          value={stepValue}
          onChange={onStepChange}
          options={stepOptions}
          allLabel={`All work steps (${total})`}
          isMobile={isMobile}
        />
      )}
      {tagOptions.length > 1 && (
        <FilterSelect
          label="Tag"
          value={tagValue}
          onChange={onTagChange}
          options={tagOptions}
          allLabel={`All tags (${total})`}
          isMobile={isMobile}
        />
      )}
      {filtered && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <span style={{ fontSize: 11.5, color: C.textMuted, whiteSpace: 'nowrap' }}>
            {shown} of {total}
          </span>
          <button
            onClick={onClear}
            style={{
              appearance: 'none', cursor: 'pointer',
              border: `1px solid ${C.border}`, background: C.card,
              color: C.textSecondary, fontSize: 11.5, fontWeight: 600,
              padding: '5px 10px', borderRadius: 6, whiteSpace: 'nowrap',
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
const FLAG_ICON = 'M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z'

// Toolbar above the grid: report-filter chip, then enter select mode →
// Select-all / Download / Cancel.
function PhotoToolbar({ selectMode, selectedCount, totalCount, downloading, reportCount, showReportOnly, onToggleReportFilter, onEnterSelect, onCancel, onSelectAll, onDownload, onDeleteSelected, onReportSelected, selectedAllInReport, reportBusy, onTagSelected }) {
  if (totalCount === 0 && !showReportOnly && !reportCount) return null
  const btn = (extra = {}) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 10px', fontSize: 12, fontWeight: 600,
    borderRadius: 6, cursor: 'pointer', border: `1px solid ${C.border}`,
    background: C.card, color: C.textSecondary, ...extra,
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
      {!selectMode && (
        <button
          onClick={onToggleReportFilter}
          title="Show only photos marked for the final report"
          style={{ ...btn(showReportOnly ? { background: '#e8f8f2', borderColor: C.emerald, color: C.emeraldMid } : {}), marginRight: 'auto' }}
        >
          <Icon path={FLAG_ICON} size={12} color={showReportOnly ? C.emeraldMid : C.textMuted} />
          In report{reportCount ? ` (${reportCount})` : ''}
        </button>
      )}
      {!selectMode ? (
        <button onClick={onEnterSelect} style={btn()}>
          <Icon path="M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" size={13} color={C.textSecondary} />
          Select
        </button>
      ) : (
        <>
          <span style={{ fontSize: 12, color: C.textMuted, marginRight: 'auto' }}>
            {selectedCount} selected
          </span>
          <button onClick={onSelectAll} style={btn()}>
            {selectedCount === totalCount ? 'All selected' : `Select all (${totalCount})`}
          </button>
          <button onClick={onCancel} style={btn()}>Cancel</button>
          {/* Tag the selection. A photo uploaded onto the work order rather
              than captured against a work step arrives untagged, and until
              this existed there was no way to say what it showed — sixty
              photos of a job all reading "Work Order" (Nicholas, 2026-08-24).
              Bulk because that is how they arrive: a whole visit at once. */}
          <button
            onClick={onTagSelected}
            disabled={selectedCount === 0}
            title="Set what these photos show"
            style={btn({
              color: selectedCount === 0 ? C.textMuted : C.textSecondary,
              cursor: selectedCount === 0 ? 'default' : 'pointer',
            })}
          >
            <Icon path="M20.6 13.4L12 4.8V2H4v8h2.8l8.6 8.6a2 2 0 002.8 0l2.4-2.4a2 2 0 000-2.8z M7 7h.01"
              size={12} color={selectedCount === 0 ? C.textMuted : C.textSecondary} />
            Tag{selectedCount ? ` (${selectedCount})` : ''}
          </button>
          {/* Flag the whole selection for the final report in one press. With
              multi-select filters this is the point of selecting at all: filter
              to Roof / Ceiling + Windows & Doors, Select all, and mark them.
              Toggles to Remove once everything selected is already in. */}
          <button
            onClick={onReportSelected}
            disabled={selectedCount === 0 || reportBusy}
            title={selectedAllInReport
              ? 'Remove the selected photos from the final report'
              : 'Add the selected photos to the final report'}
            style={btn({
              background: (selectedCount === 0 || reportBusy) ? C.border : '#e8f8f2',
              borderColor: (selectedCount === 0 || reportBusy) ? C.border : C.emerald,
              color: (selectedCount === 0 || reportBusy) ? C.textMuted : C.emeraldMid,
              cursor: (selectedCount === 0 || reportBusy) ? 'default' : 'pointer',
            })}
          >
            <Icon path={FLAG_ICON} size={12}
              color={(selectedCount === 0 || reportBusy) ? C.textMuted : C.emeraldMid} />
            {reportBusy ? 'Saving…'
              : selectedAllInReport
                ? `Remove from report${selectedCount ? ` (${selectedCount})` : ''}`
                : `Add to report${selectedCount ? ` (${selectedCount})` : ''}`}
          </button>
          {/* Delete the selection. The per-photo delete is hover-revealed and
              hidden while selecting, so without this there was no way to remove
              a batch of photos you'd just uploaded (Nicholas, 2026-08-17).
              Blue, not red, per the design system; soft delete either way. */}
          <button
            onClick={onDeleteSelected}
            disabled={selectedCount === 0}
            title="Move the selected photos to the recycle bin"
            style={btn({
              background: selectedCount === 0 ? C.border : '#eef5fc',
              borderColor: selectedCount === 0 ? C.border : '#bcd9f2',
              color: selectedCount === 0 ? C.textMuted : '#1a5a8a',
              cursor: selectedCount === 0 ? 'default' : 'pointer',
            })}
          >
            <Icon path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              size={13} color={selectedCount === 0 ? C.textMuted : '#1a5a8a'} />
            Delete{selectedCount ? ` (${selectedCount})` : ''}
          </button>
          <button
            onClick={onDownload}
            disabled={selectedCount === 0 || downloading}
            title="Download files with the visible tag and full EXIF (capture time + GPS)"
            style={btn({
              background: (selectedCount === 0 || downloading) ? C.border : C.emerald,
              color: (selectedCount === 0 || downloading) ? C.textMuted : '#fff',
              border: 'none',
              cursor: (selectedCount === 0 || downloading) ? 'default' : 'pointer',
            })}
          >
            <Icon path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
              size={13} color={(selectedCount === 0 || downloading) ? C.textMuted : '#fff'} />
            {downloading ? 'Preparing…' : `Download${selectedCount ? ` (${selectedCount})` : ''}`}
          </button>
        </>
      )}
    </div>
  )
}

function PhotoGrid({ photos, renderingIds, isMobile, showStepTag, selectMode, selectedIds, onToggleSelect, onToggleReport, onOpen, onReprocess, onDelete }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: THUMB_GAP,
    }}>
      {photos.map((p, idx) => (
        <PhotoTile
          key={p.id}
          photo={p}
          isMobile={isMobile}
          showStepTag={showStepTag}
          selectMode={selectMode}
          selected={selectedIds?.has(p.id)}
          onToggleSelect={() => onToggleSelect(p.id)}
          onToggleReport={() => onToggleReport(p)}
          onOpen={() => onOpen(idx)}
          rendering={!!renderingIds?.has(p.id)}
          onReprocess={() => onReprocess(p.id)}
          onDelete={() => onDelete(p)}
        />
      ))}
    </div>
  )
}

function PhotoTile({ photo, rendering, isMobile, showStepTag, selectMode, selected, onToggleSelect, onToggleReport, onOpen, onReprocess, onDelete }) {
  const status = photo.watermark_status
  const url = photo._thumbUrl
  // process-photo writes 'pending' | 'processing' | 'done' | 'skipped' |
  // 'failed'. The retry affordance used to test for 'error', a value the
  // function has never written, so a failed photo offered nothing at all —
  // which is how 66 unprocessed captures sat on a work order looking simply
  // broken.
  // `rendering` comes from the live repair pass, NOT from a mutated row: the
  // pass writing into `items` is exactly what made it cancel itself.
  const working = rendering || status === 'pending' || status === 'processing'
  const source = photo.storage_path_original || photo.file_url
  const notAnImage = !isImageFile(source, photo.mime_type)
  const kindLabel = fileTypeLabel(source, photo.mime_type)
  const failedWithImage = status === 'failed' && !!url
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        background: '#0d1a2e',
        borderRadius: 6,
        overflow: 'hidden',
        cursor: (selectMode || url) ? 'pointer' : 'default',
        border: selected ? `2px solid ${C.emerald}` : `1px solid ${C.border}`,
      }}
      onClick={() => { if (selectMode) onToggleSelect(); else if (url) onOpen() }}
    >
      {/* Selection checkbox (select mode) */}
      {selectMode && (
        <div style={{
          position: 'absolute', top: 6, left: 6, zIndex: 3,
          width: 22, height: 22, borderRadius: '50%',
          background: selected ? C.emerald : 'rgba(13,26,46,0.62)',
          border: `2px solid ${selected ? C.emerald : 'rgba(255,255,255,0.85)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && <Icon path="M5 13l4 4L19 7" size={12} color="#fff" />}
        </div>
      )}
      {/* Dim unselected tiles slightly in select mode for scannability */}
      {selectMode && !selected && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(7,17,31,0.28)', zIndex: 2, pointerEvents: 'none' }} />
      )}
      {url ? (
        <img
          src={url}
          alt={photo.caption || photo.photo_number || 'photo'}
          loading="lazy"
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }}
        />
      ) : (
        // No displayable image. The photo itself is fine — its bytes are in
        // storage and Download still returns the real capture — it just has no
        // rendered variant yet. Say that, rather than letting the browser draw
        // its broken-image glyph over a photo that was never lost.
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column', gap: 6,
          alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.72)', fontSize: 11,
          textAlign: 'center', padding: 10,
        }}>
          <Icon path="M3 7h2l2-3h10l2 3h2v12H3V7z M12 11a4 4 0 100 8 4 4 0 000-8z"
            size={20} color="rgba(255,255,255,0.5)" />
          {/* Either it renders or it doesn't. No button asking the person to
              run the app's job again (Nicholas, 2026-08-24: "Just say
              AutoCAD"). A file that is not an image is not a failure at all —
              it is a document filed under photos, so the tile names the format
              and stops. An IMAGE that would not render is a real fault, and
              the only honest ask is a fresh upload, because retrying the same
              bytes changes nothing. */}
          {working
            ? 'Rendering…'
            : notAnImage
              ? <span style={{ fontWeight: 600, letterSpacing: 0.3 }}>{kindLabel}</span>
              : <>
                  <span style={{ fontWeight: 600 }}>{kindLabel}</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
                    Upload this photo again
                  </span>
                </>}
        </div>
      )}

      {/* Watermark status badge — only visible when not 'done' */}
      {working && (
        <div style={{
          position: 'absolute', top: 6, left: 6,
          background: 'rgba(13,26,46,0.78)', color: '#fff',
          fontSize: 10, fontWeight: 600,
          padding: '2px 7px', borderRadius: 10,
          textTransform: 'uppercase', letterSpacing: 0.4,
        }}>Processing</div>
      )}
      {/* A photo that displays but never got its watermark still shows the
          picture, so there is nothing for the viewer to do and nothing worth
          interrupting them with. The gap is reported on the card, not as a
          button on every tile. */}

      {/* Include-in-final-report flag — top-right, always visible so flagged
          photos read at a glance. Filled emerald when included. Internal only;
          never appears on the watermark. */}
      {!selectMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleReport() }}
          title={photo.include_in_final_report ? 'Included in final report — click to remove' : 'Include in final report'}
          style={{
            position: 'absolute', top: 6, right: 6,
            width: 26, height: 26, borderRadius: '50%',
            background: photo.include_in_final_report ? C.emerald : 'rgba(13,26,46,0.65)',
            border: photo.include_in_final_report ? 'none' : '1px solid rgba(255,255,255,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
        >
          <Icon path={FLAG_ICON} size={12} color="#fff" />
        </button>
      )}

      {/* Delete — left of the flag, hidden while selecting (the toolbar's
          Delete handles a selection). On touch there is no hover, so it stays
          visible; on desktop it fades in but never sits at zero opacity, which
          is why it read as "there is no delete option" (Nicholas, 2026-08-17). */}
      {!selectMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          style={{
            position: 'absolute', top: 6, right: 38,
            width: 26, height: 26, borderRadius: '50%',
            background: 'rgba(13,26,46,0.65)',
            border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            opacity: (isMobile || hover) ? 1 : 0.55,
            transition: 'opacity 0.15s',
          }}
          title="Delete"
        >
          <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"
            size={12} color="#fff" />
        </button>
      )}

      {/* Tags, bottom-anchored, so a thumbnail reads as evidence for a
          specific step and a specific subject. The work step chip appears on
          the work order's roll-up gallery (on a step's own card the step is
          already the context); the photo tag — the named prompt the
          technician answered — appears wherever it says something. */}
      {/* ONE chip. A photo has one tag — if we switch it the old one falls
          off (Nicholas, 2026-08-27: "I don't know how we have two tags on a
          photo. We should only ever have one"). What looked like two was the
          step chip and the tag chip side by side; now the tag wins where there
          is one, and the step name stands in only for an untagged photo. */}
      {(showStepTag || isMeaningfulTag(photo.photo_type)) && (
        <div style={{
          position: 'absolute', left: 6, right: 6, bottom: 6,
          display: 'flex', alignItems: 'center', gap: 4,
          pointerEvents: 'none',
        }}>
          {isMeaningfulTag(photo.photo_type) ? (
            <span style={{
              maxWidth: '100%',
              background: '#e8f8f0', color: '#1a7a4f',
              fontSize: 9.5, fontWeight: 700,
              padding: '2px 6px', borderRadius: 10,
              letterSpacing: 0.3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {photoTagLabel(photo)}
            </span>
          ) : showStepTag ? (
            <span style={{
              maxWidth: '100%',
              background: 'rgba(7,17,31,0.82)', color: '#fff',
              fontSize: 10, fontWeight: 600,
              padding: '2px 7px', borderRadius: 10,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {photo._work_step_name || 'Untagged'}
            </span>
          ) : null}
        </div>
      )}

      {/* Bottom caption strip — only when there's a caption */}
      {photo.caption && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '6px 8px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0))',
          color: '#fff',
          fontSize: 11,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {photo.caption}
        </div>
      )}
    </div>
  )
}

// Toolbar above the document list: enter select mode → Select all / Cancel /
// Delete / Download. Purpose-built for documents rather than shared with
// PhotoToolbar, which carries the final-report flag actions that mean nothing
// to a document (Nicholas, 2026-08-24).
function DocumentToolbar({ selectMode, selectedCount, totalCount, downloading, reportCount, showReportOnly, onToggleReportFilter, onEnterSelect, onCancel, onSelectAll, onDownload, onDeleteSelected, onReportSelected, selectedAllInReport, reportBusy }) {
  if (totalCount === 0 && !showReportOnly && !reportCount) return null
  const btn = (extra = {}) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 10px', fontSize: 12, fontWeight: 600,
    borderRadius: 6, cursor: 'pointer', border: `1px solid ${C.border}`,
    background: C.card, color: C.textSecondary, ...extra,
  })
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      gap: 8, marginBottom: 10, flexWrap: 'wrap',
    }}>
      {!selectMode && (
        <button
          onClick={onToggleReportFilter}
          title="Show only documents marked for the final report"
          style={{ ...btn(showReportOnly ? { background: '#e8f8f2', borderColor: C.emerald, color: C.emeraldMid } : {}), marginRight: 'auto' }}
        >
          <Icon path={FLAG_ICON} size={12} color={showReportOnly ? C.emeraldMid : C.textMuted} />
          In report{reportCount ? ` (${reportCount})` : ''}
        </button>
      )}
      {!selectMode ? (
        <button onClick={onEnterSelect} style={btn()}>
          <Icon path="M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" size={13} color={C.textSecondary} />
          Select
        </button>
      ) : (
        <>
          <span style={{ fontSize: 12, color: C.textMuted, marginRight: 'auto' }}>
            {selectedCount} selected
          </span>
          <button onClick={onSelectAll} style={btn()}>
            {selectedCount === totalCount ? 'All selected' : `Select all (${totalCount})`}
          </button>
          <button onClick={onCancel} style={btn()}>Cancel</button>
          {/* Flag the whole selection for the final report. This is the point
              of the flag: say once which documents belong in the deliverable,
              instead of re-picking them on every generation. */}
          <button
            onClick={onReportSelected}
            disabled={selectedCount === 0 || reportBusy}
            title={selectedAllInReport
              ? 'Remove the selected documents from the final report'
              : 'Add the selected documents to the final report'}
            style={btn({
              background: (selectedCount === 0 || reportBusy) ? C.border : '#e8f8f2',
              borderColor: (selectedCount === 0 || reportBusy) ? C.border : C.emerald,
              color: (selectedCount === 0 || reportBusy) ? C.textMuted : C.emeraldMid,
              cursor: (selectedCount === 0 || reportBusy) ? 'default' : 'pointer',
            })}
          >
            <Icon path={FLAG_ICON} size={12}
              color={(selectedCount === 0 || reportBusy) ? C.textMuted : C.emeraldMid} />
            {reportBusy ? 'Saving…'
              : selectedAllInReport
                ? `Remove from report${selectedCount ? ` (${selectedCount})` : ''}`
                : `Add to report${selectedCount ? ` (${selectedCount})` : ''}`}
          </button>
          {/* Blue, not red, per the design system; soft delete either way. */}
          <button
            onClick={onDeleteSelected}
            disabled={selectedCount === 0}
            title="Move the selected documents to the recycle bin"
            style={btn({
              background: selectedCount === 0 ? C.border : '#eef5fc',
              borderColor: selectedCount === 0 ? C.border : '#bcd9f2',
              color: selectedCount === 0 ? C.textMuted : '#1a5a8a',
              cursor: selectedCount === 0 ? 'default' : 'pointer',
            })}
          >
            <Icon path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              size={13} color={selectedCount === 0 ? C.textMuted : '#1a5a8a'} />
            Delete{selectedCount ? ` (${selectedCount})` : ''}
          </button>
          {/* One file comes down as itself; several arrive as a single zip. */}
          <button
            onClick={onDownload}
            disabled={selectedCount === 0 || downloading}
            title={selectedCount > 1
              ? 'Download the selected documents as one zip'
              : 'Download the selected document'}
            style={btn({
              background: (selectedCount === 0 || downloading) ? C.border : C.emerald,
              color: (selectedCount === 0 || downloading) ? C.textMuted : '#fff',
              border: 'none',
              cursor: (selectedCount === 0 || downloading) ? 'default' : 'pointer',
            })}
          >
            <Icon path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
              size={13} color={(selectedCount === 0 || downloading) ? C.textMuted : '#fff'} />
            {downloading ? 'Preparing…' : `Download${selectedCount ? ` (${selectedCount})` : ''}`}
          </button>
        </>
      )}
    </div>
  )
}

function DocumentList({ documents, isMobile, selectMode, selectedIds, onToggleSelect, onPreview, onDownload, onToggleReport, onDelete }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {documents.map((d) => (
        <DocumentRow
          key={d.id}
          doc={d}
          isMobile={isMobile}
          selectMode={selectMode}
          selected={selectedIds?.has(d.id) || false}
          onToggleSelect={() => onToggleSelect(d.id)}
          onPreview={() => onPreview(d)}
          onDownload={() => onDownload(d)}
          onToggleReport={() => onToggleReport(d)}
          onDelete={() => onDelete(d)}
        />
      ))}
    </div>
  )
}

function DocumentRow({ doc, isMobile, selectMode, selected, onToggleSelect, onPreview, onDownload, onToggleReport, onDelete }) {
  const [hover, setHover] = useState(false)
  const ext = (doc.name || '').split('.').pop()?.toLowerCase() || ''
  const iconPath = ext === 'pdf'
    ? 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z M14 2v6h6'
    : 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z M14 2v6h6 M9 13h6 M9 17h6'
  const sizeStr = doc.file_size_bytes
    ? formatBytes(doc.file_size_bytes)
    : null
  const dateStr = doc.created_at
    ? new Date(doc.created_at).toLocaleDateString('en-US',
        { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  // While selecting, the whole row is the checkbox — clicking a row to open a
  // preview mid-selection is how you lose a selection you were building.
  const open = () => {
    if (selectMode) { onToggleSelect(); return }
    if (doc._url) onPreview()
  }
  const clickable = selectMode || !!doc._url

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={open}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px',
        borderRadius: 6,
        cursor: clickable ? 'pointer' : 'default',
        background: selected ? '#eaf7f1' : hover ? '#f5f8fc' : 'transparent',
        boxShadow: selected ? `inset 0 0 0 1px ${C.emerald}` : 'none',
        // The whole row is a toggle while selecting, so a click must not also
        // drag-select the filename text under the cursor.
        userSelect: selectMode ? 'none' : 'auto',
        transition: 'background 0.1s',
      }}
    >
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${doc.name || 'document'}`}
          style={{ width: 15, height: 15, accentColor: C.emerald, flexShrink: 0, cursor: 'pointer' }}
        />
      )}
      <div style={{
        width: 32, height: 32, borderRadius: 5,
        background: '#e8f3fb',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon path={iconPath} size={15} color="#1a5a8a" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: doc._url ? '#1a5a8a' : C.textPrimary,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {doc.name || 'Untitled'}
        </div>
        <div style={{
          fontSize: 11, color: C.textMuted,
          display: 'flex', gap: 8, marginTop: 1,
        }}>
          {doc.document_type && <span>{doc.document_type}</span>}
          {sizeStr && <span>· {sizeStr}</span>}
          {dateStr && !isMobile && <span>· {dateStr}</span>}
        </div>
      </div>
      {/* Row actions are hidden while selecting — the toolbar owns the actions
          then, and a stray per-row delete mid-selection is a surprise. */}
      {!selectMode && (
        <>
          {/* Include in final report — the same curation flag photos carry, so
              the deliverable's contents are recorded once instead of re-picked
              on every generation. Sits outside the _url guard: a document is
              curated whether or not its signed URL resolved this load.
              Internal only — never shown on the file, never restricts access. */}
          {onToggleReport && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleReport() }}
              title={doc.include_in_final_report
                ? 'Included in final report — click to remove'
                : 'Include in final report'}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: doc.include_in_final_report ? C.emerald : 'transparent',
                border: doc.include_in_final_report ? 'none' : `1px solid ${C.border}`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <Icon path={FLAG_ICON} size={13}
                color={doc.include_in_final_report ? '#fff' : C.textMuted} />
            </button>
          )}
          {doc._url && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload() }}
              style={rowActionStyle(hover || isMobile)}
              title="Download"
            >
              <Icon path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                size={13} color={C.textMuted} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            style={rowActionStyle(hover || isMobile)}
            title="Delete"
          >
            <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"
              size={13} color={C.textMuted} />
          </button>
        </>
      )}
    </div>
  )
}

// Hover-revealed row action button. Always visible on mobile, where there is
// no hover to reveal it with.
function rowActionStyle(visible) {
  return {
    background: 'transparent',
    border: 'none',
    width: 28, height: 28, borderRadius: 4,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.15s',
  }
}

function formatBytes(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------

function Lightbox({ photos, startIndex, onClose, onIndexChange, onToggleReport, onTag }) {
  const [idx, setIdx] = useState(startIndex)
  // Keep parent in sync so it can close the lightbox if the photo is deleted.
  useEffect(() => { onIndexChange(idx) }, [idx, onIndexChange])

  // Keyboard nav
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setIdx(i => Math.min(photos.length - 1, i + 1))
      else if (e.key === 'ArrowLeft')  setIdx(i => Math.max(0, i - 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [photos.length, onClose])

  // Touch swipe — left/right to navigate
  const touchStartX = useRef(null)
  const onTouchStart = (e) => { touchStartX.current = e.touches[0]?.clientX ?? null }
  const onTouchEnd = (e) => {
    const start = touchStartX.current
    if (start == null) return
    const end = e.changedTouches[0]?.clientX ?? start
    const dx = end - start
    if (Math.abs(dx) > 50) {
      if (dx < 0) setIdx(i => Math.min(photos.length - 1, i + 1))
      else        setIdx(i => Math.max(0, i - 1))
    }
    touchStartX.current = null
  }

  const basePhoto = photos[idx]
  // Same expiry problem as the document preview — the lightbox can be opened
  // long after the grid signed its URLs, and a spent URL renders as a broken
  // image. Re-sign the photo actually on screen.
  const [freshened, setFreshened] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!basePhoto?.storage_bucket) return
    if (isSignedUrlUsable(basePhoto._thumbUrl || basePhoto._originalUrl)) return
    freshPhotoUrls(basePhoto)
      .then(next => { if (!cancelled) setFreshened(next) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [basePhoto])

  const photo = (freshened && freshened.id === basePhoto?.id) ? freshened : basePhoto
  if (!photo) return null
  // Show the watermarked (tagged) variant in the lightbox so the step /
  // location / date / GPS stamp is visible — that's the evidence view. Fall
  // back to the original if no watermark exists.
  const url = photo._thumbUrl || photo._originalUrl

  const takenAt = photo.taken_at
    ? new Date(photo.taken_at).toLocaleString('en-US',
        { year: 'numeric', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit' })
    : null
  const gps = (photo.latitude != null && photo.longitude != null)
    ? `${Number(photo.latitude).toFixed(5)}, ${Number(photo.longitude).toFixed(5)}`
    : null

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(8,12,20,0.94)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px',
        color: 'rgba(255,255,255,0.8)',
        fontSize: 13,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {photo.photo_number || ''}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.55)' }}>
            {idx + 1} / {photos.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Tag, on the photo itself. Bulk tagging lives behind Select, which
              is the right home for a batch but not for the moment a person is
              looking at one picture thinking "this is the water heater"
              (Nicholas, 2026-08-24: "I still don't know how to tag photos"). */}
          {onTag && (
            <button
              onClick={() => onTag(photo)}
              title="Say what this photo shows"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                height: 36, padding: '0 14px', borderRadius: 18,
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              <Icon path="M20.6 13.4L12 4.8V2H4v8h2.8l8.6 8.6a2 2 0 002.8 0l2.4-2.4a2 2 0 000-2.8z M7 7h.01"
                size={14} color="#fff" />
              {isMeaningfulTag(photo.photo_type)
                ? photoTagLabel(photo)
                : 'Add tag'}
            </button>
          )}
          {onToggleReport && (
            <button
              onClick={() => onToggleReport(photo)}
              title={photo.include_in_final_report ? 'Included in final report — click to remove' : 'Include in final report'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                height: 36, padding: '0 14px', borderRadius: 18,
                background: photo.include_in_final_report ? C.emerald : 'rgba(255,255,255,0.1)',
                border: `1px solid ${photo.include_in_final_report ? C.emerald : 'rgba(255,255,255,0.2)'}`,
                color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              <Icon path={FLAG_ICON} size={15} color="#fff" />
              {photo.include_in_final_report ? 'In final report' : 'Include in report'}
            </button>
          )}
          <button
            onClick={async () => {
              try { await downloadSinglePhoto(photo) }
              catch { /* surfaced by the browser; nothing to toast in the overlay */ }
            }}
            title="Download (visible tag + full EXIF)"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              width: 36, height: 36, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Download"
          >
            <Icon path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" size={16} color="#fff" />
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              width: 36, height: 36, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            <Icon path="M6 18L18 6M6 6l12 12" size={16} color="#fff" />
          </button>
        </div>
      </div>

      {/* Image */}
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
        padding: '0 50px',
      }}>
        {idx > 0 && (
          <button
            onClick={() => setIdx(i => Math.max(0, i - 1))}
            style={{
              position: 'absolute', left: 8,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              width: 40, height: 40, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Previous"
          >
            <Icon path="M15 19l-7-7 7-7" size={18} color="#fff" />
          </button>
        )}
        {url ? (
          <img
            src={url}
            alt={photo.caption || photo.photo_number || 'photo'}
            style={{
              maxWidth: '100%', maxHeight: '100%',
              objectFit: 'contain', display: 'block',
            }}
          />
        ) : (
          <div style={{ color: '#fff', fontSize: 14 }}>Image unavailable</div>
        )}
        {idx < photos.length - 1 && (
          <button
            onClick={() => setIdx(i => Math.min(photos.length - 1, i + 1))}
            style={{
              position: 'absolute', right: 8,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              width: 40, height: 40, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Next"
          >
            <Icon path="M9 5l7 7-7 7" size={18} color="#fff" />
          </button>
        )}
      </div>

      {/* Bottom info bar — caption, taken_at, GPS */}
      <div style={{
        padding: '14px 16px calc(14px + env(safe-area-inset-bottom))',
        color: 'rgba(255,255,255,0.85)',
        fontSize: 12.5,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', flexWrap: 'wrap', gap: '6px 16px',
      }}>
        {photo.caption && (
          <div style={{ flexBasis: '100%', fontSize: 13.5 }}>
            {photo.caption}
          </div>
        )}
        {/* Which step this is evidence for, and what it shows — the two tags
            the roll-up gallery filters by. Only present on the work order's
            aggregate gallery; a step's own card already has the context. */}
        {photo._work_step_name && (
          <span style={{ fontWeight: 600, color: '#fff' }}>{photo._work_step_name}</span>
        )}
        {isMeaningfulTag(photo.photo_type) && (
          <span style={{ color: '#8fe0bb' }}>{photoTagLabel(photo)}</span>
        )}
        {takenAt && <span>Taken {takenAt}</span>}
        {gps && <span>GPS {gps}</span>}
        {photo.camera_make && (
          <span>{[photo.camera_make, photo.camera_model].filter(Boolean).join(' ')}</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DocumentPreviewModal — inline preview for documents
//
// Strategy by type:
//   PDF                       → <iframe>; modern browsers have built-in viewers
//   Images (png/jpg/gif/webp) → <img>; lets the browser handle decoding
//   Everything else           → metadata + "Open in new tab" / "Download"
//                               buttons (Office docs, archives, etc. have no
//                               native browser preview and should not be
//                               proxied through third-party viewers — the
//                               signed URL TTL would race with iframe loads)
//
// On mobile the modal goes full-screen; on desktop it occupies ~90% of the
// viewport so the file content has real estate without losing the dimming
// context behind it.
// ---------------------------------------------------------------------------

function getPreviewKind(doc) {
  const ext = (doc.name || '').split('.').pop()?.toLowerCase() || ''
  const mime = (doc.mime_type || '').toLowerCase()
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg','bmp'].includes(ext)) return 'image'
  // Spreadsheets render client-side via SheetJS (workbook → HTML table). The
  // file bytes are read in the browser the user already authenticated to —
  // nothing transits a third-party viewer, which matters for PII-bearing
  // sheets (e.g. tenant income data). CSV/TSV included since SheetJS parses
  // them into the same grid.
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'text/csv' ||
    mime === 'text/tab-separated-values' ||
    ['xlsx','xls','csv','tsv'].includes(ext)
  ) return 'spreadsheet'
  // DOCX renders client-side via mammoth (docx → semantic HTML). Same in-
  // boundary security property as the spreadsheet path — bytes are converted
  // in the authenticated session, nothing transits a third-party viewer.
  // Legacy binary .doc is NOT supported by mammoth and falls through.
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) return 'word'
  return 'fallback'
}

export function DocumentPreviewModal({ doc: docProp, onDownload, onClose }) {
  const isMobile = useIsMobile()

  // The signed URL on the row was minted when the gallery loaded, and a record
  // page stays open for hours. Opening a preview after the TTL lapsed put
  // Storage's InvalidJWT error JSON inside the iframe instead of the file, so
  // re-sign at the moment the preview opens rather than trusting the row.
  const [doc, setDoc] = useState(docProp)
  const [signing, setSigning] = useState(false)
  useEffect(() => {
    let cancelled = false
    setDoc(docProp)
    const hasFile = !!(docProp?.storage_bucket && docProp?.storage_path)
    if (!hasFile) return
    if (isSignedUrlUsable(docProp._previewUrl) && isSignedUrlUsable(docProp._url)) return
    setSigning(true)
    freshDocumentUrls(docProp)
      .then(next => { if (!cancelled) setDoc(next) })
      // A signing failure falls through to the body's own "unavailable"
      // message — there is nothing better to show here.
      .catch(() => {})
      .finally(() => { if (!cancelled) setSigning(false) })
    return () => { cancelled = true }
  }, [docProp])

  const kind = getPreviewKind(doc)
  const url = doc._url

  // ESC closes
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const sizeStr = doc.file_size_bytes ? formatBytes(doc.file_size_bytes) : null
  const createdStr = doc.created_at
    ? new Date(doc.created_at).toLocaleString('en-US',
        { year: 'numeric', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(8,12,20,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 24,
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={doc.name || 'Document preview'}
        style={{
          background: C.card,
          borderRadius: isMobile ? 0 : 10,
          width: isMobile ? '100%' : 'min(1100px, 95vw)',
          height: isMobile ? '100%' : '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: `1px solid ${C.border}`,
          background: '#fafbfd',
          flexShrink: 0,
          paddingTop: isMobile ? 'calc(12px + env(safe-area-inset-top))' : 12,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 5,
            background: '#e8f3fb',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon
              path={kind === 'image'
                ? 'M3 7h18v12H3V7z M3 7l5-5h8l5 5 M9 13a2 2 0 100-4 2 2 0 000 4z'
                : 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z M14 2v6h6'}
              size={14} color="#1a5a8a"
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 600, color: C.textPrimary,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {doc.name || 'Untitled'}
            </div>
            <div style={{
              fontSize: 11.5, color: C.textMuted,
              display: 'flex', gap: 8, marginTop: 1,
              flexWrap: 'wrap',
            }}>
              {doc.document_type && <span>{doc.document_type}</span>}
              {sizeStr && <span>· {sizeStr}</span>}
              {createdStr && !isMobile && <span>· Uploaded {createdStr}</span>}
            </div>
          </div>
          {url && !isMobile && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: C.card, color: C.textSecondary,
                border: `1px solid ${C.border}`, borderRadius: 5,
                padding: '6px 12px', fontSize: 12.5, cursor: 'pointer',
                fontWeight: 500, textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
            >
              <Icon path="M14 3h7v7 M21 3l-9 9 M21 14v6a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1h6"
                size={11} color={C.textSecondary} />
              Open in new tab
            </a>
          )}
          {/* Saving the file was previously only reachable by opening it in a
              new tab and downloading from the browser's own viewer. */}
          {url && onDownload && (
            <button
              onClick={onDownload}
              style={{
                background: C.emerald, color: '#fff',
                border: 'none', borderRadius: 5,
                padding: '6px 12px', fontSize: 12.5, cursor: 'pointer',
                fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 5,
                flexShrink: 0,
              }}
            >
              <Icon path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                size={12} color="#fff" />
              Download
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              width: 32, height: 32, borderRadius: 5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            aria-label="Close"
            onMouseEnter={(e) => { e.currentTarget.style.background = '#eef2f7' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <Icon path="M6 18L18 6M6 6l12 12" size={15} color={C.textSecondary} />
          </button>
        </div>

        {/* Body */}
        <div style={{
          flex: 1, minHeight: 0,
          background: kind === 'image' ? '#0d1a2e' : '#f5f7fa',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'auto',
          position: 'relative',
        }}>
          {signing ? (
            <div style={{ color: C.textMuted, fontSize: 13, padding: 32 }}>
              Preparing preview…
            </div>
          ) : !url ? (
            <div style={{ color: C.textMuted, fontSize: 13, padding: 32 }}>
              Preview unavailable — could not generate a signed URL.
            </div>
          ) : kind === 'pdf' ? (
            <iframe
              src={doc._previewUrl || url}
              title={doc.name || 'Document preview'}
              style={{
                width: '100%', height: '100%',
                border: 'none', display: 'block',
              }}
            />
          ) : kind === 'image' ? (
            <img
              src={url}
              alt={doc.name || 'Document preview'}
              style={{
                maxWidth: '100%', maxHeight: '100%',
                objectFit: 'contain', display: 'block',
              }}
            />
          ) : kind === 'spreadsheet' ? (
            <SpreadsheetPreview doc={doc} />
          ) : kind === 'word' ? (
            <WordPreview doc={doc} />
          ) : (
            <FallbackPreview doc={doc} />
          )}
        </div>

        {/* Mobile footer — gives "Open in new tab" a touch target since
            we hid it from the header to save horizontal space. Desktop
            users get the header link instead. */}
        {isMobile && url && (
          <div style={{
            padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
            borderTop: `1px solid ${C.border}`,
            background: '#fafbfd',
            display: 'flex', justifyContent: 'flex-end',
          }}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: C.emerald, color: '#fff',
                border: 'none', borderRadius: 6,
                padding: '10px 16px', fontSize: 14, fontWeight: 500,
                textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Icon path="M14 3h7v7 M21 3l-9 9 M21 14v6a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1h6"
                size={12} color="#fff" />
              Open in new tab
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function FallbackPreview({ doc }) {
  const ext = (doc.name || '').split('.').pop()?.toUpperCase() || 'FILE'
  const url = doc._url
  return (
    <div style={{
      padding: '32px 28px',
      textAlign: 'center',
      maxWidth: 420,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 10,
        background: '#e8f3fb', margin: '0 auto 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: '#1a5a8a',
        fontFamily: 'JetBrains Mono, monospace',
        letterSpacing: 0.5,
      }}>
        {ext.slice(0, 4)}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
        Preview not available in browser
      </div>
      <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.55, marginBottom: 18 }}>
        This file type can't render inline. Open it in a new tab and your
        browser or operating system will hand it off to the right app.
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: C.emerald, color: '#fff',
            border: 'none', borderRadius: 6,
            padding: '9px 18px', fontSize: 13, fontWeight: 500,
            textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Icon path="M14 3h7v7 M21 3l-9 9 M21 14v6a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1h6"
            size={12} color="#fff" />
          Open in new tab
        </a>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SpreadsheetPreview — client-side XLSX/XLS/CSV/TSV preview via SheetJS.
//
// The file is fetched from its signed _previewUrl and parsed in-browser; the
// bytes never leave the authenticated session, so PII-bearing sheets (tenant
// income data) are never handed to a third-party viewer. SheetJS is lazy-
// loaded so the heavy xlsx chunk only downloads when a spreadsheet is opened.
//
// Each sheet renders as an HTML table. With more than one sheet, a tab bar
// switches between them. This shows cell VALUES and structure — not Excel
// formatting, charts, or live formulas. For a flat data grid that's the
// whole content; for richly formatted workbooks, "Open in new tab" hands off
// to the desktop app.
// ---------------------------------------------------------------------------

function SpreadsheetPreview({ doc }) {
  const [state, setState] = useState({ status: 'loading', sheets: null, error: null })
  const [activeSheet, setActiveSheet] = useState(0)
  const url = doc._previewUrl || doc._url

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!url) {
        setState({ status: 'error', sheets: null, error: 'No signed URL available.' })
        return
      }
      try {
        const [XLSX, resp] = await Promise.all([
          import('xlsx'),
          fetch(url),
        ])
        if (!resp.ok) throw new Error(`Fetch failed (${resp.status})`)
        const buf = await resp.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const sheets = wb.SheetNames.map(name => {
          const ws = wb.Sheets[name]
          // header:1 → array-of-arrays so we render exactly what's in the grid,
          // including blank leading rows. defval:'' keeps column alignment.
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true })
          return { name, rows }
        })
        if (!cancelled) {
          setState({ status: 'ready', sheets, error: null })
          setActiveSheet(0)
        }
      } catch (e) {
        if (!cancelled) setState({ status: 'error', sheets: null, error: e?.message || String(e) })
      }
    }
    load()
    return () => { cancelled = true }
  }, [url])

  if (state.status === 'loading') {
    return (
      <div style={{ color: C.textMuted, fontSize: 13, padding: 32 }}>
        Rendering spreadsheet…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div style={{
        maxWidth: 420, textAlign: 'center', padding: '32px 28px',
      }}>
        <div style={{
          background: 'rgba(126,179,232,0.12)', border: `1px solid ${C.sky}`,
          color: C.textPrimary, borderRadius: 8, padding: '14px 16px',
          fontSize: 13, lineHeight: 1.55, marginBottom: 16,
        }}>
          Could not render this spreadsheet inline. Open it in a new tab to view
          it in your spreadsheet app.
        </div>
        {url && (
          <a
            href={doc._url || url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: C.emerald, color: '#fff', border: 'none',
              borderRadius: 6, padding: '9px 18px', fontSize: 13, fontWeight: 500,
              textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <Icon path="M14 3h7v7 M21 3l-9 9 M21 14v6a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1h6"
              size={12} color="#fff" />
            Open in new tab
          </a>
        )}
      </div>
    )
  }

  const sheets = state.sheets || []
  const current = sheets[activeSheet] || { rows: [] }
  const rows = current.rows || []
  // Normalize ragged rows to a uniform column count so the table stays square.
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0)

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'stretch', justifyContent: 'flex-start',
      background: C.card,
    }}>
      {sheets.length > 1 && (
        <div style={{
          display: 'flex', gap: 2, padding: '8px 10px 0',
          borderBottom: `1px solid ${C.border}`,
          background: '#fafbfd', flexShrink: 0,
          overflowX: 'auto',
        }}>
          {sheets.map((s, i) => (
            <button
              key={s.name + i}
              onClick={() => setActiveSheet(i)}
              style={{
                background: i === activeSheet ? C.card : 'transparent',
                color: i === activeSheet ? C.textPrimary : C.textSecondary,
                border: `1px solid ${i === activeSheet ? C.border : 'transparent'}`,
                borderBottom: i === activeSheet ? `1px solid ${C.card}` : '1px solid transparent',
                borderRadius: '6px 6px 0 0',
                padding: '7px 14px', fontSize: 12.5,
                fontWeight: i === activeSheet ? 600 : 500,
                cursor: 'pointer', whiteSpace: 'nowrap',
                marginBottom: -1,
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 0 }}>
        <table style={{
          borderCollapse: 'collapse', fontSize: 12.5,
          fontFamily: 'Inter, sans-serif', color: C.textPrimary,
          width: 'max-content', minWidth: '100%',
        }}>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td style={{
                  position: 'sticky', left: 0,
                  background: '#f1f4f9', color: C.textMuted,
                  border: `1px solid ${C.border}`,
                  padding: '4px 8px', fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11, textAlign: 'right', userSelect: 'none',
                  minWidth: 32,
                }}>
                  {ri + 1}
                </td>
                {Array.from({ length: colCount }).map((_, ci) => (
                  <td key={ci} style={{
                    border: `1px solid ${C.border}`,
                    padding: '4px 10px',
                    whiteSpace: 'nowrap',
                    maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {row[ci] != null ? String(row[ci]) : ''}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td style={{ padding: 16, color: C.textMuted }}>Empty sheet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WordPreview — client-side DOCX preview via mammoth (docx → semantic HTML).
//
// Same in-boundary model as SpreadsheetPreview: the file is fetched from its
// signed URL and converted in the browser, so PII never transits a third-
// party viewer. mammoth is lazy-loaded so its chunk only downloads when a
// Word document is opened. Output is readable semantic HTML (headings, lists,
// tables, bold/italic) — not pixel-perfect Word layout, embedded drawings,
// or exact pagination. For those, "Open in new tab" hands off to the app.
//
// mammoth's HTML is rendered into a styled, scrollable "page" surface. The
// HTML comes from the user's own uploaded file and is converted by mammoth
// (which emits a constrained tag set), but we still scope all styling locally
// rather than trusting arbitrary inline markup.
// ---------------------------------------------------------------------------

function WordPreview({ doc }) {
  const [state, setState] = useState({ status: 'loading', html: null, error: null })
  const url = doc._previewUrl || doc._url

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!url) {
        setState({ status: 'error', html: null, error: 'No signed URL available.' })
        return
      }
      try {
        const [mammothMod, purifyMod, resp] = await Promise.all([
          import('mammoth'),
          import('dompurify'),
          fetch(url),
        ])
        if (!resp.ok) throw new Error(`Fetch failed (${resp.status})`)
        const mammoth = mammothMod.default || mammothMod
        const DOMPurify = purifyMod.default || purifyMod
        const arrayBuffer = await resp.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer })
        // Sanitize mammoth's HTML before injection. The .docx is user-supplied,
        // so even though mammoth emits a constrained tag set we strip any
        // scriptable content as defense-in-depth — required before this path
        // is ever reachable by external/portal users.
        const clean = DOMPurify.sanitize(result?.value || '', {
          USE_PROFILES: { html: true },
          ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'class'],
        })
        if (!cancelled) {
          setState({ status: 'ready', html: clean, error: null })
        }
      } catch (e) {
        if (!cancelled) setState({ status: 'error', html: null, error: e?.message || String(e) })
      }
    }
    load()
    return () => { cancelled = true }
  }, [url])

  if (state.status === 'loading') {
    return (
      <div style={{ color: C.textMuted, fontSize: 13, padding: 32 }}>
        Rendering document…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div style={{ maxWidth: 420, textAlign: 'center', padding: '32px 28px' }}>
        <div style={{
          background: 'rgba(126,179,232,0.12)', border: `1px solid ${C.sky}`,
          color: C.textPrimary, borderRadius: 8, padding: '14px 16px',
          fontSize: 13, lineHeight: 1.55, marginBottom: 16,
        }}>
          Could not render this document inline. Open it in a new tab to view
          it in your word processor.
        </div>
        {url && (
          <a
            href={doc._url || url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: C.emerald, color: '#fff', border: 'none',
              borderRadius: 6, padding: '9px 18px', fontSize: 13, fontWeight: 500,
              textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <Icon path="M14 3h7v7 M21 3l-9 9 M21 14v6a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1h6"
              size={12} color="#fff" />
            Open in new tab
          </a>
        )}
      </div>
    )
  }

  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'auto',
      display: 'flex', justifyContent: 'center',
      alignItems: 'flex-start', padding: '24px 16px',
    }}>
      <div
        className="leap-docx-preview"
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          boxShadow: '0 2px 10px rgba(13,26,46,0.06)',
          width: 'min(820px, 100%)',
          padding: '48px 56px',
          fontFamily: 'Inter, sans-serif',
          fontSize: 14, lineHeight: 1.6, color: C.textPrimary,
        }}
        dangerouslySetInnerHTML={{ __html: state.html || '<p style="color:#8fa0b8">Empty document.</p>' }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirm delete
// ---------------------------------------------------------------------------

// ── Tag picker ──────────────────────────────────────────────────────────────
// Says what a photo SHOWS. A capture made against a work step is already
// tagged with that step's named prompt; a photo uploaded straight onto the work
// order arrives untagged, and this is where it gets one.
//
// Two things this deliberately does that a plain dropdown would not:
//
//   - It warns when the selection contains step evidence. The work step
//     evidence gates count photos by tag, so re-tagging one of those can
//     satisfy or un-satisfy a step. Correcting a mis-tagged shot has to stay
//     possible, so the warning names what is affected instead of blocking.
//   - It says the watermark is being redrawn. The tag is printed onto the face
//     of the evidence copy, so tagging is not a metadata-only edit.
function PhotoTagPickerModal({ photos, prompts, busy, onApply, onCancel }) {
  const count = photos.length
  const choices = useMemo(() => buildTagChoices(prompts), [prompts])
  const stepEvidence = useMemo(() => stepEvidenceInSelection(photos), [photos])
  // Every photo already carrying the same tag → show it as the current value.
  const currentTag = useMemo(() => {
    const tags = new Set(photos.map(p => String(p.photo_type || '').trim() || UNTAGGED))
    return tags.size === 1 ? Array.from(tags)[0] : null
  }, [photos])
  const anyTagged = photos.some(p => isMeaningfulTag(p.photo_type))

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(7,17,31,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: C.card, borderRadius: 8, border: `1px solid ${C.border}`,
        boxShadow: '0 12px 40px rgba(7,17,31,0.28)',
        width: 'min(440px, 100%)', maxHeight: '86vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: C.textPrimary }}>
            Tag {count} photo{count === 1 ? '' : 's'}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
            What do these photos show? The tag is stamped onto the watermarked
            copy, so each photo is re-rendered after it is set.
          </div>
        </div>

        {stepEvidence.length > 0 && (
          <div style={{
            margin: '10px 16px 0', padding: '8px 11px',
            background: '#eef4fb', border: `1px solid ${C.sky}`, borderRadius: 6,
            fontSize: 12, color: C.textSecondary, lineHeight: 1.45,
          }}>
            {stepEvidence.length} of these {stepEvidence.length === 1 ? 'is' : 'are'} work
            step evidence. A step's checklist counts photos by tag, so re-tagging
            {stepEvidence.length === 1 ? ' it' : ' them'} may change whether that
            step reads as complete.
          </div>
        )}

        <div style={{ overflowY: 'auto', padding: '8px 8px 4px', flex: 1 }}>
          {choices.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12.5, color: C.textMuted, lineHeight: 1.5 }}>
              This job's work plan defines no photo tags, so there is nothing to
              choose. Tags come from the work steps and the shots they ask for —
              add them to the work plan template and they appear here.
            </div>
          ) : choices.map(c => {
            const isCurrent = currentTag && currentTag.toLowerCase() === c.value.toLowerCase()
            return (
              <button
                key={c.value}
                onClick={() => onApply(c.value)}
                disabled={!!busy}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '9px 12px', marginBottom: 2,
                  border: `1px solid ${isCurrent ? C.emerald : 'transparent'}`,
                  background: isCurrent ? '#e8f8f2' : 'transparent',
                  borderRadius: 6, cursor: busy ? 'default' : 'pointer',
                  fontSize: 13, color: C.textPrimary, fontWeight: isCurrent ? 600 : 500,
                }}
              >
                {c.label}
                {isCurrent && (
                  <span style={{ fontSize: 10.5, color: C.emeraldMid, marginLeft: 8 }}>
                    current
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div style={{
          display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 16px', borderTop: `1px solid ${C.border}`,
        }}>
          <button
            onClick={() => onApply(null)}
            disabled={!!busy || !anyTagged}
            title={anyTagged ? 'Clear the tag from these photos' : 'These photos have no tag'}
            style={{
              padding: '6px 11px', borderRadius: 6,
              border: `1px solid ${C.border}`, background: C.card,
              color: (busy || !anyTagged) ? C.textMuted : C.textSecondary,
              fontSize: 12, fontWeight: 600,
              cursor: (busy || !anyTagged) ? 'default' : 'pointer',
            }}
          >Remove tag</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {busy && (
              <span style={{ fontSize: 12, color: C.textMuted }}>
                Re-stamping {busy.done}/{busy.total}…
              </span>
            )}
            <button
              onClick={onCancel}
              disabled={!!busy}
              style={{
                padding: '6px 13px', borderRadius: 6,
                border: `1px solid ${C.border}`, background: C.card,
                color: C.textSecondary, fontSize: 12, fontWeight: 600,
                cursor: busy ? 'default' : 'pointer',
              }}
            >Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConfirmDeleteModal({ name, target, count = 1, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  const noun = target === 'photos' ? 'photo' : 'document'
  const many = count > 1
  const handleConfirm = async () => {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 9100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: C.card, borderRadius: 10, padding: 24, width: 420, maxWidth: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#e8f1fb',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"
              size={15} color="#1a5a8a" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
              Delete {many ? `these ${count} ${noun}s` : `this ${noun}`}?
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
              <strong>{name}</strong> will be moved to the recycle bin. An admin can
              restore {many ? 'them' : 'it'} later if needed.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              background: C.card, color: C.textSecondary,
              border: `1px solid ${C.border}`, borderRadius: 5,
              padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
            }}
          >Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            style={{
              background: '#1a5a8a', color: '#fff',
              border: 'none', borderRadius: 5,
              padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
            }}
          >{busy ? 'Deleting…' : (many ? `Delete ${count}` : 'Delete')}</button>
        </div>
      </div>
    </div>
  )
}
