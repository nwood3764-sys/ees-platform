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
import {
  listWorkOrderPhotos, hydratePhotoUrls, uploadDocument, signedUrl, listDocuments,
} from './storageService'
import { loadSubmittalDocumentTemplate, loadSubmittalTextBlocks } from './paperworkService'
import { buildAssessmentReportPdf } from './paperworkModel'
import { encodeImageForPdf, renderPdfFirstPageForPdf } from '../lib/pdfImages'
import {
  ASSESSMENT_REPORT_KIND, assessmentReportFor, buildStepEntry, reportPhotos,
  photoCaption, reportPhotoLabel, buildingSummaryRows, addressLines, cityStateZip,
  reportFileName, collectRecordIds, applyLookupLabels, companyNameForState,
  documentPreviewKind, documentTypeLabel, formatFileSize, documentDownloadName,
  photoDownloadName,
} from '../lib/assessmentReport'

// How long the in-PDF photo links stay good. A report is filed with a program
// and read months later, so a one-hour link would be dead on arrival; a year
// matches the life of the submittal it accompanies.
const PHOTO_LINK_TTL_SECONDS = 60 * 60 * 24 * 365
// Documents linked from the report are reachable for the same period, and are
// signed with a readable filename so a saved copy is identifiable.
const DOCUMENT_LINK_TTL_SECONDS = 60 * 60 * 24 * 365

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

  // ── Documents attached to this assessment ───────────────────────────────
  // Exactly the work order's Documents related list — the same listDocuments
  // call the card on the record makes, so what the user sees on the work order
  // is what they are offered here. Nothing is included until they pick it.
  const documentRows = await listDocuments('work_orders', workOrderId)
  const documents = documentRows.map(row => ({
    id: row.id,
    name: row.name || row.document_number || 'Document',
    typeLabel: documentTypeLabel(row.mime_type, row.name),
    size: formatFileSize(row.file_size_bytes),
    date: fmtDate(row.created_at),
    previewKind: documentPreviewKind(row.mime_type, row.name),
    // The curation flag from the Documents card. A document marked for the
    // final report is pre-selected here, so the set is decided ONCE on the
    // record instead of re-picked on every generation (Nicholas, 2026-08-27).
    inFinalReport: row.include_in_final_report === true,
    _row: row,
  }))

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
    // Who performed the assessment, named for the state the building is in.
    // No street address and no contact line: the address on this report is the
    // building's, and it is on the cover.
    company:  { name: companyNameForState(reportState) },
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
    summaryRows: buildingSummaryRows(building),
    steps: modelSteps,
    photos: flagged.map(p => ({
      id: p.id,
      group: p._work_step_name || 'Work Order',
      label: reportPhotoLabel(p),
      caption: photoCaption(p, { formatDate: fmtDateTime }),
      _row: p,
    })),
    // Filled in by the caller from the user's selection — nothing is included
    // in the report until it is chosen.
    documents: [],
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
    def, model, template, documents,
    counts: {
      photosFlagged: flagged.length,
      photosTotal:   allPhotos.length,
      steps:         modelSteps.length,
      sectionsWithContent: model.steps.filter(s => s.willPrint).length,
      documents: documents.length,
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

  // A separate, long-lived link to the WATERMARKED copy — the same file the
  // Photos card hands over on download, and for the same reason: it carries
  // the visible tag (step · property·building·unit · date · GPS) that the
  // incentive programs require in order to accept a photo, AND the original
  // camera EXIF, which process-photo copies back in verbatim after re-encoding.
  //
  // Linking the untouched original (which this did until 2026-08-27) meant the
  // PDF showed a tagged photo while the file behind it was untagged, so a
  // reviewer who saved one got the copy their own program will not take. The
  // watermarked variant is capped at 2400px on its long edge; a tagged,
  // submittable photo beats a larger unusable one. The pristine original is
  // still the archival source and is never modified.
  //
  // Signed object URLs are read-only: they expose that one photo and nothing
  // else — no record, no edit, no delete.
  //
  // Signed ONE AT A TIME rather than in a batch, because each carries its own
  // download filename — the batch API can only set one for the whole call. The
  // storage key is a uuid, so without this a saved photo lands in the reader's
  // downloads as "1d655a50-….jpg" and tells them nothing.
  const buildingLabel = model.building?.label || model.building?.name || null
  const linkById = new Map()
  for (const r of rows) {
    // Fall back to the original only when no watermarked copy exists, so a
    // photo that never rendered still reaches the reader rather than losing
    // its link entirely.
    const linkPath = r.storage_path_watermarked || r.storage_path_original
    if (!r.storage_bucket || !linkPath) continue
    const url = await signedUrl(
      r.storage_bucket, linkPath, PHOTO_LINK_TTL_SECONDS,
      photoDownloadName(r, buildingLabel))
    if (url) linkById.set(r.id, url)
  }
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

/**
 * Resolve the chosen documents into what the renderer needs: a long-lived,
 * correctly-named download link for every one, and a preview for those that
 * can show one (an image, a PDF's first page).
 *
 * A document that cannot be previewed still gets its row and its link — the
 * point is that the reader can always reach the file.
 */
export async function attachAssessmentDocuments(model, chosen, { onProgress } = {}) {
  const list = (chosen || []).filter(Boolean)
  model.documents = list.map(({ _row, ...rest }) => ({ ...rest }))
  if (!list.length) return model

  const buildingLabel = model.building?.label || model.building?.name || null
  let done = 0
  for (let i = 0; i < list.length; i++) {
    const src = list[i], out = model.documents[i], row = src._row || {}
    try {
      if (row.storage_bucket && row.storage_path) {
        out.linkUrl = await signedUrl(
          row.storage_bucket, row.storage_path, DOCUMENT_LINK_TTL_SECONDS,
          documentDownloadName(src, buildingLabel))
      }
      if (out.linkUrl && src.previewKind === 'image') {
        const img = await encodeImageForPdf(out.linkUrl)
        if (img) { out.previewDataUrl = img.dataUrl; out.previewW = img.w; out.previewH = img.h }
      } else if (out.linkUrl && src.previewKind === 'pdf') {
        const page = await renderPdfFirstPageForPdf(out.linkUrl)
        if (page) { out.previewDataUrl = page.dataUrl; out.previewW = page.w; out.previewH = page.h }
      }
    } catch {
      /* A preview is a nicety. A document that will not render keeps its row
         and its link rather than taking the whole report down with it. */
    }
    done++
    if (onProgress) onProgress(done, list.length)
  }
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
