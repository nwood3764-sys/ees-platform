// ---------------------------------------------------------------------------
// EnrollmentSubmissionReportModal — generates the Enrollment Submission Record
// for one enrollment.
//
// This is the record of a FILING: what was submitted to the program, and the
// attachments that went with it, each with a link that still works when
// somebody opens the PDF a year from now. It is not the assessment report
// (the deliverable of a building walk, generated from the assessment work
// order) and not a project submittal (Project Reservation / Final Project
// Payment Request, generated from the project).
//
// What goes in is stated before you press Generate — how many fields were
// filled in, how many were left blank, and which documents are flagged —
// because all three are things the user controls on the record.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import {
  loadSubmissionReportContext, attachSubmissionDocuments,
  saveSubmissionReportToEnrollment,
} from '../data/enrollmentSubmissionReportService'
import { buildSubmissionRecordPdf } from '../data/paperworkModel'
import { SUBMISSION_REPORT_KIND, submissionFileName } from '../lib/enrollmentSubmissionReport'

const CARD_SECONDARY = '#f7f9fc'

export default function EnrollmentSubmissionReportModal({ enrollmentId, onClose, onSaved }) {
  const toast = useToast()
  const [ctx, setCtx] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)
  // Default to the flagged set when anything is flagged — the "Include in
  // report" flag on the Documents card exists so this is decided once on the
  // record instead of re-picked on every generation. With nothing flagged the
  // manifest lists everything, and the notice below says so.
  const [flaggedOnly, setFlaggedOnly] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const c = await loadSubmissionReportContext(enrollmentId)
        if (!alive) return
        setCtx(c)
        setFlaggedOnly(c.counts.documentsFlagged > 0)
      } catch (e) { if (alive) setLoadErr(e.message || String(e)) }
    })()
    return () => { alive = false }
  }, [enrollmentId])

  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url) }, [result])

  async function handleGenerate() {
    if (!ctx) return
    setGenerating(true)
    setProgress({ done: 0, total: ctx.counts.documentsTotal })
    try {
      await attachSubmissionDocuments(ctx.model, ctx.documents, {
        flaggedOnly,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const blob = await buildSubmissionRecordPdf(
        ctx.model, SUBMISSION_REPORT_KIND, ctx.template?.sections || null)
      const fileName = submissionFileName(
        ctx.def, ctx.model.enrollment?.number, ctx.model.property?.name)
      if (result?.url) URL.revokeObjectURL(result.url)
      setResult({ blob, fileName, url: URL.createObjectURL(blob) })
    } catch (e) {
      toast.error(`Could not generate the submission record: ${e.message || e}`)
    } finally { setGenerating(false) }
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)
    try {
      await saveSubmissionReportToEnrollment(enrollmentId, result.blob, result.fileName)
      toast.success(`Saved to this enrollment’s Documents: ${result.fileName}`)
      if (onSaved) onSaved()
      if (onClose) onClose()
    } catch (e) {
      toast.error(`Could not save the submission record: ${e.message || e}`)
    } finally { setSaving(false) }
  }

  function handleDownload() {
    if (!result) return
    const a = document.createElement('a')
    a.href = result.url; a.download = result.fileName
    document.body.appendChild(a); a.click(); a.remove()
  }

  const counts = ctx?.counts
  const listedCount = counts
    ? (flaggedOnly && counts.documentsFlagged ? counts.documentsFlagged : counts.documentsTotal)
    : 0

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
              {ctx?.def?.title || 'Enrollment Submission Record'}
            </div>
            <div style={{
              fontSize: 12, color: C.textMuted, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {[ctx?.model?.enrollment?.number, ctx?.model?.property?.name]
                .filter(Boolean).join(' · ') || 'Loading…'}
            </div>
          </div>
          <button onClick={onClose} style={iconBtn} aria-label="Close">
            <Icon path="M6 18L18 6M6 6l12 12" size={18} color={C.textMuted} />
          </button>
        </div>

        <div style={body}>
          {loadErr && (
            <div style={notice}>
              <Icon path="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" size={15} color="#1e466b" />
              <div>{loadErr}</div>
            </div>
          )}

          {ctx && (
            <>
              <div style={statGrid}>
                <Stat label="Fields submitted" value={counts.summaryFilled} />
                <Stat label="Left blank" value={counts.summaryBlank}
                  tone={counts.summaryBlank ? 'warn' : undefined} />
                <Stat label="Documents attached" value={counts.documentsTotal} />
                <Stat label="Flagged for report" value={counts.documentsFlagged}
                  tone={counts.documentsFlagged ? undefined : 'warn'} />
              </div>

              <div style={sectionLabel}>Documents in this record</div>
              <label style={{
                display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5,
                color: C.textPrimary, padding: '8px 0', cursor: counts.documentsFlagged ? 'pointer' : 'default',
              }}>
                <input
                  type="checkbox"
                  checked={flaggedOnly && counts.documentsFlagged > 0}
                  disabled={counts.documentsFlagged === 0}
                  onChange={e => setFlaggedOnly(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  Only the documents flagged <strong>Include in report</strong> on the
                  Documents card.
                  {counts.documentsFlagged === 0 && (
                    <span style={{ color: C.textMuted }}>
                      {' '}Nothing is flagged yet, so every attached file is listed. Use the
                      flag on the Documents card to say exactly which files were submitted.
                    </span>
                  )}
                </span>
              </label>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                {listedCount === 0
                  ? 'No documents are attached to this enrollment — the record will still list what was submitted.'
                  : `${listedCount} document${listedCount === 1 ? '' : 's'} will be listed, each with a download link good for one year.`}
              </div>

              {counts.summaryBlank > 0 && (
                <div style={notice}>
                  <Icon path="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" size={15} color="#1e466b" />
                  <div>
                    {counts.summaryBlank} submitted field{counts.summaryBlank === 1 ? ' was' : 's were'} left
                    blank. They print with an em dash rather than disappearing, so this record shows
                    what was and was not filled in.
                  </div>
                </div>
              )}

              {ctx.templateName && (
                <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 10 }}>
                  Layout: {ctx.templateName}
                </div>
              )}
            </>
          )}

          {generating && (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 12 }}>
              Preparing document links… {progress.done}/{progress.total}
            </div>
          )}
        </div>

        <div style={footer}>
          <div style={{ fontSize: 12, color: C.textMuted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {result ? result.fileName : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={onClose} style={btnGhost}>Close</button>
            {result && (
              <>
                <a href={result.url} target="_blank" rel="noreferrer"
                  title="Opens in a new tab for viewing. Use Download to save it under the record's own name."
                  style={{ ...btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                  View
                </a>
                <button onClick={handleSave} disabled={saving} style={{ ...btnGhost, opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : 'Save to Enrollment'}
                </button>
                <button onClick={handleDownload} style={btnPrimary}>Download</button>
                <button onClick={handleGenerate} disabled={generating} style={btnGhost}>
                  {generating ? 'Regenerating…' : 'Regenerate'}
                </button>
              </>
            )}
            {!result && (
              <button onClick={handleGenerate} disabled={!ctx || generating}
                style={{ ...btnPrimary, opacity: (!ctx || generating) ? 0.6 : 1 }}>
                {generating ? 'Generating…' : 'Generate Record'}
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
const btnBase = {
  fontSize: 12.5, fontWeight: 600, borderRadius: 6, padding: '8px 14px', cursor: 'pointer',
}
const btnGhost = { ...btnBase, background: C.card, border: `1px solid ${C.borderDark}`, color: C.textSecondary }
const btnPrimary = { ...btnBase, background: C.emerald, border: `1px solid ${C.emerald}`, color: '#06301f' }
