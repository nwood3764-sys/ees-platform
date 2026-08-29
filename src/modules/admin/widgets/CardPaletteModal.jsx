import { useState, useEffect, useMemo } from 'react'
import { C } from '../../../data/constants'
import { availableCards, cardPlacements } from '../../../lib/layoutCards.js'
import { documentTypeOptions } from '../../../lib/documentTypes.js'
import { fetchFieldValues } from '../../../data/adminService'
import { fetchReports } from '../../../data/reportsService'
import {
  FormField, inputStyle, buttonPrimaryStyle, buttonSecondaryStyle, hintBoxStyle,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// The card palette, its config forms, and the copy-to-another-placement picker
// for LayoutCanvasEditor.
//
// Before this, a layout could gain exactly two kinds of card through the
// editor — a related list and a Communications panel. Documents galleries,
// photo galleries, reports, work plans and publish history were placeable only
// by writing a migration, which is why an enrollment record offered no way to
// put Documents anywhere (Nicholas, 2026-08-27).
//
// Three purpose-built modals, all local: they collect a choice and hand it
// back. Nothing is written until the admin saves the whole layout.
//
//   CardPaletteModal  which card to add — every card the record page can draw,
//                     with the ones this object cannot host shown disabled and
//                     carrying the reason, never silently missing.
//   CardConfigModal   that card's own settings — a documents slot's type,
//                     whether it is required, its guidance; a photo gallery's
//                     default tag and watermark; a report and its context
//                     filter.
//   CopyCardModal     copy a placed card into another section — the right
//                     sidebar, another tab, a new section — leaving the
//                     original where it is.
// ---------------------------------------------------------------------------

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 3000, padding: 16,
}

function panelStyle(width = 620) {
  return {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
    width: '100%', maxWidth: width, maxHeight: '86vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 18px 50px rgba(7,17,31,0.28)',
  }
}

function HeaderRow({ title, subtitle, onClose }) {
  return (
    <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, background: C.cardSecondary }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 3 }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} title="Close" style={{
          background: 'transparent', border: 'none', color: C.textMuted,
          fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 2,
        }}>×</button>
      </div>
    </div>
  )
}

// ─── Palette ────────────────────────────────────────────────────────────────

export function CardPaletteModal({ object, objectLabel, sections, sectionLabel, onPick, onClose }) {
  const cards = useMemo(() => availableCards(object, sections), [object, sections])

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle(640)} onClick={e => e.stopPropagation()}>
        <HeaderRow
          title="Add a card"
          subtitle={`Into “${sectionLabel}”. A card renders exactly where its section is placed — on that tab, or in the right sidebar.`}
          onClose={onClose}
        />
        <div style={{ padding: 14, overflowY: 'auto' }}>
          {cards.map(card => {
            const placed = cardPlacements(sections, card.widgetType)
            return (
              <button
                key={card.id}
                disabled={card.disabled}
                onClick={() => !card.disabled && onPick(card.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', marginBottom: 8,
                  padding: '11px 13px', borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: card.disabled ? C.cardSecondary : C.card,
                  cursor: card.disabled ? 'not-allowed' : 'pointer',
                  opacity: card.disabled ? 0.72 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: card.disabled ? C.textMuted : C.textPrimary }}>
                    {card.label}
                  </span>
                  {!card.disabled && placed.length > 0 && (
                    <span title={placed.map(p => `${p.title || card.label} — ${p.tab}`).join('\n')}
                      style={{
                        fontSize: 10.5, fontWeight: 600, color: C.emeraldMid, background: '#e9f9f1',
                        border: '1px solid #bfe9d6', borderRadius: 9, padding: '1px 7px',
                      }}>
                      already on {placed.map(p => p.tab).join(', ')}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 3, lineHeight: 1.45 }}>
                  {card.disabled ? card.disabledReason : card.description}
                </div>
              </button>
            )
          })}
          <div style={{ ...hintBoxStyle, marginTop: 4 }}>
            The same card can sit in more than one place — add it here, then use
            <strong> Copy to…</strong> on the card to put it in the right sidebar or on another tab.
            {objectLabel ? ` This is the ${objectLabel} layout.` : ''}
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={buttonSecondaryStyle}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Card config ────────────────────────────────────────────────────────────

export function CardConfigModal({ widget, object, sections, onApply, onClose }) {
  const cfg = widget?.config || {}
  const isGallery = widget?.type === 'file_gallery'
  const isPhotos = isGallery && cfg.target === 'photos'
  const isDocuments = isGallery && !isPhotos
  const isReport = widget?.type === 'report'

  const [title, setTitle] = useState(widget?.title || '')
  const [documentType, setDocumentType] = useState(cfg.document_type || 'attachment')
  const [required, setRequired] = useState(cfg.required === true)
  const [helpText, setHelpText] = useState(cfg.help_text || '')
  const [photoType, setPhotoType] = useState(cfg.photo_type || '')
  const [watermark, setWatermark] = useState(cfg.apply_watermark === true)
  const [reportId, setReportId] = useState(cfg.report_id || '')
  const [filterField, setFilterField] = useState(cfg.filter_field || '')
  const [maxRows, setMaxRows] = useState(cfg.max_rows || 50)

  // Registered document types, and any slug already in use on this layout so a
  // slot never silently loses the type it had.
  const [typeRows, setTypeRows] = useState([])
  const [photoTagRows, setPhotoTagRows] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const jobs = []
    if (isDocuments) jobs.push(fetchFieldValues('documents', 'document_type').catch(() => []))
    else jobs.push(Promise.resolve([]))
    if (isPhotos) jobs.push(fetchFieldValues('photos', 'photo_type').catch(() => []))
    else jobs.push(Promise.resolve([]))
    if (isReport) jobs.push(fetchReports().catch(() => []))
    else jobs.push(Promise.resolve([]))
    Promise.all(jobs).then(([docTypes, photoTags, reportRows]) => {
      if (cancelled) return
      setTypeRows((docTypes || []).filter(r => r.active !== false))
      setPhotoTagRows((photoTags || []).filter(r => r.active !== false))
      setReports(reportRows || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [isDocuments, isPhotos, isReport])

  const inUseTypes = useMemo(() => {
    const out = []
    for (const s of sections || []) {
      for (const w of (s.widgets || [])) {
        if (w.type !== 'file_gallery') continue
        const t = w.config?.document_type
        if (t) out.push(t)
      }
    }
    return out
  }, [sections])

  const typeOptions = useMemo(
    () => documentTypeOptions(typeRows.map(r => ({ value: r.value, label: r.label })), inUseTypes),
    [typeRows, inUseTypes],
  )

  const apply = () => {
    const next = { ...cfg }
    if (isDocuments) {
      next.target = 'documents'
      next.document_type = documentType
      // Only a slot can be required — "attach something, anything" is not a
      // rule anyone can satisfy. Both keys are dropped on a catch-all so the
      // stored config says what it means.
      if (documentType && documentType !== 'attachment' && required) next.required = true
      else delete next.required
      if (helpText.trim()) next.help_text = helpText.trim()
      else delete next.help_text
    }
    if (isPhotos) {
      next.target = 'photos'
      if (photoType) next.photo_type = photoType
      else delete next.photo_type
      if (watermark) next.apply_watermark = true
      else delete next.apply_watermark
    }
    if (isReport) {
      next.report_id = reportId || null
      if (filterField.trim()) next.filter_field = filterField.trim()
      else delete next.filter_field
      next.max_rows = Number(maxRows) || 50
    }
    onApply({ title: title.trim() || widget.title, config: next })
  }

  const isCatchAll = !documentType || documentType === 'attachment'

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle(560)} onClick={e => e.stopPropagation()}>
        <HeaderRow
          title={isReport ? 'Report card' : isPhotos ? 'Photos card' : 'Documents card'}
          subtitle={isDocuments
            ? 'A card that names a document type is a slot for that one kind of file. A catch-all lists everything no slot on this layout claims.'
            : isPhotos
              ? 'Field photo evidence on this record.'
              : 'A saved report rendered inline on the record page.'}
          onClose={onClose}
        />
        <div style={{ padding: 16, overflowY: 'auto' }}>
          <FormField label="Card title">
            <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle}
              placeholder={widget?.title || 'Documents'} />
          </FormField>

          {isDocuments && (
            <>
              <FormField label="Document type">
                <select value={documentType} onChange={e => setDocumentType(e.target.value)} style={inputStyle}>
                  {typeOptions.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}{o.unregistered ? ' (not in the picklist)' : ''}
                    </option>
                  ))}
                </select>
              </FormField>
              <div style={{ fontSize: 11.5, color: C.textSecondary, margin: '-6px 0 12px', lineHeight: 1.5 }}>
                {isCatchAll
                  ? 'Lists every file on the record that no other card on this layout claims, and uploads land untyped.'
                  : 'Lists only this kind of file, and anything uploaded here is stamped with this type.'}
                {' '}Types are managed in Setup → Picklist Values under documents · document_type.
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12,
                opacity: isCatchAll ? 0.55 : 1 }}>
                <input type="checkbox" checked={required && !isCatchAll} disabled={isCatchAll}
                  onChange={e => setRequired(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 12.5, color: C.textPrimary }}>
                  Required
                  <span style={{ display: 'block', fontSize: 11.5, color: C.textSecondary }}>
                    {isCatchAll
                      ? 'A catch-all cannot be required — it names no particular file.'
                      : 'The record is incomplete until a file of this type is attached, and Verify Fields reports it by this card’s title.'}
                  </span>
                </span>
              </label>
              <FormField label="Guidance (optional)">
                <input value={helpText} onChange={e => setHelpText(e.target.value)} style={inputStyle}
                  placeholder="e.g. Required for buildings with 5 or more units." />
              </FormField>
            </>
          )}

          {isPhotos && (
            <>
              <FormField label="Default tag (optional)">
                <select value={photoType} onChange={e => setPhotoType(e.target.value)} style={inputStyle}>
                  <option value="">Untagged</option>
                  {photoTagRows.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </FormField>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <input type="checkbox" checked={watermark} onChange={e => setWatermark(e.target.checked)} />
                <span style={{ fontSize: 12.5, color: C.textPrimary }}>Watermark uploads</span>
              </label>
            </>
          )}

          {isReport && (
            <>
              <FormField label="Report">
                <select value={reportId} onChange={e => setReportId(e.target.value)} style={inputStyle}>
                  <option value="">{loading ? 'Loading reports…' : 'Select a report…'}</option>
                  {reports.map(r => (
                    <option key={r._id} value={r._id}>
                      {r.name}{r.primaryObject && r.primaryObject !== '—' ? ` — ${r.primaryObject}` : ''}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Filter to this record by field (optional)">
                <input value={filterField} onChange={e => setFilterField(e.target.value)} style={inputStyle}
                  placeholder={`e.g. ${String(object || '').replace(/s$/, '')}_id`} />
              </FormField>
              <div style={{ fontSize: 11.5, color: C.textSecondary, margin: '-6px 0 12px', lineHeight: 1.5 }}>
                Names a column on the report’s own rows. Set it and the card shows only the rows
                belonging to the record being viewed; leave it blank and the card shows the whole report.
              </div>
              <FormField label="Maximum rows">
                <input type="number" min={1} max={500} value={maxRows}
                  onChange={e => setMaxRows(e.target.value)} style={inputStyle} />
              </FormField>
            </>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={buttonSecondaryStyle}>Cancel</button>
          <button onClick={apply} style={buttonPrimaryStyle}>Apply</button>
        </div>
      </div>
    </div>
  )
}

// ─── Copy to another placement ──────────────────────────────────────────────

export function CopyCardModal({ widget, targets, onCopy, onClose }) {
  const [selected, setSelected] = useState(null)

  // Group in the order the targets came in — sections by where they render,
  // then the "new section" entries, so the list reads like the record page.
  const groups = []
  for (const t of targets) {
    let g = groups.find(x => x.name === t.group)
    if (!g) { g = { name: t.group, items: [] }; groups.push(g) }
    g.items.push(t)
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle(520)} onClick={e => e.stopPropagation()}>
        <HeaderRow
          title={`Copy “${widget?.title || 'card'}” to…`}
          subtitle="The card stays where it is and a copy is placed here as well, so the same card can sit in the right sidebar and on a tab."
          onClose={onClose}
        />
        <div style={{ padding: 14, overflowY: 'auto' }}>
          {groups.map(g => (
            <div key={g.name} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase',
                letterSpacing: 0.5, marginBottom: 5 }}>{g.name}</div>
              {g.items.map(t => (
                <button key={t.id} onClick={() => setSelected(t)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', marginBottom: 5,
                    padding: '8px 11px', borderRadius: 6, fontSize: 12.5,
                    border: `1px solid ${selected?.id === t.id ? C.emerald : C.border}`,
                    background: selected?.id === t.id ? '#f0faf5' : C.card,
                    color: C.textPrimary, cursor: 'pointer',
                  }}>
                  {t.kind === 'new' ? '+ New section' : t.label}
                  {t.isSource && (
                    <span style={{ fontSize: 10.5, color: C.textMuted, marginLeft: 6 }}>· where it is now</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={buttonSecondaryStyle}>Cancel</button>
          <button onClick={() => selected && onCopy(selected)} disabled={!selected}
            style={{ ...buttonPrimaryStyle, opacity: selected ? 1 : 0.5, cursor: selected ? 'pointer' : 'not-allowed' }}>
            Copy card
          </button>
        </div>
      </div>
    </div>
  )
}
