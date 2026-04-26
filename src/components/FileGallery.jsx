import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import { useIsMobile } from '../lib/useMediaQuery'
import {
  defaultPhotoBucket,
  uploadPhoto,
  listPhotos,
  hydratePhotoUrls,
  softDeletePhoto,
  reprocessPhoto,
  uploadDocument,
  listDocuments,
  hydrateDocumentUrls,
  softDeleteDocument,
} from '../data/storageService'

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
  photos:    'image/*',
  documents: '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.heic,.heif',
}

// Gallery sizing — a 4-up grid on desktop drops to 3-up on tablet and 2-up
// on mobile via plain CSS grid. We keep the thumbnail aspect 1:1 so the
// grid stays tidy regardless of source orientation; the lightbox shows the
// full-resolution image without cropping.
const THUMB_GAP = 8

export default function FileGalleryWidget({
  widget, parentTable, parentRecordId,
}) {
  const config = widget.widget_config || {}
  const target = config.target === 'documents' ? 'documents' : 'photos'
  const isMobile = useIsMobile()
  const toast = useToast()
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const containerRef = useRef(null)

  const [collapsed, setCollapsed] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [items, setItems]         = useState([])     // photos or documents (hydrated with _url / _thumbUrl)
  const [error, setError]         = useState(null)
  const [uploading, setUploading] = useState(0)      // count of in-flight uploads
  const [dragActive, setDragActive] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState(null) // photos only
  const [confirmDelete, setConfirmDelete] = useState(null) // {id, name}

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
        const rows = await listPhotos(parentTable, parentRecordId, {
          workStepId: config.work_step_id || null,
        })
        const hydrated = await hydratePhotoUrls(rows)
        setItems(hydrated)
      } else {
        const rows = await listDocuments(parentTable, parentRecordId)
        const hydrated = await hydrateDocumentUrls(rows)
        setItems(hydrated)
      }
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentTable, parentRecordId, target, config.work_step_id])

  useEffect(() => { refresh() }, [refresh])

  // Photos with a 'pending' watermark won't have their watermarked URL on
  // first load. Poll lightly while any are pending so the UI catches up
  // when the edge function finishes. Stops as soon as no rows are pending.
  useEffect(() => {
    if (target !== 'photos') return
    const hasPending = items.some(p => p.watermark_status === 'pending')
    if (!hasPending) return
    const t = setTimeout(refresh, 4000)
    return () => clearTimeout(t)
  }, [items, target, refresh])

  // ── Upload handlers ─────────────────────────────────────────────────
  const handleFiles = useCallback(async (fileList) => {
    if (!fileList || fileList.length === 0) return
    if (photoLockoutMessage) {
      toast.error(photoLockoutMessage)
      return
    }
    const files = Array.from(fileList)
    let successCount = 0
    let failCount = 0
    setUploading(c => c + files.length)
    try {
      // Sequential upload — keeps memory predictable on mobile and avoids
      // hammering the edge function with N parallel cold starts. Most
      // real-world uploads are 1-3 files at a time.
      for (const file of files) {
        try {
          if (target === 'photos') {
            await uploadPhoto({
              file,
              relatedObject: parentTable,
              relatedId: parentRecordId,
              workStepId: config.work_step_id || null,
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
      toast.success(
        files.length === 1
          ? `Uploaded ${files[0].name}`
          : `Uploaded ${successCount} of ${files.length} files`
      )
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
    const { id, name } = confirmDelete
    try {
      if (target === 'photos') await softDeletePhoto(id)
      else                     await softDeleteDocument(id)
      toast.success(`Deleted ${name}`)
      setConfirmDelete(null)
      // If we were viewing the deleted photo in the lightbox, close it.
      if (target === 'photos' && lightboxIdx !== null) {
        setLightboxIdx(null)
      }
      await refresh()
    } catch (e) {
      toast.error(e.message || 'Delete failed')
    }
  }

  const handleReprocess = async (photoId) => {
    try {
      await reprocessPhoto(photoId)
      toast.info('Re-processing — will refresh shortly')
      // Optimistically flip status so the badge updates without waiting
      // for the next refresh tick.
      setItems(prev => prev.map(p => p.id === photoId
        ? { ...p, watermark_status: 'pending', watermark_error: null }
        : p))
    } catch (e) {
      toast.error(e.message || 'Re-processing failed')
    }
  }

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
            {photoLockoutMessage ? (
              <LockoutNotice message={photoLockoutMessage} />
            ) : loading ? (
              <SkeletonGrid mode={target} isMobile={isMobile} />
            ) : error ? (
              <ErrorNotice message={error} onRetry={refresh} />
            ) : items.length === 0 ? (
              <EmptyState
                target={target}
                onPick={() => fileInputRef.current?.click()}
                onCamera={target === 'photos' && isMobile
                  ? () => cameraInputRef.current?.click()
                  : null}
              />
            ) : target === 'photos' ? (
              <PhotoGrid
                photos={items}
                isMobile={isMobile}
                onOpen={(idx) => setLightboxIdx(idx)}
                onReprocess={handleReprocess}
                onDelete={(p) => setConfirmDelete({ id: p.id, name: p.photo_number || 'photo' })}
              />
            ) : (
              <DocumentList
                documents={items}
                isMobile={isMobile}
                onDelete={(d) => setConfirmDelete({ id: d.id, name: d.name || 'document' })}
              />
            )}
          </div>
        )}
      </div>

      {/* Lightbox — photos only, full-screen overlay */}
      {target === 'photos' && lightboxIdx !== null && items[lightboxIdx] && (
        <Lightbox
          photos={items}
          startIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onIndexChange={setLightboxIdx}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmDeleteModal
          name={confirmDelete.name}
          target={target}
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
      background: '#fef3c7',
      border: '1px solid #fcd34d',
      color: '#92400e',
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
      background: '#fef2f2',
      border: '1px solid #fca5a5',
      color: '#b03a2e',
      fontSize: 12.5,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <span>Failed to load: {message}</span>
      <button
        onClick={onRetry}
        style={{
          background: '#fff', color: '#b03a2e',
          border: '1px solid #fca5a5', borderRadius: 4,
          padding: '3px 9px', fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
        }}
      >Retry</button>
    </div>
  )
}

function EmptyState({ target, onPick, onCamera }) {
  return (
    <div style={{
      padding: '28px 16px',
      textAlign: 'center',
      color: C.textMuted,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 13 }}>
        No {target === 'photos' ? 'photos' : 'documents'} on this record yet.
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

function PhotoGrid({ photos, isMobile, onOpen, onReprocess, onDelete }) {
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
          onOpen={() => onOpen(idx)}
          onReprocess={() => onReprocess(p.id)}
          onDelete={() => onDelete(p)}
        />
      ))}
    </div>
  )
}

function PhotoTile({ photo, onOpen, onReprocess, onDelete }) {
  const status = photo.watermark_status
  const url = photo._thumbUrl
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
        cursor: url ? 'pointer' : 'default',
        border: `1px solid ${C.border}`,
      }}
      onClick={() => url && onOpen()}
    >
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
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.textMuted, fontSize: 11,
        }}>
          {status === 'pending' ? 'Processing…' : 'Unavailable'}
        </div>
      )}

      {/* Watermark status badge — only visible when not 'done' */}
      {status === 'pending' && (
        <div style={{
          position: 'absolute', top: 6, left: 6,
          background: 'rgba(13,26,46,0.78)', color: '#fff',
          fontSize: 10, fontWeight: 600,
          padding: '2px 7px', borderRadius: 10,
          textTransform: 'uppercase', letterSpacing: 0.4,
        }}>Processing</div>
      )}
      {status === 'error' && (
        <button
          onClick={(e) => { e.stopPropagation(); onReprocess() }}
          title={photo.watermark_error || 'Retry processing'}
          style={{
            position: 'absolute', top: 6, left: 6,
            background: '#fef2f2', color: '#b03a2e',
            border: '1px solid #fca5a5', borderRadius: 10,
            fontSize: 10, fontWeight: 600,
            padding: '2px 7px', cursor: 'pointer',
            textTransform: 'uppercase', letterSpacing: 0.4,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          <Icon path="M4 4v5h5 M20 20v-5h-5 M5.5 9.5a8 8 0 0114-3 M18.5 14.5a8 8 0 01-14 3"
            size={9} color="#b03a2e" />
          Retry
        </button>
      )}

      {/* Hover/tap overlay with delete — visible on hover desktop, always
          on mobile (tappable trash in corner). */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        style={{
          position: 'absolute', top: 6, right: 6,
          width: 26, height: 26, borderRadius: '50%',
          background: 'rgba(13,26,46,0.65)',
          border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          opacity: hover ? 1 : 0.55,
          transition: 'opacity 0.15s',
        }}
        title="Delete"
      >
        <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"
          size={12} color="#fff" />
      </button>

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

function DocumentList({ documents, isMobile, onDelete }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {documents.map((d) => (
        <DocumentRow
          key={d.id}
          doc={d}
          isMobile={isMobile}
          onDelete={() => onDelete(d)}
        />
      ))}
    </div>
  )
}

function DocumentRow({ doc, isMobile, onDelete }) {
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

  const open = () => {
    if (doc._url) window.open(doc._url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={open}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px',
        borderRadius: 6,
        cursor: doc._url ? 'pointer' : 'default',
        background: hover ? '#f5f8fc' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
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
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        style={{
          background: 'transparent',
          border: 'none',
          width: 28, height: 28, borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          opacity: hover || isMobile ? 1 : 0,
          transition: 'opacity 0.15s',
        }}
        title="Delete"
      >
        <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"
          size={13} color={C.textMuted} />
      </button>
    </div>
  )
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

function Lightbox({ photos, startIndex, onClose, onIndexChange }) {
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

  const photo = photos[idx]
  if (!photo) return null
  // Prefer the original (full-resolution) in the lightbox, with the
  // watermarked variant as fallback for cases where the original signed
  // URL didn't resolve (e.g. RLS quirk on a freshly inserted row).
  const url = photo._originalUrl || photo._thumbUrl

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

      {/* Image */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
// Confirm delete
// ---------------------------------------------------------------------------

function ConfirmDeleteModal({ name, target, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  const noun = target === 'photos' ? 'photo' : 'document'
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
            background: '#fef2f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"
              size={15} color="#b03a2e" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
              Delete this {noun}?
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
              <strong>{name}</strong> will be moved to the recycle bin. An admin can
              restore it later if needed.
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
              background: '#b03a2e', color: '#fff',
              border: 'none', borderRadius: 5,
              padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
            }}
          >{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
    </div>
  )
}
