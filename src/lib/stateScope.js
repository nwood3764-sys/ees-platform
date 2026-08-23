// ---------------------------------------------------------------------------
// stateScope — the pure rules behind geographic (state) record access.
//
// Kept free of any data access so it can be tested directly and reused by both
// the Users list and the Record Access screen. The authority on who sees what
// is the database; this module only decides how a set of grants is READ:
//
//   • no grants at all means UNRESTRICTED, not "no access" — the single most
//     important thing for this UI to state correctly, because it is the state
//     every existing user is in;
//   • a state code is two letters, uppercase, trimmed.
// ---------------------------------------------------------------------------

// Returns the cleaned two-letter code, or null when the value is not one.
// The database enforces the same shape with a CHECK constraint; doing it here
// too turns a constraint violation into a readable message.
export function normalizeStateCode(value) {
  const code = String(value ?? '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

// A user is state-scoped only when they hold at least one grant. Anything
// falsy — never loaded, no rows, undefined — is unrestricted.
export function isStateScoped(scopes) {
  return Array.isArray(scopes) && scopes.length > 0
}

// One line for a list cell. Deliberately says "All states" rather than
// something like "None", which would read as the opposite of what it means.
export function describeStateAccess(scopes) {
  if (!isStateScoped(scopes)) return 'All states'
  return scopes
    .map(s => (typeof s === 'string' ? s : s?.uss_state_code))
    .map(normalizeStateCode)
    .filter(Boolean)
    .sort()
    .join(', ')
}
