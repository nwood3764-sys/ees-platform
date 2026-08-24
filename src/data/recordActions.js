// ===========================================================================
// recordActions.js
//
// Single-source-of-truth registry for every action that can appear in the
// RecordDetail topbar. Replaces the prior pattern of hardcoded conditional
// buttons in RecordDetail.jsx (which had grown unwieldy as actions
// accumulated: Edit, Clone, Delete, Generate Report, Schedule, Reschedule,
// Send for Signature, Publish, Unpublish, Archive, Restore, Preview, …).
//
// Architecture
// ------------
// Three concepts:
//
//   1. Registry (this file). Every action declared with: a stable key,
//      display label + icon, color, the objects it applies to, a
//      runtime `isAvailable(ctx)` predicate that filters by record
//      state, a `defaultTier` that says whether the action lands in
//      the visible primary cluster or in the Actions overflow menu by
//      default, and a `defaultSortOrder` that establishes the order
//      within its tier.
//
//   2. Overrides (page_layout_actions table). Per-layout rows that
//      override the registry's `defaultTier` / sort_order / label for
//      a specific action_key. Authored in LayoutEditor's Actions
//      section. Absence of an override row means "use registry
//      default."
//
//   3. Handlers (RecordDetail.jsx). The actual onClick functions live
//      with the state they operate on. RecordDetail builds a
//      `{[action_key]: handler}` map and hands it to TopbarActions.
//      The registry decides WHAT renders; RecordDetail wires HOW it
//      executes.
//
// Adding a new action
// -------------------
// 1. Define an ACTION_KEY entry below.
// 2. Add to ACTION_REGISTRY with applicableObjects, defaultTier,
//    defaultSortOrder, label, icon, color, and isAvailable.
// 3. In RecordDetail.jsx, add the handler to the actionHandlers map
//    in the topbar render.
// 4. (Optional) In LayoutEditor's Actions section, the new action
//    appears automatically — admins can promote/demote per layout.
// ===========================================================================

// ---------------------------------------------------------------------------
// Action keys — exported as a const map for use in handler maps and the
// LayoutEditor Actions section.
// ---------------------------------------------------------------------------
// Which work order record types have an energy assessment report, and which
// report each one gets, is declared once in the pure registry — never as a
// string comparison here.
import { hasAssessmentReport } from '../lib/assessmentReport'

export const ACTION_KEYS = Object.freeze({
  EDIT:                    'edit',
  CLONE:                   'clone',
  DELETE:                  'delete',
  LOG_ACTIVITY:            'log_activity',
  ADVANCE_TO_OPPORTUNITY:  'advance_to_opportunity',
  RUN_INCOME_QUALIFICATION:'run_income_qualification',
  VERIFY_FIELDS:           'verify_fields',
  GENERATE_REPORT:         'generate_report',
  GENERATE_PROJECT_RESERVATION_SUBMITTAL:   'generate_project_reservation_submittal',
  GENERATE_FINAL_PAYMENT_REQUEST_SUBMITTAL: 'generate_final_payment_request_submittal',
  GENERATE_QUALITY_INSTALL_TOOL:            'generate_quality_install_tool',
  GENERATE_ENERGY_ASSESSMENT_REPORT:        'generate_energy_assessment_report',
  GENERATE_PREAPPROVAL_APPLICATION:         'generate_preapproval_application',
  SCHEDULE_WORK_ORDERS:    'schedule_work_orders',
  RESCHEDULE_WORK_ORDERS:  'reschedule_work_orders',
  SCHEDULE_WORK_ORDER:     'schedule_work_order',
  RESCHEDULE_APPOINTMENT:  'reschedule_appointment',
  SEND_FOR_SIGNATURE:      'send_for_signature',
  RESEND_SIGNING_EMAIL:    'resend_signing_email',
  VOID_ENVELOPE:           'void_envelope',
  PREVIEW_PDF:             'preview_pdf',
  PREVIEW_DOCUMENT:        'preview_document',
  VIEW_OWNER_PORTAL:       'view_owner_portal',
  VIEW_AS_PORTAL_USER:     'view_as_portal_user',
  PREVIEW_EMAIL:           'preview_email',
  CLONE_TEMPLATE:          'clone_template',
  EDIT_SUBMITTAL_TEMPLATE: 'edit_submittal_template',
  PUBLISH:                 'publish',
  UNPUBLISH:               'unpublish',
  ARCHIVE:                 'archive',
  RESTORE:                 'restore',
  MERGE_ACCOUNT:           'merge_account',
  ADD_TO_PORTAL:           'add_to_portal',
  ISSUE_TO_PROVIDER:       'issue_to_provider',
})

// ---------------------------------------------------------------------------
// Universal applicability — the literal string '*' on `applicableObjects`
// means "every object". Encoded as a separate sentinel rather than a list
// of every table name to keep the registry compact and self-documenting.
// ---------------------------------------------------------------------------
export const ALL_OBJECTS = '*'

// ---------------------------------------------------------------------------
// Color palette — paired with C.* from constants.js. Defining a named set
// here so each action's color choice is stable across desktop/mobile.
// ---------------------------------------------------------------------------
export const ACTION_COLORS = Object.freeze({
  EMERALD:    'emerald',           // primary affirmative
  BLUE:       'blue',              // scheduling / time-related
  SKY:        'sky',               // preview / read-only
  AMBER:      'amber',             // caution / unpublish / archive
  RED:        'red',               // destructive — delete / void
  NEUTRAL:    'neutral',           // clone / default
})

// ---------------------------------------------------------------------------
// THE REGISTRY.
//
// Each entry shape:
//   key                  — stable identifier, matches pla_action_key
//   label                — UI label
//   icon                 — SVG path string for the Icon component
//   color                — one of ACTION_COLORS
//   applicableObjects    — ALL_OBJECTS or array of table names
//   defaultTier          — 'primary' | 'menu'
//   defaultSortOrder     — integer; lower = earlier within tier
//   isAvailable(ctx)     — runtime predicate; ctx shape documented below
//
// isAvailable's ctx shape:
//   {
//     tableName,            // string
//     record,               // the record row
//     editing,              // boolean — true while user is in edit mode
//     statusLabel,          // resolved status label or null
//     lifecycle,            // lifecycle config object or null
//     lifecycleStatusValue, // 'Draft' | 'Active' | 'Archived' | null
//     lifecycleIsLocked,    // boolean
//     hasActiveTemplate,    // boolean — Send for Signature gate
//     envelopeIsResendable, // boolean
//     envelopeIsVoidable,   // boolean
//     hasRelatedObject,     // boolean — for template-record preview gates
//   }
//
// All actions are HIDDEN while `editing===true` except for Save and Cancel,
// which are NOT in this registry (they're built into the edit-mode shell
// in RecordDetail because they need direct access to the editor state).
// ---------------------------------------------------------------------------
export const ACTION_REGISTRY = Object.freeze({
  // ── Properties ────────────────────────────────────────────────────────────
  advance_to_opportunity: {
    key:                 ACTION_KEYS.ADVANCE_TO_OPPORTUNITY,
    label:               'Advance to Opportunity',
    icon:                'M13 7l5 5m0 0l-5 5m5-5H6',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['properties'],
    defaultTier:         'primary',
    defaultSortOrder:    15,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'properties',
  },

  // ── Activity logging — outreach objects ────────────────────────────────
  // Surfaces "Log Activity" in the record header so it's reachable from any
  // tab (the same composer also lives in the Activity timeline). Opens the
  // LogActivityModal, which logs a call/email/meeting/site visit/event/note
  // via the log_activity RPC.
  log_activity: {
    key:                 ACTION_KEYS.LOG_ACTIVITY,
    label:               'Log Activity',
    icon:                'M12 5v14M5 12h14',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['opportunities', 'properties', 'contacts', 'accounts'],
    defaultTier:         'primary',
    defaultSortOrder:    12,
    isAvailable: ({ editing }) => !editing,
  },

  edit: {
    key:                 ACTION_KEYS.EDIT,
    label:               'Edit',
    icon:                'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'primary',
    defaultSortOrder:    10,
    isAvailable: ({ editing, lifecycleIsLocked, recordIsLocked }) => !editing && !lifecycleIsLocked && !recordIsLocked,
  },

  // ── Projects ────────────────────────────────────────────────────────────
  generate_report: {
    key:                 ACTION_KEYS.GENERATE_REPORT,
    label:               'Generate Report',
    icon:                'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['projects'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'projects',
  },
  // ── Portal View As (Salesforce "Login As" parity) ───────────────────────
  // Two deliberately separate actions, because they answer two different
  // questions and one cannot stand in for the other:
  //
  //   view_owner_portal   (accounts)     — what a full-portfolio owner at this
  //                                        account WOULD see. Works with no
  //                                        portal user in existence, which is
  //                                        the point: nobody is invited until
  //                                        an admin has confirmed the content
  //                                        displays correctly.
  //   view_as_portal_user (portal_users) — what this specific person sees right
  //                                        now, through their own grants.
  //
  // Both are Admin-only in the UI and, independently, enforced server-side by
  // app_is_admin() inside the portal RPCs; every session is logged to
  // portal_view_as_sessions.
  view_owner_portal: {
    key:                 ACTION_KEYS.VIEW_OWNER_PORTAL,
    label:               'View Owner Portal',
    icon:                'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['accounts'],
    defaultTier:         'menu',
    defaultSortOrder:    40,
    isAvailable: ({ tableName, editing, isSystemAdmin }) =>
      !editing && tableName === 'accounts' && !!isSystemAdmin,
  },
  view_as_portal_user: {
    key:                 ACTION_KEYS.VIEW_AS_PORTAL_USER,
    label:               'View Portal as This User',
    icon:                'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['portal_users'],
    defaultTier:         'menu',
    defaultSortOrder:    41,
    isAvailable: ({ tableName, editing, isSystemAdmin }) =>
      !editing && tableName === 'portal_users' && !!isSystemAdmin,
  },
  // ── Program submittals ──────────────────────────────────────────────────
  // Each program runs its own incentive application with three stages that
  // can be months apart (docs/leap-project-lifecycle.md stages 3/6/11). Each
  // stage is its own submittal with its own document set, so it gets its own
  // explicitly-named action — never one generic "paperwork" button.
  //
  // Stage 1 (Income Qualification Application) is deliberately absent here:
  // it is generated by `run_income_qualification` on the ENROLLMENT record,
  // which produces the program application PDF and the tenant data sheet.
  generate_project_reservation_submittal: {
    key:                 ACTION_KEYS.GENERATE_PROJECT_RESERVATION_SUBMITTAL,
    label:               'Generate Project Reservation Submittal',
    icon:                'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z M14 3v6h6 M9 13h6 M9 17h4',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['projects'],
    defaultTier:         'menu',
    defaultSortOrder:    25,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'projects',
  },
  generate_final_payment_request_submittal: {
    key:                 ACTION_KEYS.GENERATE_FINAL_PAYMENT_REQUEST_SUBMITTAL,
    label:               'Generate Final Project Payment Request Submittal',
    icon:                'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z M14 3v6h6 M9 13h6 M9 17h4',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['projects'],
    defaultTier:         'menu',
    defaultSortOrder:    26,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'projects',
  },
  // Quality Install (QI) Tool — on the WI-IRA-MF-HOMES Final Project Payment
  // Request INCENTIVE APPLICATION. Opens a picker over every evidence photo
  // captured on any work order under the incentive application's opportunity;
  // the Project Coordinator selects + categorizes them and exports a ZIP + PDF
  // (the PDF is saved as the record's qi_tool_pdf document). Gated to the
  // payment-request record type via the resolved record-type label in ctx.
  generate_quality_install_tool: {
    key:                 ACTION_KEYS.GENERATE_QUALITY_INSTALL_TOOL,
    label:               'Quality Install Tool (Photos)',
    icon:                'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16v12H4z',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['incentive_applications'],
    defaultTier:         'menu',
    defaultSortOrder:    27,
    isAvailable: ({ tableName, editing, recordTypeLabel }) =>
      !editing && tableName === 'incentive_applications' && recordTypeLabel === 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST',
  },
  // Open the Focus On Energy pre-approval application (hosted on Formstack),
  // pre-filled from THIS enrollment, in a new tab. The assessor reviews, attaches
  // the required documents (which a URL cannot pre-fill), and submits. Gated to
  // the WI-IRA-MF-HOMES assessment pre-approval record type via the resolved
  // record-type label in ctx. The target form + field wiring are data-driven
  // (external_form_targets / external_form_field_map).
  generate_preapproval_application: {
    key:                 ACTION_KEYS.GENERATE_PREAPPROVAL_APPLICATION,
    label:               'Open Pre-Approval Application',
    icon:                'M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5M15 3h6m0 0v6m0-6L10 14',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['enrollments'],
    defaultTier:         'primary',
    defaultSortOrder:    22,
    isAvailable: ({ tableName, editing, recordTypeLabel }) =>
      !editing && tableName === 'enrollments' && recordTypeLabel === 'WI-IRA-MF-HOMES-Assessment-Preapproval',
  },
  run_income_qualification: {
    key:                 ACTION_KEYS.RUN_INCOME_QUALIFICATION,
    label:               'Run Income Qualification',
    icon:                'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['enrollments'],
    defaultTier:         'primary',
    defaultSortOrder:    15,
    // Only on enrollments whose RECORD TYPE runs income qualification (flagged
    // on the record type — the six IRA programs, not the HOMES Assessment /
    // Project-Reservation stages), and only until it has been run once. The
    // run persists enrollment_determination_date; once set, it never runs
    // again, so the action drops off.
    isAvailable: ({ tableName, editing, recordTypeRequiresIncomeQualification, incomeQualificationComplete }) =>
      !editing
      && tableName === 'enrollments'
      && recordTypeRequiresIncomeQualification === true
      && !incomeQualificationComplete,
  },
  // ── Incentive Applications ────────────────────────────────────────────────
  // Verify Fields checks every editable field on the record's layout is
  // populated (inherited/read-only related fields are skipped, but the lookups
  // that drive them are checked) so the JotForm-mirrored submittal is confirmed
  // ready to export before it's keyed into the program portal.
  verify_fields: {
    key:                 ACTION_KEYS.VERIFY_FIELDS,
    label:               'Verify Fields',
    icon:                'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['incentive_applications'],
    defaultTier:         'primary',
    defaultSortOrder:    16,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'incentive_applications',
  },
  schedule_work_orders: {
    key:                 ACTION_KEYS.SCHEDULE_WORK_ORDERS,
    label:               'Schedule Work Orders',
    icon:                'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['projects'],
    defaultTier:         'primary',
    defaultSortOrder:    30,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'projects',
  },
  reschedule_work_orders: {
    key:                 ACTION_KEYS.RESCHEDULE_WORK_ORDERS,
    label:               'Reschedule Work Orders',
    icon:                'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6 M16 2v4 M8 2v4 M3 10h18 M16 14v2.5l1.5 1.5 M16 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    color:               ACTION_COLORS.BLUE,
    applicableObjects:   ['projects'],
    defaultTier:         'menu',
    defaultSortOrder:    40,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'projects',
  },

  // ── Work orders ─────────────────────────────────────────────────────────
  schedule_work_order: {
    key:                 ACTION_KEYS.SCHEDULE_WORK_ORDER,
    label:               'Schedule',
    icon:                'M8 2v4 M16 2v4 M3 10h18 M19 16v6 M22 19h-6 M21 12.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['work_orders'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing, statusLabel }) =>
      !editing && tableName === 'work_orders' && statusLabel === 'To Be Scheduled',
  },
  // The assessment's OWN deliverable — the write-up of what the assessor found
  // on the building, generated from the work order that captured it. It is not
  // a program submittal: Project Reservation and Final Project Payment Request
  // are filings to a program administering body and live on the PROJECT.
  //
  // Gated on the work order's record type VALUE, because which report this is
  // follows what was assessed (a whole multifamily building vs a single-family
  // home), and each shape has its own document key and its own template.
  generate_energy_assessment_report: {
    key:                 ACTION_KEYS.GENERATE_ENERGY_ASSESSMENT_REPORT,
    label:               'Generate Energy Assessment Report',
    icon:                'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z M14 3v6h6 M8 13h8 M8 17h5',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['work_orders'],
    defaultTier:         'menu',
    defaultSortOrder:    24,
    isAvailable: ({ tableName, editing, recordTypeValue }) =>
      !editing && tableName === 'work_orders' && hasAssessmentReport(recordTypeValue),
  },
  issue_to_provider: {
    key:                 ACTION_KEYS.ISSUE_TO_PROVIDER,
    label:               'Issue to Provider',
    icon:                'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M9 14l2 2 4-4',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['work_orders'],
    defaultTier:         'menu',
    defaultSortOrder:    25,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'work_orders',
  },

  // ── Service appointments ────────────────────────────────────────────────
  reschedule_appointment: {
    key:                 ACTION_KEYS.RESCHEDULE_APPOINTMENT,
    label:               'Reschedule',
    icon:                'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6 M16 2v4 M8 2v4 M3 10h18 M16 14v2.5l1.5 1.5 M16 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    color:               ACTION_COLORS.BLUE,
    applicableObjects:   ['service_appointments'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'service_appointments',
  },

  // ── Send for Signature — gated by hasActiveTemplate, applies broadly ──
  send_for_signature: {
    key:                 ACTION_KEYS.SEND_FOR_SIGNATURE,
    label:               'Send for Signature',
    icon:                'M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z M16 8L2 22 M17.5 15H9',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'primary',
    defaultSortOrder:    50,
    isAvailable: ({ editing, hasActiveTemplate }) => !editing && hasActiveTemplate === true,
  },

  // ── Envelopes ───────────────────────────────────────────────────────────
  resend_signing_email: {
    key:                 ACTION_KEYS.RESEND_SIGNING_EMAIL,
    label:               'Resend Email',
    icon:                'M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.4 1.05L3.5 11l13.5 1L3.5 13l-1.5 6.35a1 1 0 0 0 1.4 1.05z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['envelopes'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing, envelopeIsResendable }) =>
      !editing && tableName === 'envelopes' && envelopeIsResendable === true,
  },
  void_envelope: {
    key:                 ACTION_KEYS.VOID_ENVELOPE,
    label:               'Void',
    icon:                'M18.36 5.64a9 9 0 1 1-12.72 0M5.64 5.64l12.72 12.72',
    color:               ACTION_COLORS.AMBER,
    applicableObjects:   ['envelopes'],
    defaultTier:         'menu',
    defaultSortOrder:    30,
    isAvailable: ({ tableName, editing, envelopeIsVoidable }) =>
      !editing && tableName === 'envelopes' && envelopeIsVoidable === true,
  },

  // ── Template previews (PRT / document / email) ──────────────────────────
  preview_pdf: {
    key:                 ACTION_KEYS.PREVIEW_PDF,
    label:               'Preview PDF',
    icon:                'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['project_report_templates'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'project_report_templates',
  },
  preview_document: {
    key:                 ACTION_KEYS.PREVIEW_DOCUMENT,
    label:               'Preview PDF',
    icon:                'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['document_templates'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing, hasRelatedObject }) =>
      !editing && tableName === 'document_templates' && hasRelatedObject === true,
  },
  preview_email: {
    key:                 ACTION_KEYS.PREVIEW_EMAIL,
    label:               'Preview Email',
    icon:                'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['email_templates'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing, hasRelatedObject }) =>
      !editing && tableName === 'email_templates' && hasRelatedObject === true,
  },

  // ── Lifecycle (publishable templates) ───────────────────────────────────
  clone_template: {
    key:                 ACTION_KEYS.CLONE_TEMPLATE,
    label:               'Clone Template',
    icon:                'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    60,
    isAvailable: ({ editing, lifecycle }) => !editing && !!lifecycle,
  },
  edit_submittal_template: {
    key:                 ACTION_KEYS.EDIT_SUBMITTAL_TEMPLATE,
    label:               'Edit Sections',
    icon:                'M4 6h16M4 12h10M4 18h7 M15 15l3 3 4-5',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['submittal_document_templates'],
    defaultTier:         'primary',
    defaultSortOrder:    12,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'submittal_document_templates',
  },
  publish: {
    key:                 ACTION_KEYS.PUBLISH,
    label:               'Publish',
    icon:                'M5 13l4 4L19 7',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'primary',
    defaultSortOrder:    70,
    isAvailable: ({ editing, lifecycle, lifecycleStatusValue }) =>
      !editing && !!lifecycle && lifecycleStatusValue === 'Draft',
  },
  unpublish: {
    key:                 ACTION_KEYS.UNPUBLISH,
    label:               'Unpublish',
    icon:                'M3 10h11a4 4 0 014 4v0a4 4 0 01-4 4h-3M3 10l5 5m-5-5l5-5',
    color:               ACTION_COLORS.AMBER,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    80,
    isAvailable: ({ editing, lifecycle, lifecycleStatusValue }) =>
      !editing && !!lifecycle && lifecycleStatusValue === 'Active',
  },
  archive: {
    key:                 ACTION_KEYS.ARCHIVE,
    label:               'Archive',
    icon:                'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
    color:               ACTION_COLORS.NEUTRAL,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    85,
    isAvailable: ({ editing, lifecycle, lifecycleStatusValue }) =>
      !editing && !!lifecycle && lifecycleStatusValue === 'Active',
  },
  restore: {
    key:                 ACTION_KEYS.RESTORE,
    label:               'Restore to Draft',
    icon:                'M3 10h11a4 4 0 014 4v0a4 4 0 01-4 4h-3M3 10l5 5m-5-5l5-5',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'primary',
    defaultSortOrder:    90,
    isAvailable: ({ editing, lifecycle, lifecycleStatusValue }) =>
      !editing && !!lifecycle && lifecycleStatusValue === 'Archived',
  },

  // ── Accounts ──────────────────────────────────────────────────────────────
  merge_account: {
    key:                 ACTION_KEYS.MERGE_ACCOUNT,
    label:               'Merge',
    icon:                'M7 8l-4 4 4 4M3 12h12a4 4 0 004-4V4M17 16l4-4-4-4',
    color:               ACTION_COLORS.NEUTRAL,
    applicableObjects:   ['accounts'],
    defaultTier:         'menu',
    defaultSortOrder:    50,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'accounts',
  },
  // ── Contacts ──────────────────────────────────────────────────────────────
  // Portal access is granted per CONTACT: adding a contact to the portal is the
  // single place you pick their role and which of their account's properties
  // they can view. There is no separate "add account to portal" step.
  add_to_portal: {
    key:                 ACTION_KEYS.ADD_TO_PORTAL,
    label:               'Add to Portal',
    icon:                'M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['contacts'],
    defaultTier:         'menu',
    defaultSortOrder:    48,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'contacts',
  },

  // ── Universal — defaulted to menu so they don't crowd the primary row ──
  clone: {
    key:                 ACTION_KEYS.CLONE,
    label:               'Clone',
    icon:                'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3',
    color:               ACTION_COLORS.NEUTRAL,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    900,
    isAvailable: ({ editing }) => !editing,
  },
  delete: {
    key:                 ACTION_KEYS.DELETE,
    label:               'Delete',
    icon:                'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z',
    color:               ACTION_COLORS.RED,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    1000,
    isAvailable: ({ editing }) => !editing,
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return every action definition that is applicable to the given object
 * (by table name). Does NOT filter by runtime availability — that's done
 * later inside resolveTopbarActions().
 */
export function actionsForObject(objectName) {
  return Object.values(ACTION_REGISTRY).filter(a =>
    a.applicableObjects === ALL_OBJECTS ||
    (Array.isArray(a.applicableObjects) && a.applicableObjects.includes(objectName))
  )
}

/**
 * Resolve the final, ordered topbar action lists (primary + menu) given:
 *   - objectName            — table name of the record being viewed
 *   - ctx                   — see ACTION_REGISTRY.* isAvailable shape
 *   - overrides             — page_layout_actions rows for the active layout
 *
 * Algorithm:
 *   1. Take registry entries applicable to the object.
 *   2. Drop entries where isAvailable(ctx) returns falsy.
 *   3. For each remaining entry, look up an override row by action_key.
 *      If found, apply the override's pla_display_tier / pla_sort_order /
 *      pla_label_override. Otherwise use the registry defaults.
 *   4. Group by tier. Sort each group by effective sortOrder, then label.
 *
 * Returns { primary: [...], menu: [...] } where each element is:
 *   { key, label, icon, color, sortOrder }
 *
 * Overrides whose action_key isn't in the registry are silently ignored
 * (forward-compat: a config row authored for an action that was later
 * removed from the registry shouldn't blow up the topbar).
 */
export function resolveTopbarActions({ objectName, ctx, overrides = [] }) {
  const overridesByKey = new Map()
  for (const o of overrides || []) {
    if (o?.pla_action_key && !o.pla_is_deleted) {
      overridesByKey.set(o.pla_action_key, o)
    }
  }

  const applicable = actionsForObject(objectName)
    .filter(def => {
      try { return def.isAvailable(ctx) }
      catch { return false }
    })

  const resolved = applicable.map(def => {
    const ov = overridesByKey.get(def.key)
    return {
      key:       def.key,
      label:     ov?.pla_label_override || def.label,
      icon:      def.icon,
      color:     def.color,
      tier:      ov?.pla_display_tier || def.defaultTier,
      sortOrder: typeof ov?.pla_sort_order === 'number'
                    ? ov.pla_sort_order
                    : def.defaultSortOrder,
    }
  })

  const sortFn = (a, b) =>
    (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label)

  return {
    primary: resolved.filter(a => a.tier === 'primary').sort(sortFn),
    menu:    resolved.filter(a => a.tier === 'menu').sort(sortFn),
  }
}

/**
 * Build the LayoutEditor's Actions section data: every registry entry
 * applicable to the layout's object, paired with its current override
 * (if any). UI uses this to render the per-layout configuration table.
 *
 * Returned shape:
 *   [{
 *     definition: <registry entry>,
 *     override:   <pla row | null>,
 *     effectiveTier:      'primary' | 'menu',
 *     effectiveSortOrder: integer,
 *     effectiveLabel:     string,
 *   }]
 *
 * Ordered by (effectiveSortOrder, label). Suitable to display as-is.
 */
export function buildLayoutActionConfig({ objectName, overrides = [] }) {
  const overridesByKey = new Map()
  for (const o of overrides || []) {
    if (o?.pla_action_key && !o.pla_is_deleted) {
      overridesByKey.set(o.pla_action_key, o)
    }
  }

  const rows = actionsForObject(objectName).map(def => {
    const ov = overridesByKey.get(def.key) || null
    return {
      definition: def,
      override:   ov,
      effectiveTier:      ov?.pla_display_tier || def.defaultTier,
      effectiveSortOrder: typeof ov?.pla_sort_order === 'number'
                              ? ov.pla_sort_order
                              : def.defaultSortOrder,
      effectiveLabel:     ov?.pla_label_override || def.label,
    }
  })

  rows.sort((a, b) =>
    (a.effectiveSortOrder - b.effectiveSortOrder) ||
    a.effectiveLabel.localeCompare(b.effectiveLabel)
  )

  return rows
}

/**
 * Resolve a color name from ACTION_COLORS into concrete style values.
 * Pure function so it can be used in both desktop and mobile renderers
 * without re-implementing the palette.
 *
 * The returned shape:
 *   { fg, bg, border, hoverBg, hoverBorder }
 * Suitable to spread into inline styles. Caller chooses which fields to
 * actually apply — a button might use {color: fg, border, background:bg}
 * while an overflow-menu item only uses {color: fg}.
 */
export function actionColors(C, color) {
  switch (color) {
    case ACTION_COLORS.EMERALD:
      return {
        fg: C.emerald, bg: C.page,
        border: '#a7f3d0', hoverBg: '#ecfdf5', hoverBorder: '#a7f3d0',
      }
    case ACTION_COLORS.BLUE:
      return {
        fg: '#2563eb', bg: C.page,
        border: '#bfdbfe', hoverBg: '#eff6ff', hoverBorder: '#bfdbfe',
      }
    case ACTION_COLORS.SKY:
      return {
        fg: '#0369a1', bg: C.page,
        border: '#bae6fd', hoverBg: '#f0f9ff', hoverBorder: '#bae6fd',
      }
    case ACTION_COLORS.AMBER:
      return {
        fg: '#1e466b', bg: C.page,
        border: '#7eb3e8', hoverBg: '#eef5fc', hoverBorder: '#7eb3e8',
      }
    case ACTION_COLORS.RED:
      return {
        fg: '#1a5a8a', bg: C.page,
        border: C.border, hoverBg: '#e8f1fb', hoverBorder: '#bcd9f2',
      }
    case ACTION_COLORS.NEUTRAL:
    default:
      return {
        fg: C.textSecondary, bg: C.page,
        border: C.border, hoverBg: '#eef2f7', hoverBorder: C.border,
      }
  }
}
