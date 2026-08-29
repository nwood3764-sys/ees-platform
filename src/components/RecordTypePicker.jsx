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

import { useEffect, useMemo, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { fetchAvailableRecordTypes } from '../data/layoutService'
import { scopedToState, statesInRecordTypes, needsStateChoice as recordOwesState }
  from '../lib/programStateScope'
import { parentChoiceOutstanding, describeParentOption }
  from '../lib/constrainingParentChoice'

export default function RecordTypePicker({
  tableName, objectLabel, state = null,
  parentObject = null, parentRecordTypeId = null,
  parentChoices = null,
  takenOnBuildingId = null,
  onPick, onCancel,
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [recordTypes, setRecordTypes] = useState([])
  // Set when this object's record types are state-scoped and none runs in the
  // record's state — e.g. an incentive application on a Texas property, where
  // EES runs no program. The picker says so instead of offering another
  // state's forms or waving the create through with no record type.
  const [noneInState, setNoneInState] = useState(null)
  // The states this object DOES have record types for — carried separately
  // because the returned list is empty in that case, so stateOptions is too.
  const [statesConfigured, setStatesConfigured] = useState([])
  const [chosenId, setChosenId] = useState(null)
  // The state the user picked here, when the record itself could not tell us
  // one. Never overrides a state the record already has.
  const [chosenState, setChosenState] = useState('')
  // The PARENT the user picked here, when the create came from a building or a
  // property that has more than one. An opportunity record type is the program,
  // and the program decides which forms exist — so this question comes first,
  // and the record types below are the chosen program's own (Nicholas,
  // 2026-08-29: the AUDIT application was unreachable from the building because
  // the platform silently picked one of its two opportunities).
  const [chosenParentId, setChosenParentId] = useState(null)

  const parentOptions = parentChoices?.options || []
  const owesParent = parentChoiceOutstanding(parentChoices, chosenParentId)
  const chosenParent = parentOptions.find(o => o.id === chosenParentId) || null
  // Once chosen, the parent's own record type is what narrows the list.
  const effectiveParentObject = chosenParent
    ? (parentChoices?.parentObject || parentObject)
    : parentObject
  const effectiveParentRecordTypeId = chosenParent
    ? (chosenParent.recordTypeId || null)
    : parentRecordTypeId
  // "Opportunity" from the parent object name — the label the user recognises.
  const parentLabel = (() => {
    const t = String(parentChoices?.parentObject || '').replace(/_/g, ' ').trim()
    if (!t) return 'Parent'
    const singular = t.endsWith('ies') ? `${t.slice(0, -3)}y` : t.replace(/s$/, '')
    return singular.replace(/\b\w/g, c => c.toUpperCase())
  })()
  const emitPick = (rt) => onPick(rt, chosenParent
    ? { fkColumn: parentChoices.fkColumn, parentId: chosenParent.id }
    : null)

  // Every state this object actually has programs configured for, read off the
  // record types themselves — never a hardcoded list of the states EES works in.
  const stateOptions = useMemo(() => statesInRecordTypes(recordTypes), [recordTypes])
  // The record could not tell us its state and this object's record types span
  // more than one, so the user has to say which — otherwise the picker would
  // offer every program in the platform, which is exactly the bug this closes
  // (Nicholas, 2026-08-23). A record that DOES know its state never sees this.
  const needsStateChoice = recordOwesState(state, recordTypes)
  const visibleRecordTypes = needsStateChoice
    ? scopedToState(recordTypes, chosenState || null)
    : recordTypes

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setChosenState('')
    setNoneInState(null)
    setStatesConfigured([])
    // While the parent is still owed the question below is "which program?",
    // not "which record type?" — so nothing is fetched, nothing auto-picks, and
    // no record type is offered until it is answered.
    if (owesParent) { setRecordTypes([]); setLoading(false); return () => { cancelled = true } }
    fetchAvailableRecordTypes(tableName, {
      state,
      parentObject: effectiveParentObject,
      parentRecordTypeId: effectiveParentRecordTypeId,
      takenOnBuildingId,
    })
      .then(rts => {
        if (cancelled) return
        setRecordTypes(rts)
        if (rts._noneInState) {
          setNoneInState(rts._noneInState)
          setStatesConfigured(rts._statesConfigured || [])
          return
        }
        // Auto-pick if there's only one — keeps the flow seamless when an
        // object has a single record type configured. Never while a state is
        // still owed: "only one nationwide type" is not the same as "only one
        // choice", and auto-picking it would skip the prompt entirely.
        if (recordOwesState(state, rts)) return
        // A record type the building already runs is not a choice — it cannot
        // be saved (enforce_one_opportunity_per_building_record_type). Only the
        // ones still open count toward "is there a decision to make here?", so
        // the last remaining program auto-picks exactly as a lone program
        // always has, and a fully-taken building never auto-picks a type that
        // would be refused on save.
        const selectable = rts.filter(rt => !rt.taken)
        if (selectable.length === 1) {
          emitPick(selectable[0])
          return
        }
        if (selectable.length === 0 && rts.length > 0) return  // render, and say why
        if (rts.length === 0) {
          // No record types — caller should skip the picker entirely. Signal
          // by picking null so the parent advances without a record type.
          emitPick(null)
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
  }, [tableName, state, effectiveParentObject, effectiveParentRecordTypeId,
      takenOnBuildingId, owesParent])

  // Cancel on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hide entirely when the effect already auto-picked (one or zero RTs). A
  // pending state choice is never an auto-pick, however few types are showing.
  const selectableCount = recordTypes.filter(rt => !rt.taken).length
  const allTaken = recordTypes.length > 0 && selectableCount === 0
  if (!loading && !owesParent && !needsStateChoice && !noneInState && !allTaken
      && selectableCount <= 1 && !error) return null

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
            {noneInState
              ? `Nothing is configured for ${noneInState}.`
              : owesParent
                ? `This building runs more than one program. Choose the ${parentLabel.toLowerCase()} this belongs to, then its record type.`
                : needsStateChoice
                  ? 'Choose the state this record is in, then its record type.'
                  : 'Choose a record type to continue.'}
          </div>
          {/* The record already knows where it is — say so, so the shorter list
              reads as deliberate rather than as missing programs. */}
          {!needsStateChoice && !noneInState && state && stateOptions.length > 0 && (
            <div style={{
              marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 999,
              background: '#e8f8f2', border: '1px solid #b7e6ce',
              fontSize: 11.5, fontWeight: 600, color: '#1f6b4b',
            }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{state}</span>
              <span style={{ fontWeight: 500 }}>— record types that run in this state</span>
            </div>
          )}
          {parentChoices && parentOptions.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <label
                htmlFor="record-type-picker-parent"
                style={{
                  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                  textTransform: 'uppercase', color: C.textMuted, marginBottom: 5,
                }}
              >
                {parentLabel}
              </label>
              <select
                id="record-type-picker-parent"
                value={chosenParentId || ''}
                onChange={e => { setChosenParentId(e.target.value || null); setChosenId(null) }}
                style={{
                  width: '100%', padding: '8px 10px', fontSize: 13,
                  border: `1px solid ${C.border}`, borderRadius: 5,
                  background: C.card, color: C.textPrimary, fontFamily: 'inherit',
                }}
              >
                <option value="">Select {/^[AEIOU]/i.test(parentLabel) ? 'an' : 'a'} {parentLabel.toLowerCase()}…</option>
                {parentOptions.map(o => (
                  <option key={o.id} value={o.id}>{describeParentOption(o)}</option>
                ))}
              </select>
            </div>
          )}
          {needsStateChoice && (
            <div style={{ marginTop: 12 }}>
              <label
                htmlFor="record-type-picker-state"
                style={{
                  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                  textTransform: 'uppercase', color: C.textMuted, marginBottom: 5,
                }}
              >
                State
              </label>
              <select
                id="record-type-picker-state"
                value={chosenState}
                onChange={e => { setChosenState(e.target.value); setChosenId(null) }}
                style={{
                  width: '100%', padding: '8px 10px', fontSize: 13,
                  border: `1px solid ${C.border}`, borderRadius: 5,
                  background: C.card, color: C.textPrimary, fontFamily: 'inherit',
                }}
              >
                <option value="">Select a state…</option>
                {stateOptions.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
          )}
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
              padding: 14, background: '#e8f1fb', border: '1px solid #bcd9f2',
              borderRadius: 6, color: '#1e466b', fontSize: 12.5,
            }}>
              {error}
            </div>
          )}
          {!loading && !error && noneInState && (
            <div style={{
              padding: 14, background: '#f7f9fc',
              border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.textSecondary, fontSize: 12.5, lineHeight: 1.6,
            }}>
              No {(objectLabel || tableName).toLowerCase()} record type runs in{' '}
              <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{noneInState}</strong>.
              Every one of them belongs to a program in another state, and a record
              here cannot carry one.
              {statesConfigured.length > 0 && (
                <> Configured today: <strong>{statesConfigured.join(', ')}</strong>.</>
              )}
              {' '}Set up the {noneInState} record types in Setup → Object Manager first.
            </div>
          )}
          {!loading && !error && allTaken && (
            <div style={{
              padding: 14, background: C.cardSecondary,
              border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.textSecondary, fontSize: 12.5, lineHeight: 1.6, marginBottom: 10,
            }}>
              This building already runs every program available to it. A building
              runs each program once, so there is no new opportunity to create here
              — open the existing one below, or delete it first if it is a duplicate.
            </div>
          )}
          {!loading && !error && owesParent && (
            <div style={{
              padding: 14, background: C.cardSecondary,
              border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.textSecondary, fontSize: 12.5, lineHeight: 1.6,
            }}>
              A {parentLabel.toLowerCase()} record type is the program, and the program
              decides which record types exist here. Select one above and only that
              program's record types are offered — the same list you would see
              creating this from the {parentLabel.toLowerCase()} itself.
            </div>
          )}
          {!loading && !error && needsStateChoice && !chosenState && (
            <div style={{
              padding: 14, background: '#f7f9fc',
              border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.textSecondary, fontSize: 12.5, marginBottom: 10,
            }}>
              Select a state above to see the record types that run there.
              {visibleRecordTypes.length > 0 && ' The types below run in every state.'}
            </div>
          )}
          {!loading && !error && visibleRecordTypes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleRecordTypes.map(rt => {
                const selected = chosenId === rt.id
                // Already running on this building. Shown, disabled, and named
                // — a program that simply disappeared would read as a missing
                // configuration and send the user hunting through Setup.
                const taken = rt.taken === true
                return (
                  <button
                    key={rt.id}
                    disabled={taken}
                    title={taken ? `${rt.label} already runs on this building${rt.takenBy ? ` as ${rt.takenBy}` : ''}` : undefined}
                    onClick={() => { if (!taken) setChosenId(rt.id) }}
                    onDoubleClick={() => { if (!taken) emitPick(rt) }}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      background: taken ? C.cardSecondary : (selected ? '#e8f8f2' : '#fff'),
                      border: `1px solid ${selected && !taken ? '#3ecf8e' : C.border}`,
                      borderRadius: 6,
                      cursor: taken ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 12,
                      fontFamily: 'inherit',
                      opacity: taken ? 0.72 : 1,
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      border: `2px solid ${selected && !taken ? '#3ecf8e' : C.border}`,
                      background: selected && !taken ? '#3ecf8e' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {selected && !taken && (
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13.5, fontWeight: 600,
                        color: taken ? C.textSecondary : C.textPrimary,
                      }}>
                        {rt.label}
                      </div>
                      {taken && (
                        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>
                          Already on this building{rt.takenBy ? <> — <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{rt.takenBy}</span></> : null}
                        </div>
                      )}
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
          {!noneInState && (
          <button
            onClick={() => {
              const rt = visibleRecordTypes.find(r => r.id === chosenId)
              if (rt) emitPick(rt)
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
          )}
        </div>
      </div>
    </div>
  )
}
