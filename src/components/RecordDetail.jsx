import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../data/constants'
import { Badge, Icon } from './UI'
import ProjectReportModal from './ProjectReportModal'
import SendForSignatureModal from './SendForSignatureModal'
import { useToast } from './Toast'
import { useIsMobile } from '../lib/useMediaQuery'
import ActivityTimeline from './ActivityTimeline'
import FileGalleryWidget from './FileGallery'
import { supabase } from '../lib/supabase'
import { getSectionConfigSchema, buildDefaultConfig } from '../data/sectionConfigSchemas'
import { getSectionFilterSchema } from '../data/sectionFilterSchemas'
import { MERGE_FIELD_OBJECTS, loadFieldsForObject } from '../data/mergeFieldCatalog'
import {
  uploadDocumentTemplateAsset,
  signedDocumentTemplateAssetUrl,
  copyDocumentTemplateAsset,
} from '../data/storageService'
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
  getRecordTypeValue,
} from '../data/layoutService'

// ---------------------------------------------------------------------------
// Template lifecycle registry
// ---------------------------------------------------------------------------
// Tables that participate in the Energy Efficiency Services "Builder template" lifecycle (Draft →
// Active → Archived) all share the same publish / unpublish / archive /
// restore / clone workflow. The DB triggers and RPCs are nearly identical
// per-object — only the column prefix and RPC argument names change. This
// registry lets RecordDetail render the same lifecycle UI for every such
// table without per-table conditionals scattered through the component.
//
// To onboard another lifecycle-bearing table, add an entry here and ensure
// the matching RPCs + lock trigger + status picklist exist server-side.
const TEMPLATE_LIFECYCLES = {
  project_report_templates: {
    statusColumn:        'prt_status',
    nameColumn:          'prt_name',
    recordNumberColumn:  'prt_record_number',
    rpcIdParam:          'p_prt_id',
    cloneIdParam:        'p_source_prt_id',
    publishRpc:          'publish_project_report_template',
    unpublishRpc:        'unpublish_project_report_template',
    archiveRpc:          'archive_project_report_template',
    restoreRpc:          'restore_project_report_template',
    cloneRpc:            'clone_project_report_template',
    childrenTable:       'project_report_template_sections',
    childrenLabel:       'sections',
  },
  email_templates: {
    statusColumn:        'status',
    nameColumn:          'name',
    recordNumberColumn:  'et_record_number',
    rpcIdParam:          'p_email_template_id',
    cloneIdParam:        'p_source_email_template_id',
    publishRpc:          'publish_email_template',
    unpublishRpc:        'unpublish_email_template',
    archiveRpc:          'archive_email_template',
    restoreRpc:          'restore_email_template',
    cloneRpc:            'clone_email_template',
    childrenTable:       null,
    childrenLabel:       null,
  },
  document_templates: {
    statusColumn:        'status',
    nameColumn:          'name',
    recordNumberColumn:  'dt_record_number',
    rpcIdParam:          'p_document_template_id',
    cloneIdParam:        'p_source_document_template_id',
    publishRpc:          'publish_document_template',
    unpublishRpc:        'unpublish_document_template',
    archiveRpc:          'archive_document_template',
    restoreRpc:          'restore_document_template',
    cloneRpc:            'clone_document_template',
    childrenTable:       null,
    childrenLabel:       null,
  },
}

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
    case 'json':       return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
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
  accounts:                  { module: 'Outreach',       label: 'Accounts',             parents: ['parent_account_id'] },
  contacts:                  { module: 'Outreach',       label: 'Contacts',             parents: ['contact_account_id'] },
  account_contact_relations: { module: 'Outreach',       label: 'Account Contact Roles', parents: ['account_id', 'contact_id'] },
  properties:                { module: 'Outreach',       label: 'Properties',           parents: ['property_account_id'] },
  buildings:                 { module: 'Outreach',       label: 'Buildings',            parents: ['property_id'] },
  units:                     { module: 'Outreach',       label: 'Units',                parents: ['building_id', 'property_id'] },
  opportunities:             { module: 'Outreach',       label: 'Opportunities',        parents: ['property_id', 'opportunity_account_id'] },
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
  skills:                    { module: 'People',         label: 'Skills',               parents: [] },
  contact_skills:            { module: 'People',         label: 'Contact Skills',       parents: ['contact_id', 'skill_id'] },
  work_type_skill_requirements: { module: 'Admin',       label: 'Skill Requirements',   parents: ['work_type_id', 'skill_id'] },
  time_sheets:               { module: 'People',         label: 'Time Sheets',          parents: ['contact_id'] },
  programs:                  { module: 'Admin',          label: 'Programs',             parents: [] },
  work_types:                { module: 'Admin',          label: 'Work Types',           parents: [] },
  email_templates:           { module: 'Admin',          label: 'Email Templates',      parents: [] },
  document_templates:        { module: 'Admin',          label: 'Document Templates',   parents: [] },
  automation_rules:          { module: 'Admin',          label: 'Automation Rules',     parents: [] },
  validation_rules:          { module: 'Admin',          label: 'Validation Rules',     parents: [] },
  roles:                     { module: 'Admin',          label: 'Roles',                parents: [] },
  picklist_values:           { module: 'Admin',          label: 'Picklist Values',      parents: [] },
  portal_users:              { module: 'Portal',         label: 'Portal Users',         parents: ['portal_user_account_id'] },
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
  'building_', 'unit_', 'assessment_', 'vehicle_', 'va_', 'account_',
  'product_item_', 'product_', 'equipment_', 'ia_', 'ppr_', 'user_',
  'skill_', 'cs_', 'acr_', 'wtsr_', 'mr_',
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
// Details first, Related second (if any section has related_list or
// file_gallery widgets), Activity third (always shown on existing records),
// then any custom tabs alphabetical after.
function buildOrderedTabs(sections, { includeActivity = true } = {}) {
  const names = new Set()
  let hasRelated = false
  for (const sec of sections || []) {
    names.add(sec.section_tab || 'Details')
    if ((sec.widgets || []).some(w => w.widget_type === 'related_list' || w.widget_type === 'file_gallery' || w.widget_type === 'prtsn_history')) {
      hasRelated = true
    }
  }
  if (hasRelated) names.add('Related')
  if (includeActivity) names.add('Activity')
  const rank = (t) => t === 'Details' ? 0 : t === 'Related' ? 1 : t === 'Activity' ? 2 : 3
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
// VoidEnvelopeModal — confirmation modal for the Void action on an envelope
// record. Differs from DeleteConfirmModal in that it requires a free-text
// reason (not optional) which gets passed to void_envelope() and persisted on
// the Voided envelope_event for audit. The button stays disabled until the
// reason has at least 3 non-whitespace characters.
// ---------------------------------------------------------------------------
function VoidEnvelopeModal({ envelopeRecordNumber, onConfirm, onCancel, busy }) {
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()
  const canSubmit = trimmed.length >= 3 && !busy
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, borderRadius: 10, padding: 26, width: 460,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon path="M18.36 5.64a9 9 0 1 1-12.72 0M5.64 5.64l12.72 12.72"
              size={15} color="#b45309" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Void envelope {envelopeRecordNumber}?
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
              This invalidates all outstanding signing links and moves the envelope to <strong>Voided</strong> status.
              Recipients who haven't signed yet will get an expired-link error if they try to use their email.
              The reason is recorded on the audit trail.
            </div>
          </div>
        </div>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>
          Reason for voiding (required)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          autoFocus
          rows={3}
          placeholder="e.g. Replaced by a corrected envelope; recipient asked to start over."
          style={{
            width: '100%', boxSizing: 'border-box',
            border: `1px solid ${C.border}`, borderRadius: 6,
            padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
            color: C.textPrimary, background: busy ? '#f3f4f6' : '#fff',
            resize: 'vertical', minHeight: 70,
          }}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            onClick={() => canSubmit && onConfirm(trimmed)}
            disabled={!canSubmit}
            style={{
              flex: 1,
              background: canSubmit ? '#b45309' : '#d4a574',
              color: '#fff', border: 'none', borderRadius: 6,
              padding: '9px 0', fontSize: 13, fontWeight: 600,
              cursor: canSubmit ? 'pointer' : (busy ? 'wait' : 'not-allowed'),
              opacity: canSubmit ? 1 : 0.8,
            }}
          >
            {busy ? 'Voiding…' : 'Void Envelope'}
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

    case 'merge_textarea':
      return <MergeFieldTextarea value={v} onChange={(next) => onChange(field.name, next)} />

    case 'docx_upload':
      // Edit-mode rendering: needs the parent record id (for uploads) and a
      // refresh callback. Both are threaded in via a separate component path
      // — this case is unreachable today because FieldGroupWidget short-
      // circuits docx_upload before EditField is consulted. Falling back to
      // a read-only string keeps the dispatcher exhaustive.
      return <span style={{ fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>—</span>

    case 'json':
      return <JsonField value={value} onChange={(parsed) => onChange(field.name, parsed)} />

    default:
      return <input type="text" style={inputBase} value={v} onChange={e => onChange(field.name, e.target.value)} />
  }
}

// JsonField — textarea bound to a JSON value. Stores the raw text locally so
// users can type intermediate (invalid) states without us clobbering the
// draft, but only forwards a parsed object to the parent draft when the text
// parses successfully. A validity pill below shows current parse status.
function JsonField({ value, onChange }) {
  const initial = value == null
    ? ''
    : (typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  const [text, setText] = useState(initial)
  const [parseErr, setParseErr] = useState(null)

  // Re-sync from the parent if the draft is reset externally (Cancel, etc.)
  useEffect(() => {
    const next = value == null
      ? ''
      : (typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    setText(next)
    setParseErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === null || value === undefined ? '' : (typeof value === 'string' ? value : JSON.stringify(value))])

  const handleChange = (next) => {
    setText(next)
    if (next.trim() === '') {
      setParseErr(null)
      onChange({})  // empty → empty object (jsonb NOT NULL columns default this)
      return
    }
    try {
      const parsed = JSON.parse(next)
      setParseErr(null)
      onChange(parsed)
    } catch (e) {
      setParseErr(e.message)
      // Don't forward — keep last valid value in draft
    }
  }

  return (
    <div>
      <textarea
        style={{
          ...inputBase, minHeight: 96, resize: 'vertical',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
          borderColor: parseErr ? '#fca5a5' : undefined,
        }}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
      />
      {parseErr ? (
        <div style={{ marginTop: 4, fontSize: 11, color: '#b03a2e' }}>
          Invalid JSON: {parseErr}
        </div>
      ) : (
        <div style={{ marginTop: 4, fontSize: 11, color: C.textMuted }}>
          Valid JSON. Empty saves as <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{'{}'}</code>.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DocxUploadField — single-file slot for a document_template's .docx asset
// ---------------------------------------------------------------------------
// Renders the current asset (if any) as a download link plus a Replace
// button. When no asset is present, shows a Choose File button. Bypasses
// the standard draft/save flow — uploads go directly to Supabase Storage
// and update document_templates.dt_template_asset_path on the row. After
// success, calls onRefreshRecord so the parent re-fetches and the new
// path appears in the UI.
//
// The lock trigger on document_templates blocks this when the template is
// Active. The error message from the trigger surfaces in the toast.
function DocxUploadField({ recordId, value, onRefreshRecord, disabled, disabledReason }) {
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)
  const [downloadHref, setDownloadHref] = useState(null)
  const fileInputRef = useRef(null)

  // Resolve a signed URL for the current asset so the user can download it
  // for review. Re-fetched whenever the path changes.
  useEffect(() => {
    let cancelled = false
    if (!value) { setDownloadHref(null); return }
    signedDocumentTemplateAssetUrl(value)
      .then(url => { if (!cancelled) setDownloadHref(url) })
      .catch(() => { if (!cancelled) setDownloadHref(null) })
    return () => { cancelled = true }
  }, [value])

  const handlePick = () => {
    setError(null)
    fileInputRef.current?.click()
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''  // allow same file to be re-picked later
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await uploadDocumentTemplateAsset(recordId, file)
      if (onRefreshRecord) onRefreshRecord()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  // Resolve the displayed filename from the current path. Storage path is
  // `document_templates/{id}/{timestamp}-{safe_name}` — strip everything
  // before the timestamp dash.
  const filename = value
    ? (value.split('/').pop() || value).replace(/^\d+-/, '')
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      {filename ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Icon path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={14} color={C.emerald} />
          {downloadHref ? (
            <a href={downloadHref} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 13, color: '#1a5a8a', textDecoration: 'underline', wordBreak: 'break-word' }}>
              {filename}
            </a>
          ) : (
            <span style={{ fontSize: 13, color: C.textPrimary, wordBreak: 'break-word' }}>
              {filename}
            </span>
          )}
          {!disabled && (
            <button onClick={handlePick} disabled={busy}
              style={{
                background: 'transparent', border: `1px solid ${C.border}`, color: C.emerald,
                borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? 'Uploading…' : 'Replace'}
            </button>
          )}
        </div>
      ) : (
        !disabled ? (
          <button onClick={handlePick} disabled={busy}
            style={{
              alignSelf: 'flex-start',
              background: C.page, border: `1px solid ${C.border}`, color: C.emerald,
              borderRadius: 5, padding: '6px 12px', fontSize: 12.5, cursor: busy ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <Icon path="M12 4v16m8-8H4" size={14} color={C.emerald} />
            {busy ? 'Uploading…' : 'Choose .docx file'}
          </button>
        ) : (
          <span style={{ fontSize: 12.5, color: C.textMuted, fontStyle: 'italic' }}>
            {disabledReason || 'No file uploaded'}
          </span>
        )
      )}

      {error && (
        <div style={{ fontSize: 11.5, color: '#b03a2e' }}>{error}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MergeFieldPickerBody — shared two-pane picker UI used in both insert mode
// (textarea companion) and copy mode (reference panel for docx authoring).
//
// In insert mode the right-pane click invokes onPick(token) with the
// already-formatted token text (e.g. "{{property.property_name}}" or the
// raw "\sig1\" anchor) so the parent can splice it at the textarea caret.
//
// In copy mode each row shows the token in monospace and a copy button.
// onPick is not used; the body owns the clipboard write and the brief
// "Copied" pip that fades out.
//
// Self-contained: owns its activeKey + per-object field cache. The cache
// persists across mounts only via the parent's React state, so passing a
// ref or callback is unnecessary — the cost is one describe_object_columns
// RPC per object per panel mount, which is cheap.
// ---------------------------------------------------------------------------

function MergeFieldPickerBody({ mode, onPick }) {
  const [activeKey, setActiveKey] = useState(MERGE_FIELD_OBJECTS[0]?.key ?? '')
  const [fieldsByKey, setFieldsByKey] = useState({})
  const [copiedPath, setCopiedPath] = useState(null)
  const copiedTimerRef = useRef(null)

  const activeObj   = MERGE_FIELD_OBJECTS.find(o => o.key === activeKey)
  const activeEntry = fieldsByKey[activeKey]

  useEffect(() => {
    if (fieldsByKey[activeKey]) return
    let cancelled = false
    setFieldsByKey(prev => ({ ...prev, [activeKey]: { loading: true } }))
    loadFieldsForObject(activeKey)
      .then(items => {
        if (cancelled) return
        setFieldsByKey(prev => ({ ...prev, [activeKey]: { items } }))
      })
      .catch(err => {
        if (cancelled) return
        setFieldsByKey(prev => ({ ...prev, [activeKey]: { error: err?.message || String(err) } }))
      })
    return () => { cancelled = true }
  }, [activeKey, fieldsByKey])

  // Format an item's path into the token actually inserted/copied. Anchors
  // (noBraces) are literal — no curly-brace wrapping.
  const formatToken = (item) => item.noBraces ? item.path : `{{${item.path}}}`

  const handleCopy = async (item) => {
    const token = formatToken(item)
    try {
      await navigator.clipboard.writeText(token)
      setCopiedPath(item.path)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopiedPath(null), 1500)
    } catch {
      // Fallback for browsers without clipboard permission — fall back to
      // the deprecated execCommand path. Failure here is silent; the user
      // can still type the visible token by hand.
      try {
        const ta = document.createElement('textarea')
        ta.value = token
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopiedPath(item.path)
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = setTimeout(() => setCopiedPath(null), 1500)
      } catch { /* noop */ }
    }
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Left pane — object selector */}
      <div
        style={{
          width: 220, flexShrink: 0,
          background: '#fafbfd', borderRight: `1px solid ${C.border}`,
          overflowY: 'auto',
        }}
      >
        <div style={{
          padding: '10px 14px 6px', fontSize: 10.5, fontWeight: 600,
          color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em',
          borderBottom: `1px solid ${C.border}`,
        }}>
          Object
        </div>
        {MERGE_FIELD_OBJECTS.map(g => {
          const isActive = g.key === activeKey
          const kindBadge =
            g.kind === 'collection'     ? 'list'   :
            g.kind === 'synthetic'      ? 'sys'    :
            g.kind === 'signing_anchor' ? 'anchor' : null
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setActiveKey(g.key)}
              title={g.description || ''}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', textAlign: 'left',
                padding: '9px 14px', fontSize: 12.5,
                color: isActive ? C.textPrimary : C.textSecondary,
                fontWeight: isActive ? 600 : 400,
                background: isActive ? C.card : 'transparent',
                borderLeft: `3px solid ${isActive ? C.emerald : 'transparent'}`,
                borderTop: 'none', borderRight: 'none', borderBottom: `1px solid ${C.border}`,
                cursor: 'pointer', gap: 6,
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f0f3f8' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.label}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {kindBadge && (
                  <span style={{
                    fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: C.textMuted, background: '#eef2f7',
                    border: `1px solid ${C.border}`, borderRadius: 3,
                    padding: '1px 5px',
                  }}>
                    {kindBadge}
                  </span>
                )}
                <Icon path="M9 5l7 7-7 7" size={11} color={isActive ? C.textPrimary : C.textMuted} />
              </span>
            </button>
          )
        })}
      </div>

      {/* Right pane — field list */}
      <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
        <div style={{
          padding: '10px 16px 6px', fontSize: 10.5, fontWeight: 600,
          color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Field</span>
          {activeObj?.kind === 'collection' && (
            <span style={{
              fontSize: 10, fontWeight: 500, textTransform: 'none',
              letterSpacing: 'normal', color: C.textMuted,
            }}>
              First-row tokens resolve to the lowest record number
            </span>
          )}
          {activeObj?.kind === 'signing_anchor' && (
            <span style={{
              fontSize: 10, fontWeight: 500, textTransform: 'none',
              letterSpacing: 'normal', color: C.textMuted,
            }}>
              Type the literal string in your .docx wherever the signer should sign
            </span>
          )}
        </div>
        {!activeEntry || activeEntry.loading ? (
          <div style={{ padding: '14px 16px', fontSize: 12.5, color: C.textMuted }}>
            Loading fields…
          </div>
        ) : activeEntry.error ? (
          <div style={{ padding: '14px 16px', fontSize: 12.5, color: '#b03a2e' }}>
            {activeEntry.error}
          </div>
        ) : (activeEntry.items || []).length === 0 ? (
          <div style={{ padding: '14px 16px', fontSize: 12.5, color: C.textMuted }}>
            No fields available.
          </div>
        ) : (
          (activeEntry.items || []).map(item => {
            const token = formatToken(item)
            if (mode === 'copy') {
              const isCopied = copiedPath === item.path
              return (
                <div
                  key={item.path}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: C.textPrimary }}>{item.label}</div>
                    <code style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                      {token}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(item)}
                    style={{
                      flexShrink: 0,
                      padding: '4px 10px', fontSize: 11.5, fontWeight: 500,
                      background: isCopied ? '#ecfdf5' : C.card,
                      color: isCopied ? '#1a7a4e' : C.emerald,
                      border: `1px solid ${isCopied ? '#a7f3d0' : C.border}`,
                      borderRadius: 4, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    {isCopied ? (
                      <>
                        <Icon path="M5 13l4 4L19 7" size={11} color="#1a7a4e" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Icon path="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" size={11} color={C.emerald} />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              )
            }
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => onPick && onPick(token)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 16px', fontSize: 12.5, color: C.textPrimary,
                  background: 'transparent', border: 'none',
                  borderBottom: `1px solid ${C.border}`,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f0f6f3' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div>{item.label}</div>
                <code style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                  {token}
                </code>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MergeFieldTextarea — textarea + Insert Merge Field picker. Used by the
// `merge_textarea` field type. The picker is a portal'd modal (rendered to
// document.body) with a Salesforce-style two-pane layout: left pane is the
// object selector, right pane is the field list. Clicking a field inserts
// the token at the textarea's caret position. Modal avoids clipping when
// the textarea is rendered in narrow page-layout columns.
// ---------------------------------------------------------------------------

function MergeFieldTextarea({ value, onChange }) {
  const taRef = useRef(null)
  const [open, setOpen] = useState(false)
  const caretRef = useRef({ start: 0, end: 0 })
  const text = value == null ? '' : String(value)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const openPicker = () => {
    const ta = taRef.current
    if (ta) {
      caretRef.current = {
        start: ta.selectionStart ?? text.length,
        end:   ta.selectionEnd   ?? text.length,
      }
    } else {
      caretRef.current = { start: text.length, end: text.length }
    }
    setOpen(true)
  }

  const insertToken = (token) => {
    const { start, end } = caretRef.current
    const next = text.slice(0, start) + token + text.slice(end)
    onChange(next)
    setOpen(false)
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (!ta) return
      const pos = start + token.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1100, padding: 16,
  }
  const card = {
    width: '100%', maxWidth: 720, background: C.card,
    border: `1px solid ${C.border}`, borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    maxHeight: 'min(620px, 92vh)',
  }
  const headerStyle = {
    padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }
  const footerStyle = {
    padding: '10px 18px', borderTop: `1px solid ${C.border}`,
    background: C.page, fontSize: 11, color: C.textMuted,
  }

  return (
    <div>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...inputBase,
          minHeight: 110,
          resize: 'vertical',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      />
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={openPicker}
          style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 500,
            background: C.card, border: `1px solid ${C.borderDark}`,
            borderRadius: 4, cursor: 'pointer', color: C.textPrimary,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          <Icon path="M12 4v16m8-8H4" size={13} color={C.textPrimary} />
          Insert Merge Field
        </button>
        <span style={{ fontSize: 11, color: C.textMuted }}>
          Tokens use <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{`{{path}}`}</code> syntax.
          Unknown tokens render as <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>[unknown: …]</code>.
        </span>
      </div>
      {open && createPortal(
        <div style={overlay} onClick={() => setOpen(false)}>
          <div style={card} onClick={e => e.stopPropagation()}>
            <div style={headerStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 6,
                  background: '#ecfdf5', border: '1px solid #a7f3d0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon path="M12 4v16m8-8H4" size={15} color={C.emerald} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>Insert Merge Field</div>
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>
                    Pick an object on the left, then a field on the right.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: C.textMuted,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = C.page }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <Icon path="M6 18L18 6M6 6l12 12" size={16} color={C.textSecondary} />
              </button>
            </div>
            <MergeFieldPickerBody mode="insert" onPick={insertToken} />
            <div style={footerStyle}>
              Click a field to insert at the cursor. Press Esc to close.
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MergeFieldReferenceWidget — read-only, copy-friendly merge-field reference
// rendered inline as a section widget. Lives next to the docx upload widget
// on the document_templates page so authors who are round-tripping (download
// .docx → edit in Word → re-upload) can copy tokens without leaving the
// template detail page.
//
// Same two-pane component as the modal picker, just rendered inline with a
// fixed height and copy buttons instead of insert-into-textarea behavior.
// Collapsible — collapsed by default so the parent section stays compact;
// authors expand only when they need to look up tokens.
// ---------------------------------------------------------------------------

function MergeFieldReferenceWidget({ widget }) {
  const isMobile = useIsMobile()
  // Default-collapsed unless widget_config explicitly opens it. Stored
  // here so the section's own collapse state isn't overloaded.
  const startOpen = !!widget?.widget_config?.start_open
  const [open, setOpen] = useState(startOpen)
  const height = isMobile ? 320 : 420
  return (
    <div style={{ borderTop: `1px solid ${C.border}` }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: isMobile ? '10px 14px' : '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#fafbfd' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon path="M12 4v16m8-8H4" size={13} color={C.emerald} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary }}>
            {widget?.widget_title || 'Available Merge Fields'}
          </span>
          <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 400 }}>
            Browse and copy tokens for use in your .docx template
          </span>
        </span>
        <Icon path={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} size={13} color={C.textMuted} />
      </button>
      {open && (
        <div style={{
          display: 'flex', flexDirection: 'column',
          height, borderTop: `1px solid ${C.border}`,
          background: C.card,
        }}>
          <MergeFieldPickerBody mode="copy" />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilterConfigEditorWidget — schema-driven editor for project_report_template
// _sections.prts_filter_config. Mirrors SectionConfigEditorWidget. Reads the
// filter schema for the row's prts_section_type picklist_value, renders a
// structured picker per rule, and writes back to draft.prts_filter_config.
//
// When the section type has no filter schema (cover_page, project_summary,
// page_break, footer, custom_text), the widget renders a muted note instead
// of the picker — there's nothing to filter on.
// ---------------------------------------------------------------------------

function FilterConfigEditorWidget({ widget, record, picklists, editing, draft, onChange }) {
  const sectionTypeId = (editing ? draft.prts_section_type : record.prts_section_type) || null
  const sectionTypeValue = sectionTypeId ? picklists.valueById?.get(sectionTypeId) : null
  const sectionTypeLabel = sectionTypeId ? picklists.byId?.get(sectionTypeId) : null
  const schema = sectionTypeValue ? getSectionFilterSchema(sectionTypeValue) : null

  const filterConfig = editing
    ? (draft.prts_filter_config !== undefined ? draft.prts_filter_config : (record.prts_filter_config || {}))
    : (record.prts_filter_config || {})

  const setKey = (key, value) => {
    if (!editing) return
    const next = { ...(filterConfig && typeof filterConfig === 'object' ? filterConfig : {}) }
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete next[key]
    } else {
      next[key] = value
    }
    onChange('prts_filter_config', next)
  }

  if (!sectionTypeValue) {
    return (
      <div style={{ padding: 18, fontSize: 12.5, color: C.textMuted }}>
        Pick a Section Type above to configure filters.
      </div>
    )
  }

  if (!schema) {
    return (
      <div style={{ padding: 18, fontSize: 12.5, color: C.textMuted }}>
        The <strong style={{ color: C.textPrimary }}>{sectionTypeLabel || sectionTypeValue}</strong> section type
        has no filter rules — it always renders all relevant content.
      </div>
    )
  }

  return (
    <div>
      <div style={{ padding: '10px 16px', background: '#f7f9fc', borderBottom: `1px solid ${C.border}`, fontSize: 11.5, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon path="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" size={13} color={C.textMuted} />
        <span>
          Filtering <strong style={{ color: C.textPrimary }}>{sectionTypeLabel || sectionTypeValue}</strong>.
          Rules are AND-combined. Leave a rule empty to skip it.
        </span>
      </div>
      <div>
        {schema.map(rule => (
          <FilterRuleRow
            key={rule.key}
            rule={rule}
            value={filterConfig[rule.key]}
            editing={editing}
            onChange={(v) => setKey(rule.key, v)}
          />
        ))}
      </div>
    </div>
  )
}

function FilterRuleRow({ rule, value, editing, onChange }) {
  const [opts, setOpts] = useState(null)

  // Lazy-load picklist options for this filter rule.
  useEffect(() => {
    if (rule.type !== 'picklist_multi') return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('picklist_values')
          .select('id, picklist_label, picklist_value, picklist_is_active')
          .eq('picklist_object', rule.picklist_object)
          .eq('picklist_field', rule.picklist_field)
          .order('picklist_label', { ascending: true })
        if (cancelled) return
        if (error) {
          // eslint-disable-next-line no-console
          console.error('FilterRuleRow picklist load failed', error)
          setOpts([])
          return
        }
        // Show inactive values too if they're already selected — otherwise
        // the user can't see what's currently saved. Otherwise hide them.
        const selectedSet = new Set(Array.isArray(value) ? value : [])
        setOpts((data || []).filter(o => o.picklist_is_active || selectedSet.has(o.id)))
      } catch (e) {
        if (!cancelled) setOpts([])
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule.picklist_object, rule.picklist_field])

  const selected = new Set(Array.isArray(value) ? value : [])
  const selectedCount = selected.size

  const toggle = (id) => {
    if (!editing) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next.size === 0 ? null : Array.from(next))
  }

  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 4 }}>
        {rule.label}
        {selectedCount > 0 && (
          <span style={{ marginLeft: 8, color: C.emerald, textTransform: 'none', fontSize: 11 }}>
            · {selectedCount} selected
          </span>
        )}
      </div>
      {rule.description && (
        <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 8 }}>
          {rule.description}
        </div>
      )}
      {editing ? (
        opts === null ? (
          <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>Loading options…</div>
        ) : opts.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>No options configured for this filter.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {opts.map(o => {
              const on = selected.has(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  style={{
                    padding: '5px 10px', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', borderRadius: 4,
                    border: `1px solid ${on ? C.emerald : C.border}`,
                    background: on ? C.emerald : C.card,
                    color: on ? '#fff' : C.textPrimary,
                    opacity: o.picklist_is_active ? 1 : 0.65,
                  }}
                  title={o.picklist_is_active ? '' : 'This picklist value is inactive.'}
                >
                  {o.picklist_label}
                </button>
              )
            })}
          </div>
        )
      ) : (
        <div style={{ fontSize: 13, color: C.textPrimary }}>
          {selectedCount === 0 ? (
            <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Any (no constraint)</span>
          ) : (
            <span>
              {Array.from(selected).map(id => {
                const o = (opts || []).find(x => x.id === id)
                return o ? o.picklist_label : id
              }).join(', ')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PrtsnHistoryWidget — Versions list for project_report_templates. Reads
// project_report_template_snapshots rows for the current PRT and renders one
// row per published version with action buttons:
//   • Preview — POSTs { preview: true, prtsn_id } to the generate-project-
//     report edge function and opens the resulting PDF in a new tab. Works
//     for any version regardless of the live PRT's current status (the edge
//     fn skips the Active-only gate for snapshot-sourced renders).
//
// The widget is read-only: snapshots are written by the publish RPC and
// never mutated through this UI.
// ---------------------------------------------------------------------------

function PrtsnHistoryWidget({ widget, parentRecordId }) {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [previewingId, setPreviewingId] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('project_report_template_snapshots')
          .select('id, prtsn_record_number, prtsn_version, prtsn_published_at, prtsn_published_by, prtsn_template_json')
          .eq('prt_id', parentRecordId)
          .order('prtsn_version', { ascending: false })
        if (cancelled) return
        if (error) { setError(error.message); return }
        // Hydrate prtsn_published_by → public.users name if possible
        const publisherIds = Array.from(new Set((data || []).map(r => r.prtsn_published_by).filter(Boolean)))
        let publisherMap = new Map()
        if (publisherIds.length > 0) {
          const { data: users } = await supabase
            .from('users')
            .select('id, user_first_name, user_last_name, user_email')
            .in('id', publisherIds)
          publisherMap = new Map((users || []).map(u => {
            const name = [u.user_first_name, u.user_last_name].filter(Boolean).join(' ').trim()
            return [u.id, name || u.user_email || u.id]
          }))
        }
        if (!cancelled) {
          setRows((data || []).map(r => ({ ...r, _publisher_name: publisherMap.get(r.prtsn_published_by) || '—' })))
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      }
    })()
    return () => { cancelled = true }
  }, [parentRecordId])

  const previewSnapshot = async (snapshotId) => {
    setPreviewingId(snapshotId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        toast.error('Not signed in — refresh the page and try again.')
        setPreviewingId(null)
        return
      }
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-project-report`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ preview: true, prtsn_id: snapshotId }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Edge function returned ${res.status}: ${text.slice(0, 200)}`)
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      window.open(objectUrl, '_blank', 'noopener')
    } catch (e) {
      toast.error(`Preview failed: ${e.message || e}`)
    } finally {
      setPreviewingId(null)
    }
  }

  const fmtTs = (ts) => {
    if (!ts) return '—'
    try {
      const d = new Date(ts)
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    } catch {
      return String(ts)
    }
  }

  const widgetTitle = widget.widget_title || 'Versions'
  const maxVersion = (rows || []).reduce((m, r) => Math.max(m, r.prtsn_version || 0), 0)

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, background: '#fafbfd', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{widgetTitle}</span>
        {rows && (
          <span style={{ fontSize: 11, color: C.textMuted, padding: '2px 8px', background: '#eef2f7', borderRadius: 10 }}>
            {rows.length}
          </span>
        )}
      </div>
      {error ? (
        <div style={{ padding: 18, fontSize: 12.5, color: '#b03a2e' }}>
          Failed to load versions: {error}
        </div>
      ) : rows === null ? (
        <div style={{ padding: 18, fontSize: 12.5, color: C.textMuted, fontStyle: 'italic' }}>Loading versions…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 18, fontSize: 12.5, color: C.textMuted }}>
          No published versions yet. Publish the template to create the first snapshot.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#fafbfd', borderBottom: `1px solid ${C.border}` }}>
            <tr>
              <th style={thStyle}>Snapshot</th>
              <th style={thStyle}>Version</th>
              <th style={thStyle}>Published</th>
              <th style={thStyle}>Published By</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isLatest = r.prtsn_version === maxVersion
              return (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                    {r.prtsn_record_number}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 13, color: C.textPrimary }}>v{r.prtsn_version}</span>
                    {isLatest && (
                      <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: C.emerald, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Latest
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{fmtTs(r.prtsn_published_at)}</td>
                  <td style={{ ...tdStyle, fontSize: 12.5 }}>{r._publisher_name}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => previewSnapshot(r.id)}
                      disabled={previewingId === r.id}
                      style={{
                        padding: '5px 12px', fontSize: 12, fontWeight: 500,
                        border: `1px solid ${C.borderDark}`, borderRadius: 4,
                        background: C.card, color: C.textPrimary,
                        cursor: previewingId === r.id ? 'wait' : 'pointer',
                        opacity: previewingId === r.id ? 0.7 : 1,
                      }}
                    >
                      {previewingId === r.id ? 'Generating…' : 'Preview PDF'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

const thStyle = { textAlign: 'left', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.03em' }
const tdStyle = { padding: '10px 14px', color: C.textPrimary, verticalAlign: 'middle' }

// ---------------------------------------------------------------------------
// FieldGroup widget — view mode OR edit mode
// ---------------------------------------------------------------------------

function FieldGroupWidget({ widget, record, picklists, lookups, editing, draft, onChange, allPicklistOpts, allLookupOpts, onRefreshRecord, recordId, fieldDisabledReasons }) {
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

        // docx_upload renders the same component in both edit and view modes
        // because uploads happen out-of-band (direct to storage + DB) rather
        // than through the draft → save flow. The component reads the live
        // path off the record (not the draft) and triggers a parent reload
        // after a successful upload via onRefreshRecord.
        if (f.type === 'docx_upload') {
          const livePath = record[f.name] || null
          const fieldDisabled = fieldDisabledReasons?.[f.name] || null
          return (
            <div key={f.name} style={{
              padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {f.label}
              </span>
              <DocxUploadField
                recordId={recordId}
                value={livePath}
                onRefreshRecord={onRefreshRecord}
                disabled={!!fieldDisabled}
                disabledReason={fieldDisabled}
              />
            </div>
          )
        }

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
// SectionConfigEditorWidget — schema-driven editor for project_report_template
// _sections.prts_config. The schema is keyed on prts_section_type's picklist
// _value (cover_page, work_order_section, etc.). Section types not in the
// schema map fall back to a JSON textarea.
//
// Reads section type from the record (or draft, when editing). Renders a form
// keyed off SECTION_CONFIG_SCHEMAS, writing back to draft.prts_config via
// onChange. When the user changes the section_type, the previously-saved
// config keys are preserved if they still appear in the new schema; new keys
// are seeded with defaults.
// ---------------------------------------------------------------------------

function SectionConfigEditorWidget({ widget, record, picklists, editing, draft, onChange }) {
  // Section type is a uuid → resolve to its picklist_value (e.g. "cover_page")
  const sectionTypeId = (editing ? draft.prts_section_type : record.prts_section_type) || null
  const sectionTypeValue = sectionTypeId ? picklists.valueById?.get(sectionTypeId) : null
  const schema = sectionTypeValue ? getSectionConfigSchema(sectionTypeValue) : null
  const sectionTypeLabel = sectionTypeId ? picklists.byId?.get(sectionTypeId) : null

  // Resolve current config (object). If draft.prts_config is undefined in
  // edit mode, fall back to the record value to preserve unsaved keys.
  const config = editing
    ? (draft.prts_config !== undefined ? draft.prts_config : (record.prts_config || {}))
    : (record.prts_config || {})

  const setKey = (key, value) => {
    if (!editing) return
    const next = { ...(config && typeof config === 'object' ? config : {}) }
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete next[key]
    } else {
      next[key] = value
    }
    onChange('prts_config', next)
  }

  // No section type chosen yet — prompt to pick one in Section Information first
  if (!sectionTypeValue) {
    return (
      <div style={{ padding: 18, fontSize: 12.5, color: C.textMuted }}>
        Pick a Section Type above to configure its options.
      </div>
    )
  }

  // Unknown / unsupported section type — fall back to JSON editor in edit mode
  if (!schema) {
    return (
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
          No schema defined for section type <strong style={{ color: C.textPrimary }}>{sectionTypeLabel || sectionTypeValue}</strong>. Edit configuration as raw JSON below.
        </div>
        {editing ? (
          <JsonField value={config} onChange={(parsed) => onChange('prts_config', parsed || {})} />
        ) : (
          <pre style={{ margin: 0, padding: 12, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: C.textPrimary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(config, null, 2)}
          </pre>
        )}
      </div>
    )
  }

  // Group fields by their `group` attribute, preserving first-appearance order.
  const groups = []
  const seenGroups = new Map()
  for (const f of schema) {
    const g = f.group || ''
    if (!seenGroups.has(g)) {
      seenGroups.set(g, groups.length)
      groups.push({ name: g, fields: [] })
    }
    groups[seenGroups.get(g)].fields.push(f)
  }

  const headerNote = (
    <div style={{ padding: '10px 16px', background: '#f7f9fc', borderBottom: `1px solid ${C.border}`, fontSize: 11.5, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
      <Icon path="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={13} color={C.textMuted} />
      <span>
        Configuring <strong style={{ color: C.textPrimary }}>{sectionTypeLabel || sectionTypeValue}</strong> section.
        {editing ? ' Changes are saved when you click Save on the record.' : ' Switch to edit mode to change values.'}
      </span>
    </div>
  )

  return (
    <div>
      {headerNote}
      {groups.map((g, gi) => (
        <div key={g.name || `g${gi}`}>
          {g.name ? (
            <div style={{ padding: '12px 16px 6px', fontSize: 10.5, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', borderTop: gi > 0 ? `1px solid ${C.border}` : 'none' }}>
              {g.name}
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 0 }}>
            {g.fields.map(f => (
              <ConfigFieldRow
                key={f.key}
                field={f}
                value={f.type === 'info' ? null : (config[f.key] !== undefined ? config[f.key] : f.default)}
                editing={editing}
                onChange={(v) => setKey(f.key, v)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConfigFieldRow — one row inside SectionConfigEditorWidget.
// ---------------------------------------------------------------------------

function ConfigFieldRow({ field, value, editing, onChange }) {
  // The 'info' type is a non-editable note used for section types with no
  // configurable keys (page_break, custom_text → body lives elsewhere).
  if (field.type === 'info') {
    return (
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, gridColumn: '1 / -1', fontSize: 12, color: C.textSecondary, lineHeight: 1.5 }}>
        {field.description}
      </div>
    )
  }

  const renderEdit = () => {
    switch (field.type) {
      case 'boolean': {
        const isYes = value === true
        const isNo = value === false
        const segBtn = (active) => ({
          flex: 1, padding: '6px 12px', fontSize: 12, fontWeight: 500,
          cursor: 'pointer', border: `1px solid ${active ? C.emerald : C.border}`,
          background: active ? C.emerald : C.card, color: active ? '#fff' : C.textPrimary,
          outline: 'none',
        })
        return (
          <div style={{ display: 'flex', gap: 0, maxWidth: 180 }}>
            <button type="button" onClick={() => onChange(true)}
              style={{ ...segBtn(isYes), borderRadius: '5px 0 0 5px' }}>Yes</button>
            <button type="button" onClick={() => onChange(false)}
              style={{ ...segBtn(isNo), borderRadius: '0 5px 5px 0', borderLeftWidth: 0 }}>No</button>
          </div>
        )
      }
      case 'number':
        return <input type="number"
          min={field.min} max={field.max} step="1"
          style={{ ...inputBase, fontFamily: 'JetBrains Mono, monospace', maxWidth: 120 }}
          value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      case 'text':
        return <input type="text" style={inputBase}
          value={value ?? ''} onChange={e => onChange(e.target.value)} />
      case 'textarea':
        return <textarea style={{ ...inputBase, minHeight: 56, resize: 'vertical' }}
          value={value ?? ''} onChange={e => onChange(e.target.value)} />
      case 'select':
        return (
          <select style={{ ...inputBase, cursor: 'pointer' }}
            value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
            <option value="">— Select —</option>
            {(field.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )
      case 'multiselect': {
        const selected = new Set(Array.isArray(value) ? value : [])
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(field.options || []).map(o => {
              const on = selected.has(o.value)
              return (
                <button key={o.value} type="button"
                  onClick={() => {
                    const next = new Set(selected)
                    if (on) next.delete(o.value); else next.add(o.value)
                    onChange(Array.from(next))
                  }}
                  style={{
                    background: on ? C.emerald : C.card,
                    color: on ? '#fff' : C.textSecondary,
                    border: `1px solid ${on ? C.emerald : C.border}`,
                    borderRadius: 14, padding: '4px 10px',
                    fontSize: 11.5, cursor: 'pointer',
                    fontWeight: on ? 500 : 400,
                  }}>
                  {o.label}
                </button>
              )
            })}
          </div>
        )
      }
      default:
        return <input type="text" style={inputBase}
          value={value ?? ''} onChange={e => onChange(e.target.value)} />
    }
  }

  const renderView = () => {
    if (value === null || value === undefined || value === '') {
      return <span style={{ fontSize: 13, color: C.textMuted }}>—</span>
    }
    switch (field.type) {
      case 'boolean': return <span style={{ fontSize: 13, color: C.textPrimary }}>{value ? 'Yes' : 'No'}</span>
      case 'multiselect': {
        const labelByValue = new Map((field.options || []).map(o => [o.value, o.label]))
        const labels = (Array.isArray(value) ? value : []).map(v => labelByValue.get(v) || v)
        if (labels.length === 0) return <span style={{ fontSize: 13, color: C.textMuted }}>—</span>
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {labels.map((l, i) => (
              <span key={i} style={{ fontSize: 11.5, padding: '2px 8px', background: '#eef2f7', borderRadius: 10, color: C.textSecondary }}>{l}</span>
            ))}
          </div>
        )
      }
      case 'select': {
        const opt = (field.options || []).find(o => o.value === value)
        return <span style={{ fontSize: 13, color: C.textPrimary }}>{opt?.label || String(value)}</span>
      }
      case 'number':
        return <span style={{ fontSize: 13, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{Number(value).toLocaleString()}</span>
      default:
        return <span style={{ fontSize: 13, color: C.textPrimary, wordBreak: 'break-word' }}>{String(value)}</span>
    }
  }

  return (
    <div style={{
      padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', gap: 4,
      background: editing ? '#fafffe' : 'transparent',
    }}>
      <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {field.label}
      </span>
      {editing ? renderEdit() : renderView()}
      {field.description && (
        <span style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.45, marginTop: 2 }}>
          {field.description}
        </span>
      )}
    </div>
  )
}
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
              <div style={{
                padding: isMobile ? '28px 20px' : '22px 16px',
                fontSize: isMobile ? 13 : 12,
                color: C.textMuted, textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              }}>
                <div style={{ color: C.textMuted }}>
                  No {title.toLowerCase()} on this record{editable && pickerCfg ? ' yet' : ''}.
                </div>
                {editable && pickerCfg && (
                  <button
                    onClick={handleAddClick}
                    style={{
                      background: C.page, color: C.textSecondary,
                      border: `1px solid ${C.border}`, borderRadius: 6,
                      padding: isMobile ? '8px 14px' : '6px 12px',
                      fontSize: isMobile ? 13 : 12, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      minHeight: isMobile ? 36 : undefined,
                    }}
                  >
                    <Icon path="M12 5v14M5 12h14" size={12} color={C.textSecondary} />
                    {pickerCfg.add_button_label || 'Add one'}
                  </button>
                )}
                {!editable && canNavigate && (
                  <button
                    onClick={handleNewClick}
                    style={{
                      background: C.page, color: C.textSecondary,
                      border: `1px solid ${C.border}`, borderRadius: 6,
                      padding: isMobile ? '8px 14px' : '6px 12px',
                      fontSize: isMobile ? 13 : 12, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      minHeight: isMobile ? 36 : undefined,
                    }}
                  >
                    <Icon path="M12 5v14M5 12h14" size={12} color={C.textSecondary} />
                    Create one
                  </button>
                )}
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

  const toast = useToast()
  const picker = config?.picker || {}

  // create_only mode: no separate source pool — the "Add" button creates a
  // new row directly in config.table, wired to the parent via the FK and
  // auto-incremented order field. Used by direct-child relationships
  // (e.g. project_report_template_sections) where there's no upstream
  // template library to pick from. allow_inline_create is implied true.
  const createOnly = picker.create_only === true && Array.isArray(picker.inline_create_fields)

  // Inline-create mode state ------------------------------------------------
  const [mode, setMode] = useState(createOnly ? 'create' : 'pick')   // 'pick' | 'create'
  const [draft, setDraft] = useState({})
  const [picklistOpts, setPicklistOpts] = useState({})
  const [lookupOpts, setLookupOpts]     = useState({})
  const [creating, setCreating] = useState(false)
  const [formLoading, setFormLoading] = useState(false)

  const inlineCreate = createOnly
    ? { fields: picker.inline_create_fields, title: picker.create_modal_title, buttonLabel: picker.create_button_label, createOnly: true }
    : (picker.allow_inline_create && Array.isArray(picker.inline_create_fields)
        ? { fields: picker.inline_create_fields, title: picker.create_modal_title, buttonLabel: picker.create_button_label, createOnly: false }
        : null)

  const reload = useCallback(async () => {
    if (createOnly) {
      // No pool to load. Set loading false so create form can render immediately.
      setLoading(false)
      return
    }
    setLoading(true); setError(null)
    try {
      const c = await fetchPickerCandidates(config, parentRecordId)
      setCandidates(c)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [config, parentRecordId, createOnly])

  useEffect(() => { reload() }, [reload])

  // Close on Escape. In create mode, Escape returns to pick mode first so a
  // user can back out of a half-filled form without dismissing the dialog —
  // unless we're in create_only mode (no pick mode to return to).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (mode === 'create' && !createOnly) { setMode('pick'); setDraft({}) }
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, mode, createOnly])

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
      // In create_only mode, picklists belong to the child table itself
      // (config.table); in junction-picker mode they belong to the source pool.
      const picklistOwnerTable = createOnly ? config.table : picker.source_table
      const pickFields  = inlineCreate.fields.filter(f => f.type === 'picklist').map(f => f.name)
      const lookupFlds  = inlineCreate.fields.filter(f => f.type === 'lookup' && f.lookup_table && f.lookup_field)
      const [pOpts, lOpts] = await Promise.all([
        Promise.all(pickFields.map(fn =>
          fetchPicklistOptions(picklistOwnerTable, fn).catch(() => []).then(v => [fn, v])
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

  // In create_only mode, the modal opens straight in create mode — the
  // useEffect below mirrors enterCreateMode so the form is populated and
  // its picklists/lookups are loaded without a pick → create transition.
  useEffect(() => {
    if (!createOnly) return
    if (formLoading || Object.keys(picklistOpts).length || Object.keys(lookupOpts).length) return
    enterCreateMode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOnly])

  const cancelCreate = () => createOnly ? onClose() : (setMode('pick'), setDraft({}))

  // Save inline-created record. In junction mode, the record goes into the
  // source pool, then a junction row links it to the parent. In create_only
  // mode, the record IS the parent's child — insert directly into config.table
  // with the FK and the next order value set on the row itself.
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
    // Cross-field sanity validation runs against the table being inserted
    // into (source_table for junctions, config.table for create_only).
    const insertTable = createOnly ? config.table : picker.source_table
    const evidenceLabelById = new Map(
      (picklistOpts.wst_required_evidence_type_id || []).map(o => [o.value, o.label])
    )
    const sanityErrors = validateBeforeSave(insertTable, draft, evidenceLabelById)
    if (sanityErrors.length) {
      toast.error(sanityErrors.length === 1
        ? sanityErrors[0]
        : `Cannot save:\n• ${sanityErrors.join('\n• ')}`)
      return
    }
    setCreating(true)
    try {
      const userId = await getCurrentUserId()

      if (createOnly) {
        // Auto-increment order field by computing max+1 against existing
        // non-deleted siblings on the same parent.
        const orderField = config.order_field
        const fk = config.fk
        const deletedCol = config.is_deleted_col
        let nextOrder = 1
        if (orderField) {
          let q = supabase.from(config.table).select(orderField).eq(fk, parentRecordId).order(orderField, { ascending: false }).limit(1)
          if (deletedCol) q = q.eq(deletedCol, false)
          const { data: maxRows, error: maxErr } = await q
          if (maxErr) throw maxErr
          nextOrder = Number(maxRows?.[0]?.[orderField] || 0) + 1
        }
        const payload = applyInsertDefaults(config.table, { ...draft }, userId)
        for (const [k, v] of Object.entries(payload)) if (v === '') payload[k] = null
        payload[fk] = parentRecordId
        if (orderField) payload[orderField] = nextOrder

        const created = await insertRecord(config.table, payload)
        const labelField = picker.row_label_field
        const label = (labelField && created?.[labelField]) || `Item ${nextOrder}`

        toast.success(`Created ${label}`)
        if (onAdded) await onAdded()
        onClose()
        return
      }

      // Junction-picker mode (existing path)
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
            {mode === 'create' && !createOnly && (
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
                {creating ? 'Saving…' : (createOnly ? 'Save' : 'Save and Add')}
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

function Section({ section, record, picklists, lookups, editing, draft, onChange, allPicklistOpts, allLookupOpts, tableName, onRefreshRecord, recordId, fieldDisabledReasons, hiddenWidgetTypes }) {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(section.section_is_collapsed_by_default || false)
  // Render any widgets that live inside a section card. Today: field_group,
  // section_config_editor, filter_config_editor, and merge_field_reference.
  // Related lists, file galleries, prtsn history, and the activity timeline
  // render as their own standalone cards outside sections.
  const inSectionTypes = new Set(['field_group', 'section_config_editor', 'filter_config_editor', 'merge_field_reference'])
  // hiddenWidgetTypes is a Set of widget_type values to suppress at render
  // time — used by the parent to hide context-dependent widgets (e.g.
  // merge_field_reference is only relevant when document_templates is in
  // docx authoring mode, so the parent passes {'merge_field_reference'}
  // to hide it in html mode).
  const sectionWidgets = (section.widgets || []).filter(w => {
    if (!inSectionTypes.has(w.widget_type)) return false
    if (hiddenWidgetTypes && hiddenWidgetTypes.has(w.widget_type)) return false
    return true
  })
  if (sectionWidgets.length === 0) return null
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: isMobile ? 10 : 12, overflow: 'hidden' }}>
      <div onClick={() => section.section_is_collapsible && setCollapsed(c => !c)}
        style={{ padding: isMobile ? '12px 14px' : '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: section.section_is_collapsible ? 'pointer' : 'default', borderBottom: collapsed ? 'none' : `1px solid ${C.border}`, background: '#fafbfd' }}>
        <span style={{ fontSize: isMobile ? 14 : 13, fontWeight: 600, color: C.textPrimary }}>{section.section_label}</span>
        {section.section_is_collapsible && <Icon path={collapsed ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'} size={14} color={C.textMuted} />}
      </div>
      {!collapsed && sectionWidgets.map(w => {
        if (w.widget_type === 'field_group') {
          return <FieldGroupWidget key={w.id} widget={w} record={record} picklists={picklists} lookups={lookups}
            editing={editing} draft={draft} onChange={onChange} allPicklistOpts={allPicklistOpts} allLookupOpts={allLookupOpts}
            onRefreshRecord={onRefreshRecord} recordId={recordId} fieldDisabledReasons={fieldDisabledReasons} />
        }
        if (w.widget_type === 'section_config_editor') {
          return <SectionConfigEditorWidget key={w.id} widget={w} record={record} picklists={picklists}
            editing={editing} draft={draft} onChange={onChange} />
        }
        if (w.widget_type === 'filter_config_editor') {
          return <FilterConfigEditorWidget key={w.id} widget={w} record={record} picklists={picklists}
            editing={editing} draft={draft} onChange={onChange} />
        }
        if (w.widget_type === 'merge_field_reference') {
          return <MergeFieldReferenceWidget key={w.id} widget={w} />
        }
        return null
      })}
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
  // Project report generator (only used when tableName === 'projects'). The
  // tick is bumped after a successful generation so the related-records area
  // (Documents widget) re-fetches and the new PDF appears immediately.
  const [showReportModal, setShowReportModal] = useState(false)
  // Send-for-signature modal: shown on any record whose table has at least one
  // Active document template (document_templates.related_object = tableName).
  // The DocuSign / Conga model — gating is data-driven, not hardcoded. The
  // modal builds an envelope, calls send-envelope, and returns the magic-link
  // signing URLs for the user to distribute. Re-checked when tableName changes
  // so navigating between record types updates the icon visibility.
  const [showSendSignatureModal, setShowSendSignatureModal] = useState(false)
  const [hasActiveTemplate, setHasActiveTemplate] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  // Deep-clone state — only used on project_report_templates. Uses the
  // clone_project_report_template RPC to copy the PRT plus all PRTS rows
  // atomically; lands the user on the new clone via onNavigateToRecord.
  const [cloningTemplate, setCloningTemplate] = useState(false)
  const [previewingPdf, setPreviewingPdf] = useState(false)
  // Publish/unpublish/archive/restore in flight — disables status buttons
  // and shows a 'wait' cursor while the RPC is round-tripping.
  const [statusChanging, setStatusChanging] = useState(false)

  // Envelope-specific actions: Void + Resend signing email. Only relevant when
  // tableName === 'envelopes'. Both gated on the resolved env_status picklist
  // value — Void allowed from Draft/Sent/Delivered/Failed, Resend from
  // Sent/Delivered. envelopeBusy is shared by both since neither should run
  // concurrently.
  const [envelopeBusy, setEnvelopeBusy] = useState(false)
  const [showVoidConfirm, setShowVoidConfirm] = useState(false)

  // Query whether any Active document template targets this table. Drives
  // the visibility of the Send for Signature button — keeps the gate in
  // sync with seed data without code changes when new templates are
  // published or archived.
  useEffect(() => {
    let cancelled = false
    if (!tableName) { setHasActiveTemplate(false); return }
    ;(async () => {
      const { data, error } = await supabase
        .from('document_templates')
        .select('id, status:status ( picklist_value )')
        .eq('related_object', tableName)
        .eq('is_deleted', false)
      if (cancelled) return
      if (error) { setHasActiveTemplate(false); return }
      const anyActive = (data || []).some(r => r?.status?.picklist_value === 'Active')
      setHasActiveTemplate(anyActive)
    })()
    return () => { cancelled = true }
  }, [tableName])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)

    if (isCreate) {
      // Create mode: fetch layout + picklists only, no record.
      // If a record_type was pre-populated (via prefill or URL), use it to
      // select the record-type-specific layout. Otherwise falls back to master.
      Promise.all([fetchPageLayout(tableName, getRecordTypeValue(prefill)), loadAllPicklists()])
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
  }, [tableName, recordId, isCreate, reloadTick])

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

  // Deep clone for any lifecycle template (PRT / ET / DT) — calls the
  // table-specific clone RPC from TEMPLATE_LIFECYCLES, which atomically
  // copies the template (and any child rows the RPC chooses to copy, e.g.
  // sections for PRT). Resets the clone to Draft + version 1 and navigates
  // to it. For document_templates, the RPC NULLs out the asset path on
  // the clone (storage operations don't belong in an SQL RPC); we follow
  // up with a storage.copy() here so docx-mode clones don't lose their
  // asset and require manual re-upload.
  const handleCloneTemplate = useCallback(async () => {
    if (cloningTemplate) return
    const lifecycle = TEMPLATE_LIFECYCLES[tableName]
    if (!lifecycle) return
    setCloningTemplate(true)
    try {
      const sourceName = data?.record?.[lifecycle.nameColumn] || 'Template'
      const { data: newId, error } = await supabase.rpc(lifecycle.cloneRpc, {
        [lifecycle.cloneIdParam]: recordId,
        p_new_name: `${sourceName} (Clone)`,
      })
      if (error) throw error
      if (!newId) throw new Error('Clone returned no id')

      // For document_templates, copy the source asset to the new row's
      // path. Failure here is non-fatal — the row is already cloned and
      // the user can re-upload manually.
      if (tableName === 'document_templates') {
        const sourceAssetPath = data?.record?.dt_template_asset_path
        if (sourceAssetPath) {
          try {
            await copyDocumentTemplateAsset(sourceAssetPath, newId)
          } catch (assetErr) {
            toast.warning(`Cloned, but asset copy failed: ${assetErr.message || String(assetErr)}`)
          }
        }
      }

      toast.success(`Cloned ${sourceName}`)
      if (onNavigateToRecord) {
        onNavigateToRecord({ table: tableName, id: newId })
      }
    } catch (err) {
      toast.error(`Clone failed — ${err.message || String(err)}`)
    } finally {
      setCloningTemplate(false)
    }
  }, [cloningTemplate, tableName, recordId, data, onNavigateToRecord, toast])

  // ─── Lifecycle workflow (project_report_templates / email_templates /
  //     document_templates) ───────────────────────────────────────────────
  // Resolve the current template status FROM the loaded record. Picklist map
  // is populated by the page-layout loader at fetchPageLayout time. We read
  // the picklist's machine value (not label) so logic is locale-stable.
  const lifecycle = TEMPLATE_LIFECYCLES[tableName] || null
  const lifecycleStatusValue = (() => {
    if (!lifecycle) return null
    const sid = data?.record?.[lifecycle.statusColumn]
    if (!sid) return null
    return data?.picklists?.valueById?.get(sid) || null
  })()
  // Locked = read-only across header fields, body templates, child rows, and
  // the Edit button. Drafts are unlocked. Archived templates are locked the
  // same way Active ones are; users go through Restore to edit.
  const lifecycleIsLocked = lifecycleStatusValue === 'Active' || lifecycleStatusValue === 'Archived'

  // Generic helper — DRY across publish/unpublish/archive/restore. Wraps the
  // RPC call with toast feedback and a reload tick so the page picks up the
  // new status, version, and *_published_at without a manual refresh.
  const runStatusRpc = useCallback(async (rpcName, successMsg) => {
    if (statusChanging) return
    if (!lifecycle) return
    setStatusChanging(true)
    try {
      const { data: result, error } = await supabase.rpc(rpcName, {
        [lifecycle.rpcIdParam]: recordId,
      })
      if (error) throw error
      const newStatus = result?.new_status
      const newVersion = result?.new_version
      const firstPublish = result?.first_publish
      let msg = successMsg
      if (newStatus === 'Active' && newVersion != null) {
        msg = firstPublish
          ? `Published v${newVersion}`
          : `Re-published as v${newVersion}`
      }
      toast.success(msg)
      // Bump reloadTick to force a fresh fetchPageLayout — pulls the new
      // status, version, and any other fields the RPC mutated.
      setReloadTick(t => t + 1)
    } catch (err) {
      toast.error(err.message || String(err))
    } finally {
      setStatusChanging(false)
    }
  }, [statusChanging, lifecycle, recordId, toast])

  const handlePublish   = useCallback(() => lifecycle && runStatusRpc(lifecycle.publishRpc,   'Published'),                   [runStatusRpc, lifecycle])
  const handleUnpublish = useCallback(() => lifecycle && runStatusRpc(lifecycle.unpublishRpc, 'Unpublished — back to Draft'), [runStatusRpc, lifecycle])
  const handleArchive   = useCallback(() => lifecycle && runStatusRpc(lifecycle.archiveRpc,   'Archived'),                    [runStatusRpc, lifecycle])
  const handleRestore   = useCallback(() => lifecycle && runStatusRpc(lifecycle.restoreRpc,   'Restored to Draft'),           [runStatusRpc, lifecycle])

  // ─── Envelope actions: Void + Resend ─────────────────────────────────────
  // Resolve the envelope's current status value (only meaningful when
  // tableName === 'envelopes'). Mirrors the lifecycleStatusValue pattern —
  // reads the FK on the record, looks up the picklist text by id.
  const envelopeStatusValue = (() => {
    if (tableName !== 'envelopes') return null
    const sid = data?.record?.env_status
    if (!sid) return null
    return data?.picklists?.valueById?.get(sid) || null
  })()
  const envelopeIsVoidable   = ['Draft','Sent','Delivered','Failed'].includes(envelopeStatusValue || '')
  const envelopeIsResendable = ['Sent','Delivered'].includes(envelopeStatusValue || '')

  // Resend — calls the resend-envelope-email edge function with the current
  // record id. The edge function picks the lowest-order pending recipient
  // and re-sends the original signing-request email through the envelope
  // owner's Outlook. We pass window.location.origin as signing_base_url so
  // the magic link resolves to whatever host the user is on (dev/prod).
  const handleResendEnvelope = useCallback(async () => {
    if (envelopeBusy) return
    if (tableName !== 'envelopes') return
    setEnvelopeBusy(true)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase is not configured (missing env vars).')
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) throw new Error('Not signed in — please refresh and log in.')
      const resp = await fetch(`${supabaseUrl}/functions/v1/resend-envelope-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          envelope_id:      recordId,
          signing_base_url: window.location.origin,
        }),
      })
      const j = await resp.json().catch(() => ({}))
      if (!resp.ok || j.ok === false) {
        throw new Error(j.error || j.failure_reason || `Resend failed (${resp.status})`)
      }
      toast.success(`Signing email resent (attempt ${j.attempt_n || '?'})`)
      setReloadTick(t => t + 1)
    } catch (err) {
      toast.error(err.message || String(err))
    } finally {
      setEnvelopeBusy(false)
    }
  }, [envelopeBusy, tableName, recordId, toast])

  // Void — opens the confirm modal. Actual RPC call lives in handleConfirmVoid.
  const handleVoidEnvelope = useCallback(() => {
    if (envelopeBusy) return
    if (tableName !== 'envelopes') return
    setShowVoidConfirm(true)
  }, [envelopeBusy, tableName])

  const handleConfirmVoid = useCallback(async (reason) => {
    if (envelopeBusy) return
    if (tableName !== 'envelopes') return
    setEnvelopeBusy(true)
    try {
      const { data: result, error } = await supabase.rpc('void_envelope', {
        p_envelope_id: recordId,
        p_reason:      reason,
      })
      if (error) throw error
      toast.success(`Voided ${result?.env_record_number || 'envelope'}`)
      setShowVoidConfirm(false)
      setReloadTick(t => t + 1)
    } catch (err) {
      toast.error(err.message || String(err))
    } finally {
      setEnvelopeBusy(false)
    }
  }, [envelopeBusy, tableName, recordId, toast])

  // ─── Preview PDF (project_report_templates only) ──────────────────────────
  // Renders the template against a synthetic in-memory project graph and
  // opens the resulting PDF in a new browser tab. Bypasses the Active-only
  // status gate, so authors can preview Drafts and Archived templates while
  // iterating. No documents row is created and no storage upload happens —
  // the edge function returns the PDF binary directly.
  //
  // We can't use `supabase.functions.invoke()` here because supabase-js
  // assumes a JSON response — for a binary PDF we need raw fetch + blob.
  const handlePreviewPdf = useCallback(async () => {
    if (previewingPdf) return
    if (tableName !== 'project_report_templates') return
    setPreviewingPdf(true)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase is not configured (missing env vars).')
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) throw new Error('Not signed in — please refresh and log in.')

      const resp = await fetch(`${supabaseUrl}/functions/v1/generate-project-report`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preview: true, prt_id: recordId }),
      })

      if (!resp.ok) {
        // Edge function returns JSON for errors and PDF binary for success.
        let detail = `HTTP ${resp.status}`
        try {
          const j = await resp.json()
          if (j?.error) detail = j.error
        } catch { /* response wasn't JSON, keep HTTP code */ }
        throw new Error(detail)
      }

      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      // Open in a new tab. Browsers with PDF viewers will render inline; the
      // rest will trigger a download. We deliberately don't revoke the URL
      // immediately — Safari needs the URL to remain valid while the new tab
      // is loading. Browsers clean these up on page unload.
      const win = window.open(url, '_blank', 'noopener,noreferrer')
      if (!win) {
        // Pop-up blocked — fall back to triggering a download.
        const a = document.createElement('a')
        a.href = url
        a.download = `${data?.record?.prt_record_number || 'template'}_preview.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        toast.success('Preview downloaded — pop-ups are blocked.')
      } else {
        const pageCount = resp.headers.get('X-EES-Page-Count')
        toast.success(pageCount ? `Preview opened — ${pageCount} pages` : 'Preview opened')
      }
    } catch (err) {
      toast.error(`Preview failed — ${err.message || String(err)}`)
    } finally {
      setPreviewingPdf(false)
    }
  }, [previewingPdf, tableName, recordId, data, toast])

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
  // Related second (if any section has related_list widgets), Activity third
  // (not on new records — nothing to show yet), alphabetical after.
  const orderedTabs = buildOrderedTabs(sections, { includeActivity: !isInsertMode })

  const objectLabel = TABLE_META[tableName]?.label || tableName
  const displayName = isCreate
    ? `New ${objectLabel.replace(/s$/, '')}`
    : (record.contact_first_name
        ? `${record.contact_first_name} ${record.contact_last_name || ''}`.trim()
        : record.property_name || record.opportunity_name || record.work_order_name || record.project_name
          || record.building_name || record.unit_name || record.vehicle_name
          || record.account_name || record.skill_name
          || record.product_name || record.equipment_name || record.name || 'Record')

  const recordNumber = record.contact_record_number || record.property_record_number
    || record.opportunity_record_number || record.work_order_record_number || record.project_record_number
    || record.building_record_number || record.vehicle_record_number
    || record.account_record_number || record.skill_record_number
    || record.product_record_number || record.equipment_record_number
    || record.id?.slice(0, 8).toUpperCase() || ''

  const statusRaw = record.contact_status || record.property_status || record.opportunity_status
    || record.work_order_status || record.project_status || record.building_status
    || record.vehicle_status || record.account_status
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
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 32, textAlign: 'center',
      }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary, marginBottom: 8 }}>
          This record can't be displayed right now.
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5, maxWidth: 440, margin: '0 auto' }}>
          The default page layout for this object is missing. An administrator can restore it from Admin → Object Manager, or re-run the layout generator.
        </div>
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
                {tableName === 'projects' && (
                  <button
                    onClick={() => setShowReportModal(true)}
                    aria-label="Generate Report"
                    title="Generate Project Report"
                    style={{
                      background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                      cursor: 'pointer', color: C.emerald,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, minHeight: 44,
                    }}
                  >
                    <Icon path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={18} color="currentColor" />
                  </button>
                )}
                {hasActiveTemplate && (
                  <button
                    onClick={() => setShowSendSignatureModal(true)}
                    aria-label="Send for Signature"
                    title="Send a document for e-signature against this record"
                    style={{
                      background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                      cursor: 'pointer', color: C.emerald,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, minHeight: 44,
                    }}
                  >
                    {/* lucide: feather — a quill, instantly read as 'sign here' and visually distinct from the Edit pencil */}
                    <Icon path="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z M16 8L2 22 M17.5 15H9" size={18} color="currentColor" />
                  </button>
                )}
                {tableName === 'envelopes' && envelopeIsResendable && (
                  <button
                    onClick={handleResendEnvelope}
                    disabled={envelopeBusy}
                    aria-label="Resend Signing Email"
                    title="Resend the signing-request email to the current pending signer"
                    style={{
                      background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                      cursor: envelopeBusy ? 'wait' : 'pointer', color: '#0369a1',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, minHeight: 44, opacity: envelopeBusy ? 0.6 : 1,
                    }}
                  >
                    {/* lucide: send-horizontal */}
                    <Icon path="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.4 1.05L3.5 11l13.5 1L3.5 13l-1.5 6.35a1 1 0 0 0 1.4 1.05z" size={18} color="currentColor" />
                  </button>
                )}
                {tableName === 'envelopes' && envelopeIsVoidable && (
                  <button
                    onClick={handleVoidEnvelope}
                    disabled={envelopeBusy}
                    aria-label="Void Envelope"
                    title="Void this envelope — invalidates outstanding signing links"
                    style={{
                      background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                      cursor: envelopeBusy ? 'wait' : 'pointer', color: '#b45309',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, minHeight: 44, opacity: envelopeBusy ? 0.6 : 1,
                    }}
                  >
                    {/* lucide: ban — circle with diagonal slash */}
                    <Icon path="M18.36 5.64a9 9 0 1 1-12.72 0M5.64 5.64l12.72 12.72" size={18} color="currentColor" />
                  </button>
                )}
                {tableName === 'project_report_templates' && (
                  <button
                    onClick={handlePreviewPdf}
                    disabled={previewingPdf}
                    aria-label="Preview PDF"
                    title="Preview PDF (sample data)"
                    style={{
                      background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                      cursor: previewingPdf ? 'wait' : 'pointer', color: '#0369a1',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, minHeight: 44, opacity: previewingPdf ? 0.6 : 1,
                    }}
                  >
                    <Icon path="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" size={18} color="currentColor" />
                  </button>
                )}
                {lifecycle && (
                  <button
                    onClick={handleCloneTemplate}
                    disabled={cloningTemplate}
                    aria-label="Clone Template"
                    title={lifecycle.childrenTable ? `Clone Template (with ${lifecycle.childrenLabel})` : 'Clone Template'}
                    style={{
                      background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                      cursor: cloningTemplate ? 'wait' : 'pointer', color: C.emerald,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, minHeight: 44, opacity: cloningTemplate ? 0.6 : 1,
                    }}
                  >
                    <Icon path="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" size={18} color="currentColor" />
                  </button>
                )}
                {lifecycle && lifecycleStatusValue === 'Draft' && (
                  <button
                    onClick={handlePublish}
                    disabled={statusChanging}
                    aria-label="Publish"
                    title="Publish to Active"
                    style={{
                      background: statusChanging ? '#a7f3d0' : C.emerald, border: 'none', padding: 10, borderRadius: 6,
                      cursor: statusChanging ? 'wait' : 'pointer', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, minHeight: 44,
                    }}
                  >
                    <Icon path="M5 13l4 4L19 7" size={18} color="#fff" />
                  </button>
                )}
                {lifecycle && lifecycleStatusValue === 'Active' && (
                  <button
                    onClick={handleUnpublish}
                    disabled={statusChanging}
                    aria-label="Unpublish"
                    title="Unpublish to Draft"
                    style={{
                      background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                      cursor: statusChanging ? 'wait' : 'pointer', color: '#b45309',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, minHeight: 44, opacity: statusChanging ? 0.6 : 1,
                    }}
                  >
                    <Icon path="M3 10h11a4 4 0 014 4v0a4 4 0 01-4 4h-3M3 10l5 5m-5-5l5-5" size={18} color="currentColor" />
                  </button>
                )}
                {lifecycle && lifecycleStatusValue === 'Archived' && (
                  <button
                    onClick={handleRestore}
                    disabled={statusChanging}
                    aria-label="Restore"
                    title="Restore to Draft"
                    style={{
                      background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
                      cursor: statusChanging ? 'wait' : 'pointer', color: C.emerald,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 44, minHeight: 44, opacity: statusChanging ? 0.6 : 1,
                    }}
                  >
                    <Icon path="M3 10h11a4 4 0 014 4v0a4 4 0 01-4 4h-3M3 10l5 5m-5-5l5-5" size={18} color="currentColor" />
                  </button>
                )}
                {!lifecycleIsLocked && (
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
                )}
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
                {tableName === 'projects' && (
                  <button
                    onClick={() => setShowReportModal(true)}
                    title="Generate a PDF project report saved to this project's Documents"
                    style={{ background: C.page, color: C.emerald, border: `1px solid #a7f3d0`, borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#ecfdf5' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = C.page }}
                  >
                    <Icon path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={13} color={C.emerald} />
                    Generate Report
                  </button>
                )}
                {hasActiveTemplate && (
                  <button
                    onClick={() => setShowSendSignatureModal(true)}
                    title="Send a document for e-signature against this record"
                    style={{ background: C.page, color: C.emerald, border: `1px solid #a7f3d0`, borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#ecfdf5' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = C.page }}
                  >
                    <Icon path="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z M16 8L2 22 M17.5 15H9" size={13} color={C.emerald} />
                    Send for Signature
                  </button>
                )}
                {tableName === 'envelopes' && envelopeIsResendable && (
                  <button
                    onClick={handleResendEnvelope}
                    disabled={envelopeBusy}
                    title="Resend the signing-request email to the current pending signer"
                    style={{ background: envelopeBusy ? '#e0f2fe' : C.page, color: '#0369a1', border: `1px solid #bae6fd`, borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: envelopeBusy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: envelopeBusy ? 0.85 : 1 }}
                    onMouseEnter={(e) => { if (!envelopeBusy) e.currentTarget.style.background = '#f0f9ff' }}
                    onMouseLeave={(e) => { if (!envelopeBusy) e.currentTarget.style.background = C.page }}
                  >
                    <Icon path="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.4 1.05L3.5 11l13.5 1L3.5 13l-1.5 6.35a1 1 0 0 0 1.4 1.05z" size={13} color="#0369a1" />
                    {envelopeBusy ? 'Resending…' : 'Resend Email'}
                  </button>
                )}
                {tableName === 'envelopes' && envelopeIsVoidable && (
                  <button
                    onClick={handleVoidEnvelope}
                    disabled={envelopeBusy}
                    title="Void this envelope — invalidates outstanding signing links"
                    style={{ background: C.page, color: '#b45309', border: '1px solid #fcd34d', borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: envelopeBusy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: envelopeBusy ? 0.7 : 1 }}
                    onMouseEnter={(e) => { if (!envelopeBusy) e.currentTarget.style.background = '#fffbeb' }}
                    onMouseLeave={(e) => { if (!envelopeBusy) e.currentTarget.style.background = C.page }}
                  >
                    <Icon path="M18.36 5.64a9 9 0 1 1-12.72 0M5.64 5.64l12.72 12.72" size={13} color="#b45309" />
                    Void
                  </button>
                )}
                {tableName === 'project_report_templates' && (
                  <button
                    onClick={handlePreviewPdf}
                    disabled={previewingPdf}
                    title="Render this template against sample data and open the PDF in a new tab — works in any status, doesn't save anything"
                    style={{ background: previewingPdf ? '#e0f2fe' : C.page, color: '#0369a1', border: `1px solid #bae6fd`, borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: previewingPdf ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: previewingPdf ? 0.85 : 1 }}
                    onMouseEnter={(e) => { if (!previewingPdf) e.currentTarget.style.background = '#f0f9ff' }}
                    onMouseLeave={(e) => { if (!previewingPdf) e.currentTarget.style.background = C.page }}
                  >
                    <Icon path="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" size={13} color="#0369a1" />
                    {previewingPdf ? 'Rendering…' : 'Preview PDF'}
                  </button>
                )}
                {lifecycle && (
                  <button
                    onClick={handleCloneTemplate}
                    disabled={cloningTemplate}
                    title={lifecycle.childrenTable
                      ? `Duplicate this template AND all its ${lifecycle.childrenLabel}, reset to Draft / version 1`
                      : 'Duplicate this template, reset to Draft / version 1'}
                    style={{ background: cloningTemplate ? '#86efac' : C.page, color: C.emerald, border: `1px solid #a7f3d0`, borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: cloningTemplate ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: cloningTemplate ? 0.85 : 1 }}
                    onMouseEnter={(e) => { if (!cloningTemplate) e.currentTarget.style.background = '#ecfdf5' }}
                    onMouseLeave={(e) => { if (!cloningTemplate) e.currentTarget.style.background = C.page }}
                  >
                    <Icon path="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" size={13} color={C.emerald} />
                    {cloningTemplate ? 'Cloning…' : 'Clone Template'}
                  </button>
                )}
                {lifecycle && lifecycleStatusValue === 'Draft' && (
                  <button
                    onClick={handlePublish}
                    disabled={statusChanging}
                    title="Publish this template — locks editing and makes it generatable"
                    style={{ background: statusChanging ? '#a7f3d0' : C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: statusChanging ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <Icon path="M5 13l4 4L19 7" size={13} color="#fff" />
                    {statusChanging ? 'Publishing…' : 'Publish'}
                  </button>
                )}
                {lifecycle && lifecycleStatusValue === 'Active' && (
                  <>
                    <button
                      onClick={handleUnpublish}
                      disabled={statusChanging}
                      title="Unpublish back to Draft so the template can be edited"
                      style={{ background: C.page, color: '#b45309', border: '1px solid #fcd34d', borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: statusChanging ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: statusChanging ? 0.7 : 1 }}
                    >
                      <Icon path="M3 10h11a4 4 0 014 4v0a4 4 0 01-4 4h-3M3 10l5 5m-5-5l5-5" size={13} color="#b45309" />
                      {statusChanging ? '…' : 'Unpublish'}
                    </button>
                    <button
                      onClick={handleArchive}
                      disabled={statusChanging}
                      title="Archive this template — retired but kept for history"
                      style={{ background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 14px', fontSize: 12.5, cursor: statusChanging ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: statusChanging ? 0.7 : 1 }}
                    >
                      <Icon path="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" size={13} color={C.textSecondary} />
                      Archive
                    </button>
                  </>
                )}
                {lifecycle && lifecycleStatusValue === 'Archived' && (
                  <button
                    onClick={handleRestore}
                    disabled={statusChanging}
                    title="Restore this template to Draft so it can be edited"
                    style={{ background: C.page, color: C.emerald, border: `1px solid #a7f3d0`, borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: statusChanging ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: statusChanging ? 0.7 : 1 }}
                  >
                    <Icon path="M3 10h11a4 4 0 014 4v0a4 4 0 01-4 4h-3M3 10l5 5m-5-5l5-5" size={13} color={C.emerald} />
                    {statusChanging ? '…' : 'Restore to Draft'}
                  </button>
                )}
                {!lifecycleIsLocked && (
                  <button onClick={startEditing} style={{ background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>Edit</button>
                )}
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
            className={isMobile ? 'ees-hscroll' : ''}
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

        {/* Locked-state banner — shown above sections for Active/Archived
            templates of any lifecycle-bearing type (PRT / ET / DT).
            Communicates why fields are read-only and points the user to the
            right path forward. */}
        {lifecycleIsLocked && (
          <div style={{
            background: lifecycleStatusValue === 'Archived' ? '#f3f4f6' : '#fffbeb',
            border: `1px solid ${lifecycleStatusValue === 'Archived' ? '#d1d5db' : '#fde68a'}`,
            borderLeftWidth: 4,
            borderLeftColor: lifecycleStatusValue === 'Archived' ? '#6b7280' : '#d97706',
            borderRadius: 8, padding: '12px 16px', marginBottom: 14,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <Icon
              path={lifecycleStatusValue === 'Archived'
                ? 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4'
                : 'M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0L3.34 16a2 2 0 001.73 3z'}
              size={16}
              color={lifecycleStatusValue === 'Archived' ? '#4b5563' : '#b45309'}
            />
            <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, color: lifecycleStatusValue === 'Archived' ? '#374151' : '#78350f' }}>
              {lifecycleStatusValue === 'Active' ? (
                <>
                  <strong>This template is published and locked.</strong> Header fields{lifecycle?.childrenLabel ? `, ${lifecycle.childrenLabel}` : ''}, body{lifecycle?.childrenLabel ? ' templates' : ''}, and configuration are read-only while a template is Active. To make changes: <em>Unpublish</em> back to Draft, or use <em>Clone Template</em> to start a new draft from this one. Re-publishing increments the version.
                </>
              ) : (
                <>
                  <strong>This template is archived.</strong> It cannot be used and its contents are read-only. Use <em>Restore to Draft</em> to bring it back into editable state, or use <em>Clone Template</em> to start fresh.
                </>
              )}
            </div>
          </div>
        )}

        {/* Sections — field groups only. Filter by active tab. For
            document_templates we also skip the Document Content section
            when authoring mode is "docx" (the body_html field is
            irrelevant in that mode — the .docx asset replaces it). */}
        {sections
          .filter(sec => (sec.section_tab || 'Details') === activeTab)
          .filter(sec => {
            if (tableName !== 'document_templates') return true
            if (sec.section_label !== 'Document Content') return true
            const modeId = data?.record?.dt_authoring_mode
            const modeValue = modeId ? data?.picklists?.valueById?.get(modeId) : null
            return modeValue !== 'docx'
          })
          .map(sec => {
            // Per-field disabled reasons. For document_templates we mark
            // dt_template_asset_path inactive when mode is HTML so the
            // upload UI explicitly says "switch to docx mode first" rather
            // than letting users upload a file the renderer will ignore.
            // The merge_field_reference widget is also docx-only — no
            // point in browsing tokens for the inline HTML editor since
            // it has its own merge field picker built in.
            let fieldDisabledReasons = null
            let hiddenWidgetTypes = null
            if (tableName === 'document_templates') {
              const modeId = data?.record?.dt_authoring_mode
              const modeValue = modeId ? data?.picklists?.valueById?.get(modeId) : null
              if (modeValue !== 'docx') {
                fieldDisabledReasons = {
                  dt_template_asset_path: 'Set Authoring Mode to "Word Document (.docx)" before uploading.',
                }
                hiddenWidgetTypes = new Set(['merge_field_reference'])
              }
            }
            return (
              <Section key={sec.id} section={sec} record={record} picklists={picklists} lookups={lookups}
                editing={editing} draft={draft} onChange={handleFieldChange}
                allPicklistOpts={allPicklistOpts} allLookupOpts={allLookupOpts} tableName={tableName}
                onRefreshRecord={() => setReloadTick(t => t + 1)} recordId={recordId}
                fieldDisabledReasons={fieldDisabledReasons} hiddenWidgetTypes={hiddenWidgetTypes} />
            )
          })}

        {/* Related lists — standalone Salesforce-style cards, shown only on
            the Related tab regardless of which section they came from. */}
        {!isInsertMode && activeTab === 'Related' && sections
          .flatMap(sec => (sec.widgets || []).filter(w => w.widget_type === 'related_list'))
          .map(w => {
            // Lock child related_lists when the parent template is Active or
            // Archived. We match the widget's table against the lifecycle's
            // childrenTable (e.g. project_report_template_sections for PRT).
            // Sibling related_lists (record-type assignments, etc.) stay
            // editable. We force editable=false on the widget copy so the
            // Add button + drag handles + remove buttons all disappear; the
            // trigger is the ultimate enforcement layer.
            const isLockedChildrenList = lifecycleIsLocked
              && lifecycle?.childrenTable
              && w.widget_config?.table === lifecycle.childrenTable
            const effectiveWidget = isLockedChildrenList
              ? { ...w, widget_config: { ...w.widget_config, editable: false } }
              : w
            return (
              <RelatedListWidget
                key={w.id}
                widget={effectiveWidget}
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
            )
          })}

        {/* File galleries — photos and documents widgets. Self-contained:
            each widget loads its own data, owns its own upload/delete UI,
            and refreshes after mutations without going back through the
            page-layout loader. */}
        {!isInsertMode && activeTab === 'Related' && sections
          .flatMap(sec => (sec.widgets || []).filter(w => w.widget_type === 'file_gallery'))
          .map(w => (
            <FileGalleryWidget
              key={w.id}
              widget={w}
              parentTable={tableName}
              parentRecordId={recordId}
            />
          ))}

        {/* PRTSN history — Versions list for project_report_templates only.
            Self-contained widget that fetches snapshots for the current PRT
            and offers a Preview-from-snapshot action per version. */}
        {!isInsertMode && activeTab === 'Related' && sections
          .flatMap(sec => (sec.widgets || []).filter(w => w.widget_type === 'prtsn_history'))
          .map(w => (
            <PrtsnHistoryWidget
              key={w.id}
              widget={w}
              parentRecordId={recordId}
            />
          ))}

        {/* Activity Timeline — chronological audit trail of tracked field
            changes and record-level actions (create, soft-delete, restore).
            Hidden on new records since there's no history yet. */}
        {!isInsertMode && activeTab === 'Activity' && (
          <ActivityTimeline tableName={tableName} recordId={recordId} />
        )}
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

      {/* Void envelope confirmation — only mounted on envelope records when
          status allows void. Captures a required reason and calls the
          void_envelope RPC, which updates env_status, expires outstanding
          tokens, and logs a Voided envelope_event with the reason. */}
      {showVoidConfirm && tableName === 'envelopes' && (
        <VoidEnvelopeModal
          envelopeRecordNumber={data?.record?.env_record_number || ''}
          busy={envelopeBusy}
          onConfirm={handleConfirmVoid}
          onCancel={() => setShowVoidConfirm(false)}
        />
      )}

      {/* Project report generator (only mounted on projects, opt-in via toolbar button) */}
      {showReportModal && tableName === 'projects' && (
        <ProjectReportModal
          projectId={recordId}
          project={record}
          onClose={() => setShowReportModal(false)}
          onComplete={() => { setReloadTick(t => t + 1) }}
        />
      )}

      {/* Send-for-Signature modal — opt-in via toolbar button on signable
          parent records. Reads template state directly from Supabase, calls
          send-envelope, displays signing URLs. After successful send the
          envelope row exists; the parent's Documents related-list will
          show the signed PDF after the last recipient signs. */}
      {showSendSignatureModal && hasActiveTemplate && (
        <SendForSignatureModal
          open
          parentObject={tableName}
          parentRecordId={recordId}
          parentRecordLabel={record?.name || record?.project_record_number || record?.property_record_number || record?.opportunity_record_number || record?.work_order_record_number || null}
          onClose={() => setShowSendSignatureModal(false)}
        />
      )}
    </div>
  )
}
