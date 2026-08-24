// ---------------------------------------------------------------------------
// assessmentReportService — assembles the Energy Assessment Report model from
// an assessment work order, and saves the generated PDF onto that work order.
//
// The report is the AUDIT's deliverable, so everything it prints is read from
// the work order that captured it:
//
//   · the work step TEMPLATE for each section's questions (so a section the
//     assessor skipped still prints its questions with em dashes)
//   · work_step_field_values for the answers
//   · the photos flagged "Include in final report" on the work order's Photos
//     card — this is that flag's first consumer
//   · the building / property records for the orientation summary
//
// The section list comes from the stored template (submittal_document_templates
// for this report's document key, optionally scoped to the opportunity's
// record type), falling back to the built-in default so the report still
// generates if the table is unreachable.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'
import { listWorkOrderPhotos, hydratePhotoUrls, uploadDocument, signedUrls } from './storageService'
import { loadSubmittalDocumentTemplate, loadSubmittalTextBlocks } from './paperworkService'
import { buildAssessmentReportPdf } from './paperworkModel'
import { encodeImageForPdf } from '../lib/pdfImages'
import {
  ASSESSMENT_REPORT_KIND, assessmentReportFor, buildStepEntry, reportPhotos,
  photoCaption, reportPhotoLabel, buildingSummaryRows, addressLines, cityStateZip,
  reportFileName, collectRecordIds, applyLookupLabels, companyNameForState,
} from '../lib/assessmentReport'

// How long the in-PDF photo links stay good. A report is filed with a program
// and read months later, so a one-hour link would be dead on arrival; a year
// matches the life of the submittal it accompanies.
const PHOTO_LINK_TTL_SECONDS = 60 * 60 * 24 * 365

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
function fmtDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return null
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Load everything the report needs for one assessment work order.
 * Returns { def, model, template } — `template` is null when no stored
 * template matched and the built-in default sections will be used.
 */
export async function loadAssessmentReportContext(workOrderId) {
  if (!workOrderId) throw new Error('loadAssessmentReportContext: workOrderId is required')

  const { data: wo, error: woErr } = await supabase
    .from('work_orders')
    .select(`
      id, work_order_record_number, work_order_name, work_order_record_type,
      work_order_status, work_order_owner, property_id, building_id,
      opportunity_id, project_id,
      work_order_start_datetime, work_order_end_datetime, work_order_scheduled_start_date`)
    .eq('id', workOrderId)
    .maybeSingle()
  if (woErr) throw new Error(woErr.message)
  if (!wo) throw new Error('Work order not found')

  // Record type value → which report this is.
  const rtIds = [wo.work_order_record_type, wo.work_order_status].filter(Boolean)
  const { data: rtRows } = rtIds.length
    ? await supabase.from('picklist_values').select('id, picklist_value, picklist_label').in('id', rtIds)
    : { data: [] }
  const byId = new Map((rtRows || []).map(r => [r.id, r]))
  const recordTypeValue = byId.get(wo.work_order_record_type)?.picklist_value || null
  const statusLabel = byId.get(wo.work_order_status)?.picklist_label || null

  const def = assessmentReportFor(recordTypeValue)
  if (!def) {
    throw new Error(`No energy assessment report is defined for work order record type "${recordTypeValue || 'none'}".`)
  }
  if (!def.built) {
    throw new Error(`The ${def.label} template has not been built yet. Only the Multifamily Building Energy Assessment Report exists today.`)
  }

  // Parent records, the opportunity's program, and the assessor.
  const [propRes, bldRes, oppRes, ownerRes] = await Promise.all([
    wo.property_id
      ? supabase.from('properties').select('id, property_name, property_street, property_city, property_state, property_zip, property_total_units, property_total_buildings, property_account_id').eq('id', wo.property_id).maybeSingle()
      : Promise.resolve({ data: null }),
    wo.building_id
      ? supabase.from('buildings').select('*').eq('id', wo.building_id).maybeSingle()
      : Promise.resolve({ data: null }),
    wo.opportunity_id
      ? supabase.from('opportunities').select('id, opportunity_name, opportunity_record_type').eq('id', wo.opportunity_id).maybeSingle()
      : Promise.resolve({ data: null }),
    wo.work_order_owner
      ? supabase.from('users').select('id, user_first_name, user_last_name').eq('id', wo.work_order_owner).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const property = propRes.data || null
  const building = bldRes.data || null
  const opportunity = oppRes.data || null
  const owner = ownerRes.data || null

  let programRt = null
  if (opportunity?.opportunity_record_type) {
    const { data } = await supabase.from('picklist_values')
      .select('id, picklist_value, picklist_label').eq('id', opportunity.opportunity_record_type).maybeSingle()
    programRt = data || null
  }

  let account = null
  if (property?.property_account_id) {
    const { data } = await supabase.from('accounts')
      .select('id, account_name, billing_street, billing_city, billing_state, billing_zip')
      .eq('id', property.property_account_id).maybeSingle()
    account = data || null
  }

  // ── The captured walk: steps, their template questions, their answers ────
  const { data: steps, error: stepErr } = await supabase
    .from('work_steps')
    .select(`id, work_step_name, work_step_template_id, work_step_status,
             work_step_execution_order, work_step_plan_execution_order,
             work_step_not_applicable_reason`)
    .eq('work_order_id', workOrderId)
    .eq('work_step_is_deleted', false)
  if (stepErr) throw new Error(`assessment steps load failed: ${stepErr.message}`)
  const orderedSteps = (steps || []).slice().sort((a, b) =>
    (a.work_step_execution_order ?? a.work_step_plan_execution_order ?? 1e9) -
    (b.work_step_execution_order ?? b.work_step_plan_execution_order ?? 1e9))

  const templateIds = Array.from(new Set(orderedSteps.map(s => s.work_step_template_id).filter(Boolean)))
  const [fieldsRes, valuesRes, statusRes] = await Promise.all([
    templateIds.length
      ? supabase.from('work_step_template_fields')
          .select('id, work_step_template_id, wstf_field_label, wstf_field_name, wstf_field_type, wstf_unit, wstf_sort_order')
          .in('work_step_template_id', templateIds)
          .eq('wstf_is_deleted', false).eq('wstf_is_active', true)
      : Promise.resolve({ data: [] }),
    supabase.from('work_step_field_values')
      .select('id, work_step_id, work_step_template_field_id, wsfv_text_value, wsfv_numeric_value')
      .eq('work_order_id', workOrderId).eq('wsfv_is_deleted', false),
    (() => {
      const ids = Array.from(new Set(orderedSteps.map(s => s.work_step_status).filter(Boolean)))
      return ids.length
        ? supabase.from('picklist_values').select('id, picklist_label').in('id', ids)
        : Promise.resolve({ data: [] })
    })(),
  ])
  const fieldsByTemplate = new Map()
  for (const f of (fieldsRes.data || [])) {
    if (!fieldsByTemplate.has(f.work_step_template_id)) fieldsByTemplate.set(f.work_step_template_id, [])
    fieldsByTemplate.get(f.work_step_template_id).push(f)
  }
  const valuesByStep = new Map()
  for (const v of (valuesRes.data || [])) {
    if (!valuesByStep.has(v.work_step_id)) valuesByStep.set(v.work_step_id, new Map())
    valuesByStep.get(v.work_step_id).set(v.work_step_template_field_id, v)
  }
  const stepStatusLabel = new Map((statusRes.data || []).map(r => [r.id, r.picklist_label]))

  const modelStepsRaw = orderedSteps.map(s => buildStepEntry(
    { ...s, _status_label: stepStatusLabel.get(s.work_step_status) || null },
    fieldsByTemplate.get(s.work_step_template_id) || [],
    valuesByStep.get(s.id) || new Map(),
  ))

  // ── The flagged photos ──────────────────────────────────────────────────
  const allPhotos = await listWorkOrderPhotos(workOrderId)
  const flagged = reportPhotos(allPhotos)

  // Photos count as content, so each step carries how many it contributes.
  // The dialog reads this: a section with five photos and no typed answers
  // must not look identical to one with nothing in it.
  const flaggedByStep = new Map()
  for (const p of flagged) {
    const key = String(p._work_step_name || '').trim().toLowerCase()
    flaggedByStep.set(key, (flaggedByStep.get(key) || 0) + 1)
  }
  const modelSteps = modelStepsRaw.map(s => {
    const photoCount = flaggedByStep.get(String(s.name || '').trim().toLowerCase()) || 0
    const answered = (s.fields || []).filter(f => f.value != null && String(f.value).trim() !== '').length
    return { ...s, photoCount, answeredCount: answered, willPrint: answered > 0 || photoCount > 0 || s.notApplicable }
  })

  // ── The template that drives the section list ───────────────────────────
  const [template, textBlocks] = await Promise.all([
    loadSubmittalDocumentTemplate(def.documentKey, opportunity?.opportunity_record_type || null),
    loadSubmittalTextBlocks(opportunity?.opportunity_record_type || null),
  ])

  // EES names a building by its street number, and the derived building_name
  // repeats the whole property name — on a report cover the short identity is
  // the readable one.
  const buildingLabel = building
    ? (building.building_number_or_name || building.building_name || 'Building')
    : null

  // When the building was actually assessed. The work order's own datetimes
  // are only filled once it is started/finished, so fall back to the first
  // photo captured on it — a photo's taken_at IS the visit — and only then to
  // the scheduled date, which is a plan rather than a fact.
  const firstCapture = flagged.length
    ? flagged.map(p => p.taken_at || p.created_at).filter(Boolean).sort()[0]
    : (allPhotos.map(p => p.taken_at || p.created_at).filter(Boolean).sort()[0] || null)
  const assessedOn = wo.work_order_end_datetime
    || wo.work_order_start_datetime
    || firstCapture
    || wo.work_order_scheduled_start_date

  // The building's state decides which EES entity performed the assessment.
  const reportState = building?.building_state || property?.property_state || null

  const draftModel = {
    title:    def.title,
    subtitle: def.subtitle || null,
    company:  {
      name: companyNameForState(reportState),
      // The Monona street address belongs to the Wisconsin entity — printing
      // it under another state's name would put a false address on the report.
      footerLine: String(reportState || '').toUpperCase() === 'WI'
        ? null                                  // the seeded WI footer line is correct
        : companyNameForState(reportState),
    },
    program:  programRt ? { label: programRt.picklist_label || programRt.picklist_value, name: programRt.picklist_value } : null,
    property: property ? {
      name: property.property_name,
      addressLines: addressLines(property, 'property'),
      cityStateZip: cityStateZip(property, 'property'),
    } : {},
    building: building
      ? { name: building.building_name, label: buildingLabel,
          // The file is named for the building, so it wants the full
          // identifying name rather than the short street label.
          fileName: building.building_name || buildingLabel }
      : {},
    workOrder: { number: wo.work_order_record_number, name: wo.work_order_name, status: statusLabel },
    preparedFor: account ? {
      name: account.account_name,
      lines: [account.billing_street, [account.billing_city, account.billing_state].filter(Boolean).join(', ') +
        (account.billing_zip ? ` ${account.billing_zip}` : '')].filter(v => v && String(v).trim()),
    } : null,
    auditor: owner ? { name: [owner.user_first_name, owner.user_last_name].filter(Boolean).join(' ').trim() || null } : null,
    assessedOn:  fmtDate(assessedOn),
    generatedOn: fmtDate(new Date().toISOString()),
    summaryRows: buildingSummaryRows(building, property),
    steps: modelSteps,
    photos: flagged.map(p => ({
      id: p.id,
      group: p._work_step_name || 'Work Order',
      label: reportPhotoLabel(p),
      caption: photoCaption(p, { formatDate: fmtDateTime }),
      _row: p,
    })),
    recommendations: [],
    textBlocks,
  }

  // Resolve every record id in the printable values to its label. Many
  // building_* columns are picklist FKs holding a uuid, so without this the
  // report shows "09888d66-…" where "Apartment" belongs.
  const recordIds = collectRecordIds(draftModel)
  let labelById = new Map()
  if (recordIds.length) {
    const { data: pvRows } = await supabase.from('picklist_values')
      .select('id, picklist_value, picklist_label').in('id', recordIds)
    labelById = new Map((pvRows || []).map(r => [r.id, r.picklist_label || r.picklist_value]))
  }
  const model = applyLookupLabels(draftModel, labelById)

  return {
    def, model, template,
    counts: {
      photosFlagged: flagged.length,
      photosTotal:   allPhotos.length,
      steps:         modelSteps.length,
      sectionsWithContent: model.steps.filter(s => s.willPrint).length,
    },
  }
}

/**
 * Fetch, decode and downscale the report's photos into JPEG data URLs.
 * Done as its own step so the modal can show progress — a report with 40
 * flagged photos is a real wait, and a HEIC capture has to be decoded first.
 */
export async function attachAssessmentPhotoImages(model, { onProgress } = {}) {
  const list = model.photos || []
  if (!list.length) return model
  const rows = list.map(p => p._row).filter(Boolean)
  const hydrated = await hydratePhotoUrls(rows)
  const urlById = new Map(hydrated.map(h => [h.id, h._thumbUrl || h._originalUrl || null]))

  // A separate, long-lived link to the ORIGINAL capture, so the PDF's reader
  // can open or save the full-resolution photo with its EXIF intact. Signed
  // object URLs are read-only: they expose that one photo and nothing else —
  // no record, no edit, no delete.
  const linkById = new Map()
  const byBucket = new Map()
  for (const r of rows) {
    if (!r.storage_bucket || !r.storage_path_original) continue
    if (!byBucket.has(r.storage_bucket)) byBucket.set(r.storage_bucket, [])
    byBucket.get(r.storage_bucket).push(r)
  }
  await Promise.all(Array.from(byBucket.entries()).map(async ([bucket, group]) => {
    const urls = await signedUrls(bucket, group.map(r => r.storage_path_original), PHOTO_LINK_TTL_SECONDS)
    group.forEach((r, i) => { if (urls[i]) linkById.set(r.id, urls[i]) })
  }))
  let done = 0
  for (const p of list) {
    try {
      const img = await encodeImageForPdf(urlById.get(p.id))
      if (img) { p.dataUrl = img.dataUrl; p.w = img.w; p.h = img.h }
      p.linkUrl = linkById.get(p.id) || null
    } catch { /* an unreadable photo prints as an empty box, never a failed report */ }
    done++
    if (onProgress) onProgress(done, list.length)
  }
  for (const p of list) delete p._row
  return model
}

/** Render the report PDF. Returns { blob, fileName, def }. */
export async function generateAssessmentReport(workOrderId, { onProgress } = {}) {
  const ctx = await loadAssessmentReportContext(workOrderId)
  await attachAssessmentPhotoImages(ctx.model, { onProgress })
  const blob = await buildAssessmentReportPdf(
    ctx.model, ASSESSMENT_REPORT_KIND, ctx.template?.sections || null)
  return {
    blob,
    fileName: reportFileName(ctx.def, ctx.model.building?.fileName, ctx.model.building?.label),
    def: ctx.def,
    counts: ctx.counts,
    templateName: ctx.template?.name || null,
  }
}

/** Save a generated report onto the work order's Documents card. */
export async function saveAssessmentReportToWorkOrder(workOrderId, blob, fileName) {
  const file = new File([blob], fileName, { type: 'application/pdf' })
  return uploadDocument({
    file,
    relatedObject: 'work_orders',
    relatedId:     workOrderId,
    documentType:  'energy_assessment_report',
    name:          fileName,
  })
}
