// =============================================================================
// ProjectPortalRoot — customer-facing Multi-Family Project Portal
//
// Mounted at /project-portal (and /project-portal/*) via path-based routing in
// main.jsx. Stands alone — no staff sidebar/topbar chrome. A property owner or
// property manager signs in with Supabase Auth; their portal_users row
// (linked by auth_user_id) plus their explicit grants in
// portal_user_property_grants determine what they see. The tree comes from the
// get_portal_project_tracker() RPC.
//
// Layout follows the approved Multi-Family Project Portal mockup, re-skinned
// into the LEAP design system (Inter, emerald/navy, no red/orange):
//   • Left tree sidebar (navy #07111f): Property → Building → Unit.
//   • Property page  — banner, unit-status stat cards, building cards,
//                      per-program stage breakdown.
//   • Building page  — stat cards + per-unit program cards.
//   • Unit page      — a data-driven stage bar per program.
//
// PROGRAMS ARE DATA-DRIVEN: a "program" is just an opportunity's record type.
// The portal discovers the distinct record types present under a property and
// renders one track per record type (1, 2, or N) — labeled by the record type
// exactly as stored, colored from the LEAP palette by index. Nothing is
// hardcoded to any specific program (no "HOMES"/"HEAR" in the code).
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { C, CHART_COLORS } from '../data/constants'
import {
  fetchPortalUserSelf,
  fetchProjectTracker,
  oppPct,
  oppBucket,
  oppForProgram,
  propertyPrograms,
  unitStatus,
  unitProgramPct,
  buildingProgramPct,
  propertyProgramPct,
  unitStats,
  allUnits,
} from '../data/projectPortalService'

// Build a stable program → color map from the property's program list.
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

// ─── Program-label display ───────────────────────────────────────────────────
// Stage labels are stored long-form (e.g. "Opportunity — HEAR Income
// Qualification"); strip the generic "Opportunity — " lead-in for the dots.
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
      <div style={{ position: 'relative', height: 4, background: C.border, borderRadius: 10, marginBottom: 30 }}>
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

// ─── Tree sidebar ─────────────────────────────────────────────────────────────
function TreeSidebar({ tree, sel, open, setOpen, onSelect, query, setQuery, user, onSignOut }) {
  const q = (query || '').toLowerCase()
  const matchUnit = (u) => !q || (u.unitNumber + ' ' + u.name).toLowerCase().includes(q)

  return (
    <nav style={{ width: 272, background: C.sidebar, display: 'flex', flexDirection: 'column', height: '100vh', flexShrink: 0 }}>
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 28, height: 28, background: C.emerald, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{IconBolt}</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Energy Efficiency Services</div>
            <div style={{ fontSize: 10, color: C.navInactive, letterSpacing: '.5px', textTransform: 'uppercase' }}>Project Portal</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: C.navInactive, display: 'flex' }}>{IconSearch}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search units…"
            style={{ width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 6, padding: '7px 8px 7px 28px', color: '#fff', fontSize: 12, outline: 'none', fontFamily: 'inherit' }} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
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
                  <div style={{ fontSize: 10, color: C.navInactive }}>{(p.buildings || []).length} bldgs · {allUnits(p).length} units</div>
                </div>
                <MiniTracks programs={programs} colorOf={colorOf} pctOf={(pg) => propertyProgramPct(p, pg)} />
              </div>

              {pOpen && (p.buildings || []).map((b) => {
                const bKey = `${p.id}:${b.id}`
                const bOpen = open.bldg === bKey
                const bActive = sel.bid === b.id && !sel.uid
                return (
                  <div key={b.id}>
                    <div onClick={() => onSelect({ pid: p.id, bid: b.id })}
                      style={{ display: 'flex', alignItems: 'center', padding: '5px 10px 5px 26px', cursor: 'pointer',
                        borderLeft: `3px solid ${bActive ? C.sky : 'transparent'}`,
                        background: bActive ? 'rgba(126,179,232,.16)' : 'transparent' }}>
                      <span onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, bldg: o.bldg === bKey ? null : bKey })) }}
                        style={{ width: 16, display: 'flex', justifyContent: 'center', color: C.navInactive, transform: bOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>{IconChevR}</span>
                      <span style={{ color: 'rgba(255,255,255,.45)', marginRight: 5, display: 'flex' }}>{IconBldg}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.88)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                      </div>
                      <MiniTracks programs={programs} colorOf={colorOf} pctOf={(pg) => buildingProgramPct(b, pg)} />
                    </div>

                    {bOpen && (b.units || []).filter(matchUnit).map((u) => {
                      const uActive = sel.uid === u.id
                      const meta = bucketMeta(unitStatus(u))
                      return (
                        <div key={u.id} onClick={() => onSelect({ pid: p.id, bid: b.id, uid: u.id })}
                          style={{ display: 'flex', alignItems: 'center', padding: '4px 10px 4px 46px', cursor: 'pointer',
                            borderLeft: `3px solid ${uActive ? C.emerald : 'transparent'}`,
                            background: uActive ? 'rgba(62,207,142,.14)' : 'transparent' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.dot, marginRight: 8, flexShrink: 0 }} />
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

// One labeled progress row for a program (record type).
function ProgRow({ program, pct, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <span style={{ width: 132, fontWeight: 600, color, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={program}>{program}</span>
      <Bar pct={pct ?? 0} color={color} />
      <span style={{ width: 34, fontSize: 11, fontWeight: 600, color: C.textSecondary, textAlign: 'right' }}>{pct == null ? '—' : `${pct}%`}</span>
    </div>
  )
}

// Color legend mapping each track color → its program (record type) name.
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

// ─── Property page ────────────────────────────────────────────────────────────
function PropertyPage({ property, programs, colorOf, onOpenBuilding }) {
  const s = unitStats(property)
  return (
    <div style={{ padding: 22, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ background: `linear-gradient(135deg, ${C.sidebar} 0%, #12243d 100%)`, borderRadius: 12, padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 48, height: 48, background: 'rgba(62,207,142,.25)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>{IconProp}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{property.name}</div>
          <div style={{ fontSize: 12.5, color: C.navInactive, marginTop: 3 }}>{[property.city, property.state].filter(Boolean).join(', ')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {programs.map((pg) => {
              const v = propertyProgramPct(property, pg)
              return (
                <span key={pg} style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.85)', border: '1px solid rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorOf(pg) }} />
                  {pg} {v == null ? '—' : `${v}%`}
                </span>
              )
            })}
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.85)', border: '1px solid rgba(255,255,255,.15)' }}>{(property.buildings || []).length} Buildings</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.85)', border: '1px solid rgba(255,255,255,.15)' }}>{s.total} Units</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 22, flexShrink: 0 }}>
          {[['Complete', s.complete, C.emerald], ['In Progress', s.inProgress, C.sky], ['Not Started', s.notStarted, 'rgba(255,255,255,.5)']].map(([l, v, col]) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: col, lineHeight: 1 }}>{v}</div>
              <div style={{ fontSize: 10, color: C.navInactive, marginTop: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 30 }}>
        <SectionHeader title="Unit Status at a Glance" desc="Across all buildings in this property" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          <StatCard label="All Programs Complete" value={s.complete} accent={C.emerald} />
          <StatCard label="Work In Progress" value={s.inProgress} accent={C.sky} />
          <StatCard label="In Submittal" value={s.submittal} accent={C.emeraldMid} />
          <StatCard label="Not Yet Started" value={s.notStarted} accent={C.textMuted} />
        </div>
      </div>

      <div style={{ marginBottom: 30 }}>
        <SectionHeader title="Buildings" desc="Progress by building — click a building to see its units" action={`${(property.buildings || []).length} buildings`} />
        <ProgramLegend programs={programs} colorOf={colorOf} />
        <div style={{ display: 'grid', gap: 12 }}>
          {(property.buildings || []).map((b) => {
            const dc = (b.units || []).filter((u) => unitStatus(u) === 'complete').length
            return (
              <div key={b.id} onClick={() => onOpenBuilding(b)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 40, height: 40, background: C.page, border: `1px solid ${C.border}`, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.emerald, flexShrink: 0 }}>{IconBldg}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{b.name}</div>
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 8 }}>{(b.units || []).length} units</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 460 }}>
                    {programs.map((pg) => <ProgRow key={pg} program={pg} pct={buildingProgramPct(b, pg)} color={colorOf(pg)} />)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: C.textMuted }}>{dc} of {(b.units || []).length} complete</span>
                  <span style={{ fontSize: 11.5, color: C.emeraldMid, fontWeight: 600 }}>View units →</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <SectionHeader title="Work Order Stage Breakdown" desc="How many units sit at each stage, per program" />
        <div style={{ display: 'grid', gridTemplateColumns: programs.length > 1 ? '1fr 1fr' : '1fr', gap: 12 }}>
          {programs.map((pg) => <StageBreakdown key={pg} property={property} program={pg} color={colorOf(pg)} />)}
          {programs.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>No program work recorded on this property yet.</div>}
        </div>
      </div>
    </div>
  )
}

// Per-program: count units by the rank their program opp currently sits at,
// using that program's own (data-driven) stage list for labels.
function StageBreakdown({ property, program, color }) {
  const units = allUnits(property)
  const ref = units.map((u) => oppForProgram(u, program)).find(Boolean)
  const stages = ref?.stages || []
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{program}</span>
      </div>
      {stages.length === 0 && <div style={{ padding: 16, fontSize: 12, color: C.textMuted }}>No work for this program on this property.</div>}
      {stages.map((st) => {
        const cnt = units.filter((u) => {
          const o = oppForProgram(u, program)
          return o && o.stageOrder === st.sortOrder
        }).length
        const pct = units.length ? Math.round(cnt / units.length * 100) : 0
        return (
          <div key={st.sortOrder} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5 }}>
            <div style={{ flex: 1, color: C.textSecondary }}>{shortStageLabel(st.label)}</div>
            <div style={{ width: 90 }}><Bar pct={Math.min(pct * 2, 100)} color={color} /></div>
            <div style={{ width: 56, textAlign: 'right', fontWeight: 600, fontSize: 12, color: cnt ? C.textPrimary : C.textMuted }}>{cnt ? `${cnt} unit${cnt === 1 ? '' : 's'}` : '—'}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Building page ────────────────────────────────────────────────────────────
function BuildingPage({ property, building, programs, colorOf, onOpenUnit }) {
  const units = building.units || []
  const bucket = (b) => units.filter((u) => unitStatus(u) === b).length
  return (
    <div style={{ padding: 22, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary }}>{building.name}</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 18 }}>{property.name} · {units.length} units</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 22 }}>
        <StatCard label="Complete" value={bucket('complete')} accent={C.emerald} sub={`of ${units.length} units`} />
        <StatCard label="In Progress" value={bucket('inProgress')} accent={C.sky} />
        <StatCard label="In Submittal" value={bucket('submittal')} accent={C.emeraldMid} />
        <StatCard label="Not Started" value={bucket('notStarted')} accent={C.textMuted} />
      </div>

      <SectionHeader title={`Units — ${building.name}`} desc="Click a unit for its program work-order detail" />
      <ProgramLegend programs={programs} colorOf={colorOf} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {units.map((u) => (
          <div key={u.id} onClick={() => onOpenUnit(u)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', cursor: 'pointer' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>Unit {u.unitNumber}</div>
            {programs.map((pg) => {
              const o = oppForProgram(u, pg)
              const color = colorOf(pg)
              const meta = bucketMeta(oppBucket(o))
              return (
                <div key={pg} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9.5, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }} title={pg}>{pg}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: meta.color, background: meta.bg, padding: '1px 6px', borderRadius: 10, flexShrink: 0 }}>{o ? meta.label : 'N/A'}</span>
                  </div>
                  <Bar pct={oppPct(o)} color={color} h={4} />
                </div>
              )
            })}
          </div>
        ))}
        {units.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>No units recorded for this building yet.</div>}
      </div>
    </div>
  )
}

// ─── Unit page ────────────────────────────────────────────────────────────────
function UnitProgramCard({ program, opp, color }) {
  const count = (opp?.stages || []).length
  const so = opp?.stageOrder || 0
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 9, background: `${color}14` }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{program}</span>
        {opp && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{opp.recordNumber}</span>}
      </div>
      <div style={{ padding: '20px 22px 14px' }}>
        {opp ? (
          <>
            <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 16 }}>
              Current stage: <strong style={{ color: C.textPrimary }}>{shortStageLabel(opp.stageLabel)}</strong>
            </div>
            <StageBar opp={opp} accent={color} />
            <div style={{ marginTop: 8, fontSize: 12, color: C.textSecondary }}>
              {count > 0 && so >= count ? 'All program phases are complete.'
                : so > 0 ? `Phase ${so} of ${count} — ${oppPct(opp)}% through the program lifecycle.`
                : 'This program has not started yet.'}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: C.textMuted }}>No opportunity for this program on this unit.</div>
        )}
      </div>
    </div>
  )
}

function UnitPage({ property, building, unit, programs, colorOf }) {
  // Render a card for each program this unit actually has, in property order.
  const present = programs.filter((pg) => oppForProgram(unit, pg))
  const list = present.length ? present : programs
  return (
    <div style={{ padding: 22, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary }}>Unit {unit.unitNumber}</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 20 }}>{property.name} · {building.name}</div>
      {list.map((pg) => <UnitProgramCard key={pg} program={pg} opp={oppForProgram(unit, pg)} color={colorOf(pg)} />)}
      {list.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>No opportunities recorded for this unit yet.</div>}
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
  const [sel, setSel] = useState({ pid: null, bid: null, uid: null })
  const [open, setOpen] = useState({ prop: null, bldg: null })
  const [query, setQuery] = useState('')
  const [errMsg, setErrMsg] = useState(null)

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
      setSel({ pid: first ? first.id : null, bid: null, uid: null })
      setOpen({ prop: first ? first.id : null, bldg: null })
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
    setSel({ pid: next.pid || null, bid: next.bid || null, uid: next.uid || null })
    setOpen((o) => ({
      prop: next.pid || o.prop,
      bldg: next.bid ? `${next.pid}:${next.bid}` : (next.uid ? o.bldg : null),
    }))
  }, [])

  const { property, building, unit } = useMemo(() => {
    const property = tree.find((p) => p.id === sel.pid) || tree[0] || null
    const building = property && sel.bid ? (property.buildings || []).find((b) => b.id === sel.bid) : null
    const unit = building && sel.uid ? (building.units || []).find((u) => u.id === sel.uid) : null
    return { property, building, unit }
  }, [tree, sel])

  const programs = useMemo(() => (property ? propertyPrograms(property) : []), [property])
  const colorOf = useMemo(() => makeColorOf(programs), [programs])

  if (phase === 'loading') return <Centered>Loading your projects…</Centered>
  if (phase === 'login') return <LoginGate onSignedIn={load} />
  if (phase === 'notportal') return <Centered>{errMsg}<SignOutLink onClick={signOut} /></Centered>
  if (phase === 'error') return <Centered>{errMsg || 'Something went wrong.'}<SignOutLink onClick={signOut} /></Centered>

  const crumb = [{ label: property ? property.name : 'Properties', onClick: (building || unit) ? () => onSelect({ pid: property.id }) : null }]
  if (building) crumb.push({ label: building.name, onClick: unit ? () => onSelect({ pid: property.id, bid: building.id }) : null })
  if (unit) crumb.push({ label: `Unit ${unit.unitNumber}`, onClick: null })

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif', background: C.page }}>
      <TreeSidebar tree={tree} sel={sel} open={open} setOpen={setOpen} onSelect={onSelect}
        query={query} setQuery={setQuery} user={self} onSignOut={signOut} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.page }}>
        <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, height: 54, display: 'flex', alignItems: 'center', padding: '0 24px', flexShrink: 0 }}>
          <Crumb items={crumb} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: C.page }}>
          {!property && <Centered>You don't have any properties assigned yet. Contact your project coordinator.</Centered>}
          {property && unit && building && <UnitPage property={property} building={building} unit={unit} programs={programs} colorOf={colorOf} />}
          {property && building && !unit && <BuildingPage property={property} building={building} programs={programs} colorOf={colorOf} onOpenUnit={(u) => onSelect({ pid: property.id, bid: building.id, uid: u.id })} />}
          {property && !building && <PropertyPage property={property} programs={programs} colorOf={colorOf} onOpenBuilding={(b) => onSelect({ pid: property.id, bid: b.id })} />}
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
