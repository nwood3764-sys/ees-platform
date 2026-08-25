// Pins the rule that decides which contact represents a contractor account on a
// program form. The dangerous cases are the ones this file exists for:
//   - a contact from an unrelated company is never carried when the account changes
//   - a contact on the account's PARENT is valid, because that is what the
//     field's own picker offers (list_contacts_for_account_hierarchy)
//   - an unknown eligibility list never drops a stored pick
import assert from 'node:assert/strict'
import {
  CONTRACTOR_CONTACT_PAIRS,
  contractorContactPairsFor,
  tableHasContractorContacts,
  resolveContractorContact,
} from '../src/lib/contractorContact.js'

let checks = 0
const check = (name, fn) => { fn(); checks++; process.stdout.write(`  ok  ${name}\n`) }

// --- the pairs -------------------------------------------------------------
check('enrollments carry a primary and a support contractor pair', () => {
  const pairs = contractorContactPairsFor('enrollments')
  assert.equal(pairs.length, 2)
  assert.deepEqual(pairs.map(p => p.account), [
    'enrollment_contractor_account_id', 'enrollment_support_contractor_account_id',
  ])
  assert.deepEqual(pairs.map(p => p.contact), [
    'enrollment_contractor_contact_id', 'enrollment_support_contractor_contact_id',
  ])
})

check('incentive applications carry the same two pairs under their prefix', () => {
  const pairs = contractorContactPairsFor('incentive_applications')
  assert.equal(pairs.length, 2)
  assert.deepEqual(pairs.map(p => p.contact), [
    'ia_contractor_contact_id', 'ia_support_contractor_contact_id',
  ])
})

check('every declared contact column is its account column with the suffix swapped', () => {
  for (const pairs of Object.values(CONTRACTOR_CONTACT_PAIRS)) {
    for (const pair of pairs) {
      assert.equal(pair.account.replace(/_account_id$/, '_contact_id'), pair.contact)
    }
  }
})

check('an object with no contractor block is left alone', () => {
  assert.deepEqual(contractorContactPairsFor('properties'), [])
  assert.equal(tableHasContractorContacts('properties'), false)
  assert.equal(tableHasContractorContacts('enrollments'), true)
})

// --- the rule --------------------------------------------------------------
const SEALED = 'acct-sealed'
const EES_WI = 'acct-ees-wi'
const TYLER = 'con-tyler'      // Sealed Inc
const NICHOLAS = 'con-nicholas' // Energy Efficiency Services of Wisconsin
const BRITTIN = 'con-brittin'   // Energy Efficiency Services (the PARENT account)

check('no contractor account means no contractor contact', () => {
  assert.equal(resolveContractorContact({
    accountId: null, currentContactId: NICHOLAS, accountContactId: BRITTIN,
  }), null)
})

check('a selected contact the picker offers is kept', () => {
  assert.equal(resolveContractorContact({
    accountId: EES_WI,
    currentContactId: NICHOLAS,
    eligibleContactIds: [NICHOLAS, BRITTIN],
    accountContactId: BRITTIN,
  }), NICHOLAS)
})

check('a contact on the parent account is valid -- the picker offers it', () => {
  assert.equal(resolveContractorContact({
    accountId: EES_WI,
    currentContactId: BRITTIN,
    eligibleContactIds: [NICHOLAS, BRITTIN],
    accountContactId: BRITTIN,
  }), BRITTIN)
})

check("changing the account replaces another company's contact (ENR-00012)", () => {
  assert.equal(resolveContractorContact({
    accountId: EES_WI,
    currentContactId: TYLER,
    eligibleContactIds: [NICHOLAS, BRITTIN],
    accountContactId: BRITTIN,
  }), BRITTIN)
})

check('a blank contact fills from the account, which is the whole point', () => {
  assert.equal(resolveContractorContact({
    accountId: SEALED,
    currentContactId: null,
    eligibleContactIds: [TYLER],
    accountContactId: TYLER,
  }), TYLER)
})

check('an account that names nobody usable leaves the contact blank, not wrong', () => {
  assert.equal(resolveContractorContact({
    accountId: EES_WI,
    currentContactId: TYLER,
    eligibleContactIds: [NICHOLAS],
    accountContactId: null,
  }), null)
})

check('an Account Contact the picker does not offer is refused', () => {
  assert.equal(resolveContractorContact({
    accountId: EES_WI,
    currentContactId: null,
    eligibleContactIds: [NICHOLAS],
    accountContactId: TYLER,
  }), null)
})

check('an unknown eligibility list never drops a stored pick', () => {
  assert.equal(resolveContractorContact({
    accountId: EES_WI, currentContactId: TYLER, eligibleContactIds: null, accountContactId: BRITTIN,
  }), TYLER)
})

check('an empty eligibility list is a real answer: nothing qualifies', () => {
  assert.equal(resolveContractorContact({
    accountId: EES_WI, currentContactId: TYLER, eligibleContactIds: [], accountContactId: BRITTIN,
  }), null)
})

check('a Set of eligible ids works as well as an array', () => {
  assert.equal(resolveContractorContact({
    accountId: EES_WI,
    currentContactId: TYLER,
    eligibleContactIds: new Set([NICHOLAS, BRITTIN]),
    accountContactId: BRITTIN,
  }), BRITTIN)
})

check('the rule is idempotent -- resolving its own answer changes nothing', () => {
  const args = {
    accountId: EES_WI,
    currentContactId: TYLER,
    eligibleContactIds: [NICHOLAS, BRITTIN],
    accountContactId: BRITTIN,
  }
  const once = resolveContractorContact(args)
  const twice = resolveContractorContact({ ...args, currentContactId: once })
  assert.equal(twice, once)
})

check('called with nothing at all it returns nobody rather than throwing', () => {
  assert.equal(resolveContractorContact(), null)
  assert.equal(resolveContractorContact({}), null)
})

console.log(`\ncontractor-contact-fixture: ${checks} checks passed`)
