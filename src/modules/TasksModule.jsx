import { useEffect, useMemo, useState, useCallback } from 'react'
import { C } from '../data/constants'
import { Icon, SectionTabs, LoadingState, ErrorState } from '../components/UI'
import { ListView } from '../components/ListView'
import RecordDetail from '../components/RecordDetail'
import HelpIcon from '../components/help/HelpIcon'
import { useToast } from '../components/Toast'
import { fetchTasks, markTaskComplete, reopenTask } from '../data/tasksService'

// ---------------------------------------------------------------------------
// TasksModule — global to-do queue surface.
//
// Four tabs:
//   My Tasks   — tasks owned by the current user (default)
//   All Tasks  — every live task
//   Automated  — tasks created by automation rules (is_automated = true)
//   Overdue    — past-due, not completed
//
// Clicking a row opens the task RecordDetail. Each row also has a quick
// Complete / Reopen button that flips status without leaving the list.
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: 'mine',      label: 'My Tasks'   },
  { id: 'all',       label: 'All Tasks'  },
  { id: 'automated', label: 'Automated'  },
  { id: 'overdue',   label: 'Overdue'    },
]

const COLS = [
  { field: 'id',              label: 'Task #',          type: 'text',   sortable: true,  filterable: false },
  { field: 'subjectDisplay',  label: 'Subject',         type: 'text',   sortable: true,  filterable: true  },
  { field: 'status',          label: 'Status',          type: 'select', sortable: true,  filterable: true,
    options: ['Open', 'In Progress', 'Completed', 'Cancelled'] },
  { field: 'priorityDisplay', label: 'Priority',        type: 'text',   sortable: true,  filterable: true  },
  { field: 'dueDateDisplay',  label: 'Due',             type: 'text',   sortable: true,  filterable: false },
  { field: 'ownerDisplay',    label: 'Owner',           type: 'text',   sortable: true,  filterable: true  },
  { field: 'relatedDisplay',  label: 'Related To',      type: 'text',   sortable: true,  filterable: true  },
  { field: 'sourceBadge',     label: 'Source',          type: 'text',   sortable: false, filterable: false },
  { field: 'actionButton',    label: '',                type: 'text',   sortable: false, filterable: false },
]

function PriorityChip({ priority }) {
  const c = {
    Critical: { bg: '#fee2e2', fg: '#991b1b' },
    High:     { bg: '#fed7aa', fg: '#9a3412' },
    Normal:   { bg: '#dbeafe', fg: '#1e40af' },
    Low:      { bg: '#e5e7eb', fg: '#4b5563' },
  }[priority] || { bg: '#e5e7eb', fg: '#4b5563' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.fg,
    }}>{priority}</span>
  )
}

export default function TasksModule({ onNavigateToRecord, onReplaceRecord }) {
  const toast = useToast()
  const [section, setSection] = useState('mine')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openedTaskId, setOpenedTaskId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchTasks(section)
      setRows(data)
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [section])

  useEffect(() => { load() }, [load])

  async function handleComplete(taskId) {
    try {
      await markTaskComplete(taskId)
      toast.success('Task marked complete')
      await load()
    } catch (e) {
      toast.error(`Failed: ${e.message || e}`)
    }
  }

  async function handleReopen(taskId) {
    try {
      await reopenTask(taskId)
      toast.success('Task reopened')
      await load()
    } catch (e) {
      toast.error(`Failed: ${e.message || e}`)
    }
  }

  function openTask(rowId) {
    setOpenedTaskId(rowId)
  }

  const shaped = useMemo(() => rows.map(r => ({
    ...r,
    subjectDisplay: (
      <span>
        {r.isOverdue && <span style={{ color: C.danger, marginRight: 4 }}>⚠</span>}
        <span style={{ fontWeight: r.status === 'Completed' ? 400 : 600, color: r.status === 'Completed' ? C.textMuted : C.textPrimary, textDecoration: r.status === 'Completed' ? 'line-through' : 'none' }}>
          {r.subject}
        </span>
      </span>
    ),
    priorityDisplay: <PriorityChip priority={r.priority} />,
    ownerDisplay: r.ownerIsMe ? <strong style={{ color: C.textPrimary }}>You</strong> : r.ownerName,
    relatedDisplay: r.relatedObject !== '—'
      ? (
        <span
          style={{ color: C.accentLink || C.emerald, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={(e) => {
            e.stopPropagation()
            if (r.relatedId && onNavigateToRecord) onNavigateToRecord(r.relatedObject, r.relatedId)
          }}
        >
          {r.relatedObject}
        </span>
      )
      : '—',
    sourceBadge: r.isAutomated
      ? <span title={r.automationRule} style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: 12,
          fontSize: 10, fontWeight: 600, background: '#ede9fe', color: '#5b21b6',
        }}>AUTO</span>
      : <span style={{ color: C.textMuted, fontSize: 11 }}>Manual</span>,
    actionButton: r.status === 'Completed'
      ? <ActionLink label="Reopen" onClick={() => handleReopen(r._id)} />
      : <ActionLink label="Complete" onClick={() => handleComplete(r._id)} accent />,
  })), [rows])

  if (openedTaskId) {
    return (
      <RecordDetail
        table="tasks"
        recordId={openedTaskId}
        onClose={() => { setOpenedTaskId(null); load() }}
        onNavigateToRecord={(table, id) => {
          if (table === 'tasks') setOpenedTaskId(id)
          else if (onNavigateToRecord) onNavigateToRecord(table, id)
        }}
      />
    )
  }

  return (
    <div style={{ padding: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 12,
      }}>
        <Icon path="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" size={20} color={C.textPrimary} />
        <div style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary }}>Tasks</div>
        <HelpIcon anchors={[{ type: 'concept', concept: 'tasks-module-overview' }]} />
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: C.textMuted }}>
          {rows.length} {rows.length === 1 ? 'task' : 'tasks'}
        </div>
      </div>

      <SectionTabs sections={SECTIONS} active={section} onChange={setSection} />

      <div style={{ marginTop: 14 }}>
        {loading ? <LoadingState /> :
         error   ? <ErrorState message={error} /> :
         rows.length === 0 ? (
           <div style={{
             padding: '60px 20px', textAlign: 'center',
             background: C.card, border: `1px dashed ${C.border}`,
             borderRadius: 8, color: C.textMuted, fontSize: 13,
           }}>
             {section === 'mine'      ? 'No tasks assigned to you.' :
              section === 'automated' ? 'No tasks have been auto-created yet.' :
              section === 'overdue'   ? 'No overdue tasks. Nice work.' :
              'No tasks yet.'}
           </div>
         ) : (
           <ListView
             columns={COLS}
             rows={shaped}
             rowKey="_id"
             onRowClick={(row) => openTask(row._id)}
           />
         )}
      </div>
    </div>
  )
}

function ActionLink({ label, onClick, accent }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      style={{
        background: 'transparent', border: 'none',
        color: accent ? C.emerald : C.textSecondary,
        fontWeight: accent ? 600 : 400, fontSize: 12, cursor: 'pointer',
        padding: '2px 6px',
      }}
    >{label}</button>
  )
}
