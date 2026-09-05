// Stub for src/lib/supabase.js, aliased in by tools/status-path-check/run.mjs.
// Serves the REAL rows prod returns for the incentive-application lifecycle,
// so the harness exercises the real widget against real data shapes and only
// the transport is fixture.

export const IA_STATUS_VALUES = [
  ['d53e637b-d5dd-4571-a7a8-4f32dbb044c9', 'Incentive Application To Be Prepared', 1],
  ['f4591e0e-3534-4fcc-bcea-7d1987b8d1fc', 'Incentive Application To Be Verified', 2],
  ['499f6d23-af74-4637-9dc5-e28ccaeb73f0', 'Incentive Application To Be Submitted', 3],
  ['c5bfe7f1-21e2-4970-a24f-4c340ca12d47', 'Incentive Application Submitted — Awaiting Program Response', 4],
  ['9af6ffdd-2cd1-4d5a-aa63-53c1953b0de8', 'Incentive Application Pre-Approved', 5],
  ['07badb45-e519-40a4-a6ba-8914ebc126f4', 'Incentive Application Approved', 6],
  ['e718d846-fef6-4e6c-8a54-2a07a0c4afa0', 'Incentive Application Corrections Needed', 7],
  ['42815a28-fbb9-489c-b2d5-509a719ab7fb', 'Incentive Application Denied', 8],
  ['5758985a-fa16-4bac-b2dd-2c659a6d7517', 'Incentive Application Withdrawn', 9],
].map(([id, label, order]) => ({
  id, picklist_value: label, picklist_label: label,
  picklist_sort_order: order, picklist_description: null,
  picklist_state: null, scope_mode: 'universal',
}))

// The four moves prod permits out of "Submitted — Awaiting Program Response".
const TRANSITIONS = [
  ['5d4cec72-136d-4cd2-9a97-2a116d21c4a7', 'ST-00010', 'Pre-approval received',
   'Program responds with pre-approval pending final review.',
   '9af6ffdd-2cd1-4d5a-aa63-53c1953b0de8', 10],
  ['48d1aa39-2ac4-4cc2-9f0c-27e36d5c71da', 'ST-00011', 'Program requested corrections',
   'Program returns the application asking for changes.',
   'e718d846-fef6-4e6c-8a54-2a07a0c4afa0', 20],
  ['7069a1a9-8eed-4dee-87f4-43d238593348', 'ST-00012', 'Application denied',
   'Program rejects the application outright.',
   '42815a28-fbb9-489c-b2d5-509a719ab7fb', 30],
  ['9bb0bd90-f776-48ed-accb-b67a3d1d757e', 'ST-00013', 'Withdraw application',
   'Applicant withdraws while awaiting program response.',
   '5758985a-fa16-4bac-b2dd-2c659a6d7517', 90],
].map(([id, num, label, description, to, order]) => ({
  id, st_record_number: num, st_transition_label: label, st_description: description,
  st_from_status_id: 'c5bfe7f1-21e2-4970-a24f-4c340ca12d47',
  st_to_status_id: to, st_sort_order: order, st_is_active: true,
}))

const PICKLIST_ROWS = IA_STATUS_VALUES.map(v => ({
  id: v.id, picklist_value: v.picklist_value, picklist_label: v.picklist_label,
}))

function thenable(value) {
  const chain = {
    select: () => chain, eq: () => chain, is: () => chain,
    in: () => chain, order: () => chain, limit: () => chain,
    then: (res, rej) => Promise.resolve(value).then(res, rej),
    catch: (rej) => Promise.resolve(value).catch(rej),
  }
  return chain
}

export const supabase = {
  rpc: (fn) => thenable(
    fn === 'picklist_values_for_record_type'
      ? { data: IA_STATUS_VALUES, error: null }
      : { data: [], error: null }
  ),
  from: (table) => thenable({
    data: table === 'status_transitions' ? TRANSITIONS
        : table === 'picklist_values'    ? PICKLIST_ROWS
        : [],
    error: null,
  }),
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
}

export default supabase

// The rest of the module's surface, so any module that happens to be pulled
// into the harness's graph still links. Nothing here is exercised.
export const hasSupabaseConfig = true
export async function fetchAllPaged() { return [] }
export async function fetchAllKeyset() { return [] }
