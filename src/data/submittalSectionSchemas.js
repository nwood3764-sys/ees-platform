// ---------------------------------------------------------------------------
// submittalSectionSchemas.js — typed config schemas for the submittal document
// section types, driving the form in SubmittalDocumentTemplateEditor.
//
// Follows the shape of sectionConfigSchemas.js: each section type maps to an
// array of field descriptors; the editor renders a form from the descriptors
// and writes back to the section's sdts_config jsonb. Section types with no
// descriptors (or unknown to this map) fall back to a raw JSON editor, exactly
// like SectionConfigEditorWidget.
//
// Field descriptor shape:
//   {
//     key:          'heading',                 // jsonb key
//     label:        'Heading',
//     type:         'text' | 'textarea' | 'select' | 'string_list' | 'row_grid' | 'info',
//     default:      <value>,                   // default for a new section
//     placeholder?: 'shown when empty',
//     options?:     [{ value, label }],        // for select
//     columns?:     ['# ', 'Service', …],      // for row_grid — column headers
//     description?: 'help text',
//   }
//
// The palette (which section types can be added, grouped by document engine) is
// derived from SECTION_TYPES_BY_ENGINE in paperworkModel so it stays in lockstep
// with the renderers — a section type that has no renderer can never be added.
// ---------------------------------------------------------------------------

import { DOCUMENT_KIND_ENGINE, SECTION_TYPES_BY_ENGINE } from './paperworkModel.js'

// Sealed, Inc.'s fixed contractor block, as a default the editor can override.
const SEALED_PRIMARY_LINES = ['Sealed, Inc.', '200 E Verona Ave', 'Verona, WI 53593', '(949) 832-6798']

export const SUBMITTAL_SECTION_SCHEMAS = {
  // --- EES documents -------------------------------------------------------
  company_header: [
    { key: '__info__', type: 'info',
      description: 'Company name (from the Submittal Document Wording), the INVOICE word or the centred proposal title, and the hairline rule. No per-section options.' },
  ],
  document_meta_and_parties: [
    { key: '__info__', type: 'info',
      description: 'Invoice/date/terms meta stack plus the PROPERTY / INSTALLATION and BILL TO columns, filled from the record. No per-section options.' },
  ],
  audit_services_table: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Audit Services' },
    { key: 'rows', label: 'Service Rows', type: 'row_grid',
      columns: ['#', 'Service Description', 'Qty', 'Unit', 'Rate', 'Amount'],
      default: [
        ['1', 'Whole-Building Energy Audit — Multifamily', '1', 'Building', '$2,000.00', '$2,000.00'],
        ['2', 'Per-Unit Blower Door and Diagnostic Testing', '', 'Unit', '', 'Included'],
        ['3', 'Common Area and Building Envelope Assessment', '1', 'Lump Sum', '', 'Included'],
        ['4', 'Mechanical Systems Survey', '1', 'Lump Sum', '', 'Included'],
      ],
      description: 'Fixed service lines for the Energy Audit Invoice. Amounts are literal text here (the audit invoice total is a flat $2,000).' },
  ],
  measure_line_items_table: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Proposed Scope of Work — HOMES Project',
      description: 'The measure rows and their amounts are computed from the program math — only the heading is editable.' },
  ],
  rebate_credits_table: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Applicable Rebates & Incentives' },
  ],
  totals_box: [
    { key: '__info__', type: 'info',
      description: 'Subtotal / Total Rebates / TOTAL DUE, computed from the program math. No per-section options.' },
  ],
  deliverables_list: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Deliverables' },
    { key: 'items', label: 'Deliverable Items', type: 'string_list',
      default: [
        'Whole-Building Energy Audit Report (ASHRAE Level II equivalent)',
        'HPXML v4 / BuildingSync file from Asset Score',
        'Customer Report / Building Assessment Tool Report',
      ] },
  ],
  acknowledgment_and_signature: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Acknowledgment & Acceptance' },
    { key: 'signer_label', label: 'Signer Label', type: 'text', default: 'Property Owner / Authorized Representative' },
  ],
  page_footer: [
    { key: '__info__', type: 'info',
      description: 'Footer pinned to the last page (company + contact lines from the Submittal Document Wording). No per-section options.' },
  ],

  // --- Sealed documents ----------------------------------------------------
  sealed_primary_contractor_block: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Primary Contractor:' },
    { key: 'lines', label: 'Contractor Lines', type: 'string_list', default: SEALED_PRIMARY_LINES },
  ],
  sealed_document_details_block: [
    { key: 'heading', label: 'Heading', type: 'text', placeholder: 'Invoice Details: / Project Details:',
      description: 'Leave blank to use the default (Invoice Details for an invoice, Project Details for a proposal). The detail lines are filled from the record.' },
  ],
  sealed_bill_to_block: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Bill To:' },
  ],
  sealed_project_address_block: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Project Address:' },
  ],
  sealed_title: [
    { key: 'text', label: 'Title Text', type: 'text', placeholder: 'INVOICE / PROPOSAL',
      description: 'Leave blank to use the default (INVOICE for an invoice, PROPOSAL for a proposal).' },
  ],
  sealed_line_items_table: [
    { key: '__info__', type: 'info',
      description: 'Contractor / Name / Description / Total table, zebra-striped, one row per measure with EES as the line-item contractor. No per-section options.' },
  ],
  sealed_rebate_section: [
    { key: 'variant', label: 'Rebate Source', type: 'select',
      default: 'ira',
      options: [
        { value: 'ira', label: 'IRA HOMES (always shown)' },
        { value: 'foe', label: 'Non-IRA / Focus on Energy (shown only when present)' },
      ],
      description: 'Which rebate this block renders. The IRA and non-IRA blocks are two separate sections.' },
    { key: 'heading', label: 'Heading', type: 'text', placeholder: 'IRA Rebates / Other Non-IRA Rebates' },
  ],
  sealed_totals_list: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Totals' },
  ],
  sealed_signature_block: [
    { key: 'signer_label', label: 'Signer Label', type: 'text', default: 'Customer Signature' },
  ],

  // --- Energy Assessment Report -------------------------------------------
  // The audit's own deliverable. Its sections are the assessment's own walk of
  // the building, so the template is where the report's ORDER and HEADINGS are
  // set — which is what lets it be laid out to mirror the Asset Score report
  // and read side by side with it.
  assessment_cover: [
    { key: 'title', label: 'Report Title', type: 'text',
      placeholder: 'Leave blank to use the report’s own title' },
    { key: 'subtitle', label: 'Subtitle', type: 'text',
      placeholder: 'e.g. Whole-Building Energy Audit — ASHRAE Level II Equivalent' },
    { key: 'eyebrow', label: 'Company Line', type: 'text',
      placeholder: 'Leave blank to use the Submittal Document Wording' },
    { key: 'subject_heading', label: 'Left Column Heading', type: 'text', default: 'Building Assessed' },
    { key: 'provenance_heading', label: 'Right Column Heading', type: 'text', default: 'Report Details' },
    { key: 'prepared_for_heading', label: 'Prepared-For Heading', type: 'text', default: 'Prepared For' },
  ],
  assessment_narrative: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Scope & Methodology' },
    { key: 'body', label: 'Body', type: 'textarea',
      description: 'Free prose. Blank lines start a new paragraph.' },
    { key: 'items', label: 'Bullet Points', type: 'string_list', default: [] },
  ],
  assessment_building_summary: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Building Summary' },
    { key: '__info__', type: 'info',
      description: 'Read from the building and property RECORDS (year built, unit count, square footage, system types…). Columns with no value are left out.' },
  ],
  assessment_field_data: [
    { key: 'step', label: 'Work Step Section', type: 'text',
      description: 'The name of the work plan section to print, exactly as it appears on the work order (e.g. “Heating Systems”). Every question the section asks is printed, with its answer or an em dash.' },
    { key: 'heading', label: 'Heading', type: 'text',
      placeholder: 'Leave blank to use the work step’s own name',
      description: 'Rename the heading here to match the corresponding section of the Asset Score report.' },
    { key: 'body', label: 'Intro Text', type: 'textarea' },
    { key: 'photos', label: 'Photos', type: 'select', default: 'step',
      options: [
        { value: 'step', label: 'Print this section’s photos here' },
        { value: 'none', label: 'Leave photos to the Photo Documentation section' },
      ],
      description: 'Only photos marked “Include in final report” on the work order are ever printed.' },
    { key: 'photo_heading', label: 'Photo Sub-heading', type: 'text', default: 'Photo Documentation' },
    { key: 'photo_columns', label: 'Photos per Row', type: 'select', default: 2,
      options: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }] },
  ],
  assessment_photo_documentation: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Photo Documentation' },
    { key: 'body', label: 'Intro Text', type: 'textarea' },
    { key: 'columns', label: 'Photos per Row', type: 'select', default: 2,
      options: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }] },
    { key: 'group_by_step', label: 'Group by Work Step', type: 'select', default: true,
      options: [{ value: true, label: 'Yes — band each step' }, { value: false, label: 'No — one continuous grid' }] },
    { key: 'exclude_printed', label: 'Skip Already-Printed Photos', type: 'select', default: true,
      options: [
        { value: true, label: 'Yes — only photos no section above showed' },
        { value: false, label: 'No — print every flagged photo again' },
      ] },
    { key: 'steps', label: 'Limit to Work Steps', type: 'string_list', default: [],
      description: 'Leave empty for every step. Otherwise list the work step names whose photos this block prints.' },
  ],
  assessment_recommendations: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Findings & Recommended Measures' },
    { key: 'body', label: 'Body', type: 'textarea' },
    { key: 'items', label: 'Measures', type: 'string_list', default: [],
      description: 'Savings, cost and payback are modelled downstream (Snugg Pro / Asset Score) — this section states the measures, it does not compute them.' },
  ],
  assessment_deliverables: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Deliverables' },
    { key: 'body', label: 'Intro Text', type: 'textarea' },
    { key: 'items', label: 'Deliverable Items', type: 'string_list',
      default: [
        'Whole-Building Energy Audit Report (ASHRAE Level II equivalent)',
        'HPXML v4 / BuildingSync file from Asset Score',
        'Customer Report / Building Assessment Tool Report',
      ] },
  ],
  assessment_signature: [
    { key: 'heading', label: 'Heading', type: 'text', default: 'Acknowledgment' },
    { key: 'acknowledgment', label: 'Acknowledgment Text', type: 'textarea' },
    { key: 'signer_label', label: 'Signer Label', type: 'text',
      default: 'Property Owner / Authorized Representative' },
  ],
  assessment_footer: [
    { key: 'company_line', label: 'Company Line', type: 'text',
      placeholder: 'Leave blank to use the Submittal Document Wording' },
    { key: 'contact_line', label: 'Contact Line', type: 'text',
      placeholder: 'Leave blank to use the Submittal Document Wording' },
    { key: '__info__', type: 'info',
      description: 'Stamped on every page with the work order number and “Page N of M”. Place it last.' },
  ],
}

// Human labels for section types, used in rows and the Add-Section palette.
export const SUBMITTAL_SECTION_LABELS = {
  company_header: 'Company Header',
  document_meta_and_parties: 'Meta & Parties',
  audit_services_table: 'Audit Services Table',
  measure_line_items_table: 'Measure Line Items',
  rebate_credits_table: 'Rebate Credits',
  totals_box: 'Totals Box',
  deliverables_list: 'Deliverables List',
  acknowledgment_and_signature: 'Acknowledgment & Signature',
  page_footer: 'Page Footer',
  sealed_primary_contractor_block: 'Primary Contractor',
  sealed_document_details_block: 'Document Details',
  sealed_bill_to_block: 'Bill To',
  sealed_project_address_block: 'Project Address',
  sealed_title: 'Title',
  sealed_line_items_table: 'Line Items',
  sealed_rebate_section: 'Rebate Section',
  sealed_totals_list: 'Totals List',
  sealed_signature_block: 'Signature',
  assessment_cover: 'Report Cover',
  assessment_narrative: 'Narrative',
  assessment_building_summary: 'Building Summary',
  assessment_field_data: 'Captured Section',
  assessment_photo_documentation: 'Photo Documentation',
  assessment_recommendations: 'Findings & Measures',
  assessment_deliverables: 'Deliverables',
  assessment_signature: 'Acknowledgment & Signature',
  assessment_footer: 'Page Footer',
}

/** Return the schema array for a section type, or null (→ JSON fallback). */
export function getSubmittalSectionSchema(sectionType) {
  return SUBMITTAL_SECTION_SCHEMAS[sectionType] || null
}

/** Build a default config object for a newly-added section of the given type. */
export function buildDefaultSectionConfig(sectionType) {
  const schema = SUBMITTAL_SECTION_SCHEMAS[sectionType]
  if (!schema) return {}
  const out = {}
  for (const f of schema) {
    if (f.type === 'info') continue
    if (f.default !== undefined) out[f.key] = f.default
  }
  return out
}

/** The rendering engine ('ees' | 'sealed' | 'combustion_safety' | 'energy_assessment') for a template kind. */
export function engineForKind(sdtKind) {
  return DOCUMENT_KIND_ENGINE[sdtKind] || 'ees'
}

/**
 * The Add-Section palette for a template kind: every section type its engine
 * can render, with a human label. Keyed on the engine so EES sections are
 * never offered on a Sealed template and vice versa.
 */
export function paletteForKind(sdtKind) {
  const engine = engineForKind(sdtKind)
  return (SECTION_TYPES_BY_ENGINE[engine] || []).map(type => ({
    type,
    label: SUBMITTAL_SECTION_LABELS[type] || type,
    defaultConfig: buildDefaultSectionConfig(type),
  }))
}
