// AssistantPanel — the persistent LEAP AI command assistant.
//
// A floating launcher button (bottom-right, every screen) opens a slide-in
// panel: a chat thread where the user types plain-English instructions. The
// edge function returns a reply plus optional proposed_actions. Proposed
// actions render as confirmation cards — the assistant NEVER mutates on its
// own; the user clicks Confirm, which commits through commit_screen_flow_run
// (server-side permission re-check). This is the spec's confirmation rule.
//
// Record context: the panel receives the current module + selected record and
// passes {object, record_id, record_label} so the assistant knows what the
// user is looking at, per the "context-aware" requirement.

import { useState, useRef, useEffect, useCallback } from 'react'
import { C } from '../data/constants'
import { useToast } from './Toast'
import { sendAssistantMessage, commitAssistantActions } from '../data/assistantService'

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

function ActionCard({ action, onConfirm, onDismiss, busy, committed }) {
  const verb = action.type === 'record_create' ? 'Create'
    : action.type === 'record_update' ? 'Update'
    : action.type === 'status_change' ? 'Change status'
    : 'Action'
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 8, background: C.card,
      padding: 12, marginTop: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.emeraldMid, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {verb} · {action.object}
      </div>
      <div style={{ fontSize: 13, color: C.textPrimary, marginTop: 4 }}>
        {action.summary || `${verb} on ${action.object}`}
      </div>
      {action.values && (
        <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 6, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {Object.entries(action.values).map(([k, v]) => `${k}: ${v}`).join('\n')}
        </div>
      )}
      {committed ? (
        <div style={{ fontSize: 12, color: C.emeraldMid, fontWeight: 600, marginTop: 8 }}>✓ Done</div>
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

export default function AssistantPanel({ activeModule, selectedRecord, listTable }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // turns: [{ role:'user'|'assistant', text, actions?:[], committed?:Set }]
  const [turns, setTurns] = useState([])
  const [history, setHistory] = useState([])  // opaque continuity for the edge fn
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, open])

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
        // Keep a light continuity trail: our user text + assistant reply text.
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
      const committed = new Set(tn.committed); committed.add(actionIdx)  // hide it
      return { ...tn, committed }
    }))
  }, [])

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
                  display: 'inline-block', maxWidth: '90%', padding: '8px 12px', borderRadius: 10,
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
                  turn.committed?.has(ai) && action.__dismissed
                    ? null
                    : <ActionCard
                        key={ai}
                        action={action}
                        busy={busy}
                        committed={turn.committed?.has(ai)}
                        onConfirm={() => confirmAction(ti, ai)}
                        onDismiss={() => dismissAction(ti, ai)}
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
        </div>
      )}
    </>
  )
}
