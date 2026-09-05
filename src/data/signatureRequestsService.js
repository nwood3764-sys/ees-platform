// =============================================================================
// The signature requests already out on a record.
//
// Read before a send, so the dialog can say "one is already out" instead of
// silently creating a second live link. See src/lib/openSignatureRequests.js
// for which statuses count and why.
//
// Deliberately its own small service rather than a function bolted onto
// hearProposalService or homesProposalService: BOTH send paths need this, and
// the question — "what is outstanding on this record?" — is about the record,
// not about which document is being sent.
// =============================================================================

import { supabase } from '../lib/supabase'
import { openRequestsIn } from '../lib/openSignatureRequests'

/**
 * Every signature request outstanding on one record.
 *
 * Never throws: this runs to DECORATE a send dialog, and a failure to read the
 * history must not stop somebody sending a document. A read that fails returns
 * an empty list and the dialog behaves exactly as it did before — the same
 * failure direction the wording template takes.
 *
 * @param {string} parentObject     e.g. 'enrollments'
 * @param {string} parentRecordId
 * @returns {Promise<Array>} open requests, newest first
 */
export async function fetchOpenSignatureRequests(parentObject, parentRecordId) {
  if (!parentObject || !parentRecordId) return []
  try {
    const { data, error } = await supabase
      .from('envelopes')
      .select(`
        id, env_record_number, env_name, env_sent_at, is_deleted,
        status:env_status ( picklist_value ),
        recipients:envelope_recipients (
          recipient_order, recipient_name, recipient_email, is_deleted
        )
      `)
      .eq('env_parent_object', parentObject)
      .eq('env_parent_record_id', parentRecordId)
      .is('is_deleted', false)
      .order('env_sent_at', { ascending: false })
      .limit(25)
    if (error) return []

    const rows = (data || []).map(e => {
      // Recipient #1 is who the request went to; the later signers in a chain
      // have not been asked yet, so naming them would misdescribe the state.
      const first = (e.recipients || [])
        .filter(r => r.is_deleted !== true)
        .sort((a, b) => (a.recipient_order || 0) - (b.recipient_order || 0))[0]
      return {
        id:             e.id,
        recordNumber:   e.env_record_number,
        name:           e.env_name,
        status:         e.status?.picklist_value || null,
        sentAt:         e.env_sent_at,
        isDeleted:      e.is_deleted === true,
        recipientName:  first?.recipient_name || null,
        recipientEmail: first?.recipient_email || null,
      }
    })
    return openRequestsIn(rows)
  } catch {
    return []
  }
}

/**
 * Resend the signing email for an envelope that is already out.
 *
 * The alternative to creating a second one. resend-envelope-email accepts only
 * a Sent or Delivered envelope, which is exactly the set this dialog offers.
 */
export async function resendSignatureRequest(envelopeId) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Supabase is not configured (missing env vars).')
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) throw new Error('Not signed in — refresh and sign in again.')

  const resp = await fetch(`${url}/functions/v1/resend-envelope-email`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ envelope_id: envelopeId, signing_base_url: window.location.origin }),
  })
  const j = await resp.json().catch(() => ({}))
  // Same trap as send-email-v1: a 200 can carry a failure in the body, so the
  // response status alone is not the answer.
  if (!resp.ok || j.ok === false) {
    throw new Error(j.error || j.failure_reason || `Resend failed (${resp.status})`)
  }
  return j
}
