// Stub for src/lib/supabase.js, aliased in by
// tools/page-layout-alignment-check/run.mjs. The field group renders from the
// props it is given; nothing in this check reads the network, so every call
// resolves empty rather than being mocked per query.
const result = { data: [], error: null, count: 0 }
const thenable = {
  then: (resolve) => Promise.resolve(result).then(resolve),
  catch: () => thenable,
}
function builder() {
  const b = new Proxy(thenable, {
    get(target, prop) {
      if (prop in target) return target[prop]
      return () => b
    },
  })
  return b
}
export const supabase = {
  from: () => builder(),
  rpc: async () => result,
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  storage: { from: () => ({ createSignedUrl: async () => result, upload: async () => result }) },
  functions: { invoke: async () => result },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
}
export default supabase
export const getCurrentUserId = async () => null
export const currentAppUserId = async () => null

// The rest of src/lib/supabase.js's public surface. Modules pulled in by
// RecordDetail's import graph destructure these at load time, so they have to
// exist even though this check never reads a row.
export const hasSupabaseConfig = false
export async function fetchAllPaged() { return [] }
export async function fetchAllKeyset() { return [] }
