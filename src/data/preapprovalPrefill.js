// preapprovalPrefill.js
//
// Opens an external program application form (Focus On Energy, hosted on
// Formstack) pre-filled from a LEAP record, so the user only reviews and
// submits. Nothing about the target form is hardcoded here: the target URL and
// the per-field wiring live in the database (external_form_targets /
// external_form_field_map, read via get_external_form_map), and the record's
// resolved values come from a purpose-built RPC. This file only:
//   1. loads the resolved record values + the field map,
//   2. applies the small value transforms the map asks for, and
//   3. assembles the prefill query string and opens it.
//
// Formstack fills a hosted form from its URL query string: `?field<ID>=Value`
// (address fields use `field<ID>-address/-city/-state/-zip`; radios take their
// stored option value). See the seed in
// supabase/migrations/20260803194426_external_form_prefill_wi_ira_assessment_preapproval.sql.

import { supabase } from '../lib/supabase'

// The one target key wired today — the WI IRA HOMES multifamily assessment
// pre-approval. A second program is another external_form_targets row + key.
export const WI_IRA_ASSESSMENT_PREAPPROVAL_KEY = 'wi_ira_mf_homes_assessment_preapproval'

// The second form, on the INCENTIVE APPLICATION: the assessment rebate claim
// filed after the assessment is done. A different form on the same host, with
// its own field ids — never the pre-approval's, which belong to a different
// form entirely.
export const WI_IRA_ASSESSMENT_APPLICATION_KEY = 'wi_ira_mf_homes_assessment_application'

// The pure rules live in src/lib/externalFormPrefill.js so they can be tested
// without a browser or a database. Re-exported here so existing importers of
// this module are unchanged.
export {
  applyTransform, mapPayloadToParams, buildPrefillUrl, findMissingRequiredFields,
} from '../lib/externalFormPrefill'
import { buildPrefillUrl, findMissingRequiredFields } from '../lib/externalFormPrefill'

// Load the resolved record values + the field map for a target.
//
// Both halves are keyed by the TARGET, not by the object: build_external_form_prefill
// picks the resolver that belongs to this form (the enrollment's for the
// pre-approval, the incentive application's for the assessment claim), so adding
// a third form never touches this file.
export async function loadAssessmentPrefill(recordId, targetKey = WI_IRA_ASSESSMENT_PREAPPROVAL_KEY) {
  const [{ data: payload, error: pErr }, { data: map, error: mErr }] = await Promise.all([
    supabase.rpc('build_external_form_prefill', { p_key: targetKey, p_record_id: recordId }),
    supabase.rpc('get_external_form_map', { p_key: targetKey }),
  ])
  if (pErr) throw pErr
  if (mErr) throw mErr
  return { payload: payload || {}, map: map || {} }
}

// Orchestrate the open. Pass a pre-opened window handle (opened synchronously in
// the click handler) so popup blockers don't fire; the async work then redirects
// it. Returns { url, filledCount } on success or { error } on failure.
export async function openExternalPrefilledForm(recordId, targetKey, targetWindow) {
  try {
    if (!recordId) return { error: 'No record selected.' }
    const { payload, map } = await loadAssessmentPrefill(recordId, targetKey)
    if (!map || !map.base_url) return { error: 'This program has no form configured.' }
    // Completeness gate: every required field (resolved from the record and its
    // parents) must be populated before the form can be submitted. If any are
    // blank, don't open the form — return the list so the caller can ask the
    // user to complete them first.
    const missing = findMissingRequiredFields(payload, map.fields)
    if (missing.length) return { missing, formName: map.name }
    const { url, filledCount } = buildPrefillUrl(map, payload)
    if (targetWindow) targetWindow.location = url
    else window.open(url, '_blank', 'noopener')
    return { url, filledCount, formName: map.name }
  } catch (e) {
    console.warn('open prefilled form failed', e)
    return { error: e?.message || 'Could not build the form.' }
  }
}

export function openAssessmentPreapprovalForm(enrollmentId, targetWindow) {
  return openExternalPrefilledForm(enrollmentId, WI_IRA_ASSESSMENT_PREAPPROVAL_KEY, targetWindow)
}

// The assessment rebate claim, opened from the WI-IRA-MF-HOMES-AUDIT incentive
// application.
export function openAssessmentApplicationForm(incentiveApplicationId, targetWindow) {
  return openExternalPrefilledForm(incentiveApplicationId, WI_IRA_ASSESSMENT_APPLICATION_KEY, targetWindow)
}
