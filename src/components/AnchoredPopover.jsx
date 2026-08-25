import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../data/constants'

/**
 * AnchoredPopover — a panel pinned to the control that opened it, rendered in
 * a portal on document.body so nothing on the page can clip it.
 *
 * Nicholas, 2026-08-25, from the report Filters tab: "I can't see any of the
 * dropdown. It is getting cut off." The field picker's list was an
 * absolutely-positioned child of a card, and every card in the builder is
 * `overflow:hidden` — so the list was cut at the card's edge and the fields
 * below it were unreachable. A dropdown that lives inside the layout will
 * always be at the mercy of the layout; this one does not.
 *
 * It stays anchored: the panel re-measures on scroll and resize, flips above
 * the trigger when there isn't room below, and is clamped into the viewport
 * so it is never half off-screen. Outside click and Escape close it.
 *
 * Props:
 *   anchorRef  ref to the trigger element the panel hangs off
 *   open       whether the panel is shown
 *   onClose    called on outside click / Escape
 *   width      panel width in px, or 'anchor' to match the trigger (default)
 *   minWidth   floor when width is 'anchor'
 *   align      'left' | 'right' — which edge lines up with the trigger's
 *   maxHeight  tallest the panel may be before it scrolls internally
 */
export default function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  width = 'anchor',
  minWidth = 0,
  align = 'left',
  maxHeight = 340,
  zIndex = 9000,
  children,
}) {
  const [pos, setPos] = useState(null)
  const panelRef = useRef(null)

  const measure = useCallback(() => {
    const el = anchorRef?.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 4
    const panelWidth = Math.max(
      width === 'anchor' ? r.width : width,
      minWidth,
    )
    // Below the trigger by default; above it when the space below can't hold
    // the panel and the space above is larger.
    const spaceBelow = vh - r.bottom - gap
    const spaceAbove = r.top - gap
    const flipUp = spaceBelow < Math.min(maxHeight, 180) && spaceAbove > spaceBelow
    const height = Math.min(maxHeight, Math.max(120, flipUp ? spaceAbove : spaceBelow))
    let left = align === 'right' ? r.right - panelWidth : r.left
    left = Math.max(8, Math.min(left, vw - panelWidth - 8))
    const top = flipUp ? Math.max(8, r.top - gap - height) : r.bottom + gap
    setPos({ left, top, width: panelWidth, maxHeight: height })
  }, [anchorRef, width, minWidth, align, maxHeight])

  useEffect(() => {
    if (!open) { setPos(null); return }
    measure()
    const onMove = () => measure()
    // Capture-phase scroll: the builder scrolls an inner pane, not the window.
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, measure])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open || !pos) return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      style={{
        position: 'fixed',
        left: pos.left, top: pos.top, width: pos.width,
        maxHeight: pos.maxHeight, overflowY: 'auto',
        zIndex,
        background: C.card,
        border: `1px solid ${C.borderDark}`,
        borderRadius: 6,
        boxShadow: '0 10px 30px rgba(13,26,46,0.18)',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
