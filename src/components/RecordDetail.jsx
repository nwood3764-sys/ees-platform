import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
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
const ProjectSchedulerWizard              = lazy(() => import('./scheduler/ProjectSchedulerWizard'))
const ServiceAppointmentRescheduleModal   = lazy(() => import('./scheduler/ServiceAppointmentRescheduleModal'))
const WorkOrderScheduleModal              = lazy(() => import('./scheduler/WorkOrderScheduleModal'))
const IssueToProviderModal                = lazy(() => import('./IssueToProviderModal'))
const SendForSignatureModal               = lazy(() => import('./SendForSignatureModal'))
const AccountMergeModal                    = lazy(() => import('./AccountMergeModal'))
const AddToPortalModal                     = lazy(() => import('./AddToPortalModal'))
const LogActivityModal                     = lazy(() => import('./LogActivityModal'))

import { useToast } from './Toast'
import { useIsMobile, useMediaQuery } from '../lib/useMediaQuery'
import { getTableListUrl } from '../lib/urlNav'
import ActivityTimeline from './ActivityTimeline'
import FileGalleryWidget from './FileGallery'
import IncomeQualificationPanel from './IncomeQualificationPanel'
import PropertyOwnerResearchPanel from './PropertyOwnerResearchPanel'
import { runIncomeQualification } from '../data/incomeQualificationService'
import ConversationPanelWidget from './ConversationPanel'
import StatusPathWidget from './StatusPathWidget'
import { ReportWidget } from './ReportWidget'
import PropertyMapWidget from './PropertyMapWidget'
import StatusTransitionsBar from './StatusTransitionsBar'
import TopbarActions from './TopbarActions'
import { ACTION_KEYS } from '../data/recordActions'
import { supabase } from '../lib/supabase'
import { getSectionConfigSchema, buildDefaultConfig } from '../data/sectionConfigSchemas'
import { getSectionFilterSchema } from '../data/sectionFilterSchemas'
import { MERGE_FIELD_OBJECTS, loadFieldsForObject } from '../data/mergeFieldCatalog'
import { resolveLookupLabel } from '../data/fieldMetadataService'
import {
  uploadDocumentTemplateAsset,
  signedDocumentTemplateAssetUrl,
  copyDocumentTemplateAsset,
  uploadAvatar,
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
  loadPicklists as loadAllPicklists,
  getCurrentUserId,
  fetchRelatedRecords,
  reorderJunctionRows,
  fetchPickerCandidates,
  addJunctionRow,
  removeJunctionRow,
  applyInsertDefaults,
  getRecordTypeValue,
  getRecordTypeColumn,
  fetchAvailableRecordTypes,
} from '../data/layoutService'
import RecordTypePicker from './RecordTypePicker'

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
  units:                     { module: 'Enrollment',       label: 'Units',                nameColumn: 'unit_name',              recordNumberColumn: 'unit_record_number',              statusColumn: 'unit_status',              parents: ['building_id', 'property_id'],                     parentTables: ['buildings', 'properties'] },
  opportunities:             { module: 'Enrollment',       label: 'Opportunities',        nameColumn: 'opportunity_name',       recordNumberColumn: 'opportunity_record_number',       statusColumn: 'opportunity_status',       parents: ['property_id', 'building_id', 'opportunity_account_id'],          parentTables: ['properties', 'buildings', 'accounts'] },
  opportunity_contact_roles: { module: 'Enrollment',       label: 'Contact Role',         nameColumn: 'ocr_name',               recordNumberColumn: 'ocr_record_number',               statusColumn: null,                       parents: ['opportunity_id', 'contact_id'],                   parentTables: ['opportunities', 'contacts'] },
  property_programs:         { module: 'Enrollment',       label: 'Enrollment',           nameColumn: null,                     recordNumberColumn: null,                              statusColumn: null,                       parents: ['property_id'],                                    parentTables: ['properties'] },
  work_orders:               { module: 'Field',          label: 'Work Orders',          nameColumn: 'work_order_name',        recordNumberColumn: 'work_order_record_number',        statusColumn: 'work_order_status',        parents: ['project_id', 'opportunity_id', 'property_id', 'building_id'],       parentTables: ['projects', 'opportunities', 'properties', 'buildings'] },
  projects:                  { module: 'Field',          label: 'Projects',             nameColumn: 'project_name',           recordNumberColumn: 'project_record_number',           statusColumn: 'project_status',           parents: ['property_id', 'building_id', 'project_account_id'],                     parentTables: ['properties', 'buildings', 'accounts'] },
  assessments:               { module: 'Qualification',  label: 'Assessments',          nameColumn: 'assessment_name',        recordNumberColumn: 'assessment_record_number',        statusColumn: 'assessment_status',        parents: ['property_id', 'building_id'],                     parentTables: ['properties', 'buildings'] },
  incentive_applications:    { module: 'Qualification',  label: 'Applications',         nameColumn: 'ia_name',                recordNumberColumn: 'ia_record_number',                statusColumn: 'ia_status',                parents: ['property_id'],                                    parentTables: ['properties'] },
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

function Breadcrumbs({ tableName, record, lookups, onBack, onNavigateToRecord }) {
  const meta = TABLE_META[tableName] || { module: '—', label: tableName, parents: [], parentTables: [] }

  // Parent crumbs — innermost first. Each crumb carries the FK target so the
  // user can click through to the parent record. `parentTables` aligns
  // positionally with `parents`; if it's missing or short (legacy entries),
  // the crumb still renders as plain text.
  const parentCrumbs = []
  for (let i = 0; i < meta.parents.length; i += 1) {
    const fk = meta.parents[i]
    const parentTable = (meta.parentTables || [])[i] || null
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

  const sep = <span style={{ color: C.textMuted, margin: '0 6px', fontSize: 10 }}>/</span>

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, marginBottom: 14 }}>
      <span style={{ fontSize: 12, color: C.textMuted }}>{meta.module}</span>
      {sep}
      <button onClick={onBack} style={{ fontSize: 12, color: '#1a5a8a', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}>
        {meta.label}
      </button>
      {parentCrumbs.map((c, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
          {sep}
          {c.table && onNavigateToRecord ? (
            <button
              onClick={() => onNavigateToRecord({ table: c.table, id: c.id, mode: 'view' })}
              style={{
                fontSize: 12, color: '#1a5a8a', background: 'none', border: 'none',
                cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2,
              }}
            >
              {c.label}
            </button>
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
  opportunities: ['opportunity_name'],
  buildings: ['building_name'],
  units: ['unit_name'],
  opportunity_contact_roles: ['ocr_name'],
  projects: ['project_name'],
  work_orders: ['work_order_name'],
}

// Per-table name fields populated by a BEFORE INSERT/UPDATE trigger that the
// DB overwrites on every write. These are never user-editable — any input the
// user types is silently discarded — so every create/edit surface must render
// them read-only. Module-level so both FieldGroupWidget and QuickCreateModal
// enforce the same contract.
const DERIVED_READONLY = {
  contacts: ['contact_name'],
  opportunities: ['opportunity_name'],
  buildings: ['building_name'],
  units: ['unit_name'],
  opportunity_contact_roles: ['ocr_name'],
  projects: ['project_name'],
  work_orders: ['work_order_name'],
}
const isDerivedReadonlyField = (table, name) =>
  (DERIVED_READONLY[table] || []).includes(name)

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
// Details first, Related second (if any section has related_list or
// file_gallery widgets), Activity third (always shown on existing records),
// then any custom tabs alphabetical after.
function buildOrderedTabs(sections, { includeActivity = true } = {}) {
  const names = new Set()
  let hasRelated = false
  for (const sec of sections || []) {
    names.add(sec.section_tab || 'Details')
    if ((sec.widgets || []).some(w => w.widget_type === 'related_list' || w.widget_type === 'file_gallery' || w.widget_type === 'prtsn_history' || w.widget_type === 'report' || w.widget_type === 'conversation_panel')) {
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
  const [recordTypes, setRecordTypes] = useState([])
  const rtColumn = useMemo(() => getRecordTypeColumn(table), [table])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const meta = await fetchTableMetadata(table)
        const required = new Set(meta.required_fields || [])
        // System/audit columns are auto-filled by applyInsertDefaults — never
        // surface them in the quick-create form even if NOT NULL.
        const SYSTEM = /(_record_number$|_owner$|_created_by$|_created_at$|_updated_by$|_updated_at$|_is_deleted$|^id$|^is_seed_data$)/
        // Columns a DB trigger populates automatically — NOT NULL but must not
        // be shown (e.g. contacts.contact_name is derived from first + last by
        // the trg_contact_name trigger).
        const DERIVED = {
          contacts: ['contact_name'],
          opportunities: ['opportunity_name'],
          buildings: ['building_name'],
          units: ['unit_name'],
          opportunity_contact_roles: ['ocr_name'],
        }
        const derivedCols = new Set(DERIVED[table] || [])
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
        for (const col of required) {
          if (SYSTEM.test(col)) continue
          if (col === rtColumn) continue
          if (derivedCols.has(col)) continue              // trigger fills it
          if (seed && seed[col] != null) continue  // already known from the dependency — don't ask
          fieldDefs.push({
            name: col,
            label: col.replace(/^[a-z]+_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            type: col === labelField ? 'text' : 'text',
            required: true,
          })
        }
        for (const extra of (EXTRA_REQUIRED[table] || [])) {
          if (fieldDefs.some(f => f.name === extra.name)) continue
          if (seed && seed[extra.name] != null) continue
          fieldDefs.push({ ...extra, required: true })
        }
        // Load record types for the RT selector, and any picklist options.
        let rts = []
        if (rtColumn) {
          rts = await fetchAvailableRecordTypes(table).catch(() => [])
        }
        if (cancelled) return
        setFields(fieldDefs)
        setRecordTypes(rts)
        setLoading(false)
      } catch (err) {
        if (!cancelled) { toast.error(`Could not open create form — ${err.message || err}`); onCancel() }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])

  const setVal = (name, v) => setDraft(d => ({ ...d, [name]: v }))

  const handleSave = async () => {
    if (saving) return
    const missing = fields.filter(f => f.required && !isDerivedReadonlyField(table, f.name) && (draft[f.name] == null || draft[f.name] === ''))
    if (missing.length) {
      toast.error(missing.length === 1 ? `Required: ${missing[0].label}` : `Required: ${missing.map(f => f.label).join(', ')}`)
      return
    }
    setSaving(true)
    try {
      const userId = await getCurrentUserId()
      const payload = applyInsertDefaults(table, { ...(seed || {}), ...draft }, userId)
      for (const [k, v] of Object.entries(payload)) if (v === '') payload[k] = null
      const created = await insertRecord(table, payload)
      const label = (labelField && created?.[labelField]) || created?.id?.slice(0, 8) || 'New record'
      toast.success(`Created ${label}`)
      onCreated({ id: created.id, label })
    } catch (err) {
      toast.error(`Create failed — ${err.message || String(err)}`)
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
                <SearchableLookup
                  value={draft[f.name] || ''}
                  options={recordTypes.map(rt => ({ value: rt.id, label: rt.label || rt.picklist_label }))}
                  onChange={(val) => setVal(f.name, val || null)}
                  placeholder="— Select —"
                />
              ) : (
                <input type={f.type === 'email' ? 'email' : 'text'} style={{ ...inputBase }} value={draft[f.name] || ''}
                  onChange={e => setVal(f.name, e.target.value)} />
              )}
            </div>
            )
          })}
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
    return sorted.filter(o => String(o.label ?? '').toLowerCase().includes(q))
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
                <div key={o.value} onClick={() => pick(o.value)} title={o.label}
                  style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer',
                    background: isSel ? C.emerald : '#fff', color: isSel ? '#fff' : C.textPrimary,
                    whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.3 }}
                  onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#f1f5f9' }}
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = '#fff' }}>
                  {o.label}
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
function LookupEditControl({ field, value, baseOptions, onChange, canCreate, dependencyValues = null }) {
  const [extra, setExtra] = useState([])          // options created inline this session
  const [serverOpts, setServerOpts] = useState(null) // results from server search (null = not searched)
  const [selectedOption, setSelectedOption] = useState(null) // resolved label for current value

  const canServerSearch = !!(field.lookup_table && field.lookup_field)

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
    const t = (field.lookup_table || '').replace(/s$/, '').replace(/_/g, ' ')
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
    if (dep.kind === 'buildings_for_property') {
      const prop = dependencyValues.property_id
        || dependencyValues.opportunity_property_id
      return prop ? { property_id: prop } : null
    }
    return null
  }, [field, dependencyValues])

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
      createSeed={createSeed}
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
      const dep = field.lookup_dependency
      const canCreate = field.allow_inline_create === true && !!field.lookup_table
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
            />
          )
        }
        const dependsOn = Array.isArray(dep.depends_on) ? dep.depends_on : []
        const hint = dependsOn.length > 0
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

function FieldGroupWidget({ widget, record, picklists, lookups, editing, draft, onChange, allPicklistOpts, allLookupOpts, onRefreshRecord, recordId, fieldDisabledReasons, onNavigateToRecord, requiredFields, tableName }) {
  const fields = widget.widget_config?.fields || []
  if (fields.length === 0) return null

  // System fields are auto-populated at insert time by applyInsertDefaults
  // (record_number, owner, created_by) — they appear in the layout for
  // display purposes on saved records but shouldn't be shown as inputs on
  // the create form. Hide them when the record doesn't exist yet.
  const isCreate = !record?.id
  const isSystemField = (name) =>
    /(_record_number|_created_by|_updated_by|_created_at|_updated_at|_owner)$/.test(name || '')

  const renderField = (f) => {
        // Hide system-set fields on the create form — they're auto-populated
        // at insert time by applyInsertDefaults and rendering them as inputs
        // just confuses the user (and produced an incorrect 'Required fields
        // missing' error before the prefix-map fix landed).
        if (isCreate && isSystemField(f.name)) return null
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
        const isEditable = editing
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
              {editing && isRequiredField && !isDerivedField && (
                <span style={{ color: '#2c5f8a', marginLeft: 3 }}>*</span>
              )}

            </span>
            {isEditable ? (
              <EditField
                field={f.lookup_dependency?.kind
                  ? { ...f, _dependencyValues: Object.fromEntries(
                      (f.lookup_dependency.depends_on || []).map(k => [k, draft[k]]).filter(([, val]) => val != null)
                    ) }
                  : f}
                value={draft[f.name]} onChange={onChange}
                picklistOpts={allPicklistOpts?.[f.name]} lookupOpts={allLookupOpts?.[f.name]}
                recordId={recordId} />
            ) : lookupLinkTarget ? (
              <button
                type="button"
                onClick={() => onNavigateToRecord(lookupLinkTarget)}
                style={{
                  fontSize: 13, color: '#1a5a8a', background: 'none', border: 'none',
                  padding: 0, textAlign: 'left', cursor: 'pointer',
                  textDecoration: 'underline', textUnderlineOffset: 2,
                  fontFamily: 'inherit', wordBreak: 'break-word',
                }}
                title={`Open ${display}`}
              >
                {display}
              </button>
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
          <div key={c}>{fields.filter(f => (f.column || 1) === c).map(renderField)}</div>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0' }}>
      {fields.map(renderField)}
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

const RELATED_LIST_MAX_ROWS = 7

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
  parentTable, parentRecord,
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
  // True total for the header count, accurate beyond the 25-row fetch cap
  // (fetchRelatedRecords attaches _total via PostgREST count:'exact').
  const totalCount = (typeof allRows._total === 'number') ? allRows._total : localRows.length

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
    if (!canNavigate || !row?.id) return
    onNavigateToRecord({ table: childTable, id: row.id, mode: 'view' })
  }

  const handleNewClick = (e) => {
    e.stopPropagation()
    if (!canNavigate) return

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

            {hiddenCount > 0 && (() => {
              // Wire View All to the table's list view when one is mapped.
              // No project-filter yet — the link drops the user on the full
              // list, which is still better than a not-allowed placeholder.
              const listUrl = getTableListUrl(childTable)
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
                      View All →
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

function Section({ section, record, picklists, lookups, editing, draft, onChange, allPicklistOpts, allLookupOpts, tableName, onRefreshRecord, recordId, fieldDisabledReasons, hiddenWidgetTypes, onNavigateToRecord, requiredFields, activeTab }) {
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
  const sectionWidgets = (section.widgets || []).filter(w => {
    if (!inSectionTypes.has(w.widget_type)) return false
    if (hiddenWidgetTypes && hiddenWidgetTypes.has(w.widget_type)) return false
    return true
  })
  // Blank sections still render — the record page stays consistent with the
  // page layout editor: every section in the layout shows its header, with a
  // muted empty state in place of content. The one exception is a section
  // whose widgets were ALL deliberately suppressed via hiddenWidgetTypes
  // (context-dependent hides like docx-only widgets) — rendering an empty
  // shell there would defeat the suppression.
  const allSectionWidgets = section.widgets || []
  const allSuppressed = allSectionWidgets.length > 0 && hiddenWidgetTypes &&
    allSectionWidgets.every(w => hiddenWidgetTypes.has(w.widget_type))
  if (sectionWidgets.length === 0 && allSuppressed) return null
  // Cards (related lists, galleries, conversations, reports, publish history)
  // render on the Related tab, not inside their section — when a section holds
  // ONLY cards, say where its content went instead of looking broken.
  const relatedTabCardCount = allSectionWidgets.filter(w =>
    ['related_list', 'file_gallery', 'conversation_panel', 'report', 'prtsn_history'].includes(w.widget_type)).length
  // On the Related tab, a section whose only content is Related-tab cards
  // (related lists, galleries, conversations, reports, publish history) renders
  // NOTHING here — those cards already render as their own standalone cards
  // right below. Drawing an empty section shell would (a) duplicate the card,
  // producing a second, empty "Buildings"/"Documents" block, and (b) show the
  // self-referential note "this section's card appears on the Related tab"
  // while the user is already on the Related tab. The shell only makes sense on
  // the Details tab, where it tells the user their content lives over on
  // Related. So suppress the card-only shell here.
  if (sectionWidgets.length === 0 && relatedTabCardCount > 0 && activeTab === 'Related') return null
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: isMobile ? 10 : 12, overflow: 'hidden' }}>
      <div onClick={() => section.section_is_collapsible && setCollapsed(c => !c)}
        style={{ padding: isMobile ? '12px 14px' : '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: section.section_is_collapsible ? 'pointer' : 'default', borderBottom: collapsed ? 'none' : `1px solid ${C.border}`, background: '#fafbfd' }}>
        <span style={{ fontSize: isMobile ? 14 : 13, fontWeight: 600, color: C.textPrimary }}>{section.section_label}</span>
        {section.section_is_collapsible && <Icon path={collapsed ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'} size={14} color={C.textMuted} />}
      </div>
      {!collapsed && sectionWidgets.length === 0 && (
        <div style={{ padding: isMobile ? '14px 14px' : '16px 18px', fontSize: 12.5, color: C.textMuted, fontStyle: 'italic' }}>
          {relatedTabCardCount > 0
            ? `This section's ${relatedTabCardCount === 1 ? 'card appears' : 'cards appear'} on the Related tab.`
            : 'No fields in this section yet — add some in the page layout editor.'}
        </div>
      )}
      {!collapsed && sectionWidgets.map(w => {
        if (w.widget_type === 'field_group') {
          return <FieldGroupWidget key={w.id} widget={w} record={record} picklists={picklists} lookups={lookups}
            editing={editing} draft={draft} onChange={onChange} allPicklistOpts={allPicklistOpts} allLookupOpts={allLookupOpts}
            onRefreshRecord={onRefreshRecord} recordId={recordId} fieldDisabledReasons={fieldDisabledReasons}
            onNavigateToRecord={onNavigateToRecord} requiredFields={requiredFields} tableName={tableName} />
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
  // breakpoint.
  const isNarrow = useMediaQuery('(max-width: 1024px)')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(isCreate)
  const [draft, setDraft] = useState({})
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
  // Parent-name lookups for the breadcrumb in CREATE mode. The loaded record is
  // empty while creating, so prefilled parent FKs (e.g. property_id on a new
  // Building, or opportunity_id on a new Contact Role) can't resolve to names —
  // leaving the breadcrumb flat ("Module / Object") instead of hierarchical.
  // The effect below resolves them from the prefill.
  const [createCrumbLookups, setCreateCrumbLookups] = useState(() => new Map())
  // When non-null, we are cloning the current record: same table, insert path,
  // draft pre-populated from the source.
  const [cloneSource, setCloneSource] = useState(null)
  const isInsertMode = isCreate || cloneSource !== null
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
  // Holds the derived-name base (e.g. a project's source opportunity name)
  // captured from the create prefill, so the name can be recomposed when the
  // user changes record type before saving. Stored in a ref so it persists
  // without being inserted into the row.
  const derivedNameBaseRef = useRef(null)
  // Project report generator (only used when tableName === 'projects'). The
  // tick is bumped after a successful generation so the related-records area
  // (Documents widget) re-fetches and the new PDF appears immediately.
  const [showReportModal, setShowReportModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
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
    if (prefill.state) return prefill.state
    for (const key of Object.keys(prefill)) {
      if (key.endsWith('_state') && prefill[key]) return prefill[key]
    }
    return null
  })()
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

    // Gate on the SAME state-filtered set the rendered picker will show, so
    // the show/skip decision and the picker contents never diverge. (Passing
    // no state here while the picker passed state caused the picker to render
    // then immediately auto-dismiss via onPick(null) whenever a state had no
    // scoped record types — silently skipping the prompt.)
    fetchAvailableRecordTypes(tableName, { state: prefillState })
      .then(rts => {
        if (cancelled) return
        if (rts.length === 0) {
          setPickedRecordType(false)
        } else if (rts.length === 1) {
          setPickedRecordType(rts[0])
        }
        // else: leave null so picker renders
        setPickerEvaluated(true)
      })
      .catch(err => {
        if (cancelled) return
        console.warn('fetchAvailableRecordTypes failed', err)
        setPickedRecordType(false)
        setPickerEvaluated(true)
      })
    return () => { cancelled = true }
  }, [isCreate, tableName, prefillRecordTypeValue, prefillState])

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
      // Seed value for the form's record-type column when we have a pick
      const seededRT = rtId ? { [rtCol]: rtId } : {}

      // Compose a derived display name when the prefill carried a name base
      // (e.g. projects: opportunity name + record-type label, mirroring
      // trg_project_name). This makes the read-only Name field show its value
      // as soon as the form opens instead of staying blank until save. The
      // base is a transient prefill hint; strip it from what we seed.
      const composeDerivedName = (base, rtObj) => {
        const rtLabel = rtObj ? (rtObj.label || rtObj.picklist_label || '') : ''
        const composed = [String(base || '').trim(), String(rtLabel || '').trim()]
          .filter(Boolean).join(' - ')
        return composed.replace(/^[\s-]+|[\s-]+$/g, '') || null
      }
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
        return d
      }

      // Create mode: fetch layout + picklists only, no record.
      // Layout selection uses the picked RT (if any) so the right
      // record-type-specific layout loads.
      const layoutKey = rtId || getRecordTypeValue(prefill)
      Promise.all([fetchPageLayout(tableName, layoutKey), loadAllPicklists()])
        .then(([layoutData, picklists]) => {
          if (cancelled) return
          setData({
            record: {},
            layout: layoutData?.layout || null,
            sections: layoutData?.sections || [],
            picklists,
            lookups: new Map(),
            actionOverrides: layoutData?.actionOverrides || [],
          })
          setDraft(seedDraft(prefill))
          setEditing(true)
          // Pre-load picklist + lookup options. Pass the seeded draft so
          // any dependent-lookup fields can resolve their dependencies on
          // the very first render rather than waiting for a draft change.
          if (layoutData?.sections) {
            const initialDraft = seedDraft(prefill)
            loadAllEditOpts(layoutData.sections, initialDraft)
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
  }, [tableName, recordId, isCreate, reloadTick, pickerEvaluated, pickedRecordType])

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
      window.history.pushState(null, '', next)
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

    // Fetch picklist options
    if (pickFields.length) {
      const opts = {}
      await Promise.all(pickFields.map(async fn => {
        try { opts[fn] = await fetchPicklistOptions(tableName, fn) } catch { opts[fn] = [] }
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
    // Projects: recompose the derived name when record type changes during
    // create, mirroring trg_project_name (opportunity name + RT label). Only
    // applies while a derived base is held (i.e. created from an opportunity).
    if (tableName === 'projects' && name === getRecordTypeColumn('projects') && derivedNameBaseRef.current) {
      const opts = allPicklistOpts?.[name] || []
      const rtLabel = (opts.find(o => o.value === value)?.label) || ''
      const composed = [String(derivedNameBaseRef.current || '').trim(), String(rtLabel || '').trim()]
        .filter(Boolean).join(' - ').replace(/^[\s-]+|[\s-]+$/g, '')
      next.project_name = composed || ''
    }
    return next
  })

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

  // Show the record-type picker before loading the layout. Gates create mode.
  if (isCreate && pickerEvaluated && pickedRecordType === null) {
    const objectLabel = TABLE_META[tableName]?.label || tableName
    return (
      <RecordTypePicker
        tableName={tableName}
        objectLabel={singularizeLabel(objectLabel)}
        state={prefillState}
        onPick={(rt) => {
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
  // In create mode the breadcrumb reads the prefilled parent FKs (and their
  // names resolved by createCrumbLookups) so it stays hierarchical; otherwise
  // it uses the loaded record and its lookups.
  const crumbRecord = isCreate ? { ...record, ...(prefill || {}) } : record
  const crumbLookups = isCreate ? createCrumbLookups : lookups

  // Build the ordered tab list from the loaded sections. Details first,
  // Related second (if any section has related_list widgets), Activity third
  // (not on new records — nothing to show yet), alphabetical after.
  const orderedTabs = buildOrderedTabs(sections, { includeActivity: !isInsertMode })

  const objectLabel = TABLE_META[tableName]?.label || tableName
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

  if (!layout) return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      padding: isMobile ? '12px' : '20px 24px',
      paddingBottom: isMobile ? 'calc(12px + env(safe-area-inset-bottom))' : '20px',
    }}>
      {!isMobile && <Breadcrumbs tableName={tableName} record={crumbRecord} lookups={crumbLookups} onBack={onBack} onNavigateToRecord={onNavigateToRecord} />}
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
  }

  const topbarActionHandlers = {
    [ACTION_KEYS.EDIT]:                   startEditing,
    [ACTION_KEYS.CLONE]:                  handleClone,
    [ACTION_KEYS.ADVANCE_TO_OPPORTUNITY]: handleAdvanceToOpportunity,
    [ACTION_KEYS.RUN_INCOME_QUALIFICATION]: handleRunIncomeQualification,
    [ACTION_KEYS.DELETE]:                 () => setShowDeleteConfirm(true),
    [ACTION_KEYS.GENERATE_REPORT]:        () => setShowReportModal(true),
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

      {/* Scrollable content region */}
      <div style={{
        flex: 1, overflow: 'auto', minHeight: 0,
        padding: isMobile ? '10px 10px' : '20px 24px',
        paddingBottom: isMobile && editing ? 'calc(80px + env(safe-area-inset-bottom))' : isMobile ? 'calc(24px + env(safe-area-inset-bottom))' : undefined,
      }}>
        {/* Desktop breadcrumbs (hidden on mobile — the sticky header handles back navigation) */}
        {!isMobile && <Breadcrumbs tableName={tableName} record={crumbRecord} lookups={crumbLookups} onBack={onBack} onNavigateToRecord={onNavigateToRecord} />}

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
              </>) : (
                <TopbarActions
                  variant="desktop"
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

        {/* Status Path — Salesforce-style horizontal chevron strip showing
            the record's position in its lifecycle. Widget is registered as
            'status_path' and configured per page layout with widget_config.
            status_field naming which status column to render. Self-suppresses
            when the object has no lifecycle configured. Multiple status_path
            widgets per layout are supported (e.g. work_orders has both
            work_order_status and work_order_approval_status). */}
        {!isInsertMode && !editing && sections
          .flatMap(sec => (sec.widgets || []).filter(w => w.widget_type === 'status_path'))
          .map(w => (
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
            when the current status is terminal (no outgoing transitions). */}
        <StatusTransitionsBar
          tableName={tableName}
          recordId={recordId}
          record={record}
          editing={editing}
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

        {/* Sections — field groups only. Filter by active tab. For
            document_templates we also skip the Document Content section
            when authoring mode is "docx" (the body_html field is
            irrelevant in that mode — the .docx asset replaces it).
            Right-rail sections (section_placement='right') are excluded
            here — they render in the always-visible right column below. */}
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
            return (
              <Section key={sec.id} section={sec} record={record} picklists={picklists} lookups={lookups}
                editing={editing} draft={draft} onChange={handleFieldChange}
                allPicklistOpts={allPicklistOpts} allLookupOpts={allLookupOpts} tableName={tableName}
                onRefreshRecord={() => setReloadTick(t => t + 1)} recordId={recordId}
                fieldDisabledReasons={fieldDisabledReasons} hiddenWidgetTypes={hiddenWidgetTypes}
                onNavigateToRecord={onNavigateToRecord}
                requiredFields={requiredFields} activeTab={activeTab} />
            )
          })}

        {/* Related lists — standalone Salesforce-style cards, shown only on
            the Related tab regardless of which section they came from.
            Right-placement widgets are excluded — they render in the right
            sidebar below. */}
        {!isInsertMode && activeTab === 'Related' && sections
          .filter(sec => (sec.section_placement || 'main') === 'main')
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
                parentTable={tableName}
                parentRecord={data?.record}
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
          .filter(sec => (sec.section_placement || 'main') === 'main')
          .flatMap(sec => (sec.widgets || []).filter(w => w.widget_type === 'file_gallery'))
          .map(w => (
            <FileGalleryWidget
              key={w.id}
              widget={w}
              parentTable={tableName}
              parentRecordId={recordId}
            />
          ))}

        {/* Income Qualification — runs the multifamily HUD categorical
            qualification tool against this enrollment: classifies the
            enrollment (own fields, property HUD fallback), generates the IRA
            application PDF and tenant data XLSX, saves both to the record, and
            writes the determination back onto the enrollment. Only on
            enrollments, Related tab. */}
        {!isInsertMode && activeTab === 'Related' && tableName === 'enrollments' && (
          <IncomeQualificationPanel enrollmentId={recordId} />
        )}

        {/* Property Owner Research — finds the decision makers (CEO, asset
            manager, facilities director — not site property-management staff)
            behind this owner-group account or property. Tiered by cost: free
            AI web research → Lusha prospecting search (no credits) →
            per-person contact reveal (paid credits). Candidates promote to
            real Contacts. Only on accounts and properties, Related tab. */}
        {!isInsertMode && activeTab === 'Related' && (tableName === 'properties' || tableName === 'accounts') && (
          <PropertyOwnerResearchPanel tableName={tableName} recordId={recordId} />
        )}

        {/* Conversation panel — Service Cloud Messaging-style split-pane
            (thread list left, active thread + composer right). Self-contained:
            loads its own conversations + messages, marks threads read on
            open, and invokes send-notification-sms v2 for replies. */}
        {!isInsertMode && activeTab === 'Related' && sections
          .filter(sec => (sec.section_placement || 'main') === 'main')
          .flatMap(sec => (sec.widgets || []).filter(w => w.widget_type === 'conversation_panel'))
          .map(w => (
            <ConversationPanelWidget
              key={w.id}
              widget={w}
              parentRecordId={recordId}
            />
          ))}

        {/* PRTSN history — Versions list for project_report_templates only.
            Self-contained widget that fetches snapshots for the current PRT
            and offers a Preview-from-snapshot action per version. */}
        {!isInsertMode && activeTab === 'Related' && sections
          .filter(sec => (sec.section_placement || 'main') === 'main')
          .flatMap(sec => (sec.widgets || []).filter(w => w.widget_type === 'prtsn_history'))
          .map(w => (
            <PrtsnHistoryWidget
              key={w.id}
              widget={w}
              parentRecordId={recordId}
            />
          ))}

        {/* Embedded reports — saved reports rendered inline as widgets.
            Optional context filter narrows the report to rows matching
            the current record (so a generic 'All Tasks' report becomes
            'Tasks for THIS record' when embedded). */}
        {!isInsertMode && activeTab === 'Related' && sections
          .filter(sec => (sec.section_placement || 'main') === 'main')
          .flatMap(sec => (sec.widgets || []).filter(w => w.widget_type === 'report'))
          .map(w => (
            <ReportWidget
              key={w.id}
              widget={w}
              parentTable={tableName}
              parentRecordId={recordId}
              onOpenRecord={onNavigateToRecord}
            />
          ))}

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
              width: isNarrow ? '100%' : 320,
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
                        .filter(w => w.widget_type === 'related_list')
                        .map(w => (
                          <RelatedListWidget
                            key={w.id}
                            widget={w}
                            picklists={picklists}
                            onNavigateToRecord={onNavigateToRecord}
                            parentRecordId={recordId}
                            parentTable={tableName}
                            parentRecord={data?.record}
                          />
                        ))}
                      {(sec.widgets || [])
                        .filter(w => w.widget_type === 'conversation_panel')
                        .map(w => (
                          <ConversationPanelWidget
                            key={w.id}
                            widget={w}
                            parentRecordId={recordId}
                          />
                        ))}
                      {(sec.widgets || [])
                        .filter(w => w.widget_type === 'file_gallery')
                        .map(w => (
                          <FileGalleryWidget
                            key={w.id}
                            widget={w}
                            parentTable={tableName}
                            parentRecordId={recordId}
                          />
                        ))}
                      {(sec.widgets || [])
                        .filter(w => w.widget_type === 'report')
                        .map(w => (
                          <ReportWidget
                            key={w.id}
                            widget={w}
                            parentTable={tableName}
                            parentRecordId={recordId}
                            onOpenRecord={onNavigateToRecord}
                          />
                        ))}
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
