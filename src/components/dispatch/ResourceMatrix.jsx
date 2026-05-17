// ResourceMatrix.jsx — Skills & Certifications matrix surface inside the
// Dispatch Console (activated via the Console | Resources toggle).
//
// Rows = field staff (Team Lead / Lead Technician / Project Site Lead /
//   Trainee contacts). Sticky left column shows full name + crew label +
//   title.
//
// Columns = active skills OR active certifications (toggle in the toolbar).
//   Sticky header row. Each header is the skill/cert name with a tooltip
//   for issuing body + description.
//
// Cells:
//   Skills tab — ✓ when an unexpired contact_skills row exists. Title text
//     shows level, date range, certificate number (if any).
//   Certifications tab — colored marker by state:
//     • emerald ✓     : active (no expiry or expiry >30 days out)
//     • amber  ⚠     : expiring within 30 days
//     • red    ✕     : expired
//     Title shows issue/expiry dates.
//
// Click a populated cell → opens the contact_skills / contact_certifications
// record in RecordDetail via onNavigateToRecord. Click a contact name in
// the row header → opens the contact record. v1 is read-only; inline
// add/remove of assignments lands later.
//
// Mobile (< 768px): the matrix collapses to per-staff cards with chip lists.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { C } from '../../data/constants'
import { Icon, LoadingState, ErrorState } from '../UI'
import { useIsMobile } from '../../lib/useMediaQuery'
import {
  FIELD_STAFF_TITLE_PATTERNS,
  fetchAllFieldStaff,
  fetchAllActiveSkills,
  fetchAllActiveCertifications,
  fetchContactSkillsForStaff,
  fetchContactCertificationsForStaff,
} from '../../data/resourceManagement'

// Cell visual states — mapped from the row._state field returned by the
// data layer (or 'assigned'/'unassigned' for skills which have no expiry
// state).
const STATE_STYLES = {
  active:        { bg: '#e7f8f0', fg: '#1e7d4f', symbol: '✓', label: 'Active' },
  assigned:      { bg: '#e7f8f0', fg: '#1e7d4f', symbol: '✓', label: 'Held' },
  expiring_soon: { bg: '#fef3c7', fg: '#8a5a04', symbol: '⚠', label: 'Expiring soon' },
  expired:       { bg: '#fde7e7', fg: '#a01616', symbol: '✕', label: 'Expired' },
}

// Title patterns the multi-select filter exposes. Mirrors the data layer
// constant so a new title can be added in one place + flow through.
const TITLE_FILTER_OPTIONS = FIELD_STAFF_TITLE_PATTERNS

export default function ResourceMatrix({ onNavigateToRecord }) {
  const isMobile = useIsMobile()

  // ── Tab + filter state ───────────────────────────────────────────────
  const [tab, setTab]                       = useState('skills')      // 'skills' | 'certifications'
  const [search, setSearch]                 = useState('')
  const [titleFilters, setTitleFilters]     = useState([])             // string[] — empty = all titles

  // ── Data state ───────────────────────────────────────────────────────
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState(null)
  const [staff, setStaff]                   = useState([])
  const [skills, setSkills]                 = useState([])
  const [certifications, setCertifications] = useState([])
  const [skillMatrix, setSkillMatrix]       = useState(new Map())      // Map<`${contact_id}::${skill_id}`, row>
  const [certMatrix, setCertMatrix]         = useState(new Map())      // Map<`${contact_id}::${certification_id}`, row>
  const [refreshNonce, setRefreshNonce]     = useState(0)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        // Parallel fetch of the three independent reference lists.
        const [staffRows, skillRows, certRows] = await Promise.all([
          fetchAllFieldStaff(),
          fetchAllActiveSkills(),
          fetchAllActiveCertifications(),
        ])
        if (cancelled) return

        // Junction tables only meaningful for the staff we just loaded.
        const contactIds = staffRows.map(s => s.id)
        const [skillsMap, certsMap] = await Promise.all([
          fetchContactSkillsForStaff(contactIds),
          fetchContactCertificationsForStaff(contactIds),
        ])
        if (cancelled) return

        setStaff(staffRows)
        setSkills(skillRows)
        setCertifications(certRows)
        setSkillMatrix(skillsMap)
        setCertMatrix(certsMap)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load resources')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [refreshNonce])

  // ── Derived: filtered staff list ────────────────────────────────────
  const filteredStaff = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return staff.filter(s => {
      if (needle && !s.full_name.toLowerCase().includes(needle) && !s.crew_label.toLowerCase().includes(needle)) {
        return false
      }
      if (titleFilters.length > 0) {
        const titleLower = (s.title || '').toLowerCase()
        const matchesAny = titleFilters.some(t => titleLower.includes(t.toLowerCase()))
        if (!matchesAny) return false
      }
      return true
    })
  }, [staff, search, titleFilters])

  const cols = tab === 'skills' ? skills : certifications

  const toggleTitle = useCallback((t) => {
    setTitleFilters(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }, [])

  // ── Header summary string ────────────────────────────────────────────
  const summary = useMemo(() => {
    const heldCount = filteredStaff.reduce((acc, s) => {
      const matrix = tab === 'skills' ? skillMatrix : certMatrix
      let n = 0
      for (const col of cols) {
        if (matrix.has(`${s.id}::${col.id}`)) n++
      }
      return acc + n
    }, 0)
    const expiringCount = tab === 'certifications'
      ? Array.from(certMatrix.values()).filter(r => r._state === 'expiring_soon').length
      : 0
    const expiredCount = tab === 'certifications'
      ? Array.from(certMatrix.values()).filter(r => r._state === 'expired').length
      : 0
    return { heldCount, expiringCount, expiredCount }
  }, [filteredStaff, cols, tab, skillMatrix, certMatrix])

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Sub-toolbar (tab toggle + search + title filter) ───────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap',
        gap: 12, padding: '12px 18px', background: C.surface,
        borderBottom: `1px solid ${C.border}`,
      }}>
        {/* Tab toggle */}
        <div role="tablist" aria-label="Resource Matrix tab"
             style={{
               display: 'inline-flex', background: '#f0f3f8',
               borderRadius: 6, padding: 2, border: `1px solid ${C.border}`,
             }}>
          {[
            { value: 'skills',         label: 'Skills' },
            { value: 'certifications', label: 'Certifications' },
          ].map(opt => {
            const active = tab === opt.value
            return (
              <button
                key={opt.value}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(opt.value)}
                style={{
                  padding: '5px 14px',
                  fontSize: 13, fontWeight: active ? 600 : 500,
                  color: active ? C.textPrimary : C.textSecondary,
                  background: active ? C.surface : 'transparent',
                  border: 'none', borderRadius: 5, cursor: 'pointer',
                  boxShadow: active ? '0 1px 2px rgba(13,26,46,0.08)' : 'none',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Icon path="M21 21l-4.35-4.35M11 19a8 8 0 110-16 8 8 0 010 16z"
                size={14} color={C.textMuted}
                style={{ position: 'absolute', left: 9, pointerEvents: 'none' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or crew…"
            style={{
              padding: '6px 10px 6px 28px', fontSize: 13,
              border: `1px solid ${C.border}`, borderRadius: 5,
              background: C.surface, color: C.textPrimary, minWidth: 220,
            }}
          />
        </div>

        {/* Title pill filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {TITLE_FILTER_OPTIONS.map(t => {
            const selected = titleFilters.includes(t)
            return (
              <button
                key={t}
                onClick={() => toggleTitle(t)}
                style={{
                  padding: '4px 10px', fontSize: 12,
                  fontWeight: selected ? 600 : 500,
                  color: selected ? '#1e7d4f' : C.textSecondary,
                  background: selected ? '#e7f8f0' : C.surface,
                  border: `1px solid ${selected ? '#1e7d4f' : C.border}`,
                  borderRadius: 12, cursor: 'pointer',
                }}
              >
                {t}
              </button>
            )
          })}
          {titleFilters.length > 0 && (
            <button
              onClick={() => setTitleFilters([])}
              style={{
                padding: '4px 8px', fontSize: 11,
                color: C.textMuted, background: 'transparent',
                border: 'none', cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              Clear
            </button>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Summary string */}
        <div style={{ fontSize: 12, color: C.textSecondary, whiteSpace: 'nowrap' }}>
          {filteredStaff.length} of {staff.length} staff
          {' • '}
          {summary.heldCount} {tab === 'skills' ? 'skill' : 'certification'} held
          {tab === 'certifications' && summary.expiringCount > 0 && (
            <span style={{ color: '#8a5a04', fontWeight: 600 }}>{' • '}{summary.expiringCount} expiring</span>
          )}
          {tab === 'certifications' && summary.expiredCount > 0 && (
            <span style={{ color: '#a01616', fontWeight: 600 }}>{' • '}{summary.expiredCount} expired</span>
          )}
        </div>

        {/* Refresh */}
        <button onClick={() => setRefreshNonce(n => n + 1)} title="Refresh"
                style={{
                  padding: '6px 8px', background: C.surface,
                  border: `1px solid ${C.border}`, borderRadius: 5,
                  cursor: 'pointer', color: C.textSecondary,
                }}>
          <Icon path="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={14} />
        </button>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {error    && <ErrorState message={error} />}
        {loading  && <LoadingState message="Loading resources…" />}
        {!loading && !error && filteredStaff.length === 0 && (
          <div style={{ padding: 28, textAlign: 'center', color: C.textSecondary, fontSize: 13 }}>
            No field staff matching the filters.
          </div>
        )}
        {!loading && !error && filteredStaff.length > 0 && cols.length === 0 && (
          <div style={{ padding: 28, textAlign: 'center', color: C.textSecondary, fontSize: 13 }}>
            No active {tab === 'skills' ? 'skills' : 'certifications'} defined.
          </div>
        )}
        {!loading && !error && filteredStaff.length > 0 && cols.length > 0 && (
          isMobile
            ? <MobileCards staff={filteredStaff} cols={cols} tab={tab}
                           matrix={tab === 'skills' ? skillMatrix : certMatrix}
                           onNavigateToRecord={onNavigateToRecord} />
            : <MatrixTable staff={filteredStaff} cols={cols} tab={tab}
                           matrix={tab === 'skills' ? skillMatrix : certMatrix}
                           onNavigateToRecord={onNavigateToRecord} />
        )}
      </div>
    </div>
  )
}

// ─── Desktop matrix table ────────────────────────────────────────────────
function MatrixTable({ staff, cols, tab, matrix, onNavigateToRecord }) {
  const junctionTable = tab === 'skills' ? 'contact_skills' : 'contact_certifications'

  return (
    <div style={{ overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 600 }}>
        <thead>
          <tr>
            {/* Sticky top-left corner */}
            <th style={{
              position: 'sticky', left: 0, top: 0, zIndex: 3,
              background: C.surface,
              padding: '10px 14px',
              fontSize: 11, fontWeight: 600, color: C.textSecondary,
              textTransform: 'uppercase', letterSpacing: 0.4,
              textAlign: 'left',
              borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
              minWidth: 220,
            }}>
              Staff ({staff.length})
            </th>
            {cols.map(col => {
              const colName = tab === 'skills' ? col.skill_name : col.certification_name
              const issuing = tab === 'skills' ? col.skill_issuing_body : col.certification_issuing_body
              const desc    = tab === 'skills' ? col.skill_description  : col.certification_description
              const title   = [issuing, desc].filter(Boolean).join(' — ') || colName
              return (
                <th key={col.id}
                    title={title}
                    style={{
                      position: 'sticky', top: 0, zIndex: 2,
                      background: C.surface,
                      padding: '10px 8px',
                      fontSize: 11, fontWeight: 600, color: C.textPrimary,
                      borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
                      verticalAlign: 'bottom',
                      writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                      whiteSpace: 'nowrap', height: 140, maxHeight: 140,
                    }}>
                  {colName}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {staff.map((s, idx) => (
            <tr key={s.id} style={{ background: idx % 2 === 0 ? C.surface : '#fafbfd' }}>
              <th style={{
                position: 'sticky', left: 0, zIndex: 1,
                background: idx % 2 === 0 ? C.surface : '#fafbfd',
                padding: '10px 14px',
                fontSize: 13, fontWeight: 500,
                textAlign: 'left',
                borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
                minWidth: 220,
              }}>
                <button
                  onClick={() => onNavigateToRecord && onNavigateToRecord({ table: 'contacts', id: s.id })}
                  style={{
                    background: 'transparent', border: 'none', padding: 0,
                    cursor: 'pointer', color: '#1a5a8a',
                    textDecoration: 'underline', textUnderlineOffset: 2,
                    fontWeight: 600, fontSize: 13,
                  }}
                  title={`Open ${s.full_name}`}
                >
                  {s.full_name}
                </button>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                  {s.title}{s.crew_label ? ` — ${s.crew_label}` : ''}
                </div>
              </th>
              {cols.map(col => {
                const row = matrix.get(`${s.id}::${col.id}`)
                const stateKey = row
                  ? (tab === 'skills' ? 'assigned' : row._state)
                  : null
                const style = stateKey ? STATE_STYLES[stateKey] : null
                const cellTitle = row
                  ? cellTooltip(tab, col, row)
                  : `${s.full_name} does not have this ${tab === 'skills' ? 'skill' : 'certification'}`
                return (
                  <td key={col.id}
                      style={{
                        padding: 0,
                        borderRight: `1px solid ${C.border}`,
                        borderBottom: `1px solid ${C.border}`,
                        textAlign: 'center',
                      }}>
                    {row ? (
                      <button
                        onClick={() => onNavigateToRecord && onNavigateToRecord({ table: junctionTable, id: row.id })}
                        title={cellTitle}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '100%', height: 44,
                          background: style.bg, color: style.fg,
                          fontSize: 16, fontWeight: 700,
                          border: 'none', cursor: 'pointer',
                        }}
                      >
                        {style.symbol}
                      </button>
                    ) : (
                      <div title={cellTitle}
                           style={{
                             height: 44, color: C.textMuted, fontSize: 14,
                             display: 'flex', alignItems: 'center', justifyContent: 'center',
                           }}>
                        —
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Mobile cards ────────────────────────────────────────────────────────
function MobileCards({ staff, cols, tab, matrix, onNavigateToRecord }) {
  const junctionTable = tab === 'skills' ? 'contact_skills' : 'contact_certifications'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {staff.map(s => {
        const heldCols = cols.filter(c => matrix.has(`${s.id}::${c.id}`))
        return (
          <div key={s.id}
               style={{
                 background: C.surface, border: `1px solid ${C.border}`,
                 borderRadius: 8, padding: '12px 14px',
               }}>
            <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}>
              <button
                onClick={() => onNavigateToRecord && onNavigateToRecord({ table: 'contacts', id: s.id })}
                style={{
                  background: 'transparent', border: 'none', padding: 0,
                  textAlign: 'left',
                  cursor: 'pointer', color: '#1a5a8a',
                  textDecoration: 'underline', textUnderlineOffset: 2,
                  fontWeight: 600, fontSize: 14,
                }}>
                {s.full_name}
              </button>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                {s.title}{s.crew_label ? ` — ${s.crew_label}` : ''}
              </div>
            </div>
            {heldCols.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>
                No {tab === 'skills' ? 'skills' : 'certifications'} held.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {heldCols.map(c => {
                  const row = matrix.get(`${s.id}::${c.id}`)
                  const stateKey = tab === 'skills' ? 'assigned' : row._state
                  const style = STATE_STYLES[stateKey]
                  const label = tab === 'skills' ? c.skill_name : c.certification_name
                  return (
                    <button
                      key={c.id}
                      onClick={() => onNavigateToRecord && onNavigateToRecord({ table: junctionTable, id: row.id })}
                      title={cellTooltip(tab, c, row)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px',
                        fontSize: 11, fontWeight: 500,
                        background: style.bg, color: style.fg,
                        border: `1px solid ${style.fg}33`,
                        borderRadius: 12, cursor: 'pointer',
                      }}>
                      <span>{style.symbol}</span>
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function cellTooltip(tab, col, row) {
  if (tab === 'skills') {
    const parts = []
    parts.push(col.skill_name)
    if (row.cs_skill_level != null) parts.push(`Level ${row.cs_skill_level}`)
    if (row.cs_effective_start_date) parts.push(`Effective ${row.cs_effective_start_date}`)
    if (row.cs_effective_end_date)   parts.push(`Through ${row.cs_effective_end_date}`)
    if (row.cs_certification_number) parts.push(`Cert ${row.cs_certification_number}`)
    return parts.join(' • ')
  } else {
    const parts = []
    parts.push(col.certification_name)
    const stateLabel = STATE_STYLES[row._state]?.label
    if (stateLabel) parts.push(stateLabel)
    if (row.cc_issued_date)  parts.push(`Issued ${row.cc_issued_date}`)
    if (row.cc_expires_date) parts.push(`Expires ${row.cc_expires_date}`)
    if (row.cc_certificate_number) parts.push(`Cert ${row.cc_certificate_number}`)
    return parts.join(' • ')
  }
}
