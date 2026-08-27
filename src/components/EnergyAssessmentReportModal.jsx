// ---------------------------------------------------------------------------
// EnergyAssessmentReportModal — generates the Energy Assessment Report for one
// assessment work order.
//
// This is the AUDIT's own deliverable, not a program submittal. Project
// Reservation and Final Project Payment Request are filings to a program
// administering body and live on the PROJECT (ProjectSubmittalDocumentsModal);
// an assessment report is the write-up of what the assessor found, so it is
// generated from the work order that captured it.
//
// What the report is made of is stated up front — captured sections, and the
// photos flagged "Include in final report" on this work order's Photos card —
// because both are things the user controls before pressing Generate.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import {
  loadAssessmentReportContext, attachAssessmentPhotoImages, attachAssessmentDocuments,
  saveAssessmentReportToWorkOrder,
} from '../data/assessmentReportService'
import { buildAssessmentReportPdf } from '../data/paperworkModel'
import { ASSESSMENT_REPORT_KIND, reportFileName } from '../lib/assessmentReport'

const CARD_SECONDARY = '#f7f9fc'

export default function EnergyAssessmentReportModal({ workOrderId, workOrder, onClose, onSaved }) {
  const toast = useToast()
  const [ctx, setCtx] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)     // { url, fileName, blob }
  const [saving, setSaving] = useState(false)
  const [savedName, setSavedName] = useState(null)
  // Documents marked "Include in final report" on the work order's Documents
  // card arrive already chosen. That flag exists precisely so the set is
  // decided once on the record rather than re-picked on every generation
  // (Nicholas, 2026-08-27); anything not flagged is still opt-in here.
  const [chosenDocs, setChosenDocs] = useState(() => new Set())

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const c = await loadAssessmentReportContext(workOrderId)
        if (!alive) return
        setCtx(c)
        setChosenDocs(new Set((c.documents || []).filter(d => d.inFinalReport).map(d => d.id)))
      } catch (e) { if (alive) setLoadErr(e.message || String(e)) }
    })()
    return () => { alive = false }
  }, [workOrderId])

  // Revoke the preview URL when this modal goes away.
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url) }, [result])

  async function handleGenerate() {
    if (!ctx) return
    setGenerating(true); setProgress({ done: 0, total: ctx.counts.photosFlagged, phase: 'photos' })
    try {
      await attachAssessmentPhotoImages(ctx.model, {
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const picked = (ctx.documents || []).filter(d => chosenDocs.has(d.id))
      setProgress({ done: 0, total: picked.length, phase: 'documents' })
      await attachAssessmentDocuments(ctx.model, picked, {
        onProgress: (done, total) => setProgress({ done, total, phase: 'documents' }),
      })
      const blob = await buildAssessmentReportPdf(
        ctx.model, ASSESSMENT_REPORT_KIND, ctx.template?.sections || null)
      // Named for the BUILDING — same rule the service uses. Passing the work
      // order number here was why the download came out wrong.
      const fileName = reportFileName(ctx.def, ctx.model.building?.fileName, ctx.model.building?.label)
      if (result?.url) URL.revokeObjectURL(result.url)
      setResult({ blob, fileName, url: URL.createObjectURL(blob) })
    } catch (e) {
      toast.error(`Could not generate the report: ${e.message || e}`)
    } finally { setGenerating(false) }
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)
    try {
      await saveAssessmentReportToWorkOrder(workOrderId, result.blob, result.fileName)
      setSavedName(result.fileName)
      toast.success(`Saved to this work order’s Documents: ${result.fileName}`)
      if (onSaved) onSaved()
      // Saving is the end of the job. Leaving the dialog open put the person
      // back on a screen offering to generate the report they just filed, and
      // the record reload behind it reset that screen to its initial state —
      // which read as the dialog popping back up (Nicholas, 2026-08-27).
      if (onClose) onClose()
    } catch (e) {
      toast.error(`Could not save the report: ${e.message || e}`)
    } finally { setSaving(false) }
  }

  function handleDownload() {
    if (!result) return
    const a = document.createElement('a')
    a.href = result.url; a.download = result.fileName
    document.body.appendChild(a); a.click(); a.remove()
  }

  const noPhotos = ctx && ctx.counts.photosFlagged === 0

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={header}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
              {ctx?.def?.label || 'Energy Assessment Report'}
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {workOrder?.work_order_record_number || ''}
              {workOrder?.work_order_name ? ` · ${workOrder.work_order_name}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={iconBtn} title="Close">
            <Icon path="M6 6l12 12M6 18L18 6" size={16} color={C.textSecondary} />
          </button>
        </div>

        {/* Body */}
        <div style={body}>
          {loadErr && (
            <div style={notice}>
              <Icon path="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" size={15} color="#1e466b" />
              <span>{loadErr}</span>
            </div>
          )}

          {!ctx && !loadErr && (
            <div style={{ color: C.textMuted, fontSize: 13, padding: '18px 0' }}>Loading the assessment…</div>
          )}

          {ctx && (
            <>
              <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.55, marginBottom: 14 }}>
                The report prints the sections of this assessment that have something in them —
                answers recorded, or photos marked <strong>Include in final report</strong> on this
                work order’s Photos card. Photos print with the section that captured them. A
                section with nothing captured is left out; work order and work step status are never
                consulted.
              </div>

              <div style={statGrid}>
                <Stat label="Sections in report"
                  value={`${ctx.counts.sectionsWithContent} of ${ctx.counts.steps}`}
                  tone={ctx.counts.sectionsWithContent === 0 ? 'warn' : 'ok'} />
                <Stat label="Photos in report" value={`${ctx.counts.photosFlagged} of ${ctx.counts.photosTotal}`}
                  tone={noPhotos ? 'warn' : 'ok'} />
                <Stat label="Template" value={ctx.templateName || ctx.template?.name || 'Built-in default'} />
              </div>

              {noPhotos && (
                <div style={notice}>
                  <Icon path="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" size={15} color="#1e466b" />
                  <span>
                    No photos on this work order are marked <strong>Include in final report</strong>.
                    The report will generate without photographs — mark them on the Photos card first
                    if they belong in it.
                  </span>
                </div>
              )}

              {/* What the report will contain, section by section — counting
                  PHOTOS as content, so a section carrying five photos and no
                  typed answers never reads as empty. */}
              <div style={{ marginTop: 4 }}>
                <div style={sectionLabel}>Sections</div>
                <div style={sectionList}>
                  {ctx.model.steps.map(s => {
                    const bits = []
                    if (s.photoCount) bits.push(s.photoCount === 1 ? '1 photo' : `${s.photoCount} photos`)
                    if (s.fields.length) bits.push(`${s.answeredCount} of ${s.fields.length} answered`)
                    if (s.notApplicable) bits.push('not applicable')
                    return (
                      <div key={s.key} style={{ ...sectionRow, opacity: s.willPrint ? 1 : 0.5 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: 3, flexShrink: 0,
                            background: s.willPrint ? C.emerald : C.borderDark,
                          }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        </span>
                        <span style={{ color: C.textMuted, fontSize: 11, whiteSpace: 'nowrap', marginLeft: 10 }}>
                          {s.willPrint ? bits.join('  ·  ') : 'nothing captured — left out'}
                        </span>
                      </div>
                    )
                  })}
                  {ctx.model.steps.length === 0 && (
                    <div style={{ ...sectionRow, color: C.textMuted }}>This work order has no captured sections.</div>
                  )}
                </div>
              </div>

              {/* The work order's Documents related list. Pick what belongs in
                  the report — each one gets a link the reader can download
                  later, and a preview where the file can show one. */}
              <div style={{ marginTop: 4 }}>
                <div style={{ ...sectionLabel, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Documents{(ctx.documents || []).length ? ` (${chosenDocs.size} of ${ctx.documents.length} selected)` : ''}</span>
                  {(ctx.documents || []).length > 1 && (
                    <button type="button" onClick={() => setChosenDocs(prev =>
                      prev.size === ctx.documents.length ? new Set() : new Set(ctx.documents.map(d => d.id)))}
                      style={linkBtn}>
                      {chosenDocs.size === ctx.documents.length ? 'Clear all' : 'Select all'}
                    </button>
                  )}
                </div>
                <div style={sectionList}>
                  {(ctx.documents || []).map(docItem => (
                    <label key={docItem.id} style={{ ...sectionRow, cursor: 'pointer', gap: 10 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <input type="checkbox" checked={chosenDocs.has(docItem.id)}
                          onChange={() => setChosenDocs(prev => {
                            const next = new Set(prev)
                            if (next.has(docItem.id)) next.delete(docItem.id); else next.add(docItem.id)
                            return next
                          })} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docItem.name}</span>
                      </span>
                      <span style={{ color: C.textMuted, fontSize: 11, whiteSpace: 'nowrap', marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {/* Say WHY a box is already ticked, so a pre-selection
                            never looks like the dialog choosing for you. */}
                        {docItem.inFinalReport && (
                          <span style={{
                            background: '#e8f8f2', color: C.emeraldMid,
                            fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
                            padding: '1px 6px', borderRadius: 9,
                          }}>IN REPORT</span>
                        )}
                        {[docItem.typeLabel, docItem.size,
                          docItem.previewKind === 'none' ? 'link only' : 'preview'].filter(Boolean).join('  ·  ')}
                      </span>
                    </label>
                  ))}
                  {!(ctx.documents || []).length && (
                    <div style={{ ...sectionRow, color: C.textMuted }}>
                      No documents on this work order. Anything added to its Documents card can be included here — flag one there and it arrives ticked.
                    </div>
                  )}
                </div>
                {chosenDocs.size > 0 && (
                  <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 6, lineHeight: 1.5 }}>
                    Selected documents are listed in the report with a link the reader can use to download
                    the file. A picture or a PDF also shows a preview; anything else is the link alone.
                  </div>
                )}
              </div>

              {result && (
                <div style={{ ...notice, background: '#ecfdf5', borderColor: '#a7f3d0', color: '#0f6b47' }}>
                  <Icon path="M5 13l4 4L19 7" size={15} color="#0f6b47" />
                  <span>
                    <strong>{result.fileName}</strong> is ready.
                    {savedName ? ' Saved to this work order’s Documents.' : ''}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={footer}>
          <div style={{ fontSize: 11.5, color: C.textMuted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {generating && progress.total > 0
              ? `Preparing ${progress.phase === 'documents' ? 'documents' : 'photos'} ${progress.done} of ${progress.total}…`
              : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={onClose} style={btnGhost}>Close</button>
            {result && (
              <>
                <a href={result.url} target="_blank" rel="noreferrer"
                  title="Opens in a new tab for viewing. Use Download to save it — a tab saves under the browser's own name, not the report's."
                  style={{ ...btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                  View
                </a>
                <button onClick={handleSave} disabled={saving} style={{ ...btnGhost, opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : 'Save to Work Order'}
                </button>
                <button onClick={handleDownload} style={btnPrimary}>Download</button>
              </>
            )}
            {!result && (
              <button onClick={handleGenerate} disabled={!ctx || generating}
                style={{ ...btnPrimary, opacity: (!ctx || generating) ? 0.6 : 1 }}>
                {generating ? 'Generating…' : 'Generate Report'}
              </button>
            )}
            {result && (
              <button onClick={handleGenerate} disabled={generating} style={btnGhost}>
                {generating ? 'Regenerating…' : 'Regenerate'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div style={{
      background: CARD_SECONDARY, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '10px 12px', minWidth: 0,
    }}>
      <div style={{ fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{
        fontSize: 14, fontWeight: 700, marginTop: 3,
        color: tone === 'warn' ? '#1e466b' : C.textPrimary,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  )
}

// ── styles ──────────────────────────────────────────────────────────────────
const backdrop = {
  position: 'fixed', inset: 0, background: 'rgba(13,26,46,0.45)', zIndex: 1200,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
}
const panel = {
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
  boxShadow: '0 18px 48px rgba(13,26,46,0.22)', width: 'min(720px, 100%)',
  maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
}
const header = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
  padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
}
const body = { padding: '14px 16px', overflowY: 'auto', flex: 1 }
const footer = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '12px 16px', borderTop: `1px solid ${C.border}`, background: CARD_SECONDARY,
}
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }
const notice = {
  display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, lineHeight: 1.5,
  background: '#eef5fd', border: '1px solid #cfe2f7', color: '#1e466b',
  borderRadius: 8, padding: '10px 12px', margin: '12px 0',
}
const statGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }
const sectionLabel = {
  fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase',
  letterSpacing: '.04em', margin: '14px 0 6px',
}
const sectionList = { border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }
const sectionRow = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '7px 12px', fontSize: 12.5, color: C.textPrimary,
  borderBottom: `1px solid ${C.border}`,
}
const btnBase = {
  fontSize: 12.5, fontWeight: 600, borderRadius: 6, padding: '8px 14px', cursor: 'pointer',
}
const btnGhost = { ...btnBase, background: C.card, border: `1px solid ${C.borderDark}`, color: C.textSecondary }
const btnPrimary = { ...btnBase, background: C.emerald, border: `1px solid ${C.emerald}`, color: '#06301f' }
const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 10.5, fontWeight: 600, color: C.emeraldMid, textTransform: 'none', letterSpacing: 0,
}
