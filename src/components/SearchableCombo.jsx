import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../data/constants'

/**
 * SearchableCombo — a type-to-filter dropdown (combo box).
 *
 * Replaces a plain <select> where the option list is long. The user types to
 * narrow the list, then picks from the filtered dropdown. The dropdown is
 * rendered in a portal anchored to the input so it is never clipped by a
 * parent's overflow:hidden.
 *
 * Options are { value, label, secondary? }. The stored value is `value`
 * (e.g. a column name, or a picklist_values.id UUID); the displayed text is
 * `label`. This separation lets a value picker show a human label while
 * persisting the underlying id that the report runner compares against.
 *
 * Props:
 *   value         current stored value (string) or '' / null
 *   options       array of { value, label, secondary? }
 *   onChange      (newValue) => void
 *   placeholder   input placeholder when nothing selected
 *   loading       show a loading hint in the dropdown
 *   disabled      render as a disabled input
 *   allowFreeText if true, a value typed that matches no option is committed
 *                 verbatim on blur/Enter (used for text/number/date fields)
 *   style         optional style overrides merged onto the input
 *   emptyText     text shown when the filtered list is empty
 */
export default function SearchableCombo({
  value,
  options = [],
  onChange,
  placeholder = 'Select…',
  loading = false,
  disabled = false,
  allowFreeText = false,
  style,
  emptyText = 'No matches',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [menuRect, setMenuRect] = useState(null)
  const inputRef = useRef(null)
  const menuRef = useRef(null)

  const selected = options.find(o => String(o.value) === String(value)) || null
  // When closed, the input shows the selected label (or raw value for free text).
  const displayWhenClosed = selected ? selected.label : (value != null ? String(value) : '')

  const filtered = (() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      String(o.value).toLowerCase().includes(q) ||
      (o.secondary && o.secondary.toLowerCase().includes(q))
    )
  })()

  const positionMenu = useCallback(() => {
    if (!inputRef.current) return
    const r = inputRef.current.getBoundingClientRect()
    setMenuRect({ left: r.left, top: r.bottom + 2, width: r.width })
  }, [])

  useEffect(() => {
    if (!open) return
    positionMenu()
    const onScroll = () => positionMenu()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, positionMenu])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e) => {
      if (inputRef.current && inputRef.current.contains(e.target)) return
      if (menuRef.current && menuRef.current.contains(e.target)) return
      commitClose()
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, filtered, allowFreeText])

  function openMenu() {
    if (disabled) return
    setQuery('')
    setHighlight(0)
    setOpen(true)
  }

  function pick(opt) {
    onChange(opt.value)
    setOpen(false)
    setQuery('')
  }

  function commitClose() {
    // On close without an explicit pick: for free-text fields, commit the
    // typed query verbatim if the user typed something. Otherwise keep the
    // prior selection untouched.
    if (allowFreeText && query.trim() !== '') {
      onChange(query.trim())
    }
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      openMenu()
      e.preventDefault()
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      setHighlight(h => Math.min(h + 1, filtered.length - 1)); e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      setHighlight(h => Math.max(h - 1, 0)); e.preventDefault()
    } else if (e.key === 'Enter') {
      if (filtered[highlight]) pick(filtered[highlight])
      else if (allowFreeText && query.trim() !== '') { onChange(query.trim()); setOpen(false); setQuery('') }
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setOpen(false); setQuery(''); e.preventDefault()
    }
  }

  const baseInput = {
    width: '100%', padding: '8px 10px', fontSize: 13,
    background: disabled ? '#f7f9fc' : C.card, color: C.textPrimary,
    border: `1px solid ${C.border}`, borderRadius: 6, font: 'inherit',
    boxSizing: 'border-box', cursor: disabled ? 'default' : 'text',
    ...style,
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={open ? query : displayWhenClosed}
        placeholder={selected ? selected.label : placeholder}
        onChange={e => { setQuery(e.target.value); setHighlight(0); if (!open) setOpen(true) }}
        onFocus={openMenu}
        onKeyDown={onKeyDown}
        style={baseInput}
        spellCheck={false}
        autoComplete="off"
      />
      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', left: menuRect.left, top: menuRect.top, width: menuRect.width,
            maxHeight: 260, overflowY: 'auto', zIndex: 9999,
            background: C.card, border: `1px solid ${C.borderDark}`, borderRadius: 6,
            boxShadow: '0 6px 24px rgba(13,26,46,0.16)',
          }}
        >
          {loading ? (
            <div style={menuMsg()}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={menuMsg()}>
              {allowFreeText && query.trim() !== ''
                ? `Use "${query.trim()}"`
                : emptyText}
            </div>
          ) : filtered.map((o, i) => (
            <div
              key={String(o.value) + i}
              onMouseDown={e => { e.preventDefault(); pick(o) }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: '7px 10px', fontSize: 13, cursor: 'pointer',
                background: i === highlight ? '#eef6f1' : 'transparent',
                color: C.textPrimary,
                borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : 'none',
                display: 'flex', flexDirection: 'column', gap: 1,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
              {o.secondary && (
                <span style={{ fontSize: 11, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.secondary}
                </span>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

function menuMsg() {
  return { padding: '10px', fontSize: 12, color: C.textMuted, fontStyle: 'italic' }
}
