import { useState, useEffect } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'

// Renders a single home-page component by type. Used both in the builder canvas
// (preview=true shows a labeled placeholder where live data would load) and on
// the live home screen (preview=false renders real embedded content).
//
// To avoid heavy imports at module load, the dashboard/report/list embeds are
// loaded lazily only when needed on the live screen.
export default function HomeComponentRenderer({ component, preview = false, sources = {}, onNavigate }) {
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
    case 'dashboard':       return <EmbeddedDashboard title={label} sourceId={sourceId} />
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
    import('../../data/tasksService').then(m => (m.fetchMyTasks ? m.fetchMyTasks() : Promise.resolve([])))
      .then(rows => { if (!cancelled) setTasks(rows || []) })
      .catch(() => { if (!cancelled) setTasks([]) })
    return () => { cancelled = true }
  }, [])
  return (
    <CardShell title={title}>
      <div style={{ padding: '6px 0' }}>
        {tasks === null && <div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>Loading tasks…</div>}
        {tasks && tasks.length === 0 && <div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>No open tasks.</div>}
        {tasks && tasks.slice(0, 8).map(t => (
          <div key={t.id} onClick={() => onNavigate && onNavigate('tasks', t.id)}
            style={{ padding: '8px 14px', borderTop: `1px solid ${C.border}`, fontSize: 12.5, color: C.textPrimary, cursor: onNavigate ? 'pointer' : 'default' }}>
            {t.title || t.name || t.subject || '(untitled task)'}
          </div>
        ))}
      </div>
    </CardShell>
  )
}

// ── Lazy embeds for dashboard / report / list view ────────────────────────
function EmbeddedDashboard({ title, sourceId }) {
  const [Comp, setComp] = useState(null)
  useEffect(() => { import('../DashboardRunner').then(m => setComp(() => m.default)).catch(() => setComp(null)) }, [])
  if (!sourceId) return <CardShell title={title}><div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>No dashboard selected.</div></CardShell>
  if (!Comp) return <CardShell title={title}><div style={{ padding: 14, color: C.textMuted, fontSize: 12 }}>Loading dashboard…</div></CardShell>
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <Comp dashboardId={sourceId} embedded />
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

function EmbeddedListView({ title, sourceId, sources, onNavigate }) {
  const view = sources.listViews?.find(v => v.id === sourceId)
  return (
    <CardShell title={title}>
      <div style={{ padding: 14, fontSize: 12, color: C.textMuted }}>
        {view ? `List view "${view.name}" on ${view.object || 'records'}.` : 'No list view selected.'}
      </div>
    </CardShell>
  )
}
