import { useState, useEffect, useCallback } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { DocumentPreviewModal } from './FileGallery'
import {
  classifyEnrollment,
  runIncomeQualification,
  listIncomeQualificationDocuments,
} from '../data/incomeQualificationService'

// ---------------------------------------------------------------------------
// IncomeQualificationPanel
//
// Standalone card on the Enrollment record. Runs the multifamily HUD
// categorical income-qualification tool: classifies the enrollment (from its
// own fields, falling back to the linked property's HUD data), generates the
// IRA application PDF + tenant data XLSX, saves both to the enrollment, and
// writes the determination back onto the enrollment record. Shows the
// generated files with download links.
//
// Palette: navy / sky only. The source tool used a green/gold/flag-red theme;
// here we conform to the LEAP design system (no red/orange — blocked/ineligible
// states use sky/navy).
// ---------------------------------------------------------------------------

const card = {
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: 20, marginBottom: 16,
}
const labelStyle = {
  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 600,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted,
}

function ModeBadge({ mode }) {
  const entire = mode === 'Entire Building'
  return (
    <span style={{
      fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 600,
      letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 8px',
      borderRadius: 3, whiteSpace: 'nowrap',
      background: entire ? C.emerald : 'rgba(126,179,232,0.15)',
      color: entire ? '#fff' : C.sky,
      border: entire ? 'none' : `1px solid ${C.sky}`,
    }}>{mode}</span>
  )
}

export default function IncomeQualificationPanel({ enrollmentId }) {
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [previewDoc, setPreviewDoc] = useState(null)

  const refresh = useCallback(async () => {
    if (!enrollmentId) return
    setLoading(true)
    try {
      const d = await listIncomeQualificationDocuments(enrollmentId)
      setDocs(d)
    } catch (e) {
      setError(e?.message || 'Failed to load income qualification files.')
    } finally {
      setLoading(false)
    }
  }, [enrollmentId])

  useEffect(() => { refresh() }, [refresh])

  // Preview classification on first load so the user sees the determination
  // before running (no files, no persistence).
  useEffect(() => {
    let cancelled = false
    if (!enrollmentId) return
    setPreviewing(true)
    classifyEnrollment(enrollmentId)
      .then(det => { if (!cancelled) setPreview(det) })
      .catch(e => { if (!cancelled) setError(e?.message || 'Classification failed.') })
      .finally(() => { if (!cancelled) setPreviewing(false) })
    return () => { cancelled = true }
  }, [enrollmentId])

  async function handleRun() {
    setRunning(true); setError(null)
    try {
      await runIncomeQualification(enrollmentId)
      await refresh()
    } catch (e) {
      setError(e?.message || 'Income qualification run failed.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon path="M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" size={18} color={C.textSecondary} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
            Income Qualification
          </h3>
        </div>
        <button
          onClick={handleRun}
          disabled={running || previewing}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: running ? '#f7f9fc' : C.emerald,
            color: running ? C.textMuted : '#fff',
            border: 'none', borderRadius: 6, padding: '9px 16px',
            fontWeight: 600, fontSize: 13, cursor: running ? 'default' : 'pointer',
            transition: 'all 200ms ease',
          }}>
          {running ? 'Generating files…' : 'Run Income Qualification'}
        </button>
      </div>

      {error && (
        <div style={{
          background: 'rgba(126,179,232,0.1)', border: `1px solid ${C.sky}`,
          color: C.textPrimary, borderRadius: 6, padding: '10px 12px', marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {/* Determination preview (categorical classification, pre-run) */}
      {previewing && <div style={{ color: C.textMuted, fontSize: 13 }}>Classifying property…</div>}
      {preview && !previewing && (
        <div style={{
          background: '#f7f9fc', border: `1px solid ${C.border}`,
          borderRadius: 6, padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
            <span style={labelStyle}>Determination</span>
            <ModeBadge mode={preview.mode} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
            <Metric label="Total Units" value={preview.totalUnits} />
            <Metric label="Assisted Units" value={preview.assistedUnits} />
            <Metric label="Subsidized Share" value={`${preview.subsidizedSharePct}%`} />
            <Metric label="Pathways" value={preview.pathways.join(', ') || '—'} />
          </div>
          <div style={{ marginTop: 12, fontSize: 12.5, color: C.textSecondary }}>
            <span style={{ fontWeight: 600 }}>Required proof: </span>{preview.requiredProof}
          </div>
          {preview.mode === 'Individual Tenants' && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: C.sky }}>
              No categorical program detected on the HUD record. The building does not auto-qualify;
              individual tenant income certification is required before submission.
            </div>
          )}
        </div>
      )}

      {/* Generated files */}
      <div style={{ marginBottom: 8 }}>
        <span style={labelStyle}>Generated Files</span>
      </div>
      {loading ? (
        <div style={{ color: C.textMuted, fontSize: 13 }}>Loading…</div>
      ) : docs.length === 0 ? (
        <div style={{ color: C.textMuted, fontSize: 13, padding: '8px 0' }}>
          No files yet. Run the qualification to generate the IRA application PDF and tenant data sheet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map(d => (
            <div key={d.id}
              role="button"
              tabIndex={0}
              onClick={() => setPreviewDoc(d)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreviewDoc(d) } }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                background: '#f7f9fc', border: `1px solid ${C.border}`, borderRadius: 6,
                padding: '10px 12px', color: C.textPrimary, fontSize: 13,
              }}>
              <Icon path={d.document_type === 'income_qualification_application' ? 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M8 13h8 M8 17h8' : 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18'} size={16} color={C.textSecondary} />
              <span style={{ flex: 1 }}>{d.name}</span>
              <span style={{ ...labelStyle, color: C.sky }}>Preview</span>
            </div>
          ))}
        </div>
      )}
      {previewDoc && (
        <DocumentPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: C.textMuted, marginTop: 6,
      }}>{label}</div>
    </div>
  )
}
