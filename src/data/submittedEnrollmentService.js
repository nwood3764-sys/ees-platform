// ---------------------------------------------------------------------------
// submittedEnrollmentService — assembles the Submitted Enrollment document
// from an enrollment, and saves the generated PDF back onto it.
//
// It answers one question: what did we actually file? So everything it prints
// is read from the enrollment as it stands —
//
//   · the declared submission fields (SUBMITTED_ENROLLMENT_FIELD_GROUPS), blanks and all
//   · the documents attached to the enrollment, each with a long-lived,
//     correctly-named download link — the first consumer of the
//     "Include in report" flag on an enrollment's Documents card
//   · the property, building and opportunity it belongs to, for orientation
//
// The section list comes from the stored template for this document key
// (optionally scoped to the opportunity's record type, the same axis every
// other submittal document uses), falling back to the built-in default so the
// document still generates if the table is unreachable.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'
import { listDocuments, signedUrl, uploadDocument } from './storageService'
import { proxiedStorageUrl, shortFileLink } from '../lib/reportFileLinks'
import { loadSubmittalDocumentTemplate, loadSubmittalTextBlocks } from './paperworkService'
import { buildSubmittedEnrollmentPdf } from './paperworkModel'
import { companyNameForState, addressLines, cityStateZip } from '../lib/assessmentReport'
import {
  SUBMITTED_ENROLLMENT_KIND, SUBMITTED_ENROLLMENT_DOCUMENT_KEY, SUBMITTED_ENROLLMENT_FIELD_GROUPS,
  submittedEnrollmentFor, buildSubmittedEnrollmentSummary, buildDocumentManifest,
  documentDownloadName, submittedEnrollmentFileName, submittedFieldValue,
} from '../lib/submittedEnrollment'
import { groupsFromLayout, printsFromLayout } from '../lib/submittedEnrollmentLayout'
import { loadRecordDetailData } from './layoutService'

// A Submitted Enrollment is filed with a program and read months later, so its
// links have to outlive the session that made it. One year matches the life of
// the filing it documents — the same TTL the assessment report uses.
const DOCUMENT_LINK_TTL_SECONDS = 60 * 60 * 24 * 365

/**
 * A short, revocable link for one attached file.
 *
 * Same route the assessment report takes: `mint_report_file_link` returns a
 * token served at /f/<token>, which fits on one line — so Acrobat's "do you
 * trust this site" prompt and Gmail's redirect page show something a program
 * reviewer can read, instead of 500 characters of JWT. It is also revocable
 * after the fact, which a raw signed URL is not.
 *
 * Falls back to the long proxied signed URL when minting fails, so a database
 * hiccup costs a link's APPEARANCE rather than removing an attachment from the
 * filing. Returns null only when neither route produces anything.
 */
async function mintDocumentLink({ bucket, path, displayName, documentId }) {
  if (!bucket || !path) return null
  try {
    const { data, error } = await supabase.rpc('mint_report_file_link', {
      p_bucket: bucket,
      p_path: path,
      p_display_name: displayName || null,
      p_ttl_seconds: DOCUMENT_LINK_TTL_SECONDS,
      p_photo_id: null,
      p_document_id: documentId || null,
      p_work_order_id: null,
    })
    if (!error && data) return shortFileLink(data)
  } catch { /* fall through to the long form */ }
  const signed = await signedUrl(bucket, path, DOCUMENT_LINK_TTL_SECONDS, displayName || null)
  return signed ? proxiedStorageUrl(signed) : null
}

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

/** Every uuid sitting in a value the summary is about to print. */
function idsInSummary(groups) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const ids = new Set()
  for (const g of groups || []) {
    for (const r of g.rows || []) {
      const v = r?.value
      if (typeof v === 'string' && UUID.test(v.trim())) ids.add(v.trim())
      if (Array.isArray(v)) for (const item of v) if (typeof item === 'string' && UUID.test(item.trim())) ids.add(item.trim())
    }
  }
  return Array.from(ids)
}

/**
 * Names for a set of ids, looked up where they might actually live.
 *
 * A submitted value that is an id is nearly always a picklist selection, but
 * enrollments also carry contractor/contact lookups. Both are resolved so a
 * uuid never reaches the page; anything still unnamed is dropped by
 * submittedFieldValue rather than printed.
 */
async function resolveValueLabels(ids) {
  const out = new Map()
  if (!ids.length) return out
  const [pv, contacts, accounts] = await Promise.all([
    supabase.from('picklist_values').select('id, picklist_label, picklist_value').in('id', ids),
    supabase.from('contacts').select('id, contact_name').in('id', ids),
    supabase.from('accounts').select('id, account_name').in('id', ids),
  ])
  for (const r of pv.data || []) out.set(r.id, r.picklist_label || r.picklist_value)
  for (const r of contacts.data || []) if (r.contact_name) out.set(r.id, r.contact_name)
  for (const r of accounts.data || []) if (r.account_name) out.set(r.id, r.account_name)
  return out
}

/**
 * Load everything the record needs for one enrollment.
 * Returns { def, model, template, documents, counts }.
 */
export async function loadSubmittedEnrollmentContext(enrollmentId) {
  if (!enrollmentId) throw new Error('loadSubmittedEnrollmentContext: enrollmentId is required')

  const { data: enr, error: enrErr } = await supabase
    .from('enrollments').select('*').eq('id', enrollmentId).maybeSingle()
  if (enrErr) throw new Error(enrErr.message)
  if (!enr) throw new Error('Enrollment not found')

  // Record type and status are picklist ids; the record type decides which
  // filing this is, so it is resolved before anything else.
  const pickIds = [enr.enrollment_record_type, enr.enrollment_status].filter(Boolean)
  const { data: pickRows } = pickIds.length
    ? await supabase.from('picklist_values')
        .select('id, picklist_value, picklist_label').in('id', pickIds)
    : { data: [] }
  const pickById = new Map((pickRows || []).map(r => [r.id, r]))
  const rt = pickById.get(enr.enrollment_record_type) || null
  const def = submittedEnrollmentFor(rt?.picklist_value, rt?.picklist_label)

  const [propRes, bldRes, oppRes, userRes] = await Promise.all([
    enr.property_id
      ? supabase.from('properties').select('*').eq('id', enr.property_id).maybeSingle()
      : Promise.resolve({ data: null }),
    enr.building_id
      ? supabase.from('buildings').select('*').eq('id', enr.building_id).maybeSingle()
      : Promise.resolve({ data: null }),
    enr.opportunity_id
      ? supabase.from('opportunities')
          .select('id, opportunity_record_number, opportunity_name, opportunity_record_type')
          .eq('id', enr.opportunity_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('users').select('id, user_first_name, user_last_name')
      .in('id', [enr.enrollment_submitted_by, enr.enrollment_owner, enr.enrollment_updated_by].filter(Boolean)),
  ])
  const property = propRes?.data || null
  const building = bldRes?.data || null
  const opportunity = oppRes?.data || null
  const userName = (id) => {
    const u = (userRes?.data || []).find(r => r.id === id)
    return u ? [u.user_first_name, u.user_last_name].filter(Boolean).join(' ').trim() || null : null
  }

  // Documents on the enrollment, with the uploader named.
  const rawDocs = await listDocuments('enrollments', enrollmentId).catch(() => [])
  const uploaderIds = Array.from(new Set(rawDocs.map(d => d.uploaded_by).filter(Boolean)))
  const { data: uploaders } = uploaderIds.length
    ? await supabase.from('users').select('id, user_first_name, user_last_name').in('id', uploaderIds)
    : { data: [] }
  const uploaderById = new Map((uploaders || []).map(u =>
    [u.id, [u.user_first_name, u.user_last_name].filter(Boolean).join(' ').trim() || null]))
  const documents = rawDocs.map(d => ({ ...d, uploaded_by_name: uploaderById.get(d.uploaded_by) || null }))

  // Summary, then names for any id inside it.
  //
  // A record type listed in LAYOUT_DRIVEN_RECORD_TYPES prints its OWN page
  // layout -- same sections, same order, same labels the person filling it in
  // saw -- because a document called "what was submitted" must describe the
  // form that was actually filled. Everything else keeps the document it has
  // today, untouched (Nicholas: "Only do this one right now. It's record type
  // specific. Do not try to make changes on all of them.").
  //
  // loadRecordDetailData is reused rather than reimplemented: it already
  // resolves the layout for this record's record type and merges cross-object
  // (related) field values under their dotted names, which is how the
  // contractor and payment blocks reach the page at all.
  let summary
  if (printsFromLayout(rt?.picklist_value)) {
    const detail = await loadRecordDetailData('enrollments', enrollmentId)
    // Lookup labels the record page already resolved -- contractor account and
    // contact names -- so those need no second round trip.
    const seeded = new Map()
    for (const [id, v] of detail.lookups || []) if (v?.label) seeded.set(id, v.label)
    const build = (labels) => groupsFromLayout(detail.sections, (f) =>
      submittedFieldValue(detail.record, f.name, labels))
    summary = build(seeded)
    const more = await resolveValueLabels(idsInSummary(summary))
    if (more.size) summary = build(new Map([...seeded, ...more]))
  } else {
    summary = buildSubmittedEnrollmentSummary(enr, null, SUBMITTED_ENROLLMENT_FIELD_GROUPS)
    const labels = await resolveValueLabels(idsInSummary(summary))
    if (labels.size) summary = buildSubmittedEnrollmentSummary(enr, labels, SUBMITTED_ENROLLMENT_FIELD_GROUPS)
  }

  const textBlocks = await loadSubmittalTextBlocks(opportunity?.opportunity_record_type || null)
    .catch(() => ({}))
  const template = await loadSubmittalDocumentTemplate(
    SUBMITTED_ENROLLMENT_DOCUMENT_KEY, opportunity?.opportunity_record_type || null).catch(() => null)

  const model = {
    title: def.title,
    programLabel: def.programLabel || rt?.picklist_label || null,
    enrollment: {
      number: enr.enrollment_record_number || null,
      name:   enr.enrollment_name || null,
      status: pickById.get(enr.enrollment_status)?.picklist_label || null,
    },
    property: property ? {
      name: property.property_name || property.property_record_number || null,
      addressLines: addressLines(property, 'property'),
      cityStateZip: cityStateZip(property, 'property'),
      state: property.property_state || null,
    } : {},
    building: building ? {
      name:  building.building_name || null,
      label: building.building_name || building.building_record_number || null,
    } : {},
    opportunity: opportunity ? {
      number: opportunity.opportunity_record_number || null,
      name:   opportunity.opportunity_name || null,
    } : {},
    // Named for the state the PROPERTY is in — the same rule the assessment
    // report follows, so a North Carolina filing is not signed by the
    // Wisconsin company.
    company: { name: companyNameForState(property?.property_state) },
    submittedBy:  userName(enr.enrollment_submitted_by),
    submittedOn:  fmtDate(enr.enrollment_determination_date) || null,
    generatedOn:  fmtDateTime(new Date().toISOString()),
    generatedBy:  null,
    summary,
    documents: [],
    documentNote: null,
    textBlocks,
  }

  return {
    def, model, template, documents,
    counts: {
      documentsTotal:   documents.length,
      documentsFlagged: documents.filter(d => d.include_in_final_report === true).length,
      summaryGroups:    summary.length,
      summaryFilled:    summary.reduce((n, g) => n + g.rows.filter(r => r.value != null).length, 0),
      summaryBlank:     summary.reduce((n, g) => n + g.rows.filter(r => r.value == null).length, 0),
    },
  }
}

/**
 * Resolve the manifest into what the renderer needs: a long-lived, correctly
 * named download link for every attached file.
 *
 * A document whose link cannot be minted still gets its row — the reader needs
 * to know the file was part of the filing even if they have to open the record
 * to fetch it.
 */
export async function attachSubmittedEnrollmentDocuments(model, documents, { flaggedOnly = false, onProgress } = {}) {
  const manifest = buildDocumentManifest(documents, { flaggedOnly })
  const flaggedCount = (documents || []).filter(d => d?.include_in_final_report === true).length
  model.documents = manifest.map(({ _row, ...rest }) => ({ ...rest }))
  model.documentNote = flaggedOnly && !flaggedCount
    ? 'No document on this enrollment is flagged for the report, so every attached file is listed.'
    : null

  const enrollmentNumber = model.enrollment?.number || null
  let done = 0
  for (let i = 0; i < manifest.length; i++) {
    const row = manifest[i]._row || {}
    const out = model.documents[i]
    out.uploadedOn = fmtDate(row.created_at)
    try {
      out.linkUrl = await mintDocumentLink({
        bucket: row.storage_bucket,
        path: row.storage_path,
        displayName: documentDownloadName(manifest[i], enrollmentNumber),
        documentId: row.id,
      })
    } catch {
      /* A link is best-effort. The row stays either way. */
    }
    done++
    if (onProgress) onProgress(done, manifest.length)
  }
  return model
}

/** Render the Submitted Enrollment PDF. Returns { blob, fileName, def, counts }. */
export async function generateSubmittedEnrollment(enrollmentId, { flaggedOnly = false, onProgress } = {}) {
  const ctx = await loadSubmittedEnrollmentContext(enrollmentId)
  await attachSubmittedEnrollmentDocuments(ctx.model, ctx.documents, { flaggedOnly, onProgress })
  const blob = await buildSubmittedEnrollmentPdf(
    ctx.model, SUBMITTED_ENROLLMENT_KIND, ctx.template?.sections || null)
  return {
    blob,
    fileName: submittedEnrollmentFileName(ctx.def, ctx.model.enrollment?.number, ctx.model.property?.name),
    def: ctx.def,
    counts: ctx.counts,
    templateName: ctx.template?.name || null,
  }
}

/** Save the generated PDF onto the enrollment's own Documents card. */
export async function saveSubmittedEnrollmentToRecord(enrollmentId, blob, fileName) {
  const file = new File([blob], fileName, { type: 'application/pdf' })
  return uploadDocument({
    file,
    relatedObject: 'enrollments',
    relatedId:     enrollmentId,
    documentType:  'submitted_enrollment',
    name:          fileName,
  })
}
