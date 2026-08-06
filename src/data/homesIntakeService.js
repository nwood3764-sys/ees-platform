// ─── homesIntakeService.js ───────────────────────────────────────────────
// Staff-facing wrapper for the NC HOMES single-family intake. Calls the
// create-homes-intake edge function, which creates the CRM chain (Account /
// Contact / Property[single-family] / Building[single-family] / Opportunity
// [NC SF HOMES audit] / Project) and emails the homeowner a personalized
// "Schedule Now" link from the NC mailbox. supabase.functions.invoke carries
// the caller's session token, so the created records are owned by the staff
// member running the intake.

import { supabase } from '../lib/supabase'

/**
 * Submit a HOMES intake.
 * @param {object} form { firstName, lastName, email, phone, street, city, state, zip, amiTier, notes }
 * @returns {Promise<object>} { status, opportunity_id, opportunity_record_number, schedule_url, email, ... }
 */
export async function submitHomesIntake(form) {
  const { data, error } = await supabase.functions.invoke('create-homes-intake', {
    body: {
      first_name: form.firstName?.trim(),
      last_name:  form.lastName?.trim(),
      email:      form.email?.trim(),
      phone:      form.phone?.trim(),
      street:     form.street?.trim(),
      city:       form.city?.trim(),
      state:      (form.state || 'NC').trim().toUpperCase(),
      zip:        form.zip?.trim(),
      ami_tier:   form.amiTier || undefined,
      notes:      form.notes?.trim() || undefined,
    },
  })
  if (error) {
    let detail = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) detail = body.error
    } catch { /* keep the generic message */ }
    throw new Error(detail || 'Intake failed')
  }
  if (data && data.status && data.status !== 'ok') {
    throw new Error(data.message || data.error || 'Intake failed')
  }
  return data
}

/**
 * AMI tier options for the intake form. Loaded from the opportunity_ami_tier
 * picklist so they stay admin-managed (never hardcoded).
 */
export async function fetchAmiTierOptions() {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('picklist_value, picklist_label, picklist_sort_order')
    .eq('picklist_object', 'opportunities')
    .eq('picklist_field', 'opportunity_ami_tier')
    .eq('picklist_is_active', true)
    .order('picklist_sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(r => ({ value: r.picklist_value, label: r.picklist_label || r.picklist_value }))
}
