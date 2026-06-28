import { forwardRef, useState } from 'react'
import { C } from '../data/constants'

/**
 * PasswordInput — a text input with a built-in show/hide eye toggle.
 *
 * Technicians (and anyone) setting up or changing a password need to be able
 * to see what they type — entering an invisible password and fat-fingering it
 * is the single most common self-service support call. This component is the
 * one place that behavior lives, so the login screen, the set-password /
 * recovery screen, and the in-app change-password modal all get it identically.
 *
 * Each instance owns its own visibility state, so on a multi-field form every
 * field toggles independently.
 *
 * Props: same contract as a native <input> — pass `value`, `onChange` (receives
 * the event), `autoComplete`, `required`, `disabled`, `placeholder`,
 * `autoFocus`, etc. `style` styles the input itself; any `marginBottom` in it
 * is hoisted to the wrapper so the eye stays vertically centered on the field.
 * An incoming `type` is ignored — the toggle controls it.
 */
const PasswordInput = forwardRef(function PasswordInput(
  { style = {}, wrapperStyle, type: _ignoredType, ...rest },
  ref
) {
  const [show, setShow] = useState(false)
  const { marginBottom, ...inputStyle } = style

  return (
    <div style={{ position: 'relative', marginBottom, ...wrapperStyle }}>
      <input
        ref={ref}
        type={show ? 'text' : 'password'}
        style={{ ...inputStyle, marginBottom: 0, paddingRight: 44 }}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
        style={{
          position: 'absolute', top: 0, right: 0, height: '100%', width: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          color: C.textMuted,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = C.textSecondary }}
        onMouseLeave={(e) => { e.currentTarget.style.color = C.textMuted }}
      >
        <EyeIcon off={show} />
      </button>
    </div>
  )
})

export default PasswordInput

/**
 * Eye / eye-off SVG. `off=true` draws the slashed eye (password is currently
 * visible, so the button's action is to hide it). SVG only — no emoji in UI
 * chrome, per the design system.
 */
function EyeIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {off ? (
        <>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <path d="M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}
