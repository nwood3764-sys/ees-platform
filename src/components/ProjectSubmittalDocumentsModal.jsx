// ---------------------------------------------------------------------------
// ProjectSubmittalDocumentsModal — generates the documents for ONE program
// submittal on a project.
//
// EES files a separate submittal to each program at each stage of that
// program's incentive application, and the stages are often months apart:
//
//   Stage 3  Income Qualification Application  (generated on the ENROLLMENT
//            record via Run Income Qualification — not here)
//   Stage 6  Project Reservation               ← this modal
//   Stage 11 Final Project Payment Request     ← this modal
//
// A property commonly runs several programs at once, and each carries its own
// full set of stages — WI-IRA-MF-HOMES and WI-IRA-MF-HOMES-AUDIT are separate
// programs, not steps of one another. The caller passes which stage this is;
// the user picks which program; the (program, stage) pair resolves to exactly
// that submittal's document set via src/data/paperworkSubmittals.js.
//
// See docs/leap-project-paperwork-port.md and docs/leap-project-lifecycle.md.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import {
  loadPaperworkContext, parseAssetScorePdf, buildPaperworkWorkbook, downloadBlob,
} from '../data/paperworkService'
import { buildPaperworkModel, buildEesPdf, buildSealedPdf, formatMoney } from '../data/paperworkModel'
import {
  SUBMITTAL_STAGE_DEFINITIONS, DOCUMENTS,
  documentDefinitionsForSubmittal, programsWithDocumentsForStage, PROGRAM_SUBMITTALS,
} from '../data/paperworkSubmittals'

const FIELD_GROUPS = [
  { title: 'Bill To (Property Owner)', fields: [
    ['ownerName', 'Owner / Company Name'],
    ['ownerAddress', 'Owner Street Address'],
    ['ownerCityStateZip', 'Owner City, State ZIP'],
    ['contactName', 'Contact Name'],
    ['contactEmail', 'Contact Email'],
    ['contactPhone', 'Contact Phone'],
  ] },
  { title: 'Property / Installation', fields: [
    ['propertyName', 'Property Name'],
    ['installationAddress', 'Installation Street Address'],
    ['installationCityStateZip', 'Installation City, State ZIP'],
    ['iqNumber', 'IQ Number'],
  ] },
  { title: 'Submittal Details', fields: [
    ['invoiceNumber', 'Audit Invoice No.'],
    ['projectInvoiceNumber', 'Project Invoice No.'],
    ['invoiceDate', 'Document Date'],
    ['estimatedStartDate', 'Estimated Start Date'],
    ['estimatedEndDate', 'Estimated Completion Date'],
    ['startDate', 'Actual Start Date'],
    ['endDate', 'Actual Completion Date'],
  ] },
]

export default function ProjectSubmittalDocumentsModal({ projectId, project, submittalStage, onClose }) {
  const toast = useToast()
  const stage = SUBMITTAL_STAGE_DEFINITIONS[submittalStage]
  const eligiblePrograms = useMemo(
    () => programsWithDocumentsForStage(submittalStage), [submittalStage])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [fields, setFields] = useState(null)
  const [units, setUnits] = useState('')
  const [programKey, setProgramKey] = useState(eligiblePrograms[0]?.key || '')
  const [reports, setReports] = useState({ base: null, imp: null })
  const [reportNames, setReportNames] = useState({ base: '', imp: '' })
  const [parsing, setParsing] = useState({ base: false, imp: false })
  const [includeAttic, setIncludeAttic] = useState(null)
  const [busyDoc, setBusyDoc] = useState(null)
  const [genError, setGenError] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadPaperworkContext(projectId)
      .then(ctx => {
        if (cancelled) return
        setFields(ctx.fields)
        setUnits(ctx.units != null ? String(ctx.units) : '')
      })
      .catch(e => { if (!cancelled) setLoadError(e.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  const unitsNum = parseInt(units, 10) || null
  const model = useMemo(() => {
    if (!fields) return null
    return buildPaperworkModel({
      units: unitsNum,
      assetScoreBase: reports.base,
      assetScoreImp: reports.imp,
      includeAttic,
      fields,
    })
  }, [fields, unitsNum, reports, includeAttic])

  // Only this submittal's documents — never the whole document catalogue.
  const submittalDocuments = useMemo(
    () => documentDefinitionsForSubmittal(programKey, submittalStage),
    [programKey, submittalStage])

  const reportsReady = !!(reports.base && reports.imp)
  const needsReports = submittalDocuments.some(d => d.requiresAssetScoreReports)
  const scopeReady = reportsReady && unitsNum && model?.tier && model.tier.perUnit > 0

  const handleReportFile = async (which, file) => {
    if (!file) return
    setParsing(p => ({ ...p, [which]: true }))
    setGenError(null)
    try {
      const parsed = await parseAssetScorePdf(await file.arrayBuffer())
      setReports(r => ({ ...r, [which]: parsed }))
      setReportNames(n => ({ ...n, [which]: file.name }))
    } catch (e) {
      setGenError(`Could not read the ${which === 'base' ? 'Baseline' : 'Improved'} report — ${e.message || e}`)
    } finally {
      setParsing(p => ({ ...p, [which]: false }))
    }
  }

  const baseName = (fields?.propertyName || project?.project_record_number || 'Project').replace(/[\\/:*?"<>|]/g, '')
  const programLabel = PROGRAM_SUBMITTALS[programKey]?.label || ''

  const generate = async (docKey) => {
    if (!model) return
    setBusyDoc(docKey)
    setGenError(null)
    try {
      let blob, filename
      const prefix = `${baseName} - ${programLabel}`
      switch (docKey) {
        case DOCUMENTS.ENERGY_AUDIT_INVOICE:
          blob = await buildEesPdf(model, 'audit')
          filename = `${prefix} - Energy Audit Invoice.pdf`; break
        case DOCUMENTS.HOMES_PROJECT_PROPOSAL:
          blob = await buildEesPdf(model, 'proposal')
          filename = `${prefix} - Project Reservation Proposal.pdf`; break
        case DOCUMENTS.HOMES_PROJECT_INVOICE:
          blob = await buildEesPdf(model, 'invoice')
          filename = `${prefix} - Final Project Payment Request Invoice.pdf`; break
        case DOCUMENTS.SEALED_PROPOSAL:
          blob = await buildSealedPdf(model, 'proposal')
          filename = `${prefix} - Sealed Proposal.pdf`; break
        case DOCUMENTS.SEALED_INVOICE:
          blob = await buildSealedPdf(model, 'invoice')
          filename = `${prefix} - Sealed Invoice.pdf`; break
        case DOCUMENTS.PAPERWORK_WORKBOOK:
          blob = await buildPaperworkWorkbook(model)
          filename = `${prefix} - Paperwork Workbook.xlsx`; break
        default:
          throw new Error(`Unknown document: ${docKey}`)
      }
      downloadBlob(blob, filename)
      toast.success(`${filename} downloaded`)
    } catch (e) {
      setGenError(e.message || String(e))
      toast.error(`Generation failed — ${e.message || e}`)
    } finally {
      setBusyDoc(null)
    }
  }

  const setField = (key, value) => setFields(f => ({ ...f, [key]: value }))

  return (
    <div style={overlay} onClick={busyDoc ? undefined : onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={iconWrap}>
              <Icon path="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z M14 3v6h6 M9 13h6 M9 17h4" size={17} color={C.emerald} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
                {stage?.label || 'Program Submittal'}
              </div>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>
                {project?.project_record_number} • {project?.project_name || 'Untitled Project'}
                {stage?.lifecycleStage ? ` • ${stage.lifecycleStage}` : ''}
              </div>
            </div>
          </div>
          <button onClick={busyDoc ? undefined : onClose} disabled={!!busyDoc} aria-label="Close"
            style={{ background: 'transparent', border: 'none', padding: 6, borderRadius: 4,
              cursor: busyDoc ? 'wait' : 'pointer', color: C.textMuted }}>
            <Icon path="M18 6 6 18M6 6l12 12" size={16} color="currentColor" />
          </button>
        </div>

        <div style={bodyStyle}>
          {stage?.description && (
            <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.5, marginBottom: 16 }}>
              {stage.description}
            </div>
          )}

          {loading ? (
            <div style={{ padding: '20px 0', color: C.textMuted, fontSize: 13, textAlign: 'center' }}>
              Loading project records…
            </div>
          ) : loadError ? (
            <div style={errorBox}>{loadError}</div>
          ) : eligiblePrograms.length === 0 ? (
            <div style={errorBox}>
              No program has documents built for the {stage?.label} submittal yet.
            </div>
          ) : (
            <>
              {/* Program — each program files its own submittal at this stage */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Program</label>
                <select value={programKey} onChange={e => setProgramKey(e.target.value)}
                  disabled={!!busyDoc} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {eligiblePrograms.map(p => (
                    <option key={p.key} value={p.key}>{p.label} — {p.programName}</option>
                  ))}
                </select>
                <div style={hintStyle}>
                  Each program runs its own incentive application with its own reservation and
                  payment request. This submittal is filed to the program selected here.
                </div>
              </div>

              {/* Asset Score reports — only when this submittal's documents need them */}
              {needsReports && (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Asset Score Reports</label>
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 8, lineHeight: 1.45 }}>
                    Upload the Baseline and Improved DOE Asset Score report PDFs. The reports are the
                    source of record for attic square footage, R-values, and modeled savings.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['base', 'imp'].map(which => (
                      <label key={which} style={{
                        flex: '1 1 200px',
                        border: `1px dashed ${reports[which] ? '#a7f3d0' : C.borderDark}`,
                        background: reports[which] ? '#ecfdf5' : CARD_SECONDARY,
                        borderRadius: 6, padding: '10px 12px', cursor: 'pointer', fontSize: 12.5,
                        color: reports[which] ? '#0f6b47' : C.textSecondary,
                        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
                      }}>
                        <Icon path={reports[which] ? 'M5 13l4 4L19 7' : 'M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2'} size={14} color="currentColor" />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {parsing[which] ? 'Reading…'
                            : reportNames[which] || (which === 'base' ? 'Baseline report PDF' : 'Improved report PDF')}
                        </span>
                        <input type="file" accept="application/pdf" style={{ display: 'none' }}
                          onChange={e => handleReportFile(which, e.target.files?.[0])} />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Parsed numbers review */}
              {needsReports && reportsReady && model && (
                <div style={reviewBox}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 22px' }}>
                    <span>Modeled savings <strong style={strongStyle}>{model.savings != null ? model.savings.toFixed(1) + '%' : '—'}</strong></span>
                    <span>Attic <strong style={strongStyle}>{model.roofSqFt != null ? model.roofSqFt.toLocaleString() + ' sq ft' : '—'}</strong></span>
                    <span>R <strong style={strongStyle}>{model.baseAtticR != null ? model.baseAtticR : '—'} → {model.iMin}</strong></span>
                    <span>HOMES <strong style={strongStyle}>{model.tier ? formatMoney(model.homesAmt) : '—'}</strong></span>
                    <span>Focus on Energy <strong style={strongStyle}>{model.foe ? formatMoney(model.foeAmt) : 'none'}</strong></span>
                    <span>Total <strong style={strongStyle}>{formatMoney(model.total)}</strong></span>
                  </div>
                  {model.tier && model.tier.perUnit === 0 && (
                    <div style={{ marginTop: 6, color: '#1e466b' }}>
                      Modeled savings below 20% — not HOMES eligible.
                    </div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                      <input type="checkbox"
                        checked={includeAttic != null ? includeAttic : (model.roofSqFt != null && model.baseAtticR != null)}
                        onChange={e => setIncludeAttic(e.target.checked)} />
                      Include attic insulation + air sealing measures
                    </label>
                  </div>
                </div>
              )}

              {needsReports && (
                <div style={{ marginBottom: 16, maxWidth: 220 }}>
                  <label style={labelStyle}>Dwelling Units</label>
                  <input type="number" min="1" value={units}
                    onChange={e => setUnits(e.target.value)} style={inputStyle} />
                  <div style={hintStyle}>Prefilled from the property's total units.</div>
                </div>
              )}

              {FIELD_GROUPS.map(g => (
                <div key={g.title} style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>{g.title}</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                    {g.fields.map(([key, lbl]) => (
                      <div key={key}>
                        <div style={{ fontSize: 10.5, color: C.textMuted, marginBottom: 3 }}>{lbl}</div>
                        <input value={fields?.[key] ?? ''} onChange={e => setField(key, e.target.value)}
                          style={inputStyle} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {genError && <div style={errorBox}>{genError}</div>}

              {/* This submittal's documents — nothing else */}
              <div style={{ marginTop: 18 }}>
                <label style={labelStyle}>{stage?.label} Documents</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                  {submittalDocuments.map(doc => {
                    const blocked = doc.requiresAssetScoreReports && !scopeReady
                    return (
                      <DocButton key={doc.key} label={doc.label} sub={doc.format} title={doc.note}
                        onClick={() => generate(doc.key)}
                        busy={busyDoc === doc.key} disabled={!!busyDoc || blocked} />
                    )
                  })}
                </div>
                {needsReports && !scopeReady && (
                  <div style={hintStyle}>
                    {!reportsReady
                      ? 'Documents that carry the scope of work unlock once both Asset Score reports are uploaded.'
                      : !unitsNum
                        ? 'Enter the number of dwelling units to unlock the scope documents.'
                        : 'The scope documents need a HOMES-qualifying savings percentage (20% or greater).'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div style={footerStyle}>
          <button onClick={busyDoc ? undefined : onClose} disabled={!!busyDoc}
            style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: '8px 16px', fontSize: 13,
              cursor: busyDoc ? 'wait' : 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function DocButton({ label, sub, title, onClick, busy, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        textAlign: 'left', background: C.card,
        border: `1px solid ${disabled && !busy ? C.border : '#a7f3d0'}`,
        borderRadius: 6, padding: '9px 12px',
        cursor: disabled ? (busy ? 'wait' : 'not-allowed') : 'pointer',
        opacity: disabled && !busy ? 0.55 : 1, display: 'flex', alignItems: 'center', gap: 9,
      }}>
      <Icon path="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" size={14}
        color={disabled && !busy ? C.textMuted : C.emerald} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.textPrimary }}>
          {busy ? 'Building…' : label}
        </span>
        <span style={{ display: 'block', fontSize: 10.5, color: C.textMuted, marginTop: 1 }}>{sub}</span>
      </span>
    </button>
  )
}

// ───────── shared styles ─────────
// Design-system "card secondary"; not present on the C palette constant.
const CARD_SECONDARY = '#f7f9fc'
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1100, padding: 16,
}
const card = {
  width: '100%', maxWidth: 720, maxHeight: '90vh', background: C.card,
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
