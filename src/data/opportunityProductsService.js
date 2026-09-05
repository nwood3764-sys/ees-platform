// Opportunity Products service — the data layer behind the Salesforce-style
// inline "Opportunity Products" table on the opportunity record page.
//
// Line items are ordinary opportunity_line_items rows; this module is a
// purpose-built, embed-aware CRUD surface for the grid so the component never
// has to know PostgREST shapes. Pricing stays product-driven: adding a product
// or leaving quantity/price to the DB lets trg_oli_defaults resolve the price
// book entry, list price, sales price, and description (20260729023310).

import { supabase } from '../lib/supabase'
import {
  getCurrentUserId,
  insertRecord,
  applyInsertDefaults,
  saveRecord,
  deleteRecord,
} from './layoutService'

const OLI = 'opportunity_line_items'

// Grid columns plus the product/unit display embeds, one round trip.
const SELECT = `
  id, oli_record_number, oli_name, opportunity_id, product_id, price_book_entry_id,
  unit_id, oli_quantity, oli_unit_price, oli_list_price, oli_total_price,
  oli_line_description, oli_notes, oli_sort_order, oli_created_at,
  oli_equipment_product_id, oli_is_equipment_line,
  product:product_id ( product_name, product_description, product_requires_equipment_selection ),
  equipment:oli_equipment_product_id ( product_name, product_manufacturer, product_model_number ),
  unit:unit_id ( unit_name )
`

/**
 * How the programme administrator reads a model: "Panasonic FV-0511VF1".
 *
 * Composed from manufacturer + model number rather than the product NAME,
 * because those two columns are the equipment's identity while a name is free
 * text somebody can rename. Same rule the supplemental data sheet prints by —
 * what you pick here is literally what lands in its Model Number column.
 */
function equipmentLabel(e) {
  if (!e) return null
  const parts = [e.product_manufacturer, e.product_model_number].filter(Boolean)
  return parts.length ? parts.join(' ') : (e.product_name ?? null)
}

// Flatten the embedded parent objects to display strings the grid reads by name.
function normalize(row) {
  if (!row) return row
  const { product, unit, equipment, ...rest } = row
  return {
    ...rest,
    product_name: product?.product_name ?? null,
    product_description: product?.product_description ?? null,
    product_requires_equipment: product?.product_requires_equipment_selection === true,
    equipment_name: equipmentLabel(equipment),
    unit_name: unit?.unit_name ?? null,
  }
}

/** All active line items on an opportunity, in display order. */
export async function listOpportunityProducts(opportunityId) {
  const { data, error } = await supabase
    .from(OLI)
    .select(SELECT)
    .eq('opportunity_id', opportunityId)
    .or('oli_is_deleted.is.null,oli_is_deleted.eq.false')
    .order('oli_sort_order', { ascending: true, nullsFirst: false })
    .order('oli_created_at', { ascending: true })
  if (error) throw error
  return (data || []).map(normalize)
}

/** Re-read one line item with its embeds (after an insert/update). */
export async function getOpportunityProduct(id) {
  const { data, error } = await supabase.from(OLI).select(SELECT).eq('id', id).single()
  if (error) throw error
  return normalize(data)
}

/**
 * Products addable to this opportunity — those with an active price book entry
 * in the opportunity's price book (falls back to any active entry when the
 * opportunity has no book yet). Same scoped RPC the Product picker uses.
 */
export async function listAddableProducts(opportunityId) {
  const { data, error } = await supabase.rpc('list_products_for_opportunity', {
    p_opportunity_ids: [opportunityId],
    p_include_product_id: null,
  })
  if (error) throw error
  const rows = data || []
  if (rows.length === 0) return []

  // Which of these measures demand the specific equipment being installed. The
  // RPC does not return the flag, so it is read here in one extra round trip
  // rather than by the grid per click — the picker has to know BEFORE the click
  // whether choosing this product opens the equipment step.
  const { data: flags } = await supabase
    .from('products')
    .select('id, product_requires_equipment_selection')
    .in('id', rows.map(r => r.id))
  const requires = new Map((flags || []).map(f => [f.id, f.product_requires_equipment_selection === true]))

  return rows.map(r => ({
    value: r.id,
    label: r.product_name || r.id.slice(0, 8),
    requiresEquipment: requires.get(r.id) === true,
  }))
}

/**
 * The equipment models approved for one incentive measure.
 *
 * Scoped by product_qualifying_equipment through the same RPC the line item's
 * own picker uses, so the Products grid and the record page can never offer
 * different answers for the same measure.
 */
export async function listQualifyingEquipment(measureProductId, includeProductId = null) {
  if (!measureProductId) return []
  const { data, error } = await supabase.rpc('list_qualifying_equipment_for_measure', {
    p_measure_product_ids: [measureProductId],
    p_include_product_id: includeProductId,
  })
  if (error) throw error
  return (data || []).map(r => ({
    value: r.id,
    label: equipmentLabel(r) || r.id.slice(0, 8),
  }))
}

/**
 * Create an equipment product for a measure and approve it, in one call.
 *
 * The escape hatch that makes an UNCONDITIONAL equipment requirement workable
 * (Nicholas: "If I pick a HEAR measure, a piece of equipment has to come with
 * it. There's no option."). Without it, a measure whose models are not set up
 * yet is a wall; with it, it is a form. The product's record type comes from
 * the measure itself, and the product and its approval link are made together
 * server-side so the picker can never be handed a product it cannot offer.
 */
export async function createQualifyingEquipment(measureProductId, manufacturer, modelNumber) {
  const { data, error } = await supabase.rpc('create_qualifying_equipment_for_measure', {
    p_measure_product_id: measureProductId,
    p_manufacturer: manufacturer || null,
    p_model_number: modelNumber,
  })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Add a product as a new line. Quantity defaults to 1; the DB trigger resolves
 * the price book entry, list price, sales price, and description from the
 * product against the opportunity's price book.
 */
export async function addOpportunityProduct(opportunityId, productId, sortOrder, equipmentProductId = null) {
  const userId = await getCurrentUserId()
  const fields = await applyInsertDefaults(OLI, {
    opportunity_id: opportunityId,
    product_id: productId,
    oli_quantity: 1,
    oli_sort_order: sortOrder,
    oli_name: 'NEW', // overwritten by trg_oli_name from the product
    // Only sent when the measure actually installs one. A null on a measure
    // that forbids equipment is the same as omitting it; sending a value there
    // is refused by enforce_line_item_equipment_selection.
    ...(equipmentProductId ? { oli_equipment_product_id: equipmentProductId } : {}),
  }, userId)
  const inserted = await insertRecord(OLI, fields)
  return await getOpportunityProduct(inserted.id)
}

/**
 * Update a single editable cell. Returns the re-read row so the grid picks up
 * any trigger-recomputed values (e.g. Total = Quantity x Sales Price).
 */
export async function updateOpportunityProductField(id, field, value) {
  await saveRecord(OLI, id, { [field]: value })
  return await getOpportunityProduct(id)
}

/** Soft-delete a line item (remove it from the opportunity). */
export async function removeOpportunityProduct(id) {
  return await deleteRecord(OLI, id)
}

/**
 * Persist a new row order. oli_sort_order has no unique constraint, so a
 * straight 1..n renumber in the given id order is safe.
 */
export async function reorderOpportunityProducts(orderedIds) {
  await Promise.all(
    orderedIds.map((id, i) => saveRecord(OLI, id, { oli_sort_order: i + 1 })),
  )
}

// ---------------------------------------------------------------------------
// Price book — lives on the opportunity. Derived from the record type when it
// maps to a book (unchangeable); otherwise chosen by the user on the first
// product add and preserved (see migration 20260729032447).
// ---------------------------------------------------------------------------

/** The opportunity's current price book (id + name), or nulls if none set. */
export async function getOpportunityPriceBook(opportunityId) {
  const { data, error } = await supabase
    .from('opportunities')
    .select('price_book_id, book:price_book_id ( price_book_name )')
    .eq('id', opportunityId)
    .single()
  if (error) throw error
  return {
    price_book_id: data?.price_book_id ?? null,
    price_book_name: data?.book?.price_book_name ?? null,
  }
}

/** Active price books a user can assign (excludes the empty Standard book). */
export async function listSelectablePriceBooks() {
  const { data, error } = await supabase
    .from('price_books')
    .select('id, price_book_name')
    .eq('price_book_is_deleted', false)
    .or('price_book_is_active.is.null,price_book_is_active.eq.true')
    .or('price_book_is_standard.is.null,price_book_is_standard.eq.false')
    .order('price_book_name', { ascending: true })
  if (error) throw error
  return (data || []).map(r => ({ value: r.id, label: r.price_book_name || r.id.slice(0, 8) }))
}

/**
 * Assign the opportunity's price book. Persists only when the record type has
 * no mapping (the trigger re-forces the mapped book otherwise) — the caller
 * only prompts in the unmapped case.
 */
export async function setOpportunityPriceBook(opportunityId, priceBookId) {
  const row = await saveRecord('opportunities', opportunityId, { price_book_id: priceBookId })
  return row?.price_book_id ?? priceBookId
}

// ---------------------------------------------------------------------------
// Per-dwelling-unit rebate cap. Some programs (IRA HEAR) cap the TOTAL rebate a
// single dwelling unit may receive across all measures, so the figure that
// matters is not the grand total but the worst-off unit. That rule lives in the
// database (opportunity_rebate_cap_status, migration 20260830...) and is not
// re-implemented here — one definition, so the screen and any future validation
// can never disagree about whether a project is over.
// ---------------------------------------------------------------------------

/**
 * Cap status for an opportunity, or null when its program has no cap configured
 * (most programs). Never invents a limit: no row means no cap to show.
 */
export async function getOpportunityRebateCapStatus(opportunityId) {
  const { data, error } = await supabase
    .rpc('opportunity_rebate_cap_status', { p_opportunity_id: opportunityId })
  if (error) throw error
  return (Array.isArray(data) ? data[0] : data) ?? null
}
