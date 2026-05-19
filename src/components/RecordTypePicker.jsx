// =============================================================================
// RecordTypePicker — Salesforce-style "Choose record type" modal.
//
// Shown when a user clicks New on an object that has multiple active record
// types. The user picks one, and the create form opens with that record type
// pre-set and the matching page layout loaded.
//
// If the object has 0 or 1 active record types, this picker is skipped
// entirely and the create form opens directly.
// =============================================================================

import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { fetchAvailableRecordTypes } from '../data/layoutService'

export default function RecordTypePicker({ tableName, objectLabel, onPick, onCancel }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [recordTypes, setRecordTypes] = useState([])
  const [chosenId, setChosenId] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchAvailableRecordTypes(tableName)
      .then(rts => {
        if (cancelled) return
        setRecordTypes(rts)
        // Auto-pick if there's only one — keeps the flow seamless when an
        // object has a single record type configured.
        if (rts.length === 1) {
          onPick(rts[0])
          return
        }
        if (rts.length === 0) {
          // No record types — caller should skip the picker entirely. Signal
          // by picking null so the parent advances without a record type.
          onPick(null)
        }
      })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // Deliberately omit onPick from deps — it's an inline arrow on the parent
    // and a new reference every render, which would otherwise cause an
    // infinite fetch loop. We only want to refetch when the tableName
    // actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName])

  // Cancel on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hide entirely when the effect already auto-picked (one or zero RTs)
  if (!loading && recordTypes.length <= 1 && !error) return null

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(7, 17, 31, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.card, borderRadius: 8,
          boxShadow: '0 20px 60px rgba(7, 17, 31, 0.25)',
          width: 'min(560px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 64px)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 22px 14px',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
            New {objectLabel || tableName}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
            Choose a record type to continue.
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
              Loading record types…
            </div>
          )}
          {error && !loading && (
            <div style={{
              padding: 14, background: '#fce8e8', border: '1px solid #f3b4b4',
              borderRadius: 6, color: '#8a1a1a', fontSize: 12.5,
            }}>
              {error}
            </div>
          )}
          {!loading && !error && recordTypes.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recordTypes.map(rt => {
                const selected = chosenId === rt.id
                return (
                  <button
                    key={rt.id}
                    onClick={() => setChosenId(rt.id)}
                    onDoubleClick={() => onPick(rt)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      background: selected ? '#e8f8f2' : '#fff',
                      border: `1px solid ${selected ? '#3ecf8e' : C.border}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 12,
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      border: `2px solid ${selected ? '#3ecf8e' : C.border}`,
                      background: selected ? '#3ecf8e' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {selected && (
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary }}>
                        {rt.label}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 22px',
          borderTop: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onCancel}
            style={{
              background: C.card, color: C.textSecondary,
              border: `1px solid ${C.border}`, borderRadius: 5,
              padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const rt = recordTypes.find(r => r.id === chosenId)
              if (rt) onPick(rt)
            }}
            disabled={!chosenId}
            style={{
              background: chosenId ? '#3ecf8e' : '#f0f3f8',
              color: chosenId ? '#fff' : C.textMuted,
              border: 'none', borderRadius: 5,
              padding: '8px 18px', fontSize: 13, fontWeight: 700,
              cursor: chosenId ? 'pointer' : 'not-allowed',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            Next
            <Icon path="M5 12h14 M12 5l7 7-7 7" size={13} color="currentColor" />
          </button>
        </div>
      </div>
    </div>
  )
}
