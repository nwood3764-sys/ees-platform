// Two panels, one browser, the REAL component in both.
//
//   real         the REAL TabOverlays out of src/pages/SigningPortal.jsx,
//                given the REAL tab geometry of ENV-00016 — the envelope
//                Nicholas could not sign — over a page wrap the real code
//                builds. Playwright clicks the markers with a real mouse.
//
//   CONTROL-old  the pre-fix layering: one full-page interactive layer PER
//                TAB, exactly as it shipped. Its signature marker MUST stay
//                unclickable. If it ever becomes clickable, this harness is
//                not reproducing the defect and every PASS beside it is
//                worthless.

import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TabOverlays } from '../../src/pages/SigningPortal'

// ── The real envelope ──────────────────────────────────────────────────────
// Read off production: ENV-00016, page 1, both tabs on the SAME y — side by
// side, the signature first in the array and the date second, which is what
// put the date's layer on top of the signature marker.
const TABS = [
  { id: 'ETAB-00006', type: 'signature', page: 1, x: 20,  y: 77, width: 290, height: 26, anchor_string: 'generated:sig:1:0' },
  { id: 'ETAB-00007', type: 'date',      page: 1, x: 334, y: 77, width: 150, height: 26, anchor_string: 'generated:date:1:1' },
]

// US Letter at the width the portal renders: Math.min(900, container - 4).
const SCALE = 900 / 612
const PAGE = {
  pageNumber: 1, cssWidth: 900, cssHeight: 792 * SCALE,
  pdfWidth: 612, pdfHeight: 792, scale: SCALE,
}

// The page wrap the real mounting effect builds, so TabOverlays finds it by
// [data-page-number] exactly as it does against a real PDF canvas.
function usePageWrap(ref) {
  const [, tick] = useState(0)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.style.position = 'relative'
    wrap.style.margin = '0 auto'
    wrap.style.width = `${PAGE.cssWidth}px`
    wrap.style.height = `${PAGE.cssHeight}px`
    wrap.style.background = '#fff'
    wrap.dataset.pageNumber = '1'
    c.appendChild(wrap)
    tick(n => n + 1)
  }, [ref])
}

function RealPanel() {
  const ref = useRef(null)
  usePageWrap(ref)
  // The date arrives pre-filled, exactly as signing-portal-load supplies it.
  const [values, setValues] = useState({ 'ETAB-00007': '2026-09-04' })
  return (
    <div data-test="real-panel">
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }} />
      <TabOverlays
        containerRef={ref}
        pages={[PAGE]}
        tabs={TABS}
        tabValues={values}
        canFill={true}
        activeTabId={null}
        onTabClick={(id) => {
          window.__realClicks = [...(window.__realClicks || []), id]
          setValues(v => ({ ...v, [id]: v[id] || 'clicked' }))
        }}
      />
    </div>
  )
}

// Verbatim the shape that shipped: one Portal PER TAB, each a full-page
// pointer-events:auto layer.
function ControlPortal({ target, children }) {
  const [container] = useState(() => {
    const div = document.createElement('div')
    div.style.position = 'absolute'
    div.style.inset = '0'
    div.style.pointerEvents = 'none'
    return div
  })
  useEffect(() => {
    if (!target) return
    target.appendChild(container)
    return () => { try { target.removeChild(container) } catch {} }
  }, [target, container])
  return createPortal(
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>{children}</div>,
    container,
  )
}

function ControlPanel() {
  const ref = useRef(null)
  usePageWrap(ref)
  const [, tick] = useState(0)
  useEffect(() => { const t = setTimeout(() => tick(n => n + 1), 50); return () => clearTimeout(t) }, [])
  const wrap = ref.current?.querySelector('[data-page-number]')
  return (
    <div data-test="control-panel">
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }} />
      {wrap && TABS.map(t => (
        <ControlPortal key={t.id} target={wrap}>
          <div
            data-signing-tab={`ctl-${t.id}`}
            data-signing-tab-type={t.type}
            onClick={() => { window.__ctlClicks = [...(window.__ctlClicks || []), t.id] }}
            style={{
              position: 'absolute',
              left: t.x * PAGE.scale,
              top: (PAGE.pdfHeight - t.y - t.height) * PAGE.scale,
              width: t.width * PAGE.scale,
              height: t.height * PAGE.scale,
              background: 'rgba(126,179,232,0.30)',
              border: '2px solid #7eb3e8',
            }}
          />
        </ControlPortal>
      ))}
    </div>
  )
}

window.__realClicks = []
window.__ctlClicks = []

createRoot(document.getElementById('root')).render(
  <div>
    <h3 style={{ margin: '8px 12px' }}>real — ENV-00016 tabs, real TabOverlays</h3>
    <RealPanel />
    <h3 style={{ margin: '8px 12px' }}>CONTROL — pre-fix layering (must stay unclickable)</h3>
    <ControlPanel />
  </div>,
)
