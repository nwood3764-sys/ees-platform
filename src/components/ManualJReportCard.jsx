// The Manual J card on an assessment: drop the Conduit Tech report, read every
// number off it, check them, save.
//
// Nicholas, 2026-09-05: "The user, probably the project coordinator, will drag
// it on top of this widget you're making, and then you'll scrape the
// information from it and then save the PDF to the assessment object."
//
// Nothing is written until a person has looked at what was read. That is not
// caution for its own sake — a Manual J prints several loads and the largest of
// them is frequently the wrong one to size to (see manualJDesignLoad.js), so
// the design load is a CHOICE the reviewer makes with the arithmetic in front
// of them, and the basis they chose on is stored beside the number.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../data/constants'
import { dragCarriesFiles, fileFromInputEvent } from '../lib/photoDrop.js'
import { missingNeepParameters, neepSearchParameters } from '../lib/manualJDesignLoad.js'
import {
  extractManualJFromPdf, fetchManualJContext, fetchManualJReports,
  fetchManualJReportDetail, saveManualJReport, deleteManualJReport,
} from '../data/manualJService'

// Declared at MODULE level, deliberately. A component declared inside a render
// is a new component type on every render, so React tears down and rebuilds its
// whole subtree — including hidden <input type=file> elements, whose `change`
// then fires at a node React is no longer listening to. That is the defect that
// silently broke work-step photo upload for eleven days (2026-09-02).
function CardShell({ title, children }) {
  return (
    <div style={S.shell}>
      <div style={S.shellHead}>
        <div style={S.shellTitle}>{title}</div>
      </div>
      <div style={S.shellBody}>{children}</div>
    </div>
  )
}

function Button({ children, onClick, disabled, variant = 'primary' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ ...S.btn, ...(variant === 'ghost' ? S.btnGhost : S.btnPrimary), ...(disabled ? S.btnOff : null) }}>
      {children}
    </button>
  )
}

const btu = n => (n == null || n === '' ? '—' : `${Math.round(Number(n)).toLocaleString('en-US')}`)
const num = n => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-US'))

const SCOPE_LABEL = {
  whole_home: 'Whole home',
  system: 'Proposed system',
  zone: 'Zone',
  room: 'Room',
  unassigned_room: 'Room — no system',
}

export default function ManualJReportCard({ recordId, title = 'Manual J Load Calculation' }) {
  const [reports, setReports] = useState([])
  const [context, setContext] = useState({})
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [review, setReview] = useState(null)   // { file, extraction, values }
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState({})
  const fileInput = useRef(null)

  const load = useCallback(async () => {
    if (!recordId) return
    setLoading(true)
    try {
      const [rows, ctx] = await Promise.all([
        fetchManualJReports(recordId),
        fetchManualJContext(recordId),
      ])
      setReports(rows)
      setContext(ctx)
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [recordId])

  useEffect(() => { load() }, [load])

  const handleFile = useCallback(async (file) => {
    if (!file) { setError('No file was selected.'); return }
    setError(null)
    setBusy('Reading the report…')
    try {
      const ctx = context && context.assessmentId ? context : await fetchManualJContext(recordId)
      const extraction = await extractManualJFromPdf(file, ctx)
      if (!extraction.report.blocks.length) {
        throw new Error(
          `No Manual J load tables were found in ${file.name}. ` +
          'Check that this is the Conduit Tech Manual J report and not another document.')
      }
      const chosen = extraction.chosen
      setReview({
        file,
        extraction,
        values: {
          designLoadBasisId: chosen ? chosen.id : null,
          designLoadBasis: chosen ? chosen.label : null,
          designHeatingLoadBtuh: chosen ? chosen.total.totalHeatingBtuh : '',
          designCoolingLoadBtuh: chosen ? chosen.total.totalCoolingBtuh : '',
          designSensibleCoolingBtuh: chosen ? chosen.total.sensibleCoolingBtuh : '',
          designLatentCoolingBtuh: chosen ? chosen.total.latentCoolingBtuh : '',
          buildingSquareFootage: extraction.neep.buildingSquareFootage ?? '',
          constructionYear: extraction.neep.homeConstructionYear ?? '',
          ductingConfiguration: extraction.neep.ductingConfiguration || '',
          notes: '',
        },
      })
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }, [context, recordId])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const files = e.dataTransfer && e.dataTransfer.files
    handleFile(files && files[0])
  }, [handleFile])

  const chooseCandidate = useCallback((candidate) => {
    setReview(prev => prev && ({
      ...prev,
      values: {
        ...prev.values,
        designLoadBasisId: candidate.id,
        designLoadBasis: candidate.label,
        designHeatingLoadBtuh: candidate.total.totalHeatingBtuh,
        designCoolingLoadBtuh: candidate.total.totalCoolingBtuh,
        designSensibleCoolingBtuh: candidate.total.sensibleCoolingBtuh,
        designLatentCoolingBtuh: candidate.total.latentCoolingBtuh,
        buildingSquareFootage: candidate.floorAreaSqFt ?? prev.values.buildingSquareFootage,
      },
    }))
  }, [])

  const setValue = useCallback((key, value) => {
    setReview(prev => prev && ({ ...prev, values: { ...prev.values, [key]: value } }))
  }, [])

  const missing = useMemo(() => {
    if (!review) return []
    const v = review.values
    return missingNeepParameters({
      ...neepSearchParameters(review.extraction.report, {
        constructionYear: v.constructionYear === '' ? null : Number(v.constructionYear),
        postalCode: context.postalCode,
      }),
      heatingDesignLoadBtuh: v.designHeatingLoadBtuh === '' ? null : Number(v.designHeatingLoadBtuh),
      coolingDesignLoadBtuh: v.designCoolingLoadBtuh === '' ? null : Number(v.designCoolingLoadBtuh),
      buildingSquareFootage: v.buildingSquareFootage === '' ? null : Number(v.buildingSquareFootage),
      homeConstructionYear: v.constructionYear === '' ? null : Number(v.constructionYear),
    })
  }, [review, context.postalCode])

  const save = useCallback(async () => {
    if (!review) return
    setBusy('Saving…')
    setError(null)
    try {
      await saveManualJReport({
        assessmentId: recordId,
        file: review.file,
        extraction: review.extraction,
        values: review.values,
      })
      setReview(null)
      await load()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }, [review, recordId, load])

  const toggleDetail = useCallback(async (reportId) => {
    if (expanded === reportId) { setExpanded(null); return }
    setExpanded(reportId)
    if (!detail[reportId]) {
      try {
        const d = await fetchManualJReportDetail(reportId)
        setDetail(prev => ({ ...prev, [reportId]: d }))
      } catch (e) {
        setError(e.message || String(e))
      }
    }
  }, [expanded, detail])

  const remove = useCallback(async (reportId) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Remove this Manual J from the assessment? It is kept in the recycle bin.')) return
    try {
      await deleteManualJReport(reportId)
      await load()
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [load])

  return (
    <CardShell title={title}>
      {error && (
        <div style={S.error}>{error}</div>
      )}

      {!review && (
        <div
          onDragOver={e => { if (dragCarriesFiles(e.dataTransfer)) { e.preventDefault(); setDragging(true) } }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{ ...S.drop, ...(dragging ? S.dropActive : null) }}
        >
          <div style={S.dropTitle}>
            {busy || 'Drop the Conduit Tech Manual J report here'}
          </div>
          <div style={S.dropHint}>
            LEAP reads the design conditions, every load table and the building
            assemblies off the PDF, then shows you what it found before anything is saved.
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: 'none' }}
            onChange={e => handleFile(fileFromInputEvent(e))}
          />
          <Button onClick={() => fileInput.current && fileInput.current.click()} disabled={!!busy}>
            Choose a PDF
          </Button>
        </div>
      )}

      {review && (
        <ReviewPanel
          review={review}
          context={context}
          missing={missing}
          busy={busy}
          onChooseCandidate={chooseCandidate}
          onSetValue={setValue}
          onCancel={() => { setReview(null); setError(null) }}
          onSave={save}
        />
      )}

      {!review && (
        <div style={{ marginTop: 14 }}>
          {loading && <div style={S.muted}>Loading…</div>}
          {!loading && reports.length === 0 && (
            <div style={S.muted}>No Manual J load calculation has been filed on this assessment yet.</div>
          )}
          {reports.map(r => (
            <SavedReport
              key={r.id}
              report={r}
              expanded={expanded === r.id}
              detail={detail[r.id]}
              onToggle={() => toggleDetail(r.id)}
              onRemove={() => remove(r.id)}
            />
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ─── Review ─────────────────────────────────────────────────────────────────

function ReviewPanel({ review, context, missing, busy, onChooseCandidate, onSetValue, onCancel, onSave }) {
  const { extraction, values, file } = review
  const r = extraction.report
  const dc = r.designConditions

  return (
    <div>
      <div style={S.reviewHead}>
        <div>
          <div style={S.h2}>{r.subject.name || file.name}</div>
          <div style={S.muted}>
            {r.subject.address ? r.subject.address.raw : 'No address on the report'}
            {' · '}{r.source.software}
            {r.source.manualJVersion ? ` · Manual J ${r.source.manualJVersion}` : ''}
            {extraction.pageCount ? ` · ${extraction.pageCount} pages` : ''}
          </div>
        </div>
        <div style={S.pill}>Nothing is saved yet</div>
      </div>

      {extraction.notices.map((n, i) => (
        <div key={i} style={n.severity === 'important' ? S.noticeImportant : S.notice}>
          {n.message}
        </div>
      ))}

      <div style={S.h3}>Which load is this building sized to?</div>
      <div style={S.muted}>
        A Manual J prints several. Pick the one the equipment must carry — the basis is
        saved with the number so nobody has to re-derive it later.
      </div>
      <div style={{ marginTop: 8 }}>
        {extraction.candidates.map(c => (
          <label
            key={c.id}
            style={{ ...S.candidate, ...(values.designLoadBasisId === c.id ? S.candidateOn : null) }}
          >
            <input
              type="radio"
              name="manual-j-basis"
              checked={values.designLoadBasisId === c.id}
              onChange={() => onChooseCandidate(c)}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1 }}>
              <div style={S.candidateHead}>
                <span style={{ fontWeight: 600 }}>{c.label}</span>
                {c.recommended && <span style={S.badgeGood}>Recommended</span>}
                {c.overstated && <span style={S.badgeWarn}>Counts shared rooms twice</span>}
              </div>
              <div style={S.mono}>
                {btu(c.total.totalHeatingBtuh)} Btu/h heating · {btu(c.total.totalCoolingBtuh)} Btu/h cooling
              </div>
              <div style={S.muted}>{c.basis}</div>
            </div>
          </label>
        ))}
      </div>

      <div style={S.h3}>What LEAP read from the report</div>
      <div style={S.grid}>
        <Fact label="Weather station" value={dc.weatherStation} />
        <Fact label="Winter design temperature" value={dc.heating ? `${dc.heating.outdoorDryBulbF}°F outdoor / ${dc.heating.indoorDryBulbF}°F indoor` : null} />
        <Fact label="Summer design temperature" value={dc.cooling ? `${dc.cooling.outdoorDryBulbF}°F outdoor / ${dc.cooling.indoorDryBulbF}°F indoor` : null} />
        <Fact label="Elevation" value={dc.elevationFt != null ? `${num(dc.elevationFt)} ft` : null} />
        <Fact label="Altitude correction" value={dc.altitudeCorrectionFactor} />
        <Fact label="Load tables read" value={`${r.blocks.length} across ${new Set(r.blocks.map(b => b.scope)).size} levels`} />
        <Fact label="Building assemblies" value={`${r.materials.length}`} />
        <Fact label="Report dated" value={r.source.createdAt} />
      </div>

      <div style={S.h3}>The equipment search these numbers fill in</div>
      <div style={S.muted}>
        These are the fields the NEEP Cold Climate Air Source Heat Pump List asks for.
        Everything but the construction year comes off the report.
      </div>
      <div style={S.grid}>
        <Field label="Heating design load (Btu/h)" value={values.designHeatingLoadBtuh}
               onChange={v => onSetValue('designHeatingLoadBtuh', v)} />
        <Field label="Cooling design load (Btu/h)" value={values.designCoolingLoadBtuh}
               onChange={v => onSetValue('designCoolingLoadBtuh', v)} />
        <Field label="Building square footage" value={values.buildingSquareFootage}
               onChange={v => onSetValue('buildingSquareFootage', v)} />
        <Field
          label="Home construction year"
          value={values.constructionYear}
          onChange={v => onSetValue('constructionYear', v)}
          hint={context.constructionYearSource
            ? `From ${context.constructionYearSource}`
            : 'Not on the Manual J and not on this building in LEAP — type it in.'}
          highlight={values.constructionYear === '' || values.constructionYear == null}
        />
        <Fact label="ZIP code" value={(r.subject.address && r.subject.address.postalCode) || context.postalCode} />
        <Field label="Ducting configuration" value={values.ductingConfiguration}
               onChange={v => onSetValue('ductingConfiguration', v)} />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={S.label}>Notes</div>
        <textarea
          value={values.notes}
          onChange={e => onSetValue('notes', e.target.value)}
          rows={2}
          placeholder="Anything a reviewer should know about this load calculation"
          style={S.textarea}
        />
      </div>

      {missing.length > 0 && (
        <div style={S.notice}>
          Still needed for equipment selection: {missing.join(', ')}. You can save without
          them — the load calculation is still worth having — and fill them in later.
        </div>
      )}

      <div style={S.actions}>
        <Button onClick={onSave} disabled={!!busy}>{busy || 'Save to this assessment'}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={!!busy}>Cancel</Button>
        <span style={S.muted}>The PDF is filed on the assessment as the evidence for these numbers.</span>
      </div>
    </div>
  )
}

// ─── Saved ──────────────────────────────────────────────────────────────────

function SavedReport({ report, expanded, detail, onToggle, onRemove }) {
  return (
    <div style={S.saved}>
      <div style={S.savedHead}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.savedTitle}>
            <span style={S.recordNumber}>{report.mjr_record_number}</span>
            {report.mjr_subject_name || report.mjr_name}
          </div>
          <div style={S.mono}>
            {btu(report.mjr_design_heating_load_btuh)} Btu/h heating
            {' · '}{btu(report.mjr_design_cooling_load_btuh)} Btu/h cooling
            {report.mjr_conditioned_floor_area_sq_ft ? ` · ${num(report.mjr_conditioned_floor_area_sq_ft)} ft²` : ''}
          </div>
          <div style={S.muted}>
            {report.mjr_design_load_basis ? `Basis: ${report.mjr_design_load_basis}. ` : ''}
            {report.mjr_weather_station || 'No weather station'}
            {report.mjr_heating_outdoor_db_f != null ? ` · ${report.mjr_heating_outdoor_db_f}°F winter design` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <Button variant="ghost" onClick={onToggle}>{expanded ? 'Hide' : 'Details'}</Button>
          <Button variant="ghost" onClick={onRemove}>Remove</Button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10 }}>
          {!detail && <div style={S.muted}>Loading…</div>}
          {detail && (
            <>
              <div style={S.label}>Load tables</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Scope</th>
                      <th style={S.th}>Name</th>
                      <th style={S.thNum}>Heating Btu/h</th>
                      <th style={S.thNum}>Cooling Btu/h</th>
                      <th style={S.thNum}>Area ft²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.blocks.map(b => (
                      <tr key={b.id}>
                        <td style={S.td}>{SCOPE_LABEL[b.mjl_scope] || b.mjl_scope}</td>
                        <td style={S.td}>
                          {b.mjl_block_name}
                          {b.mjl_story ? <span style={S.muted}> · {b.mjl_story}</span> : null}
                        </td>
                        <td style={S.tdNum}>{btu(b.mjl_total_heating_btuh)}</td>
                        <td style={S.tdNum}>{btu(b.mjl_total_cooling_btuh)}</td>
                        <td style={S.tdNum}>{num(b.mjl_floor_area_sq_ft)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detail.materials.length > 0 && (
                <>
                  <div style={{ ...S.label, marginTop: 12 }}>Building assemblies</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          <th style={S.th}>Construction</th>
                          <th style={S.th}>Number</th>
                          <th style={S.th}>Facing</th>
                          <th style={S.thNum}>Area ft²</th>
                          <th style={S.thNum}>U-value</th>
                          <th style={S.th}>Assembly</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.materials.map(m => (
                          <tr key={m.id} style={m.mjm_is_total_row ? { color: C.textMuted } : null}>
                            <td style={S.td}>
                              {m.mjm_construction_type}
                              {m.mjm_is_total_row ? <span style={S.muted}> (total)</span> : null}
                            </td>
                            <td style={S.tdMono}>{m.mjm_construction_number || '—'}</td>
                            <td style={S.td}>{m.mjm_orientation || '—'}</td>
                            <td style={S.tdNum}>{num(m.mjm_area_sq_ft)}</td>
                            <td style={S.tdNum}>{m.mjm_u_value == null ? '—' : m.mjm_u_value}</td>
                            <td style={S.td}>{m.mjm_description || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <div style={S.label}>{label}</div>
      <div style={S.factValue}>{value == null || value === '' ? '—' : String(value)}</div>
    </div>
  )
}

function Field({ label, value, onChange, hint, highlight }) {
  return (
    <div>
      <div style={S.label}>{label}</div>
      <input
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        style={{ ...S.input, ...(highlight ? { borderColor: C.sky, background: C.cardSecondary } : null) }}
      />
      {hint && <div style={S.muted}>{hint}</div>}
    </div>
  )
}

const S = {
  shell: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12, overflow: 'hidden' },
  shellHead: {
    padding: '14px 18px', borderBottom: `1px solid ${C.border}`, background: '#fafbfd',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  shellTitle: { fontSize: 13.5, fontWeight: 600, color: C.textPrimary },
  shellBody: { padding: '14px 18px' },
  btn: { borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' },
  btnPrimary: { background: C.emerald, color: '#fff', border: 'none' },
  btnGhost: { background: C.page, color: C.textSecondary, border: `1px solid ${C.border}` },
  btnOff: { opacity: 0.6, cursor: 'wait' },
  drop: {
    border: `1px dashed ${C.borderDark}`, borderRadius: 8, padding: '22px 16px',
    textAlign: 'center', background: C.cardSecondary, transition: 'all 200ms ease',
  },
  dropActive: { borderColor: C.emerald, background: '#f2fbf7' },
  dropTitle: { fontWeight: 600, color: C.textPrimary, marginBottom: 4 },
  dropHint: { fontSize: 12, color: C.textSecondary, maxWidth: 560, margin: '0 auto 12px' },
  reviewHead: { display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  h2: { fontSize: 15, fontWeight: 600, color: C.textPrimary },
  h3: { fontSize: 13, fontWeight: 600, color: C.textPrimary, marginTop: 16, marginBottom: 2 },
  pill: {
    fontSize: 11, color: C.navy, background: C.cardSecondary, border: `1px solid ${C.border}`,
    borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap',
  },
  notice: {
    fontSize: 12, color: C.textSecondary, background: C.cardSecondary,
    border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.sky}`,
    borderRadius: 6, padding: '8px 10px', marginBottom: 6,
  },
  noticeImportant: {
    fontSize: 12, color: C.textPrimary, background: '#f4f8fd',
    border: `1px solid ${C.borderDark}`, borderLeft: `3px solid ${C.navy}`,
    borderRadius: 6, padding: '8px 10px', marginBottom: 6, fontWeight: 500,
  },
  error: {
    fontSize: 12, color: C.navy, background: '#f4f8fd', border: `1px solid ${C.sky}`,
    borderRadius: 6, padding: '8px 10px', marginBottom: 10,
  },
  candidate: {
    display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px',
    border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 6, cursor: 'pointer',
    background: C.card,
  },
  candidateOn: { borderColor: C.emerald, background: '#f7fdfa' },
  candidateHead: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  badgeGood: {
    fontSize: 10, fontWeight: 600, color: C.emeraldMid, background: '#eafaf3',
    border: `1px solid ${C.emerald}`, borderRadius: 999, padding: '1px 7px',
  },
  badgeWarn: {
    fontSize: 10, fontWeight: 600, color: C.navy, background: '#eef4fb',
    border: `1px solid ${C.sky}`, borderRadius: 999, padding: '1px 7px',
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 10, marginTop: 8,
  },
  label: { fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 2 },
  factValue: { fontSize: 13, color: C.textPrimary },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 13,
    border: `1px solid ${C.border}`, borderRadius: 6, background: C.card, color: C.textPrimary,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  },
  textarea: {
    width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 13,
    border: `1px solid ${C.border}`, borderRadius: 6, background: C.card, color: C.textPrimary,
    resize: 'vertical',
  },
  actions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 },
  muted: { fontSize: 12, color: C.textMuted },
  mono: { fontSize: 12, color: C.textSecondary, fontFamily: 'JetBrains Mono, ui-monospace, monospace' },
  saved: { border: `1px solid ${C.border}`, borderRadius: 8, padding: 11, marginBottom: 8, background: C.card },
  savedHead: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  savedTitle: { fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 2 },
  recordNumber: {
    fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11,
    color: C.textMuted, marginRight: 8,
  },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 },
  th: {
    textAlign: 'left', padding: '6px 8px', color: C.textMuted, fontWeight: 600,
    borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', background: C.cardSecondary,
  },
  thNum: {
    textAlign: 'right', padding: '6px 8px', color: C.textMuted, fontWeight: 600,
    borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', background: C.cardSecondary,
  },
  td: { padding: '5px 8px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary },
  tdNum: {
    padding: '5px 8px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary,
    textAlign: 'right', fontFamily: 'JetBrains Mono, ui-monospace, monospace', whiteSpace: 'nowrap',
  },
  tdMono: {
    padding: '5px 8px', borderBottom: `1px solid ${C.border}`, color: C.textSecondary,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace', whiteSpace: 'nowrap',
  },
}
