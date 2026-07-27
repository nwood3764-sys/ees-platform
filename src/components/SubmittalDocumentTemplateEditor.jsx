// ---------------------------------------------------------------------------
// SubmittalDocumentTemplateEditor — WYSIWYG editor for a submittal document
// template (SDT record). Opened from an SDT record via the "Edit Sections"
// action.
//
// A submittal document IS its ordered list of {type, config} sections, and the
// renderer (buildSubmittalPdf in paperworkModel.js) is PURE and takes that list
// — so this editor is a live preview: reorder / add / remove / configure a
// section and the real PDF beside the list regenerates. The section palette is
// keyed on the template's kind so EES sections are never offered on a Sealed
// template and vice versa.
//
// Lazy-loaded (heavy: pulls jsPDF through the renderer) like the other builder
// modals — preflight requires this default export to resolve.
//
// See docs/leap-project-paperwork-port.md §7c.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import SortableList from '../builder/SortableList'
import { buildPaperworkModel, buildSubmittalPdf } from '../data/paperworkModel'
import {
  loadSubmittalTemplateForEdit, saveSubmittalTemplateSections,
  cloneSubmittalTemplate, loadOpportunityRecordTypeOptions,
} from '../data/paperworkService'
import {
  getSubmittalSectionSchema, buildDefaultSectionConfig,
  paletteForKind, SUBMITTAL_SECTION_LABELS,
} from '../data/submittalSectionSchemas'

const CARD_SECONDARY = '#f7f9fc'

// A representative model so the preview shows realistic numbers (the Hampton
// review fixture: 8 units, 46% savings, R-2 attic → $87,150 gross, $0.00 due).
const PREVIEW_FIELDS = {
  ownerName: 'Hampton Housing Partners LLC', ownerAddress: '100 Main St',
  ownerCityStateZip: 'Madison, WI 53703', contactName: 'Jane Manager',
  contactEmail: 'jane@example.com', contactPhone: '608-555-0100',
  propertyName: 'Hampton Apartments', installationAddress: '200 Hampton Ct',
  installationCityStateZip: 'Madison, WI 53704', iqNumber: 'LEA-12345',
  invoiceNumber: 'INV-WI-001', projectInvoiceNumber: 'INV-WI-002',
  invoiceDate: '7/26/2026', estimatedStartDate: '8/1/2026', estimatedEndDate: '8/15/2026',
  startDate: '8/1/2026', endDate: '8/14/2026',
}
const PREVIEW_MODEL = buildPaperworkModel({
  units: 8,
  assetScoreBase: { euiCurrent: 100, roofArea: 7150.0, roofRs: [2] },
  assetScoreImp: { euiUpgraded: 54, roofRs: [49] },
  fields: PREVIEW_FIELDS,
})

let _uidSeq = 0
const nextUid = () => `s${++_uidSeq}`

export default function SubmittalDocumentTemplateEditor({ templateId, onClose, onSaved }) {
  const toast = useToast()
  const [template, setTemplate] = useState(null)
  const [sections, setSections] = useState([])          // [{_uid, id?, type, config, isActive}]
  const [selectedUid, setSelectedUid] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showClone, setShowClone] = useState(false)

  // ---- load -------------------------------------------------------------
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const t = await loadSubmittalTemplateForEdit(templateId)
        if (!alive) return
        if (!t) { setLoadError('Template not found'); setLoading(false); return }
        setTemplate(t)
        setSections(t.sections.map(s => ({ _uid: nextUid(), id: s.id, type: s.type, config: s.config || {}, isActive: s.isActive })))
        setLoading(false)
      } catch (e) {
        if (alive) { setLoadError(e.message || String(e)); setLoading(false) }
      }
    })()
    return () => { alive = false }
  }, [templateId])

  const palette = useMemo(() => template ? paletteForKind(template.kind) : [], [template])

  // ---- live preview -----------------------------------------------------
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const previewToken = useRef(0)
  const lastUrl = useRef(null)

  const activeSectionList = useMemo(
    () => sections.filter(s => s.isActive).map(s => ({ type: s.type, config: s.config || {} })),
    [sections],
  )

  useEffect(() => {
    if (!template) return
    const token = ++previewToken.current
    setPreviewing(true)
    const timer = setTimeout(async () => {
      try {
        if (!activeSectionList.length) {
          if (token === previewToken.current) { setPreviewError('No active sections to preview'); setPreviewUrl(null); setPreviewing(false) }
          return
        }
        const blob = await buildSubmittalPdf(PREVIEW_MODEL, template.kind, activeSectionList)
        if (token !== previewToken.current) return          // a newer edit superseded this render
        const url = URL.createObjectURL(blob)
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current)
        lastUrl.current = url
        setPreviewUrl(url); setPreviewError(null); setPreviewing(false)
      } catch (e) {
        if (token === previewToken.current) { setPreviewError(e.message || String(e)); setPreviewing(false) }
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [activeSectionList, template])

  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current) }, [])

  // ---- section list mutations ------------------------------------------
  const markDirty = () => setDirty(true)
  const updateSection = (uid, patch) => {
    setSections(prev => prev.map(s => s._uid === uid ? { ...s, ...patch } : s)); markDirty()
  }
  const updateConfig = (uid, config) => updateSection(uid, { config })
  const removeSection = (uid) => {
    setSections(prev => prev.filter(s => s._uid !== uid))
    setSelectedUid(cur => cur === uid ? null : cur); markDirty()
  }
  const addSection = (type) => {
    const uid = nextUid()
    setSections(prev => [...prev, { _uid: uid, type, config: buildDefaultSectionConfig(type), isActive: true }])
    setSelectedUid(uid); setShowPalette(false); markDirty()
  }
  const reorder = (nextItems) => {
    setSections(nextItems.map(i => i._sec)); markDirty()
  }

  const selected = sections.find(s => s._uid === selectedUid) || null

  // ---- save -------------------------------------------------------------
  const handleSave = async () => {
    setSaving(true)
    try {
      const reloaded = await saveSubmittalTemplateSections(
        templateId,
        sections.map(s => ({ id: s.id, type: s.type, config: s.config || {}, isActive: s.isActive })),
        (type) => SUBMITTAL_SECTION_LABELS[type] || type,
      )
      setTemplate(reloaded)
      setSections(reloaded.sections.map(s => ({ _uid: nextUid(), id: s.id, type: s.type, config: s.config || {}, isActive: s.isActive })))
      setSelectedUid(null); setDirty(false)
      toast.success('Template saved')
      onSaved && onSaved()
    } catch (e) {
      toast.error(`Save failed — ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const items = sections.map(s => ({ id: s._uid, _sec: s }))

  return (
    <div style={overlay} onClick={saving ? undefined : onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={iconWrap}>
              <Icon path="M4 6h16M4 12h10M4 18h7 M15 15l3 3 4-5" size={16} color={C.emerald} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
                {template ? `Edit Sections — ${template.name}` : 'Submittal Document Template'}
              </div>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>
                {template ? `${template.recordNumber} • ${kindLabel(template.kind)}${template.opportunityRecordType ? ' • program-scoped' : ' • default'}` : 'Loading…'}
              </div>
            </div>
          </div>
          <button onClick={saving ? undefined : onClose} disabled={saving} aria-label="Close"
            style={{ background: 'transparent', border: 'none', padding: 6, borderRadius: 4, cursor: saving ? 'wait' : 'pointer', color: C.textMuted }}>
            <Icon path="M18 6 6 18M6 6l12 12" size={16} color="currentColor" />
          </button>
        </div>

        {/* body: split — list/config left, preview right */}
        <div style={splitBody}>
          {loading ? (
            <div style={{ padding: 40, color: C.textMuted, fontSize: 13 }}>Loading template…</div>
          ) : loadError ? (
            <div style={{ padding: 40, color: C.textPrimary, fontSize: 13 }}>{loadError}</div>
          ) : (
            <>
              <div style={leftPane}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={labelStyle}>Sections</div>
                  <div style={{ position: 'relative' }}>
                    <button style={addBtn} onClick={() => setShowPalette(v => !v)}>
                      <Icon path="M12 5v14M5 12h14" size={13} color="#fff" /> Add Section
                    </button>
                    {showPalette && (
                      <div style={paletteMenu}>
                        {palette.map(p => (
                          <button key={p.type} style={paletteItem} onClick={() => addSection(p.type)}>
                            {p.label}
                            <span style={{ color: C.textMuted, fontSize: 10.5, marginLeft: 8 }}>{p.type}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {sections.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 12, color: C.textMuted, border: `1px dashed ${C.border}`, borderRadius: 6 }}>
                    No sections. Add one to start building the document.
                  </div>
                ) : (
                  <SortableList
                    items={items}
                    onReorder={reorder}
                    renderItem={(item, { setNodeRef, style, dragHandleProps }) => {
                      const s = item._sec
                      const isSel = s._uid === selectedUid
                      return (
                        <div ref={setNodeRef} style={{ ...style, ...sectionRow(isSel, s.isActive) }}
                          onClick={() => setSelectedUid(s._uid)}>
                          <span {...dragHandleProps} style={grip} title="Drag to reorder"
                            onClick={e => e.stopPropagation()}>⠿</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {SUBMITTAL_SECTION_LABELS[s.type] || s.type}
                          </span>
                          <button title={s.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                            onClick={e => { e.stopPropagation(); updateSection(s._uid, { isActive: !s.isActive }) }}
                            style={pill(s.isActive)}>{s.isActive ? 'Active' : 'Off'}</button>
                          <button title="Remove section" onClick={e => { e.stopPropagation(); removeSection(s._uid) }}
                            style={iconBtn}>
                            <Icon path="M18 6 6 18M6 6l12 12" size={13} color={C.textMuted} />
                          </button>
                        </div>
                      )
                    }}
                  />
                )}

                {/* config form for the selected section */}
                {selected && (
                  <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                    <div style={labelStyle}>{SUBMITTAL_SECTION_LABELS[selected.type] || selected.type} — configuration</div>
                    <SectionConfigForm
                      key={selected._uid}
                      section={selected}
                      onChangeConfig={(cfg) => updateConfig(selected._uid, cfg)}
                    />
                  </div>
                )}
              </div>

              {/* preview */}
              <div style={rightPane}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={labelStyle}>Live Preview</div>
                  {previewing && <span style={{ fontSize: 11, color: C.textMuted }}>rendering…</span>}
                </div>
                <div style={previewFrameWrap}>
                  {previewError ? (
                    <div style={{ padding: 20, fontSize: 12, color: C.textMuted }}>{previewError}</div>
                  ) : previewUrl ? (
                    <iframe title="preview" src={previewUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
                  ) : (
                    <div style={{ padding: 20, fontSize: 12, color: C.textMuted }}>Preparing preview…</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* footer */}
        <div style={footerStyle}>
          <button style={ghostBtn} disabled={saving} onClick={() => setShowClone(true)}>
            <Icon path="M8 4h9a2 2 0 012 2v9 M4 8h9a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2v-9a2 2 0 012-2z" size={13} color={C.textSecondary} /> Clone Template…
          </button>
          <div style={{ flex: 1 }} />
          <button style={ghostBtn} disabled={saving} onClick={onClose}>Close</button>
          <button style={{ ...primaryBtn, opacity: (!dirty || saving) ? 0.6 : 1 }} disabled={!dirty || saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {showClone && template && (
        <CloneTemplateDialog
          template={template}
          onClose={() => setShowClone(false)}
          onCloned={(newId) => { setShowClone(false); toast.success('Template cloned'); onSaved && onSaved(newId) }}
        />
      )}
    </div>
  )
}

function kindLabel(kind) {
  return {
    audit: 'Energy Audit Invoice', proposal: 'HOMES Proposal', invoice: 'HOMES Invoice',
    sealed_proposal: 'Sealed Proposal', sealed_invoice: 'Sealed Invoice',
  }[kind] || kind
}

// ---------------------------------------------------------------------------
// SectionConfigForm — renders a typed form from the section-type schema.
// Falls back to a raw JSON editor for section types without a schema.
// ---------------------------------------------------------------------------
function SectionConfigForm({ section, onChangeConfig }) {
  const schema = getSubmittalSectionSchema(section.type)
  const config = section.config || {}
  const setKey = (key, value) => {
    const next = { ...config }
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete next[key]
    else next[key] = value
    onChangeConfig(next)
  }

  if (!schema) {
    return <JsonConfigEditor value={config} onChange={onChangeConfig} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {schema.map(f => {
        if (f.type === 'info') {
          return <div key={f.key} style={{ fontSize: 11.5, color: C.textSecondary, lineHeight: 1.5, background: CARD_SECONDARY, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px' }}>{f.description}</div>
        }
        const val = config[f.key] !== undefined ? config[f.key] : f.default
        return (
          <div key={f.key}>
            <label style={fieldLabel}>{f.label}</label>
            {f.type === 'text' && (
              <input style={inputStyle} value={val ?? ''} placeholder={f.placeholder || ''}
                onChange={e => setKey(f.key, e.target.value)} />
            )}
            {f.type === 'textarea' && (
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={val ?? ''}
                onChange={e => setKey(f.key, e.target.value)} />
            )}
            {f.type === 'select' && (
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={val ?? ''}
                onChange={e => setKey(f.key, e.target.value || null)}>
                {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.type === 'string_list' && (
              <StringListEditor value={Array.isArray(val) ? val : []} onChange={v => setKey(f.key, v)} />
            )}
            {f.type === 'row_grid' && (
              <RowGridEditor columns={f.columns || []} value={Array.isArray(val) ? val : []} onChange={v => setKey(f.key, v)} />
            )}
            {f.description && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>{f.description}</div>}
          </div>
        )
      })}
    </div>
  )
}

function StringListEditor({ value, onChange }) {
  const set = (i, v) => onChange(value.map((x, k) => k === i ? v : x))
  const add = () => onChange([...value, ''])
  const remove = (i) => onChange(value.filter((_, k) => k !== i))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {value.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <textarea style={{ ...inputStyle, minHeight: 34, resize: 'vertical' }} value={item}
            onChange={e => set(i, e.target.value)} />
          <button style={iconBtn} title="Remove" onClick={() => remove(i)}>
            <Icon path="M18 6 6 18M6 6l12 12" size={12} color={C.textMuted} />
          </button>
        </div>
      ))}
      <button style={smallAddBtn} onClick={add}>
        <Icon path="M12 5v14M5 12h14" size={12} color={C.emerald} /> Add Item
      </button>
    </div>
  )
}

function RowGridEditor({ columns, value, onChange }) {
  const setCell = (r, c, v) => onChange(value.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? v : cell) : row))
  const addRow = () => onChange([...value, columns.map(() => '')])
  const removeRow = (r) => onChange(value.filter((_, ri) => ri !== r))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
        <thead>
          <tr>
            {columns.map((c, i) => <th key={i} style={gridTh}>{c}</th>)}
            <th style={{ ...gridTh, width: 26 }} />
          </tr>
        </thead>
        <tbody>
          {value.map((row, ri) => (
            <tr key={ri}>
              {columns.map((_, ci) => (
                <td key={ci} style={gridTd}>
                  <input style={gridInput} value={row[ci] ?? ''} onChange={e => setCell(ri, ci, e.target.value)} />
                </td>
              ))}
              <td style={gridTd}>
                <button style={iconBtn} title="Remove row" onClick={() => removeRow(ri)}>
                  <Icon path="M18 6 6 18M6 6l12 12" size={11} color={C.textMuted} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button style={{ ...smallAddBtn, marginTop: 6 }} onClick={addRow}>
        <Icon path="M12 5v14M5 12h14" size={12} color={C.emerald} /> Add Row
      </button>
    </div>
  )
}

function JsonConfigEditor({ value, onChange }) {
  const [text, setText] = useState(() => JSON.stringify(value || {}, null, 2))
  const [err, setErr] = useState(null)
  return (
    <div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>No form for this section type — edit its config as JSON.</div>
      <textarea
        style={{ ...inputStyle, minHeight: 120, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
        value={text}
        onChange={e => {
          setText(e.target.value)
          try { onChange(e.target.value.trim() ? JSON.parse(e.target.value) : {}); setErr(null) }
          catch (ex) { setErr(ex.message) }
        }} />
      {err && <div style={{ fontSize: 11, color: C.sky, marginTop: 4 }}>Invalid JSON: {err}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CloneTemplateDialog — copy this template, scoped to an opportunity record
// type (the program axis). Mirrors clone_document_template semantics.
// ---------------------------------------------------------------------------
function CloneTemplateDialog({ template, onClose, onCloned }) {
  const toast = useToast()
  const [options, setOptions] = useState([])
  const [recordType, setRecordType] = useState('')
  const [name, setName] = useState(`${template.name} (Copy)`)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    loadOpportunityRecordTypeOptions().then(o => { if (alive) setOptions(o) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const doClone = async () => {
    if (!recordType) { toast.error('Pick a program to scope the copy to'); return }
    setBusy(true)
    try {
      const newId = await cloneSubmittalTemplate(template.id, { opportunityRecordTypeId: recordType, name })
      onCloned(newId)
    } catch (e) {
      toast.error(`Clone failed — ${e.message || e}`)
    } finally { setBusy(false) }
  }

  return (
    <div style={{ ...overlay, zIndex: 1200 }} onClick={busy ? undefined : onClose}>
      <div style={{ ...card, maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>Clone Template</div>
          <button onClick={busy ? undefined : onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 6 }}>
            <Icon path="M18 6 6 18M6 6l12 12" size={15} color="currentColor" />
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.5, marginBottom: 14 }}>
            Copies this document's sections into a new template scoped to a program (opportunity record type).
            That program's submittals then render from the copy instead of the default.
          </div>
          <label style={fieldLabel}>New Template Name</label>
          <input style={{ ...inputStyle, marginBottom: 14 }} value={name} onChange={e => setName(e.target.value)} />
          <label style={fieldLabel}>Scope to Program (Opportunity Record Type)</label>
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={recordType} onChange={e => setRecordType(e.target.value)}>
            <option value="">— Select a program —</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div style={footerStyle}>
          <button style={ghostBtn} disabled={busy} onClick={onClose}>Cancel</button>
          <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doClone}>
            {busy ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }
const card = { width: '100%', maxWidth: 1120, maxHeight: '92vh', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
const headerStyle = { padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }
const iconWrap = { width: 32, height: 32, borderRadius: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const splitBody = { display: 'flex', gap: 0, minHeight: 0, flex: 1, overflow: 'hidden' }
const leftPane = { width: 420, flexShrink: 0, padding: 16, overflowY: 'auto', borderRight: `1px solid ${C.border}` }
const rightPane = { flex: 1, minWidth: 0, padding: 16, display: 'flex', flexDirection: 'column', background: CARD_SECONDARY }
const previewFrameWrap = { flex: 1, minHeight: 0, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }
const footerStyle = { padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, alignItems: 'center', background: C.page, flexShrink: 0 }
const labelStyle = { display: 'block', fontSize: 11.5, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }
const fieldLabel = { display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }
const inputStyle = { width: '100%', padding: '7px 9px', fontSize: 12.5, color: C.textPrimary, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box' }
const sectionRow = (sel, active) => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 6, background: sel ? '#ecfdf5' : C.card, border: `1px solid ${sel ? C.emerald : C.border}`, borderRadius: 6, cursor: 'pointer', opacity: active ? 1 : 0.55 })
const grip = { cursor: 'grab', color: C.textMuted, fontSize: 14, lineHeight: 1, userSelect: 'none', touchAction: 'none' }
const pill = (active) => ({ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${active ? C.emerald : C.border}`, background: active ? '#ecfdf5' : C.card, color: active ? C.emerald : C.textMuted })
const iconBtn = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, borderRadius: 4, display: 'inline-flex' }
const addBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 500, padding: '5px 10px', borderRadius: 6, border: 'none', background: C.emerald, color: '#fff', cursor: 'pointer' }
const smallAddBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 500, padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.emerald, cursor: 'pointer', alignSelf: 'flex-start' }
const paletteMenu = { position: 'absolute', right: 0, top: 30, zIndex: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.16)', padding: 6, minWidth: 250, maxHeight: 320, overflowY: 'auto' }
const paletteItem = { display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', fontSize: 12.5, color: C.textPrimary, padding: '7px 9px', border: 'none', background: 'transparent', borderRadius: 5, cursor: 'pointer' }
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, padding: '7px 13px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.textSecondary, cursor: 'pointer' }
const primaryBtn = { fontSize: 12.5, fontWeight: 600, padding: '7px 16px', borderRadius: 6, border: 'none', background: C.emerald, color: '#fff', cursor: 'pointer' }
const gridTh = { textAlign: 'left', fontWeight: 600, color: C.textSecondary, padding: '4px 5px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
const gridTd = { padding: 2, borderBottom: `1px solid ${C.border}` }
const gridInput = { width: '100%', minWidth: 60, padding: '4px 5px', fontSize: 11.5, border: `1px solid ${C.border}`, borderRadius: 4, boxSizing: 'border-box' }
