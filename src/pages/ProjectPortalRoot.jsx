// =============================================================================
// ProjectPortalRoot — customer-facing Project Portal
//
// Mounted at /project-portal (and /project-portal/*) via path-based routing in
// main.jsx. Stands alone — no staff sidebar/topbar chrome. A property owner or
// property manager signs in with Supabase Auth; their portal_users row
// (linked by auth_user_id) plus their explicit grants in
// portal_user_property_grants determine what they see. The tree comes from the
// get_portal_project_tracker() RPC.
//
// MODEL: everything is driven by OPPORTUNITY statuses, and opportunities are
// BUILDING-level. Properties have statuses elsewhere in LEAP, but the portal
// does not track them — a property is just a container you click into. Each
// building has its own opportunities (one per record type), each with a
// data-driven stage bar. Navigation: Property → Building.
//
// Re-skinned into the LEAP design system: navy sidebar (#07111f), light page,
// Inter / JetBrains Mono, no red/orange. Program tracks are data-driven — one
// per opportunity record type, labeled as stored, colored from the palette.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { C, CHART_COLORS, STATUS_CFG } from '../data/constants'
import {
  fetchPortalUserSelf,
  fetchProjectTracker,
  fetchPortalCalendar,
  oppPct,
  oppBucket,
  oppForProgram,
  propertyPrograms,
  buildingStatus,
  buildingProgramPct,
  propertyProgramPct,
  propertyCounts,
  workOrderStatusCounts,
  projectStatusCounts,
  opportunityStageCounts,
  findProject,
  workOrdersByUnit,
  buildingUnits,
  unitWorkOrders,
} from '../data/projectPortalService'

function makeColorOf(programs) {
  return (program) => {
    const i = programs.indexOf(program)
    return CHART_COLORS[(i < 0 ? 0 : i) % CHART_COLORS.length]
  }
}

// Status bucket → label + colors (emerald / sky / muted only — no red/orange).
function bucketMeta(bucket) {
  switch (bucket) {
    case 'complete':   return { label: 'Complete',     color: C.emeraldMid,    bg: '#e8f8f2', dot: C.emerald }
    case 'submittal':  return { label: 'In Submittal', color: '#1a5a8a',       bg: '#e8f3fb', dot: C.sky }
    case 'inProgress': return { label: 'In Progress',  color: '#1e466b',       bg: '#e8f1fb', dot: C.sky }
    case 'notStarted': return { label: 'Not Started',  color: C.textSecondary, bg: C.page,    dot: C.textMuted }
    default:           return { label: '—',            color: C.textMuted,     bg: C.page,    dot: C.textMuted }
  }
}

// Building names are stored with the property prefix ("<Property> - Building 1");
// trim it for display when we already show the property in context.
function shortBuildingName(name, propertyName) {
  if (!name) return ''
  if (propertyName && name.startsWith(propertyName + ' - ')) return name.slice(propertyName.length + 3)
  return name
}

// ─── SVG icons (1.5px stroke, no fill, no emoji) ─────────────────────────────
const Ico = ({ d, size = 18, w = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)
const IconBolt = <Ico d={<path d="M13 2L4.5 13.5H12L11 22l8.5-11.5H12L13 2z" />} />
const IconProp = <Ico d={<><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M9 22V12h6v10M9 7h1m4 0h1M9 10h1m4 0h1" /></>} />
const IconBldg = <Ico d={<><path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1H5a1 1 0 01-1-1V10.5z" /><path d="M9 22V12h6v10" /></>} />
const IconChevR = <Ico d={<polyline points="9 18 15 12 9 6" />} size={12} w={1.8} />
const IconSearch = <Ico d={<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></>} size={13} />

// Stage labels are stored long-form ("Opportunity — HEAR Income Qualification");
// strip the generic "Opportunity — " lead-in for the dots.
function shortStageLabel(label) {
  if (!label) return ''
  return label.replace(/^\s*Opportunity\s*[—–-]\s*/i, '').trim() || label
}

// ─── Progress primitives ─────────────────────────────────────────────────────
function Bar({ pct, color, h = 5 }) {
  return (
    <div style={{ flex: 1, height: h, background: C.border, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 10, transition: 'width .25s ease' }} />
    </div>
  )
}

// One mini bar per program (record type) for a tree node.
function MiniTracks({ programs, colorOf, pctOf }) {
  if (!programs.length) return <div style={{ width: 56, flexShrink: 0 }} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 56, flexShrink: 0 }}>
      {programs.map((pg) => {
        const v = pctOf(pg)
        return (
          <div key={pg} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,.12)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${v ?? 0}%`, background: colorOf(pg), borderRadius: 10 }} />
            </div>
            <span style={{ fontSize: 8.5, fontWeight: 600, color: C.navInactive, width: 20, textAlign: 'right' }}>{v == null ? '—' : `${v}%`}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Data-driven stage bar (one dot per assigned stage) ──────────────────────
function StageBar({ opp, accent }) {
  const stages = opp?.stages || []
  const count = stages.length
  const stageOrder = opp?.stageOrder || 0
  if (count === 0) {
    return <div style={{ fontSize: 12, color: C.textMuted }}>No stage lifecycle is configured for this record type yet.</div>
  }
  const pct = Math.round(stageOrder / count * 100)
  return (
    <div style={{ margin: '6px 0 2px' }}>
      <div style={{ position: 'relative', height: 4, background: C.border, borderRadius: 10, marginBottom: 56 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: accent, borderRadius: 10, transition: 'width .25s ease' }} />
        <div style={{ position: 'absolute', top: -8, left: 0, right: 0, display: 'flex', justifyContent: 'space-between' }}>
          {stages.map((s) => {
            const phase = s.sortOrder
            const done = stageOrder >= phase
            const current = stageOrder === phase
            return (
              <div key={phase} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20 }}>
                <div title={s.label} style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: done ? accent : C.card,
                  border: `2px solid ${done ? accent : C.borderDark}`,
                  color: done ? '#fff' : C.textMuted,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700,
                  boxShadow: current ? `0 0 0 3px ${accent}33` : 'none',
                }}>
                  {done ? '✓' : phase}
                </div>
                <div title={s.label} style={{
                  fontSize: 8.5, color: current ? C.textPrimary : C.textMuted,
                  fontWeight: current ? 700 : 500, marginTop: 4, textAlign: 'center',
                  width: 60, lineHeight: 1.15,
                }}>
                  {shortStageLabel(s.label)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Tree sidebar (Property → Building) ──────────────────────────────────────
function TreeSidebar({ tree, sel, open, setOpen, onSelect, query, setQuery, user, onSignOut, view, setView }) {
  const q = (query || '').toLowerCase()
  const matchBldg = (b, pName) => !q || (shortBuildingName(b.name, pName) + ' ' + b.name).toLowerCase().includes(q)
  const navItem = (active) => ({
    flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600, padding: '7px 0', cursor: 'pointer', borderRadius: 6,
    color: active ? '#fff' : C.navInactive, background: active ? 'rgba(62,207,142,.18)' : 'transparent',
    border: `1px solid ${active ? 'rgba(62,207,142,.5)' : 'rgba(255,255,255,.1)'}`,
  })

  return (
    <nav style={{ width: 272, background: C.sidebar, display: 'flex', flexDirection: 'column', height: '100vh', flexShrink: 0 }}>
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 28, height: 28, background: C.emerald, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{IconBolt}</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Energy Efficiency Services</div>
            <div style={{ fontSize: 10, color: C.navInactive, letterSpacing: '.5px', textTransform: 'uppercase' }}>Multi-Family Project Portal</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={navItem(view === 'tree')} onClick={() => setView('tree')}>Projects</div>
        <div style={navItem(view === 'calendar')} onClick={() => setView('calendar')}>Calendar</div>
      </div>

      {view === 'tree' && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: C.navInactive, display: 'flex' }}>{IconSearch}</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search buildings…"
              style={{ width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 6, padding: '7px 8px 7px 28px', color: '#fff', fontSize: 12, outline: 'none', fontFamily: 'inherit' }} />
          </div>
        </div>
      )}

      {view !== 'tree' && (
        <div style={{ flex: 1, padding: '22px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 11.5, color: C.navInactive, lineHeight: 1.5 }}>
            Calendar shows site visits across all your properties.<br />
            Switch to <strong style={{ color: '#fff' }}>Projects</strong> to browse buildings and units.
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0', display: view === 'tree' ? 'block' : 'none' }}>
        {tree.map((p) => {
          const programs = propertyPrograms(p)
          const colorOf = makeColorOf(programs)
          const pOpen = open.prop === p.id
          const pActive = sel.pid === p.id && !sel.bid
          return (
            <div key={p.id}>
              <div onClick={() => onSelect({ pid: p.id })}
                style={{ display: 'flex', alignItems: 'center', padding: '7px 10px 7px 8px', cursor: 'pointer',
                  borderLeft: `3px solid ${pActive ? C.emerald : 'transparent'}`,
                  background: pActive ? 'rgba(62,207,142,.16)' : 'transparent' }}>
                <span onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, prop: o.prop === p.id ? null : p.id })) }}
                  style={{ width: 18, display: 'flex', justifyContent: 'center', color: C.navInactive, transform: pOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>{IconChevR}</span>
                <span style={{ color: C.navInactive, marginRight: 6, display: 'flex' }}>{IconProp}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: C.navInactive }}>{(p.buildings || []).length} buildings</div>
                </div>
                <MiniTracks programs={programs} colorOf={colorOf} pctOf={(pg) => propertyProgramPct(p, pg)} />
              </div>

              {pOpen && (p.buildings || []).filter((b) => matchBldg(b, p.name)).map((b) => {
                const bKey = `${p.id}:${b.id}`
                const bOpen = open.bldg === bKey
                const bActive = sel.bid === b.id && !sel.uid
                const meta = bucketMeta(buildingStatus(b))
                const units = buildingUnits(b)
                return (
                  <div key={b.id}>
                    <div onClick={() => onSelect({ pid: p.id, bid: b.id })}
                      style={{ display: 'flex', alignItems: 'center', padding: '6px 10px 6px 22px', cursor: 'pointer',
                        borderLeft: `3px solid ${bActive ? C.sky : 'transparent'}`,
                        background: bActive ? 'rgba(126,179,232,.16)' : 'transparent' }}>
                      <span onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, bldg: o.bldg === bKey ? null : bKey })) }}
                        style={{ width: 16, display: 'flex', justifyContent: 'center', color: C.navInactive, transform: bOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', opacity: units.length ? 1 : 0 }}>{IconChevR}</span>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.dot, margin: '0 8px 0 2px', flexShrink: 0 }} />
                      <span style={{ color: 'rgba(255,255,255,.45)', marginRight: 6, display: 'flex' }}>{IconBldg}</span>
                      <span style={{ flex: 1, fontSize: 12, color: bActive ? '#fff' : 'rgba(255,255,255,.8)', fontWeight: bActive ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortBuildingName(b.name, p.name)}</span>
                      <MiniTracks programs={programs} colorOf={colorOf} pctOf={(pg) => buildingProgramPct(b, pg)} />
                    </div>

                    {bOpen && units.map((u) => {
                      const uActive = sel.uid === u.unitId
                      return (
                        <div key={u.unitId} onClick={() => onSelect({ pid: p.id, bid: b.id, uid: u.unitId })}
                          style={{ display: 'flex', alignItems: 'center', padding: '4px 10px 4px 50px', cursor: 'pointer',
                            borderLeft: `3px solid ${uActive ? C.emerald : 'transparent'}`,
                            background: uActive ? 'rgba(62,207,142,.14)' : 'transparent' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,.4)', marginRight: 8, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 11.5, color: uActive ? '#fff' : 'rgba(255,255,255,.66)', fontWeight: uActive ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Unit {u.unitNumber}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
        {tree.length === 0 && <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: C.navInactive }}>No properties assigned</div>}
      </div>

      <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: C.emerald, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
          {(user?.full_name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: '#fff', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.full_name || ''}</div>
          <div style={{ fontSize: 10, color: C.navInactive }}>{user?.portal_role || 'Portal User'}</div>
        </div>
        <button onClick={onSignOut} style={{ fontSize: 11, color: C.navInactive, background: 'transparent', border: '1px solid rgba(255,255,255,.14)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>Sign Out</button>
      </div>
    </nav>
  )
}

// ─── Shared bits ──────────────────────────────────────────────────────────────
function Crumb({ items }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.textSecondary }}>
      {items.map((c, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span style={{ color: C.textMuted }}>/</span>}
          <span onClick={c.onClick} style={{ cursor: c.onClick ? 'pointer' : 'default', color: c.onClick ? C.emeraldMid : C.textPrimary, fontWeight: c.onClick ? 500 : 700 }}>{c.label}</span>
        </span>
      ))}
    </div>
  )
}

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${accent}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent, lineHeight: 1, letterSpacing: '-0.5px' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ title, desc, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, paddingBottom: 10, borderBottom: `2px solid ${C.border}` }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{title}</div>
        {desc && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{desc}</div>}
      </div>
      {action && <span style={{ fontSize: 12, color: C.textSecondary }}>{action}</span>}
    </div>
  )
}

// Status badge for projects / work orders (LEAP status palette; neutral fallback).
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { bg: C.page, color: C.textSecondary, dot: C.textMuted }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: cfg.color, background: cfg.bg, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot }} />{status || '—'}
    </span>
  )
}

// Work-step photo thumbnails with a click-to-open lightbox.
function PhotoStrip({ photos }) {
  const [idx, setIdx] = useState(null)
  if (!photos || !photos.length) return null
  const open = idx != null ? photos[idx] : null
  const lbBtn = { color: '#fff', background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 14, cursor: 'pointer' }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px 0 6px 26px' }}>
      {photos.map((p, i) => (
        <div key={p.id} onClick={() => setIdx(i)} title={p.caption}
          style={{ width: 66, height: 50, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: `1px solid ${C.border}`, position: 'relative' }}>
          <img src={p.thumb} alt={p.caption} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          {p.type && <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: 8, fontWeight: 700, color: '#fff', background: 'rgba(13,26,46,.6)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '.3px' }}>{p.type}</span>}
        </div>
      ))}
      {open && (
        <div onClick={() => setIdx(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(7,17,31,.92)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <img src={open.url} alt={open.caption} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '86vw', maxHeight: '76vh', borderRadius: 10, objectFit: 'contain' }} />
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{open.caption}{open.type ? ` · ${open.type}` : ''}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={lbBtn} onClick={(e) => { e.stopPropagation(); setIdx((idx - 1 + photos.length) % photos.length) }}>‹ Prev</button>
            <button style={lbBtn} onClick={(e) => { e.stopPropagation(); setIdx(null) }}>Close</button>
            <button style={lbBtn} onClick={(e) => { e.stopPropagation(); setIdx((idx + 1) % photos.length) }}>Next ›</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ProgRow({ program, pct, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <span style={{ width: 132, fontWeight: 600, color, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={program}>{program}</span>
      <Bar pct={pct ?? 0} color={color} />
      <span style={{ width: 34, fontSize: 11, fontWeight: 600, color: C.textSecondary, textAlign: 'right' }}>{pct == null ? '—' : `${pct}%`}</span>
    </div>
  )
}

function ProgramLegend({ programs, colorOf }) {
  if (programs.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
      {programs.map((pg) => (
        <span key={pg} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.textSecondary }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: colorOf(pg) }} />
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{pg}</span>
        </span>
      ))}
    </div>
  )
}

// ─── Property page (container: lists buildings + their statuses) ─────────────
function KpiCard({ label, value, accent }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${accent || C.borderDark}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: C.textPrimary, lineHeight: 1, letterSpacing: '-0.5px' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 5 }}>{label}</div>
    </div>
  )
}

function StatusBreakdown({ title, items }) {
  const total = items.reduce((a, i) => a + i.count, 0)
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{title}</div>
      {items.length === 0 && <div style={{ padding: 16, fontSize: 12, color: C.textMuted }}>None yet.</div>}
      {items.map((i) => {
        const cfg = STATUS_CFG[i.status] || { dot: C.textMuted }
        const pct = total ? Math.round(i.count / total * 100) : 0
        return (
          <div key={i.status} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
            <span style={{ flex: 1, color: C.textSecondary }}>{i.status}</span>
            <div style={{ width: 90 }}><Bar pct={pct} color={cfg.dot || C.sky} /></div>
            <span style={{ width: 28, textAlign: 'right', fontWeight: 700, color: C.textPrimary }}>{i.count}</span>
          </div>
        )
      })}
    </div>
  )
}

function PropertyPage({ property, programs, colorOf, onOpenBuilding }) {
  const counts = propertyCounts(property)
  const woStatuses = workOrderStatusCounts(property)
  const projStatuses = projectStatusCounts(property)
  const oppStages = opportunityStageCounts(property)
  return (
    <div style={{ padding: 22, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ background: `linear-gradient(135deg, ${C.sidebar} 0%, #12243d 100%)`, borderRadius: 12, padding: '20px 24px', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 48, height: 48, background: 'rgba(62,207,142,.25)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>{IconProp}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: '.6px', textTransform: 'uppercase', color: C.navInactive, marginBottom: 3 }}>Property Dashboard</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{property.name}</div>
          <div style={{ fontSize: 12.5, color: C.navInactive, marginTop: 3 }}>{[property.city, property.state].filter(Boolean).join(', ')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {programs.map((pg) => {
              const v = propertyProgramPct(property, pg)
              return (
                <span key={pg} style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.85)', border: '1px solid rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorOf(pg) }} />{pg} {v == null ? '—' : `${v}%`}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {/* KPI row — real counts, high level → low level */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 28 }}>
        <KpiCard label="Opportunities" value={counts.opportunities} accent={C.sky} />
        <KpiCard label="Buildings" value={counts.buildings} accent={C.emerald} />
        <KpiCard label="Projects" value={counts.projects} accent={C.sky} />
        <KpiCard label="Units" value={counts.units} accent={C.emerald} />
        <KpiCard label="Work Orders" value={counts.workOrders} accent={C.emeraldMid} />
      </div>

      {/* Opportunities by stage — concrete counts, not an abstract average */}
      <div style={{ marginBottom: 28 }}>
        <SectionHeader title="Opportunities by Stage" desc="How many program opportunities sit at each stage across this property" />
        <StatusBreakdown title="Opportunities" items={oppStages.map((i) => ({ status: shortStageLabel(i.status), count: i.count }))} />
      </div>

      {/* Work order + project status rollups */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 30 }}>
        <StatusBreakdown title="Work Orders by Status" items={woStatuses} />
        <StatusBreakdown title="Projects by Status" items={projStatuses} />
      </div>

      <div>
        <SectionHeader title="Buildings" desc="Click a building to see its opportunities, projects and work orders" action={`${(property.buildings || []).length} buildings`} />
        <ProgramLegend programs={programs} colorOf={colorOf} />
        <div style={{ display: 'grid', gap: 12 }}>
          {(property.buildings || []).map((b) => {
            const meta = bucketMeta(buildingStatus(b))
            return (
              <div key={b.id} onClick={() => onOpenBuilding(b)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 40, height: 40, background: C.page, border: `1px solid ${C.border}`, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.emerald, flexShrink: 0 }}>{IconBldg}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{shortBuildingName(b.name, property.name)}</div>
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 8 }}>{b.unitCount} unit{b.unitCount === 1 ? '' : 's'} · {(b.opportunities || []).length} opportunit{(b.opportunities || []).length === 1 ? 'y' : 'ies'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 460 }}>
                    {programs.map((pg) => {
                      const has = oppForProgram(b, pg)
                      return has ? <ProgRow key={pg} program={pg} pct={buildingProgramPct(b, pg)} color={colorOf(pg)} /> : null
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: meta.color, background: meta.bg, padding: '2px 8px', borderRadius: 10 }}>{meta.label}</span>
                  <span style={{ fontSize: 11.5, color: C.emeraldMid, fontWeight: 600 }}>View detail →</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Building page (its opportunities, each a data-driven stage bar) ─────────
function OpportunityCard({ program, opp, color, onOpenProject }) {
  const count = (opp?.stages || []).length
  const so = opp?.stageOrder || 0
  const projects = opp?.projects || []
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 9, background: `${color}14` }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{program}</span>
        {opp && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{opp.recordNumber}</span>}
      </div>
      <div style={{ padding: '20px 22px 16px' }}>
        <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 16 }}>
          Current stage: <strong style={{ color: C.textPrimary }}>{shortStageLabel(opp.stageLabel)}</strong>
        </div>
        <StageBar opp={opp} accent={color} />
        <div style={{ marginTop: 8, fontSize: 12, color: C.textSecondary }}>
          {count > 0 && so >= count ? 'All program phases are complete.'
            : so > 0 ? `Phase ${so} of ${count} — ${oppPct(opp)}% through the program lifecycle.`
            : 'This program has not started yet.'}
        </div>

        {projects.length > 0 && (
          <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: C.textMuted, marginBottom: 8 }}>Projects</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {projects.map((pr) => (
                <div key={pr.id} onClick={() => onOpenProject(pr)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', background: C.page }}>
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pr.recordType || pr.name}</span>
                  <StatusBadge status={pr.status} />
                  <span style={{ fontSize: 11, color: C.textMuted, width: 52, textAlign: 'right' }}>{pr.workOrders.length} WO</span>
                  <span style={{ fontSize: 13, color: C.emeraldMid, fontWeight: 700 }}>→</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BuildingPage({ property, building, colorOf, onOpenProject }) {
  const opps = building.opportunities || []
  return (
    <div style={{ padding: 22, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary }}>{shortBuildingName(building.name, property.name)}</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 20 }}>{property.name}{building.address ? ` · ${building.address}` : ''}</div>
      {opps.map((o) => <OpportunityCard key={o.id} program={o.program} opp={o} color={colorOf(o.program)} onOpenProject={(pr) => onOpenProject(pr)} />)}
      {opps.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>No opportunities recorded for this building yet.</div>}
    </div>
  )
}

// ─── Project page (work orders grouped by unit; each WO expands to work steps) ─
function WorkOrderRow({ wo }) {
  const [open, setOpen] = useState(false)
  const steps = wo.workSteps || []
  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <div onClick={() => steps.length && setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', fontSize: 12.5, cursor: steps.length ? 'pointer' : 'default' }}>
        <span style={{ width: 14, display: 'flex', justifyContent: 'center', color: C.textMuted, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', opacity: steps.length ? 1 : 0 }}>{IconChevR}</span>
        <span style={{ flex: 1, color: C.textSecondary, fontFamily: 'JetBrains Mono, monospace' }}>{wo.recordType || wo.name}</span>
        <span style={{ fontSize: 11, color: C.textMuted }}>{steps.length ? `${steps.length} steps` : ''}</span>
        <StatusBadge status={wo.status} />
      </div>
      {open && steps.length > 0 && (
        <div style={{ background: C.page, padding: '4px 16px 10px 30px' }}>
          {steps.map((s) => (
            <div key={s.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 12 }}>
                <span style={{ width: 18, fontSize: 10, color: C.textMuted, fontWeight: 600 }}>{s.order}</span>
                <span style={{ flex: 1, color: C.textSecondary }}>{s.name}</span>
                {s.photos.length > 0 && <span style={{ fontSize: 10, color: C.emeraldMid }}>{s.photos.length} photo{s.photos.length === 1 ? '' : 's'}</span>}
                <StatusBadge status={s.status} />
              </div>
              <PhotoStrip photos={s.photos} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectPage({ property, building, project, opportunity, color }) {
  const groups = workOrdersByUnit(project)
  return (
    <div style={{ padding: 22, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{project.recordType || project.name}</span>
        <StatusBadge status={project.status} />
      </div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 20 }}>{shortBuildingName(building.name, property.name)} · {opportunity.program}</div>

      <SectionHeader title="Work Orders by Unit" desc="Open a work order to see its work steps and their status" />
      {groups.map((g) => (
        <div key={g.unitId || 'none'} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{g.unitNumber ? `Unit ${g.unitNumber}` : 'Building-level'}</div>
          {g.workOrders.map((w) => <WorkOrderRow key={w.id} wo={w} />)}
        </div>
      ))}
      {groups.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>No work orders on this project yet.</div>}
    </div>
  )
}

// ─── Unit page (this unit's work orders → steps → photos) ────────────────────
function UnitPage({ property, building, unit, colorOf }) {
  const wos = unitWorkOrders(building, unit.unitId)
  // group by program + project
  const groups = []
  const seen = new Map()
  for (const w of wos) {
    const key = `${w.program}|${w.projectRecordType}`
    if (!seen.has(key)) { const g = { program: w.program, project: w.projectRecordType, wos: [] }; seen.set(key, g); groups.push(g) }
    seen.get(key).wos.push(w)
  }
  return (
    <div style={{ padding: 22, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary }}>Unit {unit.unitNumber}</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 20 }}>{property.name} · {shortBuildingName(building.name, property.name)}</div>

      {groups.map((g) => (
        <div key={g.program + g.project} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorOf(g.program) }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{g.program}</span>
            <span style={{ fontSize: 12, color: C.textMuted }}>·</span>
            <span style={{ fontSize: 12.5, color: C.textSecondary, fontFamily: 'JetBrains Mono, monospace' }}>{g.project}</span>
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {g.wos.map((w) => <WorkOrderRow key={w.id} wo={w} />)}
          </div>
        </div>
      ))}
      {groups.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>No work orders for this unit yet.</div>}
    </div>
  )
}

// ─── Calendar (site visits) ──────────────────────────────────────────────────
function apptStatusColor(status) {
  if (/complete/i.test(status)) return C.emerald
  if (/cancel|no-?show|cannot/i.test(status)) return C.textMuted
  return C.sky
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function dayKey(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
function lastSeg(name) { const parts = String(name || '').split(' - '); return parts[parts.length - 1] }
function fmtTime(s) { return new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }

// .ics (iCalendar) export for "add to calendar"
function icsStamp(s) { return new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') }
function icsEsc(t) { return String(t || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n') }
function downloadICS(appts, filename) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EES//Project Portal//EN', 'CALSCALE:GREGORIAN']
  for (const a of appts) {
    if (!a.start) continue
    const loc = [a.buildingAddress || lastSeg(a.buildingName), a.unitNumber ? `Unit ${a.unitNumber}` : '', a.propertyAddress].filter(Boolean).join(', ')
    L.push('BEGIN:VEVENT', `UID:${a.id}@ees-portal`, `DTSTART:${icsStamp(a.start)}`, `DTEND:${icsStamp(a.end || a.start)}`,
      `SUMMARY:${icsEsc(a.subject)}`, `LOCATION:${icsEsc(loc)}`, `DESCRIPTION:${icsEsc('Status: ' + (a.status || ''))}`, 'END:VEVENT')
  }
  L.push('END:VCALENDAR')
  const blob = new Blob([L.join('\r\n')], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const el = document.createElement('a'); el.href = url; el.download = filename
  document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url)
}

function apptLocation(a) {
  return [a.buildingAddress || lastSeg(a.buildingName), a.unitNumber ? `Unit ${a.unitNumber}` : '', a.propertyAddress].filter(Boolean).join(', ')
}
function googleCalUrl(a) {
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(a.subject)}`
    + `&dates=${icsStamp(a.start)}/${icsStamp(a.end || a.start)}`
    + `&details=${encodeURIComponent('Status: ' + (a.status || ''))}`
    + `&location=${encodeURIComponent(apptLocation(a))}`
}
function outlookCalUrl(a) {
  return 'https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent'
    + `&subject=${encodeURIComponent(a.subject)}`
    + `&startdt=${encodeURIComponent(new Date(a.start).toISOString())}`
    + `&enddt=${encodeURIComponent(new Date(a.end || a.start).toISOString())}`
    + `&body=${encodeURIComponent('Status: ' + (a.status || ''))}`
    + `&location=${encodeURIComponent(apptLocation(a))}`
}

// "Add to Calendar" menu — deep-links into Google/Outlook, .ics fallback.
function AddToCalendar({ appt }) {
  const [open, setOpen] = useState(false)
  const item = { display: 'block', width: '100%', textAlign: 'left', fontSize: 12, color: C.textSecondary, background: 'transparent', border: 'none', padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }
  const go = (fn) => (e) => { e.stopPropagation(); fn(); setOpen(false) }
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        style={{ fontSize: 11, fontWeight: 600, color: C.emeraldMid, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Add to calendar ▾</button>
      {open && (
        <>
          <div onClick={go(() => {})} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 51, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(13,26,46,.14)', overflow: 'hidden', minWidth: 188 }}>
            <button style={item} onClick={go(() => window.open(googleCalUrl(appt), '_blank', 'noopener'))}>Google Calendar</button>
            <button style={item} onClick={go(() => window.open(outlookCalUrl(appt), '_blank', 'noopener'))}>Outlook</button>
            <button style={{ ...item, borderTop: `1px solid ${C.border}` }} onClick={go(() => downloadICS([appt], 'site-visit.ics'))}>Apple / download (.ics)</button>
          </div>
        </>
      )}
    </div>
  )
}

function CalendarView({ appointments, onOpenVisit }) {
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const [anchor, setAnchor] = useState(startOfToday)
  const [mode, setMode] = useState('month')       // month | week
  const [colorBy, setColorBy] = useState('status') // status | type
  const [propId, setPropId] = useState('all')
  const [bldgId, setBldgId] = useState('all')
  const [statusId, setStatusId] = useState('all')
  const [selDay, setSelDay] = useState(null)

  // option lists
  const propMap = new Map()
  appointments.forEach((a) => { if (a.propertyId && !propMap.has(a.propertyId)) propMap.set(a.propertyId, { id: a.propertyId, name: a.propertyName, address: a.propertyAddress }) })
  const propOptions = Array.from(propMap.values())
  const bldgMap = new Map()
  appointments.filter((a) => propId === 'all' || a.propertyId === propId).forEach((a) => { if (a.buildingId && !bldgMap.has(a.buildingId)) bldgMap.set(a.buildingId, { id: a.buildingId, name: lastSeg(a.buildingName), address: a.buildingAddress }) })
  const bldgOptions = Array.from(bldgMap.values())
  const statuses = Array.from(new Set(appointments.map((a) => a.status).filter(Boolean)))
  const types = Array.from(new Set(appointments.map((a) => a.workOrderType).filter(Boolean))).sort()
  const typeColor = (t) => CHART_COLORS[Math.max(0, types.indexOf(t)) % CHART_COLORS.length]
  const colorFor = (a) => colorBy === 'type' ? typeColor(a.workOrderType) : apptStatusColor(a.status)

  const filtered = appointments.filter((a) => a.start &&
    (propId === 'all' || a.propertyId === propId) &&
    (bldgId === 'all' || a.buildingId === bldgId) &&
    (statusId === 'all' || a.status === statusId))

  const byDay = {}
  for (const a of filtered) { const k = dayKey(new Date(a.start)); (byDay[k] = byDay[k] || []).push(a) }

  // this-week banner (Sun–Sat of today) + upcoming count
  const weekStart = new Date(startOfToday); weekStart.setDate(startOfToday.getDate() - startOfToday.getDay())
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7)
  const thisWeek = filtered.filter((a) => { const d = new Date(a.start); return d >= weekStart && d < weekEnd }).length
  const upcoming = filtered.filter((a) => new Date(a.start) >= startOfToday).sort((a, b) => new Date(a.start) - new Date(b.start))

  // grid days
  let gridDays = []
  if (mode === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const dim = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
    for (let i = 0; i < first.getDay(); i++) gridDays.push(null)
    for (let d = 1; d <= dim; d++) gridDays.push(new Date(anchor.getFullYear(), anchor.getMonth(), d))
    while (gridDays.length % 7 !== 0) gridDays.push(null)
  } else {
    const ws = new Date(anchor); ws.setDate(anchor.getDate() - anchor.getDay())
    for (let i = 0; i < 7; i++) { const d = new Date(ws); d.setDate(ws.getDate() + i); gridDays.push(d) }
  }
  const title = mode === 'month'
    ? anchor.toLocaleString('en-US', { month: 'long', year: 'numeric' })
    : (() => { const ws = gridDays[0], we = gridDays[6]; return `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` })()
  const shift = (delta) => {
    const d = new Date(anchor)
    if (mode === 'month') d.setMonth(d.getMonth() + delta); else d.setDate(d.getDate() + delta * 7)
    setAnchor(d); setSelDay(null)
  }
  const isSameDay = (d) => d && dayKey(d) === dayKey(today)
  const selAppts = selDay ? (byDay[selDay] || []) : []
  const navBtn = { fontSize: 12, color: C.textSecondary, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }
  const selStyle = { fontSize: 12.5, color: C.textPrimary, background: C.card, border: `1px solid ${C.borderDark}`, borderRadius: 6, padding: '6px 9px', outline: 'none' }
  const seg = (active) => ({ fontSize: 12, fontWeight: 600, padding: '5px 11px', cursor: 'pointer', color: active ? '#fff' : C.textSecondary, background: active ? C.emeraldMid : C.card, border: `1px solid ${active ? C.emeraldMid : C.border}` })
  const legendItems = colorBy === 'status' ? statuses.map((s) => ({ label: s, color: apptStatusColor(s) })) : types.map((t) => ({ label: t, color: typeColor(t) }))

  const Chip = ({ a }) => (
    <div onClick={(e) => { e.stopPropagation(); onOpenVisit && onOpenVisit(a) }}
      title={`${a.subject} · ${a.status}`}
      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: C.textSecondary, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: colorFor(a), flexShrink: 0 }} />
      {a.unitNumber ? `U${a.unitNumber} ` : ''}{a.workOrderType || a.subject}
    </div>
  )

  return (
    <div style={{ padding: 22, maxWidth: 1180, margin: '0 auto' }}>
      {/* Controls — row 1: title + nav + view toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, minWidth: 190 }}>{title}</div>
        <button style={navBtn} onClick={() => shift(-1)}>‹ Prev</button>
        <button style={navBtn} onClick={() => { setAnchor(startOfToday); setSelDay(null) }}>Today</button>
        <button style={navBtn} onClick={() => shift(1)}>Next ›</button>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', marginLeft: 6 }}>
          <div style={{ ...seg(mode === 'month'), borderRadius: '6px 0 0 6px' }} onClick={() => setMode('month')}>Month</div>
          <div style={{ ...seg(mode === 'week'), borderRadius: '0 6px 6px 0', borderLeft: 'none' }} onClick={() => setMode('week')}>Week</div>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textSecondary }}>
          <strong style={{ color: C.textPrimary }}>{thisWeek}</strong> this week · <strong style={{ color: C.textPrimary }}>{upcoming.length}</strong> upcoming
        </span>
      </div>

      {/* Controls — row 2: filters + color-by + export */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: C.textMuted }}>Property</span>
          <select style={selStyle} value={propId} onChange={(e) => { setPropId(e.target.value); setBldgId('all') }}>
            <option value="all">All properties</option>
            {propOptions.map((o) => <option key={o.id} value={o.id}>{o.address ? `${o.name} — ${o.address}` : o.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: C.textMuted }}>Building</span>
          <select style={selStyle} value={bldgId} onChange={(e) => setBldgId(e.target.value)}>
            <option value="all">All buildings</option>
            {bldgOptions.map((o) => <option key={o.id} value={o.id}>{o.address ? `${o.address} (${o.name})` : o.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: C.textMuted }}>Status</span>
          <select style={selStyle} value={statusId} onChange={(e) => setStatusId(e.target.value)}>
            <option value="all">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: C.textMuted }}>Color by</span>
          <select style={selStyle} value={colorBy} onChange={(e) => setColorBy(e.target.value)}>
            <option value="status">Status</option>
            <option value="type">Work-order type</option>
          </select>
        </label>
        <button style={{ ...navBtn, marginLeft: 'auto' }} disabled={!upcoming.length}
          onClick={() => downloadICS(upcoming, 'ees-upcoming-site-visits.ics')} title="Downloads all upcoming visits as one .ics file (imports into Google, Outlook, or Apple Calendar)">⤓ Download all (.ics)</button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 12 }}>
        {legendItems.map((it) => (
          <span key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.textSecondary }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color }} />{it.label}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: `1px solid ${C.border}` }}>
          {WEEKDAYS.map((w) => <div key={w} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.4px' }}>{w}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {gridDays.map((d, i) => {
            const k = d ? dayKey(d) : null
            const appts = k ? (byDay[k] || []) : []
            const active = selDay && selDay === k
            const cap = mode === 'week' ? 99 : 3
            return (
              <div key={i} onClick={() => d && setSelDay(k)}
                style={{ minHeight: mode === 'week' ? 220 : 92, borderRight: (i % 7 !== 6) ? `1px solid ${C.border}` : 'none', borderBottom: `1px solid ${C.border}`,
                  padding: 6, cursor: d ? 'pointer' : 'default', background: active ? '#eef5ff' : (d ? C.card : C.page) }}>
                {d && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: 22, height: 22, borderRadius: '50%', fontSize: 11.5, fontWeight: isSameDay(d) ? 700 : 500, color: isSameDay(d) ? '#fff' : C.textSecondary, background: isSameDay(d) ? C.emerald : 'transparent', marginBottom: 3 }}>{d.getDate()}</div>
                    {appts.slice(0, cap).map((a) => <Chip key={a.id} a={a} />)}
                    {appts.length > cap && <div style={{ fontSize: 9, color: C.textMuted }}>+{appts.length - cap} more</div>}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected-day detail */}
      {selDay && (
        <div style={{ marginTop: 16 }}>
          <SectionHeader title={`Visits — ${new Date(selAppts[0]?.start || today).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`} desc={`${selAppts.length} site visit${selAppts.length === 1 ? '' : 's'}`} />
          {selAppts.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>No site visits this day.</div>}
          {selAppts.map((a) => <VisitRow key={a.id} a={a} onOpenVisit={onOpenVisit} />)}
        </div>
      )}

      {/* Upcoming agenda */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Upcoming Visits" desc="Next scheduled site visits across your filters" action={`${upcoming.length} upcoming`} />
        {upcoming.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>No upcoming visits.</div>}
        {upcoming.slice(0, 25).map((a) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 70, flexShrink: 0, textAlign: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 0' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.sky }}>{new Date(a.start).toLocaleDateString('en-US', { month: 'short' })}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, lineHeight: 1 }}>{new Date(a.start).getDate()}</div>
            </div>
            <div style={{ flex: 1 }}><VisitRow a={a} onOpenVisit={onOpenVisit} showAdd /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function VisitRow({ a, onOpenVisit, showAdd }) {
  const color = apptStatusColor(a.status)
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <div onClick={() => onOpenVisit && onOpenVisit(a)} style={{ flex: 1, minWidth: 0, cursor: onOpenVisit ? 'pointer' : 'default' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{a.subject}</div>
        <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 2 }}>
          {fmtTime(a.start)}{a.end ? `–${fmtTime(a.end)}` : ''}
          {' · '}{a.buildingAddress || lastSeg(a.buildingName)}{a.unitNumber ? ` · Unit ${a.unitNumber}` : ''}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{a.propertyName}{a.propertyAddress ? ` · ${a.propertyAddress}` : ''}</div>
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 600, color, background: `${color}1a`, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{a.status || '—'}</span>
      {showAdd && <AddToCalendar appt={a} />}
    </div>
  )
}

// ─── Login gate ────────────────────────────────────────────────────────────────
function LoginGate({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) { setErr('Sign-in failed. Check your email and password.'); return }
    onSignedIn()
  }

  return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 28, boxShadow: '0 1px 3px rgba(13,26,46,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
          <div style={{ width: 30, height: 30, background: C.emerald, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{IconBolt}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>Project Portal</div>
            <div style={{ fontSize: 11, color: C.textMuted }}>Energy Efficiency Services of Wisconsin</div>
          </div>
        </div>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary }}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username"
          style={{ width: '100%', margin: '4px 0 12px', padding: '9px 11px', border: `1px solid ${C.borderDark}`, borderRadius: 7, fontSize: 13, outline: 'none' }} />
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary }}>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={{ width: '100%', margin: '4px 0 16px', padding: '9px 11px', border: `1px solid ${C.borderDark}`, borderRadius: 7, fontSize: 13, outline: 'none' }} />
        {err && <div style={{ fontSize: 12, color: C.sky, marginBottom: 12 }}>{err}</div>}
        <button onClick={submit} disabled={busy}
          style={{ width: '100%', padding: '10px', background: C.emerald, color: '#fff', border: 'none', borderRadius: 7, fontSize: 13.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  )
}

// ─── Root ────────────────────────────────────────────────────────────────────
export default function ProjectPortalRoot() {
  const [phase, setPhase] = useState('loading')   // loading | login | ready | error | notportal
  const [self, setSelf] = useState(null)
  const [tree, setTree] = useState([])
  const [sel, setSel] = useState({ pid: null, bid: null, uid: null, projId: null })
  const [open, setOpen] = useState({ prop: null, bldg: null })
  const [query, setQuery] = useState('')
  const [errMsg, setErrMsg] = useState(null)
  const [view, setView] = useState('tree')        // tree | calendar
  const [appointments, setAppointments] = useState([])

  const load = useCallback(async () => {
    setPhase('loading')
    try {
      const me = await fetchPortalUserSelf()
      if (!me) { setPhase('login'); return }
      if (me.status !== 'Active') { setPhase('notportal'); setErrMsg('Your portal access is not active. Contact your project coordinator.'); return }
      setSelf(me)
      const t = await fetchProjectTracker()
      if (t.error === 'no_portal_user') { setPhase('notportal'); setErrMsg('This account is not set up as a portal user.'); return }
      const props = t.properties || []
      setTree(props)
      const first = props[0]
      setSel({ pid: first ? first.id : null, bid: null, uid: null, projId: null })
      setOpen({ prop: first ? first.id : null, bldg: null })
      try { const cal = await fetchPortalCalendar(); setAppointments(cal.appointments || []) } catch { setAppointments([]) }
      setPhase('ready')
    } catch (e) {
      setErrMsg(e?.message || 'Failed to load the portal.')
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    if (!hasSupabaseConfig) { setPhase('error'); setErrMsg('Portal is not configured.'); return }
    load()
  }, [load])

  const signOut = async () => { await supabase.auth.signOut(); setSelf(null); setTree([]); setPhase('login') }

  const onSelect = useCallback((next) => {
    setSel({ pid: next.pid || null, bid: next.bid || null, uid: next.uid || null, projId: next.projId || null })
    setOpen((o) => ({
      prop: next.pid || o.prop,
      bldg: next.bid ? `${next.pid}:${next.bid}` : o.bldg,
    }))
  }, [])

  const { property, building, unit, project, projectOpp } = useMemo(() => {
    const property = tree.find((p) => p.id === sel.pid) || tree[0] || null
    const building = property && sel.bid ? (property.buildings || []).find((b) => b.id === sel.bid) : null
    const unit = building && sel.uid ? buildingUnits(building).find((u) => u.unitId === sel.uid) : null
    const found = building && sel.projId ? findProject(building, sel.projId) : null
    return { property, building, unit, project: found?.project || null, projectOpp: found?.opportunity || null }
  }, [tree, sel])

  const programs = useMemo(() => (property ? propertyPrograms(property) : []), [property])
  const colorOf = useMemo(() => makeColorOf(programs), [programs])

  if (phase === 'loading') return <Centered>Loading your projects…</Centered>
  if (phase === 'login') return <LoginGate onSignedIn={load} />
  if (phase === 'notportal') return <Centered>{errMsg}<SignOutLink onClick={signOut} /></Centered>
  if (phase === 'error') return <Centered>{errMsg || 'Something went wrong.'}<SignOutLink onClick={signOut} /></Centered>

  const crumb = [{ label: property ? property.name : 'Properties', onClick: (building || unit) ? () => onSelect({ pid: property.id }) : null }]
  if (building) crumb.push({ label: shortBuildingName(building.name, property.name), onClick: (project || unit) ? () => onSelect({ pid: property.id, bid: building.id }) : null })
  if (project) crumb.push({ label: project.recordType || project.name, onClick: null })
  if (unit) crumb.push({ label: `Unit ${unit.unitNumber}`, onClick: null })

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif', background: C.page }}>
      <TreeSidebar tree={tree} sel={sel} open={open} setOpen={setOpen} onSelect={onSelect}
        query={query} setQuery={setQuery} user={self} onSignOut={signOut} view={view} setView={setView} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.page }}>
        <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
          {view === 'calendar'
            ? <Crumb items={[{ label: 'Calendar', onClick: null }]} />
            : <Crumb items={crumb} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 12px', background: C.page, border: `1px solid ${C.border}`, borderRadius: 6 }}>
            <span style={{ width: 14, height: 14, color: C.emerald, display: 'flex' }}>{IconBolt}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: C.textSecondary }}>Multi-Family Project Portal</span>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: C.page }}>
          {view === 'calendar' && <CalendarView appointments={appointments} onOpenVisit={(a) => {
            if (a.propertyId && a.buildingId && a.unitId) { setView('tree'); onSelect({ pid: a.propertyId, bid: a.buildingId, uid: a.unitId }) }
            else if (a.propertyId && a.buildingId) { setView('tree'); onSelect({ pid: a.propertyId, bid: a.buildingId }) }
          }} />}
          {view === 'tree' && <>
            {!property && <Centered>You don't have any properties assigned yet. Contact your project coordinator.</Centered>}
            {property && building && unit && <UnitPage property={property} building={building} unit={unit} colorOf={colorOf} />}
            {property && building && !unit && project && <ProjectPage property={property} building={building} project={project} opportunity={projectOpp} color={colorOf(projectOpp?.program)} />}
            {property && building && !unit && !project && <BuildingPage property={property} building={building} colorOf={colorOf} onOpenProject={(pr) => onSelect({ pid: property.id, bid: building.id, projId: pr.id })} />}
            {property && !building && <PropertyPage property={property} programs={programs} colorOf={colorOf} onOpenBuilding={(b) => onSelect({ pid: property.id, bid: b.id })} />}
          </>}
        </div>
      </div>
    </div>
  )
}

function Centered({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, fontFamily: 'Inter, system-ui, sans-serif', color: C.textSecondary, fontSize: 13.5, textAlign: 'center' }}>
      {children}
    </div>
  )
}
function SignOutLink({ onClick }) {
  return <button onClick={onClick} style={{ fontSize: 12.5, color: C.sky, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Sign out</button>
}
