import { useState, useEffect, useCallback } from 'react'
import { C } from '../data/constants'
import { Badge, Icon } from './UI'
import { useToast } from './Toast'
import { useIsMobile } from '../lib/useMediaQuery'
import {
  loadRecordDetailData,
  saveRecord,
  insertRecord,
  deleteRecord,
  fetchTableMetadata,
  fetchPicklistOptions,
  fetchLookupOptions,
  fetchPageLayout,
  loadPicklists as loadAllPicklists,
  getCurrentUserId,
  fetchRelatedRecords,
  reorderJunctionRows,
  fetchPickerCandidates,
  addJunctionRow,
  removeJunctionRow,
  applyInsertDefaults,
} from '../data/layoutService'

// ---------------------------------------------------------------------------
// Field value formatter
// ---------------------------------------------------------------------------

function formatFieldValue(raw, fieldDef, picklists, lookups) {
  if (raw === null || raw === undefined) return '—'
  switch (fieldDef.type) {
    case 'picklist':   return picklists.byId.get(raw) || String(raw)
    case 'lookup':     return lookups.get(raw) || String(raw).slice(0, 8) + '…'
    case 'currency':   return `$${Number(raw).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    case 'percent':    return `${Number(raw)}%`
    case 'date':       return raw ? new Date(raw + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
    case 'datetime':   return raw ? new Date(raw).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
    case 'boolean':    return raw ? 'Yes' : 'No'
    case 'number':     return raw != null ? Number(raw).toLocaleString() : '—'
    default:           return String(raw)
  }
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const inputBase = {
  width: '100%', padding: '7px 10px', fontSize: 13, border: `1px solid ${C.border}`,
  borderRadius: 5, outline: 'none', fontFamily: 'Inter, sans-serif', color: C.textPrimary,
  background: '#fff', boxSizing: 'border-box',
}
const monoInput = { ...inputBase, fontFamily: 'JetBrains Mono, monospace' }

// ---------------------------------------------------------------------------
// Breadcrumb — Salesforce-style hierarchy path
// ---------------------------------------------------------------------------

const TABLE_META = {
  contacts:                  { module: 'Outreach',       label: 'Contacts',            parents: ['property_owner_id', 'property_management_company_id'] },
  properties:                { module: 'Outreach',       label: 'Properties',           parents: ['property_owner_id'] },
  buildings:                 { module: 'Outreach',       label: 'Buildings',            parents: ['property_id'] },
  units:                     { module: 'Outreach',       label: 'Units',                parents: ['building_id', 'property_id'] },
  opportunities:             { module: 'Outreach',       label: 'Opportunities',        parents: ['property_id'] },
  property_programs:         { module: 'Outreach',       label: 'Enrollment',           parents: ['property_id'] },
  work_orders:               { module: 'Field',          label: 'Work Orders',          parents: ['project_id', 'property_id', 'building_id'] },
  projects:                  { module: 'Field',          label: 'Projects',             parents: ['property_id'] },
  assessments:               { module: 'Qualification',  label: 'Assessments',          parents: ['property_id', 'building_id'] },
  incentive_applications:    { module: 'Qualification',  label: 'Applications',         parents: ['property_id'] },
  efr_reports:               { module: 'Qualification',  label: 'EFR Reports',          parents: ['property_id'] },
  project_payment_requests:  { module: 'Incentives',     label: 'Payment Requests',     parents: ['project_id', 'property_id'] },
  payment_receipts:          { module: 'Incentives',     label: 'Payment Receipts',     parents: [] },
  products:                  { module: 'Stock',          label: 'Product Catalog',      parents: [] },
  product_items:             { module: 'Stock',          label: 'Inventory On-Hand',    parents: [] },
  materials_requests:        { module: 'Stock',          label: 'Materials Requests',   parents: ['project_id'] },
  equipment:                 { module: 'Stock',          label: 'Equipment',            parents: [] },
  vehicles:                  { module: 'Fleet',          label: 'Vehicles',             parents: [] },
  vehicle_activities:        { module: 'Fleet',          label: 'Activities',           parents: ['vehicle_id'] },
  equipment_containers:      { module: 'Fleet',          label: 'Vehicle Kits',         parents: ['issued_to_vehicle_id'] },
  users:                     { module: 'People',         label: 'Users',                parents: [] },
  technicians:               { module: 'People',         label: 'Technicians',          parents: [] },
  certifications:            { module: 'People',         label: 'Certifications',       parents: ['technician_id'] },
  time_sheets:               { module: 'People',         label: 'Time Sheets',          parents: ['technician_id'] },
  programs:                  { module: 'Admin',          label: 'Programs',             parents: [] },
  work_types:                { module: 'Admin',          label: 'Work Types',           parents: [] },
  email_templates:           { module: 'Admin',          label: 'Email Templates',      parents: [] },
  document_templates:        { module: 'Admin',          label: 'Document Templates',   parents: [] },
  automation_rules:          { module: 'Admin',          label: 'Automation Rules',     parents: [] },
  validation_rules:          { module: 'Admin',          label: 'Validation Rules',     parents: [] },
  roles:                     { module: 'Admin',          label: 'Roles',                parents: [] },
  picklist_values:           { module: 'Admin',          label: 'Picklist Values',      parents: [] },
  portal_users:              { module: 'Portal',         label: 'Portal Users',         parents: ['property_owner_id', 'partner_org_id'] },
  partner_organizations:     { module: 'Portal',         label: 'Partners',             parents: [] },
}

function Breadcrumbs({ tableName, record, lookups, onBack }) {
  const meta = TABLE_META[tableName] || { module: '—', label: tableName, parents: [] }

  // Build parent chain from resolved lookups
  const parentCrumbs = []
  for (const fk of meta.parents) {
    const val = record[fk]
    if (val && lookups.has(val)) {
      parentCrumbs.push(lookups.get(val))
    }
  }

  const sep = <span style={{ color: C.textMuted, margin: '0 6px', fontSize: 10 }}>/</span>

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, marginBottom: 14 }}>
      <span style={{ fontSize: 12, color: C.textMuted }}>{meta.module}</span>
      {sep}
      <button onClick={onBack} style={{ fontSize: 12, color: '#1a5a8a', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}>
        {meta.label}
      </button>
      {parentCrumbs.map((name, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
          {sep}
          <span style={{ fontSize: 12, color: C.textSecondary }}>{name}</span>
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// Known object prefixes so humanize() can strip them for readable error messages
const FIELD_PREFIXES = [
  'contact_', 'property_', 'opportunity_', 'work_order_', 'project_',
  'building_', 'unit_', 'assessment_', 'vehicle_', 'va_', 'technician_',
  'product_item_', 'product_', 'equipment_', 'ia_', 'ppr_', 'user_',
]

function humanizeFieldName(col) {
  let name = col
  for (const p of FIELD_PREFIXES) {
    if (name.startsWith(p)) { name = name.slice(p.length); break }
  }
  if (name.endsWith('_id')) name = name.slice(0, -3)
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

// Build a { fieldName → layoutLabel } map from the loaded page layout sections.
function buildLabelMap(sections) {
  const out = {}
  for (const s of sections || []) {
    for (const w of s.widgets || []) {
      if (w.widget_type === 'field_group' && w.widget_config?.fields) {
        for (const f of w.widget_config.fields) {
          if (f?.name && f?.label) out[f.name] = f.label
        }
      }
    }
  }
  return out
}

// Return an array of human-readable labels for required fields that are
// missing from the provided values object. An empty string is treated as
// missing; `false` and `0` are valid values.
function findMissingRequired(requiredFields, values, labelMap) {
  const missing = []
  for (const f of requiredFields || []) {
    const v = values?.[f]
    if (v === null || v === undefined || v === '') {
      missing.push(labelMap[f] || humanizeFieldName(f))
    }
  }
  return missing
}

// Cross-field sanity validation. Runs after required-field check, before
// the row hits the DB. Returns an array of human-readable error strings;
// empty array means valid. Add new tables here as forms come online —
// keeps validation rules close to the form code instead of scattered
// across triggers and Admin tables. Production-grade rules belong in
// validation_rules eventually; this is the lightweight first pass.
function validateBeforeSave(tableName, fields, evidenceLabelById) {
  const errors = []

  if (tableName === 'work_step_templates') {
    const photosReq      = Number(fields.wst_photos_required_count || 0)
    const beforeRequired = !!fields.wst_photo_before_required
    const afterRequired  = !!fields.wst_photo_after_required
    const evidenceLabel  = (evidenceLabelById && fields.wst_required_evidence_type_id)
      ? (evidenceLabelById.get(fields.wst_required_evidence_type_id) || '').toLowerCase()
      : ''
    const evidenceIsPhoto = evidenceLabel.includes('photo')
    const dur = Number(fields.wst_estimated_duration_minutes || 0)

    // 1. If you ask for a Before or After photo, you need at least one photo
    if ((beforeRequired || afterRequired) && photosReq < 1) {
      errors.push('Photos Required must be at least 1 when Before Photo or After Photo is required.')
    }
    // 2. Inverse: if Photos Required > 0, mark which side(s) are required
    if (photosReq > 0 && !beforeRequired && !afterRequired) {
      errors.push('Mark Before Photo Required, After Photo Required, or both — Photos Required is greater than zero.')
    }
    // 3. Evidence Type = Photo implies Photos Required > 0
    if (evidenceIsPhoto && photosReq < 1) {
      errors.push('Evidence Type is Photo — Photos Required must be at least 1.')
    }
    // 4. Negative durations are nonsense
    if (fields.wst_estimated_duration_minutes != null
        && fields.wst_estimated_duration_minutes !== ''
        && dur < 0) {
      errors.push('Estimated Duration cannot be negative.')
    }
  }

  return errors
}

// Build the ordered list of tab names from the loaded sections.
// Details first, Related second (if any section has related_list widgets),
// then any custom tabs alphabetical after.
function buildOrderedTabs(sections) {
  const names = new Set()
  let hasRelatedList = false
  for (const sec of sections || []) {
    names.add(sec.section_tab || 'Details')
    if ((sec.widgets || []).some(w => w.widget_type === 'related_list')) {
      hasRelatedList = true
    }
  }
  if (hasRelatedList) names.add('Related')
  const rank = (t) => t === 'Details' ? 0 : t === 'Related' ? 1 : 2
  return [...names].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })
}

// ---------------------------------------------------------------------------
// Delete confirmation modal
// ---------------------------------------------------------------------------

function DeleteConfirmModal({ objectLabel, recordName, onConfirm, onCancel, busy }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, borderRadius: 10, padding: 26, width: 420,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"
              size={15} color="#b03a2e" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Move to recycle bin?
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
              This will remove <strong style={{ color: C.textPrimary }}>{recordName || `this ${objectLabel.toLowerCase()}`}</strong> from all list views.
              It stays in the recycle bin until an administrator purges it.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1,
              background: busy ? '#d0574a' : '#b03a2e',
              color: '#fff', border: 'none', borderRadius: 6,
              padding: '9px 0', fontSize: 13, fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.8 : 1,
            }}
          >
            {busy ? 'Deleting…' : 'Move to Recycle Bin'}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1, background: C.page, color: C.textSecondary,
              border: `1px solid ${C.border}`, borderRadius: 6,
              padding: '9px 0', fontSize: 13, cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EditField — renders the right input for a field type
// ---------------------------------------------------------------------------

function EditField({ field, value, onChange, picklistOpts, lookupOpts }) {
  const v = value ?? ''

  switch (field.type) {
    case 'text': case 'phone': case 'email':
      return <input type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
        style={inputBase} value={v} onChange={e => onChange(field.name, e.target.value)} />

    case 'number': case 'currency': case 'percent':
      return <input type="number" step="any" style={monoInput}
        value={v} onChange={e => onChange(field.name, e.target.value === '' ? null : Number(e.target.value))} />

    case 'date':
      return <input type="date" style={monoInput}
        value={v || ''} onChange={e => onChange(field.name, e.target.value || null)} />

    case 'textarea':
      return <textarea style={{ ...inputBase, minHeight: 64, resize: 'vertical' }}
        value={v} onChange={e => onChange(field.name, e.target.value)} />

    case 'boolean': {
      // Yes/No segmented buttons — unambiguous over a single checkbox whose
      // adjacent "Yes/No" label reads like a chosen response. Three states:
      //   value === true   → Yes button highlighted
      //   value === false  → No  button highlighted
      //   value == null    → neither highlighted (forces the user to pick)
      // For inline-create flows, the modal pre-populates `draft` from each
      // field's `default_value` so the visual state matches what will be
      // submitted — no silent disagreement between the form and the DB row.
      const isYes = value === true
      const isNo  = value === false
      const segBtn = (active) => ({
        flex: 1, padding: '7px 12px', fontSize: 12.5, fontWeight: 500,
        cursor: 'pointer', border: `1px solid ${active ? C.emerald : C.border}`,
        background: active ? C.emerald : C.card,
        color: active ? '#fff' : C.textPrimary,
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
        outline: 'none',
      })
      return (
        <div style={{ display: 'flex', gap: 0, maxWidth: 200 }}>
          <button type="button"
            onClick={() => onChange(field.name, true)}
            style={{ ...segBtn(isYes), borderRadius: '5px 0 0 5px', borderRightWidth: isYes || isNo ? 1 : 1 }}>
            Yes
          </button>
          <button type="button"
            onClick={() => onChange(field.name, false)}
            style={{ ...segBtn(isNo), borderRadius: '0 5px 5px 0', borderLeftWidth: 0 }}>
            No
          </button>
        </div>
      )
    }

    case 'picklist': {
      const opts = picklistOpts || []
      return (
        <select style={{ ...inputBase, cursor: 'pointer' }}
          value={v || ''} onChange={e => onChange(field.name, e.target.value || null)}>
          <option value="">— Select —</option>
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }

    case 'lookup': {
      const opts = lookupOpts || []
      if (opts.length > 0) {
        return (
          <select style={{ ...inputBase, cursor: 'pointer' }}
            value={v || ''} onChange={e => onChange(field.name, e.target.value || null)}>
            <option value="">— Select —</option>
            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )
      }
      return <span style={{ fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>Read-only</span>
    }

    case 'datetime':
      return <span style={{ fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>Read-only</span>

    default:
      return <input type="text" style={inputBase} value={v} onChange={e => onChange(field.name, e.target.value)} />
  }
}

// ---------------------------------------------------------------------------
// FieldGroup widget — view mode OR edit mode
// ---------------------------------------------------------------------------

function FieldGroupWidget({ widget, record, picklists, lookups, editing, draft, onChange, allPicklistOpts, allLookupOpts }) {
  const fields = widget.widget_config?.fields || []
  if (fields.length === 0) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0' }}>
      {fields.map(f => {
        const raw = editing ? draft[f.name] : record[f.name]
        const display = formatFieldValue(raw, f, picklists, lookups)
        const isLink = f.type === 'email' || f.type === 'lookup'
        const hasLookupOpts = f.type === 'lookup' && allLookupOpts?.[f.name]?.length > 0
        const isEditable = editing && (f.type !== 'datetime') && (f.type !== 'lookup' || hasLookupOpts)

        return (
          <div key={f.name} style={{
            padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
            display: 'flex', flexDirection: 'column', gap: 4,
            background: isEditable ? '#fafffe' : 'transparent',
          }}>
            <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {f.label}
            </span>
            {isEditable ? (
              <EditField field={f} value={draft[f.name]} onChange={onChange}
                picklistOpts={allPicklistOpts?.[f.name]} lookupOpts={allLookupOpts?.[f.name]} />
            ) : (
              <span style={{
                fontSize: 13,
                color: isLink ? '#1a5a8a' : C.textPrimary,
                fontWeight: 400,
                fontFamily: f.type === 'number' || f.type === 'currency' || f.type === 'percent' ? 'JetBrains Mono, monospace' : 'inherit',
                wordBreak: 'break-word',
              }}>
                {f.type === 'picklist' && raw ? <Badge s={display} /> : display}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RelatedListWidget — Salesforce-style card
//   • Collapsible header with icon, title, record count badge
//   • "New" button to add a child record (passes parent FK as prefill)
//   • First N rows shown as a clickable table
//   • "View All (N)" footer link when more rows exist
// ---------------------------------------------------------------------------

const RELATED_LIST_MAX_ROWS = 5

// Render a single cell. Extracted so the editable and read-only paths can
// share formatting without duplicating the picklist / date / number logic.
function renderRelatedCell(col, val, picklists, { isFirstCol, canNavigate }) {
  let shown = val
  if (col.type === 'picklist' && shown) shown = picklists.byId.get(shown) || shown
  if (col.type === 'date' && shown) {
    shown = new Date(shown + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (col.type === 'number' && shown != null) shown = Number(shown).toLocaleString()
  if (col.type === 'boolean') shown = shown === true ? 'Yes' : shown === false ? 'No' : shown
  return (
    <td key={col.name} style={{
      padding: '10px 14px',
      fontSize: 12.5,
      color: isFirstCol && canNavigate ? '#1a5a8a' : C.textPrimary,
      fontWeight: isFirstCol ? 500 : 400,
      fontFamily: col.type === 'number' ? 'JetBrains Mono, monospace' : 'inherit',
      whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {col.type === 'picklist' && shown ? <Badge s={shown} /> : (shown != null && shown !== '' ? shown : '—')}
    </td>
  )
}

// Mobile variant: returns the formatted value as a JSX snippet (no <td> wrapper)
// for use inside a card layout. Mirrors the type-dispatch logic of
// renderRelatedCell but omits the table-specific padding / truncation.
function renderRelatedValue(col, val, picklists) {
  let shown = val
  if (col.type === 'picklist' && shown) shown = picklists.byId.get(shown) || shown
  if (col.type === 'date' && shown) {
    shown = new Date(shown + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (col.type === 'number' && shown != null) shown = Number(shown).toLocaleString()
  if (col.type === 'boolean') shown = shown === true ? 'Yes' : shown === false ? 'No' : shown
  if (col.type === 'picklist' && shown) return <Badge s={shown} />
  if (shown == null || shown === '') return <span style={{ color: C.textMuted }}>—</span>
  return (
    <span style={{
      fontFamily: col.type === 'number' ? 'JetBrains Mono, monospace' : 'inherit',
      color: C.textSecondary,
    }}>
      {shown}
    </span>
  )
}

function RelatedListWidget({
  widget, picklists, onNavigateToRecord, parentRecordId, onRefreshRelated,
}) {
  const config = widget.widget_config || {}
  const columns = config.columns || []
  const allRows = widget._relatedData || []
  const [collapsed, setCollapsed] = useState(false)
  const toast = useToast()
  const isMobile = useIsMobile()

  const childTable = config.table
  const fk = config.fk
  const canNavigate = !!onNavigateToRecord && !!childTable

  // Editable mode gates: config opt-in AND parent wired a refresh callback.
  // If either is missing we render the original read-only card.
  const editable = config.editable === true && typeof onRefreshRelated === 'function'
  // On mobile we disable drag-to-reorder entirely — HTML5 DnD doesn't work on
  // touch, and the visual complexity of drag affordances isn't worth the
  // screen real estate. Users can still use Add/Remove on mobile; for full
  // reordering they should switch to desktop.
  const editableReorder = editable && !isMobile
  const pickerCfg = config.picker
  const orderField = config.order_field

  // Local ordered view so drag-and-drop can renumber optimistically before
  // the reorder RPC returns. Stays in sync when the parent refetches.
  const [localRows, setLocalRows] = useState(allRows)
  useEffect(() => { setLocalRows(allRows) }, [allRows])

  // Drag / reorder / picker UI state
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  // Editable mode shows the full list so drag targets are always visible.
  // Read-only mode keeps the Salesforce-style truncated card.
  const shownRows = editable ? localRows : localRows.slice(0, RELATED_LIST_MAX_ROWS)
  const hiddenCount = editable ? 0 : Math.max(0, localRows.length - shownRows.length)

  const handleRowClick = (row) => {
    if (!canNavigate || !row?.id) return
    onNavigateToRecord({ table: childTable, id: row.id, mode: 'view' })
  }

  const handleNewClick = (e) => {
    e.stopPropagation()
    if (!canNavigate) return
    const prefillObj = fk && parentRecordId ? { [fk]: parentRecordId } : {}
    onNavigateToRecord({ table: childTable, id: null, mode: 'create', prefill: prefillObj })
  }

  const handleAddClick = (e) => {
    e.stopPropagation()
    setPickerOpen(true)
  }

  // ── Drag handlers (HTML5 DnD — no library) ────────────────────────
  const handleDragStart = (e, idx) => {
    setDragIndex(idx)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(idx)) } catch { /* Safari */ }
  }
  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== idx) setDragOverIndex(idx)
  }
  const handleDragLeaveRow = () => setDragOverIndex(null)
  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null) }

  const handleDrop = async (e, dropIdx) => {
    e.preventDefault()
    const srcIdx = dragIndex
    setDragIndex(null); setDragOverIndex(null)
    if (srcIdx === null || srcIdx === dropIdx) return

    const before = localRows
    const next = [...localRows]
    const [moved] = next.splice(srcIdx, 1)
    next.splice(dropIdx, 0, moved)
    // Renumber the live view so the # column reflects the new order
    // while the RPC is in flight.
    if (orderField) {
      next.forEach((r, i) => { r[orderField] = i + 1 })
    }
    setLocalRows(next)
    setSavingOrder(true)
    try {
      await reorderJunctionRows(config, next.map(r => r.id))
      if (onRefreshRelated) await onRefreshRelated()
    } catch (err) {
      toast.error(`Reorder failed — ${err.message || String(err)}`)
      setLocalRows(before) // rollback
    } finally {
      setSavingOrder(false)
    }
  }

  const handleRemove = async (e, row) => {
    e.stopPropagation()
    if (!row?.id || removingId) return
    setRemovingId(row.id)
    try {
      await removeJunctionRow(config, row.id)
      if (onRefreshRelated) await onRefreshRelated()
      toast.success('Removed')
    } catch (err) {
      toast.error(`Remove failed — ${err.message || String(err)}`)
    } finally {
      setRemovingId(null)
    }
  }

  const handlePickerAdded = async () => {
    if (onRefreshRelated) await onRefreshRelated()
  }

  const title = widget.widget_title || config.label || 'Related'

  return (
    <>
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        marginBottom: 12,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div
          onClick={() => setCollapsed((c) => !c)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px 10px 16px',
            background: '#fafbfd',
            borderBottom: collapsed ? 'none' : `1px solid ${C.border}`,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 4,
              background: '#e8f3fb', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon path="M4 6h16M4 12h16M4 18h7" size={12} color="#1a5a8a" />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {title}
            </span>
            <span style={{
              background: C.page, color: C.textSecondary,
              fontSize: 11, fontWeight: 600,
              padding: '1px 8px', borderRadius: 10,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {allRows.length}
            </span>
            {editable && (
              <span style={{
                background: 'rgba(62,207,142,0.14)', color: '#2aab72',
                fontSize: 10, fontWeight: 600, letterSpacing: 0.4,
                padding: '2px 8px', borderRadius: 10,
                textTransform: 'uppercase',
              }}>
                Editable
              </span>
            )}
            {savingOrder && (
              <span style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>
                Saving order…
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {editable && pickerCfg ? (
              <button
                onClick={handleAddClick}
                style={{
                  background: C.emerald, color: '#fff',
                  border: 'none', borderRadius: 5,
                  padding: isMobile ? '8px 14px' : '4px 10px',
                  fontSize: isMobile ? 13 : 11.5,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontWeight: 500,
                  minHeight: isMobile ? 36 : undefined,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#2aab72' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.emerald }}
              >
                <Icon path="M12 5v14M5 12h14" size={isMobile ? 13 : 11} color="#fff" />
                {pickerCfg.add_button_label || 'Add'}
              </button>
            ) : canNavigate ? (
              <button
                onClick={handleNewClick}
                style={{
                  background: C.card, color: C.textSecondary,
                  border: `1px solid ${C.border}`, borderRadius: 5,
                  padding: isMobile ? '8px 14px' : '4px 10px',
                  fontSize: isMobile ? 13 : 11.5,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontWeight: 500,
                  minHeight: isMobile ? 36 : undefined,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#eef2f7'; e.currentTarget.style.borderColor = C.borderDark }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.card; e.currentTarget.style.borderColor = C.border }}
              >
                <Icon path="M12 5v14M5 12h14" size={isMobile ? 13 : 11} color={C.textSecondary} />
                New
              </button>
            ) : null}
            <Icon path={collapsed ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'} size={12} color={C.textMuted} />
          </div>
        </div>

        {/* Body */}
        {!collapsed && (
          <>
            {shownRows.length === 0 ? (
              <div style={{ padding: '22px 16px', fontSize: 12, color: C.textMuted, textAlign: 'center' }}>
                No {title.toLowerCase()} related to this record.
              </div>
            ) : isMobile ? (
              /* ── Mobile card layout ─────────────────────────────────────
                 First column becomes the card title. Remaining columns
                 render underneath as label/value rows. Tap navigates to
                 the record (same as double-click on desktop). Editable
                 lists get a trash icon on the right; drag-to-reorder is
                 disabled on touch. */
              <div>
                {shownRows.map((row, ri) => {
                  const firstCol = columns[0]
                  const restCols = columns.slice(1)
                  const titleVal = firstCol
                    ? (firstCol.type === 'picklist' && row[firstCol.name]
                        ? (picklists.byId.get(row[firstCol.name]) || row[firstCol.name])
                        : row[firstCol.name])
                    : null
                  return (
                    <div
                      key={row.id || ri}
                      onClick={() => canNavigate && handleRowClick(row)}
                      style={{
                        padding: '12px 14px',
                        borderBottom: ri < shownRows.length - 1 ? `1px solid ${C.border}` : 'none',
                        cursor: canNavigate ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Title row: first column value + chevron */}
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          minWidth: 0,
                        }}>
                          <span style={{
                            fontSize: 14, fontWeight: 600,
                            color: canNavigate ? '#1a5a8a' : C.textPrimary,
                            minWidth: 0, flex: 1,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            whiteSpace: 'normal',
                          }}>
                            {firstCol && firstCol.type === 'picklist' && titleVal
                              ? <Badge s={titleVal} />
                              : (titleVal != null && titleVal !== '' ? String(titleVal) : '—')}
                          </span>
                        </div>

                        {/* Remaining columns as label/value pairs */}
                        {restCols.length > 0 && (
                          <div style={{
                            marginTop: 8,
                            display: 'flex', flexDirection: 'column', gap: 4,
                          }}>
                            {restCols.map((col) => (
                              <div key={col.name} style={{
                                display: 'flex', justifyContent: 'space-between',
                                alignItems: 'center', gap: 10, fontSize: 13,
                              }}>
                                <span style={{ color: C.textMuted, flexShrink: 0 }}>{col.label}</span>
                                <span style={{
                                  textAlign: 'right', minWidth: 0,
                                  overflow: 'hidden', textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {renderRelatedValue(col, row[col.name], picklists)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Right edge: either a remove button (editable) or a chevron (nav) */}
                      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', paddingTop: 2 }}>
                        {editable ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemove(e, row) }}
                            disabled={removingId === row.id}
                            aria-label="Remove from list"
                            style={{
                              background: 'none', border: 'none',
                              color: removingId === row.id ? C.textMuted : '#b03a2e',
                              cursor: removingId === row.id ? 'wait' : 'pointer',
                              padding: 8, borderRadius: 6,
                              minWidth: 36, minHeight: 36,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" size={16} color="currentColor" />
                          </button>
                        ) : canNavigate ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2}>
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* ── Desktop table layout (unchanged) ─────────────────────── */
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {editableReorder && <th style={{ width: 28, padding: '8px 0 8px 14px' }} />}
                      {columns.map((col) => (
                        <th key={col.name} style={{
                          textAlign: 'left', padding: '8px 14px',
                          fontSize: 10, fontWeight: 600, color: C.textMuted,
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                          whiteSpace: 'nowrap',
                        }}>{col.label}</th>
                      ))}
                      {editable && <th style={{ width: 32, padding: '8px 14px 8px 0' }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((row, ri) => {
                      const isDragging = dragIndex === ri
                      const isDropTarget = dragOverIndex === ri && dragIndex !== null && dragIndex !== ri
                      return (
                        <tr
                          key={row.id || ri}
                          draggable={editableReorder}
                          onDragStart={editableReorder ? (e) => handleDragStart(e, ri) : undefined}
                          onDragOver={editableReorder ? (e) => handleDragOver(e, ri) : undefined}
                          onDragLeave={editableReorder ? handleDragLeaveRow : undefined}
                          onDragEnd={editableReorder ? handleDragEnd : undefined}
                          onDrop={editableReorder ? (e) => handleDrop(e, ri) : undefined}
                          onClick={editableReorder ? undefined : () => handleRowClick(row)}
                          onDoubleClick={() => handleRowClick(row)}
                          style={{
                            borderBottom: ri < shownRows.length - 1 ? `1px solid ${C.border}` : 'none',
                            cursor: editableReorder ? 'grab' : (canNavigate ? 'pointer' : 'default'),
                            background: isDropTarget ? '#eff6ff' : 'transparent',
                            opacity: isDragging ? 0.45 : 1,
                            transition: 'background 0.1s, opacity 0.1s',
                          }}
                          onMouseEnter={(e) => { if (!editableReorder && canNavigate) e.currentTarget.style.background = '#f7f9fc' }}
                          onMouseLeave={(e) => { if (!editableReorder) e.currentTarget.style.background = 'transparent' }}
                        >
                          {editableReorder && (
                            <td style={{ padding: '10px 0 10px 14px', width: 28, color: C.textMuted, userSelect: 'none' }}>
                              <div
                                title="Drag to reorder"
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab' }}
                              >
                                <Icon path="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" size={14} color={C.textMuted} />
                              </div>
                            </td>
                          )}
                          {columns.map((col, ci) =>
                            renderRelatedCell(col, row[col.name], picklists, {
                              isFirstCol: ci === 0,
                              canNavigate: canNavigate && !editableReorder,
                            })
                          )}
                          {editable && (
                            <td style={{ padding: '10px 14px 10px 0', width: 32, textAlign: 'right' }}>
                              <button
                                onClick={(e) => handleRemove(e, row)}
                                disabled={removingId === row.id}
                                title="Remove from list"
                                style={{
                                  background: 'none', border: 'none',
                                  color: removingId === row.id ? C.textMuted : '#b03a2e',
                                  cursor: removingId === row.id ? 'wait' : 'pointer',
                                  padding: '2px 4px', borderRadius: 4, display: 'inline-flex',
                                  alignItems: 'center', justifyContent: 'center',
                                }}
                                onMouseEnter={(e) => { if (removingId !== row.id) e.currentTarget.style.background = '#fef2f2' }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                              >
                                <Icon path="M6 18L18 6M6 6l12 12" size={13} color="currentColor" />
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {hiddenCount > 0 && (
              <div style={{
                padding: '8px 14px',
                borderTop: `1px solid ${C.border}`,
                background: '#fafbfd',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: 11.5,
              }}>
                <span style={{ color: C.textMuted }}>
                  Showing {shownRows.length} of {allRows.length}
                </span>
                <span
                  title="View All list view coming soon"
                  style={{
                    color: C.textMuted, fontStyle: 'italic',
                    cursor: 'not-allowed',
                  }}
                >
                  View All ({allRows.length}) →
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {pickerOpen && editable && pickerCfg && (
        <AddFromPoolModal
          config={config}
          parentRecordId={parentRecordId}
          onClose={() => setPickerOpen(false)}
          onAdded={handlePickerAdded}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// AddFromPoolModal — picker for an editable related list. Lists source
// records not yet linked to the parent via the junction table, searchable.
// Clicking a candidate inserts the junction row and keeps the modal open so
// the user can queue multiple adds before hitting Done.
// ---------------------------------------------------------------------------

function AddFromPoolModal({ config, parentRecordId, onClose, onAdded }) {
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [addingId, setAddingId] = useState(null)

  // Inline-create mode state ------------------------------------------------
  const [mode, setMode] = useState('pick')        // 'pick' | 'create'
  const [draft, setDraft] = useState({})
  const [picklistOpts, setPicklistOpts] = useState({})
  const [lookupOpts, setLookupOpts]     = useState({})
  const [creating, setCreating] = useState(false)
  const [formLoading, setFormLoading] = useState(false)

  const toast = useToast()
  const picker = config?.picker || {}
  const inlineCreate = picker.allow_inline_create && Array.isArray(picker.inline_create_fields)
    ? { fields: picker.inline_create_fields, title: picker.create_modal_title, buttonLabel: picker.create_button_label }
    : null

  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const c = await fetchPickerCandidates(config, parentRecordId)
      setCandidates(c)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [config, parentRecordId])

  useEffect(() => { reload() }, [reload])

  // Close on Escape. In create mode, Escape returns to pick mode first so a
  // user can back out of a half-filled form without dismissing the dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (mode === 'create') { setMode('pick'); setDraft({}) }
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, mode])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? candidates.filter(c => (c.label || '').toLowerCase().includes(q))
    : candidates

  const handleAdd = async (cand) => {
    if (addingId) return
    setAddingId(cand.id)
    try {
      await addJunctionRow(config, parentRecordId, cand.id, cand.label)
      setCandidates(prev => prev.filter(c => c.id !== cand.id))
      toast.success(`Added ${cand.label}`)
      if (onAdded) await onAdded()
    } catch (err) {
      toast.error(`Add failed — ${err.message || String(err)}`)
      reload()
    } finally {
      setAddingId(null)
    }
  }

  // Enter create mode — load picklist + lookup options for the form, and
  // pre-populate the draft with each field's `default_value` so the visual
  // state matches what will actually be submitted. Without this, boolean
  // fields with column-default true (e.g. wst_is_active) render as
  // unselected and silently submit `true` from the DB default — the form
  // and the saved row disagree, which is confusing and bug-prone.
  const enterCreateMode = async () => {
    if (!inlineCreate) return
    setMode('create')
    const initialDraft = {}
    for (const f of inlineCreate.fields) {
      if (f.default_value !== undefined) initialDraft[f.name] = f.default_value
    }
    setDraft(initialDraft)
    setFormLoading(true)
    try {
      const pickFields  = inlineCreate.fields.filter(f => f.type === 'picklist').map(f => f.name)
      const lookupFlds  = inlineCreate.fields.filter(f => f.type === 'lookup' && f.lookup_table && f.lookup_field)
      const [pOpts, lOpts] = await Promise.all([
        Promise.all(pickFields.map(fn =>
          fetchPicklistOptions(picker.source_table, fn).catch(() => []).then(v => [fn, v])
        )).then(entries => Object.fromEntries(entries)),
        Promise.all(lookupFlds.map(lf =>
          fetchLookupOptions(lf.lookup_table, lf.lookup_field).catch(() => []).then(v => [lf.name, v])
        )).then(entries => Object.fromEntries(entries)),
      ])
      setPicklistOpts(pOpts)
      setLookupOpts(lOpts)
    } finally {
      setFormLoading(false)
    }
  }

  const cancelCreate = () => { setMode('pick'); setDraft({}) }

  // Save inline-created source record, then link it to the parent junction
  const handleCreateAndLink = async () => {
    if (creating) return
    // Client-side required-field check against the configured fields list
    const missing = inlineCreate.fields
      .filter(f => f.required && (draft[f.name] == null || draft[f.name] === ''))
      .map(f => f.label || f.name)
    if (missing.length) {
      toast.error(missing.length === 1
        ? `Required: ${missing[0]}`
        : `Required fields missing:\n• ${missing.join('\n• ')}`)
      return
    }
    // Cross-field sanity validation. Build an id->label map for the
    // evidence-type picklist so the validator can read its semantic meaning
    // (e.g. "Photo" implies Photos Required > 0).
    const evidenceLabelById = new Map(
      (picklistOpts.wst_required_evidence_type_id || []).map(o => [o.value, o.label])
    )
    const sanityErrors = validateBeforeSave(picker.source_table, draft, evidenceLabelById)
    if (sanityErrors.length) {
      toast.error(sanityErrors.length === 1
        ? sanityErrors[0]
        : `Cannot save:\n• ${sanityErrors.join('\n• ')}`)
      return
    }
    setCreating(true)
    try {
      const userId = await getCurrentUserId()
      const fields = applyInsertDefaults(picker.source_table, { ...draft }, userId)
      for (const [k, v] of Object.entries(fields)) if (v === '') fields[k] = null

      const created = await insertRecord(picker.source_table, fields)

      // Auto-link the new record to the parent junction so the user doesn't
      // have to find and click it in the picker afterwards.
      const labelField = picker.source_label_field
      const sourceLabel = (labelField && created?.[labelField]) || created?.id?.slice(0, 8) || ''
      await addJunctionRow(config, parentRecordId, created.id, sourceLabel)

      toast.success(`Created and added ${sourceLabel}`)
      if (onAdded) await onAdded()
      onClose()
    } catch (err) {
      toast.error(`Create failed — ${err.message || String(err)}`)
    } finally {
      setCreating(false)
    }
  }

  const onDraftChange = (name, value) => setDraft(prev => ({ ...prev, [name]: value }))

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(13,26,46,0.48)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.card, borderRadius: 10, maxWidth: 560, width: '100%',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.22)',
        }}
      >
        {/* Modal header */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode === 'create' && (
              <button
                onClick={cancelCreate}
                title="Back to picker"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#eef2f7' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <Icon path="M15 19l-7-7 7-7" size={14} color={C.textMuted} />
              </button>
            )}
            {mode === 'create'
              ? (inlineCreate?.title || 'New Record')
              : (picker.modal_title || 'Add Record')}
          </div>
          <button
            onClick={onClose}
            title="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, borderRadius: 4, display: 'flex',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#eef2f7' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <Icon path="M6 18L18 6M6 6l12 12" size={14} color={C.textMuted} />
          </button>
        </div>

        {/* ─── PICK MODE ───────────────────────────────────────────── */}
        {mode === 'pick' && (
          <>
            {/* Search bar + optional "+ New" button */}
            <div style={{
              padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                style={{
                  flex: 1, padding: '7px 10px', fontSize: 13,
                  border: `1px solid ${C.border}`, borderRadius: 5, outline: 'none',
                  boxSizing: 'border-box', fontFamily: 'Inter, sans-serif',
                  color: C.textPrimary,
                }}
              />
              {inlineCreate && (
                <button
                  onClick={enterCreateMode}
                  style={{
                    background: C.card, color: C.textPrimary,
                    border: `1px solid ${C.border}`, borderRadius: 5,
                    padding: '7px 12px', fontSize: 12.5, fontWeight: 500,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f7f9fc'; e.currentTarget.style.borderColor = C.emerald }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = C.card; e.currentTarget.style.borderColor = C.border }}
                >
                  <Icon path="M12 4v16m8-8H4" size={12} color={C.emerald} />
                  {inlineCreate.buttonLabel || 'New'}
                </button>
              )}
            </div>

            {/* Candidate list */}
            <div style={{ flex: 1, overflow: 'auto', minHeight: 160 }}>
              {loading && (
                <div style={{ padding: 20, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                  Loading…
                </div>
              )}
              {error && !loading && (
                <div style={{ padding: 20, textAlign: 'center', color: '#b03a2e', fontSize: 12.5 }}>
                  Could not load candidates — {String(error.message || error)}
                </div>
              )}
              {!loading && !error && filtered.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                  {candidates.length === 0
                    ? 'All available records are already linked to this record.'
                    : 'No matches for your search.'}
                  {inlineCreate && candidates.length === 0 && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        onClick={enterCreateMode}
                        style={{
                          background: C.emerald, color: '#fff', border: 'none', borderRadius: 6,
                          padding: '6px 14px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#2aab72' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = C.emerald }}
                      >
                        {inlineCreate.buttonLabel || 'New'}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {!loading && !error && filtered.map(c => {
                const isAdding = addingId === c.id
                const otherBusy = addingId !== null && !isAdding
                return (
                  <div
                    key={c.id}
                    onClick={() => handleAdd(c)}
                    style={{
                      padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
                      fontSize: 13, color: C.textPrimary,
                      cursor: addingId ? 'wait' : 'pointer',
                      opacity: otherBusy ? 0.5 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'transparent', transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { if (!addingId) e.currentTarget.style.background = '#f7f9fc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.label}
                    </span>
                    {isAdding ? (
                      <span style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>
                        Adding…
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: '#1a5a8a', fontWeight: 500 }}>
                        Add →
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Footer — Done closes the modal */}
            <div style={{
              padding: '10px 16px', borderTop: `1px solid ${C.border}`,
              background: '#fafbfd', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 11.5, color: C.textMuted }}>
                {loading ? '' : `${filtered.length} available`}
              </span>
              <button
                onClick={onClose}
                style={{
                  background: C.emerald, color: '#fff', border: 'none', borderRadius: 6,
                  padding: '6px 14px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#2aab72' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.emerald }}
              >
                Done
              </button>
            </div>
          </>
        )}

        {/* ─── CREATE MODE ─────────────────────────────────────────── */}
        {mode === 'create' && inlineCreate && (
          <>
            <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
              {formLoading && (
                <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 13, padding: 12 }}>
                  Loading form…
                </div>
              )}
              {!formLoading && inlineCreate.fields.map(f => (
                <div key={f.name} style={{ marginBottom: 14 }}>
                  <label style={{
                    display: 'block', fontSize: 11.5, fontWeight: 500,
                    color: C.textSecondary, marginBottom: 4,
                    textTransform: 'uppercase', letterSpacing: '0.03em',
                  }}>
                    {f.label || f.name}
                    {f.required && <span style={{ color: '#c0392b', marginLeft: 3 }}>*</span>}
                  </label>
                  <EditField
                    field={f}
                    value={draft[f.name]}
                    onChange={onDraftChange}
                    picklistOpts={picklistOpts[f.name]}
                    lookupOpts={lookupOpts[f.name]}
                  />
                </div>
              ))}
            </div>

            <div style={{
              padding: '10px 16px', borderTop: `1px solid ${C.border}`,
              background: '#fafbfd', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
            }}>
              <button
                onClick={cancelCreate}
                disabled={creating}
                style={{
                  background: C.card, color: C.textPrimary,
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '6px 14px', fontSize: 12.5, fontWeight: 500,
                  cursor: creating ? 'wait' : 'pointer', opacity: creating ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAndLink}
                disabled={creating || formLoading}
                style={{
                  background: C.emerald, color: '#fff', border: 'none', borderRadius: 6,
                  padding: '6px 14px', fontSize: 12.5, fontWeight: 500,
                  cursor: creating ? 'wait' : 'pointer', opacity: creating || formLoading ? 0.7 : 1,
                }}
                onMouseEnter={(e) => { if (!creating && !formLoading) e.currentTarget.style.background = '#2aab72' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.emerald }}
              >
                {creating ? 'Saving…' : 'Save and Add'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function Section({ section, record, picklists, lookups, editing, draft, onChange, allPicklistOpts, allLookupOpts, tableName }) {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(section.section_is_collapsed_by_default || false)
  // Only render field_group widgets inside a section. Related lists are
  // rendered as their own standalone cards outside sections.
  const fieldGroupWidgets = (section.widgets || []).filter(w => w.widget_type === 'field_group')
  if (fieldGroupWidgets.length === 0) return null
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: isMobile ? 10 : 12, overflow: 'hidden' }}>
      <div onClick={() => section.section_is_collapsible && setCollapsed(c => !c)}
        style={{ padding: isMobile ? '12px 14px' : '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: section.section_is_collapsible ? 'pointer' : 'default', borderBottom: collapsed ? 'none' : `1px solid ${C.border}`, background: '#fafbfd' }}>
        <span style={{ fontSize: isMobile ? 14 : 13, fontWeight: 600, color: C.textPrimary }}>{section.section_label}</span>
        {section.section_is_collapsible && <Icon path={collapsed ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'} size={14} color={C.textMuted} />}
      </div>
      {!collapsed && fieldGroupWidgets.map(w => (
        <FieldGroupWidget key={w.id} widget={w} record={record} picklists={picklists} lookups={lookups}
          editing={editing} draft={draft} onChange={onChange} allPicklistOpts={allPicklistOpts} allLookupOpts={allLookupOpts} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RecordDetail — main component
// ---------------------------------------------------------------------------

export default function RecordDetail({ tableName, recordId, onBack, mode = 'view', onRecordCreated, onNavigateToRecord, prefill }) {
  const isCreate = mode === 'create'
  const toast = useToast()
  const isMobile = useIsMobile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(isCreate)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [allPicklistOpts, setAllPicklistOpts] = useState({})
  const [allLookupOpts, setAllLookupOpts] = useState({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Which tab is active on the record detail page. Null until data loads,
  // then initialized to the first tab (Details) by the useEffect below.
  const [activeTab, setActiveTab] = useState(null)
  // When non-null, we are cloning the current record: same table, insert path,
  // draft pre-populated from the source.
  const [cloneSource, setCloneSource] = useState(null)
  const isInsertMode = isCreate || cloneSource !== null

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)

    if (isCreate) {
      // Create mode: fetch layout + picklists only, no record
      Promise.all([fetchPageLayout(tableName), loadAllPicklists()])
        .then(([layoutData, picklists]) => {
          if (cancelled) return
          setData({
            record: {},
            layout: layoutData?.layout || null,
            sections: layoutData?.sections || [],
            picklists,
            lookups: new Map(),
          })
          setDraft(prefill ? { ...prefill } : {})
          setEditing(true)
          // Pre-load picklist + lookup options
          if (layoutData?.sections) {
            loadAllEditOpts(layoutData.sections)
          }
        })
        .catch(err => { if (!cancelled) setError(err) })
        .finally(() => { if (!cancelled) setLoading(false) })
    } else {
      // View mode: fetch everything
      setEditing(false)
      loadRecordDetailData(tableName, recordId)
        .then(d => { if (!cancelled) setData(d) })
        .catch(err => { if (!cancelled) setError(err) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    return () => { cancelled = true }
  }, [tableName, recordId, isCreate])

  // When data first loads (or when the loaded record changes tables),
  // pick the first tab as active. Only initializes — does not override
  // user selection.
  useEffect(() => {
    if (!data?.sections) return
    if (activeTab !== null) return
    const tabs = buildOrderedTabs(data.sections)
    if (tabs.length > 0) setActiveTab(tabs[0])
  }, [data, activeTab])

  // Reset active tab when switching records so the new record opens on
  // its first tab rather than inheriting the previous record's selection.
  useEffect(() => {
    setActiveTab(null)
  }, [tableName, recordId])

  const loadAllEditOpts = useCallback(async (sections) => {
    const pickFields = []
    const lookupFields = []
    for (const s of sections) for (const w of s.widgets)
      if (w.widget_type === 'field_group' && w.widget_config?.fields)
        for (const f of w.widget_config.fields) {
          if (f.type === 'picklist') pickFields.push(f.name)
          if (f.type === 'lookup' && f.lookup_table && f.lookup_field)
            lookupFields.push({ name: f.name, table: f.lookup_table, field: f.lookup_field })
        }

    // Fetch picklist options
    if (pickFields.length) {
      const opts = {}
      await Promise.all(pickFields.map(async fn => {
        try { opts[fn] = await fetchPicklistOptions(tableName, fn) } catch { opts[fn] = [] }
      }))
      setAllPicklistOpts(opts)
    }

    // Fetch lookup options
    if (lookupFields.length) {
      const opts = {}
      await Promise.all(lookupFields.map(async lf => {
        try { opts[lf.name] = await fetchLookupOptions(lf.table, lf.field) } catch { opts[lf.name] = [] }
      }))
      setAllLookupOpts(opts)
    }
  }, [tableName])

  const startEditing = () => {
    if (!data?.record) return
    setDraft({ ...data.record }); setEditing(true)
    if (data.sections) loadAllEditOpts(data.sections)
  }
  const cancelEditing = () => {
    if (isCreate) { onBack(); return }
    if (cloneSource) { setCloneSource(null); setEditing(false); setDraft({}); return }
    setEditing(false); setDraft({})
  }
  const handleFieldChange = (name, value) => setDraft(prev => ({ ...prev, [name]: value }))

  // Clone: strip system fields, append " (Copy)" to visible name fields,
  // enter insert-mode so Save inserts a brand-new record in the same table.
  const handleClone = useCallback(() => {
    if (!data?.record) return
    const seed = { ...data.record }
    for (const k of Object.keys(seed)) {
      if (
        k === 'id' ||
        k === 'is_deleted' ||
        k === 'created_at' || k === 'updated_at' ||
        k === 'created_by' || k === 'updated_by' ||
        k.endsWith('_created_at') || k.endsWith('_created_by') ||
        k.endsWith('_updated_at') || k.endsWith('_updated_by') ||
        k.endsWith('_is_deleted') ||
        k.endsWith('_record_number')
      ) delete seed[k]
    }
    // Make it obvious this is a copy by default
    for (const k of Object.keys(seed)) {
      if (k.endsWith('_name') && typeof seed[k] === 'string' && seed[k]) {
        seed[k] = `${seed[k]} (Copy)`
      }
    }
    setCloneSource({ sourceId: recordId, sourceName: data.record?.contact_name
      || data.record?.property_name || data.record?.opportunity_name
      || data.record?.work_order_name || data.record?.project_name
      || data.record?.name || 'record' })
    setDraft(seed)
    if (data.sections) loadAllEditOpts(data.sections)
    setEditing(true)
  }, [data, recordId, loadAllEditOpts])

  const handleSave = async () => {
    setSaving(true)

    if (isInsertMode) {
      // INSERT path — runs for true create and for clone
      try {
        const userId = await getCurrentUserId()
        const fields = applyInsertDefaults(tableName, { ...draft }, userId)

        // Strip empty string values (convert to null)
        for (const [k, v] of Object.entries(fields)) {
          if (v === '') fields[k] = null
        }

        // Validate required fields *after* auto-fill so we don't flag
        // system fields the user never saw.
        const meta = await fetchTableMetadata(tableName)
        const labelMap = buildLabelMap(data?.sections)
        const missing = findMissingRequired(meta.required_fields, fields, labelMap)
        if (missing.length) {
          toast.error(
            missing.length === 1
              ? `Required field missing: ${missing[0]}`
              : `Required fields missing:\n• ${missing.join('\n• ')}`
          )
          setSaving(false)
          return
        }

        // Cross-field sanity validation (lightweight, table-aware)
        const sanityErrors = validateBeforeSave(tableName, fields, data?.picklists?.byId)
        if (sanityErrors.length) {
          toast.error(sanityErrors.length === 1
            ? sanityErrors[0]
            : `Cannot save:\n• ${sanityErrors.join('\n• ')}`)
          setSaving(false)
          return
        }

        const created = await insertRecord(tableName, fields)
        toast.success(cloneSource ? 'Clone created' : 'Record created')

        if (onRecordCreated) {
          onRecordCreated({ table: tableName, id: created.id })
        } else if (onNavigateToRecord) {
          onNavigateToRecord({ table: tableName, id: created.id })
        } else {
          onBack()
        }
      } catch (err) {
        toast.error(`${cloneSource ? 'Clone' : 'Create'} failed — ${err.message || String(err)}`)
      } finally {
        setSaving(false)
      }
      return
    }

    // UPDATE mode: compute diff and save only changed fields
    const changes = {}
    for (const [k, v] of Object.entries(draft)) if (v !== data.record[k]) changes[k] = v
    for (const sys of ['id','created_at','updated_at']) delete changes[sys]
    for (const k of Object.keys(changes)) {
      if (k.endsWith('_created_at') || k.endsWith('_created_by') || k.endsWith('_updated_at') || k.endsWith('_updated_by') || k.endsWith('_is_deleted')) delete changes[k]
    }
    if (!Object.keys(changes).length) { setEditing(false); setSaving(false); return }

    // Normalise empty strings to null before validation + save
    for (const [k, v] of Object.entries(changes)) {
      if (v === '') changes[k] = null
    }

    try {
      // Validate against the merged view — existing record with pending changes applied
      const meta = await fetchTableMetadata(tableName)
      const labelMap = buildLabelMap(data?.sections)
      const merged = { ...data.record, ...changes }
      const missing = findMissingRequired(meta.required_fields, merged, labelMap)
      if (missing.length) {
        toast.error(
          missing.length === 1
            ? `Required field missing: ${missing[0]}`
            : `Required fields missing:\n• ${missing.join('\n• ')}`
        )
        setSaving(false)
        return
      }

      // Cross-field sanity validation against merged view
      const sanityErrors = validateBeforeSave(tableName, merged, data?.picklists?.byId)
      if (sanityErrors.length) {
        toast.error(sanityErrors.length === 1
          ? sanityErrors[0]
          : `Cannot save:\n• ${sanityErrors.join('\n• ')}`)
        setSaving(false)
        return
      }

      const updated = await saveRecord(tableName, recordId, changes)
      setData(prev => ({ ...prev, record: updated }))
      setEditing(false); setDraft({})
      toast.success('Changes saved')
    } catch (err) {
      toast.error(`Save failed — ${err.message || String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteRecord(tableName, recordId)
      toast.success('Moved to recycle bin')
      setShowDeleteConfirm(false)
      onBack()
    } catch (err) {
      toast.error(`Delete failed — ${err.message || String(err)}`)
      setDeleting(false)
    }
  }

  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted, fontSize: 13 }}>Loading record…</div>
  if (error) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
      <div style={{ color: '#b03a2e', fontSize: 14, fontWeight: 600 }}>Error loading record</div>
      <div style={{ color: C.textMuted, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', maxWidth: 560, textAlign: 'center' }}>{String(error.message || error)}</div>
      <button onClick={onBack} style={{ marginTop: 8, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 16px', fontSize: 12, color: C.textSecondary, cursor: 'pointer' }}>Back to List</button>
    </div>
  )

  const { record, layout, sections, picklists, lookups } = data

  // Build the ordered tab list from the loaded sections. Details first,
  // Related second (if any section has related_list widgets), alphabetical after.
  const orderedTabs = buildOrderedTabs(sections)

  const objectLabel = TABLE_META[tableName]?.label || tableName
  const displayName = isCreate
    ? `New ${objectLabel.replace(/s$/, '')}`
    : (record.contact_first_name
        ? `${record.contact_first_name} ${record.contact_last_name || ''}`.trim()
        : record.property_name || record.opportunity_name || record.work_order_name || record.project_name
          || record.building_name || record.unit_name || record.vehicle_name || record.technician_name
          || record.product_name || record.equipment_name || record.name || 'Record')

  const recordNumber = record.contact_record_number || record.property_record_number
    || record.opportunity_record_number || record.work_order_record_number || record.project_record_number
    || record.building_record_number || record.vehicle_record_number || record.technician_record_number
    || record.product_record_number || record.equipment_record_number
    || record.id?.slice(0, 8).toUpperCase() || ''

  const statusRaw = record.contact_status || record.property_status || record.opportunity_status
    || record.work_order_status || record.project_status || record.building_status
    || record.vehicle_status || record.technician_status
  const statusLabel = statusRaw ? (picklists.byId.get(statusRaw) || statusRaw) : null

  if (!layout) return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      padding: isMobile ? '12px' : '20px 24px',
      paddingBottom: isMobile ? 'calc(12px + env(safe-area-inset-bottom))' : '20px',
    }}>
      {!isMobile && <Breadcrumbs tableName={tableName} record={record} lookups={lookups} onBack={onBack} />}
      {isMobile && (
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none', padding: '6px 0',
            color: '#1a5a8a', fontSize: 13, cursor: 'pointer', marginBottom: 10,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      )}
      <h1 style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: C.textPrimary, margin: '0 0 16px' }}>{displayName}</h1>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>No page layout configured for "{tableName}". Showing raw fields.</div>
        {Object.entries(record).filter(([k]) => !k.endsWith('_is_deleted') && k !== 'id').map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, gap: 16 }}>
            <span style={{ color: C.textMuted, fontSize: 12, flexShrink: 0 }}>{k}</span>
            <span style={{ color: C.textPrimary, fontSize: 12, textAlign: 'right', wordBreak: 'break-all' }}>{v != null ? String(v) : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )

  // Tracks whether the main edit action bar is "busy" — used to gate taps on mobile sticky bar.
  const editActionsDisabled = saving || deleting

  return (
    <div style={{
      flex: 1,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
    }}>
      {/* Sticky mobile header bar — back button + record number + icon actions.
          Replaces desktop breadcrumbs and the large header card's action row. */}
      {isMobile && (
        <div style={{
          flexShrink: 0, background: C.card, borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '6px 4px 6px 0', minHeight: 52,
        }}>
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              background: 'transparent', border: 'none', padding: 10,
              borderRadius: 6, cursor: 'pointer', color: C.textPrimary,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 44, minHeight: 44, flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0 }}>
            {recordNumber && (
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {editing && cloneSource ? `Cloning ${recordNumber}` : editing ? `Editing ${recordNumber}` : recordNumber}
              </div>
            )}
            <div style={{
              fontSize: 15, fontWeight: 600, color: C.textPrimary, lineHeight: 1.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {displayName}
            </div>
          </div>

          {/* Right-side actions — compact icon buttons. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, paddingRight: 6 }}>
            {editing ? (
              <button
                onClick={cancelEditing}
                disabled={saving}
                aria-label="Cancel editing"
                title="Cancel"
                style={{
                  background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                  cursor: saving ? 'wait' : 'pointer', color: C.textSecondary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 44, minHeight: 44,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            ) : (
              <>
                <button
                  onClick={startEditing}
                  aria-label="Edit"
                  title="Edit"
                  style={{
                    background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                    cursor: 'pointer', color: C.emerald,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 44, minHeight: 44,
                  }}
                >
                  <Icon path="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" size={18} color="currentColor" />
                </button>
                <button
                  onClick={handleClone}
                  aria-label="Clone"
                  title="Clone"
                  style={{
                    background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                    cursor: 'pointer', color: C.textSecondary,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 44, minHeight: 44,
                  }}
                >
                  <Icon path="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" size={18} color="currentColor" />
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  aria-label="Delete"
                  title="Delete"
                  style={{
                    background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                    cursor: 'pointer', color: '#b03a2e',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 44, minHeight: 44,
                  }}
                >
                  <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" size={18} color="currentColor" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Scrollable content region */}
      <div style={{
        flex: 1, overflow: 'auto', minHeight: 0,
        padding: isMobile ? '10px 10px' : '20px 24px',
        paddingBottom: isMobile && editing ? 'calc(80px + env(safe-area-inset-bottom))' : isMobile ? 'calc(24px + env(safe-area-inset-bottom))' : undefined,
      }}>
        {/* Desktop breadcrumbs (hidden on mobile — the sticky header handles back navigation) */}
        {!isMobile && <Breadcrumbs tableName={tableName} record={record} lookups={lookups} onBack={onBack} />}

        {/* Desktop header card (mobile already shows this info in the sticky bar above — mobile shows a compact title + status chip instead) */}
        {!isMobile ? (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '20px 24px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{recordNumber}</div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, margin: '0 0 8px' }}>{displayName}</h1>
              {statusLabel && <Badge s={statusLabel} />}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {editing ? (<>
                <button onClick={handleSave} disabled={saving} style={{ background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12.5, fontWeight: 500, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Icon path="M5 13l4 4L19 7" size={13} color="#fff" />{saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={cancelEditing} disabled={saving} style={{ background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
              </>) : (<>
                <button onClick={startEditing} style={{ background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>Edit</button>
                <button
                  onClick={handleClone}
                  title="Create a new record seeded from this one"
                  style={{ background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#eef2f7' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = C.page }}
                >
                  <Icon path="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" size={13} color={C.textSecondary} />
                  Clone
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  title="Move to recycle bin"
                  style={{
                    background: C.page, color: '#b03a2e',
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    padding: '7px 12px', fontSize: 12.5, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.borderColor = '#fca5a5' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = C.page; e.currentTarget.style.borderColor = C.border }}
                >
                  <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" size={13} color="#b03a2e" />
                  Delete
                </button>
              </>)}
            </div>
          </div>
        ) : (
          /* Mobile status chip row — shown only when there's a status to display */
          statusLabel && (
            <div style={{ marginBottom: 10 }}>
              <Badge s={statusLabel} />
            </div>
          )
        )}

        {/* Editing / cloning indicator — hidden on mobile (sticky bottom bar makes state obvious) */}
        {!isMobile && editing && cloneSource && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon path="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" size={14} color="#1e40af" />
            Cloning <strong>{cloneSource.sourceName}</strong> — modify the copy and Save to create a new record.
          </div>
        )}
        {!isMobile && editing && !cloneSource && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon path="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" size={14} color="#166534" />
            Editing mode — modify fields and click Save.
          </div>
        )}

        {/* Timestamps (view mode only, hidden on mobile to reduce clutter) */}
        {!editing && !isMobile && (
          <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 11, color: C.textMuted }}>
            {(record.created_at || record.contact_created_at || record.property_created_at || record.opportunity_created_at || record.work_order_created_at || record.project_created_at) && (
              <span>Created {new Date(record.created_at || record.contact_created_at || record.property_created_at || record.opportunity_created_at || record.work_order_created_at || record.project_created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            )}
          </div>
        )}

        {/* Tab bar — only shown when there's more than one tab. Styled to
            match SectionTabs in UI.jsx: bottom border, 2px emerald underline
            on the active tab. On mobile, horizontally scrolls with snap. */}
        {orderedTabs.length > 1 && (
          <div
            className={isMobile ? 'anura-hscroll' : ''}
            style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: isMobile ? '0 4px' : '0 16px',
              marginBottom: isMobile ? 10 : 16,
              display: 'flex', alignItems: 'center',
              ...(isMobile ? { scrollSnapType: 'x proximity' } : {}),
            }}
          >
            {orderedTabs.map(t => {
              const on = t === activeTab
              return (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  style={{
                    padding: isMobile ? '12px 14px' : '10px 16px', background: 'none', border: 'none',
                    borderBottom: on ? `2px solid ${C.emerald}` : '2px solid transparent',
                    color: on ? C.textPrimary : C.textMuted, fontSize: isMobile ? 14 : 13,
                    fontWeight: on ? 500 : 400, cursor: 'pointer', marginBottom: -1,
                    display: 'flex', alignItems: 'center', gap: 6,
                    whiteSpace: 'nowrap', flexShrink: 0,
                    ...(isMobile ? { scrollSnapAlign: 'start' } : {}),
                  }}
                >
                  {t}
                </button>
              )
            })}
          </div>
        )}

        {/* Sections — field groups only. Filter by active tab. */}
        {sections
          .filter(sec => (sec.section_tab || 'Details') === activeTab)
          .map(sec => (
            <Section key={sec.id} section={sec} record={record} picklists={picklists} lookups={lookups}
              editing={editing} draft={draft} onChange={handleFieldChange}
              allPicklistOpts={allPicklistOpts} allLookupOpts={allLookupOpts} tableName={tableName} />
          ))}

        {/* Related lists — standalone Salesforce-style cards, shown only on
            the Related tab regardless of which section they came from. */}
        {!isInsertMode && activeTab === 'Related' && sections
          .flatMap(sec => (sec.widgets || []).filter(w => w.widget_type === 'related_list'))
          .map(w => (
            <RelatedListWidget
              key={w.id}
              widget={w}
              picklists={picklists}
              onNavigateToRecord={onNavigateToRecord}
              parentRecordId={recordId}
              onRefreshRelated={async () => {
                try {
                  const rows = await fetchRelatedRecords(w.widget_config, recordId)
                  // Mutate the widget's cached data in place, then nudge
                  // React with a top-level data clone so the widget re-reads.
                  w._relatedData = rows
                  setData(prev => ({ ...prev }))
                } catch (err) {
                  // Non-fatal — widget will keep showing its previous rows.
                  // eslint-disable-next-line no-console
                  console.error('Related list refresh failed', err)
                }
              }}
            />
          ))}
      </div>

      {/* Sticky bottom action bar — mobile edit mode only. Always visible,
          safe-area-padded so it clears the iOS home indicator. */}
      {isMobile && editing && (
        <div style={{
          flexShrink: 0, background: C.card, borderTop: `1px solid ${C.border}`,
          padding: '10px 14px calc(10px + env(safe-area-inset-bottom)) 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 -4px 12px rgba(13, 26, 46, 0.05)',
        }}>
          <button
            onClick={cancelEditing}
            disabled={editActionsDisabled}
            style={{
              flex: 1, background: C.page, color: C.textSecondary,
              border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '12px 16px', fontSize: 15, fontWeight: 500,
              cursor: editActionsDisabled ? 'wait' : 'pointer', minHeight: 48,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={editActionsDisabled}
            style={{
              flex: 2, background: C.emerald, color: '#fff',
              border: 'none', borderRadius: 8,
              padding: '12px 16px', fontSize: 15, fontWeight: 600,
              cursor: editActionsDisabled ? 'wait' : 'pointer',
              opacity: editActionsDisabled ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              minHeight: 48,
            }}
          >
            <Icon path="M5 13l4 4L19 7" size={16} color="#fff" />
            {saving ? 'Saving…' : (cloneSource ? 'Save as New' : (isCreate ? 'Create' : 'Save'))}
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <DeleteConfirmModal
          objectLabel={objectLabel}
          recordName={displayName}
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}
