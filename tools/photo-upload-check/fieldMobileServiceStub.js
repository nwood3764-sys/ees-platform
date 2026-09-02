// The work order a technician was actually looking at when photo upload broke:
// WO-00243, Building Access - Unlock and Lock, whose "Key Checkout Photo" step
// was marked Not Applicable with the reason "Photo does not upload".
//
// Everything here is local. What is REAL in this harness is the component, the
// browser's <input type="file">, and the handler that reads it — which is the
// entire question. captureStepPhoto records what it was handed instead of
// uploading it, so the check can assert that the file reached the upload call
// at all. Under the old handler, it was never called.

export const captured = []

const step = (over) => ({
  work_step_id: over.id,
  name: over.name,
  status: over.status || 'New',
  execution_order: over.order,
  evidence_type: over.evidence || 'Photo',
  photos_required_count: over.req ?? 1,
  photo_count: over.photoCount ?? 0,
  before_count: 0, after_count: 0, video_count: 0,
  photo_before_required: false, photo_after_required: false,
  photos: [], videos: [], fields: [],
  description: null, reference_photo_url: null,
  not_applicable_reason: null, pc_comment: null, psl_comment: null,
  ...over.extra,
})

export async function fetchWorkOrderDetail() {
  return {
    header: {
      work_order_record_number: 'WO-00243',
      work_order_status: 'In Progress',
      work_order_name: 'Building Access - Unlock and Lock',
      property_name: '3002 West Darling Street - Appleton',
      property_address: '3002 West Darling Street, Appleton, WI',
      can_submit: false,
    },
    steps: [
      step({ id: 'ws-key-checkout', name: 'Key Checkout Photo', order: 1 }),
      step({ id: 'ws-door-unlocked', name: 'Building Door Unlocked Photo', order: 2 }),
      step({ id: 'ws-360', name: 'Building 360 Video', order: 3, evidence: 'Video', req: 0 }),
    ],
    time_entry: null,
  }
}

export async function captureStepPhoto({ file, workStepId, photoType }) {
  captured.push({ name: file?.name, size: file?.size, type: file?.type, workStepId, photoType })
  return { id: `photo-${captured.length}`, _processing: null }
}
export async function captureStepVideo({ file }) { captured.push({ video: file?.name }); return {} }
export async function photoGpsMissing() { return false }
export async function completeWorkStep() { return {} }
export async function submitWorkOrder() { return {} }
export async function markUnableToComplete() { return {} }
export async function markWorkStepNotApplicable() { return {} }
export async function saveWorkStepFieldValue() { return { message: 'saved' } }
export async function signedPhotoUrl() { return null }
export async function fetchActiveUsers() { return [] }
export async function fetchAccountContactsForWorkOrder() {
  return [{ id: 'c1', contact_name: 'Dana Reyes' }, { id: 'c2', contact_name: 'Marcus Hall' }]
}
export async function fetchVehiclesForInspection() { return [] }
export async function saveWorkStepVehicle() { return { message: 'saved' } }
