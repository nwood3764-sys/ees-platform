// ---------------------------------------------------------------------------
// ProjectReportModal — Generate Report dialog opened from a project record.
//
// Lets the user pick a project_report_template (defaulted by record type),
// toggle watermarked vs original photo variant, and kick off the
// generate-project-report Edge Function. On success, refreshes the parent's
// Documents widget via onComplete() and closes after a brief confirmation.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'

export default function ProjectReportModal({ projectId, project, onClose, onComplete }) {
  const toast = useToast()
  const [templates, setTemplates] = useState([])
  const [selectedPrtId, setSelectedPrtId] = useState('')   // empty = let server resolve
  const [resolvedDefaultId, setResolvedDefaultId] = useState(null)
  const [useWatermarked, setUseWatermarked] = useState(true)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // { document_id, page_count, ... }

  // Load active templates + figure out which one is the default for this project
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        // 1) all active, non-deleted templates
        const { data: prts, error: tErr } = await supabase
          .from('project_report_templates')
          .select(`
            id, prt_record_number, prt_name, prt_version,
            prt_is_default_for_unmapped,
            status:prt_status ( picklist_value, picklist_label )
          `)
          .eq('prt_is_deleted', false)
          .order('prt_name', { ascending: true })
        if (tErr) throw new Error(tErr.message)

        const active = (prts || []).filter(
          p => !p.status || p.status.picklist_value === 'Active'
        )

        // 2) record-type assignment for this project
        let defaultId = null
        if (project?.project_record_type) {
          const { data: assign } = await supabase
            .from('project_report_template_record_type_assignments')
            .select('prt_id')
            .eq('project_record_type', project.project_record_type)
            .eq('prtrta_is_default', true)
            .eq('prtrta_is_deleted', false)
            .maybeSingle()
          if (assign?.prt_id) defaultId = assign.prt_id
        }
        // 3) fallback to unmapped default
        if (!defaultId) {
          const fallback = active.find(p => p.prt_is_default_for_unmapped)
          if (fallback) defaultId = fallback.id
        }
        // 4) last resort: first active
        if (!defaultId && active.length > 0) defaultId = active[0].id

        if (cancelled) return
        setTemplates(active)
        setResolvedDefaultId(defaultId)
        setSelectedPrtId(defaultId || '')
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load templates')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [project?.project_record_type])

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const { data, error: invErr } = await supabase.functions.invoke('generate-project-report', {
        body: {
          project_id: projectId,
          prt_id: selectedPrtId || undefined,
          use_watermarked: !!useWatermarked,
        },
      })
      if (invErr) {
        // The error from supabase-js sometimes wraps the function's response body
        let detail = invErr.message
        try {
          const ctx = invErr.context
          if (ctx && typeof ctx.json === 'function') {
            const j = await ctx.json()
            if (j?.error) detail = j.error
          }
        } catch { /* noop */ }
        throw new Error(detail)
      }
      if (!data?.ok) throw new Error(data?.error || 'Report generation failed')
      setResult(data)
      toast.success(`Report generated — ${data.page_count} pages`)
      // Tell the parent to refresh documents
      try { onComplete?.(data) } catch { /* noop */ }
    } catch (e) {
      const msg = e?.message || String(e)
      setError(msg)
      toast.error(`Generation failed — ${msg}`)
    } finally {
      setGenerating(false)
    }
  }

  const closeAfterDone = () => onClose?.()

  // ───────────── render ─────────────

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1100, padding: 16,
  }
  const card = {
    width: '100%', maxWidth: 520, background: C.card,
    border: `1px solid ${C.border}`, borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    overflow: 'hidden',
  }
  const headerStyle = {
    padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }
  const bodyStyle = { padding: 20 }
  const footerStyle = {
    padding: '14px 20px', borderTop: `1px solid ${C.border}`,
    display: 'flex', gap: 10, justifyContent: 'flex-end',
    background: C.page,
  }

  return (
    <div style={overlay} onClick={!generating ? closeAfterDone : undefined}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 6,
              background: '#ecfdf5', border: '1px solid #a7f3d0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={17} color={C.emerald} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>Generate Project Report</div>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>
                {project?.project_record_number} • {project?.project_name || 'Untitled Project'}
              </div>
            </div>
          </div>
          <button
            onClick={!generating ? closeAfterDone : undefined}
            disabled={generating}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', padding: 6, borderRadius: 4,
              cursor: generating ? 'wait' : 'pointer', color: C.textMuted,
            }}
          >
            <Icon path="M18 6 6 18M6 6l12 12" size={16} color="currentColor" />
          </button>
        </div>

        <div style={bodyStyle}>
          {loading ? (
            <div style={{ padding: '20px 0', color: C.textMuted, fontSize: 13, textAlign: 'center' }}>
              Loading templates…
            </div>
          ) : result ? (
            <SuccessPanel result={result} onClose={closeAfterDone} />
          ) : (
            <>
              {/* Template picker */}
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Template</label>
                <select
                  value={selectedPrtId}
                  onChange={e => setSelectedPrtId(e.target.value)}
                  disabled={generating || templates.length === 0}
                  style={selectStyle}
                >
                  {templates.length === 0 && <option value="">(no templates available)</option>}
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.prt_name} ({t.prt_record_number} v{t.prt_version})
                      {t.prt_is_default_for_unmapped ? ' — fallback default' : ''}
                    </option>
                  ))}
                </select>
                {selectedPrtId === resolvedDefaultId && resolvedDefaultId && (
                  <div style={hintStyle}>
                    Default for this project's record type.
                  </div>
                )}
              </div>

              {/* Watermark toggle */}
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Photo variant</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <SegButton
                    active={useWatermarked}
                    onClick={() => !generating && setUseWatermarked(true)}
                    disabled={generating}
                    title="Watermarked photos (recommended for external sharing)"
                  >
                    Watermarked
                  </SegButton>
                  <SegButton
                    active={!useWatermarked}
                    onClick={() => !generating && setUseWatermarked(false)}
                    disabled={generating}
                    title="Original (un-watermarked) photos"
                  >
                    Original
                  </SegButton>
                </div>
                <div style={hintStyle}>
                  {useWatermarked
                    ? 'Photos will use the watermarked variant when one exists. Falls back to original otherwise.'
                    : 'Photos will use the original (un-watermarked) variant.'}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fca5a5',
                  borderRadius: 6, padding: '10px 12px', fontSize: 12.5,
                  color: '#991b1b', marginTop: 6, lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {!result && (
          <div style={footerStyle}>
            <button
              onClick={closeAfterDone}
              disabled={generating}
              style={{
                background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`,
                borderRadius: 6, padding: '8px 16px', fontSize: 13,
                cursor: generating ? 'wait' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || loading || !selectedPrtId}
              style={{
                background: generating ? '#86efac' : C.emerald, color: '#fff', border: 'none',
                borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 500,
                cursor: generating ? 'wait' : (loading || !selectedPrtId) ? 'not-allowed' : 'pointer',
                opacity: (loading || !selectedPrtId) ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {generating ? (
                <>
                  <Spinner /> Generating…
                </>
              ) : (
                <>
                  <Icon path="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" size={13} color="#fff" />
                  Generate Report
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Subcomponents
// ───────────────────────────────────────────────────────────────────────────

function SuccessPanel({ result, onClose }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8,
          background: '#ecfdf5', border: '1px solid #a7f3d0',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon path="M5 13l4 4L19 7" size={18} color={C.emerald} weight={2.5} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>Report generated</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            {result.page_count} pages • {(result.file_size_bytes / 1024).toFixed(0)} KB
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.55, marginBottom: 16 }}>
        Saved to this project's Documents area as <strong style={{ color: C.textPrimary }}>{result.template?.prt_record_number}</strong>.
        Use the Documents widget below to open or download it.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{
            background: C.emerald, color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}

function SegButton({ active, onClick, disabled, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        flex: 1,
        background: active ? C.emerald : C.card,
        color: active ? '#fff' : C.textSecondary,
        border: `1px solid ${active ? C.emerald : C.border}`,
        borderRadius: 6, padding: '8px 14px', fontSize: 12.5,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: active ? 500 : 400,
      }}
    >
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" style={{ animation: 'prr-spin 0.9s linear infinite' }}>
      <style>{`@keyframes prr-spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3" fill="none" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// ───────── shared styles ─────────
const labelStyle = {
  display: 'block', fontSize: 11.5, fontWeight: 600, color: C.textSecondary,
  textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6,
}
const selectStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13, color: C.textPrimary,
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
  cursor: 'pointer',
}
const hintStyle = {
  fontSize: 11.5, color: C.textMuted, marginTop: 6, lineHeight: 1.45,
}
