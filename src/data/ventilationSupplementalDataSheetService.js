// ---------------------------------------------------------------------------
// ventilationSupplementalDataSheetService — produces the IRA Home Energy
// Rebates Quality Installation Supplemental Data Sheet for a HEAR Project
// Reservation enrollment, and files it (with the equipment's supporting
// documents) against that enrollment.
//
// The rules live in ../lib/ventilationSupplementalDataSheet — which units get a
// row, how the address reads, what N/A means. This module does the I/O: resolve
// the enrollment's property, building, units and the opportunity's equipment
// lines; fill the programme administrator's own workbook; upload.
//
// ── Cell surgery, not a rebuilt workbook ──────────────────────────────────
//
// The template zip is copied and individual <c> elements are rewritten in
// place, exactly as fillPaperworkWorkbook does for the invoice workbook. Every
// style, column width, merge, print setting and — the one that matters here —
// the Measure Type data validation bound to 'Data Validation'!$B$3:$B$12
// survives byte for byte, because none of it is ever parsed. Rebuilding the
// sheet with the xlsx library (the Tenant Data Sheet's approach) would drop the
// validation silently: the file would open, look right, and no longer be their
// form.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'
import { uploadDocument, listDocuments, hydrateDocumentUrls } from './storageService'
import { fillSupplementalDataSheet } from '../lib/supplementalDataSheetWorkbook.js'
import {
  hasVentilationSupplementalDataSheet,
  SUPPLEMENTAL_SHEET_TEMPLATE_URL,
  SUPPLEMENTAL_SHEET_DOCUMENT_TYPE,
  SUPPLEMENTAL_SHEET_CATEGORY,
  MEASURE_TYPE_BY_EQUIPMENT_RECORD_TYPE,
  buildSupplementalRows,
  supplementalSheetFileName,
} from '../lib/ventilationSupplementalDataSheet.js'

// ── Resolving the enrollment ───────────────────────────────────────────────

/**
 * Everything the sheet needs, in the plain shapes the pure module expects.
 *
 * The equipment comes from the OPPORTUNITY's line items, not from the
 * enrollment — the same route enrollment_work_measures already takes through
 * derive_reservation_work_measures. One entry per equipment line, carrying the
 * unit it is scoped to (usually none, meaning the whole building).
 */
export async function resolveSupplementalSheetData(enrollmentId) {
  if (!enrollmentId) throw new Error('resolveSupplementalSheetData: enrollmentId is required')

  const { data: enr, error: enrErr } = await supabase
    .from('enrollments')
    .select('id, enrollment_record_number, enrollment_name, property_id, building_id, opportunity_id, enrollment_record_type')
    .eq('id', enrollmentId)
    .single()
  if (enrErr) throw new Error(`Could not load the enrollment: ${enrErr.message}`)

  // The record type is resolved HERE, not by the caller. The create path has
  // only the raw draft, where enrollment_record_type is a picklist_values uuid
  // rather than 'WI-IRA-MF-HEAR-Project-Reservation' — a caller-side test on
  // that value silently never matches. One rule, one place, asked of the saved
  // record.
  let recordTypeValue = null
  if (enr.enrollment_record_type) {
    const { data: rt } = await supabase.from('picklist_values')
      .select('picklist_value').eq('id', enr.enrollment_record_type).maybeSingle()
    recordTypeValue = rt?.picklist_value ?? null
  }

  const [{ data: property }, { data: building }] = await Promise.all([
    supabase.from('properties')
      .select('id, property_name, property_aka_name')
      .eq('id', enr.property_id).maybeSingle(),
    enr.building_id
      ? supabase.from('buildings')
          .select('id, building_address, building_city, building_state, building_zip')
          .eq('id', enr.building_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  let units = []
  if (enr.building_id) {
    const { data: unitRows, error: unitErr } = await supabase
      .from('units')
      .select('id, unit_number, unit_name, unit_record_type, picklist_values!units_unit_record_type_fkey(picklist_value)')
      .eq('building_id', enr.building_id)
      .neq('unit_is_deleted', true)
    if (unitErr) throw new Error(`Could not load the building's units: ${unitErr.message}`)
    units = (unitRows || []).map(u => ({
      id: u.id,
      unitNumber: u.unit_number,
      unitRecordType: u.picklist_values?.picklist_value ?? null,
    }))
  }

  let equipmentLines = []
  if (enr.opportunity_id) {
    const { data: lines, error: lineErr } = await supabase
      .from('opportunity_line_items')
      .select(`
        id, unit_id, oli_quantity, oli_is_equipment_line, oli_equipment_product_id,
        equipment:oli_equipment_product_id (
          id, product_name, product_manufacturer, product_model_number,
          product_is_serialized, product_ahri_certificate_number,
          product_record_type
        )
      `)
      .eq('opportunity_id', enr.opportunity_id)
      .eq('oli_is_equipment_line', true)
      .neq('oli_is_deleted', true)
    if (lineErr) throw new Error(`Could not load the opportunity's equipment: ${lineErr.message}`)

    // The equipment product's RECORD TYPE decides the Measure Type, resolved
    // through picklist_values by id. Done in one extra round trip rather than a
    // nested embed because the embed alias collides with the units query above
    // on the same FK name and PostgREST reports it as an ambiguous relationship.
    const rtIds = [...new Set((lines || [])
      .map(l => l.equipment?.product_record_type).filter(Boolean))]
    let rtByID = {}
    if (rtIds.length > 0) {
      const { data: rts } = await supabase.from('picklist_values')
        .select('id, picklist_value').in('id', rtIds)
      rtByID = Object.fromEntries((rts || []).map(r => [r.id, r.picklist_value]))
    }

    equipmentLines = (lines || [])
      .filter(l => l.equipment)
      .map(l => {
        const rt = rtByID[l.equipment.product_record_type] ?? null
        return {
          lineItemId: l.id,
          unitId: l.unit_id ?? null,
          measureType: MEASURE_TYPE_BY_EQUIPMENT_RECORD_TYPE[rt] ?? null,
          equipmentProductId: l.equipment.id,
          equipment: {
            name: l.equipment.product_name,
            manufacturer: l.equipment.product_manufacturer,
            modelNumber: l.equipment.product_model_number,
            isSerialized: l.equipment.product_is_serialized,
            ahriCertificateNumber: l.equipment.product_ahri_certificate_number,
          },
        }
      })
  }

  return {
    enrollment: enr,
    recordTypeValue,
    property: property ? { propertyAkaName: property.property_aka_name, propertyName: property.property_name } : null,
    building: building ? {
      id: building.id,
      address: building.building_address,
      city: building.building_city,
      state: building.building_state,
      zip: building.building_zip,
    } : null,
    units,
    equipmentLines,
  }
}

// ── The supporting documents ───────────────────────────────────────────────

/**
 * Copy the equipment product's documents onto the enrollment.
 *
 * Nicholas: "I do want to include the submittal sheets, the Energy Star
 * certification, and all that. That's going to live on the product record.
 * They're going to flow through as documents onto the enrollment." He chose
 * COPY over link, and the reason holds: a filing packet must be self-contained
 * and frozen as filed. If a manufacturer revises a spec sheet next year, what
 * was submitted is still what was submitted.
 *
 * Deduped by source document id recorded in the copy's name, so a regenerate
 * does not stack a third copy of the same certificate on the enrollment.
 */
export async function copyEquipmentDocumentsToEnrollment(enrollmentId, equipmentProductIds) {
  const ids = [...new Set((equipmentProductIds || []).filter(Boolean))]
  if (ids.length === 0 || !enrollmentId) return []

  const existing = await listDocuments('enrollments', enrollmentId)
  const alreadyCopied = new Set(
    (existing || [])
      .map(d => (String(d.name || '').match(/\[src:([0-9a-f-]{36})\]/) || [])[1])
      .filter(Boolean)
  )

  const copied = []
  for (const productId of ids) {
    const sourceDocs = await listDocuments('products', productId)
    const hydrated = await hydrateDocumentUrls(sourceDocs || [])
    for (const doc of hydrated) {
      if (alreadyCopied.has(doc.id)) continue
      if (!doc.file_url) continue
      try {
        const res = await fetch(doc.file_url)
        if (!res.ok) throw new Error(`download returned ${res.status}`)
        const blob = await res.blob()
        const file = new File([blob], doc.name || 'Supporting document', {
          type: doc.mime_type || blob.type || 'application/octet-stream',
        })
        const row = await uploadDocument({
          file,
          relatedObject: 'enrollments',
          relatedId: enrollmentId,
          documentType: 'hear_equipment_supporting_document',
          // The source id rides in the name so a regenerate can tell an already
          // copied file from a new one WITHOUT a schema change. Documents carry
          // no "copied from" column, and adding one to serve a dedupe would be a
          // column nothing else ever reads.
          name: `${doc.name || 'Supporting document'} [src:${doc.id}]`,
          category: SUPPLEMENTAL_SHEET_CATEGORY,
        })
        copied.push(row)
      } catch (err) {
        // One unreadable supporting file must not sink the sheet itself — the
        // sheet is the deliverable, the attachments are supporting. Reported
        // back to the caller as a warning instead.
        copied.push({ _failed: true, name: doc.name, reason: err.message })
      }
    }
  }
  return copied
}

// ── The public entry point ─────────────────────────────────────────────────

/**
 * Generate the sheet and file it against the enrollment.
 *
 * Called on enrollment create (auto) and from the Regenerate action. Returns
 * { document, rows, warnings, supportingDocuments } so the caller can tell the
 * person what landed and what is still missing.
 */
export async function generateVentilationSupplementalDataSheet(enrollmentId, { fetchTemplate } = {}) {
  const data = await resolveSupplementalSheetData(enrollmentId)

  // Only the HEAR Project Reservation files this sheet. Checked against the
  // SAVED record's resolved record type, so the automatic create path can call
  // this for any enrollment and the wrong ones simply do nothing.
  if (!hasVentilationSupplementalDataSheet('enrollments', data.recordTypeValue)) {
    return { skipped: true, document: null, rows: [], warnings: [], supportingDocuments: [] }
  }

  const { rows, warnings } = buildSupplementalRows(data)

  const loadTemplate = fetchTemplate || (async () => {
    const res = await fetch(SUPPLEMENTAL_SHEET_TEMPLATE_URL)
    if (!res.ok) throw new Error(`Could not load the supplemental data sheet template (${res.status}).`)
    return res.arrayBuffer()
  })

  const blob = await fillSupplementalDataSheet(rows, await loadTemplate())
  const fileName = supplementalSheetFileName({
    building: data.building,
    enrollmentRecordNumber: data.enrollment.enrollment_record_number,
  })
  const file = new File([blob], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const document = await uploadDocument({
    file,
    relatedObject: 'enrollments',
    relatedId: enrollmentId,
    documentType: SUPPLEMENTAL_SHEET_DOCUMENT_TYPE,
    name: fileName,
    category: SUPPLEMENTAL_SHEET_CATEGORY,
  })

  const supportingDocuments = await copyEquipmentDocumentsToEnrollment(
    enrollmentId,
    data.equipmentLines.map(l => l.equipmentProductId)
  )
  const failed = supportingDocuments.filter(d => d._failed)
  for (const f of failed) {
    warnings.push(`The supporting file "${f.name}" could not be copied from the product record (${f.reason}).`)
  }

  return {
    document,
    rows,
    warnings,
    supportingDocuments: supportingDocuments.filter(d => !d._failed),
  }
}

/** Every supplemental data sheet filed against an enrollment, newest first. */
export async function listSupplementalDataSheets(enrollmentId) {
  if (!enrollmentId) return []
  const docs = await listDocuments('enrollments', enrollmentId)
  const mine = (docs || []).filter(d => d.document_type === SUPPLEMENTAL_SHEET_DOCUMENT_TYPE)
  return hydrateDocumentUrls(mine)
}
