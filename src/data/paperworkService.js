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
import { parseAssetScoreText, fillPaperworkWorkbook } from './paperworkModel'

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
