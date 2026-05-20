import { useCallback, useEffect, useState } from 'react'
import { C } from '../../data/constants'
import { LoadingState, ErrorState } from '../../components/UI'
import { ListView } from '../../components/ListView'
import HelpIcon from '../../components/help/HelpIcon'
import {
  inputStyle, textareaStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, FormField,
} from './adminStyles'
import {
  fetchAutomationRules,
  fetchAutomationRuleFull,
  createAutomationRule,
  updateAutomationRule,
  fetchAutomationTriggerObjects,
  fetchAutomationStatusValues,
  fetchAutomationRoles,
  fetchAutomationEmailTemplates,
  fetchAutomationWorkTypes,
} from '../../data/adminService'
import { useToast } from '../../components/Toast'

// ---------------------------------------------------------------------------
// AutomationRulesPane — Setup → Process Automation → Flows
//
// Structured builder for automation_rules. The generic NodePage editor can't
// shape action_config per action_type, so this pane owns the full
// create/read/update surface. The modal renders a different action_config
// form per action_type (send_email / create_task / create_work_order /
// update_record), matching exactly what the runtime executor expects.
//
// Trigger half handles status_change with a status picker scoped to the
// chosen object's lifecycle (via status_transitions). The 'scheduled'
// trigger event is out of scope for this builder — scheduled rules are
// fired by the dispatch-scheduled-reports cron and managed via
// scheduled_reports directly.
// ---------------------------------------------------------------------------

const RULE_COLS = [
  { field: 'name',            label: 'Rule Name',  type: 'text',   sortable: true,  filterable: true,  primary: true },
  { field: 'triggerSummary',  label: 'When',       type: 'text',   sortable: true,  filterable: true },
  { field: 'actionSummary',   label: 'Then',       type: 'text',   sortable: true,  filterable: true },
  { field: 'status',          label: 'Status',     type: 'text',   sortable: true,  filterable: true },
  { field: 'executionOrder',  label: 'Order',      type: 'number', sortable: true,  filterable: false },
]

const ACTION_TYPE_OPTIONS = [
  { value: 'send_email',         label: 'Send Email' },
  { value: 'create_task',        label: 'Create Task' },
  { value: 'create_work_order',  label: 'Create Work Order' },
  { value: 'update_record',      label: 'Update Record' },
]

const TRIGGER_EVENT_OPTIONS = [
  { value: 'status_change', label: 'Status Change' },
  // 'scheduled' is fired by dispatch-scheduled-reports cron and managed
  // via scheduled_reports directly, not this builder. Hidden from the UI.
]

const UPDATE_RECORD_TARGET_OPTIONS = [
  { value: 'self',                          label: 'This record (self)' },
  { value: 'parent_project',                label: 'Parent project' },
  { value: 'parent_opportunity',            label: 'Parent opportunity' },
  { value: 'parent_property',               label: 'Parent property' },
  { value: 'parent_work_order',             label: 'Parent work order' },
  { value: 'parent_account',                label: 'Parent account' },
  { value: 'parent_incentive_application',  label: 'Parent incentive application' },
]

const UPDATE_RECORD_MODE_OPTIONS = [
  { value: 'status',    label: 'Set status (status_to_label)' },
  { value: 'set_field', label: 'Set field value (set_field / set_value)' },
]

function summarizeTrigger(r) {
  if (r.trigger_event === 'status_change') {
    return r.trigger_status
      ? `${r.trigger_object || '?'} → ${r.trigger_status}`
      : `${r.trigger_object || '?'} status changes`
  }
  if (r.trigger_event === 'scheduled') return 'Scheduled (cron)'
  return `${r.trigger_object || '?'} ${r.trigger_event || '?'}`
}

function summarizeAction(r) {
  const cfg = r.action_config || {}
  switch (r.action_type) {
    case 'send_email':
      return cfg.template ? `Email: ${cfg.template} → ${cfg.recipient_role || '?'}` : 'Send email'
    case 'create_task':
      return cfg.task_name ? `Task: ${cfg.task_name} → ${cfg.assigned_role || '?'}` : 'Create task'
    case 'create_work_order':
      return cfg.work_type ? `WO: ${cfg.work_type} → ${cfg.assigned_role || '?'}` : 'Create work order'
    case 'update_record': {
      const target = cfg.target || 'self'
      const mode = cfg.mode || (cfg.status_to_label ? 'status' : 'set_field')
      if (mode === 'status') return `Update ${target}: status → ${cfg.status_to_label || '?'}`
      return `Update ${target}: ${cfg.set_field || '?'} = ${cfg.set_value ?? '?'}`
    }
    default:
      return r.action_type || '—'
  }
}

export default function AutomationRulesPane() {
  const toast = useToast()
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)  // { mode: 'create'|'edit', initial: rule|null }

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchAutomationRules()
      .then(async raw => {
        // fetchAutomationRules returns shaped rows but without action_config.
        // Fetch the full row for each so the When/Then summary cells render
        // accurately without a second round trip when the user opens the
        // modal. The list is small (single-digit count today), so this is
        // not a hot path.
        const fullById = new Map()
        await Promise.all(raw.map(async r => {
          try {
            const f = await fetchAutomationRuleFull(r._id)
            fullById.set(r._id, f)
          } catch { /* row falls through with truncated action summary */ }
        }))
        const shaped = raw.map(r => {
          const full = fullById.get(r._id) || {}
          const merged = {
            ...r,
            id: r._id,
            trigger_object: full.trigger_object ?? r.triggerObject,
            trigger_event:  full.trigger_event  ?? r.triggerEvent,
            trigger_status: full.trigger_status ?? (r.triggerStatus === '—' ? null : r.triggerStatus),
            action_type:    full.action_type    ?? r.actionType,
            action_config:  full.action_config  ?? null,
          }
          return {
            id: r._id,
            name: r.name,
            triggerSummary: summarizeTrigger(merged),
            actionSummary:  summarizeAction(merged),
            status: r.status,
            executionOrder: r.executionOrder,
          }
        })
        setRules(shaped)
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  const handleOpen = useCallback(async (row) => {
    if (!row?.id) return
    try {
      const full = await fetchAutomationRuleFull(row.id)
      setEditing({ mode: 'edit', initial: full })
    } catch (e) {
      toast.error(`Failed to load rule: ${e.message || e}`)
    }
  }, [toast])

  const systemViews = [
    { id: 'AV',  name: 'All',       filters: [],                                                  sortField: 'name', sortDir: 'asc' },
    { id: 'AC',  name: 'Active',    filters: [{ field: 'status', op: 'equals', value: 'Active' }], sortField: 'name', sortDir: 'asc' },
    { id: 'IN',  name: 'Inactive',  filters: [{ field: 'status', op: 'equals', value: 'Inactive' }], sortField: 'name', sortDir: 'asc' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Flows (Automation Rules)</div>
          <HelpIcon
            anchors={[
              { type: 'object', object: 'automation_rules' },
              { type: 'concept', concept: 'automation-rule' },
              { type: 'concept', concept: 'automation-builder' },
            ]}
            title="Automation rules"
          />
        </div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading ? 'Loading…' : `${rules.length} rule${rules.length === 1 ? '' : 's'} — click a row to edit the trigger and action`}
        </div>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && (
        <ListView
          data={rules}
          columns={RULE_COLS}
          systemViews={systemViews}
          defaultViewId="AV"
          newLabel="Automation Rule"
          onNew={() => setEditing({ mode: 'create', initial: null })}
          onOpenRecord={handleOpen}
          onRefresh={reload}
        />
      )}

      {editing && (
        <AutomationRuleEditor
          mode={editing.mode}
          initial={editing.initial}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AutomationRuleEditor — modal form for create + edit. Two halves: When
// (trigger) and Then (action). The Then half rewires per action_type so the
// user is always editing exactly the action_config shape the executor
// expects. Validation runs client-side; the DB enforces NOT NULL on the
// required columns as a backstop.
// ---------------------------------------------------------------------------

function AutomationRuleEditor({ mode, initial, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = mode === 'edit' && !!initial

  const [name,             setName]             = useState(initial?.name || '')
  const [description,      setDescription]      = useState(initial?.description || '')
  const [isActive,         setIsActive]         = useState(initial?.is_active ?? true)
  const [executionOrder,   setExecutionOrder]   = useState(initial?.execution_order ?? 1)
  const [triggerObject,    setTriggerObject]    = useState(initial?.trigger_object || '')
  const [triggerEvent,     setTriggerEvent]     = useState(initial?.trigger_event || 'status_change')
  const [triggerStatus,    setTriggerStatus]    = useState(initial?.trigger_status || '')
  const [actionType,       setActionType]       = useState(initial?.action_type || 'send_email')
  const [actionConfig,     setActionConfig]     = useState(initial?.action_config || {})
  const [saving,           setSaving]           = useState(false)

  const [triggerObjectOptions, setTriggerObjectOptions] = useState([])
  const [statusOptions,        setStatusOptions]        = useState([])
  const [roleOptions,          setRoleOptions]          = useState([])
  const [emailTemplateOptions, setEmailTemplateOptions] = useState([])
  const [workTypeOptions,      setWorkTypeOptions]      = useState([])

  useEffect(() => {
    fetchAutomationTriggerObjects().then(setTriggerObjectOptions).catch(() => setTriggerObjectOptions([]))
    fetchAutomationRoles().then(setRoleOptions).catch(() => setRoleOptions([]))
    fetchAutomationEmailTemplates().then(setEmailTemplateOptions).catch(() => setEmailTemplateOptions([]))
    fetchAutomationWorkTypes().then(setWorkTypeOptions).catch(() => setWorkTypeOptions([]))
  }, [])

  useEffect(() => {
    if (!triggerObject) { setStatusOptions([]); return }
    fetchAutomationStatusValues(triggerObject)
      .then(setStatusOptions)
      .catch(() => setStatusOptions([]))
  }, [triggerObject])

  const updateConfig = (patch) => setActionConfig(prev => ({ ...prev, ...patch }))

  const handleActionTypeChange = (newType) => {
    setActionType(newType)
    // Reset action_config so we don't carry stale keys between action types
    // (e.g. switching from send_email to create_task shouldn't leave a
    // stray `template` key behind).
    setActionConfig({})
  }

  const validate = () => {
    if (!name.trim()) return 'Name is required'
    if (!triggerObject) return 'Trigger object is required'
    if (!triggerEvent) return 'Trigger event is required'
    if (triggerEvent === 'status_change' && !triggerStatus.trim()) {
      return 'Trigger status is required for status_change triggers'
    }
    if (!actionType) return 'Action type is required'

    if (actionType === 'send_email') {
      if (!actionConfig.template) return 'Email template is required for send_email'
      if (!actionConfig.recipient_role) return 'Recipient role is required for send_email'
    }
    if (actionType === 'create_task') {
      if (!actionConfig.task_name) return 'Task name is required for create_task'
      if (!actionConfig.assigned_role) return 'Assigned role is required for create_task'
    }
    if (actionType === 'create_work_order') {
      if (!actionConfig.work_type) return 'Work type is required for create_work_order'
      if (!actionConfig.assigned_role) return 'Assigned role is required for create_work_order'
    }
    if (actionType === 'update_record') {
      const m = actionConfig.mode || 'status'
      if (m === 'status' && !actionConfig.status_to_label) {
        return 'Target status label is required when update mode is "status"'
      }
      if (m === 'set_field' && !actionConfig.set_field) {
        return 'Field name is required when update mode is "set_field"'
      }
      if (m === 'set_field' && actionConfig.set_value === undefined) {
        return 'Field value is required when update mode is "set_field"'
      }
    }
    return null
  }

  const handleSave = async () => {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      // For update_record actions, normalize target + mode into the config
      // since the executor reads them from there. Default to self+status.
      let finalConfig = { ...actionConfig }
      if (actionType === 'update_record') {
        finalConfig.target = finalConfig.target || 'self'
        finalConfig.mode   = finalConfig.mode   || 'status'
      }
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        is_active: !!isActive,
        execution_order: Number(executionOrder) || 1,
        trigger_object: triggerObject,
        trigger_event: triggerEvent,
        trigger_status: triggerEvent === 'status_change' ? triggerStatus.trim() : null,
        action_type: actionType,
        action_config: finalConfig,
      }
      if (isEdit) {
        await updateAutomationRule(initial.id, payload)
        toast.success('Rule updated')
      } else {
        await createAutomationRule(payload)
        toast.success('Rule created')
      }
      onSaved()
    } catch (e) {
      toast.error(`Save failed: ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  // Picker-or-text fallback: when the picker came back empty (RPC failure,
  // offline, or target table empty), drop back to a free-text input so the
  // user can still author. The actual saved value matches what would have
  // come out of the picker either way.
  const PickerOrText = ({ options, value, onChange, placeholder }) => {
    if (options.length === 0) {
      return <input type="text" style={inputStyle} value={value || ''}
        onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    }
    return (
      <select style={inputStyle} value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">— Select —</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'rgba(13, 26, 46, 0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }}>
      <div style={{
        background: C.card, borderRadius: 8, border: `1px solid ${C.border}`,
        width: '100%', maxWidth: 720, maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 24px 48px -12px rgba(13, 26, 46, 0.25)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: 18, color: C.textPrimary }}>
            {isEdit ? 'Edit Automation Rule' : 'New Automation Rule'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 22, color: C.textMuted, padding: 4 }}>
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* DETAILS */}
          <section>
            <h3 style={sectionHeadingStyle}>Details</h3>
            <FormField label="Name" required>
              <input type="text" style={inputStyle} value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Notify Project Coordinator when work order submitted" />
            </FormField>
            <FormField label="Description">
              <textarea style={textareaStyle} value={description} rows={2}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional — what does this rule do and why?" />
            </FormField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Active">
                <select style={inputStyle} value={isActive ? '1' : '0'}
                  onChange={e => setIsActive(e.target.value === '1')}>
                  <option value="1">Active — fires on matching events</option>
                  <option value="0">Inactive — paused</option>
                </select>
              </FormField>
              <FormField label="Execution order"
                hint="When multiple rules match the same trigger, lower numbers fire first">
                <input type="number" style={inputStyle} value={executionOrder} min={1} step={1}
                  onChange={e => setExecutionOrder(e.target.value)}
                  placeholder="1" />
              </FormField>
            </div>
          </section>

          {/* TRIGGER */}
          <section>
            <h3 style={sectionHeadingStyle}>When (Trigger)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Trigger object" required>
                <PickerOrText options={triggerObjectOptions} value={triggerObject}
                  onChange={setTriggerObject}
                  placeholder="e.g. work_orders" />
              </FormField>
              <FormField label="Trigger event" required>
                <select style={inputStyle} value={triggerEvent}
                  onChange={e => setTriggerEvent(e.target.value)}>
                  {TRIGGER_EVENT_OPTIONS.map(o =>
                    <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FormField>
            </div>
            {triggerEvent === 'status_change' && (
              <FormField label="Trigger status" required
                hint="Fires when the record reaches this status">
                <PickerOrText options={statusOptions} value={triggerStatus}
                  onChange={setTriggerStatus}
                  placeholder="e.g. Work Order Submitted" />
              </FormField>
            )}
          </section>

          {/* ACTION */}
          <section>
            <h3 style={sectionHeadingStyle}>Then (Action)</h3>
            <FormField label="Action type" required>
              <select style={inputStyle} value={actionType}
                onChange={e => handleActionTypeChange(e.target.value)}>
                {ACTION_TYPE_OPTIONS.map(o =>
                  <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </FormField>

            {actionType === 'send_email' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormField label="Email template" required>
                  <PickerOrText options={emailTemplateOptions}
                    value={actionConfig.template}
                    onChange={v => updateConfig({ template: v })}
                    placeholder="e.g. Work Order Scheduled — Team Lead" />
                </FormField>
                <FormField label="Recipient role" required>
                  <PickerOrText options={roleOptions}
                    value={actionConfig.recipient_role}
                    onChange={v => updateConfig({ recipient_role: v })}
                    placeholder="e.g. Project Coordinator" />
                </FormField>
              </div>
            )}

            {actionType === 'create_task' && (
              <>
                <FormField label="Task name" required>
                  <input type="text" style={inputStyle}
                    value={actionConfig.task_name || ''}
                    onChange={e => updateConfig({ task_name: e.target.value })}
                    placeholder="e.g. Verify work order" />
                </FormField>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormField label="Assigned role" required>
                    <PickerOrText options={roleOptions}
                      value={actionConfig.assigned_role}
                      onChange={v => updateConfig({ assigned_role: v })}
                      placeholder="e.g. Project Coordinator" />
                  </FormField>
                  <FormField label="Due in (days)"
                    hint="Days from rule fire to task due date">
                    <input type="number" style={inputStyle}
                      value={actionConfig.due_days ?? ''}
                      min={0} step={1}
                      onChange={e => updateConfig({ due_days: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="e.g. 1" />
                  </FormField>
                </div>
              </>
            )}

            {actionType === 'create_work_order' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormField label="Work type" required>
                  <PickerOrText options={workTypeOptions}
                    value={actionConfig.work_type}
                    onChange={v => updateConfig({ work_type: v })}
                    placeholder="e.g. Shop Kit - Equipment" />
                </FormField>
                <FormField label="Assigned role" required>
                  <PickerOrText options={roleOptions}
                    value={actionConfig.assigned_role}
                    onChange={v => updateConfig({ assigned_role: v })}
                    placeholder="e.g. Shop Steward" />
                </FormField>
              </div>
            )}

            {actionType === 'update_record' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormField label="Update target" required
                    hint="Which record gets updated">
                    <select style={inputStyle}
                      value={actionConfig.target || 'self'}
                      onChange={e => updateConfig({ target: e.target.value })}>
                      {UPDATE_RECORD_TARGET_OPTIONS.map(o =>
                        <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Update mode" required>
                    <select style={inputStyle}
                      value={actionConfig.mode || 'status'}
                      onChange={e => updateConfig({ mode: e.target.value })}>
                      {UPDATE_RECORD_MODE_OPTIONS.map(o =>
                        <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </FormField>
                </div>
                {(actionConfig.mode || 'status') === 'status' ? (
                  <FormField label="Target status label" required
                    hint="The status the target record will be moved to">
                    <input type="text" style={inputStyle}
                      value={actionConfig.status_to_label || ''}
                      onChange={e => updateConfig({ status_to_label: e.target.value })}
                      placeholder="e.g. Project Verified" />
                  </FormField>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <FormField label="Field name" required>
                      <input type="text" style={inputStyle}
                        value={actionConfig.set_field || ''}
                        onChange={e => updateConfig({ set_field: e.target.value })}
                        placeholder="e.g. project_qaqc_complete" />
                    </FormField>
                    <FormField label="Field value" required>
                      <input type="text" style={inputStyle}
                        value={actionConfig.set_value ?? ''}
                        onChange={e => updateConfig({ set_value: e.target.value })}
                        placeholder="e.g. true" />
                    </FormField>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Raw config preview — helpful for power users and debugging */}
          <details style={{ fontSize: 12, color: C.textMuted }}>
            <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Raw action_config (advanced)</summary>
            <pre style={{
              margin: '8px 0 0 0', padding: 10, background: '#f7f9fc',
              borderRadius: 6, border: `1px solid ${C.border}`, overflow: 'auto',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
            }}>
              {JSON.stringify(actionConfig, null, 2)}
            </pre>
          </details>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button type="button" style={buttonSecondaryStyle} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" style={buttonPrimaryStyle} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Rule')}
          </button>
        </div>
      </div>
    </div>
  )
}

const sectionHeadingStyle = {
  margin: '0 0 12px 0',
  fontSize: 13,
  fontWeight: 600,
  color: C.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}
