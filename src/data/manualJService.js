// Reading a Manual J report off a dropped PDF, and filing it on the assessment.
//
// The pure work — layout, parse, design load, NEEP parameters — lives in
// src/lib/{pdfTextLayout,conduitManualJ,manualJDesignLoad}.js and is pinned by
// scripts/conduit-manual-j-fixture.mjs against the real 2506 Frazier Ave
// report. This module is the part that touches pdf.js, storage and the
// database, and nothing else.

import { supabase } from '../lib/supabase'
import { loadPdfJs } from '../lib/pdfjsLoader.js'
import { rowsFromPages } from '../lib/pdfTextLayout.js'
import { parseConduitManualJ } from '../lib/conduitManualJ.js'
import {
  designLoadCandidates, recommendedDesignLoad, designLoadNotices, neepSearchParameters,
} from '../lib/manualJDesignLoad.js'
import { uploadDocument } from './storageService'

// The version the Asset Score reader already runs in production.
const PDFJS_VERSION = '4.0.379'

// Stamped onto every saved report. When the parser changes, a report saved by
// the old one still says which rules read it.
export const PARSER_VERSION = 'conduit-manual-j@1'

/**
 * A dropped file → the parsed report, its design-load candidates and the NEEP
 * search it fills in. Nothing is written; this is what the review screen shows.
 *
 * @param {File} file
 * @param {object} context what LEAP knows — { constructionYear, postalCode }
 */
export async function extractManualJFromPdf(file, context = {}) {
  if (!file) throw new Error('No file was given')
  const name = String(file.name || '')
  if (!/\.pdf$/i.test(name) && file.type !== 'application/pdf') {
    throw new Error(`${name || 'That file'} is not a PDF. Drop the Conduit Tech Manual J report.`)
  }

  const buffer = await file.arrayBuffer()
  const pdfjs = await loadPdfJs(PDFJS_VERSION)
  const pdf = await pdfjs.getDocument({ data: buffer }).promise

  const pages = []
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      pages.push(content.items)
    }
  } finally {
    try { await pdf.destroy() } catch { /* a preview that will not clean up is not a failure */ }
  }

  const report = parseConduitManualJ(rowsFromPages(pages))
  const candidates = designLoadCandidates(report)
  const chosen = recommendedDesignLoad(report)

  return {
    report,
    candidates,
    chosen,
    notices: designLoadNotices(report),
    neep: neepSearchParameters(report, context, chosen),
    pageCount: pdf.numPages,
    fileName: name,
  }
}

/**
 * What LEAP already knows about the assessment, so the review screen can fill
 * in the one field a Manual J does not carry.
 *
 * The construction year is taken from the most specific record that has one —
 * the assessment, then the building, then the property. A year is never
 * invented: when nothing holds one the field is left empty and asked for.
 */
export async function fetchManualJContext(assessmentId) {
  if (!assessmentId) return {}
  const { data, error } = await supabase
    .from('assessments')
    .select(`
      id, property_id, building_id, opportunity_id, project_id, assessment_year_built,
      buildings:building_id ( id, building_name, building_year_built ),
      properties:property_id ( id, property_name, property_year_built, property_zip, property_state )
    `)
    .eq('id', assessmentId)
    .maybeSingle()
  if (error) throw error
  if (!data) return {}

  const building = data.buildings || null
  const property = data.properties || null
  const year = data.assessment_year_built
    || (building && building.building_year_built)
    || (property && property.property_year_built)
    || null

  return {
    assessmentId: data.id,
    propertyId: data.property_id,
    buildingId: data.building_id,
    opportunityId: data.opportunity_id,
    projectId: data.project_id,
    constructionYear: year != null ? Number(year) : null,
    constructionYearSource: data.assessment_year_built ? 'this assessment'
      : (building && building.building_year_built) ? 'the building record'
        : (property && property.property_year_built) ? 'the property record' : null,
    postalCode: (property && property.property_zip) || null,
    buildingName: building && building.building_name,
    propertyName: property && property.property_name,
  }
}

/**
 * File the reviewed report. The PDF is uploaded to the assessment first — it is
 * the evidence artifact, and a load calculation whose source cannot be produced
 * is a number somebody typed.
 *
 * The rows themselves go through one RPC so a report is written whole or not at
 * all: 1 report, up to 17 blocks, 255 components and 14 assemblies written one
 * statement at a time leaves a half-saved load calculation that reads exactly
 * like a complete one.
 */
export async function saveManualJReport({ assessmentId, file, extraction, values }) {
  if (!assessmentId) throw new Error('An assessment is required — a Manual J belongs to one')
  if (!extraction || !extraction.report) throw new Error('Nothing has been read from a report yet')

  let documentId = null
  if (file) {
    const uploaded = await uploadDocument({
      file,
      relatedObject: 'assessments',
      relatedId: assessmentId,
      documentType: 'manual_j_report',
      name: file.name,
      category: 'Manual J Load Calculation',
    })
    documentId = uploaded && (uploaded.id || (uploaded.document && uploaded.document.id)) || null
  }

  const r = extraction.report
  const address = r.subject.address || {}
  const heating = r.designConditions.heating || {}
  const cooling = r.designConditions.cooling || {}
  const v = values || {}

  const payload = {
    document_id: documentId,
    source_software: r.source.software,
    manual_j_version: r.source.manualJVersion,
    report_title: r.source.reportTitle,
    report_created_by: r.source.createdBy,
    report_created_at_text: r.source.createdAt,
    report_updated_at_text: r.source.lastUpdatedAt,
    source_file_name: (file && file.name) || extraction.fileName || null,

    subject_name: r.subject.name,
    subject_address: address.raw || null,
    subject_street: address.street || null,
    subject_city: address.city || null,
    subject_state: address.state || null,
    subject_postal_code: address.postalCode || null,

    weather_station: r.designConditions.weatherStation,
    elevation_ft: r.designConditions.elevationFt,
    latitude: r.designConditions.latitude,
    altitude_correction_factor: r.designConditions.altitudeCorrectionFactor,
    heating_outdoor_db_f: heating.outdoorDryBulbF,
    heating_indoor_db_f: heating.indoorDryBulbF,
    heating_temp_difference_f: heating.temperatureDifferenceF,
    cooling_outdoor_db_f: cooling.outdoorDryBulbF,
    cooling_indoor_db_f: cooling.indoorDryBulbF,
    cooling_temp_difference_f: cooling.temperatureDifferenceF,
    cooling_indoor_rh_pct: cooling.indoorRelativeHumidityPct,
    cooling_daily_range: cooling.dailyRange,
    cooling_grains_difference: cooling.grainsDifference,

    // The values the reviewer confirmed, not the ones the parser proposed.
    design_heating_load_btuh: numberOrNull(v.designHeatingLoadBtuh),
    design_cooling_load_btuh: numberOrNull(v.designCoolingLoadBtuh),
    design_sensible_cooling_btuh: numberOrNull(v.designSensibleCoolingBtuh),
    design_latent_cooling_btuh: numberOrNull(v.designLatentCoolingBtuh),
    design_load_basis: v.designLoadBasis || null,
    design_load_basis_id: v.designLoadBasisId || null,
    conditioned_floor_area_sq_ft: numberOrNull(v.buildingSquareFootage),
    neep_construction_year: numberOrNull(v.constructionYear),
    neep_ducting_configuration: v.ductingConfiguration || null,
    notes: v.notes || null,

    parser_version: PARSER_VERSION,
    raw_extract: {
      parser: PARSER_VERSION,
      warnings: r.warnings,
      designConditions: r.designConditions,
      source: r.source,
      subject: r.subject,
      blockCount: r.blocks.length,
      materialCount: r.materials.length,
      pageCount: extraction.pageCount || null,
    },
    blocks: r.blocks,
    materials: r.materials,
  }

  const { data, error } = await supabase.rpc('save_manual_j_report', {
    p_assessment_id: assessmentId,
    p_payload: payload,
  })
  if (error) throw error
  return data
}

function numberOrNull(x) {
  if (x === '' || x == null) return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

/** Every Manual J filed on an assessment, newest first. */
export async function fetchManualJReports(assessmentId) {
  if (!assessmentId) return []
  const { data, error } = await supabase
    .from('manual_j_reports')
    .select(`
      id, mjr_record_number, mjr_name, mjr_source_software, mjr_manual_j_version,
      mjr_subject_name, mjr_subject_address, mjr_source_file_name, document_id,
      mjr_weather_station, mjr_heating_outdoor_db_f, mjr_cooling_outdoor_db_f,
      mjr_design_heating_load_btuh, mjr_design_cooling_load_btuh,
      mjr_design_sensible_cooling_btuh, mjr_design_latent_cooling_btuh,
      mjr_design_load_basis, mjr_design_load_basis_id, mjr_conditioned_floor_area_sq_ft,
      mjr_neep_construction_year, mjr_neep_ducting_configuration, mjr_notes,
      mjr_created_at, mjr_created_by, mjr_parser_version
    `)
    .eq('assessment_id', assessmentId)
    .is('mjr_is_deleted', false)
    .order('mjr_created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** One report's load blocks and assemblies, for the detail view. */
export async function fetchManualJReportDetail(reportId) {
  if (!reportId) return { blocks: [], materials: [] }
  const [blocks, materials] = await Promise.all([
    supabase.from('manual_j_load_blocks')
      .select(`
        id, mjl_record_number, mjl_scope, mjl_block_name, mjl_system_name, mjl_zone_name,
        mjl_room_name, mjl_story, mjl_sequence, mjl_floor_area_sq_ft,
        mjl_total_heating_btuh, mjl_total_cooling_btuh, mjl_sensible_cooling_btuh, mjl_latent_cooling_btuh,
        mjl_system_type, mjl_distribution_type, mjl_supply_run_location, mjl_leakage_class,
        mjl_duct_wall_insulation, mjl_airway_configuration
      `)
      .eq('manual_j_report_id', reportId)
      .is('mjl_is_deleted', false)
      .order('mjl_sequence', { ascending: true }),
    supabase.from('manual_j_building_materials')
      .select(`
        id, mjm_record_number, mjm_construction_type, mjm_construction_number, mjm_orientation,
        mjm_area_sq_ft, mjm_cooling_btuh, mjm_heating_btuh, mjm_u_value, mjm_description,
        mjm_is_total_row, mjm_sequence
      `)
      .eq('manual_j_report_id', reportId)
      .is('mjm_is_deleted', false)
      .order('mjm_sequence', { ascending: true }),
  ])
  if (blocks.error) throw blocks.error
  if (materials.error) throw materials.error
  return { blocks: blocks.data || [], materials: materials.data || [] }
}

/** Soft delete, like everything else in LEAP. */
export async function deleteManualJReport(reportId, reason) {
  const { error } = await supabase
    .from('manual_j_reports')
    .update({
      mjr_is_deleted: true,
      mjr_deleted_at: new Date().toISOString(),
      mjr_deletion_reason: reason || 'Removed from the assessment',
    })
    .eq('id', reportId)
  if (error) throw error
}
