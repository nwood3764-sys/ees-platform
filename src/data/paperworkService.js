// ===========================================================================
// paperworkService.js — LEAP-side I/O for HOMES Project Paperwork generation.
//
// The math and document builders live in paperworkModel.js (pure, no app
// imports). This module owns everything that touches the app:
//   - loadPaperworkContext(projectId): project → property → account → contact
//     resolution into the prefill fields the generation modal edits
//   - parseAssetScorePdf(arrayBuffer): pdf.js text extraction of an uploaded
//     DOE Asset Score report, fed into parseAssetScoreText
//   - buildPaperworkWorkbook(model): fetches the workbook template shipped
//     with the app (public/paperwork/invoice_workbook.xlsx — versioned with
//     the bundle, no storage round trip) and fills it
//   - downloadBlob: downloads only — never open tabs (settled rule)
//
// See docs/leap-project-paperwork-port.md.
// ===========================================================================

import { supabase } from '../lib/supabase'
import { getCurrentUserId } from './layoutService'
import { parseAssetScoreText, fillPaperworkWorkbook, combustionSampleCount } from './paperworkModel'

/**
 * Load a stored submittal document template — the ordered section list that
 * defines a document. Program-scoped templates win over the global default.
 *
 * Returns { kind, name, sections: [{type, config}] } or null, in which case
 * the caller falls back to DEFAULT_DOCUMENT_SECTIONS in paperworkModel (which
 * the seeded templates are byte-identical to).
 */
export async function loadSubmittalDocumentTemplate(documentKey, opportunityRecordTypeId = null) {
  if (!documentKey) return null
  try {
    let q = supabase
      .from('submittal_document_templates')
      .select(`
        id, sdt_name, sdt_kind, sdt_opportunity_record_type,
        sections:submittal_document_template_sections (
          sdts_section_type, sdts_config, sdts_sort_order, sdts_is_active, sdts_is_deleted
        )
      `)
      .eq('sdt_document_key', documentKey)
      .eq('sdt_is_deleted', false)
      .eq('sdt_is_active', true)
    q = opportunityRecordTypeId
      ? q.or(`sdt_opportunity_record_type.is.null,sdt_opportunity_record_type.eq.${opportunityRecordTypeId}`)
      : q.is('sdt_opportunity_record_type', null)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    if (!data?.length) return null
    // Prefer the program-scoped template over the global default.
    const chosen = data.find(r => r.sdt_opportunity_record_type) || data[0]
    const sections = (chosen.sections || [])
      .filter(s => !s.sdts_is_deleted && s.sdts_is_active)
      .sort((a, b) => (a.sdts_sort_order ?? 0) - (b.sdts_sort_order ?? 0))
      .map(s => ({ type: s.sdts_section_type, config: s.sdts_config || {} }))
    if (!sections.length) return null
    return { kind: chosen.sdt_kind, name: chosen.sdt_name, sections }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('loadSubmittalDocumentTemplate failed; using built-in sections:', e.message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Template editor — load one template with all its sections (including
// inactive, which the read path filters out), save the edited section list,
// and clone a template scoped to an opportunity record type.
// ---------------------------------------------------------------------------

/**
 * Load a single template by id with its full (non-deleted) section list, for
 * editing. Unlike loadSubmittalDocumentTemplate this keeps inactive sections
 * (so they can be re-activated) and returns each section's real row id.
 */
export async function loadSubmittalTemplateForEdit(sdtId) {
  const { data, error } = await supabase
    .from('submittal_document_templates')
    .select(`
      id, sdt_record_number, sdt_name, sdt_kind, sdt_document_key,
      sdt_opportunity_record_type, sdt_is_active,
      sections:submittal_document_template_sections (
        id, sdts_name, sdts_section_type, sdts_config, sdts_sort_order,
        sdts_is_active, sdts_is_deleted
      )
    `)
    .eq('id', sdtId)
    .eq('sdt_is_deleted', false)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const sections = (data.sections || [])
    .filter(s => !s.sdts_is_deleted)
    .sort((a, b) => (a.sdts_sort_order ?? 0) - (b.sdts_sort_order ?? 0))
    .map(s => ({
      id: s.id,
      name: s.sdts_name,
      type: s.sdts_section_type,
      config: s.sdts_config || {},
      isActive: s.sdts_is_active !== false,
    }))
  return {
    id: data.id,
    recordNumber: data.sdt_record_number,
    name: data.sdt_name,
    kind: data.sdt_kind,
    documentKey: data.sdt_document_key,
    opportunityRecordType: data.sdt_opportunity_record_type,
    sections,
  }
}

/**
 * Persist the edited section list for a template. Sections are matched by id:
 * existing rows are updated (type/config/order/active), new rows (no id) are
 * inserted, and existing rows absent from the list are soft-deleted. Returns
 * the reloaded template.
 */
export async function saveSubmittalTemplateSections(sdtId, sections, sectionLabelFor) {
  const userId = await getCurrentUserId()
  const nowIso = new Date().toISOString()

  // Existing (non-deleted) rows for this template.
  const { data: existing, error: exErr } = await supabase
    .from('submittal_document_template_sections')
    .select('id')
    .eq('sdt_id', sdtId)
    .eq('sdts_is_deleted', false)
  if (exErr) throw new Error(exErr.message)
  const keptIds = new Set(sections.filter(s => s.id).map(s => s.id))
  const toDelete = (existing || []).map(r => r.id).filter(id => !keptIds.has(id))

  // Soft-delete removed rows.
  for (const id of toDelete) {
    const { error } = await supabase
      .from('submittal_document_template_sections')
      .update({ sdts_is_deleted: true, sdts_deleted_at: nowIso, sdts_deleted_by: userId,
        sdts_deletion_reason: 'Removed in template editor', sdts_updated_by: userId, sdts_updated_at: nowIso })
      .eq('id', id)
    if (error) throw new Error(error.message)
  }

  // Update existing, insert new — one round trip each keeps the code readable
  // and the section counts here are small (≤ ~12).
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const label = (sectionLabelFor && sectionLabelFor(s.type)) || s.name || s.type
    if (s.id) {
      const { error } = await supabase
        .from('submittal_document_template_sections')
        .update({ sdts_name: label, sdts_section_type: s.type, sdts_config: s.config || {},
          sdts_sort_order: (i + 1) * 10, sdts_is_active: s.isActive !== false,
          sdts_updated_by: userId, sdts_updated_at: nowIso })
        .eq('id', s.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase
        .from('submittal_document_template_sections')
        .insert({ sdts_record_number: '', sdt_id: sdtId, sdts_name: label,
          sdts_section_type: s.type, sdts_config: s.config || {}, sdts_sort_order: (i + 1) * 10,
          sdts_is_active: s.isActive !== false, sdts_owner: userId, sdts_created_by: userId })
      if (error) throw new Error(error.message)
    }
  }
  return loadSubmittalTemplateForEdit(sdtId)
}

/**
 * Clone a template (header + all active, non-deleted sections), scoping the
 * copy to an opportunity record type. Mirrors clone_document_template's
 * semantics: a program's document is a COPY of a working one, not a rebuild.
 * The unique index (sdt_document_key, sdt_opportunity_record_type) enforces one
 * template per program per document key.
 */
export async function cloneSubmittalTemplate(sourceSdtId, { opportunityRecordTypeId, name } = {}) {
  const userId = await getCurrentUserId()
  const source = await loadSubmittalTemplateForEdit(sourceSdtId)
  if (!source) throw new Error('Source template not found')
  if (!opportunityRecordTypeId) throw new Error('Pick a program (opportunity record type) to scope the copy to')

  const { data: created, error: cErr } = await supabase
    .from('submittal_document_templates')
    .insert({
      sdt_record_number: '',
      sdt_name: name || `${source.name} (Copy)`,
      sdt_document_key: source.documentKey,
      sdt_kind: source.kind,
      sdt_opportunity_record_type: opportunityRecordTypeId,
      sdt_owner: userId, sdt_created_by: userId,
    })
    .select('id')
    .single()
  if (cErr) throw new Error(cErr.message)

  const rows = source.sections
    .filter(s => s.isActive !== false)
    .map((s, i) => ({
      sdts_record_number: '', sdt_id: created.id, sdts_name: s.name || s.type,
      sdts_section_type: s.type, sdts_config: s.config || {}, sdts_sort_order: (i + 1) * 10,
      sdts_is_active: true, sdts_owner: userId, sdts_created_by: userId,
    }))
  if (rows.length) {
    const { error: sErr } = await supabase.from('submittal_document_template_sections').insert(rows)
    if (sErr) throw new Error(sErr.message)
  }
  return created.id
}

/**
 * Opportunity record types available to scope a cloned template to. Returns
 * [{ id, value, label }] active opportunity record-type picklist values.
 */
export async function loadOpportunityRecordTypeOptions() {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_value, picklist_label')
    .eq('picklist_object', 'opportunities')
    .eq('picklist_field', 'record_type')
    .eq('picklist_is_active', true)
    .order('picklist_label')
  if (error) throw new Error(error.message)
  return (data || []).map(r => ({ id: r.id, value: r.picklist_value, label: r.picklist_label || r.picklist_value }))
}

/**
 * Load the stages that carry document requirements for one record type,
 * each with its document list.
 *
 * Documents belong to the STAGE a record is at (Nicholas, 2026-07-27) — and
 * because opportunity stage picklists are record-type-scoped and never shared,
 * one stage value already means "this program, this submittal". So this is a
 * single lookup, not a program × stage matrix.
 *
 * Returns: [{ stageId, stageValue, sortOrder, documents: [
 *   { key, name, requiresSignature, signerRole, documentTemplateId } ] }]
 * ordered by stage sort order, containing only stages that have documents.
 */
export async function loadStageDocumentRequirements({ object = 'opportunities', recordTypeId }) {
  if (!recordTypeId) return []
  // 1) the stages assigned to this record type
  const { data: assignments, error: aErr } = await supabase
    .from('picklist_value_record_type_assignments')
    .select('pvrta_picklist_value_id, stage:pvrta_picklist_value_id ( id, picklist_value, picklist_field, picklist_object, picklist_sort_order )')
    .eq('pvrta_record_type_id', recordTypeId)
  if (aErr) {
    // eslint-disable-next-line no-console
    console.warn('loadStageDocumentRequirements: stage lookup failed:', aErr.message)
    return []
  }
  const stages = (assignments || [])
    .map(a => a.stage)
    .filter(s => s && s.picklist_object === object && s.picklist_field?.endsWith('stage'))
  if (!stages.length) return []

  // 2) the document requirements sitting on those stages
  const { data: reqs, error: rErr } = await supabase
    .from('stage_document_requirements')
    .select('sdr_stage_value_id, sdr_name, sdr_document_key, sdr_document_template_id, sdr_requires_signature, sdr_signer_role, sdr_sort_order')
    .eq('sdr_object', object)
    .eq('sdr_is_deleted', false)
    .eq('sdr_is_active', true)
    .in('sdr_stage_value_id', stages.map(s => s.id))
  if (rErr) {
    // eslint-disable-next-line no-console
    console.warn('loadStageDocumentRequirements: requirement lookup failed:', rErr.message)
    return []
  }

  const byStage = new Map()
  for (const s of stages) byStage.set(s.id, {
    stageId: s.id, stageValue: s.picklist_value, sortOrder: s.picklist_sort_order ?? 0, documents: [],
  })
  for (const r of reqs || []) {
    const entry = byStage.get(r.sdr_stage_value_id)
    if (!entry) continue
    entry.documents.push({
      key: r.sdr_document_key,
      name: r.sdr_name,
      requiresSignature: !!r.sdr_requires_signature,
      signerRole: r.sdr_signer_role || null,
      documentTemplateId: r.sdr_document_template_id || null,
      sortOrder: r.sdr_sort_order ?? 100,
    })
  }
  return [...byStage.values()]
    .filter(s => s.documents.length > 0)
    .map(s => ({ ...s, documents: s.documents.sort((a, b) => a.sortOrder - b.sortOrder) }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Map of opportunity record-type picklist value → picklist_values.id.
 * The submittal registry is keyed by value; the text-block table scopes by id.
 */
export async function loadOpportunityRecordTypeMap() {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_value')
    .eq('picklist_object', 'opportunities')
    .eq('picklist_field', 'record_type')
    .eq('picklist_is_active', true)
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('loadOpportunityRecordTypeMap failed:', error.message)
    return {}
  }
  const map = {}
  for (const row of data || []) map[row.picklist_value] = row.id
  return map
}

/**
 * Load the document wording for a program, as a {key: body} map.
 *
 * Rows scoped to the given opportunity record type override the global
 * defaults (rows with a NULL record type) key by key. Returns an empty object
 * on any failure so the renderer falls back to its built-in defaults rather
 * than producing a blank document.
 */
export async function loadSubmittalTextBlocks(opportunityRecordTypeId = null) {
  try {
    let query = supabase
      .from('submittal_document_text_blocks')
      .select('sdtb_key, sdtb_body, sdtb_opportunity_record_type')
      .eq('sdtb_is_deleted', false)
      .eq('sdtb_is_active', true)
    query = opportunityRecordTypeId
      ? query.or(`sdtb_opportunity_record_type.is.null,sdtb_opportunity_record_type.eq.${opportunityRecordTypeId}`)
      : query.is('sdtb_opportunity_record_type', null)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    const blocks = {}
    // Defaults first, then the program-scoped rows overwrite them.
    for (const row of data || []) {
      if (!row.sdtb_opportunity_record_type) blocks[row.sdtb_key] = row.sdtb_body
    }
    for (const row of data || []) {
      if (row.sdtb_opportunity_record_type) blocks[row.sdtb_key] = row.sdtb_body
    }
    return blocks
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('loadSubmittalTextBlocks failed; using built-in wording:', e.message)
    return {}
  }
}

// pdf.js from CDN at runtime — same pattern (and same pinned version) as the
// signing portal's PDF preview (src/pages/SigningPortal.jsx), which is the
// established, prod-verified way this app does pdf.js without bundling it.
const PDFJS_VERSION = '4.0.379'
const PDFJS_SCRIPT = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`

const WORKBOOK_TEMPLATE_URL = '/paperwork/invoice_workbook.xlsx'

// ---------------------------------------------------------------------------
// Asset Score report → text → parsed fields
// ---------------------------------------------------------------------------
let _pdfjsPromise = null
async function loadPdfJs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import(/* @vite-ignore */ PDFJS_SCRIPT).then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
      return pdfjs
    })
  }
  return _pdfjsPromise
}

/**
 * Extract the text of a PDF, reconstructing reading-order lines by y-position
 * (ported from the standalone tool's pdfText()).
 */
async function extractPdfText(arrayBuffer) {
  const pdfjs = await loadPdfJs()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const out = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    const rows = {}
    tc.items.forEach(it => {
      const y = Math.round(it.transform[5])
      ;(rows[y] = rows[y] || []).push([it.transform[4], it.str])
    })
    Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(y => {
      const line = rows[y].sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' ')
      out.push(line)
    })
    out.push('\f')
  }
  return out.join('\n')
}

/**
 * Parse an uploaded DOE Asset Score report PDF into the fields the paperwork
 * math needs (EUIs, roof area, roof R-values, name/address).
 */
export async function parseAssetScorePdf(arrayBuffer) {
  const text = await extractPdfText(arrayBuffer)
  return parseAssetScoreText(text)
}

// ---------------------------------------------------------------------------
// Record context — everything LEAP already knows, resolved into the modal's
// editable prefill fields. Column names verified against production
// information_schema on 2026-07-26.
// ---------------------------------------------------------------------------
function fmtDate(iso) {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(iso)
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}/${m[1]}`
}

function joinCityStateZip(city, state, zip) {
  const cs = [city, state].filter(Boolean).join(', ')
  return [cs, zip].filter(Boolean).join(' ').trim()
}

export async function loadPaperworkContext(projectId) {
  const { data: project, error: pErr } = await supabase
    .from('projects')
    .select(`
      id, project_record_number, project_name, property_id, project_account_id,
      opportunity_id,
      project_start_date, project_completion_date,
      project_installation_completion_date,
      project_project_implementation_start_date,
      project_project_implementation_end_date
    `)
    .eq('id', projectId)
    .maybeSingle()
  if (pErr) throw new Error(pErr.message)
  if (!project) throw new Error('Project not found')

  // The opportunity carries the PROGRAM (its record type is the program
  // identifier — WI-IRA-MF-HOMES, NC-IRA-MF-HOMES-AUDIT, …), which selects
  // both the submittal's document set and any program-specific wording.
  let opportunity = null
  if (project.opportunity_id) {
    const { data } = await supabase
      .from('opportunities')
      .select('id, opportunity_record_number, opportunity_name, opportunity_record_type, opportunity_stage, recordType:opportunity_record_type ( picklist_value, picklist_label ), stage:opportunity_stage ( picklist_value )')
      .eq('id', project.opportunity_id)
      .maybeSingle()
    opportunity = data || null
  }

  let property = null
  if (project.property_id) {
    const { data } = await supabase
      .from('properties')
      .select(`
        id, property_name, property_street, property_city, property_state,
        property_zip, property_total_units, property_account_id,
        property_ira_income_qualification_number, property_primary_contact_id
      `)
      .eq('id', project.property_id)
      .maybeSingle()
    property = data || null
  }

  const accountId = property?.property_account_id || project.project_account_id
  let account = null
  if (accountId) {
    const { data } = await supabase
      .from('accounts')
      .select(`
        id, account_name, account_email, account_phone, account_contact_id,
        billing_street, billing_city, billing_state, billing_zip,
        mailing_street, mailing_city, mailing_state, mailing_zip
      `)
      .eq('id', accountId)
      .maybeSingle()
    account = data || null
  }

  // Contact preference: the property's primary contact, then the account's
  // designated contact, then the account's flagged-primary contact.
  let contact = null
  const contactSelect = 'id, contact_name, contact_first_name, contact_last_name, contact_email, contact_phone, contact_mobile_phone'
  const fetchContact = async id => {
    if (!id) return null
    const { data } = await supabase.from('contacts').select(contactSelect)
      .eq('id', id).eq('contact_is_deleted', false).maybeSingle()
    return data || null
  }
  contact = await fetchContact(property?.property_primary_contact_id)
  if (!contact) contact = await fetchContact(account?.account_contact_id)
  if (!contact && account?.id) {
    const { data } = await supabase.from('contacts').select(contactSelect)
      .eq('contact_account_id', account.id)
      .eq('contact_is_primary', true)
      .eq('contact_is_deleted', false)
      .limit(1)
    contact = data?.[0] || null
  }

  const ownerStreet = account?.billing_street || account?.mailing_street || ''
  const ownerCsz = account?.billing_street
    ? joinCityStateZip(account.billing_city, account.billing_state, account.billing_zip)
    : joinCityStateZip(account?.mailing_city, account?.mailing_state, account?.mailing_zip)
  const contactName = contact
    ? (contact.contact_name || [contact.contact_first_name, contact.contact_last_name].filter(Boolean).join(' '))
    : ''
  const today = new Date()

  return {
    project,
    opportunity,
    programRecordTypeId: opportunity?.opportunity_record_type || null,
    programRecordTypeValue: opportunity?.recordType?.picklist_value || null,
    currentStageId: opportunity?.opportunity_stage || null,
    currentStageValue: opportunity?.stage?.picklist_value || null,
    property,
    account,
    contact,
    units: property?.property_total_units || null,
    fields: {
      ownerName: account?.account_name || '',
      ownerAddress: ownerStreet,
      ownerCityStateZip: ownerCsz,
      contactName,
      contactEmail: contact?.contact_email || account?.account_email || '',
      contactPhone: contact?.contact_phone || contact?.contact_mobile_phone || account?.account_phone || '',
      propertyName: property?.property_name || '',
      installationAddress: property?.property_street || '',
      installationCityStateZip: joinCityStateZip(property?.property_city, property?.property_state, property?.property_zip),
      iqNumber: property?.property_ira_income_qualification_number || '',
      invoiceNumber: 'INV-WI-',
      projectInvoiceNumber: '',
      invoiceDate: `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`,
      estimatedStartDate: fmtDate(project.project_project_implementation_start_date),
      estimatedEndDate: fmtDate(project.project_project_implementation_end_date),
      startDate: fmtDate(project.project_start_date),
      endDate: fmtDate(project.project_installation_completion_date || project.project_completion_date),
    },
  }
}

// ===========================================================================
// Combustion Safety Notification — a per-BUILDING capture form. Unlike the
// computed HOMES documents, its data is inspection results entered by a person
// and stored on diagnostic_tests rows (the purpose-built home). This loads the
// building → property → account context, the building's units, the picklist
// option sets, and any previously captured rows, and assembles both the
// editable draft and the model the combustion PDF renders from.
// ===========================================================================

const COMBUSTION_DIAG_COLS = `
  id, unit_id, diagnostic_combustion_scope,
  diagnostic_gas_leak_result, diagnostic_gas_leak_location, diagnostic_gas_detector_installed,
  diagnostic_ambient_co_result, diagnostic_co_detector_installed, diagnostic_co_detector_location,
  diagnostic_heating_plant_co_status, diagnostic_heating_plant_spillage,
  diagnostic_water_heater_co_status, diagnostic_water_heater_spillage,
  diagnostic_stove_co_status, diagnostic_combustion_notes`

// Fields whose option sets the editor renders (values are stored on the rows).
export const COMBUSTION_OPTION_FIELDS = [
  'combustion_scope', 'gas_leak_result', 'ambient_co_result',
  'heating_plant_co_status', 'heating_plant_spillage',
  'water_heater_co_status', 'water_heater_spillage', 'stove_co_status',
]

export async function loadCombustionContext(buildingId) {
  if (!buildingId) throw new Error('loadCombustionContext: buildingId is required')

  const { data: building, error: bErr } = await supabase
    .from('buildings')
    .select(`
      id, building_name, building_number_or_name, property_id,
      building_total_units, building_number_of_units,
      building_combustion_ventilation_status, building_combustion_ventilation_cfm,
      building_combustion_ventilation_notes`)
    .eq('id', buildingId)
    .maybeSingle()
  if (bErr) throw new Error(bErr.message)
  if (!building) throw new Error('Building not found')

  let property = null
  if (building.property_id) {
    const { data } = await supabase.from('properties')
      .select('id, property_name, property_street, property_city, property_state, property_zip, property_account_id, property_total_units')
      .eq('id', building.property_id).maybeSingle()
    property = data || null
  }
  let account = null
  if (property?.property_account_id) {
    const { data } = await supabase.from('accounts')
      .select('id, account_name, billing_street, billing_city, billing_state, billing_zip, mailing_street, mailing_city, mailing_state, mailing_zip, account_email')
      .eq('id', property.property_account_id).maybeSingle()
    account = data || null
  }

  // Units on this building (the sampling pool).
  const { data: unitRows } = await supabase.from('units')
    .select('id, unit_number, unit_name')
    .eq('building_id', buildingId).eq('unit_is_deleted', false)
    .order('unit_number', { ascending: true })
  const allUnits = (unitRows || []).map(u => ({ id: u.id, number: u.unit_number || u.unit_name || '' }))
  const unitNumberById = Object.fromEntries(allUnits.map(u => [u.id, u.number]))

  // Picklist option sets + id→value resolution for the combustion fields.
  const { data: pv } = await supabase.from('picklist_values')
    .select('id, picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order')
    .in('picklist_object', ['diagnostic_tests', 'buildings'])
    .eq('picklist_is_active', true)
  const idToValue = {}
  const options = {}
  let combustionRtId = null
  for (const r of (pv || [])) {
    idToValue[r.id] = r.picklist_value
    if (r.picklist_object === 'diagnostic_tests' && r.picklist_field === 'record_type'
        && r.picklist_value === 'COMBUSTION-SAFETY-NOTIFICATION') combustionRtId = r.id
    const key = r.picklist_field
    if (COMBUSTION_OPTION_FIELDS.includes(key) || key === 'combustion_ventilation_status') {
      ;(options[key] ||= []).push({ value: r.picklist_value, label: r.picklist_label || r.picklist_value, sort: r.picklist_sort_order ?? 0 })
    }
  }
  for (const k of Object.keys(options)) options[k].sort((a, b) => a.sort - b.sort)

  // Previously captured combustion rows for this building.
  let existing = []
  if (combustionRtId) {
    const { data } = await supabase.from('diagnostic_tests')
      .select(COMBUSTION_DIAG_COLS)
      .eq('building_id', buildingId).eq('diagnostic_record_type', combustionRtId)
      .eq('diagnostic_is_deleted', false)
    existing = data || []
  }
  const val = (id) => (id ? (idToValue[id] || '') : '')
  const commonRow = existing.find(r => !r.unit_id) || null
  const common = {
    gas_leak_result: val(commonRow?.diagnostic_gas_leak_result),
    gas_leak_location: commonRow?.diagnostic_gas_leak_location || '',
    gas_detector_installed: !!commonRow?.diagnostic_gas_detector_installed,
    ambient_co_result: val(commonRow?.diagnostic_ambient_co_result),
    co_detector_installed: !!commonRow?.diagnostic_co_detector_installed,
    co_detector_location: commonRow?.diagnostic_co_detector_location || '',
    heating_plant_co_status: val(commonRow?.diagnostic_heating_plant_co_status),
    heating_plant_spillage: val(commonRow?.diagnostic_heating_plant_spillage),
    water_heater_co_status: val(commonRow?.diagnostic_water_heater_co_status),
    water_heater_spillage: val(commonRow?.diagnostic_water_heater_spillage),
    notes: commonRow?.diagnostic_combustion_notes || '',
  }
  const sampleFromRow = (r) => ({
    unit_id: r.unit_id,
    unit_number: unitNumberById[r.unit_id] || '',
    gas_leak_result: val(r.diagnostic_gas_leak_result),
    gas_leak_location: r.diagnostic_gas_leak_location || '',
    gas_detector_installed: !!r.diagnostic_gas_detector_installed,
    ambient_co_result: val(r.diagnostic_ambient_co_result),
    co_detector_installed: !!r.diagnostic_co_detector_installed,
    co_detector_location: r.diagnostic_co_detector_location || '',
    furnace_co_status: val(r.diagnostic_heating_plant_co_status),
    furnace_spillage: val(r.diagnostic_heating_plant_spillage),
    water_heater_co_status: val(r.diagnostic_water_heater_co_status),
    water_heater_spillage: val(r.diagnostic_water_heater_spillage),
    stove_co_status: val(r.diagnostic_stove_co_status),
    notes: r.diagnostic_combustion_notes || '',
  })
  const blankSample = (u) => ({
    unit_id: u.id, unit_number: u.number,
    gas_leak_result: '', gas_leak_location: '', gas_detector_installed: false,
    ambient_co_result: '', co_detector_installed: false, co_detector_location: '',
    furnace_co_status: '', furnace_spillage: '', water_heater_co_status: '',
    water_heater_spillage: '', stove_co_status: '', notes: '',
  })

  const totalUnits = building.building_total_units ?? building.building_number_of_units ?? allUnits.length ?? 0
  const sampleCount = combustionSampleCount(totalUnits)

  // Seed the sampled-unit list: previously captured rows first, then enough
  // fresh units from the building to reach the sampling count.
  const samples = existing.filter(r => r.unit_id).map(sampleFromRow)
  const usedIds = new Set(samples.map(s => s.unit_id))
  for (const u of allUnits) {
    if (samples.length >= sampleCount) break
    if (!usedIds.has(u.id)) { samples.push(blankSample(u)); usedIds.add(u.id) }
  }

  const ownerStreet = account?.billing_street || account?.mailing_street || ''
  const ownerCsz = account?.billing_street
    ? joinCityStateZip(account.billing_city, account.billing_state, account.billing_zip)
    : joinCityStateZip(account?.mailing_city, account?.mailing_state, account?.mailing_zip)

  return {
    building: { id: building.id, name: building.building_number_or_name || building.building_name || '' },
    property: {
      id: property?.id || null,
      name: property?.property_name || '',
      street: property?.property_street || '',
      cityStateZip: joinCityStateZip(property?.property_city, property?.property_state, property?.property_zip),
    },
    owner: { name: account?.account_name || '', address: ownerStreet, cityStateZip: ownerCsz },
    ownerEmail: account?.account_email || '',
    totalUnits, sampleCount,
    ventilation: {
      status: idToValue[building.building_combustion_ventilation_status] || '',
      cfm: building.building_combustion_ventilation_cfm != null ? String(building.building_combustion_ventilation_cfm) : '',
      notes: building.building_combustion_ventilation_notes || '',
    },
    common, samples, allUnits, options,
  }
}

/**
 * Build the model the combustion PDF renders from, out of the editor's draft.
 */
export function buildCombustionModel(ctx, draft) {
  return {
    building: ctx.building, property: ctx.property, owner: draft.owner || ctx.owner,
    ventilation: draft.ventilation, common: draft.common, samples: draft.samples,
    totalUnits: draft.totalUnits ?? ctx.totalUnits,
    sampleCount: (draft.samples || []).length,
  }
}

/**
 * Persist the whole notification (building ventilation + common-area row +
 * per-unit rows) through the SECURITY INVOKER upsert RPC. Returns the RPC's
 * summary. Values are sent as picklist value strings; the RPC resolves ids.
 */
export async function saveCombustionSafetyNotification({ buildingId, ventilation, common, samples }) {
  const clean = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
    [k, typeof v === 'boolean' ? v : (v == null ? '' : v)]))
  const units = (samples || []).filter(s => s.unit_id).map(clean)
  const { data, error } = await supabase.rpc('save_combustion_safety_notification', {
    p_building_id: buildingId,
    p_ventilation: ventilation || {},
    p_common: common ? clean(common) : null,
    p_units: units,
  })
  if (error) throw new Error(error.message)
  return data
}

// ---------------------------------------------------------------------------
// Workbook — template ships with the app bundle
// ---------------------------------------------------------------------------
export async function buildPaperworkWorkbook(model) {
  const resp = await fetch(WORKBOOK_TEMPLATE_URL)
  if (!resp.ok) throw new Error(`Paperwork workbook template not found (${resp.status})`)
  const buf = await resp.arrayBuffer()
  return fillPaperworkWorkbook(model, buf)
}

// ---------------------------------------------------------------------------
// Download helper — downloads only, never open tabs (settled rule)
// ---------------------------------------------------------------------------
export function downloadBlob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
}
