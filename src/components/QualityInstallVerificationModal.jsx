// QualityInstallVerificationModal — the create UI for a building-scoped
// Quality Install Verification work order, launched from the OPPORTUNITY
// detail page (it is part of the Final Project Payment Request verification).
//
// The work order itself, its sampled photo gate, its work plan/steps, and the
// Project-Coordinator ownership are all built server-side by
// `create_quality_install_verification_work_order(opportunity, building,
// project?)` (migration 20260730233827). This modal only:
//   1. lets the Project Coordinator pick which BUILDING to verify (scoped to
//      the opportunity's property via list_buildings_for_property);
//   2. surfaces the building's unit count so it's clear the required photo
//      count per step is sampled from it (the exact enforced number is shown
//      in LEAP Pad — the sampling lookup is server-only by design);
//   3. reveals an install-PROJECT picker only when the RPC can't resolve a
//      single project on its own (its own error message drives this);
//   4. on success, routes to the new work order.
//
// Styling mirrors ProjectSubmittalDocumentsModal so the two creation surfaces
// on the payment-application flow feel identical.
import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import { supabase } from '../lib/supabase'

// Substrings of the two RPC error messages that mean "the caller must name the
// install project" — kept as a match rather than an exact string so a wording
// tweak on the DB side doesn't silently break the project-picker reveal.
const PROJECT_NEEDED_HINTS = ['specify the install project', 'specify which install project']

export default function QualityInstallVerificationModal({ opportunityId, opportunity, onClose, onNavigateToRecord }) {
  const toast = useToast()
  const propertyId = opportunity?.property_id || null

  const [buildings, setBuildings] = useState(null) // null = loading, [] = none
  const [loadErr, setLoadErr] = useState(null)
  const [buildingId, setBuildingId] = useState('')
  const [unitCount, setUnitCount] = useState(null) // for the selected building
  const [unitCountLoading, setUnitCountLoading] = useState(false)

  const [needsProject, setNeedsProject] = useState(false)
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Load the property's buildings (scoped RPC, RLS-respecting).
  useEffect(() => {
    let alive = true
    if (!propertyId) { setBuildings([]); return }
    ;(async () => {
      const { data, error: e } = await supabase.rpc('list_buildings_for_property', {
        p_property_ids: [propertyId],
        p_include_building_id: null,
      })
      if (!alive) return
      if (e) { setLoadErr(e.message); setBuildings([]); return }
      setBuildings((data || []).map(r => ({ value: r.id, label: r.building_name || r.id.slice(0, 8) })))
    })()
    return () => { alive = false }
  }, [propertyId])

  // Show the chosen building's unit count — the basis for the sampled photo
  // requirement. Selecting a different building resets any project picker.
  useEffect(() => {
    setNeedsProject(false); setProjectId(''); setError(null)
    if (!buildingId) { setUnitCount(null); return }
    let alive = true
    setUnitCountLoading(true)
    ;(async () => {
      const { count, error: e } = await supabase
        .from('units')
        .select('id', { count: 'exact', head: true })
        .eq('building_id', buildingId)
        .not('unit_is_deleted', 'is', true)
      if (!alive) return
      setUnitCountLoading(false)
      setUnitCount(e ? null : (count ?? 0))
    })()
    return () => { alive = false }
  }, [buildingId])

  async function loadProjectsForOpportunity() {
    const { data, error: e } = await supabase
      .from('projects')
      .select('id, project_record_number, project_name, building_id')
      .eq('opportunity_id', opportunityId)
      .not('project_is_deleted', 'is', true)
      .order('project_record_number', { ascending: true })
    if (e) return []
    return (data || []).map(p => ({
      value: p.id,
      label: [p.project_record_number, p.project_name].filter(Boolean).join(' · ') || p.id.slice(0, 8),
    }))
  }

  async function handleCreate() {
    if (!buildingId || submitting) return
    setSubmitting(true); setError(null)
    const { data, error: e } = await supabase.rpc('create_quality_install_verification_work_order', {
      p_opportunity_id: opportunityId,
      p_building_id: buildingId,
      p_project_id: projectId || null,
    })
    const row = Array.isArray(data) ? data[0] : data
    if (e || !row || row.outcome !== 'success') {
      const msg = (e?.message) || row?.message || 'Could not create the work order.'
      // The RPC asks the caller to name the install project when it can't pick
      // one — reveal the project picker and load the options once.
      if (!needsProject && PROJECT_NEEDED_HINTS.some(h => msg.toLowerCase().includes(h))) {
        const opts = await loadProjectsForOpportunity()
        setProjects(opts)
        setNeedsProject(true)
      }
      setError(msg)
      setSubmitting(false)
      return
    }
    toast.success(row.message || 'Work order created')
    if (onNavigateToRecord) onNavigateToRecord({ table: 'work_orders', id: row.work_order_id, mode: 'view' })
    onClose?.()
  }

  const canSubmit = !!buildingId && (!needsProject || !!projectId) && !submitting

  return (
    <div style={overlay} onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose?.() }}>
      <div style={card}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={iconWrap}>
              <Icon path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" size={17} color="#2aab72" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>Create Quality Install Verification</div>
              <div style={{ fontSize: 11.5, color: C.textMuted }}>Building-scoped photo documentation for the final payment request</div>
            </div>
          </div>
          <button onClick={onClose} style={xBtn} aria-label="Close">
            <Icon path="M6 6l12 12M18 6L6 18" size={16} color={C.textSecondary} />
          </button>
        </div>

        <div style={bodyStyle}>
          <div style={reviewBox}>
            Creates a Quality Install Verification work order for the selected building, owned and verified by the
            Project Coordinator. Each photo step requires a number of photos <strong style={strongStyle}>sampled from the
            building's unit count</strong> (IRA Multifamily Quality Install Sampling Rate) — enforced automatically, and
            shown per step in LEAP Pad. Photos keep their original capture EXIF, GPS, and timestamp and are tagged to
            their step.
          </div>

          {loadErr && <div style={errorBox}>Couldn't load buildings: {loadErr}</div>}

          {!propertyId ? (
            <div style={errorBox}>This opportunity has no property, so its buildings can't be resolved. Set the opportunity's property first.</div>
          ) : buildings === null ? (
            <div style={hintStyle}>Loading buildings…</div>
          ) : buildings.length === 0 ? (
            <div style={errorBox}>This property has no buildings yet. Add the building on the property record, then create the verification.</div>
          ) : (
            <>
              <label style={labelStyle} htmlFor="qiv-building">Building to verify</label>
              <select
                id="qiv-building"
                style={inputStyle}
                value={buildingId}
                onChange={(ev) => setBuildingId(ev.target.value)}
              >
                <option value="">Select a building…</option>
                {buildings.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
              {buildingId && (
                <div style={hintStyle}>
                  {unitCountLoading ? 'Counting units…'
                    : unitCount === null ? 'Unit count unavailable.'
                    : unitCount === 0 ? 'This building has no units recorded — add units so the photo sample can be determined.'
                    : <>This building has <strong style={strongStyle}>{unitCount} unit{unitCount === 1 ? '' : 's'}</strong>; the required photos per step are sampled from that count.</>}
                </div>
              )}

              {needsProject && (
                <div style={{ marginTop: 16 }}>
                  <label style={labelStyle} htmlFor="qiv-project">Install project to verify</label>
                  {projects.length === 0 ? (
                    <div style={errorBox}>No project was found on this opportunity to verify. Create the install project first.</div>
                  ) : (
                    <select
                      id="qiv-project"
                      style={inputStyle}
                      value={projectId}
                      onChange={(ev) => { setProjectId(ev.target.value); setError(null) }}
                    >
                      <option value="">Select the install project…</option>
                      {projects.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  )}
                </div>
              )}
            </>
          )}

          {error && !loadErr && <div style={errorBox}>{error}</div>}
        </div>

        <div style={footerStyle}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button onClick={handleCreate} disabled={!canSubmit} style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {submitting ? 'Creating…' : 'Create Work Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────── styles (mirror ProjectSubmittalDocumentsModal) ─────────
const CARD_SECONDARY = '#f7f9fc'
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1100, padding: 16,
}
const card = {
  width: '100%', maxWidth: 560, maxHeight: '90vh', background: C.card,
  border: `1px solid ${C.border}`, borderRadius: 10,
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  overflow: 'hidden', display: 'flex', flexDirection: 'column',
}
const headerStyle = {
  padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
}
const iconWrap = {
  width: 32, height: 32, borderRadius: 6, background: '#ecfdf5',
  border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center',
  justifyContent: 'center', flexShrink: 0,
}
const xBtn = {
  border: 'none', background: 'transparent', cursor: 'pointer', padding: 4,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const bodyStyle = { padding: 20, overflowY: 'auto', minHeight: 0 }
const footerStyle = {
  padding: '12px 20px', borderTop: `1px solid ${C.border}`,
  display: 'flex', gap: 10, justifyContent: 'flex-end',
  background: C.page, flexShrink: 0,
}
const labelStyle = {
  display: 'block', fontSize: 11.5, fontWeight: 600, color: C.textSecondary,
  textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6,
}
const inputStyle = {
  width: '100%', padding: '7px 9px', fontSize: 12.5, color: C.textPrimary,
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
  boxSizing: 'border-box',
}
const hintStyle = { fontSize: 11.5, color: C.textMuted, marginTop: 6, lineHeight: 1.45 }
const strongStyle = { color: C.textPrimary }
const reviewBox = {
  background: CARD_SECONDARY, border: `1px solid ${C.border}`,
  borderRadius: 6, padding: '10px 14px', marginBottom: 16,
  fontSize: 12, color: C.textSecondary, lineHeight: 1.7,
}
const errorBox = {
  background: '#e8f1fb', border: '1px solid #bcd9f2',
  borderRadius: 6, padding: '10px 12px', fontSize: 12.5,
  color: '#1a5a8a', marginTop: 6, lineHeight: 1.5,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
}
const btnSecondary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  background: C.card, color: C.textSecondary,
  border: `1px solid ${C.border}`, borderRadius: 6,
}
const btnPrimary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
  background: '#3ecf8e', color: '#06281c',
  border: '1px solid #2aab72', borderRadius: 6,
}
