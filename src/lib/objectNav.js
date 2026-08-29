// ---------------------------------------------------------------------------
// objectNav — one registry for an object's navigation identity.
//
// WHY THIS EXISTS
//
// Navigation for a record needs three facts: which app (module) hosts it, what
// the object is called, and where its list view lives. Those three facts were
// spread across two hand-maintained allowlists that had to be edited in step:
// TABLE_MODULE_MAP/TABLE_LIST_SECTION_MAP in urlNav.js and TABLE_META in
// RecordDetail.jsx. Nothing checked that either list was complete, so every
// object added to LEAP after those lists were written silently lost its
// navigation:
//
//   • 103 objects have a record page. The URL list covered 52 of them.
//     For the other 51 — work_steps, work_plans, photos, documents,
//     activities, price_books, service_territories … — parsePath could not
//     recognise "/<table>/<uuid>" as a record at all, so it fell through to
//     the Home module. That is why browser Back, browser Forward, a reload
//     and a pasted link all landed on the Home screen.
//   • 48 objects were missing from the display list, so their breadcrumb read
//     "— / work_steps" — no app name, the raw table name, and a link that
//     resolved to nothing.
//   • Several objects that WERE listed pointed at a list section their module
//     does not declare (enrollments -> /m/enrollment/enrollments, vehicle
//     activities -> /m/fleet/vehicle_activities, …), so the breadcrumb's
//     object link dropped the user on the module's Home tab.
//
// THE RULE HERE IS DERIVATION FIRST.
//
// An object that is NOT listed below still gets a working URL, a readable
// label and a host module. Listing an object only OVERRIDES a derived answer
// that would be wrong. There is no allowlist to fall off, so a new object
// cannot silently lose its navigation again — which is the failure this
// module exists to make impossible.
//
// Pure module: no window, no React, no network. Fixture-tested by
// scripts/object-nav-fixture.mjs.
// ---------------------------------------------------------------------------

// Path segments that are routes, not object tables. Everything else in the
// first position of "/<x>/<uuid>" is treated as an object table.
const RESERVED_PATH_SEGMENTS = new Set(['m', 'help', 'search', 'sign', 'auth'])

// A table name as it appears in a URL: lower snake_case, starting with a
// letter. Deliberately syntactic — it accepts tables this file has never heard
// of, which is the whole point.
const TABLE_SEGMENT_RE = /^[a-z][a-z0-9_]*$/

/** True when a first path segment addresses an object table rather than a route. */
export function isObjectTableSegment(segment) {
  if (!segment || typeof segment !== 'string') return false
  if (RESERVED_PATH_SEGMENTS.has(segment)) return false
  return TABLE_SEGMENT_RE.test(segment)
}

// Words that are acronyms in LEAP and must not be title-cased letter-by-letter.
const LABEL_ACRONYMS = {
  ahri: 'AHRI', efr: 'EFR', gps: 'GPS', hud: 'HUD', prt: 'PRT',
  ia: 'IA', ppr: 'PPR', sa: 'SA', qc: 'QC', pdf: 'PDF', url: 'URL',
}

/**
 * Readable object label derived from the table name — "work_steps" → "Work
 * Steps". Used whenever an object carries no explicit label, so a record page
 * never shows a raw table name to a user again.
 */
export function humanizeObjectLabel(table) {
  if (!table) return ''
  return String(table)
    .split('_')
    .filter(Boolean)
    .map(w => LABEL_ACRONYMS[w] || (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

// The app each module id presents as, for the breadcrumb's leading crumb.
const MODULE_LABELS = {
  home: 'Home', tasks: 'Tasks', outreach: 'Outreach', enrollment: 'Enrollment',
  qualification: 'Qualification', field: 'Field', planning: 'Project Planning',
  implementation: 'Project Implementation', dispatch: 'Dispatch',
  incentives: 'Incentives', stock: 'Stock', fleet: 'Fleet', reports: 'Reports',
  admin: 'Admin', portal: 'Portal', providers: 'Service Providers',
}

// Host module for an object we have never been told about. Any module that
// renders RecordDetail displays any record correctly — modules are chrome, not
// data scope — so an unregistered object opens somewhere sensible rather than
// failing. It is a fallback, not a guess we rely on: every object with a
// record page is registered below.
const DEFAULT_RECORD_MODULE = 'field'

// ---------------------------------------------------------------------------
// The registry: table -> [module id, list section id or null]
//
// A null section means the object has no list view anywhere in the app (a
// child object reached only through its parent — work steps, line items,
// photos). Its breadcrumb shows the object name as plain text instead of a
// link that would dump the user on a module Home tab.
//
// Section ids are the ids the module actually declares. They are NOT always
// the table name (Field exposes work_orders as "workorders", Enrollment
// exposes enrollments as "enrollment"), which is why they are recorded here
// rather than assumed.
// ---------------------------------------------------------------------------
const OBJECT_HOME = {
  // ── Enrollment ──────────────────────────────────────────────────────────
  accounts:                  ['enrollment', 'accounts'],
  contacts:                  ['enrollment', 'contacts'],
  account_contact_relations: ['enrollment', null],
  properties:                ['enrollment', 'properties'],
  buildings:                 ['enrollment', 'buildings'],
  units:                     ['enrollment', 'units'],
  opportunities:             ['enrollment', 'opps'],
  opportunity_contact_roles: ['enrollment', null],
  opportunity_line_items:    ['enrollment', null],
  property_programs:         ['enrollment', null],
  enrollments:               ['enrollment', 'enrollment'],
  income_qualifications:     ['enrollment', null],

  // ── Qualification ───────────────────────────────────────────────────────
  assessments:               ['qualification', 'assessments'],
  incentive_applications:    ['qualification', 'applications'],
  efr_reports:               ['qualification', 'efr'],
  diagnostic_tests:          ['qualification', null],
  ahri_certificates:         ['qualification', null],
  ahri_equipment:            ['qualification', null],
  mechanical_equipment:      ['qualification', null],

  // ── Field ───────────────────────────────────────────────────────────────
  projects:                     ['field', 'projects'],
  work_orders:                  ['field', 'workorders'],
  work_plans:                   ['field', null],
  work_steps:                   ['field', null],
  service_appointments:         ['field', 'service_appointments'],
  service_appointment_assignments: ['field', null],
  resource_absences:            ['field', 'absences'],
  time_sheets:                  ['field', 'timesheets'],
  time_sheet_entries:           ['field', null],
  contact_skills:               ['field', 'credentials'],
  dispatcher_followup_requests: ['field', null],
  service_territories:          ['field', null],
  locations:                    ['field', null],
  gps_points:                   ['field', null],
  crew_phones:                  ['field', null],
  asset_assignments:            ['field', null],
  job_kits:                     ['field', null],
  job_kit_line_items:           ['field', null],
  occurrences:                  ['field', null],
  occurrence_participants:      ['field', null],
  photos:                       ['field', null],
  documents:                    ['field', null],
  activities:                   ['field', null],
  comments:                     ['field', null],
  conversations:                ['field', null],
  messages:                     ['field', null],
  chat_threads:                 ['field', null],
  chat_messages:                ['field', null],
  envelopes:                    ['field', null],
  envelope_recipients:          ['field', null],
  envelope_tabs:                ['field', null],
  envelope_events:              ['field', null],

  // ── Incentives ──────────────────────────────────────────────────────────
  project_payment_requests: ['incentives', 'requests'],
  payment_receipts:         ['incentives', 'received'],
  project_reservations:     ['incentives', null],

  // ── Stock ───────────────────────────────────────────────────────────────
  products:                     ['stock', 'products'],
  product_items:                ['stock', 'inventory'],
  product_assemblies:           ['stock', null],
  product_transfers:            ['stock', null],
  materials_requests:           ['stock', 'requests'],
  materials_request_line_items: ['stock', null],
  equipment:                    ['stock', 'equipment'],
  equipment_information:        ['stock', null],
  price_books:                  ['stock', null],
  price_book_entries:           ['stock', null],

  // ── Fleet ───────────────────────────────────────────────────────────────
  vehicles:             ['fleet', 'vehicles'],
  vehicle_activities:   ['fleet', 'activities'],
  equipment_containers: ['fleet', 'kits'],
  equipment_activities: ['fleet', null],

  // ── Tasks ───────────────────────────────────────────────────────────────
  tasks: ['tasks', 'all'],

  // ── Portal ──────────────────────────────────────────────────────────────
  portal_users:            ['portal', 'users'],
  portals:                 ['portal', 'portals'],
  portal_role_assignments: ['portal', null],

  // ── Reports & Dashboards ────────────────────────────────────────────────
  reports:                    ['reports', 'reports'],
  report_folders:             ['reports', 'folders'],
  report_filters:             ['reports', null],
  report_groupings:           ['reports', null],
  report_calculated_fields:   ['reports', null],
  report_folder_user_shares:  ['reports', null],
  report_folder_role_shares:  ['reports', null],
  scheduled_reports:          ['reports', 'scheduled'],
  scheduled_report_runs:      ['reports', null],
  dashboards:                 ['reports', 'dashboards'],
  dashboard_folders:          ['reports', 'dashboard_folders'],
  dashboard_widgets:          ['reports', null],
  dashboard_filters:          ['reports', null],
  dashboard_folder_user_shares: ['reports', null],
  dashboard_folder_role_shares: ['reports', null],
  widget_types:               ['reports', null],

  // ── Admin / Setup ───────────────────────────────────────────────────────
  programs:                     ['admin', null],
  program_stages:               ['admin', null],
  program_document_requirements: ['admin', null],
  work_types:                   ['admin', null],
  work_type_skill_requirements: ['admin', null],
  work_plan_templates:          ['admin', null],
  work_step_templates:          ['admin', null],
  work_plan_template_entries:   ['admin', null],
  email_templates:              ['admin', null],
  document_templates:           ['admin', null],
  document_template_snapshots:  ['admin', null],
  automation_rules:             ['admin', null],
  validation_rules:             ['admin', null],
  roles:                        ['admin', null],
  picklist_values:              ['admin', null],
  page_layouts:                 ['admin', null],
  page_layout_sections:         ['admin', null],
  page_layout_widgets:          ['admin', null],
  user_page_layout_overrides:   ['admin', null],
  saved_list_views:             ['admin', null],
  skills:                       ['admin', null],
  users:                        ['admin', null],
  field_permissions:            ['admin', null],
  field_history:                ['admin', null],
  field_history_tracked_fields: ['admin', null],
  audit_log:                    ['admin', null],
  notifications:                ['admin', null],
  object_chat_enabled:          ['admin', null],
  user_account_scopes:          ['admin', null],
  user_program_scopes:          ['admin', null],
  opportunity_record_type_price_books: ['admin', null],
  project_report_templates:                        ['admin', null],
  project_report_template_sections:                ['admin', null],
  project_report_template_record_type_assignments: ['admin', null],
  project_report_template_snapshots:               ['admin', null],
}

/**
 * The object's navigation identity. Always returns a usable answer, for any
 * table — registered or not.
 *
 *   { module, moduleLabel, label, section, listUrl }
 *
 * `section` / `listUrl` are null when the object has no list view to link to.
 */
export function objectNavFor(table) {
  const entry = OBJECT_HOME[table] || null
  const moduleId = entry ? entry[0] : DEFAULT_RECORD_MODULE
  const section = entry ? entry[1] : null
  return {
    module: moduleId,
    moduleLabel: MODULE_LABELS[moduleId] || humanizeObjectLabel(moduleId),
    label: humanizeObjectLabel(table),
    section,
    listUrl: section ? `/m/${moduleId}/${section}` : null,
    // Whether this object was explicitly registered. Callers use it only for
    // diagnostics — behavior never depends on it, so an unregistered object
    // still navigates.
    isRegistered: !!entry,
  }
}

/** Host module for an object. Never null. */
export function objectModuleFor(table) {
  return (OBJECT_HOME[table] || [DEFAULT_RECORD_MODULE])[0]
}

/** The object's list-view URL, or null when it has no list anywhere. */
export function objectListUrlFor(table) {
  return objectNavFor(table).listUrl
}

/**
 * Reverse lookup: the object table a module's list section shows, or null for
 * a section that is not object-backed (a module Home tab, a map, a dashboard).
 * Resolved across every module, because the same object's list appears in more
 * than one app.
 */
export function tableForSectionId(moduleId, section) {
  if (!section) return null
  for (const [table, [mod, sec]] of Object.entries(OBJECT_HOME)) {
    if (sec === section && mod === moduleId) return table
  }
  // The same object's list is exposed by several modules under the same id
  // (Field, Project Planning and Project Implementation all show "projects"),
  // so fall back to a module-independent match before giving up.
  for (const [table, [, sec]] of Object.entries(OBJECT_HOME)) {
    if (sec === section) return table
  }
  return Object.prototype.hasOwnProperty.call(OBJECT_HOME, section) ? section : null
}

/** Every registered object table. Diagnostics and fixtures only. */
export function registeredObjectTables() {
  return Object.keys(OBJECT_HOME)
}
