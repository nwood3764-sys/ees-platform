// ---------------------------------------------------------------------------
// HomesProposalModal — generates the Wisconsin IRA Multifamily HOMES Project
// Reservation proposal for one enrollment.
//
// Everything is pulled from the record: the two Asset Score reports attached
// under Reservation Customer Report, the owner/contact/unit-count/contractor on
// the enrollment, and the install address on the property. There is nothing to
// adjust — if an input is missing the modal says exactly what to attach or fill
// in and will not generate a half-built proposal.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import {
  loadHomesProposalContext, homesProposalMissing,
  generateHomesProposal, saveHomesProposalToRecord,
} from '../data/homesProposalService'

const CARD_SECONDARY = '#f7f9fc'

export default function HomesProposalModal({ enrollmentId, onClose, onSaved }) {
  const toast = useToast()
  const [ctx, setCtx] = useState(null)
  const [missing, setMissing] = useState(null)   // array from the record-level gate
  const [loadErr, setLoadErr] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [genMissing, setGenMissing] = useState(null) // array from the parse-level gate
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const c = await loadHomesProposalContext(enrollmentId)
        if (!alive) return
        setCtx(c)
        setMissing(homesProposalMissing(c))
      } catch (e) { if (alive) setLoadErr(e.message || String(e)) }
    })()
    return () => { alive = false }
  }, [enrollmentId])

  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url) }, [result])

  async function handleGenerate() {
    setGenerating(true); setGenMissing(null)
    try {
      const r = await generateHomesProposal(enrollmentId)
      if (result?.url) URL.revokeObjectURL(result.url)
      setResult({ blob: r.blob, fileName: r.fileName, url: URL.createObjectURL(r.blob), model: r.model })
    } catch (e) {
      if (Array.isArray(e.missing)) setGenMissing(e.missing)
      else toast.error(`Could not generate the proposal: ${e.message || e}`)
    } finally { setGenerating(false) }
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)
    try {
      await saveHomesProposalToRecord(enrollmentId, result.blob, result.fileName)
      toast.success(`Saved to this enrollment’s Documents: ${result.fileName}`)
      if (onSaved) onSaved()
      if (onClose) onClose()
    } catch (e) {
      toast.error(`Could not save the proposal: ${e.message || e}`)
    } finally { setSaving(false) }
  }

  function handleDownload() {
    if (!result) return
    const a = document.createElement('a')
    a.href = result.url; a.download = result.fileName
    document.body.appendChild(a); a.click(); a.remove()
  }

  const ready = ctx && missing && missing.length === 0
  const f = ctx?.fields
  const designLabel = ctx
    ? (/sealed/i.test(ctx.contractor || '') ? 'Sealed (green)' : 'EES (blue)')
    : null

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>Generate Proposal</div>
            <div style={{
              fontSize: 12, color: C.textMuted, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {f?.pjPropName || 'Wisconsin IRA Multifamily HOMES — Project Reservation'}
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

          {ctx && !loadErr && (
            <>
              {/* record-level gate: what's missing to even start */}
              {missing && missing.length > 0 && (
                <div style={notice}>
                  <Icon path="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" size={15} color="#1e466b" />
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>This enrollment isn’t ready yet — add:</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {missing.map((m, i) => <li key={i} style={{ marginBottom: 2 }}>{m}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {/* what will be pulled */}
              <div style={sectionLabel}>What this proposal will use</div>
              <div style={rowGrid}>
                <Field label="Design" value={designLabel} />
                <Field label="Primary contractor" value={ctx.contractor || '—'} tone={ctx.contractor ? undefined : 'warn'} />
                <Field label="Units" value={ctx.units || '—'} tone={ctx.units ? undefined : 'warn'} />
                <Field label="Owner" value={f.pjOwner || '—'} />
                <Field label="Contact" value={[f.pjContact, f.pjContactTitle].filter(Boolean).join(' — ') || '—'} />
                <Field label="Property" value={[f.pjInstallAddr, f.pjCsz].filter(Boolean).join(', ') || '—'} />
                <Field label="Baseline Asset Score" value={ctx.baseDoc ? 'Attached' : 'Missing'} tone={ctx.baseDoc ? undefined : 'warn'} />
                <Field label="Improved Asset Score" value={ctx.impDoc ? 'Attached' : 'Missing'} tone={ctx.impDoc ? undefined : 'warn'} />
              </div>

              {/* parse-level gate: reports attached but unreadable/incomplete */}
              {genMissing && genMissing.length > 0 && (
                <div style={notice}>
                  <Icon path="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" size={15} color="#1e466b" />
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>The reports are attached but the proposal can’t be built:</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {genMissing.map((m, i) => <li key={i} style={{ marginBottom: 2 }}>{m}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {result && (
                <div style={{ ...notice, background: '#eaf7f0', borderColor: '#bfe6d2', color: '#0d5c3a' }}>
                  <Icon path="M5 13l4 4L19 7" size={15} color="#0d5c3a" />
                  <div>
                    Proposal generated: {result.fileName}
                    {result.model?.total != null && (
                      <span style={{ color: C.textMuted }}> · Total project cost ${Number(result.model.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={footer}>
          <div style={{ fontSize: 12, color: C.textMuted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {result ? result.fileName : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={onClose} style={btnGhost}>Close</button>
            {result ? (
              <>
                <a href={result.url} target="_blank" rel="noreferrer"
                  style={{ ...btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>View</a>
                <button onClick={handleSave} disabled={saving} style={{ ...btnGhost, opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : 'Save to Enrollment'}
                </button>
                <button onClick={handleDownload} style={btnPrimary}>Download</button>
                <button onClick={handleGenerate} disabled={generating} style={btnGhost}>
                  {generating ? 'Regenerating…' : 'Regenerate'}
                </button>
              </>
            ) : (
              <button onClick={handleGenerate} disabled={!ready || generating}
                style={{ ...btnPrimary, opacity: (!ready || generating) ? 0.6 : 1 }}>
                {generating ? 'Generating…' : 'Generate'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, tone }) {
  return (
    <div style={{ background: CARD_SECONDARY, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', minWidth: 0 }}>
      <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{
        fontSize: 12.5, fontWeight: 600, marginTop: 2,
        color: tone === 'warn' ? '#1e466b' : C.textPrimary,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  )
}

// ── styles (matching SubmittedEnrollmentModal) ───────────────────────────────
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
  borderRadius: 8, padding: '10px 12px', margin: '4px 0 12px',
}
const sectionLabel = {
  fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase',
  letterSpacing: '.04em', margin: '6px 0 8px',
}
const rowGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }
const btnBase = { fontSize: 12.5, fontWeight: 600, borderRadius: 6, padding: '8px 14px', cursor: 'pointer' }
const btnGhost = { ...btnBase, background: C.card, border: `1px solid ${C.borderDark}`, color: C.textSecondary }
const btnPrimary = { ...btnBase, background: C.emerald, border: `1px solid ${C.emerald}`, color: '#06301f' }
