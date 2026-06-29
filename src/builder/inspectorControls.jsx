// =============================================================================
// src/builder/inspectorControls.jsx
//
// Shared inspector form controls, used by every surface's ComponentInspector
// (dashboards, home pages, …). A field descriptor's `type` selects the control;
// `field`-type pickers read a `columns` list (report columns) when a surface
// provides one. Keeping these here means surface inspectors only describe their
// fields, not re-implement inputs.
// =============================================================================

import { C } from '../data/constants'

export function Field({ label, help, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>
        {label}
      </label>
      {children}
      {help && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>{help}</div>}
    </div>
  )
}

export function inputStyle() {
  return {
    width: '100%', padding: '8px 10px', fontSize: 13,
    background: C.card, color: C.textPrimary,
    border: `1px solid ${C.border}`, borderRadius: 6, font: 'inherit', boxSizing: 'border-box',
  }
}

export function FieldControl({ descriptor, value, onChange, columns = [] }) {
  switch (descriptor.type) {
    case 'textarea':
      return <textarea rows={4} value={value ?? ''} placeholder={descriptor.placeholder || ''}
        onChange={e => onChange(e.target.value)} style={{ ...inputStyle(), resize: 'vertical' }} />
    case 'number':
      return <input type="number" value={value ?? ''} min={descriptor.min} max={descriptor.max}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle()} />
    case 'boolean':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textPrimary, cursor: 'pointer' }}>
          <input type="checkbox" checked={value !== false} onChange={e => onChange(e.target.checked)} />
          {descriptor.help ? '' : 'Enabled'}
        </label>
      )
    case 'select':
      return (
        <select value={value ?? descriptor.options?.[0]?.value ?? ''} onChange={e => onChange(e.target.value)} style={inputStyle()}>
          {(descriptor.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'field':
      return (
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} style={inputStyle()}>
          <option value="">{columns.length ? '— Select a field —' : '— Choose a report first —'}</option>
          {columns.map((f, i) => (
            <option key={`${f.name}-${i}`} value={f.name}>
              {f.label || f.name}{f.via_path?.length ? ` (${f.via_path.join('.')})` : ''}
            </option>
          ))}
        </select>
      )
    case 'color':
      return <input type="color" value={value || C.emerald} onChange={e => onChange(e.target.value)}
        style={{ width: 48, height: 32, padding: 0, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer' }} />
    case 'text':
    default:
      return <input type="text" value={value ?? ''} placeholder={descriptor.placeholder || ''}
        onChange={e => onChange(e.target.value)} style={inputStyle()} />
  }
}
