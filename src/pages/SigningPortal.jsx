// =============================================================================
// SigningPortal — public e-signature page
//
// Mounted at /sign/{env_record_number}/{signing_token} via path-based
// routing in main.jsx (no react-router dependency). The recipient is NOT
// an Anura user — the token in the URL is the only auth.
//
// Flow:
//   1. POST to signing-portal-load with the token, get envelope/recipient
//      metadata + tabs assigned to this recipient + signed URL for the
//      current PDF (unsigned for recipient 1, latest overlay for the rest).
//   2. Render the PDF using PDF.js loaded from CDN. For each page: a
//      canvas of the PDF + an overlay div positioned absolutely with one
//      tab marker per envelope_tab. Recipients click a marker to fill it.
//   3. Three tab fillers:
//        - signature/initial: HTML5 canvas drawing surface; toDataURL()
//          becomes the tab value
//        - date: native date picker, defaults to today
//        - text: textarea
//   4. ESIGN consent checkbox is required before Submit.
//   5. Submit calls signing-portal-submit. Server overlays the PDF,
//      advances to next recipient or finalizes.
//
// No Anura chrome (sidebar/topbar) — this page stands alone with its
// own minimal header. Designed to render correctly on mobile.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../data/constants'
import { useToast, ToastProvider } from '../components/Toast'

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// PDF.js CDN — same major version as react-pdf et al. uses
const PDFJS_VERSION = '4.0.379'
const PDFJS_SCRIPT = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`

// ─── Path parsing ──────────────────────────────────────────────────────

export function parseSigningPath(pathname) {
  // /sign/{env_record_number}/{signing_token}
  const m = pathname.match(/^\/sign\/([^/]+)\/([^/]+)\/?$/)
  if (!m) return null
  return { envRecordNumber: m[1], signingToken: m[2] }
}

// ─── Top-level component ───────────────────────────────────────────────

export default function SigningPortalRoot() {
  return (
    <ToastProvider>
      <SigningPortal />
    </ToastProvider>
  )
}

function SigningPortal() {
  const path = parseSigningPath(window.location.pathname)
  const toast = useToast()

  const [phase, setPhase] = useState('loading')   // loading | error | view | success
  const [errorMsg, setErrorMsg] = useState(null)
  const [data, setData] = useState(null)          // { envelope, recipient, tabs, pdf_signed_url, can_sign, turn_after }
  const [tabValues, setTabValues] = useState({})  // tab_id → value
  const [activeTabId, setActiveTabId] = useState(null)
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [completionInfo, setCompletionInfo] = useState(null)
  const [showDecline, setShowDecline] = useState(false)

  // ── Load envelope state ──────────────────────────────────────────────
  useEffect(() => {
    if (!path) {
      setPhase('error')
      setErrorMsg('Invalid signing link.')
      return
    }
    let cancelled = false
    fetch(`${FN_BASE}/signing-portal-load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({
        env_record_number: path.envRecordNumber,
        signing_token: path.signingToken,
      }),
    })
      .then(async r => {
        const body = await r.json()
        if (cancelled) return
        if (!r.ok) {
          setPhase('error')
          setErrorMsg(body.error || `Load failed (${r.status})`)
          return
        }
        setData(body)
        // Pre-populate tabValues with any already-filled values (re-visit case)
        const initial = {}
        for (const t of body.tabs || []) {
          if (t.filled_value) initial[t.id] = t.filled_value
          else if (t.type === 'date') initial[t.id] = new Date().toISOString().slice(0, 10)
        }
        setTabValues(initial)
        setPhase('view')
      })
      .catch(err => {
        if (cancelled) return
        setPhase('error')
        setErrorMsg(err.message || 'Failed to reach the server.')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Submit ────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!data) return
    if (!consent) { toast.error('Please review and accept the consent statement before signing.'); return }

    // Validate every required tab has a value. Treat all tabs as required for now.
    const missing = (data.tabs || []).filter(t => !tabValues[t.id])
    if (missing.length > 0) {
      toast.error(`Please fill all ${data.tabs.length} field${data.tabs.length === 1 ? '' : 's'} before submitting (${missing.length} remaining).`)
      return
    }

    setSubmitting(true)
    try {
      const resp = await fetch(`${FN_BASE}/signing-portal-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
        body: JSON.stringify({
          env_record_number: path.envRecordNumber,
          signing_token: path.signingToken,
          consent: true,
          tabs: data.tabs.map(t => ({ id: t.id, value: tabValues[t.id] })),
        }),
      })
      const body = await resp.json()
      if (!resp.ok) {
        toast.error(body.error || `Submit failed (${resp.status})`)
        return
      }
      setCompletionInfo(body)
      setCompleted(true)
      setPhase('success')
    } catch (e) {
      toast.error(e.message || 'Failed to reach the server.')
    } finally {
      setSubmitting(false)
    }
  }, [data, tabValues, consent, path, toast])

  const handleDecline = useCallback(async (reason) => {
    setSubmitting(true)
    try {
      const resp = await fetch(`${FN_BASE}/signing-portal-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
        body: JSON.stringify({
          env_record_number: path.envRecordNumber,
          signing_token: path.signingToken,
          consent: false,
          tabs: [],
          decline: { reason },
        }),
      })
      const body = await resp.json()
      if (!resp.ok) {
        toast.error(body.error || `Decline failed (${resp.status})`)
        return
      }
      setCompletionInfo({ declined: true })
      setCompleted(true)
      setPhase('success')
    } catch (e) {
      toast.error(e.message || 'Failed to reach the server.')
    } finally {
      setSubmitting(false)
      setShowDecline(false)
    }
  }, [path, toast])

  // ── Render dispatch ──────────────────────────────────────────────────
  if (phase === 'loading') return <FullPageMessage title="Loading…" />
  if (phase === 'error')   return <FullPageMessage title="Unable to open this signing link" message={errorMsg} variant="error" />
  if (phase === 'success' && completionInfo?.declined)
    return <FullPageMessage title="Declined" message="You declined to sign this document. The sender has been notified." />
  if (phase === 'success' && completionInfo?.completed)
    return <FullPageMessage title="Thank you — signing complete" message="The envelope has been completed. A signed copy will be available to all parties." variant="success" />
  if (phase === 'success' && completionInfo?.advanced)
    return <FullPageMessage title="Thank you for signing" message="Your signature has been recorded. The next signer will be notified." variant="success" />
  if (phase === 'success')
    return <FullPageMessage title="Submitted" message="Your response has been recorded." variant="success" />

  // view
  if (!data) return null

  return (
    <PortalLayout
      data={data}
      tabValues={tabValues}
      activeTabId={activeTabId}
      consent={consent}
      submitting={submitting}
      onTabClick={setActiveTabId}
      onTabUpdate={(id, val) => setTabValues(v => ({ ...v, [id]: val }))}
      onSetConsent={setConsent}
      onSubmit={handleSubmit}
      onShowDecline={() => setShowDecline(true)}
    />
  ) ?? null
}

// ─── Full-page status message (loading / error / success) ──────────────

function FullPageMessage({ title, message, variant }) {
  const color =
    variant === 'error'   ? '#b03a2e' :
    variant === 'success' ? C.emerald : C.textPrimary
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, background: C.page,
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{
        background: '#fff', border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '32px 36px',
        maxWidth: 500, width: '100%',
        boxShadow: '0 6px 24px rgba(13, 26, 46, 0.06)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.emerald, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
          Anura Signing
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color, marginBottom: 10 }}>{title}</div>
        {message && <div style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1.5 }}>{message}</div>}
      </div>
    </div>
  )
}

// ─── Main signing UI ───────────────────────────────────────────────────

function PortalLayout({ data, tabValues, activeTabId, consent, submitting, onTabClick, onTabUpdate, onSetConsent, onSubmit, onShowDecline }) {
  const filledCount = (data.tabs || []).filter(t => tabValues[t.id]).length
  const totalCount  = (data.tabs || []).length
  const progress = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0
  const cantSignReason = data.can_sign === false
    ? (data.recipient.already_signed
        ? 'You already signed this document.'
        : data.turn_after
          ? `Waiting on ${data.turn_after.name} (signer ${data.turn_after.order}) to sign first.`
          : 'This envelope is not currently waiting on you.')
    : null

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        background: '#fff', borderBottom: `1px solid ${C.border}`,
        padding: '12px 20px', position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.emerald, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Anura Signing</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{data.envelope.name}</div>
          {data.envelope.subject && <div style={{ fontSize: 12, color: C.textSecondary }}>{data.envelope.subject}</div>}
        </div>
        <div style={{ fontSize: 12, color: C.textSecondary, textAlign: 'right' }}>
          <div>Signing as <b style={{ color: C.textPrimary }}>{data.recipient.name}</b></div>
          <div>{data.recipient.email}</div>
        </div>
      </header>

      {cantSignReason && (
        <div style={{ background: '#fffbeb', borderBottom: `1px solid #fde68a`, padding: '10px 20px', fontSize: 13, color: '#92400e' }}>
          {cantSignReason} You can review the document below.
        </div>
      )}

      {data.envelope.message && (
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, background: C.card, fontSize: 13, color: C.textPrimary, whiteSpace: 'pre-wrap' }}>
          {data.envelope.message}
        </div>
      )}

      {/* Document viewer */}
      <main style={{ flex: 1, padding: 20, display: 'flex', justifyContent: 'center' }}>
        <PdfViewer
          pdfUrl={data.pdf_signed_url}
          tabs={data.tabs}
          tabValues={tabValues}
          canFill={!!data.can_sign}
          activeTabId={activeTabId}
          onTabClick={onTabClick}
          onTabUpdate={onTabUpdate}
        />
      </main>

      {/* Footer / submit bar */}
      {data.can_sign && (
        <footer style={{
          background: '#fff', borderTop: `1px solid ${C.border}`,
          padding: '14px 20px', position: 'sticky', bottom: 0, zIndex: 10,
        }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: C.textSecondary }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{filledCount} of {totalCount} field{totalCount === 1 ? '' : 's'} complete</span>
                  <span>{progress}%</span>
                </div>
                <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: C.emerald, transition: 'width 200ms ease' }} />
                </div>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: C.textPrimary, lineHeight: 1.5 }}>
              <input type="checkbox" checked={consent} onChange={e => onSetConsent(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                I agree to use electronic records and signatures, and that my electronic signature on this document is legally binding under the federal ESIGN Act and applicable state laws (UETA). I confirm I am the person identified above.
              </span>
            </label>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                onClick={onShowDecline}
                disabled={submitting}
                style={{
                  background: '#fff', border: `1px solid ${C.borderDark}`, color: C.textSecondary,
                  padding: '10px 18px', fontSize: 13, borderRadius: 6, cursor: submitting ? 'wait' : 'pointer',
                }}>
                Decline to Sign
              </button>
              <button
                onClick={onSubmit}
                disabled={submitting || !consent}
                style={{
                  background: consent ? C.emerald : C.textMuted,
                  border: 'none', color: '#fff',
                  padding: '10px 22px', fontSize: 13, fontWeight: 600, borderRadius: 6,
                  cursor: submitting || !consent ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                }}>
                {submitting ? 'Submitting…' : 'Sign and Submit'}
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* Active tab editor modal */}
      {activeTabId && (
        <TabEditor
          tab={(data.tabs || []).find(t => t.id === activeTabId)}
          value={tabValues[activeTabId] || ''}
          recipientName={data.recipient.name}
          onSave={(val) => { onTabUpdate(activeTabId, val); onTabClick(null) }}
          onCancel={() => onTabClick(null)}
        />
      )}

      {/* Decline modal */}
      <DeclineConfirm
        open={false}
        // The decline modal is owned by the parent — we wire it via window.confirm for simplicity
      />
    </div>
  )
}

// ─── PDF viewer with tab overlays ──────────────────────────────────────

function PdfViewer({ pdfUrl, tabs, tabValues, canFill, activeTabId, onTabClick, onTabUpdate: _onTabUpdate }) {
  const [pages, setPages] = useState([])     // [{ width, height, viewportScale }]
  const [error, setError] = useState(null)
  const containerRef = useRef(null)

  // Lazy-load pdf.js from CDN once
  useEffect(() => {
    let cancelled = false
    async function loadAndRender() {
      try {
        // eslint-disable-next-line no-undef
        const pdfjs = await import(/* @vite-ignore */ PDFJS_SCRIPT)
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
        const loadingTask = pdfjs.getDocument({ url: pdfUrl })
        const pdf = await loadingTask.promise
        const pageList = []
        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelled) return
          const page = await pdf.getPage(p)
          const containerWidth = Math.min(900, (containerRef.current?.clientWidth || 800) - 4)
          const baseViewport = page.getViewport({ scale: 1 })
          const scale = containerWidth / baseViewport.width
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width  = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.display = 'block'
          canvas.style.borderBottom = `1px solid ${C.border}`
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
          pageList.push({
            canvas,
            cssWidth:  viewport.width,
            cssHeight: viewport.height,
            pdfWidth:  baseViewport.width,
            pdfHeight: baseViewport.height,
            scale,
            pageNumber: p,
          })
        }
        if (!cancelled) setPages(pageList)
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      }
    }
    if (pdfUrl) loadAndRender()
    return () => { cancelled = true }
  }, [pdfUrl])

  // Mount canvases into the DOM after pages are ready
  useEffect(() => {
    const container = containerRef.current
    if (!container || pages.length === 0) return
    container.innerHTML = ''
    pages.forEach((p, idx) => {
      const wrap = document.createElement('div')
      wrap.style.position = 'relative'
      wrap.style.margin = '0 auto'
      wrap.style.width  = `${p.cssWidth}px`
      wrap.style.background = '#fff'
      wrap.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'
      wrap.style.marginBottom = '12px'
      wrap.dataset.pageNumber = String(p.pageNumber)
      wrap.appendChild(p.canvas)
      container.appendChild(wrap)
    })
  }, [pages])

  if (error) return <div style={{ color: '#b03a2e', fontSize: 13 }}>Failed to load PDF: {error}</div>
  if (!pdfUrl) return <div style={{ fontSize: 13, color: C.textMuted }}>No PDF available.</div>

  return (
    <div style={{ width: '100%', maxWidth: 920 }}>
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }} />
      {/* Tab overlays — rendered as a separate React tree positioned via absolute coords, anchored to each page wrap */}
      <TabOverlays containerRef={containerRef} pages={pages} tabs={tabs} tabValues={tabValues} canFill={canFill} activeTabId={activeTabId} onTabClick={onTabClick} />
    </div>
  )
}

// Renders one absolutely-positioned tab marker per envelope_tab, on top
// of the rendered PDF canvases. PDF coordinates have origin at bottom-
// left; CSS positioning has origin at top-left. Conversion:
//   css.left = pdf.x * scale
//   css.top  = (pageHeight - pdf.y - pdf.height) * scale
function TabOverlays({ containerRef, pages, tabs, tabValues, canFill, activeTabId, onTabClick }) {
  const [, forceTick] = useState(0)
  // Re-render on layout changes (pages mounting)
  useEffect(() => {
    const t = setTimeout(() => forceTick(n => n + 1), 50)
    return () => clearTimeout(t)
  }, [pages])

  if (!containerRef.current) return null
  const pageWraps = Array.from(containerRef.current.querySelectorAll('[data-page-number]'))
  return (
    <>
      {(tabs || []).map(t => {
        const wrap = pageWraps.find(w => Number(w.dataset.pageNumber) === t.page)
        if (!wrap) return null
        const page = pages.find(p => p.pageNumber === t.page)
        if (!page) return null
        const left = t.x * page.scale
        const top  = (page.pdfHeight - t.y - t.height) * page.scale
        const w    = t.width * page.scale
        const h    = t.height * page.scale
        const filled = !!tabValues[t.id]
        const active = activeTabId === t.id
        // Render each marker as a portal-style absolutely-positioned div inside its page wrap
        return (
          <Portal key={t.id} target={wrap}>
            <div
              onClick={() => canFill && onTabClick(t.id)}
              style={{
                position: 'absolute', left, top, width: w, height: h,
                background: filled ? 'rgba(62, 207, 142, 0.15)' : 'rgba(247, 207, 70, 0.30)',
                border: `2px solid ${active ? C.emerald : (filled ? C.emerald : '#e8a949')}`,
                borderRadius: 4,
                cursor: canFill ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: Math.max(10, Math.min(14, h * 0.4)),
                color: filled ? C.textPrimary : '#92400e',
                fontWeight: 600,
                overflow: 'hidden',
                userSelect: 'none',
              }}
              title={`${tabLabel(t.type)} — ${t.anchor_string}`}
            >
              <TabPreview tab={t} value={tabValues[t.id]} />
            </div>
          </Portal>
        )
      })}
    </>
  )
}

// Inline portal helper — places children inside a non-react DOM target
function Portal({ target, children }) {
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
  // Children inside need pointer events back on
  return createPortal(<div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>{children}</div>, container)
}

function tabLabel(type) {
  switch (type) {
    case 'signature': return 'Sign'
    case 'initial':   return 'Initial'
    case 'date':      return 'Date'
    case 'text':      return 'Text'
    default:          return type
  }
}

function TabPreview({ tab, value }) {
  if (!value) return <span>{tabLabel(tab.type)}</span>
  if (tab.type === 'signature' || tab.type === 'initial') {
    return <img src={value} alt="" style={{ maxWidth: '100%', maxHeight: '100%' }} />
  }
  if (tab.type === 'date') {
    try { return <span>{new Date(value).toLocaleDateString('en-US')}</span> }
    catch { return <span>{value}</span> }
  }
  return <span style={{ padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{value}</span>
}

// ─── Tab editor modal ──────────────────────────────────────────────────

function TabEditor({ tab, value, recipientName, onSave, onCancel }) {
  if (!tab) return null
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 12,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 10, width: '100%', maxWidth: 520,
        padding: 18, boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary, marginBottom: 14 }}>
          {tab.type === 'signature' && 'Add your signature'}
          {tab.type === 'initial'   && 'Add your initials'}
          {tab.type === 'date'      && 'Pick a date'}
          {tab.type === 'text'      && 'Enter text'}
        </div>
        {(tab.type === 'signature' || tab.type === 'initial') && (
          <SignatureEditor type={tab.type} initialValue={value} recipientName={recipientName} onSave={onSave} onCancel={onCancel} />
        )}
        {tab.type === 'date' && (
          <DateEditor initialValue={value} onSave={onSave} onCancel={onCancel} />
        )}
        {tab.type === 'text' && (
          <TextEditor initialValue={value} onSave={onSave} onCancel={onCancel} />
        )}
      </div>
    </div>
  )
}

// Signature editor — supports Type or Draw modes. "Type" produces a
// canvas of the typed name in a script-like font. "Draw" is freehand
// mouse/touch capture. Both produce a PNG data URL.
function SignatureEditor({ type, initialValue, recipientName, onSave, onCancel }) {
  const [mode, setMode] = useState(type === 'initial' ? 'type' : 'draw')
  const [typed, setTyped] = useState(initialValue && initialValue.startsWith('data:') ? '' : (recipientName || ''))
  const drawRef = useRef(null)
  const isDrawingRef = useRef(false)
  const lastPointRef = useRef(null)
  const [hasDrawn, setHasDrawn] = useState(false)

  const canvasW = 420, canvasH = type === 'initial' ? 110 : 140

  useEffect(() => {
    const canvas = drawRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0d1a2e'
    ctx.lineWidth = 2
  }, [mode])

  const start = (e) => {
    isDrawingRef.current = true
    lastPointRef.current = pt(e, drawRef.current)
  }
  const move = (e) => {
    if (!isDrawingRef.current) return
    const ctx = drawRef.current.getContext('2d')
    const p = pt(e, drawRef.current)
    ctx.beginPath()
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPointRef.current = p
    setHasDrawn(true)
  }
  const end = () => { isDrawingRef.current = false }
  const clear = () => {
    const ctx = drawRef.current.getContext('2d')
    ctx.clearRect(0, 0, drawRef.current.width, drawRef.current.height)
    setHasDrawn(false)
  }

  const handleSave = () => {
    if (mode === 'draw') {
      if (!hasDrawn) { onCancel(); return }
      onSave(drawRef.current.toDataURL('image/png'))
    } else {
      // Type mode — render typed text into a canvas
      const c = document.createElement('canvas')
      c.width = canvasW * 2; c.height = canvasH * 2  // 2x for crispness
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#0d1a2e'
      ctx.font = `italic 600 ${type === 'initial' ? 60 : 70}px "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      const display = (type === 'initial' ? typed.split(/\s+/).map(s => s[0] || '').join('') : typed) || ''
      ctx.fillText(display, c.width / 2, c.height / 2)
      onSave(c.toDataURL('image/png'))
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button onClick={() => setMode('draw')}  style={modeBtnStyle(mode === 'draw')}>Draw</button>
        <button onClick={() => setMode('type')}  style={modeBtnStyle(mode === 'type')}>Type</button>
      </div>
      {mode === 'draw' ? (
        <>
          <canvas
            ref={drawRef}
            width={canvasW} height={canvasH}
            style={{ width: '100%', maxWidth: canvasW, height: 'auto', border: `1px dashed ${C.borderDark}`, borderRadius: 6, touchAction: 'none', background: '#fafbfd' }}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={(e) => { e.preventDefault(); start(e.touches[0]) }}
            onTouchMove={(e)  => { e.preventDefault(); move(e.touches[0]) }}
            onTouchEnd={(e)   => { e.preventDefault(); end() }}
          />
          <div style={{ marginTop: 6 }}>
            <button onClick={clear} style={{ background: 'transparent', border: 'none', color: C.textSecondary, fontSize: 12, cursor: 'pointer' }}>Clear</button>
          </div>
        </>
      ) : (
        <>
          <input
            type="text" value={typed} onChange={e => setTyped(e.target.value)}
            placeholder={type === 'initial' ? 'Your initials' : 'Your full name'}
            style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box' }}
          />
          <div style={{
            marginTop: 12, padding: '14px 18px', border: `1px dashed ${C.borderDark}`,
            borderRadius: 6, background: '#fafbfd', textAlign: 'center', minHeight: 60,
            fontFamily: '"Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive',
            fontStyle: 'italic', fontSize: 36, color: C.textPrimary,
          }}>
            {type === 'initial' ? typed.split(/\s+/).map(s => s[0] || '').join('') : (typed || ' ')}
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
        <button onClick={handleSave} style={saveBtnStyle}>Apply</button>
      </div>
    </>
  )
}

function pt(e, canvas) {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
}

function DateEditor({ initialValue, onSave, onCancel }) {
  const [val, setVal] = useState(initialValue || new Date().toISOString().slice(0, 10))
  return (
    <>
      <input
        type="date" value={val} onChange={e => setVal(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
        <button onClick={() => onSave(val)} style={saveBtnStyle}>Apply</button>
      </div>
    </>
  )
}

function TextEditor({ initialValue, onSave, onCancel }) {
  const [val, setVal] = useState(initialValue || '')
  return (
    <>
      <textarea
        value={val} onChange={e => setVal(e.target.value)}
        rows={3}
        style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
        <button onClick={() => onSave(val)} style={saveBtnStyle}>Apply</button>
      </div>
    </>
  )
}

// Decline modal — currently uses window.prompt for simplicity. Can be
// upgraded to a styled modal in a follow-up.
function DeclineConfirm() { return null }

// ─── Shared button styles ──────────────────────────────────────────────

const cancelBtnStyle = {
  background: '#fff', border: `1px solid ${C.borderDark}`, color: C.textSecondary,
  padding: '8px 16px', fontSize: 13, borderRadius: 5, cursor: 'pointer',
}
const saveBtnStyle = {
  background: C.emerald, border: 'none', color: '#fff',
  padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 5, cursor: 'pointer',
}
function modeBtnStyle(active) {
  return {
    flex: 1, padding: '8px 12px', fontSize: 12.5, fontWeight: 500,
    background: active ? '#ecfdf5' : '#fff',
    color: active ? '#1a7a4e' : C.textSecondary,
    border: `1px solid ${active ? '#a7f3d0' : C.border}`,
    borderRadius: 5, cursor: 'pointer',
  }
}
