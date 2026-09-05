// ---------------------------------------------------------------------------
// hearProposalService — assembles the IRA Multifamily HEAR Project Reservation
// proposal for one ENROLLMENT and saves the PDF back onto it.
//
// Everything the proposal needs is already on the record:
//   · the owner / contact / unit count / primary contractor, on the enrollment
//   · the install address + income-qualification number, on the property
//   · THE SCOPE — the opportunity's line items, on the HEAR products in the
//     catalog (HEAR-PANEL, HEAR-STOVE, HEAR-WIRING, HEAR-DRYER,
//     HEAR-HP-SPACE-HEAT-COOL, HEAR-HPWH, HEAR-VENT)
//
// The scope is the whole reason this is not a copy of the HOMES proposal. The
// HOMES proposal derives its scope by parsing two DOE Asset Score reports; a
// HEAR project has no modelled savings and no Asset Score — it is a list of
// equipment, and LEAP already holds that list as line items. So this reads no
// PDFs at all, and the proposal, the project cost and the programme rebate all
// come off the same rows.
//
// The action blocks and lists exactly what is missing rather than generating a
// half-built proposal.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'
import { uploadDocument } from './storageService'
import { requireOutboundApproval } from '../lib/outboundSendGuard'
import { loadEnrollmentProposalContext } from './enrollmentProposalContext'
import {
  computeHearModel, generateHearProposalBlob, generateHearProposalWithSignatureTabs, hearRowsFromLineItems,
} from '../lib/hearProposal'

// The enrollment record type this proposal is built for.
export const HEAR_PROPOSAL_RECORD_TYPE = 'WI-IRA-MF-HEAR-Project-Reservation'
// The document type the saved PDF is filed under.
// The proposal IS the customer's contract and scope of work, so it files itself
// into that slot on the enrollment (Nicholas, 2026-09-03: "I just saved the
// record, but it disappeared. This needs to go in the proposal section... we
// call it Customer Contract and Scope of Work Section").
//
// It was saved as `hear_proposal`, a type no card on the layout reads, so the
// document existed and appeared nowhere — which reads exactly like a save that
// did not happen. A generated document has to land in a slot somebody looks at.
export const HEAR_PROPOSAL_DOCUMENT_TYPE = 'customer_contract_sow'

// Line items plus the product facts the proposal prints: which measure it is
// (the code), what was installed (manufacturer + model) and how efficient it is.
const LINE_ITEM_SELECT = `
  id, oli_quantity, oli_unit_price, oli_total_price, oli_line_description, oli_sort_order,
  product:product_id (
    product_code, product_name, product_manufacturer, product_model_number,
    product_seer2, product_eer2, product_hspf2_region_iv, product_hspf2_region_v
  )
`

/** The opportunity's line items, flattened to what hearRowsFromLineItems reads. */
export async function loadHearScopeLineItems(opportunityId) {
  if (!opportunityId) return []
  const { data, error } = await supabase
    .from('opportunity_line_items')
    .select(LINE_ITEM_SELECT)
    .eq('opportunity_id', opportunityId)
    .or('oli_is_deleted.is.null,oli_is_deleted.eq.false')
    .order('oli_sort_order', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  return (data || []).map(r => ({
    productCode:     r.product?.product_code || '',
    productName:     r.product?.product_name || '',
    manufacturer:    r.product?.product_manufacturer || '',
    modelNumber:     r.product?.product_model_number || '',
    seer2:           r.product?.product_seer2,
    eer2:            r.product?.product_eer2,
    // Region V is the cold-climate rating; Wisconsin and Michigan sit there, so
    // it is preferred when both are present.
    hspf2:           r.product?.product_hspf2_region_v ?? r.product?.product_hspf2_region_iv,
    quantity:        r.oli_quantity,
    unitPrice:       r.oli_unit_price,
    lineDescription: r.oli_line_description || '',
  }))
}

/**
 * Load everything one enrollment needs for its HEAR proposal. Returns
 * `{ ...enrollment context, lineItems, rows, unmapped }`.
 */
export async function loadHearProposalContext(enrollmentId) {
  const ctx = await loadEnrollmentProposalContext(enrollmentId)
  const lineItems = await loadHearScopeLineItems(ctx.enr?.opportunity_id)
  const { rows, unmapped } = hearRowsFromLineItems(lineItems)
  return { ...ctx, lineItems, rows, unmapped }
}

/**
 * The inputs missing from the record, as human-readable strings. Empty = ready
 * to generate.
 */
export function hearProposalMissing(ctx) {
  const m = []
  if (!ctx.rows || !ctx.rows.length) {
    m.push(ctx.enr?.opportunity_id
      ? 'HEAR equipment on the opportunity (add the HEAR products — heat pump, water heater, panel, wiring, ventilation — as Opportunity Products, with a quantity and a per-unit price)'
      : 'Opportunity (the enrollment has no opportunity, so there is no scope to propose)')
  } else if (!ctx.rows.some(r => Number(r.cost) > 0)) {
    m.push('A price on the HEAR equipment (every line is $0.00, so the proposal would offer nothing)')
  }
  if (!ctx.units) m.push('Unit count (occupied units, or the building unit count)')
  if (!ctx.contractor) m.push('Primary contractor (Contractor account on the record)')
  return m
}

/**
 * Generate the HEAR proposal for one enrollment. Throws with `.missing` (array
 * of strings) when the record isn't ready. Returns
 * `{ blob, fileName, model, ctx, documentType, unmapped }`.
 */
export async function generateHearProposal(enrollmentId) {
  const ctx = await loadHearProposalContext(enrollmentId)
  const missing = hearProposalMissing(ctx)
  if (missing.length) { const e = new Error('This record is missing inputs the proposal needs.'); e.missing = missing; throw e }

  const input = { fields: ctx.fields, units: ctx.units, rows: ctx.rows, contractor: ctx.contractor }
  const model = computeHearModel(input)
  const blob = await generateHearProposalBlob(input)
  // The document is named for the RECORD it belongs to (Nicholas, 2026-09-03):
  // the enrollment's own name, verbatim — "570 South Clark Street - Whitewater -
  // 570 - WI-IRA-MF-HEAR-Project-Reservation". It already carries the address,
  // the building and the programme, composed by the enrollment's own name
  // trigger, so a second composed title here would be a second naming rule that
  // could disagree with the record it is filed under. Only characters a file
  // name cannot hold are changed. The old composed title is the fallback for a
  // record with no name.
  const fileName = `${(ctx.enr?.enrollment_name || '').trim()
    || `${ctx.fields.pjPropName || 'Project'} - ${model.state} IRA Multifamily HEAR Proposal`}.pdf`
    .replace(/[\\/:*?"<>|]/g, '-')
  return { blob, fileName, model, ctx, documentType: HEAR_PROPOSAL_DOCUMENT_TYPE, unmapped: ctx.unmapped }
}

/** Save a generated HEAR proposal onto the enrollment's Documents. */
export async function saveHearProposal({ object = 'enrollments', id }, blob, fileName,
  documentType = HEAR_PROPOSAL_DOCUMENT_TYPE) {
  const file = new File([blob], fileName, { type: 'application/pdf' })
  return uploadDocument({ file, relatedObject: object, relatedId: id, documentType, name: fileName })
}


// ---------------------------------------------------------------------------
// Send for signature
//
// Nicholas: "When we make the proposal for the HEAR project reservation, we need
// to send it out for signature and then through the LEAP software. Then it comes
// back when it's signed." And: "I know you need to build the action just like we
// have for everything else."
//
// Mirrors the project submittal route (ProjectSubmittalDocumentsModal) rather
// than inventing a second one: generate with tabs -> upload -> send-envelope
// with source_document_id. The difference is only the parent object — this hangs
// off an ENROLLMENT, which is what makes the envelope's own status move the
// enrollment (trg_zzz_enrollment_status_from_envelope, 20260903044012).
// ---------------------------------------------------------------------------

/**
 * Generate the HEAR proposal, file it, and send it to the property owner for
 * signature.
 *
 * The recipient is NAMED BACK to the sender through requireOutboundApproval
 * before anything leaves the building. That is LEAP's hard rule and it applies
 * here for the reason it exists: this address is inherited from a record, not
 * typed, and the last time a populated field was treated as consent to contact
 * somebody a real property contact was emailed about work that was not theirs.
 *
 * Returns { document, envelope, signingUrl, emailed }.
 */
export async function sendHearProposalForSignature(enrollmentId, { name, email, subject } = {}) {
  const to = String(email || '').trim()
  if (!to) throw new Error('Enter the property owner’s email address.')

  const ctx = await loadHearProposalContext(enrollmentId)
  const missing = hearProposalMissing(ctx)
  if (missing.length) { const e = new Error('This record is missing inputs the proposal needs.'); e.missing = missing; throw e }

  const input = { fields: ctx.fields, units: ctx.units, rows: ctx.rows, contractor: ctx.contractor }
  const { blob, tabs } = await generateHearProposalWithSignatureTabs(input)
  if (!tabs.length) {
    throw new Error('The proposal rendered without a signature block, so there is nowhere to place a signature.')
  }

  const model = computeHearModel(input)
  const fileName = `${(ctx.enr?.enrollment_name || '').trim()
    || `${ctx.fields.pjPropName || 'Project'} - ${model.state} IRA Multifamily HEAR Proposal`}.pdf`
    .replace(/[\\/:*?"<>|]/g, '-')
  const line = `Please sign: ${fileName.replace(/\.pdf$/, '')}`
  const subj = String(subject || '').trim() || line

  // The gate, before the upload — so a declined send leaves no orphan document
  // on the record implying something went out.
  requireOutboundApproval({
    channel: 'email',
    to,
    subject: subj,
    context: 'This sends the HEAR proposal to the property owner for signature.',
  })

  const file = new File([blob], fileName, { type: 'application/pdf' })
  const document = await uploadDocument({
    file, relatedObject: 'enrollments', relatedId: enrollmentId,
    documentType: HEAR_PROPOSAL_DOCUMENT_TYPE, name: fileName,
  })

  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) throw new Error('Not signed in — refresh and sign in again.')

  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-envelope`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      source_document_id: document.id,
      parent_object: 'enrollments',
      parent_record_id: enrollmentId,
      recipients: [{
        name: String(name || '').trim() || ctx.fields?.pjContact || 'Property Owner',
        email: to, role: 'Property Owner', order: 1,
      }],
      subject: subj,
      signing_base_url: window.location.origin,
      tabs,
    }),
  })
  const j = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(j.error || j.failure_reason || `send-envelope returned ${resp.status}`)

  return {
    document,
    envelope: j.envelope_id || null,
    signingUrl: j.signing_urls?.find(u => u.order === 1)?.signing_url || null,
    emailed: j.email_send_results?.[0]?.status === 'sent',
  }
}
