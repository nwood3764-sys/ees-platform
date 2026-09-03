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
import { loadEnrollmentProposalContext } from './enrollmentProposalContext'
import {
  computeHearModel, generateHearProposalBlob, hearRowsFromLineItems,
} from '../lib/hearProposal'

// The enrollment record type this proposal is built for.
export const HEAR_PROPOSAL_RECORD_TYPE = 'WI-IRA-MF-HEAR-Project-Reservation'
// The document type the saved PDF is filed under.
export const HEAR_PROPOSAL_DOCUMENT_TYPE = 'hear_proposal'

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
