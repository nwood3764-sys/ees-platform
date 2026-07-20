// ─── HomeScreen.jsx ──────────────────────────────────────────────────────────
// Landing tab of the technician PWA. Not a stub — it surfaces the technician's
// real day at a glance:
//   • Greeting + today's date.
//   • Count of today's assigned stops.
//   • Next stop card (earliest remaining appointment), tappable to its work
//     order. Falls back to a clear empty state when the day has no stops.
//   • Quick links into Schedule and Map.
//
// Data: my_service_appointments(today) via fetchTodaySchedule — the same RPC
// the Schedule screen uses, so Home and Schedule never disagree.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import AppChrome, { PullIndicator } from './AppChrome'
import { usePullToRefresh } from './usePullToRefresh'
import {
  fetchTodaySchedule, chicagoToday, fetchTechnicianCreatableWorkTypes,
  createTechnicianWorkOrder, createTechnicianWorkOrderForProperty, searchProperties,
  fetchBuildingsForProperty, fetchUnitsForBuilding, fetchProjectsForProperty,
} from './fieldMobileService'
import { C, FONT, MONO, card, btnSecondary, statusChip } from './styles'

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', hour12: false,
  }).format(new Date()))
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function fmtTodayLabel() {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'long', month: 'long', day: 'numeric',
    }).format(new Date())
  } catch { return '' }
}

function fmtTime(iso) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso))
  } catch { return '—' }
}

// A stop is "remaining" if its work order isn't yet in a terminal state.
function isRemaining(r) {
  const s = (r.work_order_status || '').toLowerCase()
  return !(s.includes('verified') || s.includes('complete') || s.includes('unable'))
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

export default function HomeScreen({ navigate }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [name, setName]       = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createTypes, setCreateTypes] = useState(null)   // null = loading
  const [createType, setCreateType] = useState(null)     // chosen work type, or null (phase 1)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [propSearch, setPropSearch] = useState(null)     // null = stops phase; '' or text = ad hoc flow
  const [propResults, setPropResults] = useState([])
  const [propSearching, setPropSearching] = useState(false)
  // Ad hoc explicit selection — the technician picks everything.
  const [adhocProp, setAdhocProp] = useState(null)
  const [adhocBuildings, setAdhocBuildings] = useState(null)
  const [adhocBuilding, setAdhocBuilding] = useState(null)
  const [adhocUnits, setAdhocUnits] = useState(null)
  const [adhocUnit, setAdhocUnit] = useState(null)        // {id} or {newName}
  const [adhocNewUnit, setAdhocNewUnit] = useState('')
  const [adhocProjects, setAdhocProjects] = useState(null)

  const resetAdhoc = () => {
    setAdhocProp(null); setAdhocBuildings(null); setAdhocBuilding(null)
    setAdhocUnits(null); setAdhocUnit(null); setAdhocNewUnit(''); setAdhocProjects(null)
  }

  const load = useCallback(async () => {
    try {
      setError(null)
      const data = await fetchTodaySchedule(chicagoToday())
      setRows(data)
      const n = data?.[0]?.technician_first_name || data?.[0]?.technician_name || ''
      setName(typeof n === 'string' ? n.split(' ')[0] : '')
    } catch (e) {
      setError(e.message || 'Could not load today’s schedule.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      await load()
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [load])

  const pr = usePullToRefresh(load)

  const total = rows.length
  const remaining = rows.filter(isRemaining)
  const nextStop = remaining[0] || null

  return (
    <AppChrome title="Home" activeKey="home" navigate={navigate}>
      <PullIndicator {...pr} />
      {/* Greeting block */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 800, color: C.textPrimary }}>
          {greeting()}{name ? `, ${name}` : ''}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
          {fmtTodayLabel()}
        </div>
      </div>

      {/* Today summary */}
      <div style={{ ...card, padding: 16, marginBottom: 14 }}>
        {loading ? (
          <div style={{ color: C.textMuted, fontSize: 14 }}>Loading today’s work…</div>
        ) : error ? (
          <div style={{ color: C.danger, fontSize: 14 }}>{error}</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 34, fontWeight: 700, color: C.emeraldMid, lineHeight: 1 }}>
              {total}
            </span>
            <span style={{ fontFamily: FONT, fontSize: 14, color: C.textSecondary }}>
              {total === 1 ? 'stop scheduled today' : 'stops scheduled today'}
              {total > 0 && remaining.length !== total
                ? ` · ${remaining.length} remaining`
                : ''}
            </span>
          </div>
        )}
      </div>

      {/* Next stop */}
      {!loading && !error && (
        nextStop ? (
          <>
            <div style={{
              fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              textTransform: 'uppercase', color: C.textMuted, margin: '4px 2px 8px',
            }}>
              Next stop
            </div>
            <button
              onClick={() => nextStop.work_order_id && navigate(`/field/wo/${nextStop.work_order_id}`)}
              style={{
                ...card, width: '100%', textAlign: 'left',
                cursor: nextStop.work_order_id ? 'pointer' : 'default',
                padding: 16, marginBottom: 16, appearance: 'none',
                display: 'block',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 13, color: C.emeraldMid, fontWeight: 700 }}>
                  {fmtTime(nextStop.sa_scheduled_start_time)}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: C.textMuted }}>
                  {nextStop.work_order_record_number || ''}
                </span>
              </div>
              <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: C.textPrimary }}>
                {nextStop.property_name || nextStop.work_order_name || 'Work Order'}
              </div>
              {/* Work type — the differentiator when several stops share one
                  property (e.g. Building Access vs Machine Setup vs Removal). */}
              {nextStop.work_type_name && (
                <div style={{ fontFamily: FONT, fontSize: 13.5, fontWeight: 600, color: C.emeraldMid, marginTop: 2 }}>
                  {nextStop.work_type_name}
                </div>
              )}
              {nextStop.property_address && (
                <div style={{ fontFamily: FONT, fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
                  {nextStop.property_address}
                </div>
              )}
              {(nextStop.building || nextStop.unit) && (
                <div style={{ fontFamily: FONT, fontSize: 13, color: C.textSecondary, marginTop: 4, display: 'flex', gap: 14 }}>
                  {nextStop.building && <span><strong style={{ color: C.textPrimary }}>Bldg</strong> {nextStop.building}</span>}
                  {nextStop.unit && <span><strong style={{ color: C.textPrimary }}>Unit</strong> {nextStop.unit}</span>}
                </div>
              )}
              {nextStop.work_order_status && (
                <div style={{ marginTop: 10 }}>
                  {(() => {
                    const chip = statusChip(nextStop.work_order_status)
                    return (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: chip.bg, color: chip.color,
                        fontFamily: FONT, fontSize: 12, fontWeight: 600,
                        padding: '3px 10px', borderRadius: 12,
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: chip.dot }} />
                        {nextStop.work_order_status}
                      </span>
                    )
                  })()}
                </div>
              )}
            </button>
          </>
        ) : total > 0 ? (
          <div style={{ ...card, padding: 16, marginBottom: 16, color: C.textSecondary, fontSize: 14 }}>
            All of today’s stops are complete. Nice work.
          </div>
        ) : (
          <div style={{ ...card, padding: 16, marginBottom: 16, color: C.textSecondary, fontSize: 14 }}>
            No stops scheduled today. Your schedule is pushed by the office — check back, or pull to refresh.
          </div>
        )
      )}

      {/* Quick links */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <QuickLink label="Create work order" sub="Building access, and other field-created records" onClick={() => {
          setCreateError(null); setCreateType(null); setPropSearch(null); setPropResults([]); resetAdhoc(); setCreateOpen(true)
          if (createTypes === null) {
            fetchTechnicianCreatableWorkTypes().then(setCreateTypes).catch(() => setCreateTypes([]))
          }
        }} />
        <QuickLink label="Vehicle inspection" sub="Daily pre-trip and return checklist" onClick={() => navigate('/field/vehicles')} />
        <QuickLink label="View full schedule" sub="All of today’s stops in order" onClick={() => navigate('/field/schedule')} />
        <QuickLink label="Open map" sub="Navigate and route your stops" onClick={() => navigate('/field/map')} />
      </div>

      {/* Create Work Order — phase 1: pick the type (data-driven from work
          types flagged technician-creatable in LEAP Admin); phase 2: pick
          which of today's stops it belongs to (the new work order clones
          that stop's project/building chain). */}
      {createOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,17,31,0.55)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div style={{
            background: C.card, width: '100%', maxWidth: 520,
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
            padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
            maxHeight: '88dvh', overflowY: 'auto',
          }}>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: C.textPrimary, marginBottom: 4 }}>
              {createType ? createType.work_type_name : 'Create Work Order'}
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16 }}>
              {createType
                ? (propSearch !== null
                    ? (adhocProjects !== null ? 'Select the project (or create one).'
                       : adhocUnits !== null ? 'Select the unit, or type a new one.'
                       : adhocBuildings !== null ? 'Select the building.'
                       : 'Search for the property this happened at.')
                    : 'Which job is this for? The new work order is created on the same property and building.')
                : 'What are you creating?'}
            </div>

            {!createType ? (
              createTypes === null ? (
                <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 16 }}>Loading…</div>
              ) : createTypes.length === 0 ? (
                <div style={{ fontSize: 14, color: C.textSecondary, marginBottom: 16 }}>
                  No field-creatable work order types are configured yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {createTypes.map((t) => (
                    <button key={t.id} disabled={createBusy} onClick={() => setCreateType(t)}
                      style={{
                        appearance: 'none', cursor: 'pointer', textAlign: 'left',
                        border: `1px solid ${C.borderDark}`, background: C.card,
                        borderRadius: 8, padding: '12px 14px', minHeight: 44,
                      }}>
                      <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
                        {t.work_type_name}
                      </span>
                      {t.work_type_description && (
                        <span style={{ display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 1 }}>
                          {t.work_type_description}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )
            ) : propSearch !== null ? (
              adhocProjects !== null ? (
                /* Phase: project — pick one, or create a Field Documentation project */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {adhocProjects.map((p) => (
                    <button key={p.id} disabled={createBusy}
                      onClick={async () => {
                        setCreateBusy(true); setCreateError(null)
                        try {
                          const res = await createTechnicianWorkOrderForProperty({
                            workTypeId: createType.id, propertyId: adhocProp.id,
                            buildingId: adhocBuilding?.id || null,
                            unitId: adhocUnit?.id || null, newUnitName: adhocUnit?.newName || null,
                            projectId: p.id,
                          })
                          setCreateOpen(false)
                          navigate(`/field/wo/${res.work_order_id}`)
                        } catch (e) {
                          setCreateError(e.message || 'Could not create the work order.')
                        } finally { setCreateBusy(false) }
                      }}
                      style={{
                        appearance: 'none', cursor: 'pointer', textAlign: 'left',
                        border: `1px solid ${C.borderDark}`, background: C.card,
                        borderRadius: 8, padding: '12px 14px', minHeight: 44,
                      }}>
                      <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
                        {p.project_name || p.project_record_number}
                      </span>
                      <span style={{ display: 'block', fontFamily: MONO, fontSize: 12, color: C.textMuted, marginTop: 1 }}>
                        {p.project_record_number}
                      </span>
                    </button>
                  ))}
                  <button disabled={createBusy}
                    onClick={async () => {
                      setCreateBusy(true); setCreateError(null)
                      try {
                        const res = await createTechnicianWorkOrderForProperty({
                          workTypeId: createType.id, propertyId: adhocProp.id,
                          buildingId: adhocBuilding?.id || null,
                          unitId: adhocUnit?.id || null, newUnitName: adhocUnit?.newName || null,
                          createProject: true,
                        })
                        setCreateOpen(false)
                        navigate(`/field/wo/${res.work_order_id}`)
                      } catch (e) {
                        setCreateError(e.message || 'Could not create the work order.')
                      } finally { setCreateBusy(false) }
                    }}
                    style={{
                      appearance: 'none', cursor: 'pointer', textAlign: 'left',
                      border: `1px dashed ${C.borderDark}`, background: C.cardSecondary,
                      borderRadius: 8, padding: '12px 14px', minHeight: 44,
                    }}>
                    <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
                      Create New Project
                    </span>
                    <span style={{ display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 1 }}>
                      {adhocProjects.length === 0 ? 'No projects on this property yet — ' : ''}a Field Documentation project is created for this record
                    </span>
                  </button>
                </div>
              ) : adhocUnits !== null ? (
                /* Phase: unit — required on every work order; pick or type new */
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                    {adhocUnits.map((u) => (
                      <button key={u.id} disabled={createBusy}
                        onClick={() => {
                          setAdhocUnit({ id: u.id })
                          fetchProjectsForProperty(adhocProp.id).then(setAdhocProjects).catch(() => setAdhocProjects([]))
                        }}
                        style={{
                          appearance: 'none', cursor: 'pointer', textAlign: 'left',
                          border: `1px solid ${C.borderDark}`, background: C.card,
                          borderRadius: 8, padding: '12px 14px', minHeight: 44,
                          fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary,
                        }}>
                        {u.unit_number}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
                    {adhocUnits.length === 0 ? 'No units on this building yet — enter the unit:' : 'Unit not listed? Enter it:'}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text" value={adhocNewUnit}
                      onChange={(e) => setAdhocNewUnit(e.target.value)}
                      placeholder="e.g. Attic, 4, Laundry Room"
                      disabled={createBusy}
                      style={{
                        flex: 1, boxSizing: 'border-box', minHeight: 44,
                        fontFamily: FONT, fontSize: 15, color: C.textPrimary,
                        border: `1px solid ${C.borderDark}`, borderRadius: 8, padding: '10px 12px',
                      }}
                    />
                    <button disabled={createBusy || !adhocNewUnit.trim()}
                      onClick={() => {
                        setAdhocUnit({ newName: adhocNewUnit.trim() })
                        fetchProjectsForProperty(adhocProp.id).then(setAdhocProjects).catch(() => setAdhocProjects([]))
                      }}
                      style={(createBusy || !adhocNewUnit.trim())
                        ? { ...btnSecondary, flex: '0 0 auto', minHeight: 44, opacity: 0.5 }
                        : { ...btnSecondary, flex: '0 0 auto', minHeight: 44 }}>
                      Use
                    </button>
                  </div>
                </div>
              ) : adhocBuildings !== null ? (
                /* Phase: building */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {adhocBuildings.map((b) => (
                    <button key={b.id} disabled={createBusy}
                      onClick={() => {
                        setAdhocBuilding(b)
                        fetchUnitsForBuilding(b.id).then(setAdhocUnits).catch(() => setAdhocUnits([]))
                      }}
                      style={{
                        appearance: 'none', cursor: 'pointer', textAlign: 'left',
                        border: `1px solid ${C.borderDark}`, background: C.card,
                        borderRadius: 8, padding: '12px 14px', minHeight: 44,
                        fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary,
                      }}>
                      {b.building_name || b.building_number_or_name}
                    </button>
                  ))}
                </div>
              ) : (
                /* Phase: property search */
                <div style={{ marginBottom: 16 }}>
                  <input
                    type="text" value={propSearch} autoFocus
                    onChange={(e) => {
                      const q = e.target.value
                      setPropSearch(q)
                      if (q.trim().length >= 2) {
                        setPropSearching(true)
                        searchProperties(q)
                          .then(setPropResults)
                          .catch(() => setPropResults([]))
                          .finally(() => setPropSearching(false))
                      } else {
                        setPropResults([])
                      }
                    }}
                    placeholder="Property name or street address"
                    disabled={createBusy}
                    style={{
                      width: '100%', boxSizing: 'border-box', minHeight: 44,
                      fontFamily: FONT, fontSize: 15, color: C.textPrimary,
                      border: `1px solid ${C.borderDark}`, borderRadius: 8, padding: '10px 12px',
                      marginBottom: 10,
                    }}
                  />
                  {propSearching && <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 8 }}>Searching…</div>}
                  {!propSearching && propSearch.trim().length >= 2 && propResults.length === 0 && (
                    <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 8 }}>No properties match.</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {propResults.map((p) => (
                      <button key={p.id} disabled={createBusy}
                        onClick={() => {
                          setAdhocProp(p)
                          fetchBuildingsForProperty(p.id)
                            .then((blds) => {
                              if (blds.length === 0) {
                                // Property has no buildings — one is created from the
                                // street address on save; go straight to the unit.
                                setAdhocBuildings([])
                                setAdhocBuilding(null)
                                setAdhocUnits([])
                              } else {
                                setAdhocBuildings(blds)
                              }
                            })
                            .catch(() => setAdhocBuildings([]))
                        }}
                        style={{
                          appearance: 'none', cursor: 'pointer', textAlign: 'left',
                          border: `1px solid ${C.borderDark}`, background: C.card,
                          borderRadius: 8, padding: '12px 14px', minHeight: 44,
                        }}>
                        <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
                          {p.property_name || 'Property'}
                        </span>
                        <span style={{ display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 1 }}>
                          {[p.property_street, p.property_city, p.property_state].filter(Boolean).join(', ')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            ) : (
              (() => {
                const seen = new Set()
                const candidates = rows.filter((r) => {
                  if (!r.work_order_id || seen.has(r.work_order_id)) return false
                  if (r.work_type_name === createType.work_type_name) return false
                  seen.add(r.work_order_id)
                  return true
                })
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {candidates.length === 0 && (
                      <div style={{ fontSize: 14, color: C.textSecondary }}>
                        No stops on today’s schedule — pick the property below.
                      </div>
                    )}
                    {candidates.map((r) => (
                      <button key={r.work_order_id} disabled={createBusy}
                        onClick={async () => {
                          setCreateBusy(true)
                          setCreateError(null)
                          try {
                            const res = await createTechnicianWorkOrder(r.work_order_id, createType.id)
                            setCreateOpen(false)
                            navigate(`/field/wo/${res.work_order_id}`)
                          } catch (e) {
                            setCreateError(e.message || 'Could not create the work order.')
                          } finally { setCreateBusy(false) }
                        }}
                        style={{
                          appearance: 'none', cursor: 'pointer', textAlign: 'left',
                          border: `1px solid ${C.borderDark}`, background: C.card,
                          borderRadius: 8, padding: '12px 14px', minHeight: 44,
                        }}>
                        <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
                          {r.property_name || r.work_order_name || 'Work Order'}
                        </span>
                        <span style={{ display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 1 }}>
                          {[r.work_order_record_number, r.building && `Bldg ${r.building}`, r.work_type_name].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    ))}
                    <button disabled={createBusy}
                      onClick={() => { setPropSearch(''); setPropResults([]); setCreateError(null) }}
                      style={{
                        appearance: 'none', cursor: 'pointer', textAlign: 'left',
                        border: `1px dashed ${C.borderDark}`, background: C.cardSecondary,
                        borderRadius: 8, padding: '12px 14px', minHeight: 44,
                      }}>
                      <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
                        Property is not in this list
                      </span>
                      <span style={{ display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 1 }}>
                        Ad hoc — search any property, outside today’s schedule
                      </span>
                    </button>
                  </div>
                )
              })()
            )}

            {createError && (
              <div style={{ fontSize: 13, color: C.danger, marginBottom: 12 }}>{createError}</div>
            )}
            {createBusy && (
              <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>Creating…</div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              {createType && (
                <button
                  onClick={() => {
                    setCreateError(null)
                    if (adhocProjects !== null) { setAdhocProjects(null); setAdhocUnit(null) }
                    else if (adhocUnits !== null) {
                      // Back from unit: to buildings when there were any, else to search.
                      setAdhocUnits(null); setAdhocUnit(null); setAdhocNewUnit('')
                      if (!adhocBuildings || adhocBuildings.length === 0) { setAdhocBuildings(null); setAdhocProp(null) }
                      else setAdhocBuilding(null)
                    }
                    else if (adhocBuildings !== null) { setAdhocBuildings(null); setAdhocProp(null) }
                    else if (propSearch !== null) { setPropSearch(null); setPropResults([]); resetAdhoc() }
                    else setCreateType(null)
                  }}
                  disabled={createBusy}
                  style={{ ...btnSecondary, flex: 1 }}>
                  Back
                </button>
              )}
              <button onClick={() => setCreateOpen(false)} disabled={createBusy}
                style={{ ...btnSecondary, flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </AppChrome>
  )
}

function QuickLink({ label, sub, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...card, width: '100%', appearance: 'none', cursor: 'pointer',
        padding: '14px 16px', textAlign: 'left',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}
    >
      <span>
        <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{label}</span>
        <span style={{ display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 1 }}>{sub}</span>
      </span>
      <span style={{ color: C.emeraldMid, flexShrink: 0, display: 'flex' }}><ArrowIcon /></span>
    </button>
  )
}
