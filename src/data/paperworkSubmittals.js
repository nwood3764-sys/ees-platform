// ===========================================================================
// paperworkSubmittals.js — the program × incentive-application-stage matrix.
//
// EES does not file "paperwork." It files a distinct SUBMITTAL to a program
// administering body at each stage of that program's incentive application,
// and the stages can be months apart. Every program carries the same three
// stages (docs/leap-project-lifecycle.md stages 3, 6, 11):
//
//   1. Income Qualification Application  (lifecycle stage 3)
//   2. Project Reservation               (lifecycle stage 6)
//   3. Final Project Payment Request     (lifecycle stage 11)
//
// A property commonly runs SEVERAL programs at once (IRA HOMES, the HOMES
// AUDIT program, Focus on Energy, HEAR…), and each one has its own full set
// of three stages with its own dates, its own owner, and its own documents.
// That is why WI-IRA-MF-HOMES and WI-IRA-MF-HOMES-AUDIT are separate
// `incentive_applications` record types with separate opportunity stage sets
// ("HOMES Phase 4: Project Reservation" vs "HOMES Audit Phase 4: Project
// Reservation") — the audit is its own program, not a step inside HOMES.
//
// This registry is the single source of truth for WHICH documents belong to
// WHICH (program, stage) submittal. Adding a program or a document is a data
// edit here, never a change to the generation UI.
//
// Coverage note: only the two Wisconsin IRA HOMES multifamily programs have
// document generators today (ported from the Audit Template Builder). Every
// other program is declared with an empty document list so the matrix stays
// visible and the UI can say "no documents built for this submittal yet"
// instead of silently offering the wrong ones.
// ===========================================================================

// ---------------------------------------------------------------------------
// The three incentive application stages. Keys are stable identifiers; labels
// follow LEAP's explicit-naming rule (full descriptive names, no shorthand).
// ---------------------------------------------------------------------------
export const SUBMITTAL_STAGES = Object.freeze({
  INCOME_QUALIFICATION_APPLICATION: 'income_qualification_application',
  PROJECT_RESERVATION:              'project_reservation',
  FINAL_PROJECT_PAYMENT_REQUEST:    'final_project_payment_request',
})

export const SUBMITTAL_STAGE_DEFINITIONS = Object.freeze({
  [SUBMITTAL_STAGES.INCOME_QUALIFICATION_APPLICATION]: {
    key:        SUBMITTAL_STAGES.INCOME_QUALIFICATION_APPLICATION,
    label:      'Income Qualification Application',
    lifecycleStage: 'Stage 3 — Enrollment & Income Qualification',
    // Built already, and NOT here: runIncomeQualification() on enrollments
    // generates the IRA Multifamily Application PDF + Tenant Data Sheet XLSX
    // and attaches them to the enrollment. This registry points at it rather
    // than duplicating it.
    generatedElsewhere: {
      object: 'enrollments',
      action: 'run_income_qualification',
      note:   'Run Income Qualification on the property’s Enrollment record. It generates the program application PDF and the tenant data sheet.',
    },
  },
  [SUBMITTAL_STAGES.PROJECT_RESERVATION]: {
    key:        SUBMITTAL_STAGES.PROJECT_RESERVATION,
    label:      'Project Reservation',
    lifecycleStage: 'Stage 6 — Project Reservation',
    description: 'Reserves the program incentive for this project before work begins. Submitted after the income qualification is accepted; the reservation carries an expiry date.',
  },
  [SUBMITTAL_STAGES.FINAL_PROJECT_PAYMENT_REQUEST]: {
    key:        SUBMITTAL_STAGES.FINAL_PROJECT_PAYMENT_REQUEST,
    label:      'Final Project Payment Request',
    lifecycleStage: 'Stage 11 — Project Payment Request',
    description: 'Claims the reserved incentive after the work is complete and verified. Filed per program at project close, often months after the reservation.',
  },
})

// ---------------------------------------------------------------------------
// Document builders available to submittals. Keys map to the generators in
// paperworkModel.js / paperworkService.js.
// ---------------------------------------------------------------------------
export const DOCUMENTS = Object.freeze({
  ENERGY_AUDIT_INVOICE:      'energy_audit_invoice',
  HOMES_PROJECT_PROPOSAL:    'homes_project_proposal',
  HOMES_PROJECT_INVOICE:     'homes_project_invoice',
  SEALED_PROPOSAL:           'sealed_proposal',
  SEALED_INVOICE:            'sealed_invoice',
  PAPERWORK_WORKBOOK:        'paperwork_workbook',
})

export const DOCUMENT_DEFINITIONS = Object.freeze({
  [DOCUMENTS.ENERGY_AUDIT_INVOICE]: {
    key: DOCUMENTS.ENERGY_AUDIT_INVOICE,
    label: 'Energy Audit Invoice',
    format: 'PDF · one page',
    // The audit program's payment claim: the audit was performed, the program
    // incentive is applied as an instant discount, TOTAL DUE $0.00.
    requiresAssetScoreReports: false,
  },
  [DOCUMENTS.HOMES_PROJECT_PROPOSAL]: {
    key: DOCUMENTS.HOMES_PROJECT_PROPOSAL,
    label: 'Wisconsin IRA HOMES Program Project Proposal',
    format: 'PDF',
    requiresAssetScoreReports: true,
  },
  [DOCUMENTS.HOMES_PROJECT_INVOICE]: {
    key: DOCUMENTS.HOMES_PROJECT_INVOICE,
    label: 'HOMES Project Invoice',
    format: 'PDF',
    requiresAssetScoreReports: true,
  },
  [DOCUMENTS.SEALED_PROPOSAL]: {
    key: DOCUMENTS.SEALED_PROPOSAL,
    label: 'Sealed Proposal',
    format: 'PDF',
    note: 'Used when Sealed, Inc. is the primary contractor and EES is the line-item contractor.',
    requiresAssetScoreReports: true,
  },
  [DOCUMENTS.SEALED_INVOICE]: {
    key: DOCUMENTS.SEALED_INVOICE,
    label: 'Sealed Invoice',
    format: 'PDF',
    note: 'Used when Sealed, Inc. is the primary contractor and EES is the line-item contractor.',
    requiresAssetScoreReports: true,
  },
  [DOCUMENTS.PAPERWORK_WORKBOOK]: {
    key: DOCUMENTS.PAPERWORK_WORKBOOK,
    label: 'Paperwork Workbook',
    format: 'Excel · all sheets',
    note: 'Reference workbook carrying the audit invoice, proposal-contract, and project invoice sheets together.',
    requiresAssetScoreReports: true,
  },
})

// ---------------------------------------------------------------------------
// THE MATRIX. Program key = the `incentive_applications` record-type value.
// Each program declares the document set for each of its three stages.
// ---------------------------------------------------------------------------
const NO_DOCUMENTS_BUILT = Object.freeze({
  [SUBMITTAL_STAGES.PROJECT_RESERVATION]: [],
  [SUBMITTAL_STAGES.FINAL_PROJECT_PAYMENT_REQUEST]: [],
})

export const PROGRAM_SUBMITTALS = Object.freeze({
  wi_ira_mf_homes_audit: {
    key: 'wi_ira_mf_homes_audit',
    label: 'WI-IRA-MF-HOMES-AUDIT',
    programName: 'IRA HOMES — Wisconsin (Multifamily Energy Audit)',
    documentsByStage: {
      // The audit is its own program: EES performs the whole-building audit,
      // then claims the audit incentive. The Energy Audit Invoice IS that
      // claim — one page, $2,000 gross, incentive applied, TOTAL DUE $0.00.
      [SUBMITTAL_STAGES.PROJECT_RESERVATION]: [],
      [SUBMITTAL_STAGES.FINAL_PROJECT_PAYMENT_REQUEST]: [
        DOCUMENTS.ENERGY_AUDIT_INVOICE,
      ],
    },
  },
  wi_ira_mf_homes: {
    key: 'wi_ira_mf_homes',
    label: 'WI-IRA-MF-HOMES',
    programName: 'IRA HOMES — Wisconsin (Multifamily Construction)',
    documentsByStage: {
      [SUBMITTAL_STAGES.PROJECT_RESERVATION]: [
        DOCUMENTS.HOMES_PROJECT_PROPOSAL,
        DOCUMENTS.SEALED_PROPOSAL,
        DOCUMENTS.PAPERWORK_WORKBOOK,
      ],
      [SUBMITTAL_STAGES.FINAL_PROJECT_PAYMENT_REQUEST]: [
        DOCUMENTS.HOMES_PROJECT_INVOICE,
        DOCUMENTS.SEALED_INVOICE,
        DOCUMENTS.PAPERWORK_WORKBOOK,
      ],
    },
  },
  // Programs whose submittal documents are not built yet. Declared so the
  // matrix is complete and the UI reports the gap honestly.
  wi_ira_sf_homes:       { key: 'wi_ira_sf_homes',       label: 'WI-IRA-SF-HOMES',       programName: 'IRA HOMES — Wisconsin (Single Family)',              documentsByStage: NO_DOCUMENTS_BUILT },
  wi_ira_sf_homes_audit: { key: 'wi_ira_sf_homes_audit', label: 'WI-IRA-SF-HOMES-AUDIT', programName: 'IRA HOMES — Wisconsin (Single Family Energy Audit)', documentsByStage: NO_DOCUMENTS_BUILT },
  wi_ira_mf_hear:        { key: 'wi_ira_mf_hear',        label: 'WI-IRA-MF-HEAR',        programName: 'IRA HEAR — Wisconsin (Multifamily)',                 documentsByStage: NO_DOCUMENTS_BUILT },
  wi_ira_sf_hear:        { key: 'wi_ira_sf_hear',        label: 'WI-IRA-SF-HEAR',        programName: 'IRA HEAR — Wisconsin (Single Family)',               documentsByStage: NO_DOCUMENTS_BUILT },
  wi_foe:                { key: 'wi_foe',                label: 'WI-FOE',                programName: 'Focus on Energy — Wisconsin',                        documentsByStage: NO_DOCUMENTS_BUILT },
  electrify_denver:      { key: 'electrify_denver',      label: 'Electrify Denver',      programName: 'Denver Electrification',                             documentsByStage: NO_DOCUMENTS_BUILT },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Document keys for one (program, stage) submittal. Empty array when none are built. */
export function documentsForSubmittal(programKey, stageKey) {
  const program = PROGRAM_SUBMITTALS[programKey]
  if (!program) return []
  return program.documentsByStage?.[stageKey] || []
}

/** Every program that has at least one document built for this stage. */
export function programsWithDocumentsForStage(stageKey) {
  return Object.values(PROGRAM_SUBMITTALS)
    .filter(p => (p.documentsByStage?.[stageKey] || []).length > 0)
}

/** Resolve the full document definitions (not just keys) for a submittal. */
export function documentDefinitionsForSubmittal(programKey, stageKey) {
  return documentsForSubmittal(programKey, stageKey)
    .map(k => DOCUMENT_DEFINITIONS[k])
    .filter(Boolean)
}
