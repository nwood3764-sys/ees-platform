import { useState, useEffect, useRef } from 'react'
import { C } from '../../../data/constants'
import { useToast } from '../../../components/Toast'
import { useIsMobile } from '../../../lib/useMediaQuery'
import { createWidget } from '../../../data/pageLayoutBuilderService'
import {
  FormField,
  inputStyle,
  buttonPrimaryStyle, buttonSecondaryStyle,
  dangerBoxStyle,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// AddWidgetModal — collects widget type + title, creates the widget with
// empty config, and hands the new widget id upward so the parent can
// immediately open the appropriate contents editor.
// ---------------------------------------------------------------------------

// Each picker entry maps a UI choice to a row in page_layout_widgets:
//   widgetType   → widget_type column value
//   config       → widget_config default (already in DB-shape — no transform)
//   placeholder  → suggested title for the input
//
// Field Group and Related List are the foundational widget types; Photos
// and Documents are the file_gallery widget specialised by config.target.
// They share a widget_type so the renderer in RecordDetail dispatches on
// config.target rather than a separate widget_type per surface.
const WIDGET_TYPES = [
  {
    value: 'field_group',
    widgetType: 'field_group',
    config: {},
    label: 'Field Group',
    hint: 'A set of fields from this object arranged in a grid.',
    placeholder: 'e.g. Basic Information',
  },
  {
    value: 'related_list',
    widgetType: 'related_list',
    config: {},
    label: 'Related List',
    hint: 'Rows from a child table joined by a foreign key.',
    placeholder: 'e.g. Related Buildings',
  },
  {
    value: 'photos',
    widgetType: 'file_gallery',
    config: { target: 'photos', photo_type: 'general', apply_watermark: true },
    label: 'Photos',
    hint: 'Photo grid with camera capture and watermarking. ' +
          'Only valid on Work Orders, Work Steps, and Vehicle Inspections.',
    placeholder: 'e.g. Site Photos',
  },
  {
    value: 'documents',
    widgetType: 'file_gallery',
    config: { target: 'documents', document_type: 'attachment' },
    label: 'Documents',
    hint: 'File list for PDFs, spreadsheets, signed forms, and other attachments.',
    placeholder: 'e.g. Documents',
  },
]

export default function AddWidgetModal({
  sectionId, sectionLabel,
  onClose, onCreated,
}) {
  const toast = useToast()
  const isMobile = useIsMobile()
  const firstInputRef = useRef(null)

  const [type, setType] = useState('field_group')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => firstInputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return }
    const choice = WIDGET_TYPES.find(wt => wt.value === type) || WIDGET_TYPES[0]
    setBusy(true)
    setError(null)
    try {
      const widget = await createWidget(sectionId, {
        type:   choice.widgetType,
        title:  title.trim(),
        config: { ...choice.config },
      })
      toast.success(`Added "${title.trim()}" — configure its contents next`)
      onCreated(widget)
    } catch (e) {
      setError(e.message || String(e))
      setBusy(false)
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 700,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div role="dialog" aria-modal="true" style={{
        background: C.card,
        borderRadius: isMobile ? '12px 12px 0 0' : 10,
        padding: isMobile ? '22px 20px calc(20px + env(safe-area-inset-bottom))' : 26,
        width: isMobile ? '100%' : 480,
        maxWidth: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Add Widget</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            to section <strong>{sectionLabel || 'Untitled'}</strong>
          </div>
        </div>

        <FormField label="Widget Type">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            {WIDGET_TYPES.map(wt => (
              <button
                key={wt.value}
                onClick={() => setType(wt.value)}
                disabled={busy}
                style={{
                  padding: '12px 14px',
                  border: `1.5px solid ${type === wt.value ? C.emerald : C.border}`,
                  borderRadius: 8,
                  background: type === wt.value ? '#f0f9f5' : C.card,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'border 0.1s, background 0.1s',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: type === wt.value ? C.emerald : C.textPrimary, marginBottom: 3 }}>
                  {wt.label}
                </div>
                <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.45 }}>{wt.hint}</div>
              </button>
            ))}
          </div>
        </FormField>

        <FormField label="Title" hint="Displayed as the widget heading on the record page." required>
          <input
            ref={firstInputRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={busy}
            placeholder={(WIDGET_TYPES.find(wt => wt.value === type) || WIDGET_TYPES[0]).placeholder}
            style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter' && title.trim()) submit() }}
          />
        </FormField>

        {error && <div style={dangerBoxStyle}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
          <button onClick={submit} disabled={busy} style={buttonPrimaryStyle}>
            {busy ? 'Adding…' : 'Add Widget'}
          </button>
        </div>
      </div>
    </div>
  )
}
