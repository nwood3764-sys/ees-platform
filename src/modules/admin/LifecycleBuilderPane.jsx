import { useCallback, useEffect, useMemo, useState } from 'react'
import { C } from '../../data/constants'
import { LoadingState, ErrorState } from '../../components/UI'
import { ListView } from '../../components/ListView'
import HelpIcon from '../../components/help/HelpIcon'
import {
  inputStyle, textareaStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, FormField,
} from './adminStyles'
import {
  fetchStatusLifecycleSummary,
  fetchStatusTransitionsFor,
  createStatusTransition,
  updateStatusTransition,
  softDeleteStatusTransition,
} from '../../data/adminService'
import { useToast } from '../../components/Toast'

// ---------------------------------------------------------------------------
// LifecycleBuilderPane — Setup → Process Automation → Lifecycle Builder
//
// Two-tier UX matching the rest of the admin module:
//   Tier 1 — Lifecycle index: every (object, status_field) pair that has
//            an active status picklist. Status count + transition count
//            shown on the row. Click → drill in.
//   Tier 2 — Per-lifecycle editor: status nodes listed on the left,
//            transitions listed on the right. Edit / soft-delete inline.
//            "+ New Transition" opens a modal with from-status (nullable
//            = initial creation) + to-status + label + sort-order +
//            active flag.
//
// All FK integrity is enforced server-side by the
// validate_status_transition_endpoints trigger. The UI scopes the picker
// dropdowns to the picklist values on this (object, status_field) so the
// trigger should only ever surface on programmer error.
// ---------------------------------------------------------------------------

const SUMMARY_COLS = [
  { field: 'object',           label: 'Object',          type: 'text',   sortable: true,  filterable: true },
  { field: 'statusField',      label: 'Status Field',    type: 'text',   sortable: true,  filterable: true },
  { field: 'statusCount',      label: 'Active Statuses', type: 'number', sortable: true,  filterable: false },
  { field: 'transitionCount', label: 'Active Transitions', type: 'number', sortable: true, filterable: false },
  { field: 'totalsLabel',      label: 'Totals',          type: 'text',   sortable: false, filterable: false },
]

function shapeSummaryRow(r) {
  const totalStatuses = r.statusCountTotal ?? r.statusCount
  const totalTxns     = r.transitionCountTotal ?? r.transitionCount
  return {
    id:              r.id,
    _object:         r._object,
    _statusField:    r._statusField,
    object:          r.object,
    statusField:     r.statusField,
    statusCount:     r.statusCount,
    transitionCount: r.transitionCount,
    totalsLabel: (
      (totalStatuses === r.statusCount && totalTxns === r.transitionCount)
        ? '—'
        : `+${totalStatuses - r.statusCount} inactive status, +${totalTxns - r.transitionCount} inactive txn`
    ),
  }
}

export default function LifecycleBuilderPane() {
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [drillTarget, setDrillTarget] = useState(null) // { object, statusField } or null

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchStatusLifecycleSummary()
      .then(rows => setSummary(rows.map(shapeSummaryRow)))
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  if (drillTarget) {
    return (
      <LifecycleGraphEditor
        object={drillTarget.object}
        statusField={drillTarget.statusField}
        onBack={() => { setDrillTarget(null); reload() }}
      />
    )
  }

  const systemViews = [
    { id: 'AV',  name: 'All',                filters: [],                                                       sortField: 'object', sortDir: 'asc' },
    { id: 'WT',  name: 'With Transitions',   filters: [{ field: 'transitionCount', op: 'greaterThan', value: 0 }], sortField: 'transitionCount', sortDir: 'desc' },
    { id: 'NT',  name: 'Without Transitions', filters: [{ field: 'transitionCount', op: 'equals', value: 0 }],     sortField: 'object', sortDir: 'asc' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Lifecycle Builder</div>
          <HelpIcon
            anchors={[
              { type: 'route', route: '/admin/lifecycle_builder' },
              { type: 'object', object: 'status_transitions' },
              { type: 'concept', concept: 'status-lifecycle' },
              { type: 'concept', concept: 'lifecycle-builder' },
            ]}
            title="Lifecycle Builder"
          />
        </div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading ? 'Loading…' : `${summary.length} status lifecycle${summary.length === 1 ? '' : 's'} — click a row to edit the transition graph`}
        </div>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && (
        <ListView
          data={summary}
          columns={SUMMARY_COLS}
          systemViews={systemViews}
          defaultViewId="AV"
          newLabel={null}
          onOpenRecord={row => row?._object && setDrillTarget({ object: row._object, statusField: row._statusField })}
        />
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// LifecycleGraphEditor — drill-in view for one (object, status_field)
// ───────────────────────────────────────────────────────────────────────────

function LifecycleGraphEditor({ object, statusField, onBack }) {
  const toast = useToast()
  const [data,    setData]    = useState({ statuses: [], transitions: [] })
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState(null)   // transition row being edited
  const [busy,    setBusy]    = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchStatusTransitionsFor(object, statusField)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [object, statusField])

  useEffect(() => { reload() }, [reload])

  // statusId → status object, for quick label resolution on transition rows
  const statusById = useMemo(() => {
    const m = new Map()
    for (const s of data.statuses) m.set(s.id, s)
    return m
  }, [data.statuses])

  // statusId → outgoing transitions, used by the left-column status list
  // to show the fan-out for each node.
  const outgoingByStatus = useMemo(() => {
    const m = new Map()
    m.set('__initial__', [])
    for (const t of data.transitions) {
      const key = t.fromStatusId || '__initial__'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(t)
    }
    return m
  }, [data.transitions])

  const handleCreate = useCallback(async (payload) => {
    setBusy(true)
    try {
      await createStatusTransition({
        object, statusField,
        fromStatusId: payload.fromStatusId,
        toStatusId:   payload.toStatusId,
        label:        payload.label,
        description:  payload.description,
        sortOrder:    payload.sortOrder,
        isActive:     payload.isActive,
      })
      toast.success('Transition created.')
      setShowNew(false)
      await reload()
    } catch (e) {
      toast.error(e.message || 'Create failed')
    } finally {
      setBusy(false)
    }
  }, [object, statusField, reload, toast])

  const handleUpdate = useCallback(async (transitionId, patch) => {
    setBusy(true)
    try {
      await updateStatusTransition(transitionId, patch)
      toast.success('Transition updated.')
      setEditing(null)
      await reload()
    } catch (e) {
      toast.error(e.message || 'Update failed')
    } finally {
      setBusy(false)
    }
  }, [reload, toast])

  const handleDelete = useCallback(async (transitionId) => {
    if (!window.confirm('Soft-delete this transition? It will be removed from the lifecycle but kept in the recycle bin.')) return
    setBusy(true)
    try {
      await softDeleteStatusTransition(transitionId, 'Removed via Lifecycle Builder')
      toast.success('Transition removed.')
      await reload()
    } catch (e) {
      toast.error(e.message || 'Delete failed')
    } finally {
      setBusy(false)
    }
  }, [reload, toast])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{
            background: 'transparent', border: 'none', color: C.textSecondary,
            fontSize: 12.5, cursor: 'pointer', padding: 0,
          }}>← All Lifecycles</button>
          <span style={{ color: C.textMuted, fontSize: 11 }}>/</span>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>
            {object}.{statusField}
          </div>
          <HelpIcon
            anchors={[
              { type: 'object', object: 'status_transitions' },
              { type: 'concept', concept: 'status-lifecycle' },
              { type: 'concept', concept: 'lifecycle-builder' },
            ]}
            title="Lifecycle graph"
          />
        </div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading
            ? 'Loading…'
            : `${data.statuses.filter(s => s.isActive).length} active status${data.statuses.length === 1 ? '' : 'es'} · ${data.transitions.filter(t => t.isActive).length} active transition${data.transitions.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}

      {!loading && !error && (
        <div style={{ flex: 1, overflow: 'auto', padding: 20, background: C.page }}>
          <div style={{
            display: 'grid', gap: 20,
            gridTemplateColumns: 'minmax(280px, 1fr) minmax(420px, 2fr)',
          }}>
            {/* ── Statuses column ──────────────────────────────────────── */}
            <section style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 8, overflow: 'hidden',
            }}>
              <header style={paneHeader}>
                <span>Statuses</span>
                <span style={{ fontWeight: 400, color: C.textMuted, fontSize: 11.5 }}>
                  {data.statuses.length} total
                </span>
              </header>
              {data.statuses.length === 0 && (
                <div style={emptyStyle}>
                  No picklist values exist on {object}.{statusField}. Add statuses to the picklist before authoring transitions.
                </div>
              )}
              {/* Initial-state pseudo-node so authors see where new-record
                  transitions originate. */}
              <StatusRow
                value="(initial creation)"
                label="When the record is first inserted"
                isInitial
                outgoingCount={outgoingByStatus.get('__initial__')?.length || 0}
              />
              {data.statuses.map(s => (
                <StatusRow
                  key={s.id}
                  value={s.value}
                  label={s.label}
                  inactive={!s.isActive}
                  outgoingCount={outgoingByStatus.get(s.id)?.length || 0}
                />
              ))}
            </section>

            {/* ── Transitions column ───────────────────────────────────── */}
            <section style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 8, overflow: 'hidden',
            }}>
              <header style={{ ...paneHeader, justifyContent: 'space-between' }}>
                <span>Transitions</span>
                <button
                  disabled={busy || data.statuses.length === 0}
                  onClick={() => setShowNew(true)}
                  style={{ ...buttonPrimaryStyle, padding: '5px 11px', fontSize: 12 }}
                >+ New Transition</button>
              </header>
              {data.transitions.length === 0 && (
                <div style={emptyStyle}>
                  No transitions authored yet. Add one to define the lifecycle's allowed status changes.
                </div>
              )}
              {data.transitions.map(t => (
                <TransitionRow
                  key={t.id}
                  transition={t}
                  fromStatus={t.fromStatusId ? statusById.get(t.fromStatusId) : null}
                  toStatus={statusById.get(t.toStatusId)}
                  onEdit={() => setEditing(t)}
                  onDelete={() => handleDelete(t.id)}
                  disabled={busy}
                />
              ))}
            </section>
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {showNew && (
        <TransitionFormModal
          mode="create"
          object={object}
          statusField={statusField}
          statuses={data.statuses}
          existing={data.transitions}
          onSubmit={handleCreate}
          onCancel={() => setShowNew(false)}
          busy={busy}
        />
      )}
      {editing && (
        <TransitionFormModal
          mode="edit"
          object={object}
          statusField={statusField}
          statuses={data.statuses}
          existing={data.transitions}
          initial={editing}
          onSubmit={(payload) => handleUpdate(editing.id, payload)}
          onCancel={() => setEditing(null)}
          busy={busy}
        />
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────────────────────────────────────

const paneHeader = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 14px',
  background: C.cardSecondary,
  borderBottom: `1px solid ${C.border}`,
  fontSize: 12.5, fontWeight: 600, color: C.textPrimary,
}

const emptyStyle = {
  padding: '18px 14px',
  fontSize: 12.5,
  color: C.textMuted,
  fontStyle: 'italic',
}

function StatusRow({ value, label, isInitial, inactive, outgoingCount }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px',
      borderBottom: `1px solid ${C.border}`,
      background: isInitial ? '#f0f9ff' : C.card,
      opacity: inactive ? 0.5 : 1,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: isInitial ? '#0369a1' : C.textPrimary,
          fontFamily: isInitial ? 'inherit' : 'JetBrains Mono, monospace',
          fontStyle: isInitial ? 'italic' : 'normal',
        }}>
          {value}
          {inactive && (
            <span style={{ marginLeft: 6, fontFamily: 'inherit', fontWeight: 400, fontStyle: 'italic', fontSize: 11, color: C.textMuted }}>
              (inactive)
            </span>
          )}
        </div>
        {!isInitial && label !== value && (
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 2 }}>{label}</div>
        )}
      </div>
      <div style={{
        flexShrink: 0, marginLeft: 12,
        fontSize: 11, color: outgoingCount === 0 ? C.textMuted : C.emerald, fontWeight: 600,
      }}>
        {outgoingCount === 0 ? 'no exits' : `${outgoingCount} exit${outgoingCount === 1 ? '' : 's'}`}
      </div>
    </div>
  )
}

function TransitionRow({ transition, fromStatus, toStatus, onEdit, onDelete, disabled }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: `1px solid ${C.border}`,
      opacity: transition.isActive ? 1 : 0.55,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
            {transition.label}
            {!transition.isActive && (
              <span style={{ marginLeft: 8, fontWeight: 400, fontStyle: 'italic', fontSize: 11, color: C.textMuted }}>
                (inactive)
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
            <StatusPill status={fromStatus} isInitial={!fromStatus} />
            <span style={{ color: C.textMuted, fontSize: 14 }}>→</span>
            <StatusPill status={toStatus} />
            <span style={{ color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, marginLeft: 6 }}>
              {transition.recordNumber}
            </span>
          </div>
          {transition.description && (
            <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 4, lineHeight: 1.45 }}>
              {transition.description}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button disabled={disabled} onClick={onEdit} style={{
            ...buttonSecondaryStyle, padding: '4px 10px', fontSize: 11.5,
            opacity: disabled ? 0.5 : 1,
          }}>Edit</button>
          <button disabled={disabled} onClick={onDelete} style={{
            background: 'transparent', border: `1px solid #fecaca`, color: '#b91c1c',
            padding: '4px 10px', fontSize: 11.5, borderRadius: 5,
            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
          }}>Remove</button>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status, isInitial }) {
  if (isInitial) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '3px 8px', borderRadius: 4,
        fontSize: 11, fontStyle: 'italic',
        background: '#f0f9ff', color: '#0369a1',
        border: '1px solid #bae6fd',
      }}>(initial)</span>
    )
  }
  if (!status) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '3px 8px', borderRadius: 4,
        fontSize: 11, fontStyle: 'italic',
        background: '#fef2f2', color: '#991b1b',
        border: '1px solid #fecaca',
      }}>(missing status)</span>
    )
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 8px', borderRadius: 4,
      fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
      background: status.isActive ? '#f1f5f9' : '#f9fafb',
      color: status.isActive ? C.textPrimary : C.textMuted,
      border: `1px solid ${status.isActive ? C.border : C.border}`,
    }}>{status.value}</span>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// TransitionFormModal — single modal handles both create and edit
// ───────────────────────────────────────────────────────────────────────────

function TransitionFormModal({ mode, object, statusField, statuses, existing, initial, onSubmit, onCancel, busy }) {
  const isEdit = mode === 'edit'
  const [fromStatusId, setFromStatusId] = useState(initial?.fromStatusId || '')
  const [toStatusId,   setToStatusId]   = useState(initial?.toStatusId   || '')
  const [label,        setLabel]        = useState(initial?.label        || '')
  const [description,  setDescription]  = useState(initial?.description  || '')
  const [sortOrder,    setSortOrder]    = useState(initial?.sortOrder    ?? 0)
  const [isActive,     setIsActive]     = useState(initial?.isActive     !== false)

  // Validate before submit — server enforces the same rules but bouncing
  // them client-side keeps the modal responsive and the errors specific.
  const fromIdNormalized = fromStatusId === '' ? null : fromStatusId
  const validationError = useMemo(() => {
    if (!toStatusId) return 'Pick a destination status.'
    if (fromIdNormalized && fromIdNormalized === toStatusId) return 'From and To cannot be the same status.'
    if (!label.trim()) return 'Give the transition a short label (e.g. "Submit for verification").'
    // Duplicate-edge guard — case where adding a new row would collide with
    // an existing not-deleted row, or editing would collide with a peer.
    const collision = (existing || []).find(t => {
      if (isEdit && t.id === initial?.id) return false
      const tFrom = t.fromStatusId || null
      return tFrom === fromIdNormalized && t.toStatusId === toStatusId
    })
    if (collision) return `A transition from this status to this destination already exists (${collision.recordNumber}).`
    return null
  }, [fromIdNormalized, toStatusId, label, existing, isEdit, initial])

  const submit = () => {
    if (validationError) return
    onSubmit({
      fromStatusId: fromIdNormalized,
      toStatusId,
      label:       label.trim(),
      description: description.trim() || null,
      sortOrder:   Number(sortOrder) || 0,
      isActive,
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, borderRadius: 10, width: 520, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <header style={{
          padding: '16px 22px', borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
            {isEdit ? 'Edit Transition' : 'New Transition'}
          </div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
            {object}.{statusField}
          </div>
        </header>

        <div style={{ padding: '16px 22px', overflowY: 'auto', flex: 1 }}>
          <FormField label="From Status">
            <select
              value={fromStatusId}
              onChange={(e) => setFromStatusId(e.target.value)}
              disabled={busy}
              style={inputStyle}
            >
              <option value="">(initial creation — no prior status)</option>
              {statuses.map(s => (
                <option key={s.id} value={s.id}>
                  {s.value}{!s.isActive ? ' — inactive' : ''}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="To Status" required>
            <select
              value={toStatusId}
              onChange={(e) => setToStatusId(e.target.value)}
              disabled={busy}
              style={inputStyle}
            >
              <option value="">— Select —</option>
              {statuses.map(s => (
                <option key={s.id} value={s.id}>
                  {s.value}{!s.isActive ? ' — inactive' : ''}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Transition Label" required>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder='e.g. "Submit for verification"'
              disabled={busy}
              style={inputStyle}
              maxLength={120}
            />
          </FormField>

          <FormField label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When does this transition fire? Who can trigger it? What evidence does it require?"
              disabled={busy}
              style={textareaStyle}
              rows={3}
            />
          </FormField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FormField label="Sort Order">
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                disabled={busy}
                style={inputStyle}
              />
            </FormField>
            <FormField label="Active">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={busy}
                />
                <span style={{ color: C.textSecondary }}>
                  {isActive ? 'Available for use' : 'Hidden from lifecycle'}
                </span>
              </label>
            </FormField>
          </div>

          {validationError && (
            <div style={{
              padding: 10, background: '#fef3c7', border: '1px solid #fde68a',
              borderRadius: 6, fontSize: 12, color: '#92400e', marginTop: 6,
            }}>
              {validationError}
            </div>
          )}
        </div>

        <footer style={{
          padding: '12px 22px', borderTop: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onCancel} disabled={busy} style={{
            ...buttonSecondaryStyle, opacity: busy ? 0.5 : 1,
          }}>Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !!validationError}
            style={{
              ...buttonPrimaryStyle,
              opacity: (busy || validationError) ? 0.5 : 1,
              cursor: (busy || validationError) ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Transition'}
          </button>
        </footer>
      </div>
    </div>
  )
}
