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
          <input type="checkbox" checked={(value ?? descriptor.default) !== false} onChange={e => onChange(e.target.checked)} />
          {descriptor.help ? '' : 'Enabled'}
        </label>
      )
    case 'multi-field': {
      // Ordered subset of the report's columns (e.g. a table widget's visible
      // columns). Checkbox list to include/exclude; ↑/↓ set left-to-right order.
      const picked = Array.isArray(value) ? value : []
      const move = (name, dir) => {
        const i = picked.indexOf(name)
        const j = i + dir
        if (i < 0 || j < 0 || j >= picked.length) return
        const next = [...picked]
        ;[next[i], next[j]] = [next[j], next[i]]
        onChange(next)
      }
      return (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, maxHeight: 220, overflowY: 'auto', background: C.card }}>
          {!columns.length && <div style={{ padding: 8, fontSize: 12, color: C.textMuted }}>— Choose a report first —</div>}
          {picked.filter(n => columns.some(c => c.name === n)).map(name => {
            const col = columns.find(c => c.name === name)
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                <input type="checkbox" checked onChange={() => onChange(picked.filter(n => n !== name))} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.textPrimary }}>{col?.label || name}</span>
                <button onClick={() => move(name, -1)} title="Move up" style={miniBtn()}>↑</button>
                <button onClick={() => move(name, 1)} title="Move down" style={miniBtn()}>↓</button>
              </div>
            )
          })}
          {columns.filter(c => !picked.includes(c.name)).map(c => (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
              <input type="checkbox" checked={false} onChange={() => onChange([...picked, c.name])} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.textSecondary }}>{c.label || c.name}</span>
            </div>
          ))}
        </div>
      )
    }
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

function miniBtn() {
  return {
    width: 20, height: 20, padding: 0, fontSize: 11, lineHeight: 1,
    background: C.cardSecondary, color: C.textSecondary,
    border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
  }
}
