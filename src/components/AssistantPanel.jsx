// AssistantPanel — the persistent LEAP AI command assistant.
//
// A floating launcher button (bottom-right, every screen) opens a slide-in
// panel: a chat thread where the user types plain-English instructions. The
// edge function returns a reply plus optional proposed_actions. Proposed
// actions render as confirmation cards — the assistant NEVER mutates on its
// own; the user clicks Confirm, which commits through commit_screen_flow_run
// (server-side permission re-check). This is the spec's confirmation rule.
//
// Saved tasks: after an action is confirmed, the user can save it as a
// repeatable, shareable guided task. Saved tasks for the current object are
// offered in a "Frequently used tasks" bar; running one walks any guided
// question steps, then commits the resolved actions. This is the training /
// guided layer so other users don't start from a blank prompt.
//
// Record context: the panel receives the current module + selected record and
// passes {object, record_id, record_label} so the assistant knows what the
// user is looking at, per the "context-aware" requirement.

import { useState, useRef, useEffect, useCallback } from 'react'
import { C } from '../data/constants'
import { useToast } from './Toast'
import {
  sendAssistantMessage, commitAssistantActions,
  saveAssistantTask, listAssistantTasks, getAssistantTask, runAssistantTask,
} from '../data/assistantService'

// Map the app's selected-record shape to the edge function's context shape.
// selectedRecord carries { table, id, name/label } in this codebase; we read
// defensively since not every surface sets every field.
function buildContext(selectedRecord, listTable) {
  if (selectedRecord?.id) {
    return {
      object: selectedRecord.table || selectedRecord.object || listTable || null,
      record_id: selectedRecord.id,
      record_label: selectedRecord.name || selectedRecord.label || null,
    }
  }
  if (listTable) return { object: listTable }
  return null
}

function currentObject(selectedRecord, listTable) {
  return selectedRecord?.table || selectedRecord?.object || listTable || null
}

function verbFor(type) {
  return type === 'record_create' ? 'Create'
    : type === 'record_update' ? 'Update'
    : type === 'status_change' ? 'Change status'
    : 'Action'
}

function ActionCard({ action, onConfirm, onDismiss, onSave, busy, committed }) {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 8, background: C.card,
      padding: 12, marginTop: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.emeraldMid, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {verbFor(action.type)} · {action.object}
      </div>
      <div style={{ fontSize: 13, color: C.textPrimary, marginTop: 4 }}>
        {action.summary || `${verbFor(action.type)} on ${action.object}`}
      </div>
      {action.values && (
        <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 6, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {Object.entries(action.values).map(([k, v]) => `${k}: ${v}`).join('\n')}
        </div>
      )}
      {committed ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <div style={{ fontSize: 12, color: C.emeraldMid, fontWeight: 600 }}>✓ Done</div>
          <button
            type="button" onClick={onSave}
            style={{
              height: 28, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 6,
              cursor: 'pointer', background: C.cardSecondary || '#f7f9fc', color: C.textSecondary,
              fontSize: 12, fontFamily: 'inherit',
            }}
          >Save as task</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            type="button" disabled={busy} onClick={onConfirm}
            style={{
              flex: 1, height: 32, border: 'none', borderRadius: 6, cursor: busy ? 'wait' : 'pointer',
              background: C.emerald, color: '#fff', fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
            }}
          >Confirm</button>
          <button
            type="button" disabled={busy} onClick={onDismiss}
            style={{
              height: 32, padding: '0 14px', border: `1px solid ${C.border}`, borderRadius: 6,
              cursor: 'pointer', background: C.card, color: C.textSecondary, fontSize: 13, fontFamily: 'inherit',
            }}
          >Dismiss</button>
        </div>
      )}
    </div>
  )
}

// Modal to name and scope a task being saved from a confirmed action.
function SaveTaskModal({ action, defaultObject, onCancel, onSave, busy }) {
  const [name, setName] = useState(action?.summary || '')
  const [scoped, setScoped] = useState(true)
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(13,26,46,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, width: '100%', maxWidth: 340, padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: C.textPrimary, marginBottom: 10 }}>Save as repeatable task</div>
        <label style={{ fontSize: 12, color: C.textSecondary, display: 'block', marginBottom: 4 }}>Task name</label>
        <input
          value={name} onChange={e => setName(e.target.value)} autoFocus
          style={{ width: '100%', height: 34, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', color: C.textPrimary, outline: 'none', boxSizing: 'border-box' }}
        />
        {defaultObject && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: C.textSecondary, cursor: 'pointer' }}>
            <input type="checkbox" checked={scoped} onChange={e => setScoped(e.target.checked)} />
            Offer this task on {defaultObject} records
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            type="button" disabled={busy || !name.trim()}
            onClick={() => onSave({ name: name.trim(), launchObject: scoped ? defaultObject : null })}
            style={{ flex: 1, height: 34, border: 'none', borderRadius: 6, cursor: (busy || !name.trim()) ? 'default' : 'pointer', background: (busy || !name.trim()) ? C.borderDark : C.emerald, color: '#fff', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}
          >Save</button>
          <button
            type="button" onClick={onCancel}
            style={{ height: 34, padding: '0 14px', border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', background: C.card, color: C.textSecondary, fontSize: 13, fontFamily: 'inherit' }}
          >Cancel</button>
        </div>
      </div>
    </div>
  )
}

// Guided runner: walks a task's question steps, collecting answers, then
// previews the resolved actions and commits on confirm.
function TaskRunner({ task, snapshot, defaultObject, busy, onCancel, onRun }) {
  const questions = snapshot?.questions || []
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})

  const atActions = step >= questions.length
  const q = atActions ? null : questions[step]

  const answer = (val) => {
    const key = q.key || `q${step}`
    setAnswers(a => ({ ...a, [key]: val }))
    setStep(s => s + 1)
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(13,26,46,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, width: '100%', maxWidth: 360, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.emeraldMid, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          {task.name}
        </div>

        {!atActions && (
          <>
            <div style={{ fontSize: 14, color: C.textPrimary, marginBottom: 12 }}>{q.label}</div>
            {(q.type === 'yes_no') && (
              <div style={{ display: 'flex', gap: 8 }}>
                {['Yes', 'No'].map(opt => (
                  <button key={opt} type="button" onClick={() => answer(opt.toLowerCase())}
                    style={{ flex: 1, height: 36, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', background: C.card, color: C.textPrimary, fontSize: 13, fontFamily: 'inherit' }}>{opt}</button>
                ))}
              </div>
            )}
            {(q.type === 'single_select') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(q.options || []).map((opt, i) => {
                  const val = typeof opt === 'string' ? opt : (opt.value ?? opt.label)
                  const lbl = typeof opt === 'string' ? opt : (opt.label ?? opt.value)
                  return (
                    <button key={i} type="button" onClick={() => answer(val)}
                      style={{ height: 36, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', background: C.card, color: C.textPrimary, fontSize: 13, fontFamily: 'inherit', textAlign: 'left', padding: '0 12px' }}>{lbl}</button>
                  )
                })}
              </div>
            )}
            {(q.type !== 'yes_no' && q.type !== 'single_select') && (
              <FreeTextStep onSubmit={answer} busy={busy} />
            )}
          </>
        )}

        {atActions && (
          <>
            <div style={{ fontSize: 13, color: C.textPrimary, marginBottom: 12 }}>
              Ready to run “{task.name}”. This will be shown as an action you confirm.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={busy} onClick={() => onRun(answers)}
                style={{ flex: 1, height: 36, border: 'none', borderRadius: 6, cursor: busy ? 'wait' : 'pointer', background: C.emerald, color: '#fff', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Run task</button>
              <button type="button" onClick={onCancel}
                style={{ height: 36, padding: '0 14px', border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', background: C.card, color: C.textSecondary, fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
            </div>
          </>
        )}

        {!atActions && (
          <button type="button" onClick={onCancel}
            style={{ marginTop: 14, border: 'none', background: 'none', color: C.textMuted, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        )}
      </div>
    </div>
  )
}

function FreeTextStep({ onSubmit, busy }) {
  const [val, setVal] = useState('')
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        value={val} onChange={e => setVal(e.target.value)} autoFocus
        onKeyDown={e => { if (e.key === 'Enter' && val.trim()) onSubmit(val.trim()) }}
        style={{ flex: 1, height: 36, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', color: C.textPrimary, outline: 'none' }}
      />
      <button type="button" disabled={busy || !val.trim()} onClick={() => onSubmit(val.trim())}
        style={{ height: 36, padding: '0 14px', border: 'none', borderRadius: 6, cursor: (busy || !val.trim()) ? 'default' : 'pointer', background: (busy || !val.trim()) ? C.borderDark : C.emerald, color: '#fff', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Next</button>
    </div>
  )
}

export default function AssistantPanel({ activeModule, selectedRecord, listTable }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // turns: [{ role:'user'|'assistant', text, actions?:[], committed?:Set }]
  const [turns, setTurns] = useState([])
  const [history, setHistory] = useState([])  // opaque continuity for the edge fn
  const [tasks, setTasks] = useState([])
  const [saveTarget, setSaveTarget] = useState(null) // action being saved
  const [runTask, setRunTask] = useState(null)        // { task, snapshot }
  const scrollRef = useRef(null)

  const objForContext = currentObject(selectedRecord, listTable)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, open])

  // Load frequently-used tasks for the current object whenever the panel opens
  // or the object context changes.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    listAssistantTasks(objForContext)
      .then(rows => { if (!cancelled) setTasks(rows) })
      .catch(() => { if (!cancelled) setTasks([]) })
    return () => { cancelled = true }
  }, [open, objForContext])

  const send = useCallback(async () => {
    const message = input.trim()
    if (!message || busy) return
    setInput('')
    setTurns(t => [...t, { role: 'user', text: message }])
    setBusy(true)
    try {
      const ctx = buildContext(selectedRecord, listTable)
      const res = await sendAssistantMessage({ message, history, context: ctx })
      if (res.mock) {
        setTurns(t => [...t, { role: 'assistant', text: res.reply, actions: [] }])
      } else {
        setTurns(t => [...t, {
          role: 'assistant',
          text: res.reply || '(no reply)',
          actions: res.proposed_actions || [],
          committed: new Set(),
        }])
        setHistory(h => [...h,
          { role: 'user', content: message },
          { role: 'assistant', content: res.reply || '' },
        ])
      }
    } catch (e) {
      toast.error(e.message || 'Assistant request failed')
      setTurns(t => [...t, { role: 'assistant', text: `Error: ${e.message || e}`, actions: [] }])
    } finally {
      setBusy(false)
    }
  }, [input, busy, history, selectedRecord, listTable, toast])

  const confirmAction = useCallback(async (turnIdx, actionIdx) => {
    setBusy(true)
    try {
      const turn = turns[turnIdx]
      const action = turn.actions[actionIdx]
      const ctx = buildContext(selectedRecord, listTable)
      const result = await commitAssistantActions({ actions: [action], context: ctx })
      const ok = result?.ok !== false
      if (ok) {
        toast.success('Action completed')
        setTurns(t => t.map((tn, i) => {
          if (i !== turnIdx) return tn
          const committed = new Set(tn.committed); committed.add(actionIdx)
          return { ...tn, committed }
        }))
      } else {
        const msg = result?.results?.find(r => r.outcome === 'error')?.message || 'Action was refused'
        toast.error(msg)
      }
    } catch (e) {
      toast.error(e.message || 'Could not complete the action')
    } finally {
      setBusy(false)
    }
  }, [turns, selectedRecord, listTable, toast])

  const dismissAction = useCallback((turnIdx, actionIdx) => {
    setTurns(t => t.map((tn, i) => {
      if (i !== turnIdx) return tn
      const committed = new Set(tn.committed); committed.add(actionIdx)
      return { ...tn, committed }
    }))
  }, [])

  // Save a confirmed action as a repeatable task (no question steps for now —
  // the action template is captured verbatim; guided questions can be added by
  // editing the saved flow later).
  const doSaveTask = useCallback(async ({ name, launchObject }) => {
    if (!saveTarget) return
    setBusy(true)
    try {
      await saveAssistantTask({
        name,
        launch_object: launchObject || null,
        questions: [],
        actions: [saveTarget],
      })
      toast.success('Task saved')
      setSaveTarget(null)
      const rows = await listAssistantTasks(objForContext)
      setTasks(rows)
    } catch (e) {
      toast.error(e.message || 'Could not save task')
    } finally {
      setBusy(false)
    }
  }, [saveTarget, objForContext, toast])

  const openRunner = useCallback(async (task) => {
    setBusy(true)
    try {
      const snapshot = await getAssistantTask(task.flow_id)
      if (!snapshot) { toast.error('Task could not be loaded'); return }
      setRunTask({ task, snapshot })
    } catch (e) {
      toast.error(e.message || 'Could not load task')
    } finally {
      setBusy(false)
    }
  }, [toast])

  const doRunTask = useCallback(async (answers) => {
    if (!runTask) return
    setBusy(true)
    try {
      const ctx = buildContext(selectedRecord, listTable)
      const result = await runAssistantTask({
        flowId: runTask.task.flow_id, snapshot: runTask.snapshot, answers, context: ctx,
      })
      const ok = result?.ok !== false
      if (ok) {
        toast.success('Task completed')
        setTurns(t => [...t, { role: 'assistant', text: `Ran task “${runTask.task.name}”.`, actions: [], committed: new Set() }])
        setRunTask(null)
      } else {
        const msg = result?.results?.find(r => r.outcome === 'error')?.message || 'Task was refused'
        toast.error(msg)
      }
    } catch (e) {
      toast.error(e.message || 'Could not run task')
    } finally {
      setBusy(false)
    }
  }, [runTask, selectedRecord, listTable, toast])

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 60,
            width: 52, height: 52, borderRadius: 26, border: 'none', cursor: 'pointer',
            background: C.emerald, color: '#fff', boxShadow: '0 4px 14px rgba(13,26,46,0.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 60,
          width: 'min(420px, 100vw)', background: C.page,
          borderLeft: `1px solid ${C.border}`, boxShadow: '-4px 0 24px rgba(13,26,46,0.14)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            height: 54, flexShrink: 0, background: C.card, borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
          }}>
            <div style={{ fontWeight: 700, color: C.textPrimary, fontSize: 15 }}>LEAP Assistant</div>
            <button
              type="button" onClick={() => setOpen(false)} aria-label="Close assistant"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 22, lineHeight: 1 }}
            >×</button>
          </div>

          {/* Frequently used tasks */}
          {tasks.length > 0 && (
            <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.card, padding: '10px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                Frequently used tasks
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tasks.map(t => (
                  <button key={t.flow_id} type="button" disabled={busy} onClick={() => openRunner(t)}
                    style={{ height: 28, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 14, cursor: busy ? 'wait' : 'pointer', background: C.page, color: C.textPrimary, fontSize: 12, fontFamily: 'inherit' }}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Thread */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {turns.length === 0 && (
              <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.5 }}>
                Ask me to create a work order, update a record, change a status, run a report, or look something up.
                I only do what your permissions allow, and I always show you an action before it runs.
              </div>
            )}
            {turns.map((turn, ti) => (
              <div key={ti} style={{ marginBottom: 14 }}>
                <div style={{
                  maxWidth: '90%', padding: '8px 12px', borderRadius: 10,
                  fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: turn.role === 'user' ? C.emerald : C.card,
                  color: turn.role === 'user' ? '#fff' : C.textPrimary,
                  border: turn.role === 'user' ? 'none' : `1px solid ${C.border}`,
                  marginLeft: turn.role === 'user' ? 'auto' : 0,
                  display: turn.role === 'user' ? 'block' : 'inline-block',
                }}>
                  {turn.text}
                </div>
                {(turn.actions || []).map((action, ai) => (
                  <ActionCard
                    key={ai}
                    action={action}
                    busy={busy}
                    committed={turn.committed?.has(ai)}
                    onConfirm={() => confirmAction(ti, ai)}
                    onDismiss={() => dismissAction(ti, ai)}
                    onSave={() => setSaveTarget(action)}
                  />
                ))}
              </div>
            ))}
            {busy && <div style={{ color: C.textMuted, fontSize: 13 }}>Working…</div>}
          </div>

          {/* Input */}
          <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, background: C.card, padding: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Tell the assistant what to do…"
                rows={2}
                style={{
                  flex: 1, resize: 'none', border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', color: C.textPrimary, outline: 'none',
                }}
              />
              <button
                type="button" onClick={send} disabled={busy || !input.trim()}
                style={{
                  alignSelf: 'flex-end', height: 36, padding: '0 16px', border: 'none', borderRadius: 8,
                  background: (busy || !input.trim()) ? C.borderDark : C.emerald, color: '#fff',
                  fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                  cursor: (busy || !input.trim()) ? 'default' : 'pointer',
                }}
              >Send</button>
            </div>
          </div>

          {saveTarget && (
            <SaveTaskModal
              action={saveTarget}
              defaultObject={objForContext}
              busy={busy}
              onCancel={() => setSaveTarget(null)}
              onSave={doSaveTask}
            />
          )}
          {runTask && (
            <TaskRunner
              task={runTask.task}
              snapshot={runTask.snapshot}
              defaultObject={objForContext}
              busy={busy}
              onCancel={() => setRunTask(null)}
              onRun={doRunTask}
            />
          )}
        </div>
      )}
    </>
  )
}
