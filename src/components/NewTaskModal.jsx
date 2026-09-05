// =============================================================================
// NewTaskModal — create a task and assign it to somebody.
//
// Nicholas, 2026-09-05: "the tasks are something separate, like someone creates
// a task, just like Salesforce. I just don't see that anywhere in the database."
//
// The object was there and he was still right: every one of the 71 tasks on the
// platform was written by a database trigger, because there was no create path
// anywhere in the client. This is it.
//
// Deliberately its own small modal rather than the platform's generic
// required-fields-only create pop-up: tasks has no record type, its owner is a
// user rather than a record, and the whole form is five fields. Routing it
// through RecordDetail's create mode would drag in the record-type picker, the
// parent-chain prefill and the duplicate gate for a form that asks who is doing
// what by when.
// =============================================================================

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../data/constants'
import { useToast } from './Toast'
import { createTask, fetchAssignableUsers, fetchTaskPicklists } from '../data/tasksService'

const label = {
  display: 'block', fontSize: 11.5, fontWeight: 600,
  color: C.textSecondary, marginBottom: 5, letterSpacing: 0.2,
}
const field = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: `1px solid ${C.borderDark}`, borderRadius: 6,
  background: C.card, color: C.textPrimary, boxSizing: 'border-box',
}

export default function NewTaskModal({
  onClose,
  onCreated,
  // A task created from a record hangs off it. Both are optional: a task can
  // be about nothing in particular, which is most of what a to-do list is.
  relatedObject = null,
  relatedId = null,
  relatedLabel = null,
}) {
  const toast = useToast()

  const [users, setUsers]         = useState([])
  const [picklists, setPicklists] = useState({ status: [], priority: [] })
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving]       = useState(false)

  const [subject, setSubject]         = useState('')
  const [description, setDescription] = useState('')
  const [ownerId, setOwnerId]         = useState('')
  const [dueDate, setDueDate]         = useState('')
  const [status, setStatus]           = useState('')
  const [priority, setPriority]       = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [u, p] = await Promise.all([fetchAssignableUsers(), fetchTaskPicklists()])
        if (!alive) return
        setUsers(u)
        setPicklists(p)
        // Default to the first value of each list rather than a hardcoded
        // string, so the form cannot offer a status the database does not have.
        setStatus(s => s || p.status[0]?.value || '')
        setPriority(s => s || p.priority.find(x => x.value === 'Normal')?.value || p.priority[0]?.value || '')
        setLoadError(null)
      } catch (e) {
        if (alive) setLoadError(e.message || String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Escape closes, the way every other pop-up on the platform behaves.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const canSave = subject.trim() !== '' && ownerId !== '' && !saving && !loading

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      const task = await createTask({
        subject,
        description,
        status,
        priority,
        ownerId,
        dueDate: dueDate || null,
        relatedObject,
        relatedId,
      })
      onCreated?.(task)
    } catch (e) {
      // Surface what the database actually said. A task insert can fail on RLS
      // or on a not-null the form does not carry, and "failed to save" tells
      // nobody anything.
      toast.error(`Could not create the task: ${e.message || e}`)
      setSaving(false)
    }
  }

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(13,26,46,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '6vh 16px', overflowY: 'auto',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 520, background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 8,
        boxShadow: '0 12px 40px rgba(13,26,46,0.22)',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>New Task</div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => !saving && onClose()}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.textMuted, fontSize: 18, lineHeight: 1, padding: 2,
            }}
            aria-label="Close"
          >×</button>
        </div>

        <div style={{ padding: 18 }}>
          {relatedLabel && (
            <div style={{
              marginBottom: 14, padding: '8px 10px', borderRadius: 6,
              background: C.cardSecondary, border: `1px solid ${C.border}`,
              fontSize: 12, color: C.textSecondary,
            }}>
              Related to <b style={{ color: C.textPrimary }}>{relatedLabel}</b>
            </div>
          )}

          {loadError && (
            <div style={{
              marginBottom: 14, padding: '8px 10px', borderRadius: 6,
              background: '#e8f1fb', border: `1px solid ${C.sky}`,
              fontSize: 12, color: C.navy,
            }}>
              Could not load the assignee list: {loadError}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={label}>Subject</label>
            <input
              autoFocus
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="What needs doing?"
              style={field}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={label}>Assigned To</label>
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)} style={field}>
              <option value="">
                {loading ? 'Loading…' : 'Choose a person…'}
              </option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 5 }}>
              Every task has a named owner. They are notified in LEAP as soon as you save.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={field} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} style={field}>
                {picklists.priority.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={label}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={field}>
              {picklists.status.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={label}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="Anything the assignee needs to know."
              style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        <div style={{
          padding: '12px 18px', borderTop: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button
            onClick={() => !saving && onClose()}
            style={{
              background: 'transparent', border: `1px solid ${C.borderDark}`,
              borderRadius: 6, padding: '8px 16px', fontSize: 13,
              color: C.textSecondary, cursor: saving ? 'default' : 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={save}
            disabled={!canSave}
            style={{
              background: canSave ? C.emerald : C.borderDark,
              color: '#ffffff', border: 'none', borderRadius: 6,
              padding: '8px 18px', fontSize: 13, fontWeight: 600,
              cursor: canSave ? 'pointer' : 'default',
            }}
          >{saving ? 'Saving…' : 'Create Task'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
