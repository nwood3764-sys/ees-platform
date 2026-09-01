import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../data/constants'
import { Badge, Icon } from './UI'

// Heavy modals that only render on specific user actions are lazy-loaded
// so they don't bloat the RecordDetail chunk that ships on every record
// open. Combined size of the five modals: ~3,600 lines. After this
// change they ship as five small chunks fetched on demand the first
// time the user clicks the corresponding toolbar action.
//
// Why lazy each one individually rather than rolling them into a
// single 'record-modals' chunk: each modal pulls in different
// dependencies (the scheduler wizards drag in a multi-step state
// machine + map components; the signature modal drags in PDF
// preview code). A combined chunk would still be large; per-modal
// splits give Vite the freedom to share only what's truly shared.
const ProjectReportModal                  = lazy(() => import('./ProjectReportModal'))
const ProjectSubmittalDocumentsModal      = lazy(() => import('./ProjectSubmittalDocumentsModal'))
const SubmittalDocumentTemplateEditor     = lazy(() => import('./SubmittalDocumentTemplateEditor'))
const ProjectSchedulerWizard              = lazy(() => import('./scheduler/ProjectSchedulerWizard'))
const ServiceAppointmentRescheduleModal   = lazy(() => import('./scheduler/ServiceAppointmentRescheduleModal'))
const WorkOrderScheduleModal              = lazy(() => import('./scheduler/WorkOrderScheduleModal'))
const IssueToProviderModal                = lazy(() => import('./IssueToProviderModal'))
const SendForSignatureModal               = lazy(() => import('./SendForSignatureModal'))
const AccountMergeModal                    = lazy(() => import('./AccountMergeModal'))
const AddToPortalModal                     = lazy(() => import('./AddToPortalModal'))
const ManageSharedRecordsModal             = lazy(() => import('./ManageSharedRecordsModal'))
const LogActivityModal                     = lazy(() => import('./LogActivityModal'))
const QualityInstallPhotoPickerModal       = lazy(() => import('./QualityInstallPhotoPickerModal'))
const EnergyAssessmentReportModal          = lazy(() => import('./EnergyAssessmentReportModal'))
const SubmittedEnrollmentModal      = lazy(() => import('./SubmittedEnrollmentModal'))
const HomesProposalModal            = lazy(() => import('./HomesProposalModal'))
// The work plan runner from LEAP Pad, mounted inside the work order record page
// so desk staff follow steps and upload evidence without leaving the main app.
// Same component the technician PWA runs — one engine, not a desktop copy.
const WorkPlanRunner                       = lazy(() => import('../fieldMobile/WorkOrderDetail'))

import { useToast } from './Toast'
import { blockNegativeKeys, nonNegativeMin } from '../lib/numberInput'
import { formatUsPhoneDisplay } from '../lib/fieldLinks'
import { holdAppReload } from '../lib/appUpdate'
import { contractorContactPairsFor, resolveContractorContact } from '../lib/contractorContact'
import FieldValueLink from './FieldValueLink'
import DeletedRecordBanner from './DeletedRecordBanner'
import { useIsMobile, useMediaQuery } from '../lib/useMediaQuery'
import { getTableListUrl, buildScopedListUrl, pushRecordSubPath } from '../lib/urlNav'
import { objectNavFor, humanizeObjectLabel } from '../lib/objectNav'
import { shouldCondenseHeader, stickyHeaderBandStyle, stickyTabBarStyle } from '../lib/stickyRecordHeader'
import { useDataRefresh } from '../lib/dataRefresh'
import ActivityTimeline from './ActivityTimeline'
import FileGalleryWidget from './FileGallery'
import IncomeQualificationPanel from './IncomeQualificationPanel'
import PropertyOwnerResearchPanel from './PropertyOwnerResearchPanel'
import { runIncomeQualification } from '../data/incomeQualificationService'
import { openAssessmentPreapprovalForm, openAssessmentApplicationForm, openPaymentRequestForm,
         loadAssessmentPrefill, findMissingRequiredFields } from '../data/preapprovalPrefill'
import { recordRecentlyViewed } from '../data/recentlyViewedService'
import ConversationPanelWidget from './ConversationPanel'
import ConversationMessagesWidget from './ConversationMessagesWidget'
import ConversationListWidget from './ConversationListWidget'
import OpportunityProductsWidget from './OpportunityProductsWidget'
import StatusPathWidget from './StatusPathWidget'
import { ReportWidget } from './ReportWidget'
import PropertyMapWidget from './PropertyMapWidget'
import StatusTransitionsBar from './StatusTransitionsBar'
import TopbarActions from './TopbarActions'
import { ACTION_KEYS } from '../data/recordActions'
import { SUBMITTAL_STAGES } from '../data/paperworkSubmittals'
import { supabase } from '../lib/supabase'
import DuplicateCheckPanel, { DUPLICATE_CHECK_TABLES, buildDuplicateProbe } from './DuplicateCheckPanel'
import { getSectionConfigSchema, buildDefaultConfig } from '../data/sectionConfigSchemas'
import { getSectionFilterSchema } from '../data/sectionFilterSchemas'
import { MERGE_FIELD_OBJECTS, loadFieldsForObject } from '../data/mergeFieldCatalog'
import { resolveLookupLabel, getEditableFieldsForTable } from '../data/fieldMetadataService'
import { isSystemAuditField, isSystemAuditColumn, fieldRenderKey } from '../lib/systemAuditFields'
import { slotTypesOnSurface, missingRequiredDocuments } from '../lib/documentSlots'
import { CARD_WIDGET_TYPES } from '../lib/layoutCards.js'
import {
  uploadDocumentTemplateAsset,
  signedDocumentTemplateAssetUrl,
  copyDocumentTemplateAsset,
  uploadAvatar,
  listDocuments,
} from '../data/storageService'
import {
  loadRecordDetailData,
  saveRecord,
  insertRecord,
  deleteRecord,
  fetchTableMetadata,
  fetchPicklistOptions,
  fetchLookupOptions,
  fetchDependentLookupOptions,
  fetchPageLayout,
  getTableColumnPrefix,
  fetchPicklistLabelsByIds,
  loadPicklists as loadAllPicklists,
  getCurrentUserId,
  getCurrentUserProfile,
  fetchRelatedRecords,
  resolveLookups,
  reorderJunctionRows,
  fetchPickerCandidates,
  addJunctionRow,
  removeJunctionRow,
  applyInsertDefaults,
  getRecordTypeValue,
  getRecordTypeColumn,
  fetchAvailableRecordTypes,
  fetchConstrainingParentForCreate,
  fetchConstrainingParentCandidates,
  fetchOpportunityInheritedFields,
  fetchProgramStateForCreate,
} from '../data/layoutService'
import RecordTypePicker from './RecordTypePicker'
import { resolveParentChoice } from '../lib/constrainingParentChoice'
import { buildCreateModalGroups, listUnlaidOutRequiredColumns } from '../lib/createRecordFields'
import { recordTypeSeedValue } from '../lib/recordTypeSeed'
import { recordStateValue } from '../lib/picklistStateScope'
import { isChoiceColumn, getChoiceOptions } from '../data/choiceColumns'
import { RecordVisualBadge } from '../lib/recordTypeIcons'
import RecordLink from './RecordLink'

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

// Format a numeric/date value against a logical return type — shared by the
// currency/percent/etc. cases and by formula/rollup fields (whose displayed
// type is their declared return type, carried on the field def as return_type).
function formatByReturnType(raw, returnType) {
  switch (returnType) {
    case 'currency': return `$${Number(raw).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    case 'percent':  return `${Number(raw)}%`
    case 'date':     return raw ? new Date(String(raw).length <= 10 ? raw + 'T00:00:00' : raw).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
    case 'datetime': return raw ? new Date(raw).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
    case 'boolean':  return raw ? 'Yes' : 'No'
    case 'number':   return Number(raw).toLocaleString()
    case 'phone':    return formatUsPhoneDisplay(raw)
    default:         return typeof raw === 'number' ? raw.toLocaleString() : String(raw)
  }
}

// Normalize a US phone value to the bare 10-digit form the DB check constraint
// (^\d{10}$) requires. Accepts anything a user types or pastes —
// "(515) 297-8363", "515-297-8363", "515.297.8363", "+1 515 297 8363",
// "1-515-297-8363" — and returns "5152978363". A value that can't be reduced
// to a clean 10-digit US number is returned unchanged, so a genuinely invalid
// entry still surfaces the constraint error rather than being silently mangled.
function normalizeUsPhone(value) {
  if (value == null || value === '') return value
  const digits = String(value).replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1)
  return value
}

// Collect the names of every field declared as type 'phone' across a layout's
// field groups — used to normalize only real phone columns at save time.
function collectPhoneFieldNames(sections) {
  const names = new Set()
  for (const sec of (sections || [])) {
    for (const w of (sec.widgets || [])) {
      if (w.widget_type !== 'field_group') continue
      for (const f of (w.widget_config?.fields || [])) {
        if (f?.type === 'phone' && f.name) names.add(f.name)
      }
    }
  }
  return names
}

// Rewrite phone-typed keys of `payload` in place to their normalized 10-digit
// form. `phoneNames` is a Set of field names known to be phones.
function normalizePhoneFieldsInPlace(payload, phoneNames) {
  if (!phoneNames || phoneNames.size === 0) return
  for (const name of phoneNames) {
    if (name in payload) payload[name] = normalizeUsPhone(payload[name])
  }
}

// Full US state / territory name -> USPS two-letter abbreviation. Used by the
// `us_state_abbrev` field format so program forms (e.g. the IRA HOMES
// reservation) show "WI" even when the source record stores "Wisconsin".
// Already-abbreviated or unrecognized values pass through unchanged.
const US_STATE_ABBREV = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'puerto rico': 'PR',
}
function usStateAbbrev(v) {
  if (v == null) return v
  const s = String(v).trim()
  return US_STATE_ABBREV[s.toLowerCase()] || s
}

function formatFieldValue(raw, fieldDef, picklists, lookups) {
  if (raw === null || raw === undefined) return '—'
  // Value-shaping format hints apply regardless of the underlying type.
  if (fieldDef.format === 'us_state_abbrev') return usStateAbbrev(raw) || '—'
  switch (fieldDef.type) {
    case 'picklist':   return picklists.byId.get(raw) || String(raw)
    case 'select': {
      const opt = (fieldDef.options || []).find(o => o.value === raw)
      return opt ? opt.label : String(raw)
    }
    case 'phone':      return formatUsPhoneDisplay(raw)
    // Formula / rollup / inherited fields are computed at read; format by the
    // field's declared return type (falls back to a sensible numeric/text guess).
    case 'formula':
    case 'rollup':
    case 'inherited':  return formatByReturnType(raw, fieldDef.return_type || fieldDef.formula_return_type)
    case 'lookup':
    case 'polymorphic_lookup': {
      const entry = lookups.get(raw)
      // resolveLookups returns { label, table } objects. Tolerate the older
      // plain-string shape during the in-flight transition.
      if (entry == null) return String(raw).slice(0, 8) + '…'
      if (typeof entry === 'string') return entry
      return entry.label || (String(raw).slice(0, 8) + '…')
    }
    case 'currency':   return `$${Number(raw).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    case 'percent':    return `${Number(raw)}%`
    case 'date': {
      if (!raw) return '—'
      const d = new Date(String(raw).length <= 10 ? raw + 'T00:00:00' : raw)
      // Optional per-field display format. 'MM/DD/YY' matches external program
      // forms that use a 2-digit year (e.g. the pre-approval application).
      if (fieldDef.format === 'MM/DD/YY') {
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const dd = String(d.getDate()).padStart(2, '0')
        const yy = String(d.getFullYear()).slice(-2)
        return `${mm}/${dd}/${yy}`
      }
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    }
    case 'datetime':   return raw ? new Date(raw).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
    case 'boolean':    return raw ? 'Yes' : 'No'
    case 'number':     return raw != null ? Number(raw).toLocaleString() : '—'
    case 'multiselect': {
      if (!Array.isArray(raw) || raw.length === 0) return '—'
      const labelByValue = new Map((fieldDef.options || []).map(o => [o.value, o.label]))
      return raw.map(v => labelByValue.get(v) || v).join(', ')
    }
    case 'url':
    case 'email':      return String(raw)
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

// ---------------------------------------------------------------------------

// Proper English singularization for object labels. Used by both the create-
// header ("New Property" from "Properties") and the record-type picker. The
// previous naïve `.replace(/s$/, '')` produced "Propertie" from "Properties"
// and "Opportunitie" from "Opportunities" — the y->ies pluralization case.
function singularizeLabel(word) {
  if (!word) return word
  // Words that don't pluralize at all even though they end in s.
  if (/(equipment|news|series|species)$/i.test(word)) return word
  // -ies -> -y  (properties -> property, opportunities -> opportunity)
  if (/ies$/i.test(word)) return word.slice(0, -3) + 'y'
  // -ches, -shes, -xes, -zes, -sses -> drop -es
  if (/(ches|shes|xes|zes|sses)$/i.test(word)) return word.slice(0, -2)
  // -s -> drop the s
  if (/s$/i.test(word)) return word.slice(0, -1)
  return word
}

// Per-table display metadata. `nameColumn` and `recordNumberColumn` drive the
// detail-page header (replacing the long hard-coded `record.foo || record.bar
// || ...` fallback chains that used to live inline). `parents` lists FK columns
// in breadcrumb order — innermost (most specific) parent first. `parentTables`
// gives the table for each parent FK so the breadcrumb crumbs are clickable.
// Adding a new object to LEAP now just means adding one row here.
const TABLE_META = {
  accounts:                  { module: 'Enrollment',       label: 'Accounts',             nameColumn: 'account_name',           recordNumberColumn: 'account_record_number',           statusColumn: 'account_status',           parents: ['parent_account_id'],                              parentTables: ['accounts'] },
  contacts:                  { module: 'Enrollment',       label: 'Contacts',             nameColumn: 'contact_name',           recordNumberColumn: 'contact_record_number',           statusColumn: 'contact_status',           parents: ['contact_account_id'],                             parentTables: ['accounts'] },
  account_contact_relations: { module: 'Enrollment',       label: 'Account Contact Roles',nameColumn: null,                     recordNumberColumn: 'acr_record_number',               statusColumn: null,                       parents: ['account_id', 'contact_id'],                       parentTables: ['accounts', 'contacts'] },
  properties:                { module: 'Enrollment',       label: 'Properties',           nameColumn: 'property_name',          recordNumberColumn: 'property_record_number',          statusColumn: 'property_status',          parents: ['property_account_id'],                            parentTables: ['accounts'] },
  buildings:                 { module: 'Enrollment',       label: 'Buildings',            nameColumn: 'building_name',          recordNumberColumn: 'building_record_number',          statusColumn: 'building_status',          parents: ['property_id'],                                    parentTables: ['properties'] },
  units:                     { module: 'Enrollment',       label: 'Units',                nameColumn: 'unit_name',              recordNumberColumn: 'unit_record_number',              statusColumn: 'unit_status',              parents: ['building_id'],                                    parentTables: ['buildings'] },
  opportunities:             { module: 'Enrollment',       label: 'Opportunities',        nameColumn: 'opportunity_name',       recordNumberColumn: 'opportunity_record_number',       statusColumn: 'opportunity_status',       parents: ['property_id', 'building_id', 'opportunity_account_id'],          parentTables: ['properties', 'buildings', 'accounts'] },
  opportunity_contact_roles: { module: 'Enrollment',       label: 'Contact Role',         nameColumn: 'ocr_name',               recordNumberColumn: 'ocr_record_number',               statusColumn: null,                       parents: ['opportunity_id', 'contact_id'],                   parentTables: ['opportunities', 'contacts'] },
  opportunity_line_items:    { module: 'Enrollment',       label: 'Opportunity Line Items', nameColumn: 'oli_name',             recordNumberColumn: 'oli_record_number',               statusColumn: null,                       parents: ['opportunity_id'],                                 parentTables: ['opportunities'] },
  price_books:               { module: 'Stock',            label: 'Price Books',          nameColumn: 'price_book_name',        recordNumberColumn: 'price_book_record_number',        statusColumn: null,                       parents: [],                                                 parentTables: [] },
  price_book_entries:        { module: 'Stock',            label: 'Price Book Entries',   nameColumn: 'price_book_entry_name',  recordNumberColumn: 'price_book_entry_record_number',  statusColumn: null,                       parents: ['price_book_id', 'product_id'],                    parentTables: ['price_books', 'products'] },
  opportunity_record_type_price_books: { module: 'Admin',  label: 'Record Type Price Books', nameColumn: null,                  recordNumberColumn: 'ortpb_record_number',             statusColumn: null,                       parents: ['price_book_id'],                                  parentTables: ['price_books'] },
  property_programs:         { module: 'Enrollment',       label: 'Enrollment',           nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: ['property_id'],                                    parentTables: ['properties'] },
  // An enrollment is tied to a building THROUGH its opportunity, not to a
  // property (Nicholas, 2026-08-17). Opportunity leads the parent list so a
  // child created from an enrollment inherits the anchor first; building and
  // property follow and are filled by the DB trigger
  // enrollment_inherit_from_opportunity.
  enrollments:               { module: 'Enrollment',       label: 'Enrollments',          nameColumn: 'enrollment_name',        recordNumberColumn: 'enrollment_record_number',        statusColumn: 'enrollment_status',        parents: ['opportunity_id', 'building_id', 'property_id'],   parentTables: ['opportunities', 'buildings', 'properties'] },
  work_orders:               { module: 'Field',          label: 'Work Orders',          nameColumn: 'work_order_name',        recordNumberColumn: 'work_order_record_number',        statusColumn: 'work_order_status',        parents: ['project_id', 'opportunity_id', 'property_id', 'building_id'],       parentTables: ['projects', 'opportunities', 'properties', 'buildings'] },
  projects:                  { module: 'Field',          label: 'Projects',             nameColumn: 'project_name',           recordNumberColumn: 'project_record_number',           statusColumn: 'project_status',           parents: ['property_id', 'building_id', 'opportunity_id', 'project_account_id'], parentTables: ['properties', 'buildings', 'opportunities', 'accounts'] },
  // opportunity_id and project_id are declared parents so a child created FROM
  // an assessment (its work order) inherits both, not just the property and
  // building — work_orders.project_id is NOT NULL and the assessment knows its
  // project (derive_assessment_project, migration 20260817163750).
  assessments:               { module: 'Qualification',  label: 'Assessments',          nameColumn: 'assessment_name',        recordNumberColumn: 'assessment_record_number',        statusColumn: 'assessment_status',        parents: ['property_id', 'building_id', 'opportunity_id', 'project_id'], parentTables: ['properties', 'buildings', 'opportunities', 'projects'] },
  incentive_applications:    { module: 'Qualification',  label: 'Incentive Applications', nameColumn: 'ia_name',                recordNumberColumn: 'ia_record_number',                statusColumn: 'ia_status',                parents: ['opportunity_id', 'property_id', 'building_id', 'project_id'], parentTables: ['opportunities', 'properties', 'buildings', 'projects'] },
  efr_reports:               { module: 'Qualification',  label: 'EFR Reports',          nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: ['property_id'],                                    parentTables: ['properties'] },
  project_payment_requests:  { module: 'Incentives',     label: 'Payment Requests',     nameColumn: null,                     recordNumberColumn: 'ppr_record_number',               statusColumn: 'ppr_status',               parents: ['project_id', 'property_id'],                      parentTables: ['projects', 'properties'] },
  payment_receipts:          { module: 'Incentives',     label: 'Payment Receipts',     nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: [],                                                 parentTables: [] },
  products:                  { module: 'Stock',          label: 'Product Catalog',      nameColumn: 'product_name',           recordNumberColumn: 'product_record_number',           statusColumn: null,                       parents: [],                                                 parentTables: [] },
  product_items:             { module: 'Stock',          label: 'Inventory On-Hand',    nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: [],                                                 parentTables: [] },
  materials_requests:        { module: 'Stock',          label: 'Materials Requests',   nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: ['project_id'],                                     parentTables: ['projects'] },
  equipment:                 { module: 'Stock',          label: 'Equipment',            nameColumn: 'equipment_name',         recordNumberColumn: 'equipment_record_number',         statusColumn: null,                       parents: [],                                                 parentTables: [] },
  vehicles:                  { module: 'Fleet',          label: 'Vehicles',             nameColumn: 'vehicle_name',           recordNumberColumn: 'vehicle_record_number',           statusColumn: 'vehicle_status',           parents: [],                                                 parentTables: [] },
  vehicle_activities:        { module: 'Fleet',          label: 'Activities',           nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: ['vehicle_id'],                                     parentTables: ['vehicles'] },
  equipment_containers:      { module: 'Fleet',          label: 'Vehicle Kits',         nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: ['issued_to_vehicle_id'],                           parentTables: ['vehicles'] },
  users:                     { module: 'People',         label: 'Users',                nameColumn: 'user_name',              recordNumberColumn: 'user_record_number',              statusColumn: null,                       parents: [],                                                 parentTables: [] },
  skills:                    { module: 'People',         label: 'Skills',               nameColumn: 'skill_name',             recordNumberColumn: 'skill_record_number',             statusColumn: null,                       parents: [],                                                 parentTables: [] },
  contact_skills:            { module: 'People',         label: 'Contact Skills',       nameColumn: null,                     recordNumberColumn: 'cs_record_number',                statusColumn: null,                       parents: ['contact_id', 'skill_id'],                         parentTables: ['contacts', 'skills'] },
  work_type_skill_requirements: { module: 'Admin',       label: 'Skill Requirements',   nameColumn: null,                     recordNumberColumn: 'wtsr_record_number',              statusColumn: null,                       parents: ['work_type_id', 'skill_id'],                       parentTables: ['work_types', 'skills'] },
  time_sheets:               { module: 'People',         label: 'Time Sheets',          nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: ['contact_id'],                                     parentTables: ['contacts'] },
  programs:                  { module: 'Admin',          label: 'Programs',             nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: [],                                                 parentTables: [] },
  work_types:                { module: 'Admin',          label: 'Work Types',           nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: [],                                                 parentTables: [] },
  email_templates:           { module: 'Admin',          label: 'Email Templates',      nameColumn: 'name',                   recordNumberColumn: 'et_record_number',                statusColumn: 'status',                   parents: [],                                                 parentTables: [] },
  document_templates:        { module: 'Admin',          label: 'Document Templates',   nameColumn: 'name',                   recordNumberColumn: 'dt_record_number',                statusColumn: 'status',                   parents: [],                                                 parentTables: [] },
  automation_rules:          { module: 'Admin',          label: 'Automation Rules',     nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: [],                                                 parentTables: [] },
  validation_rules:          { module: 'Admin',          label: 'Validation Rules',     nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: [],                                                 parentTables: [] },
  roles:                     { module: 'Admin',          label: 'Roles',                nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: [],                                                 parentTables: [] },
  picklist_values:           { module: 'Admin',          label: 'Picklist Values',      nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: [],                                                 parentTables: [] },
  portal_users:              { module: 'Portal',         label: 'Portal Users',         nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: ['portal_user_account_id'],                         parentTables: ['accounts'] },
  // Envelope family — added to fix the "Record" header bug on envelope pages.
  envelopes:                 { module: 'Field',          label: 'Envelopes',            nameColumn: 'env_name',               recordNumberColumn: 'env_record_number',               statusColumn: 'env_status',               parents: [],                                                 parentTables: [] },
  envelope_recipients:       { module: 'Field',          label: 'Envelope Recipients',  nameColumn: 'recipient_name',         recordNumberColumn: 'recipient_record_number',         statusColumn: 'recipient_status',         parents: ['envelope_id'],                                    parentTables: ['envelopes'] },
  envelope_tabs:             { module: 'Field',          label: 'Envelope Tabs',        nameColumn: null,                     recordNumberColumn: 'tab_record_number',               statusColumn: null,                       parents: ['envelope_id', 'recipient_id'],                    parentTables: ['envelopes', 'envelope_recipients'] },
  envelope_events:           { module: 'Field',          label: 'Envelope Events',      nameColumn: null,                     recordNumberColumn: 'event_record_number',             statusColumn: null,                       parents: ['envelope_id', 'recipient_id'],                    parentTables: ['envelopes', 'envelope_recipients'] },
  // Project Report Template family
  project_report_templates:                          { module: 'Admin', label: 'Project Report Templates',          nameColumn: 'prt_name',  recordNumberColumn: 'prt_record_number',    statusColumn: 'prt_status',  parents: [],            parentTables: [] },
  project_report_template_sections:                  { module: 'Admin', label: 'PRT Sections',                      nameColumn: null,        recordNumberColumn: 'prts_record_number',   statusColumn: null,          parents: ['prt_id'],    parentTables: ['project_report_templates'] },
  project_report_template_record_type_assignments:   { module: 'Admin', label: 'PRT RT Assignments',                nameColumn: null,        recordNumberColumn: 'prtrta_record_number', statusColumn: null,          parents: ['prt_id'],    parentTables: ['project_report_templates'] },
  project_report_template_snapshots:                 { module: 'Admin', label: 'PRT Snapshots',                     nameColumn: null,        recordNumberColumn: 'prtsn_record_number',  statusColumn: null,          parents: ['prt_id'],    parentTables: ['project_report_templates'] },
  // Portal Builder family
  portals:                                           { module: 'Admin', label: 'Portals',                            nameColumn: 'portal_name', recordNumberColumn: 'portal_record_number', statusColumn: null,        parents: [],                                          parentTables: [] },
  portal_role_assignments:                           { module: 'Admin', label: 'Portal Role Assignments',            nameColumn: null,          recordNumberColumn: null,                   statusColumn: null,        parents: ['pra_portal_id', 'pra_role_id'],            parentTables: ['portals', 'roles'] },
  object_chat_enabled:                               { module: 'Admin', label: 'Object Chat Settings',               nameColumn: 'oce_object_name', recordNumberColumn: null,               statusColumn: null,        parents: [],                                          parentTables: [] },
  chat_threads:                                      { module: 'Field', label: 'Chat Threads',                       nameColumn: 'chat_subject', recordNumberColumn: 'chat_record_number',  statusColumn: 'chat_status', parents: [],                                         parentTables: [] },
  chat_messages:                                     { module: 'Field', label: 'Chat Messages',                      nameColumn: null,          recordNumberColumn: 'cm_record_number',     statusColumn: null,        parents: ['cm_thread_id'],                            parentTables: ['chat_threads'] },
  // Conversations + messages — the canonical customer-correspondence thread
  // surface. Day-to-day access is via the ConversationPanel widget on the
  // parent record (contact / account / project / SA); these registry entries
  // exist so direct-URL navigation (or a future global search hit) still
  // renders a reasonable breadcrumb and header.
  conversations:                                     { module: 'Field', label: 'Conversations',                      nameColumn: 'conv_subject', recordNumberColumn: 'conv_record_number',  statusColumn: 'conv_status', parents: ['contact_id', 'account_id', 'project_id', 'service_appointment_id', 'work_order_id', 'incentive_application_id', 'opportunity_id', 'assessment_id', 'building_id', 'property_id'], parentTables: ['contacts', 'accounts', 'projects', 'service_appointments', 'work_orders', 'incentive_applications', 'opportunities', 'assessments', 'buildings', 'properties'] },
  messages:                                          { module: 'Field', label: 'Messages',                            nameColumn: null,           recordNumberColumn: 'msg_record_number',   statusColumn: 'msg_status', parents: ['conversation_id'],                       parentTables: ['conversations'] },
  user_account_scopes:                               { module: 'Admin', label: 'User Account Scopes',                nameColumn: null,          recordNumberColumn: null,                   statusColumn: null,        parents: ['uas_user_id', 'uas_account_id', 'uas_property_id'], parentTables: ['users', 'accounts', 'properties'] },
  user_program_scopes:                               { module: 'Admin', label: 'User Program Scopes',                nameColumn: null,          recordNumberColumn: null,                   statusColumn: null,        parents: ['ups_user_id', 'ups_program_id'],           parentTables: ['users', 'programs'] },
  // Reports & Dashboards family
  reports:                                           { module: 'Reports', label: 'Reports',                          nameColumn: 'rpt_name',       recordNumberColumn: 'rpt_record_number',     statusColumn: null,         parents: ['rpt_folder_id'],                            parentTables: ['report_folders'] },
  report_folders:                                    { module: 'Reports', label: 'Report Folders',                   nameColumn: 'rf_name',        recordNumberColumn: 'rf_record_number',      statusColumn: null,         parents: ['rf_parent_folder_id'],                      parentTables: ['report_folders'] },
  report_filters:                                    { module: 'Reports', label: 'Report Filters',                   nameColumn: null,             recordNumberColumn: null,                    statusColumn: null,         parents: ['rfilt_report_id'],                          parentTables: ['reports'] },
  report_groupings:                                  { module: 'Reports', label: 'Report Groupings',                 nameColumn: null,             recordNumberColumn: null,                    statusColumn: null,         parents: ['rgr_report_id'],                            parentTables: ['reports'] },
  report_calculated_fields:                          { module: 'Reports', label: 'Calculated Fields',                nameColumn: 'rcf_label',      recordNumberColumn: null,                    statusColumn: null,         parents: ['rcf_report_id'],                            parentTables: ['reports'] },
  report_folder_user_shares:                         { module: 'Reports', label: 'Folder User Shares',               nameColumn: null,             recordNumberColumn: null,                    statusColumn: null,         parents: ['rfus_folder_id', 'rfus_user_id'],           parentTables: ['report_folders', 'users'] },
  report_folder_role_shares:                         { module: 'Reports', label: 'Folder Role Shares',               nameColumn: null,             recordNumberColumn: null,                    statusColumn: null,         parents: ['rfrs_folder_id', 'rfrs_role_id'],           parentTables: ['report_folders', 'roles'] },
  scheduled_reports:                                 { module: 'Reports', label: 'Scheduled Reports',                nameColumn: 'sr_name',        recordNumberColumn: 'sr_record_number',      statusColumn: null,         parents: ['sr_report_id'],                             parentTables: ['reports'] },
  scheduled_report_runs:                             { module: 'Reports', label: 'Scheduled Report Runs',            nameColumn: null,             recordNumberColumn: 'srr_record_number',     statusColumn: 'srr_status', parents: ['srr_scheduled_report_id', 'srr_report_id'], parentTables: ['scheduled_reports', 'reports'] },
  dashboards:                                        { module: 'Reports', label: 'Dashboards',                       nameColumn: 'dash_name',      recordNumberColumn: 'dash_record_number',    statusColumn: null,         parents: ['dash_folder_id'],                           parentTables: ['dashboard_folders'] },
  dashboard_folders:                                 { module: 'Reports', label: 'Dashboard Folders',                nameColumn: 'df_name',        recordNumberColumn: 'df_record_number',      statusColumn: null,         parents: ['df_parent_folder_id'],                      parentTables: ['dashboard_folders'] },
  dashboard_widgets:                                 { module: 'Reports', label: 'Dashboard Widgets',                nameColumn: 'dw_title',       recordNumberColumn: null,                    statusColumn: null,         parents: ['dw_dashboard_id', 'dw_report_id'],          parentTables: ['dashboards', 'reports'] },
  dashboard_filters:                                 { module: 'Reports', label: 'Dashboard Filters',                nameColumn: 'dfilt_label',    recordNumberColumn: null,                    statusColumn: null,         parents: ['dfilt_dashboard_id'],                       parentTables: ['dashboards'] },
  dashboard_folder_user_shares:                      { module: 'Reports', label: 'Dashboard Folder User Shares',     nameColumn: null,             recordNumberColumn: null,                    statusColumn: null,         parents: ['dfus_folder_id', 'dfus_user_id'],           parentTables: ['dashboard_folders', 'users'] },
  dashboard_folder_role_shares:                      { module: 'Reports', label: 'Dashboard Folder Role Shares',     nameColumn: null,             recordNumberColumn: null,                    statusColumn: null,         parents: ['dfrs_folder_id', 'dfrs_role_id'],           parentTables: ['dashboard_folders', 'roles'] },
}

// Resolve a record's display name following the TABLE_META.nameColumn lookup.
// Falls back to the record_number, then to a short slice of the UUID. Used by
// the detail-page header and by lookup hyperlink rendering. Centralizing this
// stops the long `record.foo || record.bar || record.baz` chains from drifting.
function getRecordDisplayName(tableName, record) {
  if (!record) return ''
  const meta = TABLE_META[tableName]
  if (meta?.nameColumn && record[meta.nameColumn]) return record[meta.nameColumn]
  // Special case: contacts have first/last but no contact_name on legacy rows.
  if (tableName === 'contacts' && record.contact_first_name) {
    return `${record.contact_first_name} ${record.contact_last_name || ''}`.trim()
  }
  if (meta?.recordNumberColumn && record[meta.recordNumberColumn]) return record[meta.recordNumberColumn]
  if (record.id) return String(record.id).slice(0, 8).toUpperCase()
  return 'Record'
}

function getRecordNumber(tableName, record) {
  if (!record) return ''
  const meta = TABLE_META[tableName]
  if (meta?.recordNumberColumn && record[meta.recordNumberColumn]) return record[meta.recordNumberColumn]
  if (record.id) return String(record.id).slice(0, 8).toUpperCase()
  return ''
}

// The parent chain for an object that carries no explicit `parents` list in
// TABLE_META: its own lookup fields, in page-layout order.
//
// TABLE_META covers 74 of the 103 objects with a record page, so for the rest
// the breadcrumb rendered no hierarchy at all — a work step showed nothing
// above it even though its Work Order was sitting right there on the layout.
// Deriving from the layout means a new object gets a real breadcrumb the day
// its page is built, with no registry entry to remember.
//
// Excluded: fields the layout declares as system audit (Created By / Last
// Modified By) and lookups onto users — an owner is not a parent in the
// hierarchy, and putting one in the breadcrumb reads as one.
function deriveParentFksFromSections(sections) {
  const out = []
  for (const sec of sections || []) {
    for (const w of sec.widgets || []) {
      if (w.widget_type !== 'field_group' || !w.widget_config?.fields) continue
      for (const f of w.widget_config.fields) {
        if (f.type !== 'lookup' || !f.name) continue
        if (isSystemAuditField(f)) continue
        if (f.lookup_table === 'users') continue
        if (!out.includes(f.name)) out.push(f.name)
      }
    }
  }
  return out
}

function Breadcrumbs({ tableName, record, lookups, derivedParents, onBack, onNavigateToRecord, compact = false }) {
  // Every object gets an app name and a readable object name, whether or not
  // it was ever added to TABLE_META. Before this, an unlisted object rendered
  // its module as "—" and its own name as the raw table ("— / work_steps").
  const nav = objectNavFor(tableName)
  const declared = TABLE_META[tableName] || null
  const meta = {
    module: declared?.module || nav.moduleLabel,
    label: declared?.label || nav.label,
    parents: declared?.parents || [],
    parentTables: declared?.parentTables || [],
  }

  // Parent crumbs — innermost first. Each crumb carries the FK target so the
  // user can click through to the parent record. `parentTables` aligns
  // positionally with `parents`; if it's missing or short (legacy entries),
  // the crumb still renders as plain text.
  //
  // With no declared parents, fall back to the chain derived from the page
  // layout, capped so a wide layout can't push a dozen crumbs into the bar.
  const usingDerived = meta.parents.length === 0 && (derivedParents?.length || 0) > 0
  const parentFks = usingDerived ? derivedParents.slice(0, 3) : meta.parents
  const parentCrumbs = []
  for (let i = 0; i < parentFks.length; i += 1) {
    const fk = parentFks[i]
    const parentTable = usingDerived ? null : ((meta.parentTables || [])[i] || null)
    const val = record[fk]
    if (val && lookups.has(val)) {
      const entry = lookups.get(val)
      const label = typeof entry === 'string' ? entry : (entry?.label || '')
      // Prefer the parent table from TABLE_META metadata; fall back to whatever
      // resolveLookups discovered from the widget config (works for tables not
      // listed in TABLE_META).
      const tbl = parentTable || (typeof entry === 'object' ? entry?.table : null)
      parentCrumbs.push({ id: val, label, table: tbl })
    }
  }

  // The object crumb links to the object's list view. Objects reached only
  // through a parent (work steps, line items, photos) have no list anywhere,
  // and linking them used to drop the user on the module's Home page — the
  // "breadcrumb takes me home" complaint. They render as plain text instead.
  const hasList = !!nav.listUrl

  const sep = <span style={{ color: C.textMuted, margin: '0 6px', fontSize: 10 }}>/</span>

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, marginBottom: compact ? 8 : 14 }}>
      <span style={{ fontSize: 12, color: C.textMuted }}>{meta.module}</span>
      {sep}
      {hasList ? (
        <button onClick={onBack} style={{ fontSize: 12, color: '#1a5a8a', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}>
          {meta.label}
        </button>
      ) : (
        <span style={{ fontSize: 12, color: C.textSecondary }}>{meta.label}</span>
      )}
      {parentCrumbs.map((c, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
          {sep}
          {c.table && onNavigateToRecord ? (
            // Real anchor so a breadcrumb parent supports open-in-new-tab /
            // middle-click / Cmd-click, while plain click stays in-app.
            <RecordLink
              table={c.table}
              id={c.id}
              onActivate={() => onNavigateToRecord({ table: c.table, id: c.id, mode: 'view' })}
              style={{
                fontSize: 12, color: '#1a5a8a',
                cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2,
              }}
            >
              {c.label}
            </RecordLink>
          ) : (
            <span style={{ fontSize: 12, color: C.textSecondary }}>{c.label}</span>
          )}
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
  'skill_', 'cs_', 'acr_', 'wtsr_', 'mr_', 'ocr_',
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
// Columns the database or applyInsertDefaults populates automatically — never
// the user's responsibility, so they must never appear in a "required field
// missing" message even though they're NOT NULL. `id` is filled by the DB
// default (gen_random_uuid()) at insert and is the specific column that was
// being wrongly reported as "Required field missing: Id".
const SYSTEM_REQUIRED_EXEMPT = /(^id$|_record_number$|_owner$|_created_by$|_created_at$|_updated_by$|_updated_at$|_is_deleted$|^is_seed_data$|_is_seed_data$)/

// Per-table columns that are NOT NULL but populated by a BEFORE INSERT/UPDATE
// trigger, never by the user. These must be exempt from the client-side
// required-field check or the form blocks a save the database would accept.
// Mirrors the DERIVED map in the create form. Example: opportunity_contact_roles
// .ocr_name is generated as "<Role> — <Contact>" by trg_ocr_name.
const TRIGGER_DERIVED_REQUIRED = {
  contacts: ['contact_name'],
  // opportunity_account_id is forced to the property's account by
  // trg_opportunities_account_follows_property (sync_opportunity_account_from_property)
  // on every insert/update — the user never sets it, so the NOT NULL column must
  // never block a create the DB would happily complete. It's also prefilled from
  // the property chain below, so in practice it's populated on the form too.
  opportunities: ['opportunity_name', 'opportunity_account_id'],
  buildings: ['building_name'],
  units: ['unit_name'],
  opportunity_contact_roles: ['ocr_name'],
  opportunity_line_items: ['oli_name'],
  projects: ['project_name'],
  work_orders: ['work_order_name'],
  // property_id is NOT NULL but is forced from the opportunity by
  // trg_enrollment_inherit_from_opportunity — an enrollment is tied to a
  // building through its opportunity, not to a property (Nicholas,
  // 2026-08-17), so the create pop-up must never demand it.
  enrollments: ['enrollment_name', 'property_id'],
  // ia_name is composed from the opportunity/property + record type by
  // trg_ia_autoname; ia_program_name is a defaulted legacy column. Neither is
  // part of any intake form, so the create form must never demand them.
  incentive_applications: ['ia_name', 'ia_program_name'],
}

// Per-table name fields populated by a BEFORE INSERT/UPDATE trigger that the
// DB overwrites on every write. These are never user-editable — any input the
// user types is silently discarded — so every create/edit surface must render
// them read-only. Module-level so both FieldGroupWidget and QuickCreateModal
// enforce the same contract.
const DERIVED_READONLY = {
  contacts: ['contact_name'],
  // price_book_id is derived from the opportunity record type by
  // trg_opportunity_price_book, using the opportunity_record_type_price_books
  // mapping — the record type dictates the price book and a user never picks
  // one (Nicholas, 2026-07-26).
  // opportunity_property_management_company is forced from the property by
  // trg_0_opportunity_management_company_follows_property — a property's
  // management company is inherited all the way down, and there is no way to
  // have a different one on the opportunity (Nicholas, 2026-08-25). Editable,
  // it would offer a choice the database reverts on save.
  opportunities: ['opportunity_name', 'price_book_id', 'opportunity_property_management_company'],
  // building_name is trigger-derived; the In-Unit Information fields are
  // trigger-maintained rollups from child units (recompute_building_rollups,
  // 2026-07-27) — read-only so users edit the unit rows, not the aggregate.
  // (Unit count is intentionally not here — it's owned by a separate workstream.)
  buildings: [
    'building_name',
    'building_number_of_studio', 'building_number_of_one_bedrooms',
    'building_number_of_two_bedrooms', 'building_number_of_three_bedroom_units',
    'building_number_of_four_bedrooms', 'building_number_of_bedrooms',
    'building_average_sq_ft_of_units',
    'building_full_bathrooms', 'building_half_bathrooms',
    // Forced from the property by trg_0_building_management_company_follows_
    // property — the property is the only place a management company is
    // selected (Nicholas, 2026-08-29).
    'building_management_company_id',
  ],
  units: ['unit_name'],
  opportunity_contact_roles: ['ocr_name'],
  // price_book_entry_id is derived from the product + the opportunity's price
  // book by set_opportunity_line_item_defaults() — the user picks a Product and
  // the entry (plus list price + description) resolves automatically, exactly
  // like Salesforce. It is never picked (Nicholas, 2026-07-29).
  opportunity_line_items: ['oli_name', 'price_book_entry_id'],
  projects: ['project_name'],
  work_orders: ['work_order_name'],
  // property_id is NOT NULL but is forced from the opportunity by
  // trg_enrollment_inherit_from_opportunity — an enrollment is tied to a
  // building through its opportunity, not to a property (Nicholas,
  // 2026-08-17), so the create pop-up must never demand it.
  enrollments: ['enrollment_name', 'property_id'],
  // ia_name is composed from the opportunity/property + record type by
  // trg_ia_autoname; ia_program_name is a defaulted legacy column. Neither is
  // part of any intake form, so the create form must never demand them.
  incentive_applications: ['ia_name', 'ia_program_name'],
}
const isDerivedReadonlyField = (table, name) =>
  (DERIVED_READONLY[table] || []).includes(name)

// Columns the create pop-up must never ask for on this table: names a trigger
// composes (building_name), and fields derived/read-only by policy. Combined
// with the shared system-column rule in lib/createRecordFields.
function createNeverAskColumns(tableName) {
  return new Set([
    ...(TRIGGER_DERIVED_REQUIRED[tableName] || []),
    ...(DERIVED_READONLY[tableName] || []),
  ])
}

// Best label column for a lookup target: TABLE_META first (it knows the
// business name column), then the target's own first *_name column.
async function resolveLookupLabelColumn(targetTable) {
  const known = TABLE_META[targetTable]?.nameColumn
  if (known) return known
  try {
    const cols = await getEditableFieldsForTable(targetTable)
    const hit = (cols || []).find(c => /_name$/.test(c.columnName))
    return hit ? hit.columnName : null
  } catch { return null }
}

async function buildUnlaidOutRequiredFieldDefs(columns, tableName, recordTypeId) {
  if (!columns.length) return { defs: [], picklistOpts: {} }
  // Choice columns (see src/data/choiceColumns.js) are text columns with a
  // fixed set of values — resolved first so they render as a dropdown rather
  // than the free-text box their column type would otherwise earn.
  const choiceOptions = new Map()
  await Promise.all(columns.filter(col => isChoiceColumn(tableName, col)).map(async (col) => {
    const opts = await getChoiceOptions(tableName, col)
    if (opts && opts.length) choiceOptions.set(col, opts)
  }))
  let meta = []
  try { meta = await getEditableFieldsForTable(tableName) } catch { meta = [] }
  const byName = new Map((meta || []).map(c => [c.columnName, c]))
  const defs = []
  const picklistOpts = {}
  for (const col of columns) {
    const label = humanizeFieldName(col)
    const m = byName.get(col)
    const choices = choiceOptions.get(col)
    if (choices) { defs.push({ name: col, label, type: 'select', options: choices, required: true }); continue }
    if (!m) { defs.push({ name: col, label, type: 'text', required: true }); continue }
    if (m.editorType === 'picklist') {
      defs.push({ name: col, label, type: 'picklist', required: true })
      try {
        picklistOpts[col] = await fetchPicklistOptions(
          m.picklistObject || tableName, m.picklistField || col, recordTypeId || null)
      } catch { picklistOpts[col] = [] }
      continue
    }
    if (m.editorType === 'lookup' && m.referencesTable) {
      const labelCol = await resolveLookupLabelColumn(m.referencesTable)
      defs.push({
        // Name an FK column after what it points AT. humanizeFieldName strips
        // the table prefix first, which turns buildings' own "building_id" into
        // the meaningless "Id" — the object label is what the user recognises.
        name: col, label: singularizeLabel(TABLE_META[m.referencesTable]?.label || label),
        type: 'lookup', required: true,
        lookup_table: m.referencesTable, lookup_field: labelCol || 'id',
      })
      continue
    }
    // datetime has no editor on the record form either — fall back to text.
    defs.push({ name: col, label, required: true, type: m.editorType === 'datetime' ? 'text' : m.editorType })
  }
  return { defs, picklistOpts }
}

// Columns that USED to be copied from a parent at create but are now shown as
// live references to the parent (migration 20260729031631 converted the
// enrollment layouts to property_id.<col> related_fields). The create-prefill
// still computes these values transiently — the record-type state filter and the
// derived fields (subsidized share, occupancy, owner type) read them — but they
// must NOT be written onto the child record, or we'd re-introduce the stale copy.
// Stripped from the insert; the child reads them live from the parent instead.
const INHERITED_FROM_PARENT_COLUMNS = {
  enrollments: [
    'enrollment_hud_property_id', 'enrollment_property_name', 'enrollment_site_address',
    'enrollment_city', 'enrollment_state', 'enrollment_zip', 'enrollment_county',
    'enrollment_total_units', 'enrollment_assisted_units', 'enrollment_property_category',
    'enrollment_number_of_buildings', 'enrollment_owner_organization', 'enrollment_owner_phone',
    'enrollment_owner_email', 'enrollment_owner_fein', 'enrollment_management_agent',
    'enrollment_management_phone', 'enrollment_management_email', 'enrollment_hud_contract_number',
    'enrollment_hud_tracs_status', 'enrollment_hud_contract_expiration', 'enrollment_is_202_811',
    'enrollment_is_opportunity_zone',
  ],
  // Incentive applications now reference building/property/opportunity for these
  // fields (migration 20260729153704) — stop writing the copies. Nothing else in
  // the app reads these ia_* columns, so the child simply reads them live from the
  // parent. (The state-computed contractor fields and the 2-hop business-entity
  // account fields are NOT converted and keep being populated.)
  incentive_applications: [
    'ia_building_square_footage', 'ia_total_building_square_footage', 'ia_total_floors_in_building',
    'ia_year_the_building_was_built', 'ia_multifamily_of_units_in_building', 'ia_installation_address_street',
    'ia_installation_address_city', 'ia_installation_address_state', 'ia_installation_address_zip',
    'ia_electric_provider', 'ia_natural_gas_provider', 'ia_other_heating_fuel_provider',
    'ia_total_number_of_units', 'ia_total_number_of_occupied_units', 'ia_building_owner_name',
    'ia_building_owner_name_ira', 'ia_building_owner_email_address', 'ia_building_owner_office_phone',
    'ia_income_qualified_confirmation_code', 'ia_electric_account_number', 'ia_natural_gas_account_number',
    // Business-entity (owner account) fields — now inherited 2 hops up
    // (application -> property -> account) via Inherited Fields.
    'ia_business_entity_name', 'ia_business_entity_phone_number', 'ia_business_entity_email',
  ],
}

// ---------------------------------------------------------------------------
// Inherit every relationship the system can already work out
// ---------------------------------------------------------------------------
// Standing rule (Nicholas, 2026-08-16): LEAP is an operations system. A user
// must never be asked for something the platform can derive — "we add records
// that need to inherit everything that is appropriate."
//
// Given the table being created and whatever is already known (the parent
// record, the draft of the form the create was launched from), this fills in
// the target's declared parent FKs three ways, in order:
//
//   1. the same column, already known;
//   2. the SAME relationship under a different prefix — work_order_account_id
//      satisfies project_account_id, both being "the account";
//   3. one hop up the chain — fetch the ancestors we do know ids for, read
//      THEIR parents, and use those. A project's account comes from the
//      property this way, which is why creating a project from a work order
//      never has to ask who the account is.
//
// Data-driven from TABLE_META, so every object benefits without a rule per
// object. Bounded: it stops as soon as nothing is missing, and never walks more
// than a few hops. Returns only the values it resolved; the caller decides what
// to do with them.
async function resolveInheritedParents(targetTable, known, { maxHops = 6 } = {}) {
  const meta = TABLE_META[targetTable]
  if (!meta || !Array.isArray(meta.parents) || meta.parents.length === 0) return {}
  // "property_id" / "project_account_id" / "work_order_account_id" all reduce to
  // the relationship they express: property_id, account_id, account_id.
  const relationshipKey = (col) => {
    const m = String(col).match(/([a-z]+)_id$/)
    return m ? m[0] : String(col)
  }
  const valueByRelationship = new Map()
  const noteValue = (col, val) => {
    if (val == null || val === '') return
    const key = relationshipKey(col)
    if (!valueByRelationship.has(key)) valueByRelationship.set(key, val)
  }
  for (const [k, v] of Object.entries(known || {})) {
    if (k.includes('.') || k.startsWith('__') || !/_id$/.test(k)) continue
    noteValue(k, v)
  }

  const parentTables = meta.parentTables || []
  const resolved = {}
  const fill = () => {
    meta.parents.forEach((col) => {
      if (resolved[col] != null) return
      const v = (known && known[col] != null && known[col] !== '')
        ? known[col]
        : valueByRelationship.get(relationshipKey(col))
      if (v != null && v !== '') resolved[col] = v
    })
  }
  const missing = () => meta.parents.some(col => resolved[col] == null)
  fill()
  if (!missing()) return resolved

  // Climb: every ancestor we hold an id for can tell us about its own parents.
  const queue = []
  const seen = new Set()
  meta.parents.forEach((col, i) => {
    const table = parentTables[i]
    if (table && resolved[col]) queue.push({ table, id: resolved[col] })
  })
  let hops = 0
  while (queue.length && hops < maxHops && missing()) {
    hops += 1
    const { table, id } = queue.shift()
    const key = `${table}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const ancestorMeta = TABLE_META[table]
    if (!ancestorMeta?.parents?.length) continue
    try {
      const { data: row } = await supabase
        .from(table).select(ancestorMeta.parents.join(', ')).eq('id', id).maybeSingle()
      if (!row) continue
      ancestorMeta.parents.forEach((pCol, i) => {
        const pTable = (ancestorMeta.parentTables || [])[i]
        const val = row[pCol]
        if (val == null || val === '') return
        noteValue(pCol, val)
        if (pTable) queue.push({ table: pTable, id: val })
      })
      fill()
    } catch (err) {
      console.warn('inherit parents: ancestor read failed', table, err)
    }
  }
  return resolved
}

// ---------------------------------------------------------------------------
// The parent that decides which record types this child may carry
// ---------------------------------------------------------------------------
// An opportunity record type IS the program, so it governs which incentive
// application forms and which assessment record types are even offered
// (record_type_eligibility holds the edges). Created FROM an opportunity that
// is settled. Created from a BUILDING it is not: a building runs several
// programs side by side, and the code used to pick "the most recent live
// opportunity" — which then narrowed the record-type picker to that one
// program, making every other program's form unreachable from the building
// (Nicholas, 2026-08-29). Where the opportunities were created in one
// transaction the timestamps tie and the guess was arbitrary.
//
// So: derive when there is exactly one, ASK when there is more than one. The
// question is carried to RecordTypePicker as __parentChoices and answered
// there, before any record type is offered.
//
// Mutates prefillObj (seeds the FK, or records the outstanding question) and
// returns the resolved parent id, or null when it is still owed / none exists.
async function seedConstrainingParent(childTable, prefillObj, scope = {}) {
  try {
    // The ancestry to search under. Passed explicitly because the caller often
    // knows the building/property from the record the create was launched from
    // before the generic chain seeder has written them onto the prefill.
    const seed = {
      ...prefillObj,
      ...(scope.buildingId ? { building_id: scope.buildingId } : {}),
      ...(scope.propertyId ? { property_id: scope.propertyId } : {}),
    }
    const candidates = await fetchConstrainingParentCandidates(childTable, seed)
    if (!candidates) return null
    const choice = resolveParentChoice({
      seededId: prefillObj[candidates.fkColumn] || null,
      candidates: candidates.options,
    })
    if (choice.autoId) {
      prefillObj[candidates.fkColumn] = choice.autoId
      return choice.autoId
    }
    if (choice.needsChoice) {
      prefillObj.__parentChoices = {
        parentObject: candidates.parentObject,
        fkColumn: candidates.fkColumn,
        options: choice.options,
      }
    }
    return null
  } catch (err) {
    console.warn('seedConstrainingParent: resolve failed', err)
    return null
  }
}

// Compose a derived record name as "<base> - <record type label>", without
// repeating a label the base already ends with. An Assessment created from the
// opportunity "5513 North Hopkins Street - MILWAUKEE - 5513 - WI-IRA-MF-HOMES-
// AUDIT" was landing as "… - WI-IRA-MF-HOMES-AUDIT - WI-IRA-MF-HOMES-AUDIT"
// (Nicholas, 2026-08-16).
function composeDerivedRecordName(base, label) {
  const b = String(base || '').trim().replace(/^[\s-]+|[\s-]+$/g, '')
  const l = String(label || '').trim()
  if (!l) return b || null
  const alreadyEnds = b.toLowerCase().endsWith(l.toLowerCase())
  const composed = alreadyEnds ? b : [b, l].filter(Boolean).join(' - ')
  return composed.replace(/^[\s-]+|[\s-]+$/g, '') || null
}

// Turn a Postgres/PostgREST write error into something a user can act on.
// supabase-js puts the useful half in `details`/`hint` — the bare `message` for
// a constraint failure is often just "numeric field overflow", which tells the
// user nothing about what to change.
function describeWriteError(err) {
  const parts = [err?.message || String(err)]
  if (err?.details && err.details !== err.message) parts.push(err.details)
  if (err?.hint) parts.push(err.hint)
  return parts.filter(Boolean).join(' — ')
}

// missing from the provided values object. An empty string is treated as
// missing; `false` and `0` are valid values. System/auto-populated columns
// are skipped so they never surface in the error message.
function findMissingRequired(requiredFields, values, labelMap, tableName = null) {
  const derived = new Set(TRIGGER_DERIVED_REQUIRED[tableName] || [])
  const missing = []
  for (const f of requiredFields || []) {
    if (SYSTEM_REQUIRED_EXEMPT.test(f)) continue
    if (derived.has(f)) continue
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
// Details first, Related second, Activity third (always shown on existing
// records), then any custom tabs alphabetical after. Tabs derive PURELY from
// where sections sit — cards render inside their section on its tab
// (sections behave identically on every tab; Nicholas, 2026-07-26), so
// having card widgets no longer forces a Related tab into existence.
function buildOrderedTabs(sections, { includeActivity = true } = {}) {
  const names = new Set()
  for (const sec of sections || []) {
    if ((sec.section_placement || 'main') !== 'main') continue
    names.add(sec.section_tab || 'Details')
  }
  names.add('Details')
  if (includeActivity) names.add('Activity')
  const rank = (t) => t === 'Details' ? 0 : t === 'Related' ? 1 : t === 'Activity' ? 2 : 3
  return [...names].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })
}

// ---------------------------------------------------------------------------
// WorkPlanCard — the work plan, on the work order record page
// ---------------------------------------------------------------------------
// Standing rule (Nicholas, 2026-08-16): "they should never leave the main app."
// Following a work plan — steps in order, required photos and video,
// measurement fields, N/A with a reason, submit for verification — used to live
// only in LEAP Pad at /field. This mounts that exact component inside the
// record page in embedded mode, so back-office staff uploading evidence and
// technicians in the field run ONE implementation of the evidence gates. A
// second desktop-only runner would drift from the field one the first time a
// rule changed.
//
// Photos uploaded here go through the same pipeline as field captures —
// watermarked with the step name, EXIF and GPS preserved, filed against the
// step — so a photo pulled off a camera card at a desk is tagged exactly like
// one shot on site.
function WorkPlanCard({ widget, workOrderId, onChanged }) {
  const title = widget?.widget_config?.title || 'Work Plan'
  const [collapsed, setCollapsed] = useState(false)
  if (!workOrderId) return null
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      marginBottom: 16, overflow: 'hidden',
    }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          padding: '12px 16px', borderBottom: collapsed ? 'none' : `1px solid ${C.border}`,
          background: C.cardSecondary, display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <Icon path="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
          size={15} color={C.textSecondary} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, flex: 1 }}>{title}</span>
        <span style={{ fontSize: 11, color: C.textMuted }}>{collapsed ? 'Show' : 'Hide'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: 12, background: C.page }}>
          <Suspense fallback={
            <div style={{ padding: 20, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
              Loading work plan…
            </div>
          }>
            <WorkPlanRunner woId={workOrderId} embedded onChanged={onChanged} />
          </Suspense>
        </div>
      )}
    </div>
  )
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
            background: '#e8f1fb', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon path="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"
              size={15} color="#1a5a8a" />
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
              background: busy ? '#7eb3e8' : '#1a5a8a',
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
            background: '#eef5fc', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon path="M18.36 5.64a9 9 0 1 1-12.72 0M5.64 5.64l12.72 12.72"
              size={15} color="#1e466b" />
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
              background: canSubmit ? '#1e466b' : '#bcd9f2',
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
// DocumentTemplatePreviewModal — pick a parent record, render a merged PDF
// ---------------------------------------------------------------------------
// Author clicks Preview on a document_templates record. We open this modal,
// load up to 50 candidate parent records from the template's related_object
// table (Projects, Properties, Opportunities, etc.) via fetchLookupOptions,
// and let them pick one. On Generate we call render-document-template-pdf
// with preview:true and open the resulting PDF in a new tab.

function DocumentTemplatePreviewModal({
  templateName, relatedObject, options, loadingOptions,
  selected, onSelectedChange,
  overlay, onOverlayChange,
  rendering, onCancel, onGenerate,
}) {
  const canSubmit = !!selected && !rendering && !loadingOptions
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, borderRadius: 10, padding: 26, width: 480,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#f0f9ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon path="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              size={15} color="#0369a1" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Preview “{templateName}”
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
              Pick a {relatedObject.replace(/_/g, ' ').replace(/\bs$/, '')} record to merge against.
              The PDF opens in a new tab — nothing is saved or sent.
            </div>
          </div>
        </div>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>
          Record to preview against
        </label>
        {loadingOptions ? (
          <div style={{
            padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 6,
            background: '#f9fafb', fontSize: 13, color: C.textMuted,
          }}>
            Loading {relatedObject.replace(/_/g, ' ')}…
          </div>
        ) : options.length === 0 ? (
          <div style={{
            padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 6,
            background: '#eef5fc', fontSize: 13, color: '#1e466b',
          }}>
            No {relatedObject.replace(/_/g, ' ')} records found. Create one first.
          </div>
        ) : (
          <select
            value={selected}
            onChange={(e) => onSelectedChange(e.target.value)}
            disabled={rendering}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              border: `1px solid ${C.border}`, borderRadius: 6,
              padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
              color: C.textPrimary, background: rendering ? '#f3f4f6' : '#fff',
            }}
          >
            <option value="">— Select —</option>
            {options.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
        {options.length === 50 && !loadingOptions && (
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, fontStyle: 'italic' }}>
            Showing the first 50 records. Open the actual record from the list view if you need a different one and want to preview from there.
          </div>
        )}

        {/* Anchor overlay toggle — when on, the edge function draws colored
            translucent rectangles over every signature anchor so the author
            can visually verify placement. Color legend appears when the
            toggle is on so the rectangles in the rendered PDF make sense. */}
        <div style={{
          marginTop: 14, padding: '10px 12px',
          background: overlay ? '#f0f9ff' : C.cardSecondary,
          border: `1px solid ${overlay ? '#bae6fd' : C.border}`,
          borderRadius: 6,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: rendering ? 'wait' : 'pointer' }}>
            <input
              type="checkbox"
              checked={!!overlay}
              disabled={rendering}
              onChange={(e) => onOverlayChange(e.target.checked)}
              style={{ margin: 0, cursor: rendering ? 'wait' : 'pointer' }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
              Show signature anchor positions
            </span>
          </label>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 4, marginLeft: 22, lineHeight: 1.5 }}>
            Draws labeled rectangles over each <code style={{ background: '#fff', padding: '0 4px', borderRadius: 3, border: `1px solid ${C.border}`, fontSize: 11 }}>\sig1\</code>, <code style={{ background: '#fff', padding: '0 4px', borderRadius: 3, border: `1px solid ${C.border}`, fontSize: 11 }}>\date1\</code>, <code style={{ background: '#fff', padding: '0 4px', borderRadius: 3, border: `1px solid ${C.border}`, fontSize: 11 }}>\init1\</code>, and <code style={{ background: '#fff', padding: '0 4px', borderRadius: 3, border: `1px solid ${C.border}`, fontSize: 11 }}>\text1\</code> token at its resolved bounding box.
          </div>
          {overlay && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, marginLeft: 22 }}>
              {[
                { label: 'sig',  fill: 'rgba(62,207,142,0.30)',  border: '#2aab72' },
                { label: 'init', fill: 'rgba(126,179,232,0.30)', border: '#3a82c6' },
                { label: 'date', fill: 'rgba(126,179,232,0.30)',  border: '#1a5a8a' },
                { label: 'text', fill: 'rgba(143,160,184,0.30)', border: '#61738d' },
              ].map(c => (
                <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.textSecondary }}>
                  <span style={{
                    display: 'inline-block', width: 22, height: 12,
                    background: c.fill, border: `1px solid ${c.border}`, borderRadius: 2,
                  }} />
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', color: c.border, fontWeight: 600 }}>{c.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            onClick={() => canSubmit && onGenerate()}
            disabled={!canSubmit}
            style={{
              flex: 1,
              background: canSubmit ? '#0369a1' : '#7eb3e8',
              color: '#fff', border: 'none', borderRadius: 6,
              padding: '9px 0', fontSize: 13, fontWeight: 600,
              cursor: canSubmit ? 'pointer' : (rendering ? 'wait' : 'not-allowed'),
              opacity: canSubmit ? 1 : 0.8,
            }}
          >
            {rendering ? 'Rendering…' : overlay ? 'Generate Preview with Anchors' : 'Generate Preview'}
          </button>
          <button
            onClick={onCancel}
            disabled={rendering}
            style={{
              flex: 1, background: C.page, color: C.textSecondary,
              border: `1px solid ${C.border}`, borderRadius: 6,
              padding: '9px 0', fontSize: 13, cursor: rendering ? 'wait' : 'pointer',
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
// EmailTemplatePreviewModal — pick a parent record, render merged HTML inline
// ---------------------------------------------------------------------------
// Different shape from the document template modal:
//   • Wider (640px) to fit the rendered email body
//   • Two phases: pick-record (small) → result (taller, with iframe)
//   • Reset button on the result phase to swap parent records without
//     closing/reopening
//   • iframe sandbox keeps the email's HTML/CSS isolated from the app's
//     surrounding styles — looks closer to how a real mail client would
//     render it.

function EmailTemplatePreviewModal({
  templateName, relatedObject, options, loadingOptions,
  selected, onSelectedChange, rendering, result,
  onCancel, onGenerate, onClearResult,
}) {
  const canSubmit = !!selected && !rendering && !loadingOptions
  const showingResult = !!result
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, borderRadius: 10, padding: 26,
        width: showingResult ? 640 : 480,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#f0f9ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon path="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              size={15} color="#0369a1" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              {showingResult ? `Preview — ${templateName}` : `Preview “${templateName}”`}
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
              {showingResult
                ? 'Rendered subject and body shown below — nothing has been sent.'
                : `Pick a ${relatedObject.replace(/_/g, ' ').replace(/\bs$/, '')} record to merge against. The rendered email shows below — nothing is saved or sent.`}
            </div>
          </div>
        </div>

        {!showingResult && (
          <>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>
              Record to preview against
            </label>
            {loadingOptions ? (
              <div style={{
                padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 6,
                background: '#f9fafb', fontSize: 13, color: C.textMuted,
              }}>
                Loading {relatedObject.replace(/_/g, ' ')}…
              </div>
            ) : options.length === 0 ? (
              <div style={{
                padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 6,
                background: '#eef5fc', fontSize: 13, color: '#1e466b',
              }}>
                No {relatedObject.replace(/_/g, ' ')} records found. Create one first.
              </div>
            ) : (
              <select
                value={selected}
                onChange={(e) => onSelectedChange(e.target.value)}
                disabled={rendering}
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
                  color: C.textPrimary, background: rendering ? '#f3f4f6' : '#fff',
                }}
              >
                <option value="">— Select —</option>
                {options.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
            {options.length === 50 && !loadingOptions && (
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, fontStyle: 'italic' }}>
                Showing the first 50 records.
              </div>
            )}
          </>
        )}

        {showingResult && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div style={{
              padding: '8px 10px', background: '#f9fafb',
              border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 10,
              display: 'flex', alignItems: 'baseline', gap: 8,
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Subject
              </span>
              <span style={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>
                {result.subject || '(empty subject)'}
              </span>
            </div>
            <div style={{
              flex: 1, minHeight: 280, overflow: 'hidden',
              border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff',
            }}>
              <iframe
                title="email preview"
                sandbox=""
                srcDoc={result.body_html || '<p style="font:12px sans-serif;color:#888;padding:20px">(empty body)</p>'}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          {showingResult ? (
            <>
              <button
                onClick={onClearResult}
                style={{
                  flex: 1,
                  background: C.page, color: C.textPrimary,
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '9px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}
              >
                Try a different record
              </button>
              <button
                onClick={onCancel}
                style={{
                  flex: 1,
                  background: '#0369a1', color: '#fff', border: 'none', borderRadius: 6,
                  padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => canSubmit && onGenerate()}
                disabled={!canSubmit}
                style={{
                  flex: 1,
                  background: canSubmit ? '#0369a1' : '#7eb3e8',
                  color: '#fff', border: 'none', borderRadius: 6,
                  padding: '9px 0', fontSize: 13, fontWeight: 600,
                  cursor: canSubmit ? 'pointer' : (rendering ? 'wait' : 'not-allowed'),
                  opacity: canSubmit ? 1 : 0.8,
                }}
              >
                {rendering ? 'Rendering…' : 'Generate Preview'}
              </button>
              <button
                onClick={onCancel}
                disabled={rendering}
                style={{
                  flex: 1, background: C.page, color: C.textSecondary,
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '9px 0', fontSize: 13, cursor: rendering ? 'wait' : 'pointer',
                }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EditField — renders the right input for a field type
// ---------------------------------------------------------------------------

// SearchableLookup — a combobox used for related-record (lookup) fields.
// Native <select> can't offer a search box and gives no control over order,
// which made long pickers (e.g. the Property lookup with thousands of rows)
// unusable. This renders a button showing the current selection; clicking it
// opens a panel with a search input and an ascending-sorted, filtered option
// list. Selecting an option (or the leading blank row) calls onChange(value).
// Lookup targets that must NEVER offer inline quick-create: identity objects
// are provisioned through Admin flows (auth account, role, permissions) — an
// inline insert would create a half-provisioned row that can't sign in.
const QUICK_CREATE_EXCLUDED_TABLES = new Set(['users', 'portal_users'])

// Account record-type values (picklist_object='accounts', picklist_field=
// 'record_type') for which the Property Owner Research panel is offered. These
// are the only account types that represent an ownership group worth
// researching decision makers for; the panel is hidden on every other type
// (Contractor, Vendor, Service Provider, Utility, etc.). Matched by picklist
// value string, so it stays stable across record-type UUID changes.
const OWNER_RESEARCH_ACCOUNT_RECORD_TYPES = ['property_owner', 'property_management_company']

// QuickCreateModal — inline "+ New" for a scalar lookup field. Opens the REAL
// create path for the lookup's target table (same insertRecord +
// applyInsertDefaults the full form uses), scoped to the table's required
// fields plus its record-type selector. On save, returns {id, label} so the
// caller can select the freshly created record. The user can open the new
// record later to fill non-required fields — this is a quick-create, not a
// reduced create form.
function QuickCreateModal({ table, labelField, objectLabel, onCancel, onCreated, seed = null }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fields, setFields] = useState([])      // [{name,label,type,required,lookup_table,lookup_field}]
  const [draft, setDraft] = useState({})
  const [picklistOpts, setPicklistOpts] = useState({})
  // Options for required-FK lookup fields, keyed by column name. Loaded with
  // the field list; refreshed per-field by server search as the user types.
  const [fkLookupOpts, setFkLookupOpts] = useState({})
  const [recordTypes, setRecordTypes] = useState([])
  // The state whose programs are missing, when the record-type list came back
  // empty because none runs where this record is (see fetchAvailableRecordTypes).
  const [recordTypesNoneInState, setRecordTypesNoneInState] = useState(null)
  // The seed plus everything resolveInheritedParents could derive from it —
  // what actually gets written, and what the form knows never to ask for.
  const [resolvedSeed, setResolvedSeed] = useState(() => seed || {})
  const rtColumn = useMemo(() => getRecordTypeColumn(table), [table])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const meta = await fetchTableMetadata(table)
        const required = new Set(meta.required_fields || [])
        // Inherit everything the platform can already work out from the record
        // this create was launched from — the account from the property, the
        // property from the building, and so on — so the form only ever asks
        // for what genuinely isn't derivable.
        const inherited = await resolveInheritedParents(table, seed || {})
        const effectiveSeed = { ...(seed || {}), ...inherited }
        if (!cancelled) setResolvedSeed(effectiveSeed)
        // System/audit columns are auto-filled by applyInsertDefaults — never
        // surface them in the quick-create form even if NOT NULL.
        const SYSTEM = /(_record_number$|_owner$|_created_by$|_created_at$|_updated_by$|_updated_at$|_is_deleted$|^id$|^is_seed_data$)/
        // Columns a DB trigger populates automatically, or that policy makes
        // read-only — NOT NULL but never the user's to type (e.g.
        // projects.project_name is composed by trg_project_name). Same maps the
        // full create form uses, so both agree on what is never asked for.
        const derivedCols = new Set([
          ...(TRIGGER_DERIVED_REQUIRED[table] || []),
          ...(DERIVED_READONLY[table] || []),
        ])
        // Extra fields to require on quick-create beyond the DB NOT NULL set,
        // for data quality (e.g. always capture an email on a new contact).
        const EXTRA_REQUIRED = {
          contacts: [{ name: 'contact_email', label: 'Email', type: 'email' }],
        }
        // Build the field list: the record-type selector (if the table has
        // one) plus every required, non-system column. The name field is the
        // lookup's label column and is virtually always required, so it lands
        // here naturally.
        const fieldDefs = []
        if (rtColumn) {
          fieldDefs.push({ name: rtColumn, label: 'Record Type', type: 'picklist', required: true })
        }
        // Required FK columns render as real lookups, not raw text — resolve
        // each against the created table's declared parents (TABLE_META), so
        // e.g. a quick-created Opportunity asks for its Property with a
        // searchable picker instead of a UUID box.
        const parentFkTargets = {}
        const createdMeta = TABLE_META[table]
        if (createdMeta) {
          ;(createdMeta.parents || []).forEach((fk, i) => {
            const t = (createdMeta.parentTables || [])[i]
            if (t && TABLE_META[t]?.nameColumn) parentFkTargets[fk] = t
          })
        }
        // Column metadata for every other required column, so each one renders
        // with the editor its type calls for (picklist / lookup / number /
        // date / checkbox) instead of a bare text box.
        let columnMeta = new Map()
        try {
          const cols = await getEditableFieldsForTable(table)
          columnMeta = new Map((cols || []).map(c => [c.columnName, c]))
        } catch { /* fall back to text inputs */ }
        for (const col of required) {
          if (SYSTEM.test(col)) continue
          if (col === rtColumn) continue
          if (derivedCols.has(col)) continue              // trigger fills it
          if (effectiveSeed[col] != null) continue  // already known — never ask for it
          const fkTable = parentFkTargets[col]
          if (fkTable) {
            // Keep the parent chain intact inside quick-create too: when the
            // seed already pins a property (or an opportunity), scope the
            // building / opportunity / project pickers to it via the same
            // dependent-lookup RPCs the full form uses.
            const scopedKind = (fkTable === 'projects' && effectiveSeed?.opportunity_id)
              ? 'projects_for_opportunity'
              : effectiveSeed?.property_id
                ? (fkTable === 'buildings' ? 'buildings_for_property'
                  : fkTable === 'opportunities' ? 'opportunities_for_property' : null)
                : null
            // Each kind scopes on a different column, so carry it with the
            // field rather than assuming property_id.
            const scopedDependsOn = scopedKind === 'projects_for_opportunity'
              ? 'opportunity_id' : 'property_id'
            fieldDefs.push({
              name: col,
              // Name a lookup after the object it points at — "Opportunity",
              // "Account" — never after the column ("Project Account", or the
              // stripped-to-nothing "Id" a prefixed FK produces).
              label: singularizeLabel(TABLE_META[fkTable]?.label || fkTable),
              type: 'lookup',
              lookup_table: fkTable,
              lookup_field: TABLE_META[fkTable].nameColumn,
              scopedKind,
              scopedDependsOn,
              required: true,
            })
            continue
          }
          // Everything else gets the editor its column actually calls for —
          // a required picklist column (a Type, a Status) has to render as a
          // dropdown, not a text box the user can't possibly fill correctly.
          // Column metadata comes from describe_object_columns (cached).
          const colMeta = columnMeta.get(col) || null
          const colLabel = col.replace(/^[a-z]+_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          if (colMeta?.editorType === 'picklist') {
            fieldDefs.push({
              name: col, label: colLabel, type: 'picklist', required: true,
              picklist_object: colMeta.picklistObject || table,
              picklist_field: colMeta.picklistField || col,
            })
            continue
          }
          if (colMeta?.editorType === 'lookup' && colMeta.referencesTable) {
            const t = colMeta.referencesTable
            fieldDefs.push({
              name: col, label: singularizeLabel(TABLE_META[t]?.label || colLabel),
              type: 'lookup', required: true,
              lookup_table: t,
              lookup_field: TABLE_META[t]?.nameColumn || 'id',
              scopedKind: null,
            })
            continue
          }
          fieldDefs.push({
            name: col,
            label: colLabel,
            type: (colMeta?.editorType === 'number' || colMeta?.editorType === 'date'
              || colMeta?.editorType === 'boolean') ? colMeta.editorType : 'text',
            required: true,
          })
        }
        for (const extra of (EXTRA_REQUIRED[table] || [])) {
          if (fieldDefs.some(f => f.name === extra.name)) continue
          if (effectiveSeed[extra.name] != null) continue
          fieldDefs.push({ ...extra, required: true })
        }
        // Load record types for the RT selector, and any picklist options.
        let rts = []
        if (rtColumn) {
          // Same state scoping as the full create pop-up: a quick-created
          // opportunity on a North Carolina property offers North Carolina
          // programs, never Wisconsin's.
          const programState = await fetchProgramStateForCreate(effectiveSeed).catch(() => null)
          // ...and the same parent-program scoping: an incentive application
          // quick-created from an opportunity offers that program's forms only.
          const parent = await fetchConstrainingParentForCreate(table, effectiveSeed).catch(() => null)
          rts = await fetchAvailableRecordTypes(table, {
            state: programState,
            parentObject: parent?.parentObject || null,
            parentRecordTypeId: parent?.parentRecordTypeId || null,
            // ...and the same building scoping: a building runs each program
            // once, so a quick-created opportunity is not offered one the
            // building already has.
            takenOnBuildingId: table === 'opportunities' ? (effectiveSeed.building_id || null) : null,
          }).catch(() => [])
        }
        // First option page for each required-FK lookup field. Scoped fields
        // load their full (small) scoped set; unscoped load the first page.
        const fkOpts = {}
        await Promise.all(fieldDefs.filter(f => f.type === 'lookup').map(async f => {
          try {
            fkOpts[f.name] = f.scopedKind
              ? await fetchDependentLookupOptions(
                  { name: f.name, lookup_dependency: { kind: f.scopedKind, depends_on: [f.scopedDependsOn || 'property_id'] } },
                  effectiveSeed)
              : await fetchLookupOptions(f.lookup_table, f.lookup_field)
          } catch { fkOpts[f.name] = [] }
        }))
        // Options for required picklist columns. Unscoped here — the record
        // type is chosen in this same form, and the effect below re-scopes the
        // lists the moment it changes.
        const pickOpts = {}
        await Promise.all(fieldDefs.filter(f => f.type === 'picklist' && f.name !== rtColumn).map(async f => {
          try { pickOpts[f.name] = await fetchPicklistOptions(f.picklist_object, f.picklist_field, null) }
          catch { pickOpts[f.name] = [] }
        }))
        if (cancelled) return
        setFields(fieldDefs)
        setRecordTypes(rts)
        setRecordTypesNoneInState(rts._noneInState || null)
        setFkLookupOpts(fkOpts)
        setPicklistOpts(pickOpts)
        setLoading(false)
      } catch (err) {
        if (!cancelled) { toast.error(`Could not open create form — ${err.message || err}`); onCancel() }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])

  const setVal = (name, v) => setDraft(d => ({ ...d, [name]: v }))

  // Re-scope required picklists to the chosen record type, the same way the
  // record page does — a record type with its own selected values shows only
  // those, and one with no selection shows the full active list.
  const qcRecordTypeValue = rtColumn ? (draft[rtColumn] || null) : null
  useEffect(() => {
    if (!qcRecordTypeValue) return undefined
    const pickFields = fields.filter(f => f.type === 'picklist' && f.name !== rtColumn)
    if (pickFields.length === 0) return undefined
    let cancelled = false
    ;(async () => {
      const next = {}
      await Promise.all(pickFields.map(async f => {
        try { next[f.name] = await fetchPicklistOptions(f.picklist_object, f.picklist_field, qcRecordTypeValue) }
        catch { /* keep the current list on failure */ }
      }))
      if (!cancelled && Object.keys(next).length) setPicklistOpts(prev => ({ ...prev, ...next }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qcRecordTypeValue, fields])

  // Create-time duplicate probe — same soft gate as the full create form.
  // Quick-create from a lookup (e.g. a new account off a property's owner
  // field) is a prime source of duplicate records.
  const [qcDupMatches, setQcDupMatches] = useState([])
  const [qcDupAcknowledged, setQcDupAcknowledged] = useState(false)
  const qcDupReqRef = useRef(0)
  const qcProbeSignature = useMemo(() => {
    if (!DUPLICATE_CHECK_TABLES.includes(table)) return ''
    const probe = buildDuplicateProbe(table, { ...resolvedSeed, ...draft })
    return probe ? JSON.stringify(probe) : ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, draft])
  useEffect(() => {
    if (!qcProbeSignature) { setQcDupMatches([]); setQcDupAcknowledged(false); return undefined }
    const params = JSON.parse(qcProbeSignature)
    const myReq = ++qcDupReqRef.current
    const t = setTimeout(async () => {
      const { data: hits, error: dupErr } = await supabase.rpc('find_duplicate_candidates', params)
      if (myReq !== qcDupReqRef.current) return
      if (dupErr) { setQcDupMatches([]); return }
      setQcDupMatches(Array.isArray(hits) ? hits : [])
      setQcDupAcknowledged(false)
    }, 250)
    return () => clearTimeout(t)
  }, [qcProbeSignature])

  const handleSave = async () => {
    if (saving) return
    const missing = fields.filter(f => f.required && !isDerivedReadonlyField(table, f.name) && (draft[f.name] == null || draft[f.name] === ''))
    if (missing.length) {
      toast.error(missing.length === 1 ? `Required: ${missing[0].label}` : `Required: ${missing.map(f => f.label).join(', ')}`)
      return
    }
    if (qcDupMatches.length > 0 && !qcDupAcknowledged) {
      setQcDupAcknowledged(true)
      toast.warning('Possible duplicate found — review the matches shown, pick the existing record from the lookup instead, or press Save again to create anyway.')
      return
    }
    setSaving(true)
    try {
      const userId = await getCurrentUserId()
      const payload = applyInsertDefaults(table, { ...resolvedSeed, ...draft }, userId)
      // Normalize phone fields to the bare 10-digit form the DB constraint wants.
      normalizePhoneFieldsInPlace(payload, new Set(fields.filter(f => f.type === 'phone').map(f => f.name)))
      for (const [k, v] of Object.entries(payload)) if (v === '') payload[k] = null
      const created = await insertRecord(table, payload)
      const label = (labelField && created?.[labelField]) || created?.id?.slice(0, 8) || 'New record'
      toast.success(`Created ${label}`)
      onCreated({ id: created.id, label })
    } catch (err) {
      toast.error(`Create failed — ${describeWriteError(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(7,17,31,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel() }}>
      <div style={{ background: '#fff', borderRadius: 10, width: 'min(460px, 100%)', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, fontWeight: 600,
          fontSize: 14, color: C.textPrimary }}>
          New {objectLabel || 'Record'}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
          {loading && <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 13, padding: 12 }}>Loading form…</div>}
          {!loading && fields.length === 0 && (
            <div style={{ color: C.textMuted, fontSize: 13 }}>This object has no required fields to capture. Save to create.</div>
          )}
          {!loading && fields.map(f => {
            const derivedReadonly = isDerivedReadonlyField(table, f.name)
            return (
            <div key={f.name} style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: C.textSecondary,
                marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {f.label}{f.required && !derivedReadonly && <span style={{ color: '#2c5f8a', marginLeft: 3 }}>*</span>}
                {derivedReadonly && <span style={{ color: C.textMuted, marginLeft: 6, fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>auto-generated</span>}
              </label>
              {derivedReadonly ? (
                <div style={{ ...inputBase, background: C.cardSecondary, color: C.textMuted, cursor: 'not-allowed' }}>
                  {draft[f.name] || '— set on save —'}
                </div>
              ) : f.name === rtColumn ? (
                <>
                  <SearchableLookup
                    value={draft[f.name] || ''}
                    options={recordTypes.filter(rt => !rt.taken)
                      .map(rt => ({ value: rt.id, label: rt.label || rt.picklist_label }))}
                    onChange={(val) => setVal(f.name, val || null)}
                    placeholder="— Select —"
                  />
                  {/* A dropdown cannot show a disabled row with a reason the
                      way the record-type picker can, so a program the building
                      already runs is left out of the list and NAMED here
                      instead — an option that just wasn't there would read as
                      a missing configuration. */}
                  {recordTypes.some(rt => rt.taken) && (
                    <div style={{ marginTop: 6, fontSize: 11.5, color: C.textSecondary, lineHeight: 1.5 }}>
                      Already on this building, so not listed:{' '}
                      {recordTypes.filter(rt => rt.taken)
                        .map(rt => `${rt.label}${rt.takenBy ? ` (${rt.takenBy})` : ''}`)
                        .join(', ')}. A building runs each program once.
                    </div>
                  )}
                  {recordTypesNoneInState && (
                    <div style={{ marginTop: 6, fontSize: 11.5, color: C.textSecondary, lineHeight: 1.5 }}>
                      No record type runs in{' '}
                      <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{recordTypesNoneInState}</span>
                      {' '}— every one belongs to a program in another state. Set up
                      the {recordTypesNoneInState} record types in Setup first.
                    </div>
                  )}
                </>
              ) : f.type === 'lookup' ? (
                <SearchableLookup
                  value={draft[f.name] || ''}
                  options={fkLookupOpts[f.name] || []}
                  onChange={(val) => setVal(f.name, val || null)}
                  // Scoped pickers hold their complete set — local filtering
                  // (onSearch null) keeps the parent scope airtight. Unscoped
                  // pickers server-search the target table as the user types.
                  onSearch={f.scopedKind ? null : async (term) => {
                    try {
                      const opts = await fetchLookupOptions(f.lookup_table, f.lookup_field, 50,
                        term ? { search: term } : {})
                      setFkLookupOpts(prev => ({ ...prev, [f.name]: opts }))
                    } catch { /* keep the current page on a failed search */ }
                  }}
                  placeholder="— Select —"
                />
              ) : f.type === 'picklist' ? (
                <SearchableLookup
                  value={draft[f.name] || ''}
                  options={picklistOpts[f.name] || []}
                  onChange={(val) => setVal(f.name, val || null)}
                  placeholder="— Select —"
                />
              ) : f.type === 'number' ? (
                <input type="number" step="any" min={nonNegativeMin(false)} style={{ ...monoInput }}
                  value={draft[f.name] ?? ''} onKeyDown={blockNegativeKeys(false)}
                  onChange={e => setVal(f.name, e.target.value === '' ? null : Number(e.target.value))} />
              ) : f.type === 'date' ? (
                <input type="date" style={{ ...monoInput }} value={draft[f.name] || ''}
                  onChange={e => setVal(f.name, e.target.value || null)} />
              ) : f.type === 'boolean' ? (
                <div style={{ display: 'flex', gap: 0, maxWidth: 180 }}>
                  {[['Yes', true], ['No', false]].map(([lbl, val], i) => {
                    const active = draft[f.name] === val
                    return (
                      <button key={lbl} type="button" onClick={() => setVal(f.name, val)}
                        style={{
                          flex: 1, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                          border: `1px solid ${active ? C.emerald : C.border}`,
                          background: active ? C.emerald : C.card, color: active ? '#fff' : C.textPrimary,
                          borderRadius: i === 0 ? '5px 0 0 5px' : '0 5px 5px 0',
                          borderLeftWidth: i === 0 ? 1 : 0, outline: 'none',
                        }}>{lbl}</button>
                    )
                  })}
                </div>
              ) : (
                <input
                  type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'url' ? 'url' : 'text'}
                  inputMode={f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : undefined}
                  style={{ ...inputBase }} value={draft[f.name] || ''}
                  onChange={e => setVal(f.name, e.target.value)} />
              )}
            </div>
            )
          })}
          {!loading && (
            <DuplicateCheckPanel
              tableName={table}
              matches={qcDupMatches}
              confirming={qcDupAcknowledged}
              onNavigateToRecord={null}
            />
          )}
        </div>
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}`, background: '#fafbfd',
          display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} disabled={saving}
            style={{ background: '#fff', color: C.textPrimary, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: '6px 14px', fontSize: 12.5, fontWeight: 500,
              cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || loading}
            style={{ background: C.emerald, color: '#fff', border: 'none', borderRadius: 6,
              padding: '6px 14px', fontSize: 12.5, fontWeight: 500,
              cursor: saving ? 'wait' : 'pointer', opacity: (saving || loading) ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SearchableLookup({ value, options, onChange, placeholder = '— Select —',
  allowCreate = false, createTable = null, createLabelField = null, createObjectLabel = null,
  onCreatedOption = null, onSearch = null, selectedOption = null, createSeed = null }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [menuRect, setMenuRect] = useState(null)  // trigger bounding rect for portal positioning
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  // Measure the trigger's screen position whenever the menu opens, and keep it
  // current on scroll/resize. The menu renders in a body portal (so no parent
  // overflow or stacking context can clip it — the prior absolute/z-index:60
  // panel was being hidden behind section cards), positioned with these coords.
  useEffect(() => {
    if (!open) return undefined
    const measure = () => {
      const el = triggerRef.current
      if (el) setMenuRect(el.getBoundingClientRect())
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open])

  // Server-side search: when onSearch is provided, debounce the query and let
  // the parent refetch options against the full table. Local filtering still
  // applies on top so typing feels instant against whatever is already loaded.
  useEffect(() => {
    if (!onSearch) return undefined
    const t = setTimeout(() => { onSearch(query.trim()) }, 220)
    return () => clearTimeout(t)
  }, [query, onSearch])

  // Always present options ascending by label (case-insensitive, natural
  // numeric order so "950 …" sorts sensibly), regardless of fetch order.
  const sorted = useMemo(() => {
    return [...(options || [])].sort((a, b) =>
      String(a.label ?? '').localeCompare(
        String(b.label ?? ''), undefined, { sensitivity: 'base', numeric: true },
      ),
    )
  }, [options])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // With server-side search the option list IS the result set — don't
    // re-filter it locally (the server already matched), or a server hit that
    // doesn't substring-match the raw query could be hidden.
    if (onSearch) return sorted
    if (!q) return sorted
    // Match the subtitle (e.g. a contact's account) too, so you can narrow by
    // account when several people share a name.
    return sorted.filter(o => `${o.label ?? ''} ${o.subtitle ?? ''}`.toLowerCase().includes(q))
  }, [sorted, query, onSearch])

  const selectedLabel = useMemo(() => {
    const hit = (options || []).find(o => String(o.value) === String(value))
    if (hit) return hit.label
    // Fall back to a parent-supplied selected option so the field shows its
    // label even when the selected record isn't in the current option page.
    if (selectedOption && String(selectedOption.value) === String(value)) return selectedOption.label
    return ''
  }, [options, value, selectedOption])

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      const inTrigger = rootRef.current && rootRef.current.contains(e.target)
      const inMenu = menuRef.current && menuRef.current.contains(e.target)
      if (!inTrigger && !inMenu) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus() }, [open])

  function pick(val) {
    onChange(val)
    setOpen(false)
    setQuery('')
  }

  // The dropdown is at least as wide as the trigger, but grows to a comfortable
  // width so full record names are readable (capped to the viewport), and its
  // left edge is clamped so a wide menu never runs off-screen.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const menuWidth = menuRect ? Math.min(Math.max(menuRect.width, 440), vw - 16) : 0
  const menuLeft = menuRect ? Math.max(8, Math.min(menuRect.left, vw - menuWidth - 8)) : 0

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(o => !o)}
        style={{ ...inputBase, cursor: 'pointer', textAlign: 'left', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: selectedLabel ? C.textPrimary : C.textMuted }}>
          {selectedLabel || placeholder}
        </span>
        <span style={{ marginLeft: 8, color: C.textMuted, flexShrink: 0, fontSize: 11 }}>▾</span>
      </button>
      {open && menuRect && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', zIndex: 1000,
          top: menuRect.bottom + 4, left: menuLeft, width: menuWidth,
          background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6,
          boxShadow: '0 6px 24px rgba(0,0,0,0.18)', maxHeight: 300, display: 'flex',
          flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${C.border}` }}>
            <input ref={inputRef} type="text" value={query}
              onChange={e => setQuery(e.target.value)} placeholder="Search…"
              style={{ ...inputBase, padding: '6px 8px' }} />
          </div>
          <div style={{ overflowY: 'auto' }}>
            <div onClick={() => pick(null)}
              style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', color: C.textMuted }}>
              {placeholder}
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding: '7px 10px', fontSize: 13, color: C.textMuted }}>No matches</div>
            ) : filtered.map(o => {
              const isSel = String(o.value) === String(value)
              return (
                <div key={o.value} onClick={() => pick(o.value)} title={o.subtitle ? `${o.label} · ${o.subtitle}` : o.label}
                  style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer',
                    background: isSel ? C.emerald : '#fff', color: isSel ? '#fff' : C.textPrimary,
                    whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.3 }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#f1f5f9' }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = '#fff' }}>
                  {o.label}
                  {o.subtitle && (
                    <div style={{ fontSize: 11, marginTop: 1, color: isSel ? 'rgba(255,255,255,0.82)' : C.textMuted }}>
                      {o.subtitle}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {allowCreate && createTable && (
            <div onClick={() => { setOpen(false); setCreateOpen(true) }}
              style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
                color: C.emerald, borderTop: `1px solid ${C.border}`, background: '#fafbfd',
                display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fafbfd' }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
              New {createObjectLabel || 'record'}
            </div>
          )}
        </div>,
        document.body
      )}
      {createOpen && (
        <QuickCreateModal
          table={createTable}
          labelField={createLabelField}
          objectLabel={createObjectLabel}
          seed={createSeed}
          onCancel={() => setCreateOpen(false)}
          onCreated={({ id, label }) => {
            setCreateOpen(false)
            // Make the new record immediately selectable + selected. The parent
            // owns the options list; hand it the new option so the label
            // resolves without a full refetch, then select it.
            if (onCreatedOption) onCreatedOption({ value: id, label })
            onChange(id)
          }}
        />
      )}
    </div>
  )
}

// AvatarUpload — profile-photo control for the user_profile_photo_url field.
// Shows the current image (if any), an Upload/Replace button that pushes the
// file to the public `avatars` bucket, and a Remove control. The stored value
// is the public URL. Requires the user id (recordId); in create mode the user
// row doesn't exist yet, so we explain that the photo can be added after the
// first save rather than failing silently.
function AvatarUpload({ value, userId, onChange }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const inputRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (file) {
      setErr(null)
      setBusy(true)
      try {
        const url = await uploadAvatar({ file, userId })
        onChange(url)
      } catch (ex) {
        setErr(ex.message || 'Upload failed.')
      } finally {
        setBusy(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    }
  }

  const hasUser = !!userId
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        background: C.cardSecondary, border: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {value ? (
          <img src={value} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Icon path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" size={24} color={C.textMuted} />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {!hasUser ? (
          <div style={{ fontSize: 12, color: C.textMuted }}>
            Save the user first, then add a profile photo.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input ref={inputRef} type="file" accept="image/*"
              onChange={handleFile} style={{ display: 'none' }} />
            <button type="button" disabled={busy}
              onClick={() => inputRef.current?.click()}
              style={{ ...inputBase, width: 'auto', cursor: busy ? 'default' : 'pointer',
                padding: '6px 12px', fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Uploading…' : value ? 'Replace photo' : 'Upload photo'}
            </button>
            {value && !busy && (
              <button type="button" onClick={() => onChange(null)}
                style={{ background: 'transparent', border: 'none', color: C.textSecondary,
                  fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>
                Remove
              </button>
            )}
          </div>
        )}
        {err && <div style={{ fontSize: 11.5, color: '#1a5a8a' }}>{err}</div>}
      </div>
    </div>
  )
}

// LookupEditControl — wraps SearchableLookup for a scalar lookup field, adding
// locally-created options so a record created via inline "+ New" is selectable
// immediately without a round-trip refetch. Inline create is enabled by the
// field config's allow_inline_create flag; the target table/label come from
// lookup_table / lookup_field.
function LookupEditControl({ field, value, baseOptions, onChange, canCreate, dependencyValues = null, sourceValues = null }) {
  const [extra, setExtra] = useState([])          // options created inline this session
  const [serverOpts, setServerOpts] = useState(null) // results from server search (null = not searched)
  const [selectedOption, setSelectedOption] = useState(null) // resolved label for current value

  // Dependent lookups never server-search: fetchLookupOptions queries the
  // whole table, which would leak records outside the dependency scope back
  // into the list (e.g. every opportunity in the system on a property-scoped
  // picker). The scoped RPCs return the full matching set, so SearchableLookup's
  // local filtering (active when onSearch is null) covers typing.
  const isDependent = !!field.lookup_dependency?.kind
  const canServerSearch = !isDependent && !!(field.lookup_table && field.lookup_field)

  // Resolve the selected value's label up front so the field shows it even if
  // the record isn't in the initial option page (the carry-over case).
  useEffect(() => {
    let cancelled = false
    if (!value || !canServerSearch) { setSelectedOption(null); return undefined }
    const inOpts = (baseOptions || []).some(o => String(o.value) === String(value))
    if (inOpts) { setSelectedOption(null); return undefined }
    resolveLookupLabel(field.lookup_table, value, { nameColumn: field.lookup_field })
      .then(label => { if (!cancelled && label) setSelectedOption({ value, label }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [value, baseOptions, canServerSearch, field.lookup_table, field.lookup_field])

  const handleSearch = useCallback(async (term) => {
    if (!canServerSearch) return
    // Empty term restores the base option page.
    if (!term) { setServerOpts(null); return }
    try {
      const opts = await fetchLookupOptions(field.lookup_table, field.lookup_field, 50, { search: term })
      setServerOpts(opts)
    } catch { setServerOpts([]) }
  }, [canServerSearch, field.lookup_table, field.lookup_field])

  const options = useMemo(() => {
    const pool = serverOpts !== null ? serverOpts : (baseOptions || [])
    if (!extra.length) return pool
    const seen = new Set(pool.map(o => String(o.value)))
    return [...pool, ...extra.filter(o => !seen.has(String(o.value)))]
  }, [serverOpts, baseOptions, extra])

  const objectLabel = useMemo(() => {
    if (field.create_object_label) return field.create_object_label
    // Singularize the table name: ies→y first (properties → property,
    // opportunities → opportunity), then trailing s (accounts → account).
    const t = (field.lookup_table || '').replace(/ies$/, 'y').replace(/s$/, '').replace(/_/g, ' ')
    return t ? t.replace(/\b\w/g, c => c.toUpperCase()) : 'record'
  }, [field])

  // For a dependent lookup, seed the created record with the FK that scopes it
  // (e.g. a new Contact created from the Site Contact field belongs to the
  // selected Account). dep.create_seed maps the dependency parent value onto a
  // column on the new record; fall back to a sensible default for the common
  // contacts_for_accounts case.
  const createSeed = useMemo(() => {
    const dep = field.lookup_dependency
    if (!dep || !dependencyValues) return null
    if (dep.create_seed && typeof dep.create_seed === 'object') {
      const seed = {}
      for (const [srcKey, destCol] of Object.entries(dep.create_seed)) {
        if (dependencyValues[srcKey]) seed[destCol] = dependencyValues[srcKey]
      }
      return Object.keys(seed).length ? seed : null
    }
    if (dep.kind === 'contacts_for_accounts') {
      const acct = dependencyValues.opportunity_account_id
        || dependencyValues.opportunity_managing_account_id
        || dependencyValues.account_id
      return acct ? { contact_account_id: acct } : null
    }
    if (dep.kind === 'contacts_for_opportunity') {
      // Quick-creating a contact from an opportunity contact role: the new
      // contact belongs to the opportunity's account. The account id isn't on
      // the contact-role draft directly, so seeding is deferred — the contact
      // can be reparented after creation if needed. No reliable seed here.
      return null
    }
    if (dep.kind === 'signer_contacts_for_opportunity') {
      // Quick-creating the Authorized Signer from a new opportunity: the new
      // contact belongs to the opportunity's account (owner account preferred,
      // then managing account / property management company) so it's scoped to
      // the same account the signer picker searches.
      const acct = dependencyValues.opportunity_account_id
        || dependencyValues.opportunity_managing_account_id
        || dependencyValues.opportunity_property_management_company
      return acct ? { contact_account_id: acct } : null
    }
    if (dep.kind === 'buildings_for_property') {
      const prop = dependencyValues.property_id
        || dependencyValues.opportunity_property_id
      return prop ? { property_id: prop } : null
    }
    if (dep.kind === 'opportunities_for_property') {
      const prop = dependencyValues.property_id
      return prop ? { property_id: prop } : null
    }
    if (dep.kind === 'projects_for_opportunity') {
      const opp = dependencyValues.opportunity_id
      return opp ? { opportunity_id: opp } : null
    }
    if (dep.kind === 'buildings_for_opportunity') {
      const opp = dependencyValues.opportunity_id
      return opp ? { opportunity_id: opp } : null
    }
    if (dep.kind === 'units_for_building') {
      // A unit is created INTO a building — never straight onto a property,
      // which is why this seeds nothing without one.
      const bld = dependencyValues.building_id
      return bld ? { building_id: bld } : null
    }
    return null
  }, [field, dependencyValues])

  // Beyond the dependency seed: carry the whole parent chain from the record
  // being edited into the record being quick-created. Creating a Project from a
  // work order's Project field should not ask for the property, building,
  // opportunity, or account — the work order already holds all four (Nicholas,
  // 2026-08-16). Data-driven from the target's declared parents in TABLE_META,
  // matched against the source draft by relationship suffix so a differently
  // prefixed column for the SAME relationship still lands
  // (work_order_account_id → project_account_id).
  const chainSeed = useMemo(() => {
    const targetMeta = TABLE_META[field.lookup_table]
    if (!targetMeta || !sourceValues) return null
    const relationshipKey = (col) => {
      const m = String(col).match(/([a-z]+)_id$/)
      return m ? m[0] : String(col)
    }
    const sourceByRelationship = new Map()
    for (const [k, v] of Object.entries(sourceValues)) {
      if (v == null || v === '' || k.includes('.') || k.startsWith('__')) continue
      if (!/_id$/.test(k)) continue
      const key = relationshipKey(k)
      if (!sourceByRelationship.has(key)) sourceByRelationship.set(key, v)
    }
    const seed = {}
    for (const col of (targetMeta.parents || [])) {
      const v = sourceValues[col] ?? sourceByRelationship.get(relationshipKey(col))
      if (v != null && v !== '') seed[col] = v
    }
    return Object.keys(seed).length ? seed : null
  }, [field.lookup_table, sourceValues])

  // Dependency seed wins where the two disagree — it is the scope the picker
  // itself is filtered by.
  const mergedCreateSeed = useMemo(() => {
    if (!chainSeed) return createSeed
    if (!createSeed) return chainSeed
    return { ...chainSeed, ...createSeed }
  }, [chainSeed, createSeed])

  return (
    <SearchableLookup
      value={value}
      options={options}
      onChange={(val) => onChange(val || null)}
      onSearch={canServerSearch ? handleSearch : null}
      selectedOption={selectedOption}
      allowCreate={canCreate}
      createTable={field.lookup_table}
      createLabelField={field.lookup_field}
      createObjectLabel={objectLabel}
      createSeed={mergedCreateSeed}
      onCreatedOption={(opt) => setExtra(prev => [...prev, opt])}
    />
  )
}

function EditField({ field, value, onChange, picklistOpts, lookupOpts, recordId, tableName }) {
  const v = value ?? ''

  // User profile photo: dedicated upload control instead of a raw URL text box.
  // Stores to the public `avatars` bucket and saves the resulting public URL.
  if (field.name === 'user_profile_photo_url') {
    return (
      <AvatarUpload
        value={v}
        userId={recordId}
        onChange={(url) => onChange(field.name, url)}
      />
    )
  }

  switch (field.type) {
    // Choice column — a text column whose value comes from a fixed list
    // (see src/data/choiceColumns.js). Stores the literal value, not a
    // picklist_values id, so it can't share the picklist editor.
    case 'select': {
      const opts = Array.isArray(field.options) ? field.options : []
      return (
        <select style={{ ...inputBase, cursor: 'pointer' }} value={v}
          onChange={e => onChange(field.name, e.target.value || null)}>
          <option value="">— Select —</option>
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }

    // Typed inputs so mobile keyboards match the field (email/@ keyboard, phone
    // keypad, url keyboard) and the browser offers the right autofill.
    case 'text': case 'phone': case 'email': case 'url':
      return <input
        type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'url' ? 'url' : 'text'}
        inputMode={field.type === 'phone' ? 'tel' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : undefined}
        placeholder={field.type === 'url' ? 'https://' : undefined}
        style={inputBase} value={v} onChange={e => onChange(field.name, e.target.value)} />

    case 'number': case 'currency': case 'percent': {
      // Business number fields are never negative (see lib/numberInput). Block
      // the sign keys and clamp any spinner/pasted negative to 0. A field can
      // opt back into negatives via field.allow_negative.
      const allowNeg = field.allow_negative === true
      return <input type="number" step="any" min={nonNegativeMin(allowNeg)} style={monoInput}
        value={v} onKeyDown={blockNegativeKeys(allowNeg)}
        onChange={e => {
          if (e.target.value === '') { onChange(field.name, null); return }
          const n = Number(e.target.value)
          onChange(field.name, !allowNeg && n < 0 ? 0 : n)
        }} />
    }

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
      // Radio-button rendering (field.display === 'radio') for picklists that
      // mirror a radio-group on an external form, so the LEAP field matches the
      // source form's input type instead of collapsing to a dropdown. Same
      // stored value; only the control differs. Default stays a <select>.
      if (field.display === 'radio') {
        // Radio groups mirror an external form, where option order is
        // meaningful — render in picklist sort_order, not the alphabetical
        // order the loader returns for choice lists.
        const radioOpts = [...opts].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        return (
          <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {radioOpts.map(o => {
              const on = (v || '') === o.value
              return (
                <label key={o.value}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: C.textPrimary }}>
                  <input type="radio" name={`rf-${field.name}`} checked={on}
                    onChange={() => onChange(field.name, o.value)}
                    style={{ accentColor: C.emerald, cursor: 'pointer' }} />
                  {o.label}
                </label>
              )
            })}
          </div>
        )
      }
      return (
        <select style={{ ...inputBase, cursor: 'pointer' }}
          value={v || ''} onChange={e => onChange(field.name, e.target.value || null)}>
          <option value="">— Select —</option>
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }

    case 'multiselect': {
      // Checkbox group backed by the field's inline `options`. Value is an
      // array of selected option values (stored to a jsonb/array column).
      // Mirrors an external form's checkbox list (e.g. "What work will be
      // completed?"). Empty selection saves null.
      const opts = field.options || []
      const selected = new Set(Array.isArray(value) ? value : [])
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {opts.map(o => {
            const on = selected.has(o.value)
            return (
              <label key={o.value}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: C.textPrimary }}>
                <input type="checkbox" checked={on}
                  onChange={() => {
                    const next = new Set(selected)
                    if (on) next.delete(o.value); else next.add(o.value)
                    onChange(field.name, next.size ? Array.from(next) : null)
                  }}
                  style={{ accentColor: C.emerald, cursor: 'pointer' }} />
                {o.label}
              </label>
            )
          })}
        </div>
      )
    }

    case 'lookup': {
      const opts = lookupOpts || []
      const dep = field.lookup_dependency
      // Inline "+ New" is ON BY DEFAULT for every lookup, system-wide
      // (Nicholas, 2026-07-26): searching related records must always offer
      // creating the record when it doesn't exist. A layout can still opt a
      // field out with allow_inline_create: false. Identity objects are the
      // one hard exclusion — platform/portal users are provisioned through
      // Admin (auth account + role), never quick-created from a lookup.
      const canCreate = field.allow_inline_create !== false
        && !!field.lookup_table && !!field.lookup_field
        && !QUICK_CREATE_EXCLUDED_TABLES.has(field.lookup_table)
      const canServerSearch = !!(field.lookup_table && field.lookup_field)

      // Dependent lookup (e.g. Site Contact scoped to the selected Account):
      // always route through LookupEditControl with the dependency values, so
      // the scoped option list shows and — when inline-create is enabled —
      // "+ New" is reachable even if the scoped pool is currently empty. The
      // new record is seeded with the dependency FK (e.g. the contact's
      // account) so it belongs to the right parent.
      if (dep && dep.kind) {
        if (opts.length > 0 || canCreate || v) {
          return (
            <LookupEditControl
              field={field}
              value={v || ''}
              baseOptions={opts}
              onChange={(val) => onChange(field.name, val)}
              canCreate={canCreate}
              dependencyValues={field._dependencyValues || null}
              sourceValues={field._sourceValues || null}
            />
          )
        }
        const dependsOn = Array.isArray(dep.depends_on) ? dep.depends_on : []
        // "Fill X first" only when the dependency really is unfilled; when the
        // parent IS set and the scoped pool is just empty (e.g. a property
        // with no opportunities yet), say so instead of a misleading prompt.
        const depsFilled = dependsOn.length > 0
          && dependsOn.some(k => field._dependencyValues?.[k] != null && field._dependencyValues?.[k] !== '')
        const hint = dependsOn.length > 0 && !depsFilled
          ? `— Fill ${dependsOn.map(n => n.replace(/_id$/, '').replace(/_/g, ' ')).join(' or ')} first —`
          : '— No matching records —'
        return (
          <select style={{ ...inputBase, cursor: 'not-allowed', color: C.textMuted, background: '#f7f9fc' }}
            value="" disabled>
            <option value="">{hint}</option>
          </select>
        )
      }

      // Plain (non-dependent) lookup. Render the searchable control when we
      // have options, inline create is enabled, server search is possible, OR
      // a value is already set (so a carried-over / saved selection always
      // shows its label even if its row isn't in the initial option page).
      if (opts.length > 0 || canCreate || canServerSearch || v) {
        return (
          <LookupEditControl
            field={field}
            value={v || ''}
            baseOptions={opts}
            onChange={(val) => onChange(field.name, val)}
            canCreate={canCreate}
            sourceValues={field._sourceValues || null}
          />
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
          borderColor: parseErr ? '#bcd9f2' : undefined,
        }}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
      />
      {parseErr ? (
        <div style={{ marginTop: 4, fontSize: 11, color: '#1a5a8a' }}>
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
        <div style={{ fontSize: 11.5, color: '#1a5a8a' }}>{error}</div>
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
          <div style={{ padding: '14px 16px', fontSize: 12.5, color: '#1a5a8a' }}>
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
  const [tabPickerOpen, setTabPickerOpen] = useState(false)
  // Last ordinal used in this session — defaulted to 1 (primary signer)
  // since most templates have exactly one recipient.
  const [tabOrdinal, setTabOrdinal] = useState(1)
  const caretRef = useRef({ start: 0, end: 0 })
  const text = value == null ? '' : String(value)

  useEffect(() => {
    if (!open && !tabPickerOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); setTabPickerOpen(false) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, tabPickerOpen])

  // Capture caret position immediately so it's available when either picker
  // opens. We track it once for both flows since both insert at the same spot.
  const captureCaret = () => {
    const ta = taRef.current
    if (ta) {
      caretRef.current = {
        start: ta.selectionStart ?? text.length,
        end:   ta.selectionEnd   ?? text.length,
      }
    } else {
      caretRef.current = { start: text.length, end: text.length }
    }
  }

  const openPicker = () => { captureCaret(); setOpen(true) }
  const openTabPicker = () => { captureCaret(); setTabPickerOpen(true) }

  const insertToken = (token) => {
    const { start, end } = caretRef.current
    const next = text.slice(0, start) + token + text.slice(end)
    onChange(next)
    setOpen(false)
    setTabPickerOpen(false)
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (!ta) return
      const pos = start + token.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  // Insert a signature anchor in the exact format the htmlToPdf renderer
  // expects (regex: /\\(sig|initial|date|text)(\d+)\\/g). Padded with one
  // space on each side so the anchor sits inline like a placeholder run
  // — flush-against-text anchors get measured against adjacent word
  // boundaries which can produce off-by-a-character geometry.
  const insertSignatureTab = (tabType, ordinal) => {
    const token = ` \\${tabType}${ordinal}\\ `
    insertToken(token)
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
  const tabCard = {
    width: '100%', maxWidth: 440, background: C.card,
    border: `1px solid ${C.border}`, borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
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
        <button
          type="button"
          onClick={openTabPicker}
          style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 500,
            background: C.card, border: `1px solid ${C.borderDark}`,
            borderRadius: 4, cursor: 'pointer', color: C.textPrimary,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          <Icon path="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" size={13} color={C.textPrimary} />
          Insert Signature Tab
        </button>
        <span style={{ fontSize: 11, color: C.textMuted }}>
          Merge tokens use <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{`{{path}}`}</code> syntax.
          Signature tabs use <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{`\\sig1\\`}</code> anchors.
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
      {tabPickerOpen && createPortal(
        <div style={overlay} onClick={() => setTabPickerOpen(false)}>
          <div style={tabCard} onClick={e => e.stopPropagation()}>
            <div style={headerStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 6,
                  background: '#eff6ff', border: '1px solid #bfdbfe',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon path="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" size={15} color="#1f7ae0" />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>Insert Signature Tab</div>
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>
                    Pick the recipient and tab type — anchor inserts at the cursor.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTabPickerOpen(false)}
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
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Recipient Order
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={tabOrdinal}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10)
                      if (!Number.isFinite(n) || n < 1) { setTabOrdinal(1); return }
                      setTabOrdinal(Math.min(20, n))
                    }}
                    style={{ ...inputBase, width: 80, fontSize: 13 }}
                  />
                  <span style={{ fontSize: 12, color: C.textMuted }}>
                    {tabOrdinal === 1 ? 'Primary signer' : `Recipient #${tabOrdinal} in the signing order`}
                  </span>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Tab Type
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { type: 'sig',     label: 'Signature',    hint: '180 × 36 pt' },
                    { type: 'initial', label: 'Initials',     hint: '60 × 30 pt'  },
                    { type: 'date',    label: 'Date Signed',  hint: '90 × 18 pt'  },
                    { type: 'text',    label: 'Text Input',   hint: '140 × 18 pt' },
                  ].map(t => (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => insertSignatureTab(t.type, tabOrdinal)}
                      style={{
                        padding: '10px 12px', fontSize: 13, fontWeight: 500,
                        background: C.card, border: `1px solid ${C.borderDark}`,
                        borderRadius: 6, cursor: 'pointer', color: C.textPrimary,
                        textAlign: 'left',
                        display: 'flex', flexDirection: 'column', gap: 3,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.page }}
                      onMouseLeave={e => { e.currentTarget.style.background = C.card }}
                    >
                      <span>{t.label}</span>
                      <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted }}>
                        \{t.type}{tabOrdinal}\ — {t.hint}
                      </code>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={footerStyle}>
              Anchors are scanned at render time and replaced with sized boxes. Press Esc to close.
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
        <div style={{ padding: 18, fontSize: 12.5, color: '#1a5a8a' }}>
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

function FieldGroupWidget({ widget, record, picklists, lookups, editing, draft, onChange, allPicklistOpts, allLookupOpts, onRefreshRecord, recordId, fieldDisabledReasons, onNavigateToRecord, requiredFields, tableName, createRelatedValues }) {
  const fields = widget.widget_config?.fields || []
  if (fields.length === 0) return null

  // System fields are auto-populated at insert time by applyInsertDefaults
  // (record_number, owner, created_by) — they appear in the layout for
  // display purposes on saved records but shouldn't be shown as inputs on
  // the create form. Hide them when the record doesn't exist yet.
  const isCreate = !record?.id
  // Audit columns come from the shared rule (it also covers the bare
  // `created_at` / `created_by_id` spellings the older tables use, which the
  // previous inline regex missed — those rendered as blank inputs on the
  // create form). Record number and owner keep their own suffix test.
  const isSystemField = (name) =>
    isSystemAuditColumn(name) || /(_record_number|_owner)$/.test(name || '')

  const renderField = (f, fieldIndex = 0) => {
        // Hide system-set fields on the create form — they're auto-populated
        // at insert time by applyInsertDefaults and rendering them as inputs
        // just confuses the user (and produced an incorrect 'Required fields
        // missing' error before the prefix-map fix landed).
        if (isCreate && isSystemField(f.name)) return null

        // Spacer — a blank placeholder cell (no name, so it's never saved and
        // the layout-config validator skips it). Occupies a column slot so the
        // paired field in the other column lines up, mirroring the source form.
        if (f.type === 'spacer') {
          return (
            <div key={fieldRenderKey(f, fieldIndex)} aria-hidden="true"
              style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', visibility: 'hidden' }}>&nbsp;</span>
              <span style={{ fontSize: 13, visibility: 'hidden' }}>&nbsp;</span>
            </div>
          )
        }

        // Cross-object (related) fields — read-only values pulled from the
        // record a lookup on this record points at (loadRecordDetailData
        // merges them into `record` under the dotted name). Always
        // display-only: they belong to the parent record and are edited
        // there. On the create form the record doesn't exist yet, but the
        // parent FK is often already chosen (e.g. a new Unit's Building), so
        // the create-mode resolver (createRelatedValues) supplies the display
        // value; if the FK isn't picked yet there's nothing to show, so hide.
        if (f.type === 'related_field') {
          const rel = f.related || {}
          let relRaw
          let relDisplay
          if (isCreate) {
            relDisplay = createRelatedValues?.get?.(f.name)
            if (relDisplay == null || relDisplay === '') return null
          } else {
            relRaw = record[f.name]
            relDisplay = formatFieldValue(relRaw, {
              ...f, type: rel.column_type || 'text',
              lookup_table: rel.lookup_table, lookup_field: rel.lookup_field,
            }, picklists, lookups)
          }
          return (
            <div key={fieldRenderKey(f, fieldIndex)} style={{
              padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span
                title={`Read-only — this value lives on the related ${rel.table || 'record'} and is edited there.`}
                style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {/* Show just the field name — strip any legacy "Parent · " path
                    prefix baked into the saved label. The RELATED chip is
                    omitted: a lookup/related field is self-evidently pulled
                    from a parent record, so the badge was just noise. */}
                {typeof f.label === 'string' && f.label.includes(' · ') ? f.label.split(' · ').pop() : f.label}
              </span>
              <span style={{ fontSize: 13, color: C.textPrimary, wordBreak: 'break-word' }}>
                {rel.column_type === 'picklist' && relRaw
                  ? <Badge s={relDisplay} />
                  : <FieldValueLink type={rel.column_type} raw={relRaw} display={relDisplay} label={f.label} />}
              </span>
            </div>
          )
        }
        // Formula / rollup / inherited fields — computed at read
        // (loadRecordDetailData merges the value into `record` under the column
        // name). Always display-only, with a chip, on every tab. Nothing to show
        // before the record exists, so hide on the create form.
        if (f.type === 'formula' || f.type === 'rollup' || f.type === 'inherited') {
          if (isCreate) return null
          const cRaw = record[f.name]
          const cDisplay = formatFieldValue(cRaw, f, picklists, lookups)
          const chip = f.type === 'formula' ? 'FORMULA' : f.type === 'rollup' ? 'ROLLUP' : 'INHERITED'
          const chipTitle = f.type === 'formula' ? 'Read-only — calculated by a formula.'
            : f.type === 'rollup' ? 'Read-only — rolled up from related records.'
            : 'Read-only — inherited from a parent record. Edit it on the base record.'
          return (
            <div key={fieldRenderKey(f, fieldIndex)} style={{
              padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {typeof f.label === 'string' && f.label.includes(' · ') ? f.label.split(' · ').pop() : f.label}
                <span
                  title={chipTitle}
                  style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 700, color: '#1a5a8a', background: '#e8f3fb', padding: '1px 5px', borderRadius: 3, letterSpacing: '0.05em' }}>
                  {chip}
                </span>
              </span>
              <span style={{ fontSize: 13, color: C.textPrimary, wordBreak: 'break-word' }}>
                <FieldValueLink type={f.return_type} raw={cRaw} display={cDisplay} label={f.label} />
              </span>
            </div>
          )
        }
        const raw = editing ? draft[f.name] : record[f.name]
        const display = formatFieldValue(raw, f, picklists, lookups)
        const isLookupLike = f.type === 'lookup' || f.type === 'polymorphic_lookup'
        const isLink = f.type === 'email' || isLookupLike
        const hasLookupOpts = f.type === 'lookup' && allLookupOpts?.[f.name]?.length > 0
        // The widget config may already mark a field as required (admin-set);
        // the DB-derived requiredFields set is authoritative for NOT NULL
        // columns. Render the red asterisk if EITHER is true and we're
        // currently in edit mode (asterisks would be visual noise in view).
        const isRequiredField = (f.required === true) || requiredFields?.has?.(f.name)
        // polymorphic_lookup is read-only in edit mode for now — there's no
        // UI for picking both the parent table and the parent record from a
        // single field, and these fields are typically system-set anyway
        // (Send for Signature populates env_parent_object/env_parent_record_id).
        //
        // f._editable === false comes from the field-permission resolver
        // (app_user_field_permissions): the user can read this field but the
        // role/pset says they can't write it. View mode still shows the
        // value; edit mode renders the read-only display in place of the
        // input.
        // A lookup is editable when it has preloaded options, a dependency,
        // OR a target table (which enables server-side search and/or inline
        // create). The old gate required preloaded options, so a lookup
        // against a large table whose first page came back empty/unresolved
        // was wrongly treated as read-only — rendering an inert dropdown with
        // no search and no "+ New". Any lookup with lookup_table is editable.
        const lookupIsEditable = f.type === 'lookup'
          && (hasLookupOpts || !!f.lookup_dependency || !!f.lookup_table)
        // Trigger-derived name fields are never user-editable — the DB
        // overwrites any value on write (trg_contact_name, trg_opportunity_name,
        // trg_project_name, etc). Read-only in edit mode so users aren't
        // presented an input whose value silently won't stick.
        const isDerivedField = isDerivedReadonlyField(tableName, f.name)
        // Created By / Last Modified By are lookups onto users, so without this
        // they rendered as editable dropdowns — offering a change that
        // trg_record_audit_fields reverts on save. The layout declares which
        // fields those are (`system_audit`), so no column-name guessing.
        const isEditable = editing
          && !isSystemAuditField(f)
          && (f.type !== 'datetime')
          && (f.type !== 'polymorphic_lookup')
          && (f.type !== 'lookup' || lookupIsEditable)
          && (f._editable !== false)
          && !isDerivedField

        // Lookup hyperlinking — turn populated lookup fields into clickable
        // links to the parent record (Salesforce parity). Three things must
        // line up: (1) we're not in edit mode, (2) the value is non-null and
        // resolved, (3) we have a destination table for it.
        //
        // For static `lookup`: target table comes preferentially from the
        // widget config (f.lookup_table), and falls back to whatever
        // resolveLookups discovered. For `polymorphic_lookup`: target table
        // comes ONLY from the resolved lookup entry — the widget config
        // doesn't know the destination, that's the whole point of the type.
        let lookupLinkTarget = null
        if (!editing && isLookupLike && raw && onNavigateToRecord) {
          const entry = lookups.get(raw)
          let targetTable = null
          if (f.type === 'lookup') {
            targetTable = f.lookup_table || (typeof entry === 'object' ? entry?.table : null)
          } else {
            targetTable = (typeof entry === 'object' ? entry?.table : null)
          }
          if (targetTable) lookupLinkTarget = { table: targetTable, id: raw, mode: 'view' }
        }

        // docx_upload renders the same component in both edit and view modes
        // because uploads happen out-of-band (direct to storage + DB) rather
        // than through the draft → save flow. The component reads the live
        // path off the record (not the draft) and triggers a parent reload
        // after a successful upload via onRefreshRecord.
        if (f.type === 'docx_upload') {
          const livePath = record[f.name] || null
          const fieldDisabled = fieldDisabledReasons?.[f.name] || null
          return (
            <div key={fieldRenderKey(f, fieldIndex)} style={{
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
          <div key={fieldRenderKey(f, fieldIndex)} style={{
            padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
            display: 'flex', flexDirection: 'column', gap: 4,
            background: isEditable ? '#fafffe' : 'transparent',
          }}>
            <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {f.label}
              {editing && isRequiredField && !isDerivedField && (
                <span style={{ color: '#2c5f8a', marginLeft: 3 }}>*</span>
              )}

            </span>
            {isEditable ? (
              <EditField
                // _sourceValues hands the lookup's inline "+ New" the record
                // being edited, so a quick-created child inherits this record's
                // parent chain instead of asking for it again.
                field={f.lookup_dependency?.kind
                  ? { ...f, _sourceValues: draft, _dependencyValues: Object.fromEntries(
                      (f.lookup_dependency.depends_on || []).map(k => [k, draft[k]]).filter(([, val]) => val != null)
                    ) }
                  : (f.type === 'lookup' ? { ...f, _sourceValues: draft } : f)}
                value={draft[f.name]} onChange={onChange}
                picklistOpts={allPicklistOpts?.[f.name]} lookupOpts={allLookupOpts?.[f.name]}
                recordId={recordId} />
            ) : lookupLinkTarget ? (
              // Render as a REAL anchor (RecordLink) so the browser's native
              // "Open link in new tab", middle-click, and Ctrl/Cmd-click all
              // work on a lookup field — a plain <button> gives none of that.
              // A plain left-click still does fast in-app navigation.
              <RecordLink
                table={lookupLinkTarget.table}
                id={lookupLinkTarget.id}
                onActivate={() => onNavigateToRecord(lookupLinkTarget)}
                style={{
                  fontSize: 13, color: '#1a5a8a',
                  textAlign: 'left', cursor: 'pointer',
                  textDecoration: 'underline', textUnderlineOffset: 2,
                  fontFamily: 'inherit', wordBreak: 'break-word',
                }}
                title={`Open ${display}`}
              >
                {display}
              </RecordLink>
            ) : (
              <span style={{
                fontSize: 13,
                color: isLink ? '#1a5a8a' : C.textPrimary,
                fontWeight: 400,
                fontFamily: f.type === 'number' || f.type === 'currency' || f.type === 'percent' ? 'JetBrains Mono, monospace' : 'inherit',
                wordBreak: 'break-word',
              }}>
                {f.type === 'picklist' && raw
                  ? <Badge s={display} />
                  : <FieldValueLink type={f.type} raw={raw} display={display} label={f.label} />}
              </span>
            )}
          </div>
        )
  }

  // Row-major layout with full-width spanning. Opt-in via widget_config.layout
  // === 'rows' or any field carrying `full_width`. Fields render in reading
  // (array) order across a 2-column grid: `column: 2` pins a field to the right
  // slot, everything else fills the left; `full_width: true` spans the whole
  // width (address blocks stacked Street/City/State/Zip, radio groups, checkbox
  // lists — matching a source form 1:1). This replaces the older column-fill
  // approach (two independent left/right stacks + blank spacers) which
  // mis-aligned whenever one column held more fields than the other. Layouts
  // that opt in neither way are untouched (legacy paths below).
  const useRowMajor = widget.widget_config?.layout === 'rows' || fields.some(f => f.full_width)
  if (useRowMajor) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridAutoFlow: 'row', alignItems: 'start' }}>
        {fields.map((f, i) => {
          const el = renderField(f, i)
          if (el == null) return null
          const cellStyle = f.full_width
            ? { gridColumn: '1 / -1' }
            : { gridColumnStart: f.column === 2 ? 2 : 1 }
          return <div key={fieldRenderKey(f, i)} style={cellStyle}>{el}</div>
        })}
      </div>
    )
  }

  // Column-aware layout: when fields carry an explicit `column` (set in the new
  // page-layout builder) render fixed columns (Left / Center / Right) and stack
  // each column's fields in order. Layouts without `column` keep the responsive
  // auto-fit flow — unchanged.
  const useCols = fields.some(f => f.column)
  const nCols = useCols ? Math.max(1, ...fields.map(f => f.column || 1)) : 1
  if (useCols) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${nCols}, minmax(0, 1fr))`, alignItems: 'start' }}>
        {Array.from({ length: nCols }, (_, i) => i + 1).map(c => (
          <div key={c}>{fields.filter(f => (f.column || 1) === c).map((f, i) => renderField(f, i))}</div>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0' }}>
      {fields.map((f, i) => renderField(f, i))}
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
      case 'number': {
        // Default the floor to 0 (no negatives); a config field that needs
        // negatives declares an explicit negative field.min, which also opts
        // its sign key back in.
        const allowNeg = typeof field.min === 'number' && field.min < 0
        return <input type="number"
          min={field.min ?? nonNegativeMin(allowNeg)} max={field.max} step="1"
          style={{ ...inputBase, fontFamily: 'JetBrains Mono, monospace', maxWidth: 120 }}
          value={value ?? ''}
          onKeyDown={blockNegativeKeys(allowNeg)}
          onChange={e => {
            if (e.target.value === '') { onChange(null); return }
            const n = Number(e.target.value)
            onChange(!allowNeg && n < 0 ? 0 : n)
          }} />
      }
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

// Read-only related lists render every fetched row inside a fixed-height
// scroll window (below) rather than truncating to a handful with a mandatory
// jump to another page. The scrollbar only appears once the rows exceed this
// height, so short lists look exactly as before. ~9 rows tall.
const RELATED_LIST_MAX_HEIGHT = 360

// Format a full timestamp (ISO / Zulu) into a readable local date + time,
// e.g. "Jul 29, 2026, 6:48 PM". Related-list datetime/timestamp columns use
// this so a raw "2026-07-29T18:48:19.013+00:00" never surfaces to users.
function formatRelatedDateTime(v) {
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Render a single cell. Extracted so the editable and read-only paths can
// share formatting without duplicating the picklist / date / number logic.
function renderRelatedCell(col, val, picklists, { isFirstCol, canNavigate, childTable, rowId, onActivate }) {
  let shown = val
  if (col.type === 'picklist' && shown) shown = picklists.byId.get(shown) || shown
  if (col.type === 'date' && shown) {
    shown = new Date(shown + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if ((col.type === 'datetime' || col.type === 'timestamp' || col.type === 'timestamptz') && shown) {
    shown = formatRelatedDateTime(shown)
  }
  if (col.type === 'number' && shown != null) shown = Number(shown).toLocaleString()
  if (col.type === 'boolean') shown = shown === true ? 'Yes' : shown === false ? 'No' : shown
  if (col.type === 'phone' && shown) shown = formatUsPhoneDisplay(shown)
  // The first column is the record's name — render it as a REAL anchor so the
  // browser's "Open link in new tab", middle-click, and Ctrl/Cmd-click work on
  // a related-list row exactly like a Salesforce list. Plain click still does
  // fast in-app navigation (and the whole <tr> stays clickable for convenience).
  const asLink = isFirstCol && canNavigate && childTable && rowId && col.type !== 'picklist'
  const plain = shown != null && shown !== '' ? shown : '—'
  // A phone/email/website in a related list is as actionable as it is on the
  // record page — click the number in a Contacts list and it dials. Skipped on
  // the name cell, which is already the anchor to the record (no nested <a>).
  const content = col.type === 'picklist' && shown
    ? <Badge s={shown} />
    : (asLink ? plain : <FieldValueLink type={col.type} raw={val} display={plain} label={col.label} />)
  return (
    <td key={col.name} style={{
      padding: '10px 14px',
      fontSize: 12.5,
      color: isFirstCol && canNavigate ? '#1a5a8a' : C.textPrimary,
      fontWeight: isFirstCol ? 500 : 400,
      fontFamily: col.type === 'number' ? 'JetBrains Mono, monospace' : 'inherit',
      whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {asLink
        ? <RecordLink table={childTable} id={rowId} onActivate={onActivate}
            style={{ color: 'inherit', textDecoration: 'none' }}>{content}</RecordLink>
        : content}
    </td>
  )
}

// Sort indicator for related-list column headers. Dimmed neutral arrow when the
// column isn't the active sort key; solid up/down when it is.
function RelatedSortArrow({ active, dir }) {
  return (
    <span style={{ marginLeft: 4, opacity: active ? 0.9 : 0.22, fontSize: 8, verticalAlign: 'middle' }}>
      {active ? (dir === 'asc' ? '▲' : '▼') : '▲'}
    </span>
  )
}

// Resolve the value a related-list cell sorts on — mirrors renderRelatedCell's
// display resolution so the order matches what the user sees. Picklist columns
// sort by their resolved label (not the raw UUID); lookup columns are already
// flattened to their display string by fetchRelatedRecords.
function relatedSortKey(col, row, picklists) {
  const v = row[col.name]
  if (col.type === 'picklist' && v) return picklists.byId.get(v) || v
  return v
}

// Compare two related rows on a column. Blanks always sort last (both
// directions); numbers compare numerically; dates compare as ISO strings;
// everything else is a case-insensitive, numeric-aware string compare. Returns
// the ascending comparison — the caller negates it for descending.
function compareRelatedRows(a, b, col, picklists) {
  const av = relatedSortKey(col, a, picklists)
  const bv = relatedSortKey(col, b, picklists)
  const aEmpty = av == null || av === ''
  const bEmpty = bv == null || bv === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (col.type === 'number') return (Number(av) || 0) - (Number(bv) || 0)
  if (col.type === 'date' || col.type === 'datetime' || col.type === 'timestamp' || col.type === 'timestamptz') {
    return String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0
  }
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
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
  if ((col.type === 'datetime' || col.type === 'timestamp' || col.type === 'timestamptz') && shown) {
    shown = formatRelatedDateTime(shown)
  }
  if (col.type === 'number' && shown != null) shown = Number(shown).toLocaleString()
  if (col.type === 'boolean') shown = shown === true ? 'Yes' : shown === false ? 'No' : shown
  if (col.type === 'phone' && shown) shown = formatUsPhoneDisplay(shown)
  if (col.type === 'picklist' && shown) return <Badge s={shown} />
  if (shown == null || shown === '') return <span style={{ color: C.textMuted }}>—</span>
  return (
    <FieldValueLink
      type={col.type} raw={val} display={shown} label={col.label}
      style={{
        fontFamily: col.type === 'number' ? 'JetBrains Mono, monospace' : 'inherit',
        color: C.textSecondary,
      }}
    />
  )
}

function RelatedListWidget({
  widget, picklists, onNavigateToRecord, parentRecordId, onRefreshRelated,
  parentTable, parentRecord, parentRecordName,
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
  // Related-record (via-path) lists show records that link to an intermediate
  // record, not to this one — "New" can't seed a valid parent link (which
  // intermediate record?). Create those from the intermediate record's own
  // page instead; rows still navigate normally. via is a chain array (legacy
  // single-object shape tolerated).
  const hasViaPath = Array.isArray(config.via) ? config.via.length > 0 : !!config.via
  // Shared-parent (sibling) lists show records that link to this record's
  // PARENT, not to this record — "New" can't seed a valid parent link either
  // (an enrollment belongs to the Property, not the Building it's shown on).
  // Create those from the parent's page; rows still navigate normally.
  const hasSharedParent = !!config.shared_parent
  // row_href_field: rows open a URL (e.g. documents.file_url) in a new tab
  // instead of navigating to a record page. Used by document related lists,
  // which have no record detail page but do have a viewable file.
  const rowHrefField = config.row_href_field
  // allow_new:false suppresses the New button — for lists whose rows aren't
  // form-created (documents are uploaded, not entered on a create form).
  const canCreate = canNavigate && !hasViaPath && !hasSharedParent
    && !rowHrefField && config.allow_new !== false

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

  // ── Column-header sorting (view-only) ────────────────────────────────
  // Click a column header to sort the list by that column; click again to
  // flip direction. Reorderable lists carry an explicit manual order (drag
  // handles), so header-sort would fight that — it's offered only when the
  // list isn't in drag-reorder mode. The sort never persists; it reorders the
  // rendered rows only.
  const sortable = !editableReorder
  const [sortCol, setSortCol] = useState(null)   // column.name, or null for fetch order
  const [sortDir, setSortDir] = useState('asc')
  function toggleRelatedSort(col) {
    if (!sortable) return
    if (sortCol === col.name) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col.name)
      setSortDir('asc')
    }
  }

  // Both modes now render the full fetched set: editable so drag targets are
  // always visible, read-only inside a fixed-height scroll window so the user
  // can scroll through the related records in place instead of leaving the
  // page. Short lists stay short; long lists gain a scrollbar.
  const shownRows = useMemo(() => {
    if (!sortCol) return localRows
    const col = columns.find(c => c.name === sortCol)
    if (!col) return localRows
    const arr = [...localRows]
    arr.sort((a, b) => {
      const cmp = compareRelatedRows(a, b, col, picklists)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [localRows, sortCol, sortDir, columns, picklists])
  // True total for the header count, accurate beyond the fetch cap
  // (fetchRelatedRecords attaches _total via PostgREST count:'exact').
  const totalCount = (typeof allRows._total === 'number') ? allRows._total : localRows.length
  // True when the server holds more rows than the scroll window loaded (list
  // larger than the fetch cap) — used to enrich the "View All →" label so the
  // user knows the window isn't showing every record.
  const hasMoreThanLoaded = !editable && totalCount > localRows.length

  // hide_when_empty: opt-in widget_config flag for related lists that
  // should disappear entirely when no rows exist (rather than rendering
  // the standard zero-state card). Used by the Disaster Exposure list on
  // the Property page layout so non-NC properties don't show a placeholder
  // section. Suppresses both the read-only and editable variants — the
  // page layout configuration is the single signal that a property does
  // or doesn't have ingested data of this type.
  if (config.hide_when_empty === true && localRows.length === 0) {
    return null
  }

  const handleRowClick = (row) => {
    // Document-style lists open the file directly rather than a record page.
    if (rowHrefField) {
      const href = row?.[rowHrefField]
      if (href) window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    if (!canNavigate || !row?.id) return
    onNavigateToRecord({ table: childTable, id: row.id, mode: 'view' })
  }

  const handleNewClick = async (e) => {
    e.stopPropagation()
    if (!canCreate) return

    // Build a prefill that carries the FULL parent chain into the new child,
    // not just the direct FK. Example: creating an Opportunity from a Property
    // seeds property_id (direct) AND opportunity_account_id (the property's
    // account) so the user never re-picks context the system already knows.
    //
    // Mechanism, all data-driven from TABLE_META:
    //   1. Always seed the direct FK back to this parent ({fk: parentRecordId}).
    //   2. For each of the CHILD's declared parent FKs, find the table it points
    //      to. If we can supply a value for that table from the current parent
    //      record — either because the parent IS that table (use its id) or
    //      because the parent record carries an FK to that table — seed it.
    const prefillObj = {}
    if (fk && parentRecordId) prefillObj[fk] = parentRecordId

    const childMeta = TABLE_META[childTable]
    if (childMeta && parentTable && parentRecord) {
      // Map of "ancestor table" -> "value to use for an FK pointing at it",
      // assembled from the parent record we're creating from.
      const valueByTargetTable = {}
      // The parent record itself satisfies FKs pointing at the parent table.
      valueByTargetTable[parentTable] = parentRecordId
      // Any FK the parent record carries satisfies FKs pointing at those tables.
      const parentMeta = TABLE_META[parentTable]
      if (parentMeta) {
        ;(parentMeta.parents || []).forEach((pCol, i) => {
          const targetTable = (parentMeta.parentTables || [])[i]
          const val = parentRecord[pCol]
          if (targetTable && val && !(targetTable in valueByTargetTable)) {
            valueByTargetTable[targetTable] = val
          }
        })
      }
      // Now fill each of the child's parent FKs we have a value for.
      ;(childMeta.parents || []).forEach((childFkCol, i) => {
        const targetTable = (childMeta.parentTables || [])[i]
        if (!targetTable) return
        if (childFkCol in prefillObj) return // direct FK already set
        const val = valueByTargetTable[targetTable]
        if (val) prefillObj[childFkCol] = val
      })

      // Multi-hop: the one-hop pass above only sees FKs that sit directly ON the
      // parent record. A child can need an ancestor that lives further up the
      // chain — e.g. creating an Opportunity from a BUILDING needs the account,
      // which the building doesn't carry but its property does
      // (building → property → account). Climb the ancestor chain, fetching the
      // rows we already have ids for and reading THEIR parent FKs, until every
      // parent FK the child still needs is resolved (or we run out). Data-driven
      // from TABLE_META; bounded fetch so a deep chain can't runaway.
      const stillNeeded = () => (childMeta.parents || []).some((col, i) => {
        const t = (childMeta.parentTables || [])[i]
        return t && !(col in prefillObj) && !(t in valueByTargetTable)
      })
      if (stillNeeded()) {
        // Seed the climb with every ancestor we already know an id for, except
        // the parent record itself (already fully read into valueByTargetTable).
        const toVisit = Object.entries(valueByTargetTable)
          .filter(([table]) => table !== parentTable)
          .map(([table, id]) => ({ table, id }))
        const visited = new Set()
        let hops = 0
        while (toVisit.length && hops < 6 && stillNeeded()) {
          hops += 1
          const { table, id } = toVisit.shift()
          const key = `${table}:${id}`
          if (visited.has(key)) continue
          visited.add(key)
          const meta = TABLE_META[table]
          if (!meta || !(meta.parents || []).length) continue
          try {
            const { data: row } = await supabase
              .from(table).select(meta.parents.join(', ')).eq('id', id).maybeSingle()
            if (!row) continue
            meta.parents.forEach((pCol, i) => {
              const t = (meta.parentTables || [])[i]
              const v = row[pCol]
              if (t && v && !(t in valueByTargetTable)) {
                valueByTargetTable[t] = v
                toVisit.push({ table: t, id: v })
              }
            })
          } catch (err) {
            console.warn('create prefill: ancestor climb failed', table, err)
          }
        }
        // Re-fill child parent FKs now that deeper ancestors are known.
        ;(childMeta.parents || []).forEach((childFkCol, i) => {
          const targetTable = (childMeta.parentTables || [])[i]
          if (!targetTable || childFkCol in prefillObj) return
          const val = valueByTargetTable[targetTable]
          if (val) prefillObj[childFkCol] = val
        })
      }
    }

    // Contact Role is contact-first: keep whichever parent FK the related list
    // prefilled. From a Contact, contact_id is carried and locked (and it scopes
    // the Opportunity picker to that contact's account via the
    // opportunities_for_contact_account dependent lookup); from an Opportunity,
    // opportunity_id is carried. Nothing is dropped.

    // Projects derive their name (trg_project_name) as
    // "<opportunity_name> - <record_type_label>". Seed the opportunity-name
    // base into the prefill so the create form can show the composed name the
    // moment it opens, rather than a blank box that only fills on save. The
    // record-type label is appended in the draft-seed effect (and recomposed
    // if the user changes record type). __derivedNameBase is a transient hint
    // consumed by that effect and stripped before insert.
    if (childTable === 'projects' && parentTable === 'opportunities' && parentRecord?.opportunity_name) {
      prefillObj.__derivedNameBase = parentRecord.opportunity_name
    }

    // Work Orders derive their name (trg_work_order_inherit_parent_fields) as
    // "<project_name> - <unit_number> - <work_type_name>". When created from a
    // project, seed the project name as the base hint so the create form shows
    // the composed name on open rather than a blank box. unit/work type append
    // as the user selects them; the DB trigger is the authority on final value.
    if (childTable === 'work_orders' && parentTable === 'projects' && parentRecord?.project_name) {
      prefillObj.__derivedNameBase = parentRecord.project_name
    }

    // An enrollment documents its property for a program application, so seed
    // every enrollment field the property already knows — HUD property/site
    // info, units, category, owner and management-agent contact data — the
    // whole point is that the user never re-types data the system holds.
    // enrollment_state also drives the record-type picker's state filter, so
    // a Milwaukee property offers WI record types only. All values remain
    // user-editable on the form. Only fill blanks; never clobber.
    if (childTable === 'enrollments') {
      // Resolve the property this enrollment documents — whether we're creating
      // from the property itself, from its opportunity, or from any path that
      // already seeded property_id (the generic chain seeder above carries
      // property_id from an opportunity parent) — so the same prefill runs
      // regardless of where "New Enrollment" was clicked.
      const _enrPropId = (parentTable === 'properties' ? parentRecordId : null)
        || prefillObj.property_id
        || (parentRecord && parentRecord.property_id)
      let _enrProp = (parentTable === 'properties') ? parentRecord : null
      if (!_enrProp && _enrPropId) {
        try {
          const { data: _p } = await supabase.from('properties').select('*')
            .eq('id', _enrPropId).eq('property_is_deleted', false).maybeSingle()
          _enrProp = _p
        } catch { /* leave null; the form just opens sparser */ }
      }
      if (_enrProp) {
      const parentRecord = _enrProp
      const copyFromProperty = (src, dst) => {
        const v = parentRecord[src]
        if (v != null && v !== '' && (prefillObj[dst] == null || prefillObj[dst] === '')) prefillObj[dst] = v
      }
      copyFromProperty('property_hud_property_id',            'enrollment_hud_property_id')
      copyFromProperty('property_name',                       'enrollment_property_name')
      copyFromProperty('property_street',                     'enrollment_site_address')
      copyFromProperty('property_city',                       'enrollment_city')
      copyFromProperty('property_state',                      'enrollment_state')
      copyFromProperty('property_zip',                        'enrollment_zip')
      copyFromProperty('property_county',                     'enrollment_county')
      copyFromProperty('property_total_units',                'enrollment_total_units')
      copyFromProperty('property_total_number_of_units',      'enrollment_total_units')
      copyFromProperty('property_assisted_units',             'enrollment_assisted_units')
      copyFromProperty('property_category',                   'enrollment_property_category')
      // Number of buildings / units-per-building / property addresses / LEA#s
      // are pre-populated from the property's actual building records below,
      // not from the property summary columns.
      copyFromProperty('property_mf_property_category',       'enrollment_property_category')
      copyFromProperty('property_mf_raw_property_category_name', 'enrollment_property_category')
      copyFromProperty('property_hud_owner_org',              'enrollment_owner_organization')
      copyFromProperty('property_hud_owner_phone',            'enrollment_owner_phone')
      copyFromProperty('property_hud_owner_email',            'enrollment_owner_email')
      copyFromProperty('fein',                                'enrollment_owner_fein')
      copyFromProperty('property_hud_management_org',         'enrollment_management_agent')
      copyFromProperty('property_hud_management_phone',       'enrollment_management_phone')
      copyFromProperty('property_hud_management_email',       'enrollment_management_email')
      copyFromProperty('property_primary_contract_number',    'enrollment_hud_contract_number')
      copyFromProperty('property_primary_contract_tracs_status', 'enrollment_hud_tracs_status')
      copyFromProperty('property_primary_contract_expiration','enrollment_hud_contract_expiration')
      copyFromProperty('property_is_202_811',                 'enrollment_is_202_811')
      copyFromProperty('property_is_opportunity_zone',        'enrollment_is_opportunity_zone')
      // Payment address defaults to "same as primary" (No) — the payment
      // address is then seeded from the contractor account below. The user
      // flips this to Yes only when payment goes somewhere else.
      if (prefillObj.enrollment_payment_address_different == null) {
        prefillObj.enrollment_payment_address_different = false
      }
      // Owner address is one text field on the enrollment; the property holds
      // it in four parts — compose "street, city, ST zip".
      const composeAddress = (street, city, state, zip) => {
        const head = [street, city].map(v => String(v || '').trim()).filter(Boolean).join(', ')
        const tail = [state, zip].map(v => String(v || '').trim()).filter(Boolean).join(' ')
        return [head, tail].filter(Boolean).join(', ')
      }
      if (prefillObj.enrollment_owner_address == null || prefillObj.enrollment_owner_address === '') {
        const composed = composeAddress(
          parentRecord.property_hud_owner_address, parentRecord.property_hud_owner_city,
          parentRecord.property_hud_owner_state, parentRecord.property_hud_owner_zip)
        if (composed) prefillObj.enrollment_owner_address = composed
      }
      // HUD program: the MF raw program types when imported, else composed
      // from the program-participation flags.
      if (prefillObj.enrollment_hud_program == null || prefillObj.enrollment_hud_program === '') {
        let programs = [parentRecord.property_mf_raw_program_type1, parentRecord.property_mf_raw_program_type2]
          .map(v => String(v || '').trim()).filter(Boolean)
        programs = [...new Set(programs)]
        if (!programs.length) {
          if (parentRecord.property_in_program_mf_assisted)    programs.push('Multifamily Assisted')
          if (parentRecord.property_in_program_public_housing) programs.push('Public Housing')
          if (parentRecord.property_in_program_lihtc)          programs.push('LIHTC')
          if (parentRecord.property_in_program_usda_rd)        programs.push('USDA Rural Development')
        }
        if (programs.length) prefillObj.enrollment_hud_program = programs.join(' / ')
      }
      // Subsidized share: not stored on the property — derive from the unit
      // counts when both are present so the form opens pre-computed.
      const totalUnits = prefillObj.enrollment_total_units
      const assistedUnits = prefillObj.enrollment_assisted_units
      if (prefillObj.enrollment_subsidized_share_pct == null
          && Number(totalUnits) > 0 && assistedUnits != null) {
        prefillObj.enrollment_subsidized_share_pct =
          Math.round((Number(assistedUnits) / Number(totalUnits)) * 1000) / 10
      }
      // Occupancy: public-housing properties carry an occupied count; MF
      // properties carry a percent-occupied — either way, seed occupied and
      // derive unoccupied as total minus occupied.
      if (prefillObj.enrollment_occupied_units == null) {
        let occupied = parentRecord.property_ph_total_occupied
        const pctRaw = parentRecord.property_mf_raw_pct_occupied ?? parentRecord.property_ph_pct_occupied
        if (occupied == null && pctRaw != null && Number(totalUnits) > 0) {
          const pct = Number(pctRaw)
          if (Number.isFinite(pct) && pct > 0) occupied = Math.round(Number(totalUnits) * pct / 100)
        }
        if (occupied != null && Number.isFinite(Number(occupied))) {
          prefillObj.enrollment_occupied_units = Number(occupied)
          if (prefillObj.enrollment_unoccupied_units == null && Number(totalUnits) > 0) {
            prefillObj.enrollment_unoccupied_units = Math.max(0, Number(totalUnits) - Number(occupied))
          }
        }
      }
      // Bedroom mix: USDA imports carry per-bedroom unit counts (5 and 6
      // bedroom collapse into the enrollment's 5+ bucket).
      const seedBr = (dst, ...srcs) => {
        if (prefillObj[dst] != null) return
        const total = srcs.reduce((sum, s) => {
          const n = Number(parentRecord[s])
          return Number.isFinite(n) ? (sum ?? 0) + n : sum
        }, null)
        if (total != null) prefillObj[dst] = total
      }
      seedBr('enrollment_br_1',     'property_usda_raw_total_1_bedroom_units')
      seedBr('enrollment_br_2',     'property_usda_raw_total_2_bedroom_units')
      seedBr('enrollment_br_3',     'property_usda_raw_total_3_bedroom_units')
      seedBr('enrollment_br_4',     'property_usda_raw_total_4_bedroom_units')
      seedBr('enrollment_br_5plus', 'property_usda_raw_total_5_bedroom_units', 'property_usda_raw_total_6_bedroom_units')
      // Application contact + owner/management fallbacks live on related
      // records the property links to (primary contact, owner account,
      // management-company account). Fetch them so the form opens with the
      // people fields filled too; any failure just leaves those blanks.
      try {
        const fetchRow = (table, id, cols, delCol) => id
          ? supabase.from(table).select(cols).eq('id', id).eq(delCol, false).maybeSingle()
          : Promise.resolve({ data: null })
        const [contactRes, accountRes, mgmtRes, buildingsRes] = await Promise.all([
          fetchRow('contacts', parentRecord.property_primary_contact_id,
            'contact_name, contact_title, contact_phone, contact_mobile_phone, contact_email', 'contact_is_deleted'),
          fetchRow('accounts', parentRecord.property_account_id,
            'account_name, account_phone, account_email, billing_street, billing_city, billing_state, billing_zip', 'account_is_deleted'),
          fetchRow('accounts', parentRecord.property_management_company_id,
            'account_name, account_phone, account_email', 'account_is_deleted'),
          supabase.from('buildings')
            .select('building_address, building_name, building_number_or_name, building_city, building_state, building_zip, building_total_units, building_number_of_units, ira_confirmation_code_lea')
            .eq('property_id', parentRecord.id).eq('building_is_deleted', false),
        ])
        const fill = (dst, v) => {
          if (v != null && v !== '' && (prefillObj[dst] == null || prefillObj[dst] === '')) prefillObj[dst] = v
        }
        const contact = contactRes?.data
        if (contact) {
          fill('enrollment_contact_name',  contact.contact_name)
          fill('enrollment_contact_title', contact.contact_title)
          fill('enrollment_contact_phone', contact.contact_phone || contact.contact_mobile_phone)
          fill('enrollment_contact_email', contact.contact_email)
        } else {
          // No primary contact — the MF import's management contact person is
          // the next-best application contact.
          fill('enrollment_contact_name',  parentRecord.property_mf_raw_mgmt_contact_full_name)
          fill('enrollment_contact_title', parentRecord.property_mf_raw_mgmt_contact_indv_title_text)
          fill('enrollment_contact_phone', parentRecord.property_mf_raw_mgmt_contact_main_phn_nbr)
          fill('enrollment_contact_email', parentRecord.property_mf_raw_mgmt_contact_email_text)
        }
        const account = accountRes?.data
        if (account) {
          // The property's account is the owner company (one account per
          // company) — it backstops any owner field HUD didn't supply.
          fill('enrollment_owner_organization', account.account_name)
          fill('enrollment_owner_phone',        account.account_phone)
          fill('enrollment_owner_email',        account.account_email)
          fill('enrollment_owner_address', composeAddress(
            account.billing_street, account.billing_city, account.billing_state, account.billing_zip))
        }
        const mgmt = mgmtRes?.data
        if (mgmt) {
          fill('enrollment_management_agent', mgmt.account_name)
          fill('enrollment_management_phone', mgmt.account_phone)
          fill('enrollment_management_email', mgmt.account_email)
        }
        // Pre-populate the building-derived fields from the property's actual
        // building records (the pre-approval form asks for these per building):
        // number of buildings, units per building, the address of each
        // building, and each building's LEA (IRA confirmation) number.
        const buildings = buildingsRes?.data || []
        if (buildings.length) {
          if (prefillObj.enrollment_number_of_buildings == null)
            prefillObj.enrollment_number_of_buildings = buildings.length

          const unitCounts = buildings
            .map(b => Number(b.building_total_units ?? b.building_number_of_units))
            .filter(n => Number.isFinite(n) && n > 0)
          if (prefillObj.enrollment_units_per_building == null && unitCounts.length) {
            const totalUnits = unitCounts.reduce((a, b) => a + b, 0)
            prefillObj.enrollment_units_per_building = Math.round(totalUnits / buildings.length)
          }

          if (prefillObj.enrollment_property_addresses == null || prefillObj.enrollment_property_addresses === '') {
            const addrs = buildings
              .map(b => composeAddress(
                b.building_address || b.building_number_or_name || b.building_name,
                b.building_city, b.building_state, b.building_zip))
              .filter(Boolean)
            const uniqAddrs = [...new Set(addrs)]
            if (uniqAddrs.length) prefillObj.enrollment_property_addresses = uniqAddrs.join('\n')
          }

          if (prefillObj.enrollment_property_lea_numbers == null || prefillObj.enrollment_property_lea_numbers === '') {
            const leas = [...new Set(buildings
              .map(b => String(b.ira_confirmation_code_lea || '').trim())
              .filter(Boolean))]
            if (leas.length) prefillObj.enrollment_property_lea_numbers = leas.join(', ')
          }
        }
        // Registered contractor: default to the EES entity for the property's
        // state so it shows selected on the create form (mirrors the DB default
        // trigger, which otherwise only fills it on save). Resolved by the same
        // "Energy Efficiency Services of <state>" naming convention. The payment
        // address defaults to that contractor's address too (it equals the
        // primary address unless "payment address different" is set) so the
        // Payment State/City/ZIP open populated.
        if (prefillObj.enrollment_contractor_account_id == null) {
          const stateName = ({
            WI: 'Wisconsin', NC: 'North Carolina', CO: 'Colorado',
            MI: 'Michigan', IN: 'Indiana',
          })[String(parentRecord.property_state || '').trim().toUpperCase()]
          if (stateName) {
            const { data: eesAcct } = await supabase.from('accounts')
              .select('id, billing_street, billing_city, billing_state, billing_zip')
              .eq('account_is_deleted', false)
              .ilike('account_name', 'Energy Efficiency Services of ' + stateName)
              .order('account_record_number')
              .limit(1)
              .maybeSingle()
            if (eesAcct?.id) {
              prefillObj.enrollment_contractor_account_id = eesAcct.id
              fill('enrollment_payment_address_line1', eesAcct.billing_street)
              fill('enrollment_payment_city',          eesAcct.billing_city)
              fill('enrollment_payment_state',         eesAcct.billing_state)
              fill('enrollment_payment_zip',           eesAcct.billing_zip)
            }
          }
        }
      } catch (err) {
        console.warn('enrollment prefill: related-record fetch failed', err)
      }
      // Owner type is a two-value business field (Nicholas, 2026-07-26):
      // Public Housing Authority or Private Ownership. HUD's raw taxonomy
      // (Non-Profit / Profit Motivated / Limited Dividend / ...) collapses to
      // Private Ownership; the public-housing program flag or a housing-
      // authority / community-development-authority owner name means PHA.
      // Runs after the account fallback so the account name counts as an
      // owner-name signal too.
      if (prefillObj.enrollment_owner_type == null || prefillObj.enrollment_owner_type === '') {
        const ownerName = String(prefillObj.enrollment_owner_organization || '')
        const rawType = String(parentRecord.property_hud_owner_type || '')
        const isPha = parentRecord.property_in_program_public_housing === true
          || /housing authority|community development authority|\bcda\b|\bpha\b/i.test(ownerName)
          || /housing authority/i.test(rawType)
        if (ownerName || rawType || parentRecord.property_account_id) {
          prefillObj.enrollment_owner_type = isPha ? 'Public Housing Authority' : 'Private Ownership'
        }
      }
      // Enrollment name composes "<property name> - <record type label>" once
      // the user picks a record type (same derived-name mechanism projects
      // use). Transient hint — stripped before insert.
      if (parentRecord.property_name) {
        prefillObj.__derivedNameBase = parentRecord.property_name
      }
      }

      // Project-Reservation reservation is for ONE building — the enrollment's
      // opportunity carries it. Seed building_id (drives the building.* inherited
      // fields on the layout) and the overridable cost/savings roll-ups from the
      // opportunity's line items so the form opens populated. Only fills blanks.
      const _enrOppId = prefillObj.opportunity_id
        || (parentTable === 'opportunities' ? parentRecordId : null)
      if (_enrOppId) {
        try {
          const { data: _opp } = await supabase.from('opportunities')
            .select('building_id').eq('id', _enrOppId).maybeSingle()
          if (_opp?.building_id && !prefillObj.building_id) prefillObj.building_id = _opp.building_id
        } catch { /* leave building_id unset; the picker still lets them choose */ }
        try {
          const { data: _lines } = await supabase.from('opportunity_line_items')
            .select('oli_total_price, oli_estimated_term_savings')
            .eq('opportunity_id', _enrOppId).eq('oli_is_deleted', false)
          if (_lines && _lines.length) {
            const cost = _lines.reduce((s, l) => s + (Number(l.oli_total_price) || 0), 0)
            const savings = _lines.reduce((s, l) => s + (Number(l.oli_estimated_term_savings) || 0), 0)
            if (prefillObj.enrollment_total_project_cost == null && cost) prefillObj.enrollment_total_project_cost = cost
            if (prefillObj.enrollment_total_ira_homes_cost == null && cost) prefillObj.enrollment_total_ira_homes_cost = cost
            if (prefillObj.enrollment_modeled_savings == null && savings) prefillObj.enrollment_modeled_savings = savings
          }
        } catch { /* roll-ups stay blank; user can enter them */ }
      }
    }

    // An incentive application is a program submittal for one building. However
    // it is created — from the building's or property's related list, from an
    // Opportunity, or elsewhere — it should open with everything the system
    // already knows so almost nothing is typed (Nicholas: "these should not have
    // to be manually entered"). The generic chain seeder above has already
    // resolved whatever FKs it could into prefillObj (building_id, property_id,
    // and — when created from an opportunity — opportunity_id). Here we read
    // those parent rows and copy their attributes: installation address, square
    // footage, floors, year built, unit counts and utility providers from the
    // BUILDING; owner and occupancy from the PROPERTY; the business-entity from
    // the property's OWNER ACCOUNT; program name/year, income code and utility
    // account numbers from the OPPORTUNITY; and the primary contractor (EES) for
    // the program's state. When no opportunity was carried (created from a
    // building or property) we resolve the building's — else the property's —
    // most recent live opportunity so the program fields inherit too and the
    // Opportunity lookup links up. ia_installation_address_state also drives the
    // record-type picker's state filter (prefillState). Only fill blanks; never
    // clobber a chain-seeded value; every value stays user-editable.
    if (childTable === 'incentive_applications') {
      const fill = (dst, v) => {
        if (v != null && v !== '' && (prefillObj[dst] == null || prefillObj[dst] === '')) prefillObj[dst] = v
      }
      // The building's "how is this building heated" answer is a picklist UUID;
      // resolve it against the loaded picklists so we seed a readable label.
      const resolvePicklistLabel = (uuid) => {
        if (!uuid) return null
        for (const key of Object.keys(picklists || {})) {
          const opt = (picklists[key] || []).find(o => o.value === uuid || o.id === uuid)
          if (opt) return opt.label || opt.name || null
        }
        return null
      }
      try {
        let oppId   = prefillObj.opportunity_id || null
        const bldId = prefillObj.building_id || null
        let propId  = prefillObj.property_id || null

        // No opportunity carried (created from a building/property): the
        // opportunity IS the program, and the program decides which application
        // form this may be — so it is derived only when the ancestry gives ONE
        // answer, and asked for in the record-type picker when it gives several.
        // Never guessed: a guess here does not merely mis-default a field, it
        // hides every other program's form (Nicholas, 2026-08-29).
        if (!oppId && (bldId || propId)) {
          oppId = await seedConstrainingParent('incentive_applications', prefillObj,
            { buildingId: bldId, propertyId: propId })
          if (oppId && !propId) {
            const { data: oppProp } = await supabase.from('opportunities')
              .select('property_id').eq('id', oppId).maybeSingle()
            if (oppProp?.property_id) propId = oppProp.property_id
          }
        }

        // Read the parent rows we now have ids for (any failure leaves those
        // fields blank for manual entry).
        const fetchRow = (table, id, cols, delCol) => id
          ? supabase.from(table).select(cols).eq('id', id).eq(delCol, false).maybeSingle()
          : Promise.resolve({ data: null })
        const [oppRes, buildingRes, propertyRes] = await Promise.all([
          fetchRow('opportunities', oppId,
            'opportunity_program, opportunity_program_year, ' +
            'opportunity_income_qualified_confirmation_code, opportunity_ira_income_code, ' +
            'opportunity_electric_account_number, opportunity_gas_account_number, ' +
            'opportunity_state, opportunity_account_id, opportunity_name, property_id', 'opportunity_is_deleted'),
          fetchRow('buildings', bldId,
            'building_square_footage, building_sq_ft, building_stories, building_stories_of_building, ' +
            'building_year_built, building_total_units, building_number_of_units, ' +
            'building_address, building_city, building_state, building_zip, ' +
            'building_electric_utility, building_electric_fuel_provider, building_electric_account_number, ' +
            'building_gas_utility, building_gas_fuel_provider, building_gas_account_number, ' +
            'building_heating_fuel_type, building_heating_fuel_provider', 'building_is_deleted'),
          fetchRow('properties', propId,
            'property_street, property_city, property_state, property_zip, property_total_units, ' +
            'property_ph_total_occupied, property_account_id, property_name, ' +
            'property_hud_owner_org, property_hud_owner_email, property_hud_owner_phone', 'property_is_deleted'),
        ])
        const opp = oppRes?.data
        const b   = buildingRes?.data
        const p   = propertyRes?.data

        // Program fields — from the opportunity. Same definition the picker's
        // parent selector uses when the opportunity is chosen a moment later,
        // so a form opened from the building carries the same program facts as
        // one opened from the opportunity.
        if (oppId) {
          const inh = await fetchOpportunityInheritedFields('incentive_applications', oppId)
          for (const [col, val] of Object.entries(inh.values)) fill(col, val)
        }

        // Building attributes. (ia_building_name is a bare uuid with no FK/lookup
        // wiring — it renders as raw text, so we leave it blank rather than show
        // a UUID; the real relationship is the NOT NULL building_id FK.)
        if (b) {
          const sqft = b.building_square_footage ?? b.building_sq_ft
          fill('ia_building_square_footage',      sqft)
          fill('ia_total_building_square_footage', sqft)
          fill('ia_total_floors_in_building',     b.building_stories ?? b.building_stories_of_building)
          if (b.building_year_built != null && b.building_year_built !== '') {
            fill('ia_year_the_building_was_built', String(b.building_year_built))
          }
          const units = b.building_total_units ?? b.building_number_of_units
          fill('ia_multifamily_of_units_in_building', units)
          fill('ia_total_number_of_units',        units)
          fill('ia_installation_address_street',  b.building_address)
          fill('ia_installation_address_city',    b.building_city)
          fill('ia_installation_address_state',   b.building_state)
          fill('ia_installation_address_zip',     b.building_zip)
          // Gas/Electric Utility are picklists on the building but plain text on
          // the application form, so the label is copied across — writing the
          // stored uuid would print a uuid on the form and in every report on it.
          const utilityLabels = await fetchPicklistLabelsByIds(
            [b.building_electric_utility, b.building_gas_utility])
          const utilityLabel = (v) => utilityLabels.get(v) || null
          fill('ia_electric_provider',            utilityLabel(b.building_electric_utility) || b.building_electric_fuel_provider)
          fill('ia_electric_account_number',      b.building_electric_account_number)
          fill('ia_natural_gas_provider',         utilityLabel(b.building_gas_utility) || b.building_gas_fuel_provider)
          fill('ia_natural_gas_account_number',   b.building_gas_account_number)
          fill('ia_other_heating_fuel_provider',  b.building_heating_fuel_provider)
          fill('ia_how_is_this_building_heated',  resolvePicklistLabel(b.building_heating_fuel_type))
        }

        // Installation address / unit counts come from the property.
        if (p) {
          fill('ia_installation_address_street',  p.property_street)
          fill('ia_installation_address_city',    p.property_city)
          fill('ia_installation_address_state',   p.property_state)
          fill('ia_installation_address_zip',     p.property_zip)
          fill('ia_total_number_of_units',        p.property_total_units)
          fill('ia_total_number_of_occupied_units', p.property_ph_total_occupied)
        }

        // The owner is the property's OWNER ACCOUNT -- one account per real
        // company -- and that is the only source for the owner's NAME
        // (Nicholas, 2026-09-01: "it needs to come from the property object
        // owner account, not the HUD owner org").
        //
        // These two lines used to read property_hud_owner_org, and because fill()
        // only fills a blank they ran FIRST and beat the account name below, which
        // was therefore dead code. That is the same defect 20260901221600 fixed on
        // the application's own Property Owner Name field: on PROP-07530 the HUD
        // import still named a previous owner, so correcting the owner on the
        // property changed nothing on the form.
        //
        // The HUD owner's email and phone are still worth having -- an owner
        // account carries no email on any live property -- but they are borrowed
        // only when the HUD file names the SAME organisation as the account.
        // Where it names a different one, those contact details belong to that
        // other owner and must never print under this account's name.
        const ownerAccountId = p?.property_account_id || opp?.opportunity_account_id || null
        if (ownerAccountId) {
          const { data: acct } = await supabase.from('accounts')
            .select('account_name, account_phone, account_email')
            .eq('id', ownerAccountId).eq('account_is_deleted', false).maybeSingle()
          if (acct) {
            fill('ia_business_entity_name',         acct.account_name)
            fill('ia_business_entity_phone_number', acct.account_phone)
            fill('ia_business_entity_email',        acct.account_email)
            fill('ia_building_owner_name',          acct.account_name)
            fill('ia_building_owner_name_ira',      acct.account_name)
            fill('ia_building_owner_email_address', acct.account_email)
            fill('ia_building_owner_office_phone',  acct.account_phone)

            const namesSameOrg = (a, b) => !!a && !!b
              && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
            if (namesSameOrg(p?.property_hud_owner_org, acct.account_name)) {
              fill('ia_building_owner_email_address', p.property_hud_owner_email)
              fill('ia_building_owner_office_phone',  p.property_hud_owner_phone)
            }
          }
        }

        // Energy Efficiency Services is the primary contractor on every
        // application. Pull business name / phone / email / address from the EES
        // account licensed in the program's state — WI programs draw "Energy
        // Efficiency Services of Wisconsin", NC "…of North Carolina" — matched
        // server-side by contractor record type + license state (no id/name
        // hardcoded). State comes from the opportunity, else the building/
        // property we just read.
        const programState = opp?.opportunity_state || b?.building_state
          || p?.property_state || prefillObj.ia_installation_address_state
        if (programState) {
          const { data: contractorRows } = await supabase
            .rpc('get_primary_contractor_account_for_state', { p_state: programState })
          const c = Array.isArray(contractorRows) ? contractorRows[0] : contractorRows
          if (c) {
            fill('ia_primary_contractor_business_name', c.account_name)
            fill('ia_primary_contractor_email',         c.account_email)
            fill('ia_primary_contractor_phone_number',  c.account_phone)
            fill('ia_primary_contractor_address_street', c.contractor_street)
            fill('ia_primary_contractor_address_city',   c.contractor_city)
            fill('ia_primary_contractor_address_state',  c.contractor_state)
            fill('ia_primary_contractor_address_zip',    c.contractor_zip)
          }
        }

        // Application name composes "<base> - <record type label>" once the user
        // picks a record type (same derived-name mechanism projects use). Base is
        // the opportunity name, else the property name.
        const nameBase = opp?.opportunity_name || p?.property_name
        if (nameBase) prefillObj.__derivedNameBase = nameBase
      } catch (err) {
        console.warn('incentive application prefill: related-record fetch failed', err)
      }
    }

    // An assessment documents ONE building's existing conditions for a program.
    // However it's created — from the Opportunity's related list, from the
    // building or property, or elsewhere — it should open with everything the
    // system already knows so the assessor only records what they measure on
    // site (Nicholas: inherit "from the opportunity, from the building, from the
    // property"). The generic chain seeder above already resolved property_id and
    // building_id from an opportunity parent (assessments' TABLE_META parents);
    // here we resolve the opportunity/building/property, then copy the building's
    // physical attributes (square footage, unit count, attic sizing + existing
    // insulation, utility provider) and the property's owner-level occupancy.
    // Only fill blanks; never clobber a chain-seeded value; all stay editable.
    if (childTable === 'assessments') {
      const fill = (dst, v) => {
        if (v != null && v !== '' && (prefillObj[dst] == null || prefillObj[dst] === '')) prefillObj[dst] = v
      }
      try {
        let oppId  = prefillObj.opportunity_id
          || (parentTable === 'opportunities' ? parentRecordId : null)
        let bldId  = prefillObj.building_id
          || (parentTable === 'buildings' ? parentRecordId : null)
        let propId = prefillObj.property_id || (parentTable === 'properties' ? parentRecordId : null)

        // No opportunity carried (created from a building/property): the
        // opportunity's record type governs which assessment record types are
        // offered, so it is derived only when the ancestry gives ONE answer and
        // asked for in the record-type picker when it gives several — the same
        // rule incentive applications follow, and for the same reason.
        if (!oppId && (bldId || propId)) {
          oppId = await seedConstrainingParent('assessments', prefillObj,
            { buildingId: bldId, propertyId: propId })
          if (oppId) {
            const { data: oppRow } = await supabase.from('opportunities')
              .select('property_id, building_id').eq('id', oppId).maybeSingle()
            if (!bldId && oppRow?.building_id) bldId = oppRow.building_id
            if (!propId && oppRow?.property_id) propId = oppRow.property_id
          }
        }

        // Read the parent rows we now have ids for (any failure leaves those
        // fields blank for manual entry).
        const fetchRow = (table, id, cols, delCol) => id
          ? supabase.from(table).select(cols).eq('id', id).eq(delCol, false).maybeSingle()
          : Promise.resolve({ data: null })
        const [oppRes, buildingRes, propertyRes] = await Promise.all([
          fetchRow('opportunities', oppId,
            'building_id, property_id, opportunity_name, opportunity_gas_account_number, ' +
            'opportunity_record_type', 'opportunity_is_deleted'),
          fetchRow('buildings', bldId,
            'building_sq_ft, building_square_footage, building_total_units, building_number_of_units, ' +
            'building_units_at_attic_plane, building_attic_square_footage, building_sq_ft_attic_plane, ' +
            'building_number_of_bedrooms, building_year_built, ' +
            'building_existing_attic_insulation_type, building_existing_attic_insulation_depth, ' +
            'building_existing_attic_insulation_r_value, building_gas_fuel_provider, building_gas_utility, ' +
            'building_primary_contact_id', 'building_is_deleted'),
          fetchRow('properties', propId,
            'property_total_units, property_gas_utility, property_year_built, ' +
            'property_mf_raw_pct_occupied, property_ph_pct_occupied, property_primary_contact_id', 'property_is_deleted'),
        ])
        const opp = oppRes?.data
        const b   = buildingRes?.data
        const p   = propertyRes?.data

        // An opportunity can supply the building/property ids we still lack.
        if (opp) {
          if (!bldId && opp.building_id) bldId = opp.building_id
          if (!propId && opp.property_id) propId = opp.property_id
        }

        // Seed the relationship columns. Only the real FKs: migration
        // 20260816174500 repointed every assessment layout off the legacy uuid
        // columns (assessment_opportunity / assessment_building_del) and onto
        // opportunity_id / building_id, so there is no second copy to keep in
        // sync any more.
        if (oppId)  fill('opportunity_id', oppId)
        if (bldId)  fill('building_id', bldId)
        if (propId) fill('property_id', propId)

        // Building physical attributes — the assessment's primary source.
        if (b) {
          fill('assessment_building_sq_ft',   b.building_sq_ft ?? b.building_square_footage)
          fill('assessment_number_of_units',  b.building_total_units ?? b.building_number_of_units)
          fill('assessment_units_at_attic_plane', b.building_units_at_attic_plane)
          fill('assessment_attic_sq_ft',      b.building_attic_square_footage ?? b.building_sq_ft_attic_plane)
          fill('assessment_number_of_bedrooms', b.building_number_of_bedrooms)
          fill('assessment_existing_attic_insulation_type',    b.building_existing_attic_insulation_type)
          fill('assessment_existing_attic_insulation_depth',   b.building_existing_attic_insulation_depth)
          fill('assessment_existing_attic_insulation_r_value', b.building_existing_attic_insulation_r_value)
          // Gas Utility is a picklist on the building, plain text here — copy the
          // label, never the stored uuid.
          const gasUtilityLabels = await fetchPicklistLabelsByIds([b.building_gas_utility])
          fill('assessment_gas_fuel_provider',
            b.building_gas_fuel_provider ?? gasUtilityLabels.get(b.building_gas_utility) ?? null)
          if (b.building_year_built != null && b.building_year_built !== '') {
            fill('assessment_year_built', b.building_year_built)
          }
          fill('assessment_property_contact_for_iq_assessment', b.building_primary_contact_id)
        }

        // Property fallbacks — owner-level utility + occupancy the building row
        // may not carry (occupancy % is a whole-property figure used as a proxy).
        if (p) {
          fill('assessment_gas_fuel_provider', p.property_gas_utility)
          fill('assessment_building_occupancy_rate', p.property_mf_raw_pct_occupied ?? p.property_ph_pct_occupied)
          if (p.property_year_built != null && p.property_year_built !== '') {
            fill('assessment_year_built', p.property_year_built)
          }
          fill('assessment_property_contact_for_iq_assessment', p.property_primary_contact_id)
        }

        // Assessment name composes "<base> - <record type label>" once the user
        // picks a record type (same derived-name mechanism projects/enrollments
        // use — assessments has a nameColumn in TABLE_META). Base is the
        // opportunity name, else the property name.
        let nameBase = opp?.opportunity_name
        if (!nameBase && propId) {
          try {
            const { data: pn } = await supabase.from('properties')
              .select('property_name').eq('id', propId).maybeSingle()
            nameBase = pn?.property_name
          } catch { /* leave name blank */ }
        }
        if (nameBase) prefillObj.__derivedNameBase = nameBase
      } catch (err) {
        console.warn('assessment prefill: related-record fetch failed', err)
      }
    }

    // An opportunity documents a program pursuit on a property, so a new one
    // created from a property (or building) inherits everything the system
    // already knows — the same rich carry-over the "Advance to Opportunity"
    // action performs, so both create paths behave identically. This includes
    // opportunity_state, which is state-scoped: every opportunity record type
    // belongs to one program state (its picklist_state), so RecordDetail's
    // prefillState reads it and filters the record-type picker to that state (a
    // Wisconsin property can never carry an NC or MI opportunity). All values
    // remain user-editable on the form; only fill blanks, never clobber a
    // chain-seeded value.
    if (childTable === 'opportunities' && parentTable === 'properties' && parentRecord) {
      const copyFromProperty = (src, dst) => {
        const v = parentRecord[src]
        if (v != null && v !== '' && (prefillObj[dst] == null || prefillObj[dst] === '')) prefillObj[dst] = v
      }
      // Account / management company / site contact — the "who" of the property.
      // (opportunity_account_id is force-synced to the property's account by a DB
      // trigger, but seed it so the form shows it the moment it opens.)
      copyFromProperty('property_account_id',            'opportunity_account_id')
      copyFromProperty('property_management_company_id', 'opportunity_managing_account_id')
      copyFromProperty('property_management_company_id', 'opportunity_property_management_company')
      copyFromProperty('property_primary_contact_id',    'opportunity_property_site_contact')
      // Names / identifiers / location
      copyFromProperty('property_aka_name',              'opportunity_property_aka')
      copyFromProperty('property_subdivision_name',      'opportunity_subdivision_name')
      copyFromProperty('property_state',                 'opportunity_state')
      // Building & unit characteristics
      copyFromProperty('property_total_buildings',       'opportunity_number_of_buildings')
      copyFromProperty('property_number_of_buildings',   'opportunity_number_of_buildings')
      copyFromProperty('property_total_units',           'opportunity_total_units')
      copyFromProperty('property_total_number_of_units', 'opportunity_total_number_of_units')
      copyFromProperty('property_year_built',            'opportunity_year_built')
      copyFromProperty('property_total_attic_sq_ft',     'opportunity_total_attic_sq_ft')
      copyFromProperty('property_total_building_sq_ft',  'opportunity_total_building_sq_ft')
      // Name composes "<property name> — Opportunity" (opportunities have no
      // derived-name trigger); only if the user hasn't set one.
      if ((prefillObj.opportunity_name == null || prefillObj.opportunity_name === '') && parentRecord.property_name) {
        prefillObj.opportunity_name = `${parentRecord.property_name} — Opportunity`
      }
      // Which BUILDING decides which programs this opportunity may run: a
      // multifamily building offers the multifamily programs and nothing else
      // (record_type_eligibility, enforced by
      // enforce_opportunity_record_type_building_eligibility). Started from the
      // property the building is unknown, so the picker had nothing to narrow
      // by and offered every program in the state — single-family programs on a
      // multifamily building (Nicholas, 2026-08-29). Same rule as everywhere
      // else: derive when the property holds one building, ASK when it holds
      // several, never guess.
      await seedConstrainingParent('opportunities', prefillObj,
        { propertyId: parentRecord.id })
    } else if (childTable === 'opportunities' && parentTable === 'buildings' && parentRecord
        && (prefillObj.opportunity_state == null || prefillObj.opportunity_state === '')) {
      // From a building, at least carry the state so the record-type picker is
      // state-scoped (the building's other fields don't map 1:1 to opportunity
      // columns the way a property's do).
      if (parentRecord.building_state) prefillObj.opportunity_state = parentRecord.building_state
    }

    // A building sits at its property's address, so seed the new building's
    // address/location and year-built from the parent property — the user can
    // still edit (e.g. a multi-building property where buildings have distinct
    // addresses). Only fill blanks; never clobber a chain-seeded value.
    if (childTable === 'buildings' && parentTable === 'properties' && parentRecord) {
      const copyFromParent = (src, dst) => {
        const v = parentRecord[src]
        if (v != null && v !== '' && (prefillObj[dst] == null || prefillObj[dst] === '')) prefillObj[dst] = v
      }
      copyFromParent('property_street', 'building_address')
      copyFromParent('property_city', 'building_city')
      copyFromParent('property_state', 'building_state')
      copyFromParent('property_zip', 'building_zip')
      copyFromParent('property_year_built', 'building_year_built')
    }

    // Last pass over the parent chain: anything the child still needs that the
    // platform can work out from what we already hold — the account from the
    // property, the property from the building — is filled in here rather than
    // asked for. Same resolver the inline quick-create uses.
    {
      const inherited = await resolveInheritedParents(childTable, prefillObj)
      for (const [col, val] of Object.entries(inherited)) {
        if (prefillObj[col] == null || prefillObj[col] === '') prefillObj[col] = val
      }
    }

    // Which state's programs this record may carry is decided by the PROPERTY,
    // resolved here rather than read off whatever record the create was
    // launched from — a building's own state column is blank on a third of live
    // buildings, and a blank one silently widened the record-type picker to
    // every program in the platform (Nicholas, 2026-08-23: "North Carolina
    // properties only get North Carolina opportunities"). Resolved last, once
    // the chain above has filled in the property. Transient __ key, stripped
    // before the insert like every other; opportunity_state is also written
    // through so the form shows what the database will derive anyway.
    {
      const programState = await fetchProgramStateForCreate(prefillObj)
      if (programState) {
        prefillObj.__programState = programState
        if (childTable === 'opportunities') prefillObj.opportunity_state = programState
      }
    }

    // And which of that state's record types this record may carry can be
    // narrowed further by its PARENT's record type. An opportunity record type
    // IS the program, so it decides which assessment record types and which
    // incentive application forms belong to it — a WI-IRA-SF-HEAR application
    // has no business on a WI-IRA-MF-HOMES opportunity (Nicholas, 2026-08-23:
    // "not any incentive record type should be able to be created for any
    // opportunity record type"). Which pairs are governed is read from
    // record_type_eligibility, so configuring a new one in Setup needs no code.
    // Transient __ keys, stripped before the insert; the database enforces the
    // same rule independently.
    {
      const constrainingParent = await fetchConstrainingParentForCreate(childTable, prefillObj)
      if (constrainingParent) {
        prefillObj.__parentObject       = constrainingParent.parentObject
        prefillObj.__parentRecordTypeId = constrainingParent.parentRecordTypeId
      }
    }

    // A work order always lives on a project, but the record it was created from
    // often doesn't have one — an assessment, for instance, links the property,
    // building, and opportunity but no project. Resolve the opportunity's most
    // recent live project so the field lands filled instead of blank (Nicholas,
    // 2026-08-16). Mirrors what create_mf_building_assessment_work_order does
    // server-side, and it's only a default — the picker stays editable.
    if ((childMeta?.parents || []).includes('project_id')
        && !prefillObj.project_id && prefillObj.opportunity_id) {
      try {
        const { data: projRows } = await supabase
          .from('projects')
          .select('id')
          .eq('opportunity_id', prefillObj.opportunity_id)
          .eq('project_is_deleted', false)
          .order('project_created_at', { ascending: false })
          .limit(1)
        const proj = Array.isArray(projRows) ? projRows[0] : projRows
        if (proj?.id) prefillObj.project_id = proj.id
      } catch (err) {
        console.warn('create prefill: project resolve failed', err)
      }
    }

    // The record you created FROM is not a choice (Nicholas, 2026-08-16: "I
    // created this from an opportunity record, so there shouldn't be an option
    // to change it"). Every prefilled column pointing at this parent — the
    // related list's own FK plus any legacy display column seeded with the same
    // id — is locked: shown on the create pop-up, read-only. Ancestors resolved
    // further up the chain (the property, the building) stay editable.
    if (parentRecordId) {
      const locked = Object.keys(prefillObj).filter(k => prefillObj[k] === parentRecordId)
      if (locked.length) prefillObj.__lockedFields = locked
    }

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
            {totalCount > 0 && (
              <span
                title={`${totalCount.toLocaleString()} total`}
                style={{
                  fontSize: 11, fontWeight: 600, color: C.textMuted,
                  background: '#eef2f7', borderRadius: 10,
                  padding: '1px 8px', flexShrink: 0,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {totalCount.toLocaleString()}
              </span>
            )}
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
            ) : canCreate ? (
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
                {!editable && canCreate && (
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
              <div style={editable ? undefined : { maxHeight: RELATED_LIST_MAX_HEIGHT, overflowY: 'auto' }}>
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
                              color: removingId === row.id ? C.textMuted : '#1a5a8a',
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
              /* ── Desktop table layout ─────────────────────────────────────
                 Read-only lists scroll vertically within a fixed-height
                 window (scrollbar appears only when rows overflow); the header
                 stays pinned so column labels remain visible while scrolling.
                 Editable lists keep full height so drag-reorder targets are all
                 on screen. */
              <div style={editable
                ? { overflowX: 'auto' }
                : { overflowX: 'auto', overflowY: 'auto', maxHeight: RELATED_LIST_MAX_HEIGHT }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {editableReorder && <th style={{ width: 28, padding: '8px 0 8px 14px', position: 'sticky', top: 0, background: C.card, zIndex: 1, boxShadow: `inset 0 -1px 0 ${C.border}` }} />}
                      {columns.map((col) => {
                        const activeSort = sortCol === col.name
                        return (
                          <th key={col.name}
                            onClick={sortable ? () => toggleRelatedSort(col) : undefined}
                            title={sortable ? `Sort by ${col.label}` : undefined}
                            style={{
                              textAlign: 'left', padding: '8px 14px',
                              fontSize: 10, fontWeight: 600,
                              color: activeSort ? C.textSecondary : C.textMuted,
                              textTransform: 'uppercase', letterSpacing: '0.05em',
                              whiteSpace: 'nowrap',
                              position: 'sticky', top: 0, background: C.card, zIndex: 1,
                              boxShadow: `inset 0 -1px 0 ${C.border}`,
                              cursor: sortable ? 'pointer' : 'default',
                              userSelect: 'none',
                            }}>
                            {col.label}
                            {sortable && <RelatedSortArrow active={activeSort} dir={sortDir} />}
                          </th>
                        )
                      })}
                      {editable && <th style={{ width: 32, padding: '8px 14px 8px 0', position: 'sticky', top: 0, background: C.card, zIndex: 1, boxShadow: `inset 0 -1px 0 ${C.border}` }} />}
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
                              // row_href_field rows open a file, not a record page,
                              // so don't render the name as a record-link anchor.
                              canNavigate: canNavigate && !editableReorder && !rowHrefField,
                              childTable,
                              rowId: row.id,
                              onActivate: () => handleRowClick(row),
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
                                  color: removingId === row.id ? C.textMuted : '#1a5a8a',
                                  cursor: removingId === row.id ? 'wait' : 'pointer',
                                  padding: '2px 4px', borderRadius: 4, display: 'inline-flex',
                                  alignItems: 'center', justifyContent: 'center',
                                }}
                                onMouseEnter={(e) => { if (removingId !== row.id) e.currentTarget.style.background = '#e8f1fb' }}
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

            {!editable && shownRows.length > 0 && (() => {
              // "View All →" is ALWAYS offered on a populated read-only list —
              // not just when rows overflow the in-widget scroll window. The
              // full list view exposes columns this compact widget doesn't, so
              // the user needs a way into it for every related section, however
              // few rows there are.
              // Wire View All to the table's list view, SCOPED to this parent
              // record (Salesforce related-list page parity) so the user lands
              // on only these related records — not the whole object. Works for
              // both direct-FK lists (fk = parentRecordId) and via-path lists
              // (Units on a Property via Buildings), which carry config.via.
              // Falls back to the unscoped list URL if the scope can't be built.
              const scopedUrl = buildScopedListUrl({
                table: childTable,
                fk: config.fk,
                via: config.via,
                parentId: parentRecordId,
                label: parentRecordName || null,
              })
              const listUrl = scopedUrl || getTableListUrl(childTable)
              return (
                <div style={{
                  padding: '8px 14px',
                  borderTop: `1px solid ${C.border}`,
                  background: '#fafbfd',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                  fontSize: 11.5,
                }}>
                  {listUrl ? (
                    <a
                      href={listUrl}
                      style={{
                        color: '#1a5a8a', fontWeight: 500,
                        textDecoration: 'none', cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
                    >
                      {hasMoreThanLoaded ? `View All (${totalCount.toLocaleString()}) →` : 'View All →'}
                    </a>
                  ) : (
                    <span
                      title="List view not available for this related table"
                      style={{
                        color: C.textMuted, fontStyle: 'italic',
                        cursor: 'not-allowed',
                      }}
                    >
                      View All →
                    </span>
                  )}
                </div>
              )
            })()}
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
      toast.error(`Create failed — ${describeWriteError(err)}`)
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
                <div style={{ padding: 20, textAlign: 'center', color: '#1a5a8a', fontSize: 12.5 }}>
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
                    {f.required && <span style={{ color: '#2c5f8a', marginLeft: 3 }}>*</span>}
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

function Section({ section, record, picklists, lookups, editing, draft, onChange, allPicklistOpts, allLookupOpts, tableName, onRefreshRecord, recordId, fieldDisabledReasons, hiddenWidgetTypes, onNavigateToRecord, requiredFields, activeTab, createRelatedValues }) {
  const isMobile = useIsMobile()
  // Standing rule: every record-detail section opens EXPANDED. We intentionally
  // ignore section_is_collapsed_by_default for the initial state (the user can
  // still collapse any section via its header), so the rule holds globally and
  // survives layouts/sections that were configured collapsed.
  const [collapsed, setCollapsed] = useState(false)
  // Render any widgets that live inside a section card. Today: field_group,
  // section_config_editor, filter_config_editor, and merge_field_reference.
  // Related lists, file galleries, prtsn history, and the activity timeline
  // render as their own standalone cards outside sections.
  const inSectionTypes = new Set(['field_group', 'section_config_editor', 'filter_config_editor', 'merge_field_reference', 'map'])
  // hiddenWidgetTypes is a Set of widget_type values to suppress at render
  // time — used by the parent to hide context-dependent widgets (e.g.
  // merge_field_reference is only relevant when document_templates is in
  // docx authoring mode, so the parent passes {'merge_field_reference'}
  // to hide it in html mode).
  // Conditional widgets: a widget_config.visible_when { field, equals } shows
  // the widget only when the record/draft's `field` matches (e.g. the Support
  // Contractor group appears only when "Will a support contractor…" is Yes).
  const condValues = editing ? { ...(record || {}), ...(draft || {}) } : (record || {})
  const isWidgetVisible = (w) => {
    const vw = w.widget_config?.visible_when
    if (!vw || !vw.field) return true
    const actual = condValues?.[vw.field]
    if (Object.prototype.hasOwnProperty.call(vw, 'equals')) return actual === vw.equals
    if (Array.isArray(vw.in)) return vw.in.includes(actual)
    return true
  }
  const preVisibilityWidgets = (section.widgets || []).filter(w => {
    if (!inSectionTypes.has(w.widget_type)) return false
    if (hiddenWidgetTypes && hiddenWidgetTypes.has(w.widget_type)) return false
    return true
  })
  const sectionWidgets = preVisibilityWidgets.filter(isWidgetVisible)
  // A section whose content is entirely hidden by visible_when disappears
  // completely (header included) — not an empty "No fields" shell.
  if (preVisibilityWidgets.length > 0 && sectionWidgets.length === 0) return null
  // Blank sections still render — the record page stays consistent with the
  // page layout editor: every section in the layout shows its header, with a
  // muted empty state in place of content. Two exceptions return null:
  // (1) a section whose widgets were ALL deliberately suppressed via
  // hiddenWidgetTypes (context-dependent hides like docx-only widgets) —
  // rendering an empty shell there would defeat the suppression; and
  // (2) a section whose only content is card widgets (related lists,
  // galleries, conversations, reports, publish history) — those cards render
  // as their own standalone cards immediately after this shell's slot
  // (sections behave identically on every tab; cards follow their section),
  // so an empty shell would just duplicate their headings.
  const allSectionWidgets = section.widgets || []
  const allSuppressed = allSectionWidgets.length > 0 && hiddenWidgetTypes &&
    allSectionWidgets.every(w => hiddenWidgetTypes.has(w.widget_type))
  if (sectionWidgets.length === 0 && allSuppressed) return null
  const cardCount = allSectionWidgets.filter(w => CARD_WIDGET_TYPES.has(w.widget_type)).length
  // An empty field group (zero fields) renders nothing — FieldGroupWidget
  // returns null for it — yet the canvas editor auto-adds a "Fields" group to
  // every section. On a card-only section (e.g. the Buildings / Units related
  // lists) that invisible empty group would otherwise keep the section shell,
  // stacking a duplicate header right above the identically-named card. Treat
  // empty field groups as no content so such sections stay card-only, matching
  // sections authored without any field group (e.g. Assessments).
  const meaningfulSectionWidgets = sectionWidgets.filter(w =>
    w.widget_type === 'field_group' ? ((w.widget_config?.fields || []).length > 0) : true)
  if (meaningfulSectionWidgets.length === 0 && cardCount > 0) return null
  // A section with no title typed in — blank, or the "Untitled Section"
  // placeholder the save path stores for an unnamed section — must not render
  // an empty titled box on the record page (Nicholas, 2026-07-29: "if I don't
  // have anything typed in the section name, it just needs to disappear").
  // If such an untitled section also has no content to show, it disappears
  // entirely — no header, no wasted vertical space. If it DOES carry fields,
  // the fields still render, just with no header bar above them. Named empty
  // sections keep their header + muted empty state (they still match the
  // layout editor 1:1); this carve-out is only for the untitled case.
  const rawLabel = (section.section_label || '').trim()
  const hasTitle = !!rawLabel && rawLabel.toLowerCase() !== 'untitled section'
  const hasContent = meaningfulSectionWidgets.length > 0
  if (!hasTitle && !hasContent) return null
  const showHeader = hasTitle
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: isMobile ? 10 : 12, overflow: 'hidden' }}>
      {showHeader && (
        <div onClick={() => section.section_is_collapsible && setCollapsed(c => !c)}
          style={{ padding: isMobile ? '12px 14px' : '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: section.section_is_collapsible ? 'pointer' : 'default', borderBottom: collapsed ? 'none' : `1px solid ${C.border}`, background: '#fafbfd' }}>
          <span style={{ fontSize: isMobile ? 14 : 13, fontWeight: 600, color: C.textPrimary }}>{section.section_label}</span>
          {section.section_is_collapsible && <Icon path={collapsed ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'} size={14} color={C.textMuted} />}
        </div>
      )}
      {showHeader && !collapsed && sectionWidgets.length === 0 && (
        <div style={{ padding: isMobile ? '14px 14px' : '16px 18px', fontSize: 12.5, color: C.textMuted, fontStyle: 'italic' }}>
          No fields in this section yet — add some in the page layout editor.
        </div>
      )}
      {!collapsed && sectionWidgets.map(w => {
        if (w.widget_type === 'field_group') {
          return <FieldGroupWidget key={w.id} widget={w} record={record} picklists={picklists} lookups={lookups}
            editing={editing} draft={draft} onChange={onChange} allPicklistOpts={allPicklistOpts} allLookupOpts={allLookupOpts}
            onRefreshRecord={onRefreshRecord} recordId={recordId} fieldDisabledReasons={fieldDisabledReasons}
            onNavigateToRecord={onNavigateToRecord} requiredFields={requiredFields} tableName={tableName}
            createRelatedValues={createRelatedValues} />
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
        if (w.widget_type === 'map') {
          return <PropertyMapWidget key={w.id} widget={w} record={record} tableName={tableName} embedded />
        }
        return null
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MergedAccountNotice — rendered in place of the record when you open an
// account that was merged away by the Merge Accounts tool (a soft-deleted
// loser). The account no longer exists as a live record, so instead of showing
// it as an editable page we tell the user it was merged and point them at the
// surviving master (Salesforce parity: a merged account resolves to the
// winner). `info` is null while the survivor resolves, then
// { status:'merged', master, mergedAt } or { status:'deleted' } when the loser
// was deleted without a recoverable master in the log.
// ---------------------------------------------------------------------------
function MergedAccountNotice({ loserName, loserNumber, info, onNavigateToRecord, onBack }) {
  const master = info?.status === 'merged' ? info.master : null
  const resolving = info == null
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 520, width: '100%', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: '28px 28px 22px', textAlign: 'center', boxShadow: '0 2px 12px rgba(13,26,46,.07)' }}>
        <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#e8f1fb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#1a5a8a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 8l-4 4 4 4M3 12h12a4 4 0 004-4V4M17 16l4-4-4-4" />
          </svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>
          This account was merged and removed
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.55, marginBottom: 18 }}>
          <strong style={{ color: C.textPrimary }}>{loserName}</strong>{loserNumber ? ` (${loserNumber})` : ''} was merged into another account.
          {resolving
            ? ' Finding the surviving account…'
            : master
              ? ' All of its records now live on the surviving account below.'
              : ' It is no longer an active account.'}
        </div>
        {master && (
          <RecordLink
            table="accounts"
            id={master.id}
            onActivate={() => onNavigateToRecord?.({ table: 'accounts', id: master.id, mode: 'view' })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.emerald, color: '#fff', borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600 }}
          >
            Go to {master.account_name}{master.account_record_number ? ` (${master.account_record_number})` : ''} →
          </RecordLink>
        )}
        <div style={{ marginTop: master ? 14 : 4 }}>
          <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: C.textMuted, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            Back to Accounts
          </button>
        </div>
      </div>
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
  // isNarrow controls right-rail layout. The right rail renders alongside the
  // main content on wide screens (>1024px). Below that, it stacks underneath
  // — keeps the main field groups readable when there's not enough width for
  // two columns. Salesforce's Lightning utility rail collapses at a similar
  // breakpoint. 1280 (not 1024) since the rail widened to 480px (Nicholas,
  // 2026-07-26: related-list cards in a 320px rail truncated unreadably).
  const isNarrow = useMediaQuery('(max-width: 1280px)')

  // ── Pinned record header ───────────────────────────────────────────────────
  // The record's identity and its action buttons stay put while the record
  // scrolls (Nicholas, 2026-08-29: "when we scroll down on a page, we kind of
  // lose everything… I need this section here to remain locked so the Save
  // button and edit buttons are still available, but the user also knows where
  // they're at"). The rules live in src/lib/stickyRecordHeader.js.
  //
  // `headerCondensed` is decided from the scroll region's own scrollTop with
  // hysteresis, so the band cannot flip between its two heights mid-gesture.
  // `headerBandEl` is measured rather than assumed: the band's height changes
  // when it condenses and when a long breadcrumb trail wraps to a second line,
  // and the tab bar pins itself at exactly that offset.
  const [headerCondensed, setHeaderCondensed] = useState(false)
  const [headerBandEl, setHeaderBandEl] = useState(null)
  const [headerBandHeight, setHeaderBandHeight] = useState(0)

  useLayoutEffect(() => {
    if (!headerBandEl) { setHeaderBandHeight(0); return }
    const measure = () => setHeaderBandHeight(headerBandEl.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(headerBandEl)
    return () => ro.disconnect()
  }, [headerBandEl])

  const handleContentScroll = useCallback((e) => {
    const top = e.currentTarget.scrollTop
    setHeaderCondensed(prev => shouldCondenseHeader(top, prev))
  }, [])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(isCreate)
  const [draft, setDraft] = useState({})

  // Typing in a record is unsaved work — hold off the auto-update reload until
  // the user saves or cancels. The app updating itself must never cost anyone
  // a half-filled form.
  useEffect(() => {
    if (!editing) return
    return holdAppReload()
  }, [editing])
  const [saving, setSaving] = useState(false)
  const [allPicklistOpts, setAllPicklistOpts] = useState({})
  const [allLookupOpts, setAllLookupOpts] = useState({})
  // Dependent lookup fields registered for this layout's edit session. Each
  // entry is { name, field }; the effect below re-fetches its options
  // whenever any of field.lookup_dependency.depends_on values change in
  // the draft, so the dropdown stays in sync with parent-field edits.
  const [dependentLookupFields, setDependentLookupFields] = useState([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Which tab is active on the record detail page. Null until data loads,
  // then initialized to the first tab (Details) by the useEffect below.
  const [activeTab, setActiveTab] = useState(null)
  // "Open Pre-Approval Application" action state. MUST live here with the other
  // top-level hooks (before any early return below, e.g. loading/error/!data/
  // !layout) so the hook call order is identical on every render — otherwise
  // React throws #310 ("rendered fewer hooks than expected"). Opens the Focus On
  // Energy pre-approval form pre-filled from this enrollment: the blank tab is
  // opened synchronously (within the click gesture) so popup blockers don't
  // fire, then the async prefill build redirects it.
  const [openingPreapproval, setOpeningPreapproval] = useState(false)
  // Required fields still blank when the user tried to open the pre-approval
  // form. Non-empty → the completion modal is shown and the form is NOT opened.
  const [preapprovalMissing, setPreapprovalMissing] = useState(null)
  // Open the Project Payment Request Jotform, pre-filled from this record —
  // the sibling of the two openers above, on the third form.
  const [openingPaymentRequest, setOpeningPaymentRequest] = useState(false)
  const handleOpenPaymentRequestForm = useCallback(async () => {
    if (openingPaymentRequest) return
    const win = window.open('', '_blank')
    setOpeningPaymentRequest(true)
    try {
      const { url, error, missing } = await openPaymentRequestForm(recordId, win)
      if (missing && missing.length) {
        if (win) win.close()
        setPreapprovalMissing(missing)
        return
      }
      if (error || !url) {
        if (win) win.close()
        window.alert(error || 'Could not open the payment request application.')
      }
    } finally {
      setOpeningPaymentRequest(false)
    }
  }, [recordId, openingPaymentRequest])

  const handleOpenPreapprovalForm = useCallback(async () => {
    if (openingPreapproval) return
    const win = window.open('', '_blank')
    setOpeningPreapproval(true)
    try {
      const { url, error, missing } = await openAssessmentPreapprovalForm(recordId, win)
      if (missing && missing.length) {
        // Data is incomplete — don't submit a half-filled form. Close the blank
        // tab and tell the user exactly which fields to complete first.
        if (win) win.close()
        setPreapprovalMissing(missing)
        return
      }
      if (error || !url) {
        if (win) win.close()
        window.alert(error || 'Could not open the pre-approval application.')
      }
    } finally {
      setOpeningPreapproval(false)
    }
  }, [recordId, openingPreapproval])

  // The assessment rebate claim, from the WI-IRA-MF-HOMES-AUDIT incentive
  // application. Same shape as the pre-approval handler above and it shares the
  // same missing-fields modal — the gate is the form's own required set either
  // way, so there is one place that explains an incomplete record.
  const [openingApplication, setOpeningApplication] = useState(false)
  const handleOpenAssessmentApplication = useCallback(async () => {
    if (openingApplication) return
    const win = window.open('', '_blank')
    setOpeningApplication(true)
    try {
      const { url, error, missing } = await openAssessmentApplicationForm(recordId, win)
      if (missing && missing.length) {
        if (win) win.close()
        setPreapprovalMissing(missing)
        return
      }
      if (error || !url) {
        if (win) win.close()
        window.alert(error || 'Could not open the assessment application.')
      }
    } finally {
      setOpeningApplication(false)
    }
  }, [recordId, openingApplication])

  // ── Record locking ─────────────────────────────────────────────────────
  // A record is locked once its status reaches a value flagged
  // picklist_locks_record (e.g. an enrollment that's been Submitted). Locked
  // records are read-only for everyone EXCEPT System Administrators, who can
  // still edit to unlock/correct. Both signals load before any early return so
  // the hook order is stable on every render (avoids React #310).
  const [isSystemAdmin, setIsSystemAdmin] = useState(false)
  useEffect(() => {
    let alive = true
    getCurrentUserProfile()
      .then(p => { if (alive) setIsSystemAdmin(p?.roleName === 'Admin') })
      .catch(() => { if (alive) setIsSystemAdmin(false) })
    return () => { alive = false }
  }, [])

  const [statusLocksRecord, setStatusLocksRecord] = useState(false)
  useEffect(() => {
    const statusCol = TABLE_META[tableName]?.statusColumn
    const statusId = statusCol ? data?.record?.[statusCol] : null
    if (!statusId) { setStatusLocksRecord(false); return }
    let alive = true
    supabase
      .from('picklist_values')
      .select('picklist_locks_record')
      .eq('id', statusId)
      .maybeSingle()
      .then(({ data: row }) => { if (alive) setStatusLocksRecord(row?.picklist_locks_record === true) })
      .catch(() => { if (alive) setStatusLocksRecord(false) })
    return () => { alive = false }
  }, [tableName, data?.record])

  // Locked *for this user* — admins are never locked out.
  const recordLockedForUser = statusLocksRecord && !isSystemAdmin
  // Parent-name lookups for the breadcrumb in CREATE mode. The loaded record is
  // empty while creating, so prefilled parent FKs (e.g. property_id on a new
  // Building, or opportunity_id on a new Contact Role) can't resolve to names —
  // leaving the breadcrumb flat ("Module / Object") instead of hierarchical.
  // The effect below resolves them from the prefill.
  const [createCrumbLookups, setCreateCrumbLookups] = useState(() => new Map())
  // Cross-object (related) field display values for CREATE mode. On saved
  // records loadRecordDetailData resolves these, but on the create form the
  // record doesn't exist yet — so we resolve them here from the FK the user
  // has already picked (e.g. a new Unit's Building lookup lets us show its
  // Property). Map<dottedFieldName, displayString>; recomputed whenever the
  // relevant FK draft value changes. Display-only; never inserted.
  const [createRelatedValues, setCreateRelatedValues] = useState(() => new Map())
  // When non-null, we are cloning the current record: same table, insert path,
  // draft pre-populated from the source.
  const [cloneSource, setCloneSource] = useState(null)
  const isInsertMode = isCreate || cloneSource !== null
  // Create-time duplicate checking (accounts / properties / buildings).
  // dupMatches holds find_duplicate_candidates results for the current
  // draft; dupAcknowledged flips after the first Save press so the second
  // press creates anyway (soft gate, never a hard block).
  const [dupMatches, setDupMatches] = useState([])
  const [dupAcknowledged, setDupAcknowledged] = useState(false)
  const dupReqRef = useRef(0)
  // Record-type picker state. In create mode, if the user hasn't supplied a
  // prefill record_type and the object has multiple active record types, we
  // show RecordTypePicker before loading the form layout. `pickedRecordType`
  // holds the user's choice once made.
  // null  = still showing picker (or evaluating whether to show it)
  // false = picker has determined no record-type pick is needed (0 or 1 RTs,
  //         or the prefill already supplied one)
  // object{id,value,label} = the user's picked record type
  const [pickedRecordType, setPickedRecordType] = useState(null)
  const [pickerEvaluated,  setPickerEvaluated]  = useState(false)
  // Required-field set for this table — used to render the red asterisk in
  // the field-group renderer. Populated once at mount via fetchTableMetadata
  // (which is cached so subsequent calls in handleSave are free).
  const [requiredFields, setRequiredFields] = useState(new Set())
  // Create modal: "Show all fields" expands the pop-up from the required-only
  // set to every field on the page layout, for the times a user wants to fill
  // an optional field (a building's Type, say) while they're already there.
  // Off by default — required-only is the standard create experience.
  const [showAllCreateFields, setShowAllCreateFields] = useState(false)
  // Required columns the page layout doesn't carry, resolved to real editors
  // from the table's column metadata (see buildUnlaidOutRequiredFieldDefs).
  const [createExtraFields, setCreateExtraFields] = useState([])
  const [createExtraPicklistOpts, setCreateExtraPicklistOpts] = useState({})
  // Columns pointing at the record this one is being created FROM. Shown on the
  // create pop-up read-only — the parent isn't a choice. Resolved display names
  // for those parent ids live in createLockedLabels (lookups-map shape).
  const lockedCreateFields = useMemo(
    () => new Set(isCreate && Array.isArray(prefill?.__lockedFields) ? prefill.__lockedFields : []),
    [isCreate, prefill],
  )
  const [createLockedLabels, setCreateLockedLabels] = useState(() => new Map())
  // Holds the derived-name base (e.g. a project's source opportunity name)
  // captured from the create prefill, so the name can be recomposed when the
  // user changes record type before saving. Stored in a ref so it persists
  // without being inserted into the row.
  const derivedNameBaseRef = useRef(null)
  // Project report generator (only used when tableName === 'projects'). The
  // tick is bumped after a successful generation so the related-records area
  // (Documents widget) re-fetches and the new PDF appears immediately.
  const [showReportModal, setShowReportModal] = useState(false)
  // Program submittal document generator (projects only). Holds WHICH
  // submittal stage was requested — each program stage is its own filing.
  const [submittalStage, setSubmittalStage] = useState(null)
  const [showSubmittalEditor, setShowSubmittalEditor] = useState(false)
  const [showQiToolModal, setShowQiToolModal] = useState(false)
  const [showAssessmentReportModal, setShowAssessmentReportModal] = useState(false)
  const [showSubmittedEnrollmentModal, setShowSubmittedEnrollmentModal] = useState(false)
  const [showHomesProposalModal, setShowHomesProposalModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  // Set when the loaded account was merged away by the Merge Accounts tool
  // (soft-deleted loser). Null = live record, or still resolving the survivor.
  // Shape: { status: 'merged'|'deleted', master?, mergedAt? }
  const [mergedInfo, setMergedInfo] = useState(null)
  const [showSharedRecords, setShowSharedRecords] = useState(false)
  const [showPortalModal, setShowPortalModal] = useState(false)
  const [showLogCall, setShowLogCall] = useState(false)
  // Bumped when a call is logged from the header action so the Activity tab's
  // timeline remounts and shows the new entry.
  const [activityRefreshKey, setActivityRefreshKey] = useState(0)
  // Project Scheduler wizard (only used when tableName === 'projects').
  // Bulk-schedules unscheduled work orders for the project to a Team Lead.
  // After a successful commit, the tick is bumped so the related-records area
  // (Work Orders, Service Appointments widgets) re-fetches.
  const [showSchedulerWizard, setShowSchedulerWizard] = useState(false)
  const [showRescheduleWizard, setShowRescheduleWizard] = useState(false)
  const [showSaReschedule, setShowSaReschedule] = useState(false)
  // Single-WO scheduler — opt-in via toolbar button on a Work Order whose
  // status is 'To Be Scheduled'. Reuses the bulk_schedule_work_orders RPC
  // with a one-element WO array plus a pinned placement at the chosen
  // start time, so the engine path is identical to the bulk wizard.
  const [showWoSchedule, setShowWoSchedule] = useState(false)
  // Issue-to-Provider modal — opt-in via toolbar button on a Work Order.
  // Generates a priced proposal (generate_service_provider_proposal) and
  // issues it to a service provider account.
  const [showIssueProvider, setShowIssueProvider] = useState(false)
  // Send-for-signature modal: shown on any record whose table has at least one
  // Active document template (document_templates.related_object = tableName).
  // The DocuSign / Conga model — gating is data-driven, not hardcoded. The
  // modal builds an envelope, calls send-envelope, and returns the magic-link
  // signing URLs for the user to distribute. Re-checked when tableName changes
  // so navigating between record types updates the icon visibility.
  const [showSendSignatureModal, setShowSendSignatureModal] = useState(false)
  const [hasActiveTemplate, setHasActiveTemplate] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  // Re-fetch the open record when a background action (today: the LEAP
  // Assistant) commits a change, so an edited field or a newly added related
  // record shows without a manual reload. Skipped while the user is creating or
  // editing so an in-progress draft is never clobbered — their own save already
  // refreshes. Refreshes on ANY signal (not filtered by table/id) because a
  // commit can touch the open record directly OR add a child that appears in
  // one of its related lists.
  useDataRefresh(useCallback(() => {
    if (isCreate || editing) return
    setReloadTick(t => t + 1)
  }, [isCreate, editing]))
  // Deep-clone state — only used on project_report_templates. Uses the
  // clone_project_report_template RPC to copy the PRT plus all PRTS rows
  // atomically; lands the user on the new clone via onNavigateToRecord.
  const [cloningTemplate, setCloningTemplate] = useState(false)
  const [runningIncomeQual, setRunningIncomeQual] = useState(false)
  const [previewingPdf, setPreviewingPdf] = useState(false)
  // Document Template Preview modal state. Opens when the author clicks
  // 'Preview' on a document_templates record — they pick a parent record
  // (Project / Property / Opportunity, depending on the template's
  // related_object) and we render the merged PDF in a new tab via
  // render-document-template-pdf. No documents row, no envelopes row,
  // no storage upload — just a quick visual check.
  const [docPreviewOpen, setDocPreviewOpen]                 = useState(false)
  const [docPreviewLoadingOpts, setDocPreviewLoadingOpts]   = useState(false)
  const [docPreviewParentOptions, setDocPreviewParentOptions] = useState([])
  const [docPreviewParentRecord, setDocPreviewParentRecord] = useState('')
  const [docPreviewRendering, setDocPreviewRendering]       = useState(false)
  // When true, the edge function draws translucent labeled rectangles over
  // every signature anchor in the rendered preview PDF. Only used by the
  // preview flow — signed envelopes never carry the overlay.
  const [docPreviewOverlay, setDocPreviewOverlay]           = useState(false)
  // Email Template Preview state — same shape as document template preview
  // but the result is rendered inline in a modal with an iframe (no PDF
  // tab) since email templates are HTML-only.
  const [emailPreviewOpen, setEmailPreviewOpen]                       = useState(false)
  const [emailPreviewLoadingOpts, setEmailPreviewLoadingOpts]         = useState(false)
  const [emailPreviewParentOptions, setEmailPreviewParentOptions]     = useState([])
  const [emailPreviewParentRecord, setEmailPreviewParentRecord]       = useState('')
  const [emailPreviewRendering, setEmailPreviewRendering]             = useState(false)
  const [emailPreviewResult, setEmailPreviewResult]                   = useState(null)
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

  // ── Record-type picker evaluation ───────────────────────────────────────
  // On entering create mode, decide whether the picker needs to show. If
  // the prefill already carries a record_type, skip the picker. Otherwise,
  // fetch the object's active record types; 0 or 1 -> skip picker; 2+ ->
  // show picker (gate the load effect until the user picks).
  // Extract the prefill RT value here so the effect depends on the stable
  // primitive — not on the prefill object identity (which could be a new
  // reference every parent render and cause refetch loops).
  const prefillRecordTypeValue = getRecordTypeValue(prefill)
  // Derive the record's state from the prefill (e.g. opportunity_state seeded
  // from a property's state when advancing to an opportunity). Used to filter
  // the record-type picker to state-appropriate types. Falls back to null,
  // which shows all active types.
  const prefillState = (() => {
    if (!prefill) return null
    // Resolved from the property by the create-prefill — the authority, and the
    // only value that is right when the record was created from a building.
    if (prefill.__programState) return prefill.__programState
    if (prefill.state) return prefill.state
    for (const key of Object.keys(prefill)) {
      if (key.endsWith('_state') && prefill[key]) return prefill[key]
    }
    return null
  })()
  // Which record types this record may carry can also be governed by its
  // PARENT's record type — configuration held in record_type_eligibility. The
  // create-prefill seeds these two transient __ keys when it resolves a parent
  // whose record type constrains the child (an assessment's opportunity, say);
  // they are stripped before the insert like every other __ key. Null means
  // unconstrained, which is the case for most objects.
  const prefillParentObject       = prefill?.__parentObject || null
  const prefillParentRecordTypeId = prefill?.__parentRecordTypeId || null
  // The create came from a building/property running more than one program, so
  // WHICH parent this belongs to is a question the picker asks before offering
  // any record type (see seedConstrainingParent). Answering it also carries the
  // program facts that a create launched from the opportunity would have had.
  const prefillParentChoices      = prefill?.__parentChoices || null
  const [parentPickPrefill, setParentPickPrefill] = useState(null)
  // ...also held in a ref, because the show/skip gate below must NOT re-evaluate
  // when the answer arrives: it resets pickedRecordType on every run, so a
  // re-run after the pick would re-open the picker on top of the answered
  // question, forever.
  const parentPickRef = useRef(null)
  // What the form is actually seeded with: the create prefill, plus whatever
  // the answered parent question added. One object so every consumer of the
  // prefill sees the chosen program, not the pre-choice draft.
  const effectivePrefill = useMemo(
    () => (parentPickPrefill ? { ...(prefill || {}), ...parentPickPrefill } : prefill),
    [prefill, parentPickPrefill],
  )
  // A building runs each program once, so a new opportunity started from a
  // building (or from anything that seeded one) must not be OFFERED a program
  // that building already runs — the database refuses it on save. Only
  // opportunities are keyed this way; every other object ignores it.
  const prefillTakenOnBuildingId =
    tableName === 'opportunities' ? (prefill?.building_id || null) : null
  useEffect(() => {
    if (!isCreate) { setPickerEvaluated(true); return }
    let cancelled = false
    setPickerEvaluated(false)
    setPickedRecordType(null)

    if (prefillRecordTypeValue) {
      setPickedRecordType(false)   // prefill already has it — no picker needed
      setPickerEvaluated(true)
      return
    }

    // The parent that decides which record types exist has not been chosen yet.
    // Deciding show/skip here would mean fetching record types for a program
    // nobody picked — exactly the guess this closes — so hand it straight to
    // the picker, which asks the program question first.
    if (prefillParentChoices && !parentPickRef.current) {
      setPickedRecordType(null)
      setPickerEvaluated(true)
      return
    }

    // Gate on the SAME state-filtered set the rendered picker will show, so
    // the show/skip decision and the picker contents never diverge. (Passing
    // no state here while the picker passed state caused the picker to render
    // then immediately auto-dismiss via onPick(null) whenever a state had no
    // scoped record types — silently skipping the prompt.)
    fetchAvailableRecordTypes(tableName, {
      state: prefillState,
      parentObject: prefillParentObject,
      parentRecordTypeId: prefillParentRecordTypeId,
      takenOnBuildingId: prefillTakenOnBuildingId,
    })
      .then(rts => {
        if (cancelled) return
        // Record types the building already runs cannot be saved, so they are
        // not choices — the show/skip decision counts only the open ones, and
        // must agree with the picker's own (see RecordTypePicker).
        const selectable = rts.filter(rt => !rt.taken)
        if (rts._noneInState) {
          // No record type runs in this record's state. Leave the decision
          // unresolved so the picker renders and says so — skipping it here
          // would create the record with whatever record type the database
          // falls back to, which is the failure this whole rule exists to stop.
        } else if (rts.length === 0) {
          setPickedRecordType(false)
        } else if (selectable.length === 1) {
          setPickedRecordType(selectable[0])
        }
        // else: leave null so the picker renders — including the case where
        // every program is already taken, which it explains rather than
        // waving the create through with no record type.
        setPickerEvaluated(true)
      })
      .catch(err => {
        if (cancelled) return
        console.warn('fetchAvailableRecordTypes failed', err)
        setPickedRecordType(false)
        setPickerEvaluated(true)
      })
    return () => { cancelled = true }
  }, [isCreate, tableName, prefillRecordTypeValue, prefillState, prefillParentObject,
      prefillParentRecordTypeId, prefillTakenOnBuildingId, prefillParentChoices,
      parentPickPrefill])

  // ── Load required-field set ────────────────────────────────────────────
  // Fetch the table's NOT NULL columns once per mount; render the red
  // asterisk on those fields. fetchTableMetadata is cached per session so
  // this is essentially free on repeat opens.
  useEffect(() => {
    let cancelled = false
    fetchTableMetadata(tableName)
      .then(meta => {
        if (cancelled) return
        setRequiredFields(new Set(meta.required_fields || []))
      })
      .catch(() => { if (!cancelled) setRequiredFields(new Set()) })
    return () => { cancelled = true }
  }, [tableName])

  // Create pop-up: resolve the display name of each locked parent column, so a
  // read-only Opportunity reads "5513 North Hopkins Street - Milwaukee - HOMES
  // Audit" instead of the uuid sitting in the draft.
  useEffect(() => {
    if (!isCreate || lockedCreateFields.size === 0 || !data?.sections) {
      setCreateLockedLabels(new Map())
      return undefined
    }
    const targets = []
    for (const sec of data.sections) {
      for (const w of (sec.widgets || [])) {
        if (w.widget_type !== 'field_group') continue
        for (const f of (w.widget_config?.fields || [])) {
          if (!lockedCreateFields.has(f.name)) continue
          const id = prefill?.[f.name]
          if (!id || !f.lookup_table || !f.lookup_field) continue
          if (targets.some(t => t.id === id)) continue
          targets.push({ id, table: f.lookup_table, column: f.lookup_field })
        }
      }
    }
    if (targets.length === 0) { setCreateLockedLabels(new Map()); return undefined }
    let cancelled = false
    ;(async () => {
      const map = new Map()
      for (const t of targets) {
        try {
          const { data: row } = await supabase.from(t.table)
            .select(`id, ${t.column}`).eq('id', t.id).maybeSingle()
          if (row) map.set(t.id, { label: row[t.column] || '(record)', table: t.table })
        } catch { /* unresolved parents just show the raw id */ }
      }
      if (!cancelled) setCreateLockedLabels(map)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, data?.sections, lockedCreateFields, prefill])

  // Create pop-up: resolve any required column the page layout doesn't carry
  // into a real editor (picklist / lookup / number / date), so the modal can
  // always ask for everything the insert needs — including on an object with no
  // layout at all. Re-runs when the record type changes so record-type-scoped
  // picklist values stay correct.
  const createRecordTypeDraftValue = getRecordTypeColumn(tableName)
    ? (draft?.[getRecordTypeColumn(tableName)] || null)
    : null
  useEffect(() => {
    if (!isCreate) { setCreateExtraFields([]); setCreateExtraPicklistOpts({}); return undefined }
    if (loading) return undefined
    const neverAsk = createNeverAskColumns(tableName)
    const { covered } = buildCreateModalGroups(data?.sections || [], {
      requiredFields, showAll: true, neverAsk,
    })
    const missing = listUnlaidOutRequiredColumns(requiredFields, covered, {
      neverAsk, recordTypeColumn: getRecordTypeColumn(tableName),
    })
    if (missing.length === 0) { setCreateExtraFields([]); setCreateExtraPicklistOpts({}); return undefined }
    let cancelled = false
    buildUnlaidOutRequiredFieldDefs(missing, tableName, createRecordTypeDraftValue)
      .then(({ defs, picklistOpts }) => {
        if (cancelled) return
        setCreateExtraFields(defs)
        setCreateExtraPicklistOpts(picklistOpts)
      })
      .catch(() => { if (!cancelled) { setCreateExtraFields([]); setCreateExtraPicklistOpts({}) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, tableName, loading, data?.sections, requiredFields, createRecordTypeDraftValue])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)

    if (isCreate) {
      // Gate on picker evaluation. Until we know whether the picker is
      // needed (and the user has picked, if shown), don't fetch the layout.
      if (!pickerEvaluated) { setLoading(false); return }
      if (pickedRecordType === null) { setLoading(false); return }   // picker is up

      // Resolve which record type the form will use:
      //   pickedRecordType === false  -> object has no RTs OR prefill supplied one
      //   pickedRecordType === object -> the user (or auto-pick) chose one
      const rtId    = pickedRecordType && pickedRecordType.id    ? pickedRecordType.id    : null
      const rtCol   = getRecordTypeColumn(tableName)
      // Seed value for the form's record-type column when we have a pick.
      // WHAT gets seeded is decided by what the column can hold, not by the
      // convention alone: a `{object}_record_type` uuid column takes the picked
      // type's id, but portal_users.record_type is TEXT and holds the picklist
      // value — and every portal gate compares that text, so an id there
      // creates a portal user no portal recognises. Resolved before the form
      // seeds its draft, below.
      let seededRT = {}
      const resolveSeededRecordType = async () => {
        if (!pickedRecordType || !pickedRecordType.id) return {}
        let dataType = null
        try {
          const cols = await getEditableFieldsForTable(tableName)
          dataType = (cols || []).find(c => c.columnName === rtCol)?.dataType || null
        } catch { /* unknown type falls back to the uuid convention */ }
        const seed = recordTypeSeedValue(pickedRecordType, dataType)
        return seed ? { [rtCol]: seed } : {}
      }

      // Compose a derived display name when the prefill carried a name base
      // (e.g. projects: opportunity name + record-type label, mirroring
      // trg_project_name). This makes the read-only Name field show its value
      // as soon as the form opens instead of staying blank until save. The
      // base is a transient prefill hint; strip it from what we seed.
      const composeDerivedName = (base, rtObj) =>
        composeDerivedRecordName(base, rtObj ? (rtObj.label || rtObj.picklist_label || '') : '')
      const seedDraft = (pf) => {
        const d = pf ? { ...seededRT, ...pf } : { ...seededRT }
        derivedNameBaseRef.current = null
        if (d.__derivedNameBase) {
          derivedNameBaseRef.current = d.__derivedNameBase
          const nameCol = TABLE_META[tableName]?.nameColumn
          if (nameCol) {
            const composed = composeDerivedName(d.__derivedNameBase, pickedRecordType)
            if (composed) d[nameCol] = composed
          }
          delete d.__derivedNameBase
        }
        // Every remaining __ key is a transient prefill hint, never a column:
        // __lockedFields (which parent columns the create pop-up shows
        // read-only), __parentObject / __parentRecordTypeId (the parent whose
        // record type narrows the picker). Strip them all rather than naming
        // each one, so a new hint can never leak into an insert and fail on an
        // unknown column.
        for (const k of Object.keys(d)) {
          if (k.startsWith('__')) delete d[k]
        }
        return d
      }

      // Mirror the Project-Reservation BEFORE INSERT defaults on the create
      // form (fill blanks only), so the radios / contractor show selected
      // before the first save. Resolves picklist/account ids by value/name.
      const seedReservationDefaultsOnCreate = async (recordTypeId) => {
        let rtVal = pickedRecordType?.value || pickedRecordType?.picklist_value || getRecordTypeValue(prefill)
        if (!rtVal && recordTypeId) {
          const { data: rt } = await supabase.from('picklist_values')
            .select('picklist_value').eq('id', recordTypeId).maybeSingle()
          rtVal = rt?.picklist_value || null
        }
        if (!rtVal || !/Project-Reservation/i.test(rtVal)) return
        const pv = async (field, value) => {
          const { data } = await supabase.from('picklist_values').select('id')
            .eq('picklist_object', 'enrollments').eq('picklist_field', field)
            .eq('picklist_value', value).eq('picklist_is_active', true).maybeSingle()
          return data?.id || null
        }
        const acct = async (name) => {
          const { data } = await supabase.from('accounts').select('id')
            .eq('account_name', name).eq('account_is_deleted', false).maybeSingle()
          return data?.id || null
        }
        const [appFor, bType, bProj, sealedRow, eesRow] = await Promise.all([
          pv('application_for', 'Project Reservation'),
          pv('building_type', 'Existing'),
          pv('building_project_type', 'Multifamily - Central 5 Units'),
          acct('Sealed Inc'),
          acct('Energy Efficiency Services of Wisconsin'),
        ])
        if (cancelled) return
        setDraft(prev => {
          const next = { ...prev }
          if (appFor && next.enrollment_application_for == null) next.enrollment_application_for = appFor
          if (bType && next.enrollment_building_type == null) next.enrollment_building_type = bType
          if (bProj && next.enrollment_building_project_type == null) next.enrollment_building_project_type = bProj
          // Primary contractor = Sealed Inc, support contractor = Energy
          // Efficiency Services of Wisconsin. Which COMPANY runs the program is
          // program config; which PERSON represents it is never named here --
          // the contractor-contact effect below reads it off each account, the
          // same way contractor_contact_for_account does server-side. Naming
          // the people here was why updating an account's Account Contact
          // changed nothing on the form. Fill blanks only.
          if (sealedRow && next.enrollment_contractor_account_id == null) next.enrollment_contractor_account_id = sealedRow
          if (next.enrollment_has_support_contractor == null) next.enrollment_has_support_contractor = true
          if (eesRow && next.enrollment_support_contractor_account_id == null) next.enrollment_support_contractor_account_id = eesRow
          return next
        })
      }

      // Create mode: fetch layout + picklists only, no record.
      // Layout selection uses the picked RT (if any) so the right
      // record-type-specific layout loads.
      const layoutKey = rtId || getRecordTypeValue(prefill)
      Promise.all([fetchPageLayout(tableName, layoutKey), loadAllPicklists(), resolveSeededRecordType()])
        .then(([layoutData, picklists, resolvedRT]) => {
          if (cancelled) return
          seededRT = resolvedRT
          setData({
            record: {},
            layout: layoutData?.layout || null,
            sections: layoutData?.sections || [],
            picklists,
            lookups: new Map(),
            actionOverrides: layoutData?.actionOverrides || [],
          })
          setDraft(seedDraft(effectivePrefill))
          setEditing(true)
          // Pre-load picklist + lookup options. Pass the seeded draft so
          // any dependent-lookup fields can resolve their dependencies on
          // the very first render rather than waiting for a draft change.
          if (layoutData?.sections) {
            const initialDraft = seedDraft(effectivePrefill)
            loadAllEditOpts(layoutData.sections, initialDraft)
          }
          // Pre-select the Project-Reservation defaults on the create form so
          // the radios / contractor aren't blank before the first save (the
          // BEFORE INSERT trigger sets the same values server-side; this just
          // mirrors them in the form). Resolve ids by value/name; fill blanks.
          if (tableName === 'enrollments') seedReservationDefaultsOnCreate(rtId).catch(() => {})
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
  }, [tableName, recordId, isCreate, reloadTick, pickerEvaluated, pickedRecordType])

  // Merged-away accounts must not masquerade as live records. The Merge
  // Accounts tool soft-deletes the loser (account_is_deleted = true) — it's
  // correctly hidden from list views and global search, but its direct
  // /accounts/<id> page still loads the row, so opening it (bookmark, browser
  // history, an old link) showed the dead account as if it were a normal,
  // editable record. That's the "the account I merged from is still there"
  // report. When the loaded account is soft-deleted, resolve the surviving
  // master from account_merge_log — following the chain to the final live
  // account so a chained merge (A→B, B→C) lands on C — and render a clear
  // "merged into X" interstitial instead (Salesforce parity: a merged
  // account's URL points you at the winner).
  useEffect(() => {
    if (isCreate || tableName !== 'accounts' || data?.record?.account_is_deleted !== true) {
      setMergedInfo(null)
      return undefined
    }
    let cancelled = false
    setMergedInfo(null)
    ;(async () => {
      let loserId = recordId
      let master = null
      let mergedAt = null
      for (let hop = 0; hop < 10; hop++) {
        const { data: log } = await supabase
          .from('account_merge_log')
          .select('aml_master_account_id, created_at')
          .eq('aml_merged_account_id', loserId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (cancelled) return
        if (!log?.aml_master_account_id) break
        if (hop === 0) mergedAt = log.created_at
        const { data: acct } = await supabase
          .from('accounts')
          .select('id, account_name, account_record_number, account_is_deleted')
          .eq('id', log.aml_master_account_id)
          .maybeSingle()
        if (cancelled) return
        if (!acct) break
        if (acct.account_is_deleted !== true) { master = acct; break } // live survivor
        loserId = acct.id                                              // keep following the chain
      }
      if (cancelled) return
      setMergedInfo(master ? { status: 'merged', master, mergedAt } : { status: 'deleted' })
    })()
    return () => { cancelled = true }
  }, [data, isCreate, tableName, recordId])

  // True when THIS record is the one currently addressed in the browser URL
  // (/<table>/<id>). Only then do we sync the active tab into the URL — this
  // gates out standalone/local-detail mounts (ObjectListSection's fallback) and
  // any non-URL-addressable host, so the URL is never corrupted there.
  const recordIsUrlAddressed = () =>
    !isCreate && !!recordId && window.location.pathname === `/${tableName}/${recordId}`

  // The ordered tab list, computed from loaded data (mirrors the render-time
  // `orderedTabs`). Used by the URL-sync helpers below, which run outside the
  // render scope where `orderedTabs` is defined.
  const tabsFromData = () =>
    data?.sections ? buildOrderedTabs(data.sections, { includeActivity: !isInsertMode }) : []

  // The status paths this layout renders, and the lifecycle columns they
  // cover. The transitions bar stands down for those columns so one status is
  // announced by one card. Hoisted above the loading returns — a hook below a
  // return is minified error #310.
  const statusPathWidgets = useMemo(
    () => (data?.sections || []).flatMap(
      sec => (sec.widgets || []).filter(w => w.widget_type === 'status_path')
    ),
    [data?.sections]
  )
  const statusPathFields = useMemo(
    () => statusPathWidgets.map(w => w.widget_config?.status_field).filter(Boolean),
    [statusPathWidgets]
  )

  // When data first loads (or when the loaded record changes tables),
  // pick the active tab. Honors a ?tab= deep link / restored history entry
  // when this record is the URL-addressed one; otherwise the first tab.
  // Only initializes — does not override an in-session selection.
  useEffect(() => {
    if (!data?.sections) return
    if (activeTab !== null) return
    const tabs = buildOrderedTabs(data.sections, { includeActivity: !isInsertMode })
    if (tabs.length === 0) return
    let initial = tabs[0]
    if (recordIsUrlAddressed()) {
      const raw = new URLSearchParams(window.location.search).get('tab')
      if (raw && tabs.includes(raw)) initial = raw
    }
    setActiveTab(initial)
  }, [data, activeTab])

  // Reset active tab when switching records so the new record opens on
  // its first tab rather than inheriting the previous record's selection.
  useEffect(() => {
    setActiveTab(null)
  }, [tableName, recordId])

  // Pre-populate the reservation "What work will be completed?" multiselect from
  // the opportunity's line items, mapped to work measures (product_work_measure_
  // map / derive_reservation_work_measures). Fill-if-empty only — a user's own
  // selection is never overwritten. Runs whenever the opportunity changes on a
  // reservation enrollment (create form or on entering edit), mirroring the
  // BEFORE INSERT/UPDATE trigger so the value shows before the first save.
  const hasWorkMeasuresField = useMemo(() => (data?.sections || []).some(s =>
    (s.widgets || []).some(w => w.widget_type === 'field_group' &&
      (w.widget_config?.fields || []).some(f => f.name === 'enrollment_work_measures'))
  ), [data?.sections])
  useEffect(() => {
    if (tableName !== 'enrollments' || !hasWorkMeasuresField || !editing) return
    const oppId = draft?.opportunity_id
    if (!oppId) return
    const cur = draft?.enrollment_work_measures
    if (Array.isArray(cur) && cur.length > 0) return // don't clobber a selection
    let cancelled = false
    ;(async () => {
      const { data: measures, error } = await supabase
        .rpc('derive_reservation_work_measures', { p_opportunity_id: oppId })
      if (cancelled || error || !Array.isArray(measures) || measures.length === 0) return
      setDraft(prev => {
        const c = prev?.enrollment_work_measures
        if (Array.isArray(c) && c.length > 0) return prev
        return { ...prev, enrollment_work_measures: measures }
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, hasWorkMeasuresField, editing, draft?.opportunity_id])

  // Multifamily create defaults from the BUILDING's type (Nicholas, 2026-08-03):
  // enrollments are building-specific, so the multifamily decision is INHERITED
  // from the linked building's record type — not a manual dropdown. When that
  // building is a Multifamily type, pre-fill the two required fields: Modeling
  // Approach = "Whole Building - DOE-2-based software" and Requested Incentive
  // Amount = 2000. Fills blanks only, so it never clobbers a chosen value. The
  // modeling UUID is resolved from the loaded options by label (nothing
  // hardcoded). Both fields are required, so the default has to land in the form
  // here — a save-time DB default can't (validation blocks the empty save first).
  useEffect(() => {
    if (!isCreate || tableName !== 'enrollments') return
    const bId = draft?.building_id
    if (!bId) return
    let cancelled = false
    ;(async () => {
      const { data: b } = await supabase.from('buildings')
        .select('building_record_type').eq('id', bId).maybeSingle()
      if (cancelled || !b?.building_record_type) return
      const { data: rt } = await supabase.from('picklist_values')
        .select('picklist_value,picklist_label').eq('id', b.building_record_type).maybeSingle()
      if (cancelled || !rt) return
      const isMultifamily = /multifamily/i.test(rt.picklist_value || '') || /multifamily/i.test(rt.picklist_label || '')
      if (!isMultifamily) return
      setDraft(prev => {
        if (prev.building_id !== bId) return prev
        const next = { ...prev }
        let changed = false
        if (next.enrollment_modeling_approach == null || next.enrollment_modeling_approach === '') {
          const doe2 = (allPicklistOpts?.enrollment_modeling_approach || [])
            .find(o => (o.label || '') === 'Whole Building - DOE-2-based software')
          if (doe2) { next.enrollment_modeling_approach = doe2.value; changed = true }
        }
        if (next.enrollment_requested_incentive_amount == null || next.enrollment_requested_incentive_amount === '') {
          next.enrollment_requested_incentive_amount = 2000; changed = true
        }
        return changed ? next : prev
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, tableName, draft?.building_id, allPicklistOpts])

  // A contractor contact follows the contractor account it sits beside
  // (Nicholas, 2026-08-03, extended 2026-08-25). Picking Johnson Controls sets
  // the contact to that account's Account Contact; CHANGING the account moves
  // the contact with it rather than leaving the previous company's person on a
  // program form, which is how ENR-00012 came to list a Sealed Inc contact
  // under Energy Efficiency Services of Wisconsin. Both the primary and the
  // support contractor are covered — the earlier version only handled the
  // primary, so the support block never inherited anything.
  //
  // Eligibility is the field's own picker (list_contacts_for_account_hierarchy:
  // the account, its ancestors, and account_contact_relations), so the form can
  // never show a contact contractor_contact_for_account would replace on save.
  const contractorPairs = useMemo(() => contractorContactPairsFor(tableName), [tableName])
  const contractorPairKey = contractorPairs
    .map(pair => `${draft?.[pair.account] || ''}:${draft?.[pair.contact] || ''}`).join('|')
  useEffect(() => {
    if (!isCreate || contractorPairs.length === 0) return
    const pending = contractorPairs
      .map(pair => ({ pair, accountId: draft?.[pair.account] || null }))
      .filter(entry => entry.accountId)
    if (pending.length === 0) return
    let cancelled = false
    ;(async () => {
      const resolved = await Promise.all(pending.map(async ({ pair, accountId }) => {
        const [{ data: acct }, { data: eligible }] = await Promise.all([
          supabase.from('accounts').select('account_contact_id').eq('id', accountId).maybeSingle(),
          supabase.rpc('list_contacts_for_account_hierarchy', { p_account_ids: [accountId] }),
        ])
        return {
          pair,
          accountId,
          next: resolveContractorContact({
            accountId,
            currentContactId: draft?.[pair.contact] || null,
            eligibleContactIds: Array.isArray(eligible) ? eligible.map(r => r.id) : null,
            accountContactId: acct?.account_contact_id || null,
          }),
        }
      }))
      if (cancelled) return
      setDraft(prev => {
        let changed = false
        const next = { ...prev }
        for (const entry of resolved) {
          // The account may have moved on while the lookups were in flight.
          if (prev[entry.pair.account] !== entry.accountId) continue
          if ((prev[entry.pair.contact] || null) === entry.next) continue
          next[entry.pair.contact] = entry.next
          changed = true
        }
        return changed ? next : prev
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, contractorPairs, contractorPairKey])

  // Record the visit for Recent Items (Salesforce parity). Fires once per opened
  // record, only for the URL-addressed record (so ObjectListSection's non-URL
  // detail mounts don't count) and only after the record actually loaded in view
  // mode. Best-effort — recordRecentlyViewed never throws or blocks the page.
  const recordedViewRef = useRef(null)
  useEffect(() => {
    if (isCreate || !recordId) return
    if (!recordIsUrlAddressed()) return
    if (data?.record?.id !== recordId) return
    const key = `${tableName}:${recordId}`
    if (recordedViewRef.current === key) return
    recordedViewRef.current = key
    recordRecentlyViewed(tableName, recordId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, recordId, isCreate, data])

  // Resolve prefilled parent FK names so the breadcrumb is hierarchical while
  // CREATING a child from a parent's related list — e.g. "New Building" under a
  // property shows "Enrollment / Buildings / <Property>", and a new Contact Role
  // shows its opportunity/contact parents. Keyed on the parent FK values so it
  // runs once when the prefill arrives, not on every keystroke.
  const createCrumbKey = (() => {
    const meta = TABLE_META[tableName]
    if (!isCreate || !meta || !prefill) return ''
    return (meta.parents || []).map(fk => prefill[fk] || '').join('|')
  })()
  useEffect(() => {
    if (!isCreate || !prefill) { setCreateCrumbLookups(new Map()); return }
    const meta = TABLE_META[tableName]
    if (!meta?.parents?.length) return
    const targets = []
    meta.parents.forEach((fk, i) => {
      const parentTable = (meta.parentTables || [])[i]
      const nameCol = parentTable ? TABLE_META[parentTable]?.nameColumn : null
      const val = prefill[fk]
      if (val && parentTable && nameCol) targets.push({ val, parentTable, nameCol })
    })
    if (targets.length === 0) return
    let cancelled = false
    ;(async () => {
      const map = new Map()
      for (const { val, parentTable, nameCol } of targets) {
        try {
          const { data: row } = await supabase.from(parentTable).select(`id, ${nameCol}`).eq('id', val).maybeSingle()
          if (row) map.set(val, { label: row[nameCol] || '(record)', table: parentTable })
        } catch { /* best-effort: an unresolved parent just leaves that crumb out */ }
      }
      if (!cancelled) setCreateCrumbLookups(map)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, tableName, createCrumbKey])

  // CREATE mode: resolve cross-object (related) field display values from the
  // FK the user has already chosen. Related fields (type='related_field',
  // name '<fk_column>.<parent_column>') are read-only reflections of a parent
  // record — on a saved record loadRecordDetailData fills them in, but on the
  // create form there's no record yet, so they'd otherwise render blank/hidden
  // even though the parent FK (e.g. a new Unit's Building) is already picked.
  // Here we group the layout's related fields by FK column, fetch each parent
  // row once (RLS-respecting), resolve any lookup-typed parent columns to
  // their display names, and stash the formatted strings for the renderer.
  // Keyed on the FK draft values so it re-runs when the user changes the FK.
  const relatedFieldDefs = useMemo(() => {
    if (!isCreate || !data?.sections) return []
    const defs = []
    for (const sec of data.sections) {
      for (const w of sec.widgets || []) {
        if (w.widget_type !== 'field_group' || !w.widget_config?.fields) continue
        for (const f of w.widget_config.fields) {
          if (f.type !== 'related_field' || !f.related?.table || !f.related?.column) continue
          const fk = f.related.fk_column || String(f.name).split('.')[0]
          if (fk) defs.push({ ...f, __fk: fk })
        }
      }
    }
    return defs
  }, [isCreate, data?.sections])
  const relatedFieldFkKey = relatedFieldDefs.map(f => `${f.__fk}:${draft[f.__fk] || ''}`).join('|')
  useEffect(() => {
    if (!isCreate || relatedFieldDefs.length === 0) { setCreateRelatedValues(new Map()); return }
    // Group by FK column so each parent row is fetched once.
    const byFk = new Map()
    for (const f of relatedFieldDefs) {
      if (!byFk.has(f.__fk)) byFk.set(f.__fk, [])
      byFk.get(f.__fk).push(f)
    }
    let cancelled = false
    ;(async () => {
      const out = new Map()
      const lookupRequests = []
      const rawByField = new Map()
      // 1. Fetch parent rows and collect raw parent-column values.
      await Promise.all([...byFk.entries()].map(async ([fk, fields]) => {
        const parentId = draft[fk]
        if (!parentId) return
        const table = fields[0].related.table
        const cols = [...new Set(fields.map(f => f.related.column))].join(',')
        try {
          const { data: row, error } = await supabase.from(table).select(cols).eq('id', parentId).maybeSingle()
          if (error || !row) return
          for (const f of fields) {
            const raw = row[f.related.column]
            rawByField.set(f.name, raw)
            if (raw != null && f.related.column_type === 'lookup' && f.related.lookup_table && f.related.lookup_field) {
              lookupRequests.push({ lookup_table: f.related.lookup_table, lookup_field: f.related.lookup_field, value: raw })
            }
          }
        } catch { /* leave unresolved — the field simply won't show yet */ }
      }))
      // 2. Resolve any lookup-typed parent columns to their display names.
      let lookups = new Map()
      try { lookups = await resolveLookups(lookupRequests) } catch { /* best-effort */ }
      // 3. Format each field the same way the saved-record renderer does.
      for (const f of relatedFieldDefs) {
        if (!rawByField.has(f.name)) continue
        const raw = rawByField.get(f.name)
        if (raw == null || raw === '') continue
        const rel = f.related
        const display = formatFieldValue(raw, {
          ...f, type: rel.column_type || 'text',
          lookup_table: rel.lookup_table, lookup_field: rel.lookup_field,
        }, data?.picklists, lookups)
        if (display != null && display !== '') out.set(f.name, display)
      }
      if (!cancelled) setCreateRelatedValues(out)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate, relatedFieldFkKey])

  // Select a tab AND push it onto browser history as ?tab=<name> (Salesforce
  // parity: the related-list/Activity view is its own history entry, so the
  // browser Back button steps exactly one level — Related → Details → list —
  // instead of jumping past the record entirely). The default (first) tab uses
  // the clean record URL with no query, so back from Related lands on Details.
  const selectTab = useCallback((t) => {
    setActiveTab(t)
    if (isCreate || !recordId || window.location.pathname !== `/${tableName}/${recordId}`) return
    const tabs = data?.sections ? buildOrderedTabs(data.sections, { includeActivity: !isInsertMode }) : []
    const defaultTab = tabs[0] || null
    const params = new URLSearchParams(window.location.search)
    if (t && t !== defaultTab) params.set('tab', t)
    else params.delete('tab')
    const qs = params.toString()
    const next = window.location.pathname + (qs ? `?${qs}` : '')
    if (next !== window.location.pathname + window.location.search) {
      // Pushed through urlNav so the entry is tagged as belonging to THIS
      // record: browser Back still steps Related → Details, but leaving the
      // record (breadcrumb / back arrow) steps over its tabs in one go
      // instead of landing back on the same record.
      pushRecordSubPath(next)
    }
  }, [data, isInsertMode, tableName, recordId, isCreate])

  // Browser back/forward: re-derive the active tab from the URL. The app's own
  // popstate handler re-parses the path (same record → no remount), and this
  // independently restores the tab the URL points at.
  useEffect(() => {
    const onPop = () => {
      if (isCreate || !recordId || window.location.pathname !== `/${tableName}/${recordId}`) return
      const tabs = data?.sections ? buildOrderedTabs(data.sections, { includeActivity: !isInsertMode }) : []
      if (tabs.length === 0) return
      const raw = new URLSearchParams(window.location.search).get('tab')
      setActiveTab(raw && tabs.includes(raw) ? raw : tabs[0])
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [data, isInsertMode, tableName, recordId, isCreate])

  const loadAllEditOpts = useCallback(async (sections, currentRecord = null) => {
    const pickFields = []
    const lookupFields = []
    const dependentLookupFields = []
    for (const s of sections) for (const w of s.widgets)
      if (w.widget_type === 'field_group' && w.widget_config?.fields)
        for (const f of w.widget_config.fields) {
          if (f.type === 'picklist') pickFields.push(f.name)
          if (f.type === 'lookup' && f.lookup_table && f.lookup_field) {
            if (f.lookup_dependency && f.lookup_dependency.kind) {
              dependentLookupFields.push({
                name: f.name,
                field: f,
              })
            } else {
              lookupFields.push({ name: f.name, table: f.lookup_table, field: f.lookup_field })
            }
          }
        }

    // Fetch picklist options — scoped to this record's record type so a status
    // (or any picklist) dropdown shows ONLY the values selected for that record
    // type, matching the status path. Falls back to the full set when the record
    // has no record type.
    if (pickFields.length) {
      const recordTypeId = getRecordTypeValue(currentRecord)
      // …and to the state the record is in, for the value sets whose values name
      // one (the building utility picklists). Does nothing to any other field.
      const recordState = recordStateValue(currentRecord, getTableColumnPrefix(tableName))
      const opts = {}
      await Promise.all(pickFields.map(async fn => {
        try { opts[fn] = await fetchPicklistOptions(tableName, fn, recordTypeId, recordState) } catch { opts[fn] = [] }
      }))
      setAllPicklistOpts(opts)
    }

    // Fetch unscoped lookup options (the unfiltered path)
    if (lookupFields.length) {
      const opts = {}
      await Promise.all(lookupFields.map(async lf => {
        try { opts[lf.name] = await fetchLookupOptions(lf.table, lf.field) } catch { opts[lf.name] = [] }
      }))
      setAllLookupOpts(prev => ({ ...prev, ...opts }))
    }

    // Fetch dependent lookup options — scoped by other fields on the record.
    // Caller passes `currentRecord` so the RPC has the right input values on
    // the initial load. Subsequent re-fetches on dependency change happen
    // via the effect below.
    if (dependentLookupFields.length) {
      const opts = {}
      await Promise.all(dependentLookupFields.map(async dlf => {
        try { opts[dlf.name] = await fetchDependentLookupOptions(dlf.field, currentRecord || {}) }
        catch (e) { console.warn('fetchDependentLookupOptions failed for', dlf.name, e); opts[dlf.name] = [] }
      }))
      setAllLookupOpts(prev => ({ ...prev, ...opts }))
      setDependentLookupFields(dependentLookupFields)
    } else {
      setDependentLookupFields([])
    }
  }, [tableName])

  const startEditing = () => {
    if (!data?.record) return
    // Locked-record guard (belt-and-suspenders — the Edit action is also hidden
    // for locked records via recordActions isAvailable). Admins are exempt.
    if (statusLocksRecord && !isSystemAdmin) {
      toast.error('This record is locked. Only a System Administrator can edit it once it has been submitted.')
      return
    }
    setDraft({ ...data.record }); setEditing(true)
    if (data.sections) loadAllEditOpts(data.sections, data.record)
  }
  const cancelEditing = () => {
    if (isCreate) { onBack(); return }
    if (cloneSource) { setCloneSource(null); setEditing(false); setDraft({}); return }
    setEditing(false); setDraft({})
  }
  const handleFieldChange = (name, value) => setDraft(prev => {
    const next = { ...prev, [name]: value }
    // Per-table auto-derive rules. Salesforce parity: certain "name" fields
    // are computed from other fields rather than free-text.
    if (tableName === 'properties' && (name === 'property_street' || name === 'property_city')) {
      const street = (name === 'property_street' ? value : next.property_street) || ''
      const city   = (name === 'property_city'   ? value : next.property_city)   || ''
      const derived = [street, city].filter(s => String(s || '').trim()).join(' - ')
      next.property_name = derived || ''
    }
    // Enrollments: subsidized share % is assisted/total — recompute whenever
    // either unit count changes so the form never shows stale or blank math.
    // Occupancy mirrors it: unoccupied = total - occupied.
    if (tableName === 'enrollments'
        && (name === 'enrollment_total_units' || name === 'enrollment_assisted_units')) {
      const total = Number(next.enrollment_total_units)
      const assisted = Number(next.enrollment_assisted_units)
      next.enrollment_subsidized_share_pct =
        (total > 0 && Number.isFinite(assisted))
          ? Math.round((assisted / total) * 1000) / 10
          : null
    }
    if (tableName === 'enrollments'
        && (name === 'enrollment_total_units' || name === 'enrollment_occupied_units')) {
      const total = Number(next.enrollment_total_units)
      const occupied = Number(next.enrollment_occupied_units)
      if (total > 0 && Number.isFinite(occupied)) {
        next.enrollment_unoccupied_units = Math.max(0, total - occupied)
      }
    }
    // Recompose the derived name when record type changes during create —
    // "<base> - <record type label>" (projects mirror trg_project_name with
    // the opportunity name as base; enrollments use the property name). Only
    // applies while a derived base is held (i.e. created from a parent whose
    // related-list New seeded __derivedNameBase).
    const derivedNameCol = TABLE_META[tableName]?.nameColumn
    if (derivedNameCol && name === getRecordTypeColumn(tableName) && derivedNameBaseRef.current) {
      const opts = allPicklistOpts?.[name] || []
      const rtLabel = (opts.find(o => o.value === value)?.label) || ''
      next[derivedNameCol] = composeDerivedRecordName(derivedNameBaseRef.current, rtLabel) || ''
    }
    return next
  })

  // ── Project Payment Request ↔ reservation link ──────────────────────────
  // The WI-IRA-MF-HOMES reservation (an enrollment) and the Project Payment
  // Request (an incentive_application) are the same program on the same
  // opportunity at two stages. When a payment request is created, pull forward
  // everything the reservation already captured (contractor + support
  // contractor, building/project type, income level, heating, who-gets-paid,
  // tax classification, modeling software, work measures, project cost) via
  // build_ia_payment_request_prefill, which translates each picklist by value
  // string. Fills blanks only — never clobbers what the preparer already set.
  const [ppRequestRtId, setPpRequestRtId] = useState(null)
  useEffect(() => {
    if (tableName !== 'incentive_applications' || !isCreate) return
    let cancelled = false
    supabase.from('picklist_values').select('id')
      .eq('picklist_object', 'incentive_applications')
      .eq('picklist_field', 'record_type')
      .eq('picklist_value', 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST')
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setPpRequestRtId(data?.id || null) })
    return () => { cancelled = true }
  }, [tableName, isCreate])

  const applyPaymentRequestPrefill = useCallback(async (oppId) => {
    if (!oppId) return
    try {
      const { data: pf, error } = await supabase.rpc('build_ia_payment_request_prefill', { p_opportunity_id: oppId })
      if (error || !pf || typeof pf !== 'object' || Array.isArray(pf)) return
      setDraft(prev => {
        const next = { ...prev }
        for (const [k, v] of Object.entries(pf)) {
          if (v === null || v === undefined) continue
          if (next[k] === null || next[k] === undefined || next[k] === '') next[k] = v
        }
        return next
      })
    } catch (e) { console.warn('payment request prefill from reservation failed', e) }
  }, [])

  // Fire once per opportunity: at init when created from the opportunity (RT +
  // opportunity_id already seeded) and when the opportunity is chosen on the
  // global New Application form. The ref stops it re-running for the same
  // opportunity so it can't stomp later edits.
  const prefilledReservationOppRef = useRef(null)
  useEffect(() => {
    if (!isCreate || tableName !== 'incentive_applications') return
    if (!ppRequestRtId || draft.ia_record_type !== ppRequestRtId) return
    const oppId = draft.opportunity_id
    if (!oppId || prefilledReservationOppRef.current === oppId) return
    prefilledReservationOppRef.current = oppId
    applyPaymentRequestPrefill(oppId)
  }, [isCreate, tableName, ppRequestRtId, draft.ia_record_type, draft.opportunity_id, applyPaymentRequestPrefill])

  // Dependent-lookup re-fetch: when any field listed in a dependent
  // lookup's depends_on array changes value in the draft, re-query the
  // options for that dependent field. The effect derives a comma-joined
  // signature of every dependency value so React's dependency-array
  // comparison fires precisely when a dependency value flips.
  // Runs only in edit mode and only when dependentLookupFields is non-empty.
  const dependencySignature = useMemo(() => {
    if (!editing || dependentLookupFields.length === 0) return ''
    const parts = []
    for (const dlf of dependentLookupFields) {
      const fields = dlf.field?.lookup_dependency?.depends_on || []
      for (const fn of fields) {
        parts.push(`${dlf.name}@${fn}=${draft?.[fn] ?? ''}`)
      }
    }
    return parts.join('|')
  }, [editing, dependentLookupFields, draft])

  useEffect(() => {
    if (!editing || dependentLookupFields.length === 0) return
    let cancelled = false
    ;(async () => {
      const opts = {}
      await Promise.all(dependentLookupFields.map(async dlf => {
        try { opts[dlf.name] = await fetchDependentLookupOptions(dlf.field, draft) }
        catch (e) { console.warn('dependent lookup re-fetch failed for', dlf.name, e); opts[dlf.name] = [] }
      }))
      if (cancelled) return
      setAllLookupOpts(prev => ({ ...prev, ...opts }))
    })()
    return () => { cancelled = true }
    // dependencySignature captures every relevant value; including draft
    // directly would re-fire on every keystroke in unrelated fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependencySignature])

  // Create-time duplicate probe (accounts / properties / buildings). As the
  // user types the name/address fields, debounce-call find_duplicate_candidates
  // and surface exact + close matches in DuplicateCheckPanel. The signature
  // (serialized probe params) keeps this from firing on unrelated keystrokes.
  const dupProbeSignature = useMemo(() => {
    if (!isInsertMode || !DUPLICATE_CHECK_TABLES.includes(tableName)) return ''
    const probe = buildDuplicateProbe(tableName, draft)
    return probe ? JSON.stringify(probe) : ''
  }, [isInsertMode, tableName, draft])

  useEffect(() => {
    if (!dupProbeSignature) {
      setDupMatches([]); setDupAcknowledged(false)
      return undefined
    }
    const params = JSON.parse(dupProbeSignature)
    const myReq = ++dupReqRef.current
    const t = setTimeout(async () => {
      const { data: hits, error: dupErr } = await supabase.rpc('find_duplicate_candidates', params)
      if (myReq !== dupReqRef.current) return   // stale response — a newer probe is in flight
      if (dupErr) { setDupMatches([]); return } // probe failure must never block creation
      setDupMatches(Array.isArray(hits) ? hits : [])
      setDupAcknowledged(false)
    }, 250)
    return () => clearTimeout(t)
  }, [dupProbeSignature])

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
    if (data.sections) loadAllEditOpts(data.sections, seed)
    setEditing(true)
  }, [data, recordId, loadAllEditOpts])

  // Launch mode: when opened via a list-view "Edit" or "Clone" row action the
  // record arrives with mode='edit' / 'clone'. Once the record has loaded,
  // enter the corresponding state exactly once (edit → editable form seeded
  // with the record; clone → insert-mode copy). Guarded so re-renders and
  // post-save data reloads don't re-trigger it.
  const launchModeAppliedRef = useRef(false)
  useEffect(() => {
    if (launchModeAppliedRef.current || isCreate || !data?.record) return
    if (mode === 'edit') { launchModeAppliedRef.current = true; startEditing() }
    else if (mode === 'clone') { launchModeAppliedRef.current = true; handleClone() }
  // startEditing is a stable closure over data; handleClone is memoized.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, data, isCreate])

  // Advance to Opportunity — from a Property, create a new Opportunity with the
  // property's data carried over (linkage, account/management company/site
  // contact, location, building & unit characteristics), then land the user on
  // the new opportunity-create form. The record-type picker still runs so the
  // user selects the WI program, and the remaining outreach steps
  // (decision-maker contact, opportunity contact roles) continue on the created
  // opportunity. A guided wizard can replace this later; the prefill contract
  // is the seam it will plug into.
  const handleAdvanceToOpportunity = useCallback(() => {
    const r = data?.record
    if (!r || !onNavigateToRecord) return
    const prefillObj = {
      // Linkage
      property_id:                          r.id,
      // Account / management company / site contact — the "who" of the property
      opportunity_account_id:               r.property_account_id || null,
      opportunity_managing_account_id:      r.property_management_company_id || null,
      opportunity_property_management_company: r.property_management_company_id || null,
      opportunity_property_site_contact:    r.property_primary_contact_id || null,
      // Names / identifiers
      opportunity_property_aka:             r.property_aka_name || null,
      opportunity_subdivision_name:         r.property_subdivision_name || null,
      opportunity_state:                    r.property_state || null,
      opportunity_name:                     r.property_name ? `${r.property_name} — Opportunity` : null,
      // Building & unit characteristics
      opportunity_number_of_buildings:      r.property_total_buildings ?? r.property_number_of_buildings ?? null,
      opportunity_total_units:              r.property_total_units ?? null,
      opportunity_total_number_of_units:    r.property_total_number_of_units ?? null,
      opportunity_year_built:               r.property_year_built ?? null,
      opportunity_total_attic_sq_ft:        r.property_total_attic_sq_ft ?? null,
      opportunity_total_building_sq_ft:     r.property_total_building_sq_ft ?? null,
    }
    // Drop nulls so the create form treats them as untouched (and required-field
    // validation still fires for anything genuinely missing).
    for (const k of Object.keys(prefillObj)) if (prefillObj[k] == null) delete prefillObj[k]
    onNavigateToRecord({ table: 'opportunities', id: null, mode: 'create', prefill: prefillObj })
  }, [data, onNavigateToRecord])

  // Run Income Qualification — one-tap. Classifies the enrollment, generates
  // the IRA application PDF + tenant data XLSX, saves both to the record, and
  // writes the determination + unpacked HUD/property fields back onto the
  // enrollment. Then reloads so the populated fields render immediately.
  const handleRunIncomeQualification = useCallback(async () => {
    if (runningIncomeQual) return
    setRunningIncomeQual(true)
    try {
      const result = await runIncomeQualification(recordId)
      const mode = result?.determination?.mode || 'Determined'
      setReloadTick(t => t + 1)
      if (typeof window !== 'undefined') {
        window.alert(`Income Qualification complete: ${mode}. Application PDF and tenant data sheet saved to this enrollment.`)
      }
    } catch (e) {
      if (typeof window !== 'undefined') {
        window.alert(`Income Qualification failed: ${e?.message || e}`)
      }
    } finally {
      setRunningIncomeQual(false)
    }
  }, [runningIncomeQual, recordId])

  // Verify Fields — one-tap completeness check for the JotForm-mirrored
  // submittal (e.g. the Project Payment Request). Walks every field_group on the
  // record's own layout and flags editable fields that are still empty, so the
  // preparer knows what's outstanding before keying the form into the program
  // portal. Inherited related_fields are read-only (skipped), but the lookups
  // that drive them (Property / Building / Opportunity / contractor account) ARE
  // checked — an unset parent means the inherited values won't resolve either.
  // Booleans are treated as answered (false is a valid answer).
  const handleVerifyFields = useCallback(async () => {
    const rec = data?.record || {}
    const sections = data?.sections || []
    const isEmpty = (v) =>
      v == null || v === '' || (Array.isArray(v) && v.length === 0)
    const missing = []
    for (const sec of sections) {
      for (const w of sec.widgets || []) {
        if (w.widget_type !== 'field_group' || !w.widget_config?.fields) continue
        for (const f of w.widget_config.fields) {
          if (f.type === 'related_field' || f.type === 'boolean') continue
          if (isEmpty(rec[f.name])) missing.push(f.label || f.name)
        }
      }
    }
    // A required DOCUMENT is as much a reason the submittal isn't ready as an
    // empty field is — the layout declares both, so Verify Fields checks both.
    // Read failure is reported rather than swallowed: silently claiming the
    // documents are fine would be worse than saying we couldn't look.
    let missingDocs = []
    let docCheckError = null
    const galleries = sections.flatMap(sec => sec.widgets || [])
    try {
      if (recordId) {
        const docs = await listDocuments(tableName, recordId)
        missingDocs = missingRequiredDocuments(galleries, docs)
      }
    } catch (err) {
      docCheckError = err?.message || String(err)
    }

    if (typeof window === 'undefined') return
    const parts = []
    if (missing.length > 0) {
      parts.push(
        `${missing.length} field${missing.length === 1 ? '' : 's'} still ` +
        `need${missing.length === 1 ? 's' : ''} attention:\n• ` + missing.join('\n• '))
    }
    if (missingDocs.length > 0) {
      parts.push(
        `${missingDocs.length} required document${missingDocs.length === 1 ? '' : 's'} ` +
        `not yet uploaded:\n• ` + missingDocs.map(d => d.label).join('\n• '))
    }
    if (docCheckError) {
      parts.push(`Required documents could not be checked — ${docCheckError}`)
    }
    if (parts.length === 0) {
      window.alert('Verify Fields: every field is complete and every required document is attached. The forms are ready to export.')
    } else {
      window.alert(`Verify Fields\n\n${parts.join('\n\n')}`)
    }
  }, [data, tableName, recordId])

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

  // ─── Document Template Preview ────────────────────────────────────────────
  // Two-step flow: open modal → load up to 50 candidate parent records of
  // the template's related_object → user picks one → render-document-template-pdf
  // is called with parent_object + parent_record_id and the resulting PDF
  // opens in a new tab. Bypasses the Active-only status gate (preview: true)
  // so authors can iterate on Drafts and Archived templates.
  const openDocPreview = useCallback(async () => {
    if (tableName !== 'document_templates') return
    const relatedObject = data?.record?.related_object
    if (!relatedObject) {
      toast.error('This template has no related object set — pick one in Template Information first.')
      return
    }
    setDocPreviewOpen(true)
    setDocPreviewParentRecord('')
    setDocPreviewLoadingOpts(true)
    try {
      // Determine the name column for the parent table from TABLE_META.
      const parentMeta = TABLE_META[relatedObject]
      const nameCol = parentMeta?.nameColumn || 'id'
      const opts = await fetchLookupOptions(relatedObject, nameCol)
      setDocPreviewParentOptions(opts)
    } catch (err) {
      toast.error(`Couldn't load ${relatedObject} list — ${err.message || String(err)}`)
      setDocPreviewParentOptions([])
    } finally {
      setDocPreviewLoadingOpts(false)
    }
  }, [tableName, data, toast])

  const closeDocPreview = useCallback(() => {
    if (docPreviewRendering) return
    setDocPreviewOpen(false)
    setDocPreviewParentRecord('')
    setDocPreviewParentOptions([])
    setDocPreviewOverlay(false)
  }, [docPreviewRendering])

  const generateDocPreview = useCallback(async () => {
    if (docPreviewRendering) return
    if (!docPreviewParentRecord) { toast.error('Pick a record first.'); return }
    const relatedObject = data?.record?.related_object
    if (!relatedObject) return
    setDocPreviewRendering(true)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase is not configured (missing env vars).')
      }
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) throw new Error('Not signed in — please refresh and log in.')

      const resp = await fetch(`${supabaseUrl}/functions/v1/render-document-template-pdf`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey':        supabaseAnonKey,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          document_template_id:   recordId,
          parent_object:          relatedObject,
          parent_record_id:       docPreviewParentRecord,
          preview:                true,
          include_anchor_overlay: docPreviewOverlay,
        }),
      })

      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`
        try { const j = await resp.json(); if (j?.error) detail = j.error } catch { /* not JSON */ }
        throw new Error(detail)
      }

      // render-document-template-pdf returns JSON with a base64-encoded PDF
      const result = await resp.json()
      if (!result?.pdf_base64) throw new Error('Edge function returned no PDF data')

      // Decode base64 → Uint8Array → Blob → object URL → open in new tab
      const binary = atob(result.pdf_base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank', 'noopener,noreferrer')
      if (!win) {
        // Pop-up blocker — fall back to download
        const a = document.createElement('a')
        a.href = url
        a.download = `${result.template_name || data?.record?.name || 'template'}_preview.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        toast.success('Preview downloaded — pop-ups are blocked.')
      } else {
        toast.success(result.page_count ? `Preview opened — ${result.page_count} page${result.page_count !== 1 ? 's' : ''}` : 'Preview opened')
      }
      // Close the modal on success
      setDocPreviewOpen(false)
      setDocPreviewParentRecord('')
      setDocPreviewParentOptions([])
      setDocPreviewOverlay(false)
    } catch (err) {
      toast.error(`Preview failed — ${err.message || String(err)}`)
    } finally {
      setDocPreviewRendering(false)
    }
  }, [docPreviewRendering, docPreviewParentRecord, docPreviewOverlay, recordId, data, toast])

  // ─── Email Template Preview ───────────────────────────────────────────────
  // Same parent-record-picker UX as document templates. On Generate we hit
  // the render-email-template edge function (separate from the document one
  // because emails return JSON {subject, body_html} not PDF binary). Result
  // appears inline in the modal with an iframe so the HTML body renders
  // exactly as it would in a mail client, isolated from the surrounding app
  // styles.
  const openEmailPreview = useCallback(async () => {
    if (tableName !== 'email_templates') return
    const relatedObject = data?.record?.related_object
    if (!relatedObject) {
      toast.error('This template has no related object set — pick one in Template Information first.')
      return
    }
    setEmailPreviewOpen(true)
    setEmailPreviewParentRecord('')
    setEmailPreviewResult(null)
    setEmailPreviewLoadingOpts(true)
    try {
      const parentMeta = TABLE_META[relatedObject]
      const nameCol = parentMeta?.nameColumn || 'id'
      const opts = await fetchLookupOptions(relatedObject, nameCol)
      setEmailPreviewParentOptions(opts)
    } catch (err) {
      toast.error(`Couldn't load ${relatedObject} list — ${err.message || String(err)}`)
      setEmailPreviewParentOptions([])
    } finally {
      setEmailPreviewLoadingOpts(false)
    }
  }, [tableName, data, toast])

  const closeEmailPreview = useCallback(() => {
    if (emailPreviewRendering) return
    setEmailPreviewOpen(false)
    setEmailPreviewParentRecord('')
    setEmailPreviewParentOptions([])
    setEmailPreviewResult(null)
  }, [emailPreviewRendering])

  const generateEmailPreview = useCallback(async () => {
    if (emailPreviewRendering) return
    if (!emailPreviewParentRecord) { toast.error('Pick a record first.'); return }
    const relatedObject = data?.record?.related_object
    if (!relatedObject) return
    setEmailPreviewRendering(true)
    setEmailPreviewResult(null)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase is not configured (missing env vars).')
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (!accessToken) throw new Error('Not signed in — please refresh and log in.')

      const resp = await fetch(`${supabaseUrl}/functions/v1/render-email-template`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey':        supabaseAnonKey,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          email_template_id: recordId,
          parent_object:     relatedObject,
          parent_record_id:  emailPreviewParentRecord,
          preview:           true,
        }),
      })
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`
        try { const j = await resp.json(); if (j?.error) detail = j.error } catch { /* not JSON */ }
        throw new Error(detail)
      }
      const result = await resp.json()
      setEmailPreviewResult(result)
    } catch (err) {
      toast.error(`Preview failed — ${err.message || String(err)}`)
    } finally {
      setEmailPreviewRendering(false)
    }
  }, [emailPreviewRendering, emailPreviewParentRecord, recordId, data, toast])

  const handleSave = async () => {
    // Guard against double-submit: a fast double-click or a slow insert can
    // fire this twice before the first call resolves, creating duplicate
    // records (this is how the duplicate accounts were created). If a save is
    // already in flight, ignore re-entry.
    if (saving) return
    setSaving(true)

    if (isInsertMode) {
      // INSERT path — runs for true create and for clone
      try {
        const userId = await getCurrentUserId()
        const fields = applyInsertDefaults(tableName, { ...draft }, userId)

        // Cross-object (related) field values live under dotted keys — they are
        // display-only reflections of a parent record's columns and are not
        // real columns on this table, so they must never reach the insert.
        for (const k of Object.keys(fields)) if (k.includes('.')) delete fields[k]

        // Formula / rollup / inherited fields are computed at read and have no
        // (or a computed) backing column — strip them so an insert can't try to
        // write a non-existent column.
        {
          const computedInsert = new Set()
          for (const sec of (data?.sections || [])) for (const w of (sec.widgets || []))
            for (const f of (w.widget_config?.fields || []))
              if (f.type === 'formula' || f.type === 'rollup' || f.type === 'inherited') computedInsert.add(f.name)
          for (const k of Object.keys(fields)) if (computedInsert.has(k)) delete fields[k]
        }

        // Stop the copy: columns now inherited live from the parent must not be
        // written onto the child (the create-prefill computes them only for the
        // form's transient use — state filter + derived fields).
        for (const k of (INHERITED_FROM_PARENT_COLUMNS[tableName] || [])) delete fields[k]

        // Normalize phone fields to the bare 10-digit form the DB constraint
        // requires, so pasted "(515) 297-8363" / "515-297-8363" save cleanly.
        normalizePhoneFieldsInPlace(fields, collectPhoneFieldNames(data?.sections))

        // Strip empty string values (convert to null)
        for (const [k, v] of Object.entries(fields)) {
          if (v === '') fields[k] = null
        }

        // Validate required fields *after* auto-fill so we don't flag
        // system fields the user never saw.
        const meta = await fetchTableMetadata(tableName)
        const labelMap = buildLabelMap(data?.sections)
        const missing = findMissingRequired(meta.required_fields, fields, labelMap, tableName)
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

        // Duplicate soft gate: when the probe found existing matches the
        // user hasn't reviewed, the first Save press pauses; the second
        // press creates anyway. One record per real-world company/property.
        if (dupMatches.length > 0 && !dupAcknowledged) {
          setDupAcknowledged(true)
          toast.warning('Possible duplicate found — review the matches in the blue panel, open the existing record if it\'s the same one, or press Save again to create anyway.')
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
        toast.error(`${cloneSource ? 'Clone' : 'Create'} failed — ${describeWriteError(err)}`)
      } finally {
        setSaving(false)
      }
      return
    }

    // UPDATE mode: compute diff and save only changed fields
    const changes = {}
    for (const [k, v] of Object.entries(draft)) if (v !== data.record[k]) changes[k] = v
    for (const sys of ['id','created_at','updated_at']) delete changes[sys]
    // Cross-object (related) field values live under dotted keys — they are
    // display-only copies of a parent record's columns, never writable here.
    for (const k of Object.keys(changes)) if (k.includes('.')) delete changes[k]
    // Formula / rollup / inherited fields are computed at read — never written
    // back to the underlying column (inherited fields have no column at all),
    // even if a stale copy sits in the draft.
    {
      const computedNames = new Set()
      for (const sec of (data?.sections || [])) for (const w of (sec.widgets || []))
        for (const f of (w.widget_config?.fields || []))
          if (f.type === 'formula' || f.type === 'rollup' || f.type === 'inherited') computedNames.add(f.name)
      for (const k of Object.keys(changes)) if (computedNames.has(k)) delete changes[k]
    }
    for (const k of Object.keys(changes)) {
      if (k.endsWith('_created_at') || k.endsWith('_created_by') || k.endsWith('_updated_at') || k.endsWith('_updated_by') || k.endsWith('_is_deleted')) delete changes[k]
    }
    if (!Object.keys(changes).length) { setEditing(false); setSaving(false); return }

    // Normalize phone fields to the bare 10-digit form the DB constraint
    // requires, so pasted "(515) 297-8363" / "515-297-8363" save cleanly.
    normalizePhoneFieldsInPlace(changes, collectPhoneFieldNames(data?.sections))

    // Normalise empty strings to null before validation + save
    for (const [k, v] of Object.entries(changes)) {
      if (v === '') changes[k] = null
    }

    try {
      // Validate against the merged view — existing record with pending changes applied
      const meta = await fetchTableMetadata(tableName)
      const labelMap = buildLabelMap(data?.sections)
      const merged = { ...data.record, ...changes }
      const missing = findMissingRequired(meta.required_fields, merged, labelMap, tableName)
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

      // Submit gate: a record cannot be moved to a locking status (e.g.
      // "Submitted — Awaiting Program Response") until every required field is
      // populated. For the assessment pre-approval enrollment the required set
      // is the Focus On Energy form's required fields (resolved from this record
      // and its parents); a still-blank one blocks the status change and lists
      // what to complete. Fields being set in THIS save count as populated.
      const statusCol = TABLE_META[tableName]?.statusColumn
      if (statusCol && changes[statusCol]) {
        const { data: stRow } = await supabase
          .from('picklist_values').select('picklist_locks_record')
          .eq('id', changes[statusCol]).maybeSingle()
        if (stRow?.picklist_locks_record === true
            && tableName === 'enrollments'
            && recordTypeLabel === 'WI-IRA-MF-HOMES-Assessment-Preapproval') {
          const { payload, map } = await loadAssessmentPrefill(recordId)
          let missingSubmit = findMissingRequiredFields(payload, map.fields)
          if (missingSubmit.length) {
            // Don't flag a field the user is filling in this very save.
            missingSubmit = missingSubmit.filter(lbl => {
              const f = (map.fields || []).find(ff => (ff.field_label || ff.leap_field) === lbl)
              const pending = f?.leap_field ? changes[f.leap_field] : undefined
              return !(pending !== undefined && pending !== null && String(pending).trim() !== '')
            })
          }
          if (missingSubmit.length) {
            setPreapprovalMissing(missingSubmit)
            setSaving(false)
            return
          }
        }
      }

      const updated = await saveRecord(tableName, recordId, changes)
      setEditing(false); setDraft({})
      toast.success('Changes saved')
      // Optimistic: show this row's own edited columns immediately, and keep
      // any previously-merged cross-object keys so inherited fields don't blank
      // out for a frame.
      setData(prev => ({ ...prev, record: { ...prev.record, ...updated } }))
      // saveRecord returns ONLY this row's own columns — it does not carry the
      // dotted `related_field` keys (e.g. <fk>.account_phone) that reflect a
      // parent record. When a lookup changes, those must be re-read from the
      // NEW parent, otherwise inherited fields stay blank/stale until a manual
      // refresh. Re-run the same merge loadRecordDetailData does on mount, in
      // the background (no setLoading, so no full-page spinner flash).
      try {
        const fresh = await loadRecordDetailData(tableName, recordId)
        setData(fresh)
      } catch { /* keep the optimistic record if the re-merge fetch fails */ }
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

  // Show the record-type picker before loading the layout. Gates create mode.
  if (isCreate && pickerEvaluated && pickedRecordType === null) {
    const objectLabel = TABLE_META[tableName]?.label || humanizeObjectLabel(tableName)
    return (
      <RecordTypePicker
        tableName={tableName}
        objectLabel={singularizeLabel(objectLabel)}
        state={prefillState}
        parentObject={prefillParentObject}
        parentRecordTypeId={prefillParentRecordTypeId}
        parentChoices={prefillParentChoices}
        takenOnBuildingId={prefillTakenOnBuildingId}
        onPick={async (rt, parentPick) => {
          // The program question, when it was asked, is answered here — seed the
          // FK and everything a create launched from that opportunity would
          // have inherited, so both routes produce the same record.
          if (parentPick?.parentId) {
            const inh = await fetchOpportunityInheritedFields(tableName, parentPick.parentId)
              .catch(() => ({ values: {}, nameBase: null }))
            parentPickRef.current = parentPick.parentId
            setParentPickPrefill({
              [parentPick.fkColumn]: parentPick.parentId,
              ...inh.values,
              ...(inh.nameBase && !prefill?.__derivedNameBase
                ? { __derivedNameBase: inh.nameBase } : {}),
            })
          }
          // rt can be null when the picker auto-determined no RTs exist;
          // false marks 'no picker needed' so the load effect can proceed.
          setPickedRecordType(rt || false)
        }}
        onCancel={() => onBack()}
      />
    )
  }

  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted, fontSize: 13 }}>Loading record…</div>
  if (error) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
      <div style={{ color: '#1a5a8a', fontSize: 14, fontWeight: 600 }}>Error loading record</div>
      <div style={{ color: C.textMuted, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', maxWidth: 560, textAlign: 'center' }}>{String(error.message || error)}</div>
      <button onClick={onBack} style={{ marginTop: 8, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 16px', fontSize: 12, color: C.textSecondary, cursor: 'pointer' }}>Back to List</button>
    </div>
  )

  // Defensive: if loading flipped to false but data is still null (e.g. the
  // load effect was gated mid-flight, or fetchPageLayout returned null without
  // setting error), surface a clean message instead of letting the destructure
  // below throw and white-screen the whole app.
  if (!data) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
      <div style={{ color: '#1a5a8a', fontSize: 14, fontWeight: 600 }}>Record could not be loaded</div>
      <div style={{ color: C.textMuted, fontSize: 12, maxWidth: 560, textAlign: 'center' }}>
        The layout for this object didn't load. Try refreshing the page, or contact an admin if the problem persists.
      </div>
      <button onClick={onBack} style={{ marginTop: 8, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 16px', fontSize: 12, color: C.textSecondary, cursor: 'pointer' }}>Back</button>
    </div>
  )

  const { record, layout, sections, picklists, lookups } = data

  // A merged-away (soft-deleted) account is no longer a live record — show the
  // merged/deleted notice with a path to the surviving account instead of
  // rendering the dead row as if it were editable. Rendered as soon as the
  // soft-deleted state is known (mergedInfo may still be resolving the
  // survivor) so the dead record never flashes as live.
  if (!isCreate && tableName === 'accounts' && record?.account_is_deleted === true) {
    return (
      <MergedAccountNotice
        loserName={record.account_name}
        loserNumber={record.account_record_number}
        info={mergedInfo}
        onNavigateToRecord={onNavigateToRecord}
        onBack={onBack}
      />
    )
  }

  // Property Owner Research only belongs on records that represent a property
  // or its ownership: every properties record, and accounts whose record type
  // is Property Owner or Property Management Company. On any other account
  // type (Contractor, Vendor, Service Provider, Utility, …) there is no owner
  // group to research, so the panel is hidden. The record type is resolved
  // from its picklist value (data-driven), never a hardcoded UUID.
  const showOwnerResearchPanel =
    tableName === 'properties' ||
    (tableName === 'accounts' &&
      OWNER_RESEARCH_ACCOUNT_RECORD_TYPES.includes(
        picklists?.valueById?.get(record?.account_record_type),
      ))

  // In create mode the breadcrumb reads the prefilled parent FKs (and their
  // names resolved by createCrumbLookups) so it stays hierarchical; otherwise
  // it uses the loaded record and its lookups.
  const crumbRecord = isCreate ? { ...record, ...(prefill || {}) } : record
  const crumbLookups = isCreate ? createCrumbLookups : lookups
  // Parent chain for objects TABLE_META doesn't declare one for — read off the
  // page layout so every object shows its hierarchy, not just the listed ones.
  const derivedParentFks = TABLE_META[tableName]?.parents?.length
    ? null
    : deriveParentFksFromSections(sections)

  // Build the ordered tab list from the loaded sections. Details first,
  // Related second (if any section has related_list widgets), Activity third
  // (not on new records — nothing to show yet), alphabetical after.
  const orderedTabs = buildOrderedTabs(sections, { includeActivity: !isInsertMode })

  const objectLabel = TABLE_META[tableName]?.label || humanizeObjectLabel(tableName)
  // Header values driven from TABLE_META so adding a new object only requires
  // one row of metadata. Previously these were 9-fallback `||` chains that
  // grew with every new table — the envelope page rendered "Record" + a
  // partial UUID because env_name / env_record_number weren't on the chain.
  // Uses the module-level singularizeLabel helper so "Properties" -> "Property"
  // and "Opportunities" -> "Opportunity" instead of the naïve "Propertie".
  const displayName = isCreate
    ? `New ${singularizeLabel(objectLabel)}`
    : getRecordDisplayName(tableName, record)

  const recordNumber = !isCreate ? getRecordNumber(tableName, record) : ''

  const statusColumn = TABLE_META[tableName]?.statusColumn || null
  const statusRaw = statusColumn ? record[statusColumn] : null
  const statusLabel = statusRaw ? (picklists.byId.get(statusRaw) || statusRaw) : null

  // Record-type visual identity (Salesforce-style icon badge). The record type
  // lives in `{prefix}_record_type` as a uuid FK into picklist_values; its
  // icon/color ride along in picklists.metaById. When the record has no record
  // type (or the object has none), the badge falls back to the object default.
  // In create mode the picker may have seeded a record type into the draft.
  const recordTypeColumn = getRecordTypeColumn(tableName)
  const recordTypeId = recordTypeColumn ? record[recordTypeColumn] : null
  const recordTypeMeta = recordTypeId ? (picklists.metaById?.get(recordTypeId) || null) : null
  const recordTypeLabel = recordTypeMeta?.label || (recordTypeId ? picklists.byId.get(recordTypeId) : null) || null
  // The record type's stored VALUE ('MULTIFAMILY-ENERGY-ASSESSMENT'), as
  // distinct from its display label ('Multifamily Energy Assessment'). Action
  // guards that key off configuration must use the value — a label is prose
  // and an admin may rename it.
  const recordTypeValue = recordTypeMeta?.value
    || (recordTypeId ? picklists.valueById?.get(recordTypeId) : null) || null

  // Income Qualification is a record-type-scoped, run-once enrollment step.
  // The record type carries the flag (the six IRA programs, not the HOMES
  // Assessment / Project-Reservation enrollment stages); the run persists
  // enrollment_determination_date, so once set it never runs again.
  const recordTypeRequiresIncomeQualification =
    tableName === 'enrollments' && recordTypeMeta?.incomeQualification === true
  const incomeQualificationComplete = !!record.enrollment_determination_date

  // ── CREATE = POP-UP MODAL, REQUIRED FIELDS ONLY ───────────────────────────
  // Every manual New in LEAP lands here: the related-list New button, a list
  // view's New, a Setup object's New, a /<table>/new link. Whatever the object,
  // record type, or page layout, the user gets the same small pop-up asking for
  // the required fields, and lands on the full record page once it's created.
  //
  // This is presentation only — the create engine underneath is unchanged, so
  // the parent-chain prefill, record-type picker, dependent lookups, per-table
  // create defaults, duplicate soft gate, and the insert path all behave exactly
  // as they did on the old full-page create form.
  if (isCreate) {
    const createRtId = recordTypeColumn ? (draft[recordTypeColumn] || null) : null
    const createRtLabel = createRtId
      ? (picklists.metaById?.get(createRtId)?.label || picklists.byId.get(createRtId) || null)
      : null
    const { groups: createGroups } =
      buildCreateModalGroups(sections, {
        requiredFields, showAll: showAllCreateFields, neverAsk: createNeverAskColumns(tableName),
      })
    if (createExtraFields.length) {
      createGroups.push({ key: '__required_not_on_layout__', title: '', fields: createExtraFields })
    }
    const createPicklistOpts = createExtraFields.length
      ? { ...allPicklistOpts, ...createExtraPicklistOpts }
      : allPicklistOpts
    const createFieldCount = createGroups.reduce((n, g) => n + g.fields.length, 0)
    // What this record is being created ON — the parent names already resolved
    // for the breadcrumb (e.g. the property a building is being added to).
    const parentContext = Array.from(createCrumbLookups.values())
      .map(v => v?.label).filter(Boolean)
    // Display names for parent ids: the breadcrumb's resolved parents plus the
    // locked parent columns, in the { label, table } shape formatFieldValue
    // expects, so a read-only lookup shows a name rather than a uuid.
    const createLookupLabels = (createCrumbLookups.size || createLockedLabels.size)
      ? new Map([...createCrumbLookups, ...createLockedLabels])
      : lookups

    const modalFieldGroup = (g) => (
      <div key={g.key} style={{ marginBottom: 12 }}>
        {g.title && createGroups.length > 1 && (
          <div style={{
            padding: '4px 16px 6px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: C.textMuted,
          }}>{g.title}</div>
        )}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <FieldGroupWidget
            widget={{ widget_config: { fields: g.fields.map(f => (
              // The record this one is being created from is context, not a
              // choice — render it read-only.
              lockedCreateFields.has(f.name) ? { ...f, _editable: false } : f
            )) } }}
            record={record}
            picklists={picklists}
            lookups={createLookupLabels}
            editing
            draft={draft}
            onChange={handleFieldChange}
            allPicklistOpts={createPicklistOpts}
            allLookupOpts={allLookupOpts}
            onRefreshRecord={() => setReloadTick(t => t + 1)}
            recordId={null}
            fieldDisabledReasons={null}
            onNavigateToRecord={onNavigateToRecord}
            requiredFields={requiredFields}
            tableName={tableName}
            createRelatedValues={createRelatedValues}
          />
        </div>
      </div>
    )

    return createPortal(
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onBack() }}
        style={{
          position: 'fixed', inset: 0, zIndex: 180, background: 'rgba(7,17,31,0.45)',
          display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center',
          padding: isMobile ? 0 : 16,
        }}
      >
        <div style={{
          background: C.card, borderRadius: isMobile ? 0 : 10,
          width: isMobile ? '100%' : 'min(760px, 100%)',
          maxHeight: isMobile ? '100%' : '88vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 70px rgba(7,17,31,0.32)',
        }}>
          {/* Header — what's being created, its record type, and the parent
              record it's being created on. */}
          <div style={{
            padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'flex-start', gap: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
                New {singularizeLabel(objectLabel)}
              </div>
              <div style={{ marginTop: 3, fontSize: 12, color: C.textSecondary, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {createRtLabel && (
                  <span style={{
                    background: '#eef4fb', color: '#1a5a8a', borderRadius: 4,
                    padding: '1px 7px', fontSize: 11, fontWeight: 600,
                  }}>{createRtLabel}</span>
                )}
                {parentContext.length > 0 && <span>on {parentContext.join(' · ')}</span>}
              </div>
            </div>
            <button
              onClick={() => { if (!saving) onBack() }}
              aria-label="Close"
              style={{
                background: 'transparent', border: 'none', cursor: saving ? 'wait' : 'pointer',
                color: C.textMuted, fontSize: 18, lineHeight: 1, padding: 2,
              }}
            >×</button>
          </div>

          {/* Body — required fields only (or everything, when expanded). */}
          <div style={{ flex: 1, overflow: 'auto', padding: '14px 6px 4px', background: C.page }}>
            {createFieldCount === 0 ? (
              <div style={{ padding: '18px 16px', fontSize: 13, color: C.textSecondary, textAlign: 'center' }}>
                {showAllCreateFields
                  ? 'This layout has no editable fields. Save to create the record.'
                  : 'Nothing is required to create this record. Save to create it, then fill in the details on the record page.'}
              </div>
            ) : createGroups.map(modalFieldGroup)}
            <div style={{ padding: '0 10px' }}>
              <DuplicateCheckPanel
                tableName={tableName}
                matches={dupMatches}
                confirming={dupAcknowledged}
                onNavigateToRecord={onNavigateToRecord}
              />
            </div>
            <div style={{ padding: '2px 16px 10px' }}>
              <button
                type="button"
                onClick={() => setShowAllCreateFields(v => !v)}
                style={{
                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  color: '#1a5a8a', fontSize: 12, fontWeight: 500,
                }}
              >
                {showAllCreateFields ? 'Show required fields only' : 'Show all fields'}
              </button>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 16px', borderTop: `1px solid ${C.border}`, background: '#fafbfd',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
            paddingBottom: isMobile ? 'calc(10px + env(safe-area-inset-bottom))' : 10,
          }}>
            <button
              onClick={() => { if (!saving) onBack() }}
              disabled={saving}
              style={{
                background: C.card, color: C.textPrimary, border: `1px solid ${C.border}`,
                borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 500,
                cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: C.emerald, color: '#fff', border: 'none', borderRadius: 6,
                padding: '7px 18px', fontSize: 13, fontWeight: 600,
                cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
              }}
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  if (!layout) return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      padding: isMobile ? '12px' : '20px 24px',
      paddingBottom: isMobile ? 'calc(12px + env(safe-area-inset-bottom))' : '20px',
    }}>
      {!isMobile && <Breadcrumbs tableName={tableName} record={crumbRecord} lookups={crumbLookups} derivedParents={derivedParentFks} onBack={onBack} onNavigateToRecord={onNavigateToRecord} />}
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

  // ── Topbar action context — shared between mobile and desktop renders ──
  // The registry in recordActions.js evaluates `isAvailable(ctx)` against
  // this shape to decide which actions are eligible for the current record
  // state. Anything that's not in the registry stays as bespoke UI further
  // down (Save / Cancel during edit mode).
  const topbarActionCtx = {
    tableName,
    record:               data?.record || {},
    editing,
    statusLabel,
    lifecycle,
    lifecycleStatusValue,
    lifecycleIsLocked,
    hasActiveTemplate,
    envelopeIsResendable,
    envelopeIsVoidable,
    hasRelatedObject:     !!data?.record?.related_object,
    recordTypeRequiresIncomeQualification,
    incomeQualificationComplete,
    recordTypeLabel,
    recordTypeValue,
    recordIsLocked:       recordLockedForUser,
    isSystemAdmin,
  }

  const topbarActionHandlers = {
    [ACTION_KEYS.EDIT]:                   startEditing,
    [ACTION_KEYS.CLONE]:                  handleClone,
    [ACTION_KEYS.ADVANCE_TO_OPPORTUNITY]: handleAdvanceToOpportunity,
    [ACTION_KEYS.RUN_INCOME_QUALIFICATION]: handleRunIncomeQualification,
    [ACTION_KEYS.VERIFY_FIELDS]:          handleVerifyFields,
    [ACTION_KEYS.DELETE]:                 () => setShowDeleteConfirm(true),
    // Open the portal in a new tab so the admin keeps the record they came
    // from. The URL is only a request — the portal RPCs re-check app_is_admin().
    [ACTION_KEYS.VIEW_OWNER_PORTAL]:
      () => window.open(`/project-portal?account=${recordId}`, '_blank', 'noopener'),
    // Which portal to open depends on what kind of portal user this is — a
    // program manager's records do not live in the owner portal.
    [ACTION_KEYS.VIEW_AS_PORTAL_USER]: () => {
      const surface = data?.record?.record_type === 'Program Manager User'
        ? 'program-portal' : 'project-portal'
      window.open(`/${surface}?as=${recordId}`, '_blank', 'noopener')
    },
    [ACTION_KEYS.MANAGE_SHARED_RECORDS]: () => setShowSharedRecords(true),
    [ACTION_KEYS.GENERATE_REPORT]:        () => setShowReportModal(true),
    [ACTION_KEYS.GENERATE_PROJECT_RESERVATION_SUBMITTAL]:
      () => setSubmittalStage(SUBMITTAL_STAGES.PROJECT_RESERVATION),
    [ACTION_KEYS.GENERATE_FINAL_PAYMENT_REQUEST_SUBMITTAL]:
      () => setSubmittalStage(SUBMITTAL_STAGES.FINAL_PROJECT_PAYMENT_REQUEST),
    [ACTION_KEYS.EDIT_SUBMITTAL_TEMPLATE]: () => setShowSubmittalEditor(true),
    [ACTION_KEYS.GENERATE_QUALITY_INSTALL_TOOL]: () => setShowQiToolModal(true),
    [ACTION_KEYS.GENERATE_ENERGY_ASSESSMENT_REPORT]: () => setShowAssessmentReportModal(true),
    [ACTION_KEYS.GENERATE_SUBMITTED_ENROLLMENT]:        () => setShowSubmittedEnrollmentModal(true),
    [ACTION_KEYS.GENERATE_HOMES_PROPOSAL]:             () => setShowHomesProposalModal(true),
    [ACTION_KEYS.GENERATE_PREAPPROVAL_APPLICATION]: handleOpenPreapprovalForm,
    [ACTION_KEYS.GENERATE_ASSESSMENT_APPLICATION]: handleOpenAssessmentApplication,
    [ACTION_KEYS.GENERATE_PAYMENT_REQUEST_APPLICATION]: handleOpenPaymentRequestForm,
    [ACTION_KEYS.SCHEDULE_WORK_ORDERS]:   () => setShowSchedulerWizard(true),
    [ACTION_KEYS.RESCHEDULE_WORK_ORDERS]: () => setShowRescheduleWizard(true),
    [ACTION_KEYS.SCHEDULE_WORK_ORDER]:    () => setShowWoSchedule(true),
    [ACTION_KEYS.ISSUE_TO_PROVIDER]:      () => setShowIssueProvider(true),
    [ACTION_KEYS.RESCHEDULE_APPOINTMENT]: () => setShowSaReschedule(true),
    [ACTION_KEYS.SEND_FOR_SIGNATURE]:     () => setShowSendSignatureModal(true),
    [ACTION_KEYS.RESEND_SIGNING_EMAIL]:   handleResendEnvelope,
    [ACTION_KEYS.VOID_ENVELOPE]:          handleVoidEnvelope,
    [ACTION_KEYS.PREVIEW_PDF]:            handlePreviewPdf,
    [ACTION_KEYS.PREVIEW_DOCUMENT]:       openDocPreview,
    [ACTION_KEYS.PREVIEW_EMAIL]:          openEmailPreview,
    [ACTION_KEYS.CLONE_TEMPLATE]:         handleCloneTemplate,
    [ACTION_KEYS.PUBLISH]:                handlePublish,
    [ACTION_KEYS.UNPUBLISH]:              handleUnpublish,
    [ACTION_KEYS.ARCHIVE]:                handleArchive,
    [ACTION_KEYS.RESTORE]:                handleRestore,
    [ACTION_KEYS.MERGE_ACCOUNT]:          () => setShowMergeModal(true),
    [ACTION_KEYS.ADD_TO_PORTAL]:          () => setShowPortalModal(true),
    [ACTION_KEYS.LOG_ACTIVITY]:           () => setShowLogCall(true),
  }

  // Per-action pending flag — drives the disabled+wait-cursor+ellipsis label
  // on the TopbarActions buttons. Mirrors the prior inline `disabled={…}`
  // gates so the runtime feel matches.
  const topbarPendingByKey = {
    [ACTION_KEYS.RUN_INCOME_QUALIFICATION]: runningIncomeQual,
    [ACTION_KEYS.GENERATE_PREAPPROVAL_APPLICATION]: openingPreapproval,
    [ACTION_KEYS.GENERATE_ASSESSMENT_APPLICATION]: openingApplication,
    [ACTION_KEYS.GENERATE_PAYMENT_REQUEST_APPLICATION]: openingPaymentRequest,
    [ACTION_KEYS.RESEND_SIGNING_EMAIL]: envelopeBusy,
    [ACTION_KEYS.VOID_ENVELOPE]:        envelopeBusy,
    [ACTION_KEYS.PREVIEW_PDF]:          previewingPdf,
    [ACTION_KEYS.PREVIEW_DOCUMENT]:     docPreviewOpen || docPreviewRendering,
    [ACTION_KEYS.PREVIEW_EMAIL]:        emailPreviewOpen || emailPreviewRendering,
    [ACTION_KEYS.CLONE_TEMPLATE]:       cloningTemplate,
    [ACTION_KEYS.PUBLISH]:              statusChanging,
    [ACTION_KEYS.UNPUBLISH]:            statusChanging,
    [ACTION_KEYS.ARCHIVE]:              statusChanging,
    [ACTION_KEYS.RESTORE]:              statusChanging,
  }

  // ── One card renderer, for every surface ───────────────────────────────────
  // A card renders identically wherever its section is placed — in the main
  // flow on a tab, or in the always-visible right rail. Before 2026-08-27 the
  // two surfaces each had their own copy of this dispatch, and they had already
  // drifted: the rail drew no work plan and no publish history at all, and its
  // related lists carried neither the template lifecycle lock nor the refresh
  // callback. So "put this card in the sidebar too" could quietly change what
  // the card did. One function, called from both, is what makes placement a
  // placement rather than a different card.
  //
  // `claimedTypes` is surface-scoped: a catch-all documents gallery leaves out
  // the files that a document SLOT on the same screen already lists, so nothing
  // appears twice on one tab — but a slot on the Details tab does not empty the
  // Documents card on the Related tab.
  const renderRecordCard = (w, claimedTypes) => {
    if (w.widget_type === 'related_list') {
      // Opportunity line items render as the Salesforce-style inline-editable
      // Opportunity Products table instead of the read-only related list,
      // wherever that list is placed.
      if (w.widget_config?.table === 'opportunity_line_items' && tableName === 'opportunities') {
        return (
          <OpportunityProductsWidget
            key={w.id}
            widget={w}
            opportunityId={recordId}
            onNavigateToRecord={onNavigateToRecord}
          />
        )
      }
      // Lock child related_lists when the parent template is Active or
      // Archived. We match the widget's table against the lifecycle's
      // childrenTable (e.g. project_report_template_sections for PRT). Sibling
      // related_lists stay editable. We force editable=false on the widget copy
      // so the Add button + drag handles + remove buttons all disappear; the
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
          parentTable={tableName}
          parentRecord={data?.record}
          parentRecordName={displayName}
          onRefreshRelated={async () => {
            try {
              const rows = await fetchRelatedRecords(w.widget_config, recordId)
              // Mutate the widget's cached data in place, then nudge React with
              // a top-level data clone so the widget re-reads.
              w._relatedData = rows
              setData(prev => ({ ...prev }))
            } catch (err) {
              // Non-fatal — widget keeps its previous rows.
              // eslint-disable-next-line no-console
              console.error('Related list refresh failed', err)
            }
          }}
        />
      )
    }
    if (w.widget_type === 'file_gallery') {
      return <FileGalleryWidget key={w.id} widget={w} parentTable={tableName} parentRecordId={recordId}
                claimedSlotTypes={claimedTypes} />
    }
    if (w.widget_type === 'work_plan') {
      return (
        <WorkPlanCard
          key={w.id}
          widget={w}
          workOrderId={recordId}
          onChanged={() => setReloadTick(t => t + 1)}
        />
      )
    }
    if (w.widget_type === 'conversation_panel') {
      return <ConversationPanelWidget key={w.id} widget={w} parentRecordId={recordId} parentTable={tableName} />
    }
    if (w.widget_type === 'conversation_messages') {
      return <ConversationMessagesWidget key={w.id} widget={w} parentRecordId={recordId} />
    }
    if (w.widget_type === 'conversation_list') {
      return <ConversationListWidget key={w.id} widget={w} parentRecordId={recordId} />
    }
    if (w.widget_type === 'prtsn_history') {
      return <PrtsnHistoryWidget key={w.id} widget={w} parentRecordId={recordId} />
    }
    if (w.widget_type === 'report') {
      return <ReportWidget key={w.id} widget={w} parentTable={tableName} parentRecordId={recordId} onOpenRecord={onNavigateToRecord} />
    }
    return null
  }

  // The document types claimed by slots that render on the surface a given
  // card sits on: this tab's own sections, plus the right rail, which is
  // visible on every tab.
  // Every document type a file-gallery SLOT claims on the surface a card sits
  // on: this tab's own sections plus the right rail, which is visible on every
  // tab. A catch-all gallery leaves those files to their own slot so nothing is
  // listed twice on one screen — but a slot on the Details tab no longer empties
  // the Documents card on the Related tab (Nicholas, 2026-08-27: "I still need
  // to be able to download these and upload more documents outside of this in
  // the regular documents tab related list section"). Scoping this per LAYOUT,
  // as it was, made the two mutually exclusive.
  // The main flow shows the active tab; the rail shows on every tab, so both
  // see the same set — the tab being viewed, plus the rail itself.
  const mainClaimedSlotTypes = slotTypesOnSurface(data?.sections, activeTab)
  const railClaimedSlotTypes = mainClaimedSlotTypes

  // The record header's action cluster, defined once: the pinned band renders
  // it in the full card and again in the condensed line, and two hand-written
  // copies of Save/Cancel/Actions is two chances for one of them to drift.
  const headerActionCluster = editing ? (
    <>
      <button onClick={handleSave} disabled={saving} style={{ background: C.emerald, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12.5, fontWeight: 500, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon path="M5 13l4 4L19 7" size={13} color="#fff" />{saving ? 'Saving…' : 'Save'}
      </button>
      <button onClick={cancelEditing} disabled={saving} style={{ background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
    </>
  ) : (
    <TopbarActions
      variant="desktop"
      tableName={tableName}
      record={data?.record}
      ctx={topbarActionCtx}
      actionOverrides={data?.actionOverrides || []}
      handlers={topbarActionHandlers}
      pendingByKey={topbarPendingByKey}
    />
  )

  return (
    <div style={{
      flex: 1,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
    }}>
      {/* A soft-deleted record renders in full — a recycle bin exists so the
          record can still be read — but it says what it is, on every object.
          Self-suppresses on a live record. `accounts` never reaches here: a
          merged-away account returns its own notice above. */}
      {!isCreate && (
        <DeletedRecordBanner
          tableName={tableName}
          recordId={recordId}
          record={record}
          objectLabel={singularizeLabel(objectLabel)}
          onRestored={() => setReloadTick(t => t + 1)}
        />
      )}

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

          <RecordVisualBadge
            tableName={tableName}
            recordTypeMeta={recordTypeMeta}
            size={28}
            title={recordTypeLabel ? `${singularizeLabel(objectLabel)} · ${recordTypeLabel}` : singularizeLabel(objectLabel)}
            style={{ flexShrink: 0 }}
          />

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0 }}>
            <div style={{ fontSize: 10.5, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {[recordTypeLabel || singularizeLabel(objectLabel), recordNumber && (editing && cloneSource ? `Cloning ${recordNumber}` : editing ? `Editing ${recordNumber}` : recordNumber)].filter(Boolean).join(' · ')}
            </div>
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
              <TopbarActions
                variant="mobile"
                tableName={tableName}
                record={data?.record}
                ctx={topbarActionCtx}
                actionOverrides={data?.actionOverrides || []}
                handlers={topbarActionHandlers}
                pendingByKey={topbarPendingByKey}
              />
            )}
          </div>
        </div>
      )}

      {/* Scrollable content region.
          On desktop the record's identity and its action buttons ride at the
          top of it in a PINNED band (src/lib/stickyRecordHeader.js) — scrolling
          a long record used to leave the user with a page of fields and no way
          to tell which record they were on or to reach Save (Nicholas,
          2026-08-29). onScroll is what tells the band when to condense; mobile
          has its own fixed header bar above this region and needs neither. */}
      <div
        onScroll={isMobile ? undefined : handleContentScroll}
        style={{
          flex: 1, overflow: 'auto', minHeight: 0,
          padding: isMobile ? '10px 10px' : '20px 24px',
          paddingBottom: isMobile && editing ? 'calc(80px + env(safe-area-inset-bottom))' : isMobile ? 'calc(24px + env(safe-area-inset-bottom))' : undefined,
        }}>
        {/* Pinned header band (desktop) — the breadcrumb trail and the header
            card, held at the top of the scroll region. Mobile is unchanged: it
            already carries this information in the fixed bar above, and its own
            actions sit in that bar and in the sticky bottom edit bar. */}
        {!isMobile && (
          <div
            ref={setHeaderBandEl}
            style={stickyHeaderBandStyle({ padX: 24, padY: 20, condensed: headerCondensed })}
          >
            <Breadcrumbs tableName={tableName} record={crumbRecord} lookups={crumbLookups} derivedParents={derivedParentFks} onBack={onBack} onNavigateToRecord={onNavigateToRecord} compact={headerCondensed} />

            {headerCondensed ? (
              /* Condensed header — one line, so the pinned band costs as little
                 of the screen as it can while still answering "what am I looking
                 at, what state is it in, and what can I do to it". The action
                 cluster is the SAME cluster the full card renders, not a second
                 set of controls that could drift from it. */
              <div style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <RecordVisualBadge
                  tableName={tableName}
                  recordTypeMeta={recordTypeMeta}
                  size={26}
                  title={recordTypeLabel ? `${singularizeLabel(objectLabel)} · ${recordTypeLabel}` : singularizeLabel(objectLabel)}
                  style={{ flexShrink: 0 }}
                />
                {/* The name truncates rather than wrapping — a wrapped name here
                    would change the band's height mid-scroll, which is the one
                    thing a pinned band must not do. The full name stays
                    available on hover and in the expanded card. */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span title={displayName} style={{
                    fontSize: 15, fontWeight: 700, color: C.textPrimary,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{displayName}</span>
                  {recordNumber && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted, flexShrink: 0 }}>{recordNumber}</span>}
                </div>
                {statusLabel && <span style={{ flexShrink: 0 }}><Badge s={statusLabel} /></span>}
                {statusLocksRecord && (
                  <span title={isSystemAdmin
                    ? 'This record is locked. As a System Administrator you can still edit it.'
                    : 'This record is locked. Only a System Administrator can edit it.'}
                    style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                      background: '#eef5fc', border: `1px solid #bcd9f2`,
                      borderRadius: 4, padding: '3px 6px' }}>
                    <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" size={12} color="#1a5a8a" />
                  </span>
                )}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {headerActionCluster}
                </div>
              </div>
            ) : (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '20px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0 }}>
                  <RecordVisualBadge
                    tableName={tableName}
                    recordTypeMeta={recordTypeMeta}
                    size={40}
                    title={recordTypeLabel ? `${singularizeLabel(objectLabel)} · ${recordTypeLabel}` : singularizeLabel(objectLabel)}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{singularizeLabel(objectLabel)}</span>
                      {recordTypeLabel && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, background: C.page, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 7px' }}>
                          {recordTypeLabel}
                        </span>
                      )}
                      {recordNumber && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted }}>{recordNumber}</span>}
                    </div>
                    {/* Long record names must wrap, not widen the row: a work order
                        name composed from project + unit + work type can run past
                        100 characters, which pushed the action buttons off the card
                        (Nicholas, 2026-08-16). overflowWrap handles the pathological
                        case of a single unbroken token. */}
                    <h1 style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, margin: '0 0 8px', overflowWrap: 'anywhere' }}>{displayName}</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {statusLabel && <Badge s={statusLabel} />}
                      {statusLocksRecord && (
                        <span title={isSystemAdmin
                          ? 'This record is locked. As a System Administrator you can still edit it.'
                          : 'This record is locked. Only a System Administrator can edit it.'}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
                            background: '#eef5fc', border: `1px solid #bcd9f2`, color: '#1a5a8a',
                            borderRadius: 4, padding: '2px 9px', fontSize: 11.5, fontWeight: 600 }}>
                          <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" size={12} color="#1a5a8a" />
                          Locked{isSystemAdmin ? ' · admin can edit' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* flexShrink: 0 is what keeps this cluster on the card — without it
                    the buttons shrink below their content width and spill off the
                    right edge whenever the title is long. */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {headerActionCluster}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mobile status chip row — shown only when there's a status to display */}
        {isMobile && statusLabel && (
          <div style={{ marginBottom: 10 }}>
            <Badge s={statusLabel} />
          </div>
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

        {/* Create-time duplicate warning (accounts / properties / buildings) —
            rendered on desktop AND mobile: creating a duplicate from the field
            is exactly the case this exists to prevent. */}
        {isInsertMode && (
          <DuplicateCheckPanel
            tableName={tableName}
            matches={dupMatches}
            confirming={dupAcknowledged}
            onNavigateToRecord={onNavigateToRecord}
          />
        )}

        {/* Timestamps (view mode only, hidden on mobile to reduce clutter) */}
        {!editing && !isMobile && (
          <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 11, color: C.textMuted }}>
            {(record.created_at || record.contact_created_at || record.property_created_at || record.opportunity_created_at || record.work_order_created_at || record.project_created_at) && (
              <span>Created {new Date(record.created_at || record.contact_created_at || record.property_created_at || record.opportunity_created_at || record.work_order_created_at || record.project_created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            )}
          </div>
        )}

        {/* Status Path — Salesforce-style horizontal chevron strip showing
            the record's position in its lifecycle. Widget is registered as
            'status_path' and configured per page layout with widget_config.
            status_field naming which status column to render. Self-suppresses
            when the object has no lifecycle configured. Multiple status_path
            widgets per layout are supported (e.g. work_orders has both
            work_order_status and work_order_approval_status). */}
        {!isInsertMode && !editing && statusPathWidgets.map(w => (
          <StatusPathWidget
            key={w.id}
            widget={w}
            parentRecordId={recordId}
            tableName={tableName}
            record={record}
            onStatusChanged={() => setReloadTick(t => t + 1)}
          />
        ))}

        {/* Status transitions bar — surfaces outgoing transitions for the
            record's current status as one-click action buttons. Calls the
            change_record_status RPC, which validates the move server-side
            against status_transitions. Self-suppresses when the table has
            no lifecycle configured, when the record is in edit mode, or
            when the current status is terminal (no outgoing transitions).
            It also stands down for a field a status path above already
            renders — the path carries those same buttons in its own card,
            and two cards announcing one status read as a bug. */}
        <StatusTransitionsBar
          tableName={tableName}
          recordId={recordId}
          record={record}
          editing={editing}
          suppressForFields={statusPathFields}
          onStatusChanged={() => setReloadTick(t => t + 1)}
        />

        {/* Two-column body: main content (tab bar + tab content) on the left,
            right rail on the right. Right rail holds sections whose
            section_placement='right' — Salesforce Lightning utility-rail
            pattern. On narrow viewports (≤1024px) we collapse to a single
            column so the main field groups stay readable; right-rail
            sections appear underneath. */}
        <div style={{
          display: 'flex',
          flexDirection: isNarrow ? 'column' : 'row',
          alignItems: 'flex-start',
          gap: isNarrow ? 16 : 20,
        }}>
          <div style={{ flex: 1, minWidth: 0, width: isNarrow ? '100%' : 'auto' }}>

        {/* Tab bar — only shown when there's more than one tab. Styled to
            match SectionTabs in UI.jsx: bottom border, 2px emerald underline
            on the active tab. On mobile, horizontally scrolls with snap. */}
        {orderedTabs.length > 1 && (
          <div style={isMobile
            ? { marginBottom: 10 }
            /* Desktop: the tab bar pins directly under the header band, at the
               band's MEASURED height — which record page you are on and which
               tab of it are the same question, so they stay together. */
            : stickyTabBarStyle({ bandHeight: headerBandHeight, padY: 20, gap: 16 })}>
          <div
            className={isMobile ? 'ees-hscroll' : ''}
            style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: isMobile ? '0 4px' : '0 16px',
              display: 'flex', alignItems: 'center',
              ...(isMobile ? { scrollSnapType: 'x proximity' } : {}),
            }}
          >
            {orderedTabs.map(t => {
              const on = t === activeTab
              return (
                <button
                  key={t}
                  onClick={() => selectTab(t)}
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
          </div>
        )}

        {/* Locked-state banner — shown above sections for Active/Archived
            templates of any lifecycle-bearing type (PRT / ET / DT).
            Communicates why fields are read-only and points the user to the
            right path forward. */}
        {lifecycleIsLocked && (
          <div style={{
            background: lifecycleStatusValue === 'Archived' ? '#f3f4f6' : '#eef5fc',
            border: `1px solid ${lifecycleStatusValue === 'Archived' ? '#d1d5db' : '#bcd9f2'}`,
            borderLeftWidth: 4,
            borderLeftColor: lifecycleStatusValue === 'Archived' ? '#6b7280' : '#1e466b',
            borderRadius: 8, padding: '12px 16px', marginBottom: 14,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <Icon
              path={lifecycleStatusValue === 'Archived'
                ? 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4'
                : 'M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0L3.34 16a2 2 0 001.73 3z'}
              size={16}
              color={lifecycleStatusValue === 'Archived' ? '#4b5563' : '#1e466b'}
            />
            <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, color: lifecycleStatusValue === 'Archived' ? '#374151' : '#1e466b' }}>
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

        {/* Sections — filtered to the active tab, rendered IN ORDER, each as
            its shell (fields and other in-section widgets) followed by its
            card widgets (related lists, file galleries, conversation panels,
            publish history, embedded reports) in widget order. Sections
            behave identically on every tab — a card renders wherever its
            section is placed, never force-moved to the Related tab
            (Nicholas, 2026-07-26). Cards are hidden in insert mode (the
            record doesn't exist yet). For document_templates we also skip
            the Document Content section when authoring mode is "docx" (the
            body_html field is irrelevant in that mode — the .docx asset
            replaces it). Right-rail sections (section_placement='right')
            are excluded here — they render in the always-visible right
            column below. */}
        {sections
          .filter(sec => (sec.section_placement || 'main') === 'main')
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
            const cards = isInsertMode ? [] : (sec.widgets || []).filter(w => CARD_WIDGET_TYPES.has(w.widget_type))
            return (
              <div key={sec.id}>
                <Section section={sec} record={record} picklists={picklists} lookups={lookups}
                  editing={editing} draft={draft} onChange={handleFieldChange}
                  allPicklistOpts={allPicklistOpts} allLookupOpts={allLookupOpts} tableName={tableName}
                  onRefreshRecord={() => setReloadTick(t => t + 1)} recordId={recordId}
                  fieldDisabledReasons={fieldDisabledReasons} hiddenWidgetTypes={hiddenWidgetTypes}
                  onNavigateToRecord={onNavigateToRecord}
                  requiredFields={requiredFields} activeTab={activeTab}
                  createRelatedValues={createRelatedValues} />
                {cards.map(w => renderRecordCard(w, mainClaimedSlotTypes))}
              </div>
            )
          })}

        {/* Income Qualification — runs the multifamily HUD categorical
            qualification tool against this enrollment: classifies the
            enrollment (own fields, property HUD fallback), generates the IRA
            application PDF and tenant data XLSX, saves both to the record, and
            writes the determination back onto the enrollment. Only on
            income-qualification enrollment record types (the six IRA programs),
            Related tab. Once run, the panel shows the determination read-only
            and offers no re-run. */}
        {!isInsertMode && activeTab === 'Related' && recordTypeRequiresIncomeQualification && (
          <IncomeQualificationPanel enrollmentId={recordId} alreadyRun={incomeQualificationComplete} />
        )}

        {/* Property Owner Research — finds the decision makers (CEO, asset
            manager, facilities director — not site property-management staff)
            behind this owner-group account or property. Tiered by cost: free
            AI web research → Lusha prospecting search (no credits) →
            per-person contact reveal (paid credits). Candidates promote to
            real Contacts. Only on properties and Property Owner /
            Property Management Company accounts, Related tab. */}
        {!isInsertMode && activeTab === 'Related' && showOwnerResearchPanel && (
          <PropertyOwnerResearchPanel tableName={tableName} recordId={recordId} />
        )}

        {/* Activity Timeline — chronological audit trail of tracked field
            changes and record-level actions (create, soft-delete, restore).
            Hidden on new records since there's no history yet. */}
        {!isInsertMode && activeTab === 'Activity' && (
          <ActivityTimeline key={activityRefreshKey} tableName={tableName} recordId={recordId} />
        )}
          </div>

          {/* Right rail — always-visible utility column. Holds sections with
              section_placement='right' regardless of active tab. Width is
              fixed on desktop (320px) and full-width on narrow viewports
              where the column has collapsed to a stacked layout. Sections
              here support the same widget types as the main flow
              (field_group, related_list, conversation_panel, file_gallery,
              report, prtsn_history) — admins place whatever they want via
              the page layout editor. Hidden on insert mode since the right
              rail's widgets typically don't make sense for a record that
              doesn't exist yet. */}
          {!isInsertMode && sections.some(sec => (sec.section_placement || 'main') === 'right') && (
            <div style={{
              width: isNarrow ? '100%' : 480,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}>
              {sections
                .filter(sec => (sec.section_placement || 'main') === 'right')
                .map(sec => {
                  // Field groups inside right-rail sections render via the
                  // same Section component as the main flow — works fine in
                  // a narrow column, fields stack vertically because
                  // section_columns is honored by Section but field rows
                  // collapse below the column width.
                  const hasFieldGroup = (sec.widgets || []).some(w => w.widget_type === 'field_group')
                  return (
                    <div key={sec.id}>
                      {hasFieldGroup && (
                        <Section
                          section={sec}
                          record={record}
                          picklists={picklists}
                          lookups={lookups}
                          editing={editing}
                          draft={draft}
                          onChange={handleFieldChange}
                          allPicklistOpts={allPicklistOpts}
                          allLookupOpts={allLookupOpts}
                          tableName={tableName}
                          onRefreshRecord={() => setReloadTick(t => t + 1)}
                          recordId={recordId}
                          onNavigateToRecord={onNavigateToRecord}
                          requiredFields={requiredFields}
                        />
                      )}
                      {(sec.widgets || [])
                        .filter(w => CARD_WIDGET_TYPES.has(w.widget_type))
                        .map(w => renderRecordCard(w, railClaimedSlotTypes))}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
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

      {/* Pre-approval completion check — when Open Pre-Approval Application is
          clicked but required fields (resolved from this enrollment and its
          parent records) are still blank, list them and block opening the form
          until they're filled. Documentation-first: this only gates the
          external submission, never the record itself. */}
      {preapprovalMissing && preapprovalMissing.length > 0 && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,26,46,0.48)', zIndex: 1100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setPreapprovalMissing(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.card, borderRadius: 10,
            border: `1px solid ${C.border}`, width: 'min(520px, 96vw)', maxHeight: '85vh',
            overflow: 'auto', boxShadow: '0 12px 40px rgba(7,17,31,0.28)' }}>
            <div style={{ padding: '18px 20px 12px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon path="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  size={20} color={C.sky} />
                <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>
                  Complete these fields before submitting
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
                The Focus On Energy form can't be submitted until every required field has a
                value. These are still blank on this record (or on the property, building and
                contractor records they're inherited from):
              </div>
            </div>
            <div style={{ padding: '12px 20px' }}>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {preapprovalMissing.map((label, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: C.textPrimary }}>{label}</li>
                ))}
              </ul>
            </div>
            <div style={{ padding: '12px 20px 18px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setPreapprovalMissing(null)} style={{ background: C.emerald,
                color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13,
                fontWeight: 600, cursor: 'pointer' }}>
                Got it
              </button>
            </div>
          </div>
        </div>
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

      {/* Document template preview — pick a parent record (e.g. a Project)
          to merge against, then render the resulting PDF in a new tab via
          render-document-template-pdf. No documents row, no envelopes row,
          no storage upload — just a quick visual check for authors. */}
      {docPreviewOpen && tableName === 'document_templates' && (
        <DocumentTemplatePreviewModal
          templateName={data?.record?.name || 'Untitled Template'}
          relatedObject={data?.record?.related_object || ''}
          options={docPreviewParentOptions}
          loadingOptions={docPreviewLoadingOpts}
          selected={docPreviewParentRecord}
          onSelectedChange={setDocPreviewParentRecord}
          overlay={docPreviewOverlay}
          onOverlayChange={setDocPreviewOverlay}
          rendering={docPreviewRendering}
          onCancel={closeDocPreview}
          onGenerate={generateDocPreview}
        />
      )}

      {/* Email template preview — same parent picker, plus an inline iframe
          showing the rendered HTML body. No external tab; the modal grows
          to accommodate the result so authors can compare merge fields
          against what they expected. */}
      {emailPreviewOpen && tableName === 'email_templates' && (
        <EmailTemplatePreviewModal
          templateName={data?.record?.name || 'Untitled Template'}
          relatedObject={data?.record?.related_object || ''}
          options={emailPreviewParentOptions}
          loadingOptions={emailPreviewLoadingOpts}
          selected={emailPreviewParentRecord}
          onSelectedChange={setEmailPreviewParentRecord}
          rendering={emailPreviewRendering}
          result={emailPreviewResult}
          onCancel={closeEmailPreview}
          onGenerate={generateEmailPreview}
          onClearResult={() => setEmailPreviewResult(null)}
        />
      )}

      {/* Lazy-loaded modals. Each only mounts when its trigger state
          flips true; Suspense provides a null fallback during the
          ~50-200ms chunk download. We use null rather than a spinner
          because these modals overlay the page — a flashing spinner
          looks worse than the brief delay before the modal appears. */}
      <Suspense fallback={null}>
        {/* Project report generator (only mounted on projects, opt-in via toolbar button) */}
        {showReportModal && tableName === 'projects' && (
          <ProjectReportModal
            projectId={recordId}
            project={record}
            onClose={() => setShowReportModal(false)}
            onComplete={() => { setReloadTick(t => t + 1) }}
          />
        )}

        {/* Program submittal documents (projects only). One modal, scoped to
            the requested submittal stage — Project Reservation and Final
            Project Payment Request are separate filings, months apart. */}
        {submittalStage && tableName === 'projects' && (
          <ProjectSubmittalDocumentsModal
            projectId={recordId}
            project={record}
            submittalStage={submittalStage}
            onClose={() => setSubmittalStage(null)}
          />
        )}

        {/* Quality Install (QI) Tool — on the WI-IRA-MF-HOMES Final Project Payment
            Request incentive application. Picks photos from the opportunity's work
            orders, categorizes, and exports the ZIP + PDF (PDF → qi_tool_pdf doc). */}
        {showQiToolModal && tableName === 'incentive_applications' && (
          <QualityInstallPhotoPickerModal
            incentiveApplicationId={recordId}
            incentiveApplication={record}
            onClose={() => setShowQiToolModal(false)}
          />
        )}

        {/* Energy Assessment Report — the audit's own deliverable, generated from
            the assessment work order that captured it (work orders only). */}
        {showAssessmentReportModal && tableName === 'work_orders' && (
          <EnergyAssessmentReportModal
            workOrderId={recordId}
            workOrder={record}
            onClose={() => setShowAssessmentReportModal(false)}
            onSaved={() => { setReloadTick(t => t + 1) }}
          />
        )}

        {/* Submitted Enrollment — what this enrollment filed with the program,
            and the attachments that went with it (enrollments only). */}
        {showSubmittedEnrollmentModal && tableName === 'enrollments' && (
          <SubmittedEnrollmentModal
            enrollmentId={recordId}
            onClose={() => setShowSubmittedEnrollmentModal(false)}
            onSaved={() => { setReloadTick(t => t + 1) }}
          />
        )}

        {/* WI IRA Multifamily HOMES Project Reservation proposal (enrollments only) */}
        {showHomesProposalModal && tableName === 'enrollments' && (
          <HomesProposalModal
            enrollmentId={recordId}
            onClose={() => setShowHomesProposalModal(false)}
            onSaved={() => { setReloadTick(t => t + 1) }}
          />
        )}

        {/* Submittal document template editor (submittal_document_templates only) */}
        {showSubmittalEditor && tableName === 'submittal_document_templates' && (
          <SubmittalDocumentTemplateEditor
            templateId={recordId}
            onClose={() => setShowSubmittalEditor(false)}
            onSaved={() => { setReloadTick(t => t + 1) }}
          />
        )}


        {/* Project Scheduler wizard (only on projects, opt-in via toolbar button) */}
        {showSchedulerWizard && tableName === 'projects' && (
          <ProjectSchedulerWizard
            projectId={recordId}
            project={record}
            onClose={() => setShowSchedulerWizard(false)}
            onCommitted={() => { setReloadTick(t => t + 1) }}
          />
        )}

        {/* Project Reschedule wizard — same component, reschedule mode */}
        {showRescheduleWizard && tableName === 'projects' && (
          <ProjectSchedulerWizard
            mode="reschedule"
            projectId={recordId}
            project={record}
            onClose={() => setShowRescheduleWizard(false)}
            onCommitted={() => { setReloadTick(t => t + 1) }}
          />
        )}

        {/* Single-SA reschedule modal — opt-in via toolbar button on SA records */}
        {showSaReschedule && tableName === 'service_appointments' && (
          <ServiceAppointmentRescheduleModal
            serviceAppointmentId={recordId}
            onClose={() => setShowSaReschedule(false)}
            onRescheduled={() => { setReloadTick(t => t + 1) }}
          />
        )}

        {/* Single-WO schedule modal — opt-in via toolbar button on a Work Order
            whose status is 'To Be Scheduled'. Reuses bulk_schedule_work_orders
            with a one-element WO array and a pinned placement, so the engine
            path is identical to the bulk wizard. On success the SA exists and
            the WO flips to 'Scheduled'; the related-records area refreshes via
            reloadTick. */}
        {showWoSchedule && tableName === 'work_orders' && (
          <WorkOrderScheduleModal
            workOrderId={recordId}
            onClose={() => setShowWoSchedule(false)}
            onScheduled={() => { setReloadTick(t => t + 1) }}
          />
        )}

        {/* Issue-to-Provider modal — opt-in via toolbar button on a Work Order.
            Prices the WO's installed measures via the payout book and issues a
            proposal to the chosen service provider; related lists refresh. */}
        {showIssueProvider && tableName === 'work_orders' && (
          <IssueToProviderModal
            workOrderId={recordId}
            onClose={() => setShowIssueProvider(false)}
            onIssued={() => { setReloadTick(t => t + 1) }}
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

        {/* Account merge — resolve duplicates (this record is the master) */}
        {showMergeModal && tableName === 'accounts' && (
          <AccountMergeModal
            masterId={recordId}
            master={record}
            onClose={() => setShowMergeModal(false)}
            onMerged={() => { setShowMergeModal(false); setReloadTick(t => t + 1) }}
          />
        )}
        {showPortalModal && tableName === 'contacts' && (
          <AddToPortalModal
            contactId={recordId}
            contact={record}
            onClose={() => setShowPortalModal(false)}
            onDone={({ message } = {}) => {
              setShowPortalModal(false)
              if (message) window.alert(message)
              setReloadTick(t => t + 1)
            }}
          />
        )}
        {showSharedRecords && tableName === 'portal_users' && (
          <ManageSharedRecordsModal
            portalUserId={recordId}
            portalUserName={record?.full_name || 'This portal user'}
            onClose={() => { setShowSharedRecords(false); setReloadTick(t => t + 1) }}
          />
        )}
        {showLogCall && (
          <LogActivityModal
            tableName={tableName}
            recordId={recordId}
            onClose={() => setShowLogCall(false)}
            onLogged={() => {
              setShowLogCall(false)
              // Refresh the timeline and jump the user to the Activity tab so
              // the call they just logged is immediately visible.
              setActivityRefreshKey(k => k + 1)
              setActiveTab('Activity')
            }}
          />
        )}
      </Suspense>
    </div>
  )
}
