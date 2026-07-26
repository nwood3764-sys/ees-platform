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
      project_start_date, project_completion_date,
      project_installation_completion_date,
      project_project_implementation_start_date,
      project_project_implementation_end_date
    `)
    .eq('id', projectId)
    .maybeSingle()
  if (pErr) throw new Error(pErr.message)
  if (!project) throw new Error('Project not found')

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
