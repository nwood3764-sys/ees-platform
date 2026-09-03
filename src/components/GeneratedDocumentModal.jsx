// ---------------------------------------------------------------------------
// GeneratedDocumentModal — generates one of LEAP's built-from-the-record
// documents and shows it, ready to download or save to the record's Documents.
//
// Which documents exist, what they are called and which service produces each
// live in src/data/generatedDocuments.js; this file is only the chrome. Today:
//
//   · Proposal (HOMES)    — WI-IRA-MF-HOMES Project Reservation enrollment
//   · Proposal (HEAR)     — WI-IRA-MF-HEAR Project Reservation enrollment
//   · Assessment Invoice  — Assessment Pre-Approval enrollment (fixed price)
//   · Payment Request Inv — WI-IRA-MF-HOMES Project Payment Request incentive app
//
// There is nothing to configure: opening the modal generates the document from
// the record. The generated PDF is shown inline — Download saves a copy to your
// computer, Save adds it to this record's Documents. If an input is missing it
// says exactly what to fix.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import { generatedDocumentSpec } from '../data/generatedDocuments'
import { objectLabel as objectLabelFor } from '../lib/objectNav'

const CARD_SECONDARY = '#f7f9fc'

// friendly name for the record the document attaches to
const OBJECT_LABEL = {
  enrollments:            'Enrollment',
  incentive_applications: objectLabelFor('incentive_applications'),
}

export default function GeneratedDocumentModal({ recordObject = 'enrollments', recordId, kind = 'proposal', onClose, onSaved }) {
  const toast = useToast()
  const doc = generatedDocumentSpec(kind) || generatedDocumentSpec('proposal')
  const objectLabel = OBJECT_LABEL[recordObject] || 'Record'

  const [generating, setGenerating] = useState(true)
  const [result, setResult] = useState(null)   // { blob, url, fileName, model, documentType }
  const [missing, setMissing] = useState(null)  // array of strings — record not ready
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Generate immediately on open — there is nothing to configure first.
  useEffect(() => {
    let alive = true
    setGenerating(true); setMissing(null); setErr(null); setResult(null); setSaved(false)
    ;(async () => {
      try {
        const r = await doc.generate({ object: recordObject, id: recordId })
        if (!alive) return
        setResult({ ...r, url: URL.createObjectURL(r.blob) })
      } catch (e) {
        if (!alive) return
        if (Array.isArray(e.missing)) setMissing(e.missing)
        else setErr(e.message || String(e))
      } finally { if (alive) setGenerating(false) }
    })()
    return () => { alive = false }
  }, [recordObject, recordId, kind])   // eslint-disable-line react-hooks/exhaustive-deps

  // Revoke the object URL when it's replaced or the modal closes.
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url) }, [result])

  async function handleSave() {
    if (!result) return
    setSaving(true)
    try {
      await doc.save({ object: recordObject, id: recordId }, result.blob, result.fileName, result.documentType)
      setSaved(true)
      toast.success(`Saved to this ${objectLabel.toLowerCase()}’s Documents: ${result.fileName}`)
      if (onSaved) onSaved()
    } catch (e) {
      toast.error(`Could not save the ${doc.noun}: ${e.message || e}`)
    } finally { setSaving(false) }
  }

  function handleDownload() {
    if (!result) return
    const a = document.createElement('a')
    a.href = result.url; a.download = result.fileName
    document.body.appendChild(a); a.click(); a.remove()
  }

  const m = result?.model

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{doc.title}</div>
            <div style={{
              fontSize: 12, color: C.textMuted, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {result ? result.fileName : `${objectLabel} document`}
            </div>
          </div>
          <button onClick={onClose} style={iconBtn} aria-label="Close">
            <Icon path="M6 18L18 6M6 6l12 12" size={18} color={C.textMuted} />
          </button>
        </div>

        <div style={body}>
          {generating && (
            <div style={centerState}>
              <div style={spinner} />
              <div style={{ fontSize: 13, color: C.textSecondary }}>Generating the {doc.noun}…</div>
            </div>
          )}

          {!generating && missing && (
            <div style={notice}>
              <Icon path="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" size={15} color="#1e466b" />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>This record isn’t ready yet — add:</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {missing.map((x, i) => <li key={i} style={{ marginBottom: 2 }}>{x}</li>)}
                </ul>
              </div>
            </div>
          )}

          {!generating && err && (
            <div style={notice}>
              <Icon path="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" size={15} color="#1e466b" />
              <div>Could not generate the {doc.noun}: {err}</div>
            </div>
          )}

          {!generating && result && (
            <>
              {/* the actual document, shown inline */}
              <iframe title="Document preview" src={result.url} style={preview} />
              {/* A line item the proposal could not place is named, never
                  silently dropped — a mis-coded product is then visible on the
                  screen that would otherwise just be missing it. */}
              {result.unmapped && result.unmapped.length > 0 && (
                <div style={{ ...notice, marginTop: 10 }}>
                  <Icon path="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" size={15} color="#1e466b" />
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      Not on this proposal — {result.unmapped.length === 1 ? 'this line item is' : 'these line items are'} not a programme measure:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {result.unmapped.map((x, i) => <li key={i} style={{ marginBottom: 2 }}>{x}</li>)}
                    </ul>
                  </div>
                </div>
              )}
              {m && (m.savings != null || (m.total != null)) && (
                <div style={summaryLine}>
                  {m.total != null && (
                    <span>Total project cost <strong>${Number(m.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></span>
                  )}
                  {m.savings != null && (
                    <span>{m.total != null ? '  ·  ' : ''}Modeled savings <strong>{m.savings.toFixed(1)}%</strong>
                      {m.euiBase != null && m.euiImp != null && ` (Site EUI ${m.euiBase} → ${m.euiImp} kBtu/ft²/yr)`}</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div style={footer}>
          <div style={{ fontSize: 12, color: C.textMuted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {saved
              ? `Saved to this ${objectLabel.toLowerCase()}’s Documents`
              : (result
                  // Name the file here, and say which button applies it. The
                  // preview above is the browser's own PDF viewer, and ITS save
                  // button can only see a blob: URL — whose entire identity is a
                  // uuid, so it saves "2ef5cbfd-….pdf". Download and Save both
                  // carry the real name; nothing in a blob URL can.
                  ? `Download saves it as “${result.fileName}” — the preview’s own save button cannot name it`
                  : '')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={onClose} style={btnGhost}>Close</button>
            {result && (
              <>
                <button onClick={handleSave} disabled={saving || saved} style={{ ...btnGhost, opacity: (saving || saved) ? 0.6 : 1 }}>
                  {saved ? 'Saved ✓' : (saving ? 'Saving…' : `Save to ${objectLabel}`)}
                </button>
                <button onClick={handleDownload} style={btnPrimary}>Download</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── styles ───────────────────────────────────────────────────────────────
const backdrop = {
  position: 'fixed', inset: 0, background: 'rgba(13,26,46,0.45)', zIndex: 1200,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
}
const panel = {
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
  boxShadow: '0 18px 48px rgba(13,26,46,0.22)', width: 'min(840px, 100%)',
  maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
}
const header = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
  padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
}
const body = { padding: '14px 16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }
const preview = {
  width: '100%', flex: 1, minHeight: 460, border: `1px solid ${C.border}`,
  borderRadius: 8, background: '#fff',
}
const summaryLine = { fontSize: 12.5, color: C.textSecondary, marginTop: 10, textAlign: 'center' }
const centerState = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 200, flex: 1 }
const spinner = {
  width: 26, height: 26, borderRadius: '50%',
  border: `3px solid ${C.border}`, borderTopColor: C.emerald, animation: 'ees-spin 0.8s linear infinite',
}
const footer = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '12px 16px', borderTop: `1px solid ${C.border}`, background: CARD_SECONDARY,
}
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }
const notice = {
  display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, lineHeight: 1.5,
  background: '#eef5fd', border: '1px solid #cfe2f7', color: '#1e466b',
  borderRadius: 8, padding: '10px 12px', margin: '4px 0',
}
const btnBase = { fontSize: 12.5, fontWeight: 600, borderRadius: 6, padding: '8px 14px', cursor: 'pointer' }
const btnGhost = { ...btnBase, background: C.card, border: `1px solid ${C.borderDark}`, color: C.textSecondary }
const btnPrimary = { ...btnBase, background: C.emerald, border: `1px solid ${C.emerald}`, color: '#06301f' }
