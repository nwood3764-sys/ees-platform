// Which contact represents a contractor account on a program form.
//
// The database owns this rule (contractor_contact_for_account, enforced by
// trg_zz_enrollment_contractor_contacts / trg_zz_ia_contractor_contacts). The
// create form has to reach the same answer before the first save, or the user
// reviews one person on screen and a different one lands on the record — which
// is exactly what happened while the form resolved 'Tyler Wallace' and
// 'Nicholas Wood' by literal name: updating the account's Account Contact
// changed nothing, because nothing was reading the account.
//
// Pure so it can be tested without a database or a browser; the caller supplies
// the account's Account Contact and the ids the field's own picker offers
// (list_contacts_for_account_hierarchy — the account, its ancestors, and anyone
// linked through account_contact_relations).

// Every account -> contact pair that carries a contractor on a program form.
// A pair is added here, not wired up field by field.
export const CONTRACTOR_CONTACT_PAIRS = {
  enrollments: [
    { account: 'enrollment_contractor_account_id', contact: 'enrollment_contractor_contact_id' },
    { account: 'enrollment_support_contractor_account_id', contact: 'enrollment_support_contractor_contact_id' },
  ],
  incentive_applications: [
    { account: 'ia_contractor_account_id', contact: 'ia_contractor_contact_id' },
    { account: 'ia_support_contractor_account_id', contact: 'ia_support_contractor_contact_id' },
  ],
}

export function contractorContactPairsFor(tableName) {
  return CONTRACTOR_CONTACT_PAIRS[tableName] || []
}

export function tableHasContractorContacts(tableName) {
  return contractorContactPairsFor(tableName).length > 0
}

// The selected contact when the account's own picker offers it, else that
// account's Account Contact, else nobody. No account means no contact: a
// contractor contact with no contractor is a person representing nothing.
export function resolveContractorContact({
  accountId = null,
  currentContactId = null,
  eligibleContactIds = null,
  accountContactId = null,
} = {}) {
  if (!accountId) return null
  const eligible = eligibleContactIds instanceof Set
    ? eligibleContactIds
    : new Set(Array.isArray(eligibleContactIds) ? eligibleContactIds : [])
  // No eligibility list means the picker's options are unknown, not that
  // nothing qualifies — never drop a stored pick on missing information.
  if (currentContactId && (eligibleContactIds == null || eligible.has(currentContactId))) {
    return currentContactId
  }
  if (accountContactId && (eligibleContactIds == null || eligible.has(accountContactId))) {
    return accountContactId
  }
  return null
}
