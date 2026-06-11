import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, LoadingState, ErrorState } from '../../components/UI'
import { ListView } from '../../components/ListView'
import SearchableCombo from '../../components/SearchableCombo'
import HelpIcon from '../../components/help/HelpIcon'
import { useToast } from '../../components/Toast'
import {
  inputStyle, textareaStyle, buttonPrimaryStyle, buttonSecondaryStyle,
  buttonDangerStyle, buttonSmPrimaryStyle, buttonSmSecondaryStyle, buttonSmDangerStyle,
  hintBoxStyle, warningBoxStyle, FormField,
} from './adminStyles'
import {
  SCREEN_ELEMENT_TYPES, SILENT_ELEMENT_TYPES, QUESTION_TYPES,
  TRIGGER_EVENTS, SILENT_ACTION_TYPES, SCREEN_ACTION_TYPES, DECISION_OPERATORS,
  listFlows, getFlow, getFlowElements, getFlowRuns,
  createFlow, updateFlowMeta, saveFlowElements,
  publishFlow, setFlowActive, archiveFlow, cloneFlow,
  enableRecordCreateDispatch, disableRecordCreateDispatch,
  fetchTriggerObjects, fetchStatusValues, fetchObjectColumns, fetchObjectDateColumns,
  fetchRoles, fetchEmailTemplates,
} from '../../data/flowBuilderService'

// ───────────────────────────────────────────────────────────────────────────
// FlowBuilderPane — Setup → Process Automation → Flow Builder
//
// Single authoring surface for screen flows (guided, interactive) and silent
// flows (server-side automation). Two views:
//   • LIST    — every flow with type, trigger summary, status; new / open / clone
//   • EDITOR  — meta + trigger config + ordered element canvas + lifecycle bar
//
// The element canvas always brackets the user's elements between a fixed Start
// and Finish node, matching the execute_flow / commit_screen_flow_run
// interpreters which walk start → next → … → finish. The editor never adds or
// removes start/finish; it edits only the middle (screen/decision/action).
// ───────────────────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  draft:     { bg: '#eef2f7', color: '#4a5e7a', label: 'Draft' },
  active:    { bg: '#e7f8f0', color: '#1d7a52', label: 'Active' },
  inactive:  { bg: '#fef3c7', color: '#8a6d1f', label: 'Inactive' },
  archived:  { bg: '#f3f4f6', color: '#6b7280', label: 'Archived' },
}

const TYPE_BADGE = {
  screen: { bg: '#eaf2fb', color: '#2c5f9e', label: 'Screen' },
  silent: { bg: '#f3eefb', color: '#6b3fa0', label: 'Silent' },
}

function Badge({ map, value }) {
  const b = map[value] || { bg: '#eef2f7', color: '#4a5e7a', label: value || '—' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 11,
      fontSize: 12, fontWeight: 600, background: b.bg, color: b.color,
    }}>{b.label}</span>
  )
}

const uniqueId = () => `el_${Math.random().toString(36).slice(2, 10)}`

// ─── Pane root ───────────────────────────────────────────────────────────────

export default function FlowBuilderPane() {
  const toast = useToast()
  const [view, setView] = useState('list')      // 'list' | 'editor'
  const [editingId, setEditingId] = useState(null)

  const openEditor = useCallback((flowId) => {
    setEditingId(flowId)
    setView('editor')
  }, [])

  const backToList = useCallback(() => {
    setEditingId(null)
    setView('list')
  }, [])

  if (view === 'editor') {
    return <FlowEditor flowId={editingId} onBack={backToList} toast={toast} />
  }
  return <FlowList onOpen={openEditor} onCreated={openEditor} toast={toast} />
}

// ─── List view ───────────────────────────────────────────────────────────────

function FlowList({ onOpen, onCreated, toast }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await listFlows()) }
    catch (e) { setError(e.message || String(e)) }
  }, [])

  useEffect(() => { load() }, [load])

  if (error) return <ErrorState message={error} onRetry={load} />
  if (rows === null) return <LoadingState />

  const columns = [
    { name: 'flow_record_number', label: 'Number', width: 120 },
    { name: 'flow_name',          label: 'Flow' },
    { name: 'flow_type',          label: 'Type', width: 110 },
    { name: 'flow_status',        label: 'Status', width: 110 },
    { name: 'trigger_summary',    label: 'Trigger / Launch' },
    { name: 'flow_current_version', label: 'Ver.', width: 70 },
  ]

  const data = rows.map(r => ({
    ...r,
    _id: r.id,
    trigger_summary: r.flow_type === 'screen'
      ? (r.flow_launch_object ? `Launch: ${r.flow_launch_object}` : 'Launch: (unset)')
      : (r.flow_trigger_object
          ? `${r.flow_trigger_event || 'status_change'} · ${r.flow_trigger_object}`
          : '(unset)'),
  }))

  const renderCell = (row, col) => {
    if (col.name === 'flow_status') return <Badge map={STATUS_BADGE} value={row.flow_status} />
    if (col.name === 'flow_type')   return <Badge map={TYPE_BADGE} value={row.flow_type} />
    return undefined
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 19, color: '#0d1a2e' }}>Flow Builder</h2>
        <HelpIcon anchors={[{ type: 'route', route: '/admin/flow_builder' }, { type: 'concept', concept: 'flow-builder' }]} title="Flow Builder" />
      </div>
      <p style={{ margin: '4px 0 16px', color: '#4a5e7a', fontSize: 14 }}>
        Build guided screen flows and silent automation flows. Screen flows are
        launched interactively; silent flows run on status change, record
        creation, or a date.
      </p>

      {showNew && (
        <NewFlowModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); onCreated(id) }}
          toast={toast}
        />
      )}

      <ListView
        data={data}
        columns={columns}
        systemViews={[
          { id: 'all',      label: 'All Flows',  filter: () => true },
          { id: 'screen',   label: 'Screen',     filter: r => r.flow_type === 'screen' },
          { id: 'silent',   label: 'Silent',     filter: r => r.flow_type === 'silent' },
          { id: 'active',   label: 'Active',     filter: r => r.flow_status === 'active' },
          { id: 'draft',    label: 'Drafts',     filter: r => r.flow_status === 'draft' },
          { id: 'archived', label: 'Archived',   filter: r => r.flow_status === 'archived' },
        ]}
        defaultViewId="all"
        newLabel="New Flow"
        onNew={() => setShowNew(true)}
        onOpenRecord={(row) => onOpen(row._id)}
        onRefresh={load}
        renderCell={renderCell}
        storageKey="flow_builder_list"
      />
    </div>
  )
}

function NewFlowModal({ onClose, onCreated, toast }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [flowType, setFlowType] = useState('silent')
  const [triggerObjects, setTriggerObjects] = useState([])
  const [launchObject, setLaunchObject] = useState('')
  const [triggerObject, setTriggerObject] = useState('')
  const [triggerEvent, setTriggerEvent] = useState('status_change')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchTriggerObjects().then(setTriggerObjects).catch(() => setTriggerObjects([]))
  }, [])

  const submit = async () => {
    if (!name.trim()) { toast.error('Flow name is required'); return }
    if (flowType === 'silent' && !triggerObject) { toast.error('Select a trigger object'); return }
    setSaving(true)
    try {
      const id = await createFlow({
        name: name.trim(), description, flowType,
        launchObject: flowType === 'screen' ? launchObject : null,
        triggerObject: flowType === 'silent' ? triggerObject : null,
        triggerEvent: flowType === 'silent' ? triggerEvent : null,
      })
      toast.success('Flow created')
      onCreated(id)
    } catch (e) {
      toast.error(`Create failed: ${e.message || e}`)
      setSaving(false)
    }
  }

  return (
    <Modal title="New Flow" onClose={onClose}>
      <FormField label="Flow name" required>
        <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Notify Coordinator on Project Verified" />
      </FormField>
      <FormField label="Description">
        <textarea style={textareaStyle} value={description}
          onChange={e => setDescription(e.target.value)} rows={2} />
      </FormField>
      <FormField label="Flow type" required hint="Screen flows are launched interactively; silent flows run server-side on a trigger.">
        <div style={{ display: 'flex', gap: 8 }}>
          {['silent', 'screen'].map(t => (
            <button key={t}
              style={flowType === t ? buttonSmPrimaryStyle : buttonSmSecondaryStyle}
              onClick={() => setFlowType(t)}>
              {t === 'silent' ? 'Silent (automation)' : 'Screen (guided)'}
            </button>
          ))}
        </div>
      </FormField>

      {flowType === 'silent' ? (
        <>
          <FormField label="Trigger object" required>
            <SearchableCombo value={triggerObject} options={triggerObjects}
              onChange={setTriggerObject} placeholder="Select object…" allowFreeText />
          </FormField>
          <FormField label="Trigger event" required>
            <SearchableCombo value={triggerEvent} options={TRIGGER_EVENTS}
              onChange={setTriggerEvent} />
          </FormField>
        </>
      ) : (
        <FormField label="Launch object" hint="The object this screen flow is launched from.">
          <SearchableCombo value={launchObject} options={triggerObjects}
            onChange={setLaunchObject} placeholder="Select object…" allowFreeText />
        </FormField>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <button style={buttonSecondaryStyle} onClick={onClose} disabled={saving}>Cancel</button>
        <button style={buttonPrimaryStyle} onClick={submit} disabled={saving}>
          {saving ? 'Creating…' : 'Create Flow'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Editor view ─────────────────────────────────────────────────────────────

function FlowEditor({ flowId, onBack, toast }) {
  const [flow, setFlow] = useState(null)
  const [elements, setElements] = useState([])     // middle elements only
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [runs, setRuns] = useState([])
  const [tab, setTab] = useState('canvas')         // 'canvas' | 'runs'

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [f, els, rs] = await Promise.all([
        getFlow(flowId), getFlowElements(flowId), getFlowRuns(flowId),
      ])
      setFlow(f)
      // Strip the fixed start/finish brackets; the editor manages only middle.
      setElements(
        (els || [])
          .filter(e => e.fe_element_type !== 'start' && e.fe_element_type !== 'finish')
          .map(e => ({
            _key: uniqueId(),
            fe_element_type: e.fe_element_type,
            fe_order: e.fe_order,
            fe_label: e.fe_label || '',
            fe_api_name: e.fe_api_name || '',
            fe_config: e.fe_config || {},
            fe_decision_branches: e.fe_decision_branches || [],
          }))
      )
      setRuns(rs || [])
    } catch (e) { setError(e.message || String(e)) }
    finally { setLoading(false) }
  }, [flowId])

  useEffect(() => { load() }, [load])

  const isSilent = flow?.flow_type === 'silent'
  const elementTypes = isSilent ? SILENT_ELEMENT_TYPES : SCREEN_ELEMENT_TYPES

  const addElement = (type) => {
    setElements(prev => [...prev, {
      _key: uniqueId(),
      fe_element_type: type,
      fe_order: prev.length,
      fe_label: '',
      fe_api_name: '',
      fe_config: type === 'screen' ? { questions: [] }
               : type === 'decision' ? { conditions: [] }
               : { action_type: (isSilent ? SILENT_ACTION_TYPES : SCREEN_ACTION_TYPES)[0].value, config: {} },
      fe_decision_branches: [],
    }])
  }

  const updateElement = (key, patch) =>
    setElements(prev => prev.map(e => e._key === key ? { ...e, ...patch } : e))

  const removeElement = (key) =>
    setElements(prev => prev.filter(e => e._key !== key))

  const moveElement = (key, dir) => {
    setElements(prev => {
      const idx = prev.findIndex(e => e._key === key)
      const swap = idx + dir
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next
    })
  }

  const saveElements = async () => {
    setSaving(true)
    try {
      // Re-bracket with start/finish at the persistence boundary. The service
      // chains them linearly by fe_order; start=0, middle=1..n, finish=last.
      const ordered = [
        { fe_element_type: 'start', fe_label: 'Start', fe_config: {}, fe_decision_branches: [], fe_order: 0 },
        ...elements.map((e, i) => ({
          fe_element_type: e.fe_element_type,
          fe_label: e.fe_label || null,
          fe_api_name: e.fe_api_name || null,
          fe_config: e.fe_config || {},
          fe_decision_branches: e.fe_decision_branches || [],
          fe_order: i + 1,
        })),
        { fe_element_type: 'finish', fe_label: 'Finish', fe_config: {}, fe_decision_branches: [], fe_order: elements.length + 1 },
      ]
      await saveFlowElements(flowId, ordered)
      toast.success('Flow elements saved')
      await load()
    } catch (e) {
      toast.error(`Save failed: ${e.message || e}`)
    } finally { setSaving(false) }
  }

  const doLifecycle = async (fn, label) => {
    setBusy(true)
    try { await fn(); toast.success(label); await load() }
    catch (e) { toast.error(`${label} failed: ${e.message || e}`) }
    finally { setBusy(false) }
  }

  if (error) return <ErrorState message={error} onRetry={load} />
  if (loading || !flow) return <LoadingState />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button style={buttonSmSecondaryStyle} onClick={onBack}>
          <Icon path="M15 19l-7-7 7-7" size={13} /> Back
        </button>
        <h2 style={{ margin: 0, fontSize: 18, color: '#0d1a2e' }}>{flow.flow_name}</h2>
        <Badge map={TYPE_BADGE} value={flow.flow_type} />
        <Badge map={STATUS_BADGE} value={flow.flow_status} />
        <span style={{ marginLeft: 'auto' }} />
        <HelpIcon anchors={[{ type: 'route', route: '/admin/flow_builder' }, { type: 'concept', concept: 'flow-builder' }]} title="Flow Builder" />
      </div>

      <LifecycleBar
        flow={flow} busy={busy}
        onSaveElements={saveElements} saving={saving}
        onPublish={() => doLifecycle(() => publishFlow(flowId), 'Published')}
        onActivate={() => doLifecycle(() => setFlowActive(flowId, true), 'Activated')}
        onDeactivate={() => doLifecycle(() => setFlowActive(flowId, false), 'Deactivated')}
        onArchive={() => doLifecycle(() => archiveFlow(flowId), 'Archived')}
        onClone={async () => {
          const newName = `${flow.flow_name} (copy)`
          await doLifecycle(() => cloneFlow(flowId, newName), 'Cloned')
        }}
      />

      {isSilent && (
        <TriggerConfig flow={flow} toast={toast} onChanged={load} busy={busy} setBusy={setBusy} />
      )}

      <div style={{ display: 'flex', gap: 6, margin: '14px 0 10px' }}>
        {['canvas', 'runs'].map(t => (
          <button key={t}
            style={tab === t ? buttonSmPrimaryStyle : buttonSmSecondaryStyle}
            onClick={() => setTab(t)}>
            {t === 'canvas' ? 'Canvas' : `Run History (${runs.length})`}
          </button>
        ))}
      </div>

      {tab === 'canvas' ? (
        <Canvas
          isSilent={isSilent}
          elementTypes={elementTypes}
          elements={elements}
          flow={flow}
          onAdd={addElement}
          onUpdate={updateElement}
          onRemove={removeElement}
          onMove={moveElement}
        />
      ) : (
        <RunHistory runs={runs} />
      )}
    </div>
  )
}

// ─── Lifecycle bar ───────────────────────────────────────────────────────────

function LifecycleBar({ flow, busy, saving, onSaveElements, onPublish, onActivate, onDeactivate, onArchive, onClone }) {
  const isActive = flow.flow_status === 'active'
  const isArchived = flow.flow_status === 'archived'
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
      padding: '10px 12px', background: '#f7f9fc', border: '1px solid #e4e9f2',
      borderRadius: 8,
    }}>
      <button style={buttonSmPrimaryStyle} onClick={onSaveElements} disabled={saving || busy}>
        {saving ? 'Saving…' : 'Save Elements'}
      </button>
      <span style={{ width: 1, height: 22, background: '#e4e9f2' }} />
      <button style={buttonSmSecondaryStyle} onClick={onPublish} disabled={busy || isArchived}>
        Publish Version
      </button>
      {isActive
        ? <button style={buttonSmSecondaryStyle} onClick={onDeactivate} disabled={busy}>Deactivate</button>
        : <button style={buttonSmSecondaryStyle} onClick={onActivate} disabled={busy || isArchived}>Activate</button>}
      <button style={buttonSmSecondaryStyle} onClick={onClone} disabled={busy}>Clone</button>
      <span style={{ marginLeft: 'auto' }} />
      <button style={buttonSmDangerStyle} onClick={onArchive} disabled={busy || isArchived}>
        Archive
      </button>
    </div>
  )
}

// ─── Trigger config (silent flows) ───────────────────────────────────────────

function TriggerConfig({ flow, toast, onChanged, busy, setBusy }) {
  const [statusValues, setStatusValues] = useState([])
  const [dateColumns, setDateColumns] = useState([])
  const [triggerStatus, setTriggerStatus] = useState(flow.flow_trigger_status || '')
  const [triggerField, setTriggerField] = useState(flow.flow_trigger_field || '')
  const event = flow.flow_trigger_event || 'status_change'
  const obj = flow.flow_trigger_object

  useEffect(() => {
    if (event === 'status_change' && obj) {
      fetchStatusValues(obj).then(setStatusValues).catch(() => setStatusValues([]))
    }
    if (event === 'date_based' && obj) {
      fetchObjectDateColumns(obj).then(setDateColumns).catch(() => setDateColumns([]))
    }
  }, [event, obj])

  const saveTrigger = async () => {
    setBusy(true)
    try {
      const patch = {}
      if (event === 'status_change') patch.flow_trigger_status = triggerStatus || null
      if (event === 'date_based')    patch.flow_trigger_field = triggerField || null
      await updateFlowMeta(flow.id, patch)
      if (event === 'record_create') await enableRecordCreateDispatch(obj)
      toast.success('Trigger saved')
      onChanged()
    } catch (e) { toast.error(`Trigger save failed: ${e.message || e}`) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', border: '1px solid #e4e9f2', borderRadius: 8 }}>
      <div style={{ fontWeight: 600, color: '#0d1a2e', marginBottom: 8 }}>
        Trigger — {event} · {obj}
      </div>

      {event === 'status_change' && (
        <FormField label="Fires when status becomes" hint="Leave empty to fire on any status change.">
          <SearchableCombo value={triggerStatus} options={statusValues}
            onChange={setTriggerStatus} placeholder="Any status…" allowFreeText />
        </FormField>
      )}

      {event === 'date_based' && (
        <FormField label="Date field to watch" hint="The flow fires when this date is reached. Dispatch runs daily.">
          <SearchableCombo value={triggerField} options={dateColumns}
            onChange={setTriggerField} placeholder="Select date field…" allowFreeText />
        </FormField>
      )}

      {event === 'record_create' && (
        <div style={hintBoxStyle}>
          Saving attaches a record-create dispatch trigger to <strong>{obj}</strong>.
          The flow runs whenever a new {obj} record is created.
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <button style={buttonSmPrimaryStyle} onClick={saveTrigger} disabled={busy}>
          Save Trigger
        </button>
      </div>
    </div>
  )
}

// ─── Canvas ──────────────────────────────────────────────────────────────────

function Canvas({ isSilent, elementTypes, elements, flow, onAdd, onUpdate, onRemove, onMove }) {
  return (
    <div>
      <Bracket label="Start" sub={isSilent ? 'Trigger fires' : 'Flow launched'} top />

      {elements.length === 0 && (
        <div style={{ ...hintBoxStyle, margin: '8px 0' }}>
          No elements yet. Add a {isSilent ? 'decision or action' : 'screen, decision, or action'} below.
        </div>
      )}

      {elements.map((el, i) => (
        <ElementCard
          key={el._key}
          el={el}
          index={i}
          total={elements.length}
          isSilent={isSilent}
          flow={flow}
          onUpdate={(patch) => onUpdate(el._key, patch)}
          onRemove={() => onRemove(el._key)}
          onMove={(dir) => onMove(el._key, dir)}
        />
      ))}

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        {elementTypes.map(t => (
          <button key={t.value} style={buttonSmSecondaryStyle} onClick={() => onAdd(t.value)}>
            <Icon path="M12 5v14M5 12h14" size={13} /> {t.label}
          </button>
        ))}
      </div>

      <Bracket label="Finish" sub="Flow ends" />
    </div>
  )
}

function Bracket({ label, sub, top }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      background: '#07111f', color: '#fff', borderRadius: 8,
      margin: top ? '4px 0 8px' : '8px 0 4px',
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%', background: '#3ecf8e',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon path={top ? 'M5 12h14M12 5l7 7-7 7' : 'M5 13l4 4L19 7'} size={13} color="#07111f" />
      </span>
      <strong style={{ fontSize: 14 }}>{label}</strong>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.62)' }}>{sub}</span>
    </div>
  )
}

function ElementCard({ el, index, total, isSilent, flow, onUpdate, onRemove, onMove }) {
  const typeLabel = el.fe_element_type.charAt(0).toUpperCase() + el.fe_element_type.slice(1)
  return (
    <div style={{
      border: '1px solid #e4e9f2', borderRadius: 8, padding: 12,
      marginBottom: 8, background: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 0.4, color: '#6b3fa0', background: '#f3eefb',
          padding: '2px 8px', borderRadius: 6,
        }}>{typeLabel}</span>
        <input
          style={{ ...inputStyle, flex: 1, margin: 0 }}
          value={el.fe_label}
          placeholder={`${typeLabel} label`}
          onChange={e => onUpdate({ fe_label: e.target.value })}
        />
        <button style={buttonSmSecondaryStyle} disabled={index === 0} onClick={() => onMove(-1)}>
          <Icon path="M5 15l7-7 7 7" size={13} />
        </button>
        <button style={buttonSmSecondaryStyle} disabled={index === total - 1} onClick={() => onMove(1)}>
          <Icon path="M19 9l-7 7-7-7" size={13} />
        </button>
        <button style={buttonSmDangerStyle} onClick={onRemove}>
          <Icon path="M6 18L18 6M6 6l12 12" size={13} />
        </button>
      </div>

      {el.fe_element_type === 'screen'   && <ScreenEditor el={el} onUpdate={onUpdate} />}
      {el.fe_element_type === 'decision' && <DecisionEditor el={el} flow={flow} onUpdate={onUpdate} />}
      {el.fe_element_type === 'action'   && <ActionEditor el={el} flow={flow} isSilent={isSilent} onUpdate={onUpdate} />}
    </div>
  )
}

// ─── Screen element editor ───────────────────────────────────────────────────

function ScreenEditor({ el, onUpdate }) {
  const questions = el.fe_config?.questions || []
  const setQuestions = (q) => onUpdate({ fe_config: { ...el.fe_config, questions: q } })

  const addQuestion = () => setQuestions([
    ...questions, { key: `q_${questions.length + 1}`, label: '', type: 'text', required: false },
  ])
  const updateQuestion = (i, patch) =>
    setQuestions(questions.map((q, idx) => idx === i ? { ...q, ...patch } : q))
  const removeQuestion = (i) =>
    setQuestions(questions.filter((_, idx) => idx !== i))

  return (
    <div>
      {questions.length === 0 && (
        <div style={{ fontSize: 13, color: '#8fa0b8', marginBottom: 8 }}>No questions yet.</div>
      )}
      {questions.map((q, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input style={{ ...inputStyle, flex: 2, margin: 0 }} value={q.label}
            placeholder="Question label" onChange={e => updateQuestion(i, { label: e.target.value })} />
          <input style={{ ...inputStyle, flex: 1, margin: 0 }} value={q.key}
            placeholder="key" onChange={e => updateQuestion(i, { key: e.target.value })} />
          <div style={{ flex: 1 }}>
            <SearchableCombo value={q.type} options={QUESTION_TYPES}
              onChange={(v) => updateQuestion(i, { type: v })} />
          </div>
          <label style={{ fontSize: 12, color: '#4a5e7a', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={!!q.required}
              onChange={e => updateQuestion(i, { required: e.target.checked })} /> Req
          </label>
          <button style={buttonSmDangerStyle} onClick={() => removeQuestion(i)}>
            <Icon path="M6 18L18 6M6 6l12 12" size={12} />
          </button>
        </div>
      ))}
      <button style={buttonSmSecondaryStyle} onClick={addQuestion}>
        <Icon path="M12 5v14M5 12h14" size={12} /> Add Question
      </button>
    </div>
  )
}

// ─── Decision element editor ─────────────────────────────────────────────────

function DecisionEditor({ el, flow, onUpdate }) {
  const [columns, setColumns] = useState([])
  const conditions = el.fe_config?.conditions || []
  const obj = flow.flow_trigger_object || flow.flow_launch_object

  useEffect(() => {
    if (obj) fetchObjectColumns(obj).then(setColumns).catch(() => setColumns([]))
  }, [obj])

  const setConditions = (c) => onUpdate({ fe_config: { ...el.fe_config, conditions: c } })
  const addCond = () => setConditions([...conditions, { field: '', operator: 'eq', value: '' }])
  const updateCond = (i, patch) =>
    setConditions(conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  const removeCond = (i) => setConditions(conditions.filter((_, idx) => idx !== i))

  const needsValue = (op) => op !== 'is_null' && op !== 'not_null'

  return (
    <div>
      <div style={{ fontSize: 12, color: '#4a5e7a', marginBottom: 6 }}>
        Branches to the next element only if all conditions are met.
      </div>
      {conditions.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <div style={{ flex: 2 }}>
            <SearchableCombo value={c.field} options={columns}
              onChange={(v) => updateCond(i, { field: v })} placeholder="Field…" allowFreeText />
          </div>
          <div style={{ flex: 1 }}>
            <SearchableCombo value={c.operator} options={DECISION_OPERATORS}
              onChange={(v) => updateCond(i, { operator: v })} />
          </div>
          {needsValue(c.operator) && (
            <input style={{ ...inputStyle, flex: 1, margin: 0 }} value={c.value}
              placeholder="value" onChange={e => updateCond(i, { value: e.target.value })} />
          )}
          <button style={buttonSmDangerStyle} onClick={() => removeCond(i)}>
            <Icon path="M6 18L18 6M6 6l12 12" size={12} />
          </button>
        </div>
      ))}
      <button style={buttonSmSecondaryStyle} onClick={addCond}>
        <Icon path="M12 5v14M5 12h14" size={12} /> Add Condition
      </button>
    </div>
  )
}

// ─── Action element editor ───────────────────────────────────────────────────

function ActionEditor({ el, flow, isSilent, onUpdate }) {
  const actionTypes = isSilent ? SILENT_ACTION_TYPES : SCREEN_ACTION_TYPES
  const actionType = el.fe_config?.action_type || actionTypes[0].value
  const cfg = el.fe_config?.config || {}

  const [statusValues, setStatusValues] = useState([])
  const [roles, setRoles] = useState([])
  const [templates, setTemplates] = useState([])
  const [columns, setColumns] = useState([])
  const targetObject = cfg.object || flow.flow_trigger_object || flow.flow_launch_object

  useEffect(() => {
    if (actionType === 'status_change' && targetObject) {
      fetchStatusValues(targetObject).then(setStatusValues).catch(() => setStatusValues([]))
    }
    if (actionType === 'task_create') {
      fetchRoles().then(setRoles).catch(() => setRoles([]))
    }
    if (actionType === 'send_email') {
      fetchEmailTemplates().then(setTemplates).catch(() => setTemplates([]))
    }
    if ((actionType === 'record_update' || actionType === 'record_create') && targetObject) {
      fetchObjectColumns(targetObject).then(setColumns).catch(() => setColumns([]))
    }
  }, [actionType, targetObject])

  const setActionType = (v) => onUpdate({ fe_config: { ...el.fe_config, action_type: v, config: {} } })
  const setCfg = (patch) => onUpdate({ fe_config: { ...el.fe_config, action_type: actionType, config: { ...cfg, ...patch } } })

  return (
    <div>
      <FormField label="Action type">
        <SearchableCombo value={actionType} options={actionTypes} onChange={setActionType} />
      </FormField>

      {(actionType === 'record_create' || actionType === 'record_update' || actionType === 'status_change') && (
        <FormField label="Target object">
          <input style={inputStyle} value={cfg.object || ''}
            placeholder="e.g. tasks, work_orders"
            onChange={e => setCfg({ object: e.target.value })} />
        </FormField>
      )}

      {actionType === 'status_change' && (
        <FormField label="New status">
          <SearchableCombo value={cfg.status || ''} options={statusValues}
            onChange={(v) => setCfg({ status: v })} placeholder="Select status…" allowFreeText />
        </FormField>
      )}

      {(actionType === 'record_create' || actionType === 'record_update') && (
        <FormField label="Field values (JSON)" hint='e.g. {"work_order_status":"Work Order Scheduled"}'>
          <textarea style={textareaStyle} rows={2}
            value={cfg.values_json ?? (cfg.values ? JSON.stringify(cfg.values) : '')}
            onChange={e => setCfg({ values_json: e.target.value })} />
        </FormField>
      )}

      {actionType === 'task_create' && (
        <>
          <FormField label="Task subject">
            <input style={inputStyle} value={cfg.subject || ''}
              onChange={e => setCfg({ subject: e.target.value })} />
          </FormField>
          <FormField label="Assign to role">
            <SearchableCombo value={cfg.owner_role_id || ''} options={roles}
              onChange={(v) => setCfg({ owner_role_id: v })} placeholder="Select role…" />
          </FormField>
        </>
      )}

      {actionType === 'send_email' && (
        <FormField label="Email template">
          <SearchableCombo value={cfg.template_id || ''} options={templates}
            onChange={(v) => setCfg({ template_id: v })} placeholder="Select template…" />
        </FormField>
      )}
    </div>
  )
}

// ─── Run history ─────────────────────────────────────────────────────────────

function RunHistory({ runs }) {
  if (!runs.length) {
    return <div style={hintBoxStyle}>No runs recorded yet.</div>
  }
  return (
    <div style={{ border: '1px solid #e4e9f2', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f7f9fc', textAlign: 'left' }}>
            {['Run', 'Trigger', 'Status', 'Outcome', 'Started', 'AI'].map(h => (
              <th key={h} style={{ padding: '8px 10px', color: '#4a5e7a', fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} style={{ borderTop: '1px solid #e4e9f2' }}>
              <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace' }}>{r.fr_record_number}</td>
              <td style={{ padding: '8px 10px' }}>{r.fr_trigger_event || '—'}{r.fr_trigger_object ? ` · ${r.fr_trigger_object}` : ''}</td>
              <td style={{ padding: '8px 10px' }}>{r.fr_status}</td>
              <td style={{ padding: '8px 10px', color: '#4a5e7a' }}>{r.fr_outcome_message || '—'}</td>
              <td style={{ padding: '8px 10px', color: '#8fa0b8' }}>
                {r.fr_started_at ? new Date(r.fr_started_at).toLocaleString() : '—'}
              </td>
              <td style={{ padding: '8px 10px' }}>{r.fr_ai_assisted ? 'Yes' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Modal shell ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(13,26,46,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 10, padding: 22, width: 'min(560px, 92vw)',
        maxHeight: '88vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, color: '#0d1a2e' }}>{title}</h3>
          <button style={{ ...buttonSmSecondaryStyle, marginLeft: 'auto' }} onClick={onClose}>
            <Icon path="M6 18L18 6M6 6l12 12" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
