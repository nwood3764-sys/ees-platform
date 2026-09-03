// ---------------------------------------------------------------------------
// enrollmentProposalContext — everything a proposal needs to name the three
// parties at the top of the page, read off ONE enrollment: the owner and their
// address, the contact, the install address, the income-qualification number,
// the unit count and the primary/support contractors.
//
// Both programmes' proposals open with the same three columns (primary IRA
// contractor / project information / customer information), so they resolve
// that context here rather than each keeping its own copy of the traversal.
// What differs is what each proposal reads NEXT — the HOMES proposal parses the
// two Asset Score reports attached to the enrollment; the HEAR proposal reads
// the opportunity's line items — and that stays in each programme's own
// service.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'
import { resolveOwnerAddress, splitOwnerAddress } from '../lib/ownerAddress'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Kept as the module's old name so nothing that imports it breaks; the rule
// itself lives in src/lib/ownerAddress.js, where it is tested. It used to cut
// at the FIRST comma, which put "Suite 2275" on the city line of every proposal
// whose owner has a suite.
export const splitAddress = splitOwnerAddress

export function toInt(v) {
  if (v == null || v === '') return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

// A stored date ('YYYY-MM-DD' or ISO) -> 'MM/DD/YYYY' for the document; '' when absent.
export function fmtDate(v) {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(v)
}

/**
 * Load the party/project context for one enrollment. Returns
 * `{ enr, recordTypeValue, fields, units, contractor, secondaryContractor,
 *    property, building }`. Reads no documents and no line items — a caller
 * adds what its own document needs.
 */
export async function loadEnrollmentProposalContext(enrollmentId) {
  if (!enrollmentId) throw new Error('loadEnrollmentProposalContext: enrollmentId is required')

  const { data: enr, error } = await supabase
    .from('enrollments').select('*').eq('id', enrollmentId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!enr) throw new Error('Enrollment not found')

  const { data: rt } = enr.enrollment_record_type
    ? await supabase.from('picklist_values')
        .select('picklist_value, picklist_label').eq('id', enr.enrollment_record_type).maybeSingle()
    : { data: null }

  const [{ data: prop }, { data: bld }, { data: signer }] = await Promise.all([
    enr.property_id
      ? supabase.from('properties').select('*').eq('id', enr.property_id).maybeSingle()
      : Promise.resolve({ data: null }),
    enr.building_id
      ? supabase.from('buildings')
          .select('building_total_units, building_number_of_units').eq('id', enr.building_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // The CONTACT the record actually names. See the note on pjContact below.
    UUID.test(String(enr.enrollment_signer_contact_id || ''))
      ? supabase.from('contacts')
          .select('contact_name, contact_title, contact_email, contact_phone')
          .eq('id', enr.enrollment_signer_contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // THE CUSTOMER IS THE PROPERTY'S ACCOUNT.
  //
  // `enrollments.enrollment_owner` is NOT the property owner — it is the
  // record's own owner, the LEAP user, which is what "every record has a named
  // owner" means on this platform. It is a `users` id on all 50 live
  // enrollments (Nicholas, Lucas and Brittin Wood), it carries no foreign key
  // to say so, and this function used to look it up in `accounts`. That lookup
  // found nothing and returned '', which is why the Customer Information block
  // on every HOMES and HEAR proposal opened with a person's name where the
  // customer company belongs — the block named no customer at all.
  //
  // The owner company is the PROPERTY's account: one account per real-world
  // company, and `properties.property_account_id` is the owner (2026-07-25).
  const contractorIds = [enr.enrollment_contractor_account_id,
    enr.enrollment_support_contractor_account_id]
    .filter(v => v && UUID.test(String(v)))
  const ownerAccountId = UUID.test(String(prop?.property_account_id || ''))
    ? prop.property_account_id : null
  const acctIds = [...contractorIds, ownerAccountId].filter(Boolean)
  const { data: accts } = acctIds.length
    ? await supabase.from('accounts')
        .select('id, account_name, billing_street, billing_city, billing_state, billing_zip, ' +
                'mailing_street, mailing_city, mailing_state, mailing_zip')
        .in('id', acctIds)
    : { data: [] }
  const acct = id => (accts || []).find(a => a.id === id) || null
  const acctName = id => acct(id)?.account_name || null
  const ownerAccount = ownerAccountId ? acct(ownerAccountId) : null
  // The HUD owner organisation on the property is the fallback for a property
  // that has not been matched to an account yet.
  const ownerName = ownerAccount?.account_name || prop?.property_hud_owner_org || ''
  const contractor = acctName(enr.enrollment_contractor_account_id) || ''
  const secondaryContractor = enr.enrollment_has_support_contractor
    ? (acctName(enr.enrollment_support_contractor_account_id) || '') : ''

  // Prefer the account's STRUCTURED billing address over the enrollment's
  // single free-text column — there is nothing to guess when the street, city,
  // state and ZIP are already separate columns.
  const owner = resolveOwnerAddress({
    account: ownerAccount, freeText: enr.enrollment_owner_address,
  })
  const units = toInt(enr.enrollment_occupied_units)
    || toInt(bld?.building_total_units) || toInt(bld?.building_number_of_units)
    || toInt(prop?.property_total_units) || toInt(prop?.property_total_number_of_units) || null
  const csz = [prop?.property_city,
    [prop?.property_state, prop?.property_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')

  // The customer contact is the enrollment's CONTACT LOOKUP
  // (enrollment_signer_contact_id), falling back to the free-text columns for a
  // record saved before that lookup existed — the same precedence
  // build_wi_ira_hear_project_reservation_form_prefill applies when it fills
  // the programme's own submittal form.
  //
  // The proposal was the last consumer still reading the free-text columns
  // ALONE, and on ENR-00077 those hold a stale contact: the record page and the
  // submittal both name Dennis Hanson (the lookup) while the printed proposal
  // named Josiah Brazle. All four values move together — a name from one person
  // beside another's phone number is worse than either one alone.
  const pick = (fromContact, typed) =>
    (fromContact && String(fromContact).trim()) || typed || ''
  const fields = {
    pjOwner:       ownerName || '',
    pjOwnerAddr:   owner.addr,
    pjOwnerCsz:    owner.csz,
    pjContact:     pick(signer?.contact_name,  enr.enrollment_contact_name),
    pjContactTitle:pick(signer?.contact_title, enr.enrollment_contact_title),
    pjEmail:       pick(signer?.contact_email, enr.enrollment_contact_email),
    pjPhone:       pick(signer?.contact_phone, enr.enrollment_contact_phone),
    pjPropName:    prop?.property_name || '',
    pjInstallAddr: prop?.property_street || '',
    pjCsz:         csz,
    pjIQ:          prop?.property_ira_income_qualification_number || '',
    pjProjInvNo:   enr.enrollment_record_number || '',
    pjInvNo:       enr.enrollment_record_number || '',
    pjInvDate:     new Date().toISOString().slice(0, 10),
    pjEstEnd:      fmtDate(enr.enrollment_estimated_completion_date),
    pjSecondaryContractor: secondaryContractor || '',
  }

  return { enr, recordTypeValue: rt?.picklist_value || null, fields, units,
    contractor, secondaryContractor, property: prop, building: bld }
}
