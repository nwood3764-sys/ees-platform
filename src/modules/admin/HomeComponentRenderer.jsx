import { useState, useEffect } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'

// Renders a single home-page component by type. Used both in the builder canvas
// (preview=true shows a labeled placeholder where live data would load) and on
// the live home screen (preview=false renders real embedded content).
//
// To avoid heavy imports at module load, the dashboard/report/list embeds are
// loaded lazily only when needed on the live screen.
export default function HomeComponentRenderer({ component, preview = false, sources = {}, onNavigate, onOpenReport }) {
  const { type, sourceId, title, config = {} } = component

  const label = title || defaultTitle(type, sourceId, sources)

  if (preview) {
    return (
      <CardShell title={label}>
        <div style={{ padding: '18px 14px', textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
          {previewHint(type, sourceId, sources)}
        </div>
      </CardShell>
    )
  }

  switch (type) {
    case 'metric_card':     return <MetricCard title={label} config={config} />
    case 'percentage_card': return <PercentageCard title={label} config={config} />
    case 'gauge':           return <GaugeCard title={label} config={config} />
    case 'rich_text':       return <RichTextCard title={label} config={config} />
    case 'task_list':       return <TaskListCard title={label} onNavigate={onNavigate} />
    case 'dashboard':       return <EmbeddedDashboard title={label} sourceId={sourceId} onNavigate={onNavigate} onOpenReport={onOpenReport} />
    case 'report_chart':    return <EmbeddedReport title={label} sourceId={sourceId} />
    case 'list_view':       return <EmbeddedListView title={label} sourceId={sourceId} sources={sources} onNavigate={onNavigate} />
    default:                return <CardShell title={label}><div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>Unknown component</div></CardShell>
  }
}

function defaultTitle(type, sourceId, sources) {
  if (type === 'dashboard') return sources.dashboards?.find(d => d.id === sourceId)?.name || 'Dashboard'
  if (type === 'report_chart') return sources.reports?.find(r => r.id === sourceId)?.name || 'Report Chart'
  if (type === 'list_view') return sources.listViews?.find(v => v.id === sourceId)?.name || 'List View'
  const map = { task_list: 'Tasks', metric_card: 'Metric', gauge: 'Gauge', percentage_card: 'Percentage', rich_text: 'Note' }
  return map[type] || 'Component'
}

function previewHint(type, sourceId, sources) {
  if (type === 'dashboard') return sourceId ? `Dashboard: ${sources.dashboards?.find(d => d.id === sourceId)?.name || '—'}` : 'Pick a dashboard in the properties panel'
  if (type === 'report_chart') return sourceId ? `Report: ${sources.reports?.find(r => r.id === sourceId)?.name || '—'}` : 'Pick a report in the properties panel'
  if (type === 'list_view') return sourceId ? `List View: ${sources.listViews?.find(v => v.id === sourceId)?.name || '—'}` : 'Pick a list view in the properties panel'
  if (type === 'task_list') return 'Task list (renders the current user’s tasks)'
  if (type === 'metric_card') return 'Metric card'
  if (type === 'gauge') return 'Gauge'
  if (type === 'percentage_card') return 'Percentage card'
  if (type === 'rich_text') return 'Rich text / note'
  return 'Component'
}

function CardShell({ title, children, right }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

// ── Lightweight self-contained cards ──────────────────────────────────────
function MetricCard({ title, config }) {
  const value = config.value ?? '—'
  const sub = config.subtitle || ''
  return (
    <CardShell title={title}>
      <div style={{ padding: '20px 16px' }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: C.textPrimary }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
      </div>
    </CardShell>
  )
}

function PercentageCard({ title, config }) {
  const pct = Math.max(0, Math.min(100, Number(config.percent ?? 0)))
  return (
    <CardShell title={title}>
      <div style={{ padding: '18px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: C.textPrimary }}>{pct}%</span>
          {config.subtitle && <span style={{ fontSize: 11.5, color: C.textMuted }}>{config.subtitle}</span>}
        </div>
        <div style={{ height: 8, background: '#eef1f6', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: config.color || C.emerald }} />
        </div>
      </div>
    </CardShell>
  )
}

function GaugeCard({ title, config }) {
  const pct = Math.max(0, Math.min(100, Number(config.percent ?? 0)))
  const angle = -90 + (pct / 100) * 180
  const color = config.color || C.emerald
  return (
    <CardShell title={title}>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <svg viewBox="0 0 120 70" style={{ width: 160, height: 92 }}>
          <path d="M10 64 A50 50 0 0 1 110 64" fill="none" stroke="#eef1f6" strokeWidth="12" strokeLinecap="round" />
          <path d="M10 64 A50 50 0 0 1 110 64" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 157} 157`} />
          <line x1="60" y1="64" x2={60 + 40 * Math.cos((angle) * Math.PI / 180)} y2={64 + 40 * Math.sin((angle) * Math.PI / 180)}
                stroke={C.textPrimary} strokeWidth="3" strokeLinecap="round" />
          <circle cx="60" cy="64" r="4" fill={C.textPrimary} />
        </svg>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, marginTop: -6 }}>{pct}%</div>
        {config.subtitle && <div style={{ fontSize: 11.5, color: C.textMuted }}>{config.subtitle}</div>}
      </div>
    </CardShell>
  )
}

function RichTextCard({ title, config }) {
  return (
    <CardShell title={title}>
      <div style={{ padding: '14px 16px', fontSize: 12.5, color: C.textSecondary, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
        {config.text || ''}
      </div>
    </CardShell>
  )
}

function TaskListCard({ title, onNavigate }) {
  const [tasks, setTasks] = useState(null)
  useEffect(() => {
    let cancelled = false
    import('../../data/tasksService')
      .then(m => (m.fetchTasks ? m.fetchTasks('mine') : Promise.resolve([])))
      .then(rows => { if (!cancelled) setTasks((rows || []).filter(t => t.status !== 'Completed')) })
      .catch(() => { if (!cancelled) setTasks([]) })
    return () => { cancelled = true }
  }, [])
  return (
    <CardShell title={title}>
      <div style={{ padding: '6px 0' }}>
        {tasks === null && <div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>Loading tasks…</div>}
        {tasks && tasks.length === 0 && <div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>No open tasks.</div>}
        {tasks && tasks.slice(0, 8).map(t => (
          <div key={t._id} onClick={() => onNavigate && onNavigate('tasks', t._id)}
            style={{ padding: '8px 14px', borderTop: `1px solid ${C.border}`, fontSize: 12.5, color: C.textPrimary, cursor: onNavigate ? 'pointer' : 'default', display: 'flex', justifyContent: 'space-between', gap: 10 }}
            onMouseEnter={e => { if (onNavigate) e.currentTarget.style.background = '#f7faf9' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
            {t.isOverdue && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: '#b03a2e' }}>OVERDUE</span>}
          </div>
        ))}
      </div>
    </CardShell>
  )
}

// ── Lazy embeds for dashboard / report / list view ────────────────────────
function EmbeddedDashboard({ title, sourceId, onNavigate, onOpenReport }) {
  const [Comp, setComp] = useState(null)
  useEffect(() => { import('../DashboardRunner').then(m => setComp(() => m.default)).catch(() => setComp(null)) }, [])
  if (!sourceId) return <CardShell title={title}><div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>No dashboard selected.</div></CardShell>
  if (!Comp) return <CardShell title={title}><div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>Loading dashboard…</div></CardShell>
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <Comp dashboardId={sourceId} embedded onNavigate={onNavigate} onOpenReport={onOpenReport} />
    </div>
  )
}

function EmbeddedReport({ title, sourceId }) {
  const [Comp, setComp] = useState(null)
  useEffect(() => { import('../ReportRunner').then(m => setComp(() => m.default)).catch(() => setComp(null)) }, [])
  if (!sourceId) return <CardShell title={title}><div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>No report selected.</div></CardShell>
  if (!Comp) return <CardShell title={title}><div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>Loading report…</div></CardShell>
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <Comp reportId={sourceId} embedded chartOnly />
    </div>
  )
}

// Column-name → human label. Strips a leading "<object>_" prefix and the
// trailing "_id" on FK columns, then title-cases.
function humanizeColumn(col, object) {
  let c = col
  if (object && c.startsWith(object.replace(/s$/, '') + '_')) c = c.slice(object.replace(/s$/, '').length + 1)
  c = c.replace(/_id$/, '').replace(/_/g, ' ').trim()
  return c.replace(/\b\w/g, m => m.toUpperCase())
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function formatCell(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : '—'
  const s = String(v)
  // Raw UUID FK value with no resolved label — show a dash rather than an opaque id
  if (UUID_RE.test(s)) return '—'
  // ISO date / datetime → short date
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(s)) {
    const d = new Date(s)
    if (!isNaN(d)) return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  return s.length > 40 ? s.slice(0, 38) + '…' : s
}

// Pick which columns to display: the saved view's visibleColumns if set, else a
// sensible default — prefer a record-number/name column first, a status/stage,
// and a date, falling back to the first few non-system keys.
function pickColumns(visibleColumns, rows, object) {
  if (Array.isArray(visibleColumns) && visibleColumns.length > 0) return visibleColumns.slice(0, 4)
  if (!rows.length) return []
  const keys = Object.keys(rows[0])
  const SYS = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'])
  // A column whose non-empty sampled values are all bare UUIDs is an unresolved
  // FK (e.g. *_status/*_record_type → picklist_values.id) — opaque to a reader.
  const isUuidColumn = (k) => {
    const vals = rows.map(r => r[k]).filter(v => v !== null && v !== undefined && v !== '')
    return vals.length > 0 && vals.every(v => typeof v === 'string' && UUID_RE.test(v))
  }
  const usable = (k) => !SYS.has(k) && !k.endsWith('_id') && !isUuidColumn(k)
  const pref = []
  const nameCol = keys.find(k => /(_record_number|_name)$/.test(k)) || keys.find(k => k === 'name')
  if (nameCol) pref.push(nameCol)
  const statusCol = keys.find(k => /(_status|status|_stage|stage)$/.test(k) && !pref.includes(k) && !isUuidColumn(k))
  if (statusCol) pref.push(statusCol)
  const dateCol = keys.find(k => /(_date|_at)$/.test(k) && !SYS.has(k) && !pref.includes(k))
  if (dateCol) pref.push(dateCol)
  for (const k of keys) {
    if (pref.length >= 4) break
    if (usable(k) && !pref.includes(k)) pref.push(k)
  }
  return pref.slice(0, 4)
}

function EmbeddedListView({ title, sourceId, sources, onNavigate }) {
  const [state, setState] = useState({ status: 'loading', def: null, rows: [] })
  useEffect(() => {
    let cancelled = false
    if (!sourceId) { setState({ status: 'empty', def: null, rows: [] }); return }
    ;(async () => {
      try {
        const svc = await import('../../data/adminService')
        const def = await svc.fetchSavedListViewDef(sourceId)
        const rows = await svc.fetchListViewPreview({
          object: def.object, filters: def.filters,
          sortField: def.sortField, sortDirection: def.sortDirection, limit: 8,
        })
        if (!cancelled) setState({ status: 'ready', def, rows })
      } catch (e) {
        if (!cancelled) setState({ status: 'error', def: null, rows: [], error: e.message || String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [sourceId])

  const { status, def, rows } = state
  const heading = title || def?.name || 'List View'

  if (status === 'loading') return <CardShell title={heading}><div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>Loading…</div></CardShell>
  if (status === 'empty')   return <CardShell title={heading}><div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>No list view selected.</div></CardShell>
  if (status === 'error')   return <CardShell title={heading}><div style={{ padding: 14, color: '#b03a2e', fontSize: 12 }}>Could not load this list view.</div></CardShell>

  const cols = pickColumns(def.visibleColumns, rows, def.object)
  const nameKey = cols[0]

  return (
    <CardShell title={heading} right={<span style={{ fontSize: 11, color: C.textMuted }}>{rows.length === 8 ? '8+' : rows.length}</span>}>
      {rows.length === 0 ? (
        <div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>No matching records.</div>
      ) : (
        <div style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols.map((_, i) => i === 0 ? '1.6fr' : '1fr').join(' '), padding: '8px 14px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`, fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {cols.map(c => <div key={c} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{humanizeColumn(c, def.object)}</div>)}
          </div>
          {rows.map(r => (
            <div key={r.id}
              onClick={() => onNavigate && onNavigate(def.object, r.id)}
              style={{ display: 'grid', gridTemplateColumns: cols.map((_, i) => i === 0 ? '1.6fr' : '1fr').join(' '), padding: '8px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textPrimary, cursor: onNavigate ? 'pointer' : 'default' }}
              onMouseEnter={e => { if (onNavigate) e.currentTarget.style.background = '#f7faf9' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              {cols.map((c, i) => (
                <div key={c} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: i === 0 ? (onNavigate ? C.emerald : C.textPrimary) : C.textSecondary, fontWeight: i === 0 ? 500 : 400 }}>
                  {formatCell(r[c])}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}
