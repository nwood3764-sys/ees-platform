// QualityInstallPhotoPackageModal — generates the Quality Install Verification
// photo evidence package (ZIP of named photos + grouped PDF) from a verification
// work order, downloads both, and attaches them to the work order as documents so
// they travel with the final payment application.
//
// Launched from the "Generate Quality Install Photo Package" action on a Quality
// Install Verification work order (recordActions.js).
import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import { uploadDocument } from '../data/storageService'
import {
  loadQualityInstallPhotoPackage,
  buildQualityInstallPhotoPackage,
  triggerBlobDownload,
} from '../data/qualityInstallPhotoPackage'

export default function QualityInstallPhotoPackageModal({ workOrderId, workOrder, onClose }) {
  const toast = useToast()
  const [pkg, setPkg] = useState(null)      // loaded summary
  const [loadErr, setLoadErr] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null) // { files: [name] }
  const [genErr, setGenErr] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await loadQualityInstallPhotoPackage(workOrderId)
        if (alive) setPkg(data)
      } catch (e) {
        if (alive) setLoadErr(e.message || String(e))
      }
    })()
    return () => { alive = false }
  }, [workOrderId])

  async function handleGenerate() {
    if (!pkg || generating) return
    setGenerating(true); setGenErr(null); setProgress({ done: 0, total: pkg.totalPhotos })
    try {
      const { zipBlob, pdfBlob, baseName } = await buildQualityInstallPhotoPackage(pkg, {
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const zipName = `${baseName}.zip`
      const pdfName = `${baseName}.pdf`

      // Download both to the user.
      triggerBlobDownload(zipBlob, zipName)
      triggerBlobDownload(pdfBlob, pdfName)

      // Attach both to the work order so they persist with the payment application.
      const zipFile = new File([zipBlob], zipName, { type: 'application/zip' })
      const pdfFile = new File([pdfBlob], pdfName, { type: 'application/pdf' })
      const attached = []
      for (const [file, name] of [[pdfFile, pdfName], [zipFile, zipName]]) {
        try {
          await uploadDocument({ file, relatedObject: 'work_orders', relatedId: workOrderId, name })
          attached.push(name)
        } catch (e) {
          // Download already succeeded; surface the attach failure but don't lose the file.
          setGenErr(`Downloaded, but attaching "${name}" to the work order failed: ${e.message || e}`)
        }
      }
      setResult({ files: [pdfName, zipName], attached })
      toast.success('Photo package generated')
    } catch (e) {
      setGenErr(e.message || String(e))
    } finally {
      setGenerating(false)
    }
  }

  const noPhotos = pkg && pkg.totalPhotos === 0
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div style={overlay} onMouseDown={(ev) => { if (ev.target === ev.currentTarget && !generating) onClose?.() }}>
      <div style={card}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={iconWrap}>
              <Icon path="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16v12H4z" size={17} color="#2aab72" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>Generate Quality Install Photo Package</div>
              <div style={{ fontSize: 11.5, color: C.textMuted }}>{workOrder?.work_order_record_number || 'Quality Install Verification'} · ZIP + PDF</div>
            </div>
          </div>
          <button onClick={onClose} disabled={generating} style={{ ...xBtn, opacity: generating ? 0.4 : 1 }} aria-label="Close">
            <Icon path="M6 6l12 12M18 6L6 18" size={16} color={C.textSecondary} />
          </button>
        </div>

        <div style={bodyStyle}>
          <div style={reviewBox}>
            Builds two files from this work order's evidence photos: a <strong style={strongStyle}>ZIP</strong> of every photo
            named per category and work step (full-resolution, with the burned-in step/GPS/timestamp and original EXIF), and a
            <strong style={strongStyle}> PDF</strong> laying the photos out grouped by category then work step. Both download to
            you and attach to the work order.
          </div>

          {loadErr ? (
            <div style={errorBox}>Couldn't load photos: {loadErr}</div>
          ) : !pkg ? (
            <div style={hintStyle}>Loading photos…</div>
          ) : (
            <>
              <div style={summaryGrid}>
                <div style={statCell}><div style={statNum}>{pkg.totalPhotos}</div><div style={statLbl}>Photos</div></div>
                <div style={statCell}><div style={statNum}>{pkg.stepCount}</div><div style={statLbl}>Work steps</div></div>
                <div style={statCell}><div style={statNum}>{pkg.groups.length}</div><div style={statLbl}>Categories</div></div>
              </div>

              <div style={{ marginTop: 14 }}>
                {pkg.groups.map(g => (
                  <div key={g.category} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textPrimary, marginBottom: 3 }}>{g.category}</div>
                    {g.steps.map(s => (
                      <div key={s.stepId} style={stepRow}>
                        <span style={{ color: C.textSecondary }}>{s.name}</span>
                        <span style={{ color: s.photos.length ? C.textSecondary : C.textMuted, fontWeight: 600 }}>
                          {s.photos.length} photo{s.photos.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {pkg.emptyStepCount > 0 && !result && (
                <div style={hintStyle}>{pkg.emptyStepCount} step{pkg.emptyStepCount === 1 ? ' has' : 's have'} no photos yet — those appear in the PDF marked as not captured.</div>
              )}
              {noPhotos && <div style={errorBox}>No photos have been captured on this work order yet. Capture the step photos in LEAP Pad, then generate the package.</div>}

              {generating && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 5 }}>Processing photo {progress.done} of {progress.total}…</div>
                  <div style={progressTrack}><div style={{ ...progressFill, width: `${pct}%` }} /></div>
                </div>
              )}

              {result && (
                <div style={{ ...reviewBox, marginTop: 14, marginBottom: 0, background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Package generated</div>
                  {result.files.map(f => <div key={f}>Downloaded: {f}</div>)}
                  {result.attached.length > 0 && <div style={{ marginTop: 4 }}>Attached to the work order: {result.attached.length} file{result.attached.length === 1 ? '' : 's'}.</div>}
                </div>
              )}

              {genErr && <div style={errorBox}>{genErr}</div>}
            </>
          )}
        </div>

        <div style={footerStyle}>
          <button onClick={onClose} disabled={generating} style={{ ...btnSecondary, opacity: generating ? 0.5 : 1 }}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleGenerate}
              disabled={!pkg || noPhotos || generating}
              style={{ ...btnPrimary, opacity: (!pkg || noPhotos || generating) ? 0.5 : 1, cursor: (!pkg || noPhotos || generating) ? 'not-allowed' : 'pointer' }}
            >
              {generating ? 'Generating…' : 'Generate ZIP + PDF'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ───────── styles (mirror QualityInstallVerificationModal) ─────────
const CARD_SECONDARY = '#f7f9fc'
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16,
}
const card = {
  width: '100%', maxWidth: 560, maxHeight: '90vh', background: C.card,
  border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  overflow: 'hidden', display: 'flex', flexDirection: 'column',
}
const headerStyle = {
  padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
}
const iconWrap = {
  width: 32, height: 32, borderRadius: 6, background: '#ecfdf5', border: '1px solid #a7f3d0',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
const xBtn = { border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, display: 'flex' }
const bodyStyle = { padding: 20, overflowY: 'auto', minHeight: 0 }
const footerStyle = {
  padding: '12px 20px', borderTop: `1px solid ${C.border}`,
  display: 'flex', gap: 10, justifyContent: 'flex-end', background: C.page, flexShrink: 0,
}
const hintStyle = { fontSize: 11.5, color: C.textMuted, marginTop: 6, lineHeight: 1.45 }
const strongStyle = { color: C.textPrimary }
const reviewBox = {
  background: CARD_SECONDARY, border: `1px solid ${C.border}`, borderRadius: 6,
  padding: '10px 14px', marginBottom: 16, fontSize: 12, color: C.textSecondary, lineHeight: 1.7,
}
const errorBox = {
  background: '#e8f1fb', border: '1px solid #bcd9f2', borderRadius: 6, padding: '10px 12px',
  fontSize: 12.5, color: '#1a5a8a', marginTop: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
}
const summaryGrid = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }
const statCell = {
  background: CARD_SECONDARY, border: `1px solid ${C.border}`, borderRadius: 6,
  padding: '10px 12px', textAlign: 'center',
}
const statNum = { fontSize: 20, fontWeight: 700, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }
const statLbl = { fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }
const stepRow = {
  display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5,
  padding: '3px 0', borderBottom: `1px solid ${C.border}`,
}
const progressTrack = { height: 8, background: '#e4e9f2', borderRadius: 4, overflow: 'hidden' }
const progressFill = { height: '100%', background: '#3ecf8e', transition: 'width 150ms ease' }
const btnSecondary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6,
}
const btnPrimary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
  background: '#3ecf8e', color: '#06281c', border: '1px solid #2aab72', borderRadius: 6,
}
