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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// "6737 W Washington Street, West Allis, WI 53214" -> street line + city/state/zip line
export function splitAddress(full) {
  if (!full) return { addr: '', csz: '' }
  const s = String(full).trim()
  const i = s.indexOf(',')
  if (i < 0) return { addr: s, csz: '' }
  return { addr: s.slice(0, i).trim(), csz: s.slice(i + 1).trim() }
}

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

  // Owner and contractor are account lookups; resolve their names. The enrollment
  // carries a PRIMARY contractor and, when enrollment_has_support_contractor is
  // set, a SECONDARY (support) contractor — both are listed on the documents.
  const acctIds = [enr.enrollment_owner, enr.enrollment_contractor_account_id,
    enr.enrollment_support_contractor_account_id]
    .filter(v => v && UUID.test(String(v)))
  const { data: accts } = acctIds.length
    ? await supabase.from('accounts').select('id, account_name').in('id', acctIds)
    : { data: [] }
  const acctName = id => (accts || []).find(a => a.id === id)?.account_name || null
  const ownerName = UUID.test(String(enr.enrollment_owner || ''))
    ? (acctName(enr.enrollment_owner) || '') : (enr.enrollment_owner || '')
  const contractor = acctName(enr.enrollment_contractor_account_id) || ''
  const secondaryContractor = enr.enrollment_has_support_contractor
    ? (acctName(enr.enrollment_support_contractor_account_id) || '') : ''

  const owner = splitAddress(enr.enrollment_owner_address)
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
