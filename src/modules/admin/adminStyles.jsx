import { C, TYPE, RADIUS } from '../../data/constants'

// ---------------------------------------------------------------------------
// Shared styles for admin Object Manager panes (RecordTypesPane,
// LayoutsPane, LayoutEditor, etc.). Keep these in one place so every pane
// looks consistent without copy-pasting the same button/input definitions.
// ---------------------------------------------------------------------------

export const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  fontSize: TYPE.base,
  fontFamily: 'inherit',
  color: C.textPrimary,
  background: C.card,
  border: `1px solid ${C.borderDark || C.border}`,
  borderRadius: RADIUS.control,
  outline: 'none',
  boxSizing: 'border-box',
}

export const textareaStyle = {
  ...inputStyle,
  minHeight: 70,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.45,
}

export const buttonPrimaryStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '7px 14px',
  fontSize: TYPE.button, fontWeight: 600,
  color: '#ffffff',
  background: C.emeraldMid,
  border: 'none',
  borderRadius: RADIUS.control,
  cursor: 'pointer',
}

export const buttonSecondaryStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '7px 14px',
  fontSize: TYPE.button, fontWeight: 500,
  color: C.textSecondary,
  background: C.card,
  border: `1px solid ${C.borderDark || C.border}`,
  borderRadius: RADIUS.control,
  cursor: 'pointer',
}

export const buttonDangerStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '7px 14px',
  fontSize: TYPE.button, fontWeight: 500,
  color: '#1a5a8a',
  background: C.card,
  border: '1px solid #bcd9f2',
  borderRadius: RADIUS.control,
  cursor: 'pointer',
}

export const buttonSmPrimaryStyle = {
  padding: '4px 10px',
  fontSize: TYPE.buttonSm, fontWeight: 600,
  color: '#ffffff',
  background: C.emeraldMid,
  border: 'none',
  borderRadius: RADIUS.control,
  cursor: 'pointer',
}

export const buttonSmSecondaryStyle = {
  padding: '4px 10px',
  fontSize: TYPE.buttonSm, fontWeight: 500,
  color: C.textSecondary,
  background: C.card,
  border: `1px solid ${C.borderDark || C.border}`,
  borderRadius: RADIUS.control,
  cursor: 'pointer',
}

export const buttonSmDangerStyle = {
  padding: '4px 10px',
  fontSize: TYPE.buttonSm, fontWeight: 500,
  color: '#1a5a8a',
  background: C.card,
  border: '1px solid #bcd9f2',
  borderRadius: RADIUS.control,
  cursor: 'pointer',
}

export const hintBoxStyle = {
  background: '#f7f9fc',
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '9px 12px',
  fontSize: 11.5,
  color: C.textSecondary,
  lineHeight: 1.5,
  marginBottom: 14,
}

export const warningBoxStyle = {
  background: '#eef5fc',
  border: '1px solid #bcd9f2',
  borderRadius: 6,
  padding: '9px 12px',
  fontSize: 11.5,
  color: '#1e466b',
  lineHeight: 1.5,
  marginBottom: 14,
}

export const dangerBoxStyle = {
  background: '#e8f1fb',
  border: '1px solid #bcd9f2',
  color: '#1e466b',
  borderRadius: 6,
  padding: '9px 12px',
  fontSize: 12,
  marginBottom: 14,
}

/**
 * Standard labelled form field used throughout admin modals and editors.
 * Wrap an input/select/textarea in this to get a consistent label + hint.
 */
export function FormField({ label, hint, children, required, style }) {
  return (
    <div style={{ marginBottom: 14, ...(style || {}) }}>
      <label style={{
        display: 'block', fontSize: TYPE.label, fontWeight: 500,
        color: C.textSecondary,
        marginBottom: 5,
      }}>
        {label}
        {required && <span style={{ color: '#1a5a8a', marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  )
}
