// Network only. The widget, its equipment step and its create form are the
// shipped ones.
//
// The product list mirrors the real Wisconsin IRA Multifamily HEAR price book
// on production: five measures that demand a model-numbered device, and the two
// electrical measures that do not (Nicholas, 2026-09-03: "We do not need
// electrical wiring or a load center on the supplemental data sheet. It's not
// hvac equipment.").
export const captured = { added: [], created: [], listedFor: [] }

const MEASURES = [
  { value: 'm-vent',   label: 'ENERGY STAR Ventilation',                              requiresEquipment: true },
  { value: 'm-hp',     label: 'ENERGY STAR Electric Heat Pump for Space Heating and Cooling', requiresEquipment: true },
  { value: 'm-hpwh',   label: 'ENERGY STAR Electric Heat Pump Water Heater',          requiresEquipment: true },
  { value: 'm-dryer',  label: 'ENERGY STAR Electric Heat Pump Clothes Dryer',         requiresEquipment: true },
  { value: 'm-stove',  label: 'ENERGY STAR Electric Stove, Cooktop, or Range',        requiresEquipment: true },
  { value: 'm-wiring', label: 'Electrical Wiring',                                    requiresEquipment: false },
  { value: 'm-panel',  label: 'Electrical Load Service Center (Electrical Panel)',    requiresEquipment: false },
]

// Ventilation has an approved model; the heat pump deliberately has NONE, which
// is the state Nicholas hit — the case that must offer a way forward rather
// than a dead end.
const MODELS = { 'm-vent': [{ value: 'e-fan', label: 'Panasonic FV-0511VF1' }] }

export async function listOpportunityProducts() { return [] }
export async function getOpportunityPriceBook() {
  return { price_book_id: 'pb-1', price_book_name: 'Wisconsin IRA Multifamily HEAR' }
}
export async function listSelectablePriceBooks() { return [] }
export async function setOpportunityPriceBook() { return {} }
export async function getOpportunityRebateCapStatus() {
  return { perUnitCap: 14000, units: 8, totalCap: 112000, used: 0 }
}
export async function listAddableProducts() { return MEASURES }
export async function listQualifyingEquipment(measureId) {
  captured.listedFor.push(measureId)
  return MODELS[measureId] || []
}
export async function createQualifyingEquipment(measureId, manufacturer, modelNumber) {
  captured.created.push({ measureId, manufacturer, modelNumber })
  const id = `e-new-${captured.created.length}`
  ;(MODELS[measureId] = MODELS[measureId] || []).push({
    value: id, label: [manufacturer, modelNumber].filter(Boolean).join(' '),
  })
  return id
}
export async function addOpportunityProduct(oppId, productId, sortOrder, equipmentProductId = null) {
  const measure = MEASURES.find(m => m.value === productId)
  // The real database refuses this, so the stub does too — otherwise the
  // harness would pass on a path production rejects.
  if (measure?.requiresEquipment && !equipmentProductId) {
    const e = new Error(`"${measure.label}" needs the specific equipment being installed.`)
    throw e
  }
  captured.added.push({ productId, equipmentProductId })
  return {
    id: `oli-${captured.added.length}`, oli_record_number: `OLI-9000${captured.added.length}`,
    product_id: productId, product_name: measure?.label || productId,
    oli_equipment_product_id: equipmentProductId,
    oli_is_equipment_line: !!measure?.requiresEquipment,
    equipment_name: equipmentProductId
      ? (MODELS[productId] || []).find(m => m.value === equipmentProductId)?.label || null
      : null,
    oli_quantity: 1, oli_unit_price: 0, oli_list_price: 0, oli_total_price: 0,
    oli_sort_order: sortOrder,
  }
}
export async function updateOpportunityProductField() { return {} }
export async function removeOpportunityProduct() { return {} }
export async function reorderOpportunityProducts() { return {} }
