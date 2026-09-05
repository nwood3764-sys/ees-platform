// ─── OutboundMessageApprovals ────────────────────────────────────────────────
// The handle on the outbound valve.
//
// Nicholas, 2026-09-03: "Any outgoing communications, emails, texts, anything
// must be approved by a human first. That's a hard rule for now. Maybe in the
// future we'll release that, but not right now."
//
// Said after LEAP emailed a real property contact "Your home energy assessment
// is scheduled" about an insulation removal, with a blank date, because a field
// got populated. enqueue_notification now holds every customer message; this is
// where a person reads one and decides.
//
// The screen leads with the RECIPIENT, because that is the thing that was wrong
// last time: the message went to somebody nobody meant to contact. Anything the
// send cannot resolve — a missing address, a missing template — is called out
// on the row rather than left blank, since "we could not tell who this was
// going to" is exactly when a person must not press Approve.

import { useCallback, useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import {
  fetchMessagesAwaitingApproval,
  approveOutboundMessage,
  declineOutboundMessage,
} from '../data/dispatchService'

const FONT = 'Inter, system-ui, sans-serif'
const MONO = 'JetBrains Mono, monospace'

const EVENT_LABEL = {
  booking_confirmation: 'Booking confirmation',
  rescheduled:          'Rescheduled notice',
  on_my_way:            'On my way',
  arrived:              'Arrived',
  completed:            'Visit completed',
  canceled:             'Cancellation notice',
  reminder_48h:         '48-hour reminder',
  reminder_24h:         '24-hour reminder',
  morning_of:           'Morning-of reminder',
}

const fmtWhen = (iso) => {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return null }
}

// The stored template is HTML. A person approving needs to read the words, not
// the markup, so tags are stripped for the preview — the send itself is
// untouched and still delivers the real template.
function readableBody(html) {
  if (!html) return ''
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&rsquo;/g, '’').replace(/&ndash;/g, '–')
    .replace(/&#10003;/g, '').replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

export default function OutboundMessageApprovals() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [openId, setOpenId] = useState(null)
  const toast = useToast()

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await fetchMessagesAwaitingApproval()) }
    catch (err) { setError(err.message || String(err)); setRows([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const approve = async (r) => {
    if (typeof window !== 'undefined' && !window.confirm(
      `Send this ${r.channel === 'sms' ? 'text' : 'email'} to ${r.recipientAddress || 'the recipient'}?`
    )) return
    setBusyId(r.id)
    try {
      const res = await approveOutboundMessage(r.id)
      toast.success(res?.outcome === 'noop'
        ? (res.message || 'That message was already handled.')
        : `Sent to ${r.recipientAddress}`)
      await load()
    } catch (err) { toast.error(err.message || 'Could not send that message.') }
    finally { setBusyId(null) }
  }

  const decline = async (r) => {
    const reason = typeof window !== 'undefined'
      ? window.prompt('Why is this not being sent? (optional — it is kept on the record)')
      : null
    if (reason === null && typeof window !== 'undefined') return
    setBusyId(r.id)
    try {
      await declineOutboundMessage(r.id, reason)
      toast.success('Declined — nothing was sent.')
      await load()
    } catch (err) { toast.error(err.message || 'Could not decline that message.') }
    finally { setBusyId(null) }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: C.textPrimary }}>
          Messages Awaiting Approval
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
          Nothing goes to a customer until somebody here reads it and approves it.
          {rows !== null && ` · ${rows.length} waiting`}
        </div>
      </div>

      {error && (
        <div style={{
          background: '#e8f1fb', border: `1px solid ${C.sky}`, borderRadius: 8,
          padding: '10px 14px', marginBottom: 12, color: '#1e466b', fontSize: 12,
        }}>
          Could not load the queue: {error}
        </div>
      )}

      {rows === null && (
        <div style={{ fontSize: 12, color: C.textMuted }}>Loading…</div>
      )}

      {rows !== null && rows.length === 0 && !error && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>
            Nothing waiting
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            No customer message is being held. New ones appear here the moment LEAP wants to send one.
          </div>
        </div>
      )}

      {(rows || []).map((r) => {
        const open = openId === r.id
        const noAddress = !r.recipientAddress
        const noTemplate = !r.subject && !r.body
        const blocked = noAddress || noTemplate
        return (
          <div key={r.id} style={{
            background: C.card, border: `1px solid ${blocked ? C.amber : C.border}`,
            borderRadius: 10, marginBottom: 12, overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: C.textMuted }}>
                  {r.recordNumber}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '1px 8px',
                  color: '#1e466b', background: '#e8f1fb',
                }}>
                  {r.channel === 'sms' ? 'TEXT' : 'EMAIL'}
                </span>
                <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.textPrimary }}>
                  {EVENT_LABEL[r.event] || r.event}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted }}>
                  requested {fmtWhen(r.requestedAt)}
                </span>
              </div>

              {/* The recipient leads, because sending to the wrong person is the
                  failure this whole gate exists to prevent. */}
              <div style={{
                marginTop: 10, padding: '8px 10px', borderRadius: 8,
                background: noAddress ? '#fdf3e0' : C.cardSecondary,
                border: `1px solid ${noAddress ? C.amber : C.border}`,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: C.textMuted }}>To</div>
                <div style={{ fontFamily: FONT, fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginTop: 2 }}>
                  {r.recipientName || 'Unnamed contact'}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: noAddress ? '#8a5a00' : C.textSecondary }}>
                  {r.recipientAddress || 'No address on the contact — this cannot be sent'}
                </div>
              </div>

              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 8 }}>
                {[r.workType, r.property, r.workOrder, r.appointment].filter(Boolean).join(' · ')}
                {r.scheduledStart
                  ? ` · ${fmtWhen(r.scheduledStart)}`
                  : <span style={{ color: C.amber, fontWeight: 600 }}> · no date on the appointment</span>}
              </div>

              {r.subject && (
                <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: C.textPrimary, marginTop: 8 }}>
                  “{r.subject}”
                </div>
              )}
              {noTemplate && (
                <div style={{ fontSize: 12, color: '#8a5a00', marginTop: 8 }}>
                  No active template matches this message — there is nothing to send.
                </div>
              )}

              {open && r.body && (
                <div style={{
                  marginTop: 8, padding: '10px 12px', background: C.cardSecondary,
                  border: `1px solid ${C.border}`, borderRadius: 8,
                  fontSize: 12, lineHeight: 1.55, color: C.textSecondary,
                  maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap',
                }}>
                  {readableBody(r.body)}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                {r.body && (
                  <button onClick={() => setOpenId(open ? null : r.id)} style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#1a5a8a',
                  }}>
                    {open ? 'Hide the message' : 'Read the message'}
                  </button>
                )}
                <button
                  onClick={() => approve(r)}
                  disabled={busyId === r.id || blocked}
                  title={blocked ? 'This message cannot be sent as it stands' : undefined}
                  style={{
                    marginLeft: 'auto',
                    background: blocked ? C.borderDark : C.emerald, color: '#fff',
                    border: 'none', borderRadius: 6, padding: '7px 16px',
                    fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
                    cursor: blocked ? 'not-allowed' : 'pointer',
                  }}
                >
                  {busyId === r.id ? 'Sending…' : 'Approve and send'}
                </button>
                <button
                  onClick={() => decline(r)}
                  disabled={busyId === r.id}
                  style={{
                    background: C.card, color: C.textSecondary,
                    border: `1px solid ${C.borderDark}`, borderRadius: 6, padding: '7px 14px',
                    fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Don’t send
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
