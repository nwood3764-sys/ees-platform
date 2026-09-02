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
  product:product_id ( product_name, product_description ),
  unit:unit_id ( unit_name )
`

// Flatten the embedded parent objects to display strings the grid reads by name.
function normalize(row) {
  if (!row) return row
  const { product, unit, ...rest } = row
  return {
    ...rest,
    product_name: product?.product_name ?? null,
    product_description: product?.product_description ?? null,
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
  return (data || []).map(r => ({ value: r.id, label: r.product_name || r.id.slice(0, 8) }))
}

/**
 * Add a product as a new line. Quantity defaults to 1; the DB trigger resolves
 * the price book entry, list price, sales price, and description from the
 * product against the opportunity's price book.
 */
export async function addOpportunityProduct(opportunityId, productId, sortOrder) {
  const userId = await getCurrentUserId()
  const fields = await applyInsertDefaults(OLI, {
    opportunity_id: opportunityId,
    product_id: productId,
    oli_quantity: 1,
    oli_sort_order: sortOrder,
    oli_name: 'NEW', // overwritten by trg_oli_name from the product
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
