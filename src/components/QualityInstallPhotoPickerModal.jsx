// QualityInstallPhotoPickerModal — the QI Tool. Launched from the WI-IRA-MF-HOMES
// Final Project Payment Request incentive application. Pulls every evidence photo
// already captured on any work order under the incentive application's opportunity,
// lets the Project Coordinator filter/search/select and drop photos into categories,
// then exports a ZIP + PDF. The PDF is saved as a `qi_tool_pdf` document on the
// incentive application (the "QI Tool pdf" gallery); both files also download.
import { useEffect, useMemo, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import { uploadDocument } from '../data/storageService'
import { loadOpportunityEvidencePhotos, buildPhotoPackage, triggerBlobDownload } from '../data/qualityInstallPhotoPackage'

function recordNumberOf(rec) {
  if (!rec) return null
  return rec.incentive_application_record_number || rec.ia_record_number ||
    (Object.entries(rec).find(([k]) => k.endsWith('record_number')) || [])[1] || null
}

export default function QualityInstallPhotoPickerModal({ incentiveApplicationId, incentiveApplication, onClose }) {
  const toast = useToast()
  const opportunityId = incentiveApplication?.opportunity_id || null

  const [data, setData] = useState(null)      // { photos, workTypes, opportunityName, propertyName }
  const [loadErr, setLoadErr] = useState(null)
  const [workType, setWorkType] = useState('all')
  const [q, setQ] = useState('')
  const [view, setView] = useState('all')      // all | unassigned | assigned
  const [selected, setSelected] = useState(() => new Set())
  const [assignment, setAssignment] = useState({}) // photo_id -> category
  const [categoryInput, setCategoryInput] = useState('')

  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)
  const [genErr, setGenErr] = useState(null)

  useEffect(() => {
    let alive = true
    if (!opportunityId) { setData({ photos: [], workTypes: [] }); return }
    ;(async () => {
      try {
        const d = await loadOpportunityEvidencePhotos(opportunityId)
        if (alive) setData(d)
      } catch (e) { if (alive) setLoadErr(e.message || String(e)) }
    })()
    return () => { alive = false }
  }, [opportunityId])

  const photos = data?.photos || []
  const assignedCount = Object.keys(assignment).length

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return photos.filter(p => {
      if (workType !== 'all' && p.work_type_name !== workType) return false
      if (view === 'assigned' && !assignment[p.photo_id]) return false
      if (view === 'unassigned' && assignment[p.photo_id]) return false
      if (needle) {
        const hay = `${p.work_order_record_number || ''} ${p.work_type_name || ''} ${p.work_step_name || ''} ${p.caption || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [photos, workType, q, view, assignment])

  const assembledGroups = useMemo(() => {
    const byCat = new Map()
    for (const p of photos) {
      const cat = assignment[p.photo_id]
      if (!cat) continue
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat).push(p)
    }
    return Array.from(byCat.entries()).map(([category, ps]) => ({ category, photos: ps }))
  }, [photos, assignment])

  const categorySuggestions = useMemo(() => {
    const s = new Set()
    ;(data?.workTypes || []).forEach(w => s.add(w))
    photos.forEach(p => { if (p.work_step_category) s.add(p.work_step_category) })
    Object.values(assignment).forEach(c => s.add(c))
    return Array.from(s).sort()
  }, [data, photos, assignment])

  function toggle(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAllFiltered() { setSelected(new Set(filtered.map(p => p.photo_id))) }
  function clearSelection() { setSelected(new Set()) }

  function assignSelected() {
    const cat = categoryInput.trim()
    if (!cat || selected.size === 0) return
    setAssignment(prev => { const n = { ...prev }; selected.forEach(id => { n[id] = cat }); return n })
    setSelected(new Set())
  }
  function unassign(id) { setAssignment(prev => { const n = { ...prev }; delete n[id]; return n }) }
  function removeCategory(cat) {
    setAssignment(prev => {
      const n = {}; for (const [id, c] of Object.entries(prev)) if (c !== cat) n[id] = c; return n
    })
  }

  async function handleGenerate() {
    if (assembledGroups.length === 0 || generating) return
    setGenerating(true); setGenErr(null); setProgress({ done: 0, total: assignedCount })
    try {
      const rn = recordNumberOf(incentiveApplication)
      const suffix = [data?.propertyName, rn].filter(Boolean).join(' - ')
      const lines = [
        data?.propertyName && `Property: ${data.propertyName}`,
        data?.opportunityName && `Opportunity: ${data.opportunityName}`,
        rn && `Incentive Application: ${rn}`,
      ].filter(Boolean)
      const { zipBlob, pdfBlob, baseName } = await buildPhotoPackage(
        { groups: assembledGroups, meta: { lines, baseSuffix: suffix } },
        { onProgress: (done, total) => setProgress({ done, total }) },
      )
      const zipName = `${baseName}.zip`, pdfName = `${baseName}.pdf`
      triggerBlobDownload(pdfBlob, pdfName)
      triggerBlobDownload(zipBlob, zipName)

      const attached = []
      const uploads = [
        { file: new File([pdfBlob], pdfName, { type: 'application/pdf' }), name: pdfName, documentType: 'qi_tool_pdf' },
        { file: new File([zipBlob], zipName, { type: 'application/zip' }), name: zipName, documentType: 'qi_tool_photos_zip' },
      ]
      for (const u of uploads) {
        try {
          await uploadDocument({ file: u.file, relatedObject: 'incentive_applications', relatedId: incentiveApplicationId, name: u.name, documentType: u.documentType })
          attached.push(u.name)
        } catch (e) { setGenErr(`Downloaded, but attaching "${u.name}" failed: ${e.message || e}`) }
      }
      setResult({ pdfName, zipName, attached })
      toast.success('QI Tool package generated')
    } catch (e) {
      setGenErr(e.message || String(e))
    } finally {
      setGenerating(false)
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div style={overlay} onMouseDown={(ev) => { if (ev.target === ev.currentTarget && !generating) onClose?.() }}>
      <div style={card}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={iconWrap}><Icon path="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16v12H4z" size={17} color="#2aab72" /></div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>Quality Install Tool — Photo Package</div>
              <div style={{ fontSize: 11.5, color: C.textMuted }}>Select photos from the opportunity's work orders, categorize, and export ZIP + PDF</div>
            </div>
          </div>
          <button onClick={onClose} disabled={generating} style={{ ...xBtn, opacity: generating ? 0.4 : 1 }} aria-label="Close">
            <Icon path="M6 6l12 12M18 6L6 18" size={16} color={C.textSecondary} />
          </button>
        </div>

        <div style={bodyStyle}>
          {!opportunityId ? (
            <div style={errorBox}>This incentive application isn't linked to an opportunity, so its work-order photos can't be found. Set the opportunity first.</div>
          ) : loadErr ? (
            <div style={errorBox}>{loadErr}</div>
          ) : !data ? (
            <div style={hintStyle}>Loading photos from the opportunity's work orders…</div>
          ) : photos.length === 0 ? (
            <div style={errorBox}>No evidence photos were found on any work order under this opportunity yet.</div>
          ) : result ? (
            <div style={{ ...banner, background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>QI Tool package generated</div>
              <div>Downloaded: {result.pdfName}</div>
              <div>Downloaded: {result.zipName}</div>
              {result.attached.length > 0 && <div style={{ marginTop: 4 }}>Saved to this record: {result.attached.length} file{result.attached.length === 1 ? '' : 's'} (the PDF appears in the “QI Tool pdf” section).</div>}
            </div>
          ) : (
            <>
              {/* Filters */}
              <div style={filterBar}>
                <select value={workType} onChange={e => setWorkType(e.target.value)} style={selectStyle}>
                  <option value="all">All work types ({photos.length})</option>
                  {(data.workTypes || []).map(w => <option key={w} value={w}>{w}</option>)}
                </select>
                <input placeholder="Search work order, step, caption…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                <div style={segWrap}>
                  {['all', 'unassigned', 'assigned'].map(v => (
                    <button key={v} onClick={() => setView(v)} style={{ ...segBtn, ...(view === v ? segBtnActive : {}) }}>
                      {v === 'all' ? 'All' : v === 'unassigned' ? 'Unassigned' : `Assigned (${assignedCount})`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assembled category chips */}
              {assembledGroups.length > 0 && (
                <div style={chipRow}>
                  <span style={{ fontSize: 11, color: C.textMuted, marginRight: 4 }}>Categories:</span>
                  {assembledGroups.map(g => (
                    <span key={g.category} style={chip}>
                      {g.category} · {g.photos.length}
                      <button onClick={() => removeCategory(g.category)} style={chipX} aria-label={`Remove ${g.category}`}>×</button>
                    </span>
                  ))}
                </div>
              )}

              {/* Grid */}
              <div style={gridWrap}>
                {filtered.length === 0 ? (
                  <div style={hintStyle}>No photos match these filters.</div>
                ) : (
                  <div style={grid}>
                    {filtered.map(p => {
                      const isSel = selected.has(p.photo_id)
                      const cat = assignment[p.photo_id]
                      return (
                        <div key={p.photo_id} style={{ ...tile, outline: isSel ? '2px solid #3ecf8e' : cat ? '2px solid #7eb3e8' : `1px solid ${C.border}` }}
                             onClick={() => toggle(p.photo_id)}>
                          <div style={thumbBox}>
                            {p._thumbUrl
                              ? <img src={p._thumbUrl} loading="lazy" decoding="async" alt="" style={thumbImg} />
                              : <div style={{ ...thumbImg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted, fontSize: 10 }}>no image</div>}
                            <div style={{ ...checkDot, ...(isSel ? checkDotOn : {}) }}>{isSel ? '✓' : ''}</div>
                            {typeof p.latitude === 'number' && <div style={gpsDot} title="Has GPS" />}
                            {cat && <div style={catChip} title={cat}>{cat}</div>}
                          </div>
                          <div style={tileMeta}>
                            <div style={tileWo}>{p.work_order_record_number || '—'}</div>
                            <div style={tileStep}>{p.work_step_name || p.work_type_name || ''}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Selection / assign toolbar + footer */}
        {data && photos.length > 0 && !result && (
          <div style={toolbar}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: C.textSecondary, minWidth: 78 }}>{selected.size} selected</span>
              <button onClick={selectAllFiltered} style={miniBtn}>Select all ({filtered.length})</button>
              <button onClick={clearSelection} style={miniBtn} disabled={selected.size === 0}>Clear</button>
              <input list="qi-cats" placeholder="Category…" value={categoryInput} onChange={e => setCategoryInput(e.target.value)} style={{ ...inputStyle, width: 190 }} />
              <datalist id="qi-cats">{categorySuggestions.map(c => <option key={c} value={c} />)}</datalist>
              <button onClick={assignSelected} disabled={!categoryInput.trim() || selected.size === 0} style={{ ...btnSky, opacity: (!categoryInput.trim() || selected.size === 0) ? 0.5 : 1 }}>
                Add {selected.size || ''} to category
              </button>
            </div>
            {generating && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 4 }}>Building package — photo {progress.done} of {progress.total}…</div>
                <div style={progressTrack}><div style={{ ...progressFill, width: `${pct}%` }} /></div>
              </div>
            )}
            {genErr && <div style={errorBox}>{genErr}</div>}
          </div>
        )}

        <div style={footerStyle}>
          <div style={{ fontSize: 11.5, color: C.textMuted }}>
            {assignedCount > 0 && !result ? `${assignedCount} photo${assignedCount === 1 ? '' : 's'} in ${assembledGroups.length} categor${assembledGroups.length === 1 ? 'y' : 'ies'}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} disabled={generating} style={{ ...btnSecondary, opacity: generating ? 0.5 : 1 }}>{result ? 'Close' : 'Cancel'}</button>
            {!result && (
              <button onClick={handleGenerate} disabled={assignedCount === 0 || generating}
                      style={{ ...btnPrimary, opacity: (assignedCount === 0 || generating) ? 0.5 : 1, cursor: (assignedCount === 0 || generating) ? 'not-allowed' : 'pointer' }}>
                {generating ? 'Generating…' : 'Generate ZIP + PDF'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ───────── styles ─────────
const CARD_SECONDARY = '#f7f9fc'
const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }
const card = { width: '100%', maxWidth: 1000, height: '90vh', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
const headerStyle = { padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }
const iconWrap = { width: 32, height: 32, borderRadius: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const xBtn = { border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, display: 'flex' }
const bodyStyle = { padding: 16, overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
const footerStyle = { padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', background: C.page, flexShrink: 0 }
const hintStyle = { fontSize: 11.5, color: C.textMuted, marginTop: 6, lineHeight: 1.45 }
const banner = { border: `1px solid ${C.border}`, borderRadius: 6, padding: '12px 14px', fontSize: 12.5, lineHeight: 1.6 }
const errorBox = { background: '#e8f1fb', border: '1px solid #bcd9f2', borderRadius: 6, padding: '10px 12px', fontSize: 12.5, color: '#1a5a8a', marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' }
const filterBar = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }
const selectStyle = { padding: '7px 9px', fontSize: 12.5, color: C.textPrimary, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6 }
const inputStyle = { padding: '7px 9px', fontSize: 12.5, color: C.textPrimary, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box' }
const segWrap = { display: 'flex', border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }
const segBtn = { padding: '6px 10px', fontSize: 11.5, background: C.card, color: C.textSecondary, border: 'none', borderLeft: `1px solid ${C.border}`, cursor: 'pointer' }
const segBtnActive = { background: '#eef6ff', color: '#1a5a8a', fontWeight: 600 }
const chipRow = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }
const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, background: '#eef6ff', color: '#1a5a8a', border: '1px solid #bcd9f2', borderRadius: 12, padding: '2px 8px' }
const chipX = { border: 'none', background: 'transparent', color: '#1a5a8a', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }
const gridWrap = { flex: 1, minHeight: 0 }
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }
const tile = { borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: CARD_SECONDARY }
const thumbBox = { position: 'relative', width: '100%', aspectRatio: '4 / 3', background: '#dfe6f0' }
const thumbImg = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
const checkDot = { position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.85)', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#06281c', fontWeight: 700 }
const checkDotOn = { background: '#3ecf8e', borderColor: '#2aab72', color: '#06281c' }
const gpsDot = { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: '50%', background: '#3ecf8e', border: '1px solid #fff' }
const catChip = { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(126,179,232,0.92)', color: '#06283f', fontSize: 9.5, fontWeight: 600, padding: '2px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const tileMeta = { padding: '5px 7px' }
const tileWo = { fontSize: 10.5, fontWeight: 700, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }
const tileStep = { fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const toolbar = { padding: '10px 16px', borderTop: `1px solid ${C.border}`, background: CARD_SECONDARY, flexShrink: 0 }
const miniBtn = { padding: '5px 9px', fontSize: 11, background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer' }
const progressTrack = { height: 8, background: '#e4e9f2', borderRadius: 4, overflow: 'hidden' }
const progressFill = { height: '100%', background: '#3ecf8e', transition: 'width 150ms ease' }
const btnSky = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: '#7eb3e8', color: '#06283f', border: '1px solid #5b93cc', borderRadius: 6, cursor: 'pointer' }
const btnSecondary = { padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6 }
const btnPrimary = { padding: '7px 14px', fontSize: 12.5, fontWeight: 600, background: '#3ecf8e', color: '#06281c', border: '1px solid #2aab72', borderRadius: 6 }
