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

// The third form, also on the incentive application: the Project Payment
// Request. Hosted on Jotform rather than Formstack, which changes only the
// stored parameter strings (q65_doesThe65 rather than field188466720) — the
// query string is built the same way, and build_external_form_prefill picks
// this target's resolver server-side, so nothing here knows the difference.
export const WI_IRA_PAYMENT_REQUEST_KEY = 'wi_ira_mf_homes_project_payment_request'

// The Project Reservation submission, from the Project Reservation ENROLLMENT.
// It is the SAME Jotform as the payment request (250306438751960) — the form's
// "I'm Applying for a(n)" radio selects the branch, and this target sets it to
// "Project Reservation" and sources every other field from the enrollment.
export const WI_IRA_PROJECT_RESERVATION_KEY = 'wi_ira_mf_homes_project_reservation'

// The same Focus On Energy submittal form, filed for the HEAR programme from a
// HEAR Project Reservation ENROLLMENT. A separate target (and a separate
// server-side resolver) because the record it reads is a different programme's
// filing — the form itself is the same one.
export const WI_IRA_HEAR_PROJECT_RESERVATION_KEY = 'wi_ira_mf_hear_project_reservation'

// The pure rules live in src/lib/externalFormPrefill.js so they can be tested
// without a browser or a database. Re-exported here so existing importers of
// this module are unchanged.
export {
  applyTransform, mapPayloadToParams, buildPrefillUrl, findMissingRequiredFields,
} from '../lib/externalFormPrefill'
import { buildPrefillUrl, findMissingRequiredFields, fieldsToEnterByHand } from '../lib/externalFormPrefill'

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
    // Answers the form will not take from a URL (a Jotform widget in its own
    // iframe). The form still opens -- these are handed to the person to enter,
    // never a reason to block the filing.
    const byHand = fieldsToEnterByHand(payload, map.fields)
    if (targetWindow) targetWindow.location = url
    else window.open(url, '_blank', 'noopener')
    return { url, filledCount, byHand, formName: map.name }
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
export function openPaymentRequestForm(incentiveApplicationId, targetWindow) {
  return openExternalPrefilledForm(incentiveApplicationId, WI_IRA_PAYMENT_REQUEST_KEY, targetWindow)
}

export function openAssessmentApplicationForm(incentiveApplicationId, targetWindow) {
  return openExternalPrefilledForm(incentiveApplicationId, WI_IRA_ASSESSMENT_APPLICATION_KEY, targetWindow)
}

// The Project Reservation submittal, opened from the WI-IRA-MF-HOMES Project
// Reservation enrollment.
export function openProjectReservationForm(enrollmentId, targetWindow) {
  return openExternalPrefilledForm(enrollmentId, WI_IRA_PROJECT_RESERVATION_KEY, targetWindow)
}

// The Project Reservation submittal, opened from the HEAR Project Reservation
// enrollment.
export function openHearProjectReservationForm(enrollmentId, targetWindow) {
  return openExternalPrefilledForm(enrollmentId, WI_IRA_HEAR_PROJECT_RESERVATION_KEY, targetWindow)
}
