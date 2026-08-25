// =============================================================================
// ProgramPortalRoot — the Program Manager Portal, mounted at /program-portal.
//
// A program implementer signs in and sees exactly the assessment and project
// records EES has shared with them: the Energy Assessment Report, the work
// steps captured during the assessment, and the photos. Nothing else — no
// search, no record pages, no related lists, no edit controls. It is not our
// software with fewer buttons; it is a different, much smaller surface.
//
// Navigation copies the Property Owner Portal because it works and it reads
// plainly: pick a property, pick a building, see what is underneath. The tree
// is derived from the GRANTS, not from ownership.
//
// Read-only by construction: there is no write path anywhere in this file.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { C, STATUS_CFG } from '../data/constants'
import {
  fetchProgramPortalUserSelf,
  fetchProgramPortalData,
  fetchProgramPortalFileUrl,
  assessmentCounts,
  propertyCounts,
} from '../data/programPortalService'
import { startPortalViewAs } from '../data/projectPortalService'

const ACTIVE_STATUSES = ['Portal User Active', 'Portal User Invited']

const Ico = ({ d, size = 18, w = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)
const IconBolt = <Ico d={<path d="M13 2L4.5 13.5H12L11 22l8.5-11.5H12L13 2z" />} />
const IconBldg = <Ico d={<><path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1H5a1 1 0 01-1-1V10.5z" /><path d="M9 22V12h6v10" /></>} />
const IconDoc  = <Ico d={<><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z" /><path d="M14 3v6h6" /></>} size={15} />

// ─── File URLs are minted on demand, never embedded in the payload ──────────
// Cached per (file, action) for the life of the page, de-duplicated in flight
// so a strip that mounts twice makes one request.
const fileUrlCache = new Map()
const fileUrlInFlight = new Map()
let currentViewAsId = null

async function resolveFileUrls(fileObject, ids, action = 'view') {
  const key = (id) => `${action}:${fileObject}:${id}`
  const missing = ids.filter((id) => !fileUrlCache.has(key(id)) && !fileUrlInFlight.has(key(id)))
  for (const id of missing) {
    const req = fetchProgramPortalFileUrl({ fileObject, fileId: id, action, viewAsPortalUserId: currentViewAsId })
      .then((r) => { fileUrlCache.set(key(id), r?.url || null) })
      .catch(() => { fileUrlCache.set(key(id), null) })
      .finally(() => { fileUrlInFlight.delete(key(id)) })
    fileUrlInFlight.set(key(id), req)
  }
  await Promise.all(ids.map((id) => fileUrlInFlight.get(key(id))).filter(Boolean))
  return ids.reduce((acc, id) => { acc[id] = fileUrlCache.get(key(id)) || null; return acc }, {})
}

function usePhotoUrls(photos) {
  const ids = useMemo(() => (photos || []).map((p) => p.id).filter(Boolean), [photos])
  const joined = ids.join(',')
  const [urls, setUrls] = useState({})
  useEffect(() => {
    let alive = true
    if (!ids.length) { setUrls({}); return undefined }
    resolveFileUrls('photos', ids, 'view').then((m) => { if (alive) setUrls(m) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined])
  return urls
}

// ─── Small shared pieces ────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (!status) return null
  const cfg = STATUS_CFG[status] || { bg: C.page, color: C.textSecondary, dot: C.textMuted }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                   background: cfg.bg, color: cfg.color, padding: '2px 8px', borderRadius: 11 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />{status}
    </span>
  )
}

function DownloadButton({ fileObject, fileId, label = 'Download', canDownload }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  if (!canDownload) return null
  const go = async (e) => {
    e.stopPropagation()
    setBusy(true); setErr(null)
    try {
      const res = await fetchProgramPortalFileUrl({ fileObject, fileId, action: 'download', viewAsPortalUserId: currentViewAsId })
      if (res?.url) window.location.href = res.url
    } catch (e2) {
      setErr(e2?.message || 'Download failed')
    } finally { setBusy(false) }
  }
  return (
    <button onClick={go} disabled={busy}
      style={{ fontSize: 11.5, fontWeight: 600, color: C.emeraldMid, background: 'transparent',
               border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px',
               cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
      {busy ? 'Preparing…' : (err || label)}
    </button>
  )
}

function PhotoStrip({ photos, canDownload }) {
  const urls = usePhotoUrls(photos)
  const [idx, setIdx] = useState(null)
  if (!photos || !photos.length) return null
  const open = idx != null ? photos[idx] : null
  const lbBtn = { color: '#fff', background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 14, cursor: 'pointer' }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0 8px 0' }}>
      {photos.map((p, i) => (
        <div key={p.id} onClick={() => setIdx(i)} title={p.caption}
          style={{ width: 74, height: 56, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                   border: `1px solid ${C.border}`, position: 'relative', background: C.page }}>
          {urls[p.id]
            ? <img src={urls[p.id]} alt={p.caption} loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <div style={{ width: '100%', height: '100%' }} />}
        </div>
      ))}
      {open && (
        <div onClick={() => setIdx(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(7,17,31,.92)', zIndex: 9999,
                   display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          {urls[open.id]
            ? <img src={urls[open.id]} alt={open.caption} onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: '86vw', maxHeight: '72vh', borderRadius: 10, objectFit: 'contain' }} />
            : <div style={{ color: '#fff', fontSize: 13, padding: 40 }}>Loading photo…</div>}
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{open.caption || 'Photo'}</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            <button style={lbBtn} onClick={() => setIdx((idx - 1 + photos.length) % photos.length)}>‹ Prev</button>
            <button style={lbBtn} onClick={() => setIdx(null)}>Close</button>
            <button style={lbBtn} onClick={() => setIdx((idx + 1) % photos.length)}>Next ›</button>
            <DownloadButton fileObject="photos" fileId={open.id} canDownload={canDownload} label="Download original" />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Assessment detail ──────────────────────────────────────────────────────
function AssessmentView({ assessment, canDownload }) {
  const counts = assessmentCounts(assessment)
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: 4, fontSize: 11.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
        {assessment.recordNumber}
      </div>
      <h1 style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary, margin: '0 0 6px' }}>
        {assessment.name || assessment.recordType || 'Energy Assessment'}
      </h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <StatusBadge status={assessment.status} />
        {assessment.assessmentDate && (
          <span style={{ fontSize: 12, color: C.textSecondary }}>
            Assessed {new Date(assessment.assessmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )}
        <span style={{ fontSize: 12, color: C.textMuted }}>
          {counts.steps} step{counts.steps === 1 ? '' : 's'} · {counts.photos} photo{counts.photos === 1 ? '' : 's'}
        </span>
      </div>

      {assessment.workOrders.length === 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 18px', fontSize: 13, color: C.textSecondary }}>
          Nothing has been captured for this assessment yet.
        </div>
      )}

      {assessment.workOrders.map((wo) => (
        <div key={wo.id} style={{ marginBottom: 22 }}>
          {/* Reports */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 14 }}>
            <div style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.textPrimary }}>
              Reports
            </div>
            {wo.reports.length === 0 ? (
              <div style={{ padding: '14px 16px', fontSize: 12.5, color: C.textMuted }}>
                No Energy Assessment Report has been produced for this assessment yet.
              </div>
            ) : wo.reports.map((r) => (
              <div key={r.id} style={{ padding: '11px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: C.textMuted, display: 'flex' }}>{IconDoc}</span>
                <span style={{ flex: 1, fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{r.name}</span>
                <DownloadButton fileObject="documents" fileId={r.id} canDownload={canDownload} />
              </div>
            ))}
          </div>

          {/* Work steps */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
            <div style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.textPrimary }}>
              What was captured
            </div>
            {wo.workSteps.length === 0 && (
              <div style={{ padding: '14px 16px', fontSize: 12.5, color: C.textMuted }}>No work steps recorded.</div>
            )}
            {wo.workSteps.map((s) => (
              <div key={s.id} style={{ padding: '13px 16px', borderTop: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', minWidth: 18 }}>{s.order}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{s.name}</span>
                  <StatusBadge status={s.status} />
                </div>
                {s.notApplicableReason && (
                  <div style={{ fontSize: 12, color: C.textSecondary, paddingLeft: 28, marginBottom: 4 }}>
                    Not applicable — {s.notApplicableReason}
                  </div>
                )}
                <div style={{ paddingLeft: 28 }}>
                  <PhotoStrip photos={s.photos} canDownload={canDownload} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PropertyOverview({ property }) {
  const counts = propertyCounts(property)
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 11.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{property.recordNumber}</div>
      <h1 style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary, margin: '0 0 4px' }}>{property.name}</h1>
      <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 18 }}>
        {[property.city, property.state].filter(Boolean).join(', ')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[['Buildings', counts.buildings], ['Assessments', counts.assessments], ['Photos', counts.photos], ['Reports', counts.reports]].map(([label, value]) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: C.textSecondary }}>Choose a building on the left to see its assessments.</div>
    </div>
  )
}

// ─── Sidebar ────────────────────────────────────────────────────────────────
function Sidebar({ tree, sel, onSelect, user, organization, onSignOut }) {
  const item = (active, depth) => ({
    padding: `7px 14px 7px ${14 + depth * 14}px`, fontSize: 12.5, cursor: 'pointer',
    color: active ? 'rgba(255,255,255,.96)' : 'rgba(255,255,255,.62)',
    background: active ? 'rgba(255,255,255,.06)' : 'transparent',
    borderLeft: active ? `3px solid ${C.emerald}` : '3px solid transparent',
    display: 'flex', alignItems: 'center', gap: 8,
  })
  return (
    <div style={{ width: 260, flexShrink: 0, background: '#07111f', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 14px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: C.emerald, color: '#07111f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{IconBolt}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Energy Efficiency Services</div>
            <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.55)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Program Manager Portal</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {tree.length === 0 && (
          <div style={{ padding: '14px', fontSize: 12, color: 'rgba(255,255,255,.55)' }}>
            No records have been shared with you yet.
          </div>
        )}
        {tree.map((p) => (
          <div key={p.id}>
            <div style={item(sel.pid === p.id && !sel.aid, 0)} onClick={() => onSelect({ pid: p.id })}>
              <span style={{ opacity: .8, display: 'flex' }}>{IconBldg}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </div>
            {p.buildings.map((b) => (
              <div key={b.id}>
                <div style={{ ...item(false, 1), fontSize: 11.5, color: 'rgba(255,255,255,.48)', cursor: 'default' }}>
                  {b.name}
                </div>
                {b.assessments.map((a) => (
                  <div key={a.id} style={item(sel.aid === a.id, 2)}
                    onClick={() => onSelect({ pid: p.id, bid: b.id, aid: a.id })}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.recordNumber}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.9)', fontWeight: 600 }}>{organization || 'Program Manager'}</div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.55)' }}>{user?.full_name || ''}</div>
        <button onClick={onSignOut}
          style={{ marginTop: 8, fontSize: 11.5, color: C.sky, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
          Sign out
        </button>
      </div>
    </div>
  )
}

function Centered({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 14, padding: 24, fontFamily: 'Inter, sans-serif',
                  color: C.textSecondary, fontSize: 13.5, textAlign: 'center' }}>{children}</div>
  )
}

function LoginGate({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSignedIn()
  }
  const input = { width: '100%', padding: '9px 11px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 10, boxSizing: 'border-box' }
  return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <form onSubmit={submit} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 28, width: 340 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: C.emerald, color: '#07111f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{IconBolt}</span>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>Program Manager Portal</div>
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 18 }}>Energy Efficiency Services</div>
        <input style={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input style={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <div style={{ fontSize: 12, color: '#1a5a8a', marginBottom: 10 }}>{err}</div>}
        <button type="submit" disabled={busy}
          style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, color: '#07111f', background: C.emerald, border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

// ─── Root ───────────────────────────────────────────────────────────────────
export default function ProgramPortalRoot() {
  const [phase, setPhase] = useState('loading')   // loading | login | ready | error | notportal
  const [self, setSelf] = useState(null)
  const [data, setData] = useState({ properties: [], organization: '', canDownload: false })
  const [sel, setSel] = useState({ pid: null, bid: null, aid: null })
  const [errMsg, setErrMsg] = useState(null)
  const [viewAs, setViewAs] = useState(null)

  const requestedViewAs = useMemo(() => {
    const q = new URLSearchParams(window.location.search)
    return q.get('as') || null
  }, [])

  const load = useCallback(async () => {
    setPhase('loading')
    try {
      if (requestedViewAs) {
        const started = await startPortalViewAs({ portalUserId: requestedViewAs })
        if (started?.error) {
          setPhase('notportal')
          setErrMsg(started.error === 'not_authorized'
            ? 'Previewing a portal as someone else is limited to system administrators.'
            : 'That portal could not be opened for preview.')
          return
        }
        currentViewAsId = requestedViewAs
        setViewAs({ id: requestedViewAs, label: started.label || 'Program manager' })
        setSelf(null)
      } else {
        const me = await fetchProgramPortalUserSelf()
        if (!me) { setPhase('login'); return }
        if (me.record_type !== 'Program Manager User') {
          setPhase('notportal'); setErrMsg('This login is not set up for the Program Manager Portal.'); return
        }
        if (!ACTIVE_STATUSES.includes(me.status)) {
          setPhase('notportal'); setErrMsg('Your portal access is not active. Contact your EES coordinator.'); return
        }
        currentViewAsId = null
        setSelf(me)
      }

      const d = await fetchProgramPortalData(requestedViewAs)
      if (d.error === 'no_portal_user') {
        setPhase('notportal'); setErrMsg('This account is not set up as a program manager portal user.'); return
      }
      setData(d)
      const first = (d.properties || [])[0]
      setSel({ pid: first ? first.id : null, bid: null, aid: null })
      setPhase('ready')
    } catch (e) {
      setErrMsg(e?.message || 'Failed to load the portal.')
      setPhase('error')
    }
  }, [requestedViewAs])

  useEffect(() => {
    if (!hasSupabaseConfig) { setPhase('error'); setErrMsg('Portal is not configured.'); return }
    load()
  }, [load])

  const signOut = async () => {
    if (viewAs) { window.location.href = '/'; return }
    await supabase.auth.signOut(); setSelf(null); setData({ properties: [], organization: '', canDownload: false }); setPhase('login')
  }

  const { property, assessment } = useMemo(() => {
    const property = (data.properties || []).find((p) => p.id === sel.pid) || (data.properties || [])[0] || null
    let assessment = null
    if (property && sel.aid) {
      for (const b of property.buildings || []) {
        const a = (b.assessments || []).find((x) => x.id === sel.aid)
        if (a) { assessment = a; break }
      }
    }
    return { property, assessment }
  }, [data, sel])

  if (phase === 'loading')   return <Centered>Loading…</Centered>
  if (phase === 'login')     return <LoginGate onSignedIn={load} />
  if (phase === 'notportal') return <Centered>{errMsg}<button onClick={signOut} style={{ fontSize: 12.5, color: C.sky, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Sign out</button></Centered>
  if (phase === 'error')     return <Centered>{errMsg || 'Something went wrong.'}</Centered>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'Inter, sans-serif', background: C.page }}>
      {viewAs && (
        <div style={{ flexShrink: 0, background: '#0d1a2e', color: '#fff', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5 }}>
          <span style={{ background: C.sky, color: '#0d1a2e', fontWeight: 700, fontSize: 10, letterSpacing: '.4px', textTransform: 'uppercase', padding: '3px 7px', borderRadius: 4 }}>
            Internal preview
          </span>
          <span style={{ flex: 1 }}>Viewing the Program Manager Portal as <strong>{viewAs.label}</strong> — their grants, exactly what they see.</span>
          <a href="/" style={{ color: C.emerald, textDecoration: 'underline', whiteSpace: 'nowrap' }}>Exit preview</a>
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <Sidebar tree={data.properties} sel={sel} onSelect={setSel} user={self}
          organization={viewAs ? viewAs.label : data.organization} onSignOut={signOut} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
            <div style={{ fontSize: 13, color: C.textSecondary }}>
              {property ? property.name : 'Shared records'}
              {assessment && <> <span style={{ color: C.textMuted }}>/</span> <span style={{ color: C.textPrimary, fontWeight: 600 }}>{assessment.recordNumber}</span></>}
            </div>
            <div style={{ fontSize: 11.5, color: C.textMuted }}>
              {data.canDownload ? 'Downloads enabled' : 'View only'}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!property && <Centered>No records have been shared with you yet.</Centered>}
            {property && assessment && <AssessmentView assessment={assessment} canDownload={data.canDownload} />}
            {property && !assessment && <PropertyOverview property={property} />}
          </div>
        </div>
      </div>
    </div>
  )
}
