// ---------------------------------------------------------------------------
// homesProposalService — assembles the Wisconsin IRA Multifamily HOMES
// Project Reservation proposal for one ENROLLMENT and saves the PDF back onto
// it.
//
// Everything the proposal needs is already on the enrollment:
//   · the two DOE Asset Score reports (baseline + improved), attached under the
//     "Reservation Customer Report" section (document_type reservation_customer_report)
//   · the owner / contact / unit count / primary contractor, on the enrollment
//   · the install address + income-qualification number, on the property
//
// The Asset Score PDFs are text-extracted (LEAP's pdf.js loader) and handed to
// the self-contained homesProposal engine, which parses them and renders the
// approved design. The engine picks the EES (blue) or Sealed (green) look from
// the primary contractor's name.
//
// The action blocks and lists exactly what is missing rather than generating a
// half-built proposal.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'
import { listDocuments, signedUrl, uploadDocument } from './storageService'
import { proxiedStorageUrl } from '../lib/reportFileLinks'
import { extractPdfText } from './paperworkService'
import { computeHomesModel, generateHomesProposalBlob } from '../lib/homesProposal'

// The enrollment record type this proposal is built for.
export const HOMES_PROPOSAL_RECORD_TYPE = 'WI-IRA-MF-HOMES-Project-Reservation'
// The attachment section that holds the baseline + improved Asset Score PDFs.
const ASSET_SCORE_DOCUMENT_TYPE = 'reservation_customer_report'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// "6737 W Washington Street, West Allis, WI 53214" -> street line + city/state/zip line
function splitAddress(full) {
  if (!full) return { addr: '', csz: '' }
  const s = String(full).trim()
  const i = s.indexOf(',')
  if (i < 0) return { addr: s, csz: '' }
  return { addr: s.slice(0, i).trim(), csz: s.slice(i + 1).trim() }
}

function toInt(v) {
  if (v == null || v === '') return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Load everything one enrollment needs for its HOMES proposal, WITHOUT reading
 * the PDF bytes yet. Returns { enr, recordTypeValue, fields, units, contractor,
 * baseDoc, impDoc }. The two *Doc fields are the document rows for the Asset
 * Score PDFs (null when absent).
 */
export async function loadHomesProposalContext(enrollmentId) {
  if (!enrollmentId) throw new Error('loadHomesProposalContext: enrollmentId is required')

  const { data: enr, error } = await supabase
    .from('enrollments').select('*').eq('id', enrollmentId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!enr) throw new Error('Enrollment not found')

  const { data: rt } = enr.enrollment_record_type
    ? await supabase.from('picklist_values')
        .select('picklist_value, picklist_label').eq('id', enr.enrollment_record_type).maybeSingle()
    : { data: null }

  const [{ data: prop }, { data: bld }] = await Promise.all([
    enr.property_id
      ? supabase.from('properties').select('*').eq('id', enr.property_id).maybeSingle()
      : Promise.resolve({ data: null }),
    enr.building_id
      ? supabase.from('buildings')
          .select('building_total_units, building_number_of_units').eq('id', enr.building_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // Owner and contractor are account lookups; resolve their names. The enrollment
  // carries a PRIMARY contractor and, when enrollment_has_support_contractor is
  // set, a SECONDARY (support) contractor — both are listed on the documents.
  const acctIds = [enr.enrollment_owner, enr.enrollment_contractor_account_id,
    enr.enrollment_support_contractor_account_id]
    .filter(v => v && UUID.test(String(v)))
  const { data: accts } = acctIds.length
    ? await supabase.from('accounts').select('id, account_name').in('id', acctIds)
    : { data: [] }
  const acctName = id => (accts || []).find(a => a.id === id)?.account_name || null
  const ownerName = UUID.test(String(enr.enrollment_owner || ''))
    ? (acctName(enr.enrollment_owner) || '') : (enr.enrollment_owner || '')
  const contractor = acctName(enr.enrollment_contractor_account_id) || ''
  const secondaryContractor = enr.enrollment_has_support_contractor
    ? (acctName(enr.enrollment_support_contractor_account_id) || '') : ''

  const owner = splitAddress(enr.enrollment_owner_address)
  const units = toInt(enr.enrollment_occupied_units)
    || toInt(bld?.building_total_units) || toInt(bld?.building_number_of_units)
    || toInt(prop?.property_total_units) || toInt(prop?.property_total_number_of_units) || null
  const csz = [prop?.property_city,
    [prop?.property_state, prop?.property_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')

  const fields = {
    pjOwner:       ownerName || '',
    pjOwnerAddr:   owner.addr,
    pjOwnerCsz:    owner.csz,
    pjContact:     enr.enrollment_contact_name  || '',
    pjContactTitle:enr.enrollment_contact_title || '',
    pjEmail:       enr.enrollment_contact_email || '',
    pjPhone:       enr.enrollment_contact_phone || '',
    pjPropName:    prop?.property_name || '',
    pjInstallAddr: prop?.property_street || '',
    pjCsz:         csz,
    pjIQ:          prop?.property_ira_income_qualification_number || '',
    pjProjInvNo:   enr.enrollment_record_number || '',
    pjInvNo:       enr.enrollment_record_number || '',
    pjInvDate:     new Date().toISOString().slice(0, 10),
    pjSecondaryContractor: secondaryContractor || '',
  }

  const docs = await listDocuments('enrollments', enrollmentId).catch(() => [])
  const asr = (docs || []).filter(d =>
    d.document_type === ASSET_SCORE_DOCUMENT_TYPE
    && /\.pdf$/i.test(d.name || d.storage_path || ''))
  const baseDoc = asr.find(d => /baseline/i.test(d.name || '')) || null
  const impDoc  = asr.find(d => /improved/i.test(d.name || '')) || null

  return { enr, recordTypeValue: rt?.picklist_value || null, fields, units, contractor, secondaryContractor, baseDoc, impDoc, property: prop }
}

// The three documents this feature produces off one Project Reservation
// enrollment. 'proposal' and 'invoice' are built from the parsed Asset Score
// reports (scope + HOMES rebate tier); the 'audit' assessment invoice is a
// fixed-price document ($2,000/building) that reads no Asset Score at all.
export const DOCUMENT_SPECS = {
  proposal: { fileSuffix: 'IRA Multifamily HOMES Proposal',                documentType: 'homes_proposal',                usesReports: true },
  invoice:  { fileSuffix: 'IRA Multifamily HOMES Payment Request Invoice', documentType: 'homes_payment_request_invoice', usesReports: true },
  audit:    { fileSuffix: 'Multifamily Energy Assessment Invoice',         documentType: 'homes_assessment_invoice',      usesReports: false },
}

/**
 * The inputs missing from the record for the given document kind, as
 * human-readable strings. Empty = ready to generate. The assessment invoice
 * ('audit') is fixed-price and needs no Asset Score reports or unit count.
 */
export function homesProposalMissing(ctx, kind = 'proposal') {
  const spec = DOCUMENT_SPECS[kind] || DOCUMENT_SPECS.proposal
  const m = []
  if (spec.usesReports) {
    if (!ctx.baseDoc) m.push('Baseline Asset Score report (attach the “… Baseline - Asset Score.pdf” under Reservation Customer Report)')
    if (!ctx.impDoc)  m.push('Improved Asset Score report (attach the “… Improved - Asset Score.pdf” under Reservation Customer Report)')
    if (!ctx.units)   m.push('Unit count (occupied units on the enrollment, or the building unit count)')
  }
  if (!ctx.contractor) m.push('Primary contractor (Contractor account on the enrollment)')
  return m
}

async function fetchPdfText(doc) {
  const url = await signedUrl(doc.storage_bucket, doc.storage_path, 600)
  if (!url) throw new Error(`Could not read ${doc.name || 'Asset Score report'}`)
  const res = await fetch(proxiedStorageUrl(url))
  if (!res.ok) throw new Error(`Could not download ${doc.name || 'Asset Score report'} (${res.status})`)
  return extractPdfText(await res.arrayBuffer())
}

/**
 * Render one of the enrollment's documents (`kind`: 'proposal' | 'invoice' |
 * 'audit'). Throws with `.missing` (an array of strings) when the record is not
 * ready, so the caller can list exactly what to fix. Returns
 * { blob, fileName, model, ctx, documentType }.
 */
export async function generateHomesProposal(enrollmentId, kind = 'proposal') {
  const spec = DOCUMENT_SPECS[kind] || DOCUMENT_SPECS.proposal
  const ctx = await loadHomesProposalContext(enrollmentId)
  const missing = homesProposalMissing(ctx, kind)
  if (missing.length) { const e = new Error('This enrollment is missing inputs the document needs.'); e.missing = missing; throw e }

  // The proposal and payment-request invoice are built from the Asset Score
  // reports; the fixed-price assessment invoice reads none, so we skip the
  // download and the parse-level gate for it.
  let baseText = null, impText = null
  if (spec.usesReports) {
    ;[baseText, impText] = await Promise.all([fetchPdfText(ctx.baseDoc), fetchPdfText(ctx.impDoc)])
  }

  const model = computeHomesModel({
    fields: ctx.fields, assetScoreBaseText: baseText, assetScoreImpText: impText, units: ctx.units,
  })

  if (spec.usesReports) {
    // Parse-level gate: the reports themselves have to yield the numbers the
    // document is built on, or it would print blanks where money belongs.
    const parseMissing = []
    if (model.savings == null) parseMissing.push('Modeled energy savings — could not be read from the Asset Score reports')
    if (model.roofSqFt == null) parseMissing.push('Attic / roof area — could not be read from the Asset Score reports')
    if (!model.tier || !model.tier.perUnit) parseMissing.push('HOMES rebate tier — the reported savings do not qualify, or savings could not be read')
    if (parseMissing.length) { const e = new Error('The Asset Score reports are attached but incomplete.'); e.missing = parseMissing; throw e }
  }

  const blob = await generateHomesProposalBlob({
    fields: ctx.fields, assetScoreBaseText: baseText, assetScoreImpText: impText,
    units: ctx.units, contractor: ctx.contractor, kind,
  })
  const state = model.state || 'WI'
  const fileName = `${ctx.fields.pjPropName || 'Project'} - ${state} ${spec.fileSuffix}.pdf`
    .replace(/[\\/]/g, '-')
  return { blob, fileName, model, ctx, documentType: spec.documentType }
}

/** Save a generated document onto the enrollment's Documents. */
export async function saveHomesProposalToRecord(enrollmentId, blob, fileName, documentType = 'homes_proposal') {
  const file = new File([blob], fileName, { type: 'application/pdf' })
  return uploadDocument({
    file,
    relatedObject: 'enrollments',
    relatedId:     enrollmentId,
    documentType,
    name:          fileName,
  })
}
