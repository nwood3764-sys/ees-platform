// =============================================================================
// InboundEmailHealthPane — is each shared mailbox actually receiving?
//
// Built 2026-09-05 because nothing in LEAP could answer that question. The
// only record of the Microsoft Graph subscriptions was `graph_subscriptions`,
// which was written once at creation and never again: all three rows read
// gs_status = 'active' with an expiry of 2026-07-08 for two solid months,
// and would have read exactly the same had the subscription been deleted in
// July. No screen read that table at all, so there was nowhere the staleness
// could be noticed. Mail was arriving the whole time — the plumbing was fine;
// what was missing was any way to know it.
//
// This pane reads graph_subscription_health(), which DERIVES each verdict on
// every call from three pieces of evidence: when a renewal run last confirmed
// the subscription against Microsoft, when it expires, and what mail has
// actually landed in the box. Never from a stored status string.
//
// THE FAILURE DIRECTION IS "UNVERIFIED", NEVER "RECEIVING". A subscription
// LEAP has not confirmed reads amber even when it is perfectly alive. Being
// told "we cannot tell" is useful; being told "healthy" on no evidence is the
// defect this exists to end. Do not make an unconfirmed mailbox read green.
//
// No red or orange anywhere, per the design system: a problem is navy on sky
// blue, a caution is amber.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { C } from '../../data/constants'
import { Icon, LoadingState, ErrorState } from '../../components/UI'
import { PINNED_TABLE, ROW_RULE, pinnedHeaderCell } from '../../lib/pinnedTableHeader'
import { fetchInboundEmailHealth } from '../../data/conversationsService'

const VERDICT_STYLE = {
  'Receiving':     { bg: '#e8f8f0', fg: C.emeraldMid,   label: 'Receiving' },
  'Unverified':    { bg: '#fdf5e6', fg: '#8a6420',      label: 'Unverified' },
  'Not receiving': { bg: '#eaf2fb', fg: C.navy,         label: 'Not receiving' },
  'Not set up':    { bg: C.cardSecondary, fg: C.textMuted, label: 'Not set up' },
}

function when(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function VerdictChip({ verdict }) {
  const s = VERDICT_STYLE[verdict] || VERDICT_STYLE['Not set up']
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      background: s.bg, color: s.fg, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

export default function InboundEmailHealthPane() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows(await fetchInboundEmailHealth()) }
    catch (e) { setError(e.message || String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const receiving  = rows.filter(r => r.verdict === 'Receiving').length
  const unverified = rows.filter(r => r.verdict === 'Unverified').length
  const notRecv    = rows.filter(r => r.verdict === 'Not receiving').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.textPrimary }}>Inbound Email Health</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.textSecondary, maxWidth: 720 }}>
            Whether mail sent to each shared mailbox reaches LEAP. Every verdict is worked out
            fresh from what Microsoft last confirmed, when the subscription expires, and the mail
            that has actually landed — a mailbox LEAP cannot confirm reads <strong>Unverified</strong>,
            never <em>Receiving</em>.
          </p>
        </div>
        <button
          onClick={load}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            border: `1px solid ${C.borderDark}`, borderRadius: 8, background: C.card,
            color: C.textPrimary, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Icon path="M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10 M20.49 15A9 9 0 015.64 18.36L1 14" size={12} color="currentColor" /> Refresh
        </button>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13, color: C.textSecondary }}>
            <span><strong style={{ color: C.emeraldMid }}>{receiving}</strong> receiving</span>
            <span>·</span>
            <span><strong style={{ color: '#8a6420' }}>{unverified}</strong> unverified</span>
            <span>·</span>
            <span><strong style={{ color: C.navy }}>{notRecv}</strong> not receiving</span>
          </div>

          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
            boxShadow: '0 1px 2px rgba(13,26,46,0.04)', overflow: 'auto', maxHeight: '65vh',
          }}>
            <table style={PINNED_TABLE}>
              <thead>
                <tr>
                  {['Mailbox', 'State', 'Purpose', 'Status', 'Inbound (30 days)', 'Last message in', 'Expires', 'What this means']
                    .map((h, i) => (
                      <th key={h} style={{
                        ...pinnedHeaderCell(),
                        textAlign: i === 4 ? 'right' : 'left',
                        padding: '10px 12px', fontSize: 12, fontWeight: 600,
                        color: C.textSecondary, whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                    No mailboxes are configured.
                  </td></tr>
                )}
                {rows.map(r => (
                  <tr key={r.mailbox}>
                    <td style={{ ...ROW_RULE, padding: '10px 12px', fontSize: 13, fontWeight: 600, color: C.textPrimary, whiteSpace: 'nowrap' }}>
                      {r.mailbox}
                    </td>
                    <td style={{ ...ROW_RULE, padding: '10px 12px', fontSize: 13, color: C.textSecondary }}>{r.mailbox_state || '—'}</td>
                    <td style={{ ...ROW_RULE, padding: '10px 12px', fontSize: 13, color: C.textSecondary }}>{r.mailbox_purpose || '—'}</td>
                    <td style={{ ...ROW_RULE, padding: '10px 12px' }}><VerdictChip verdict={r.verdict} /></td>
                    <td style={{ ...ROW_RULE, padding: '10px 12px', fontSize: 13, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: C.textPrimary }}>
                      {r.inbound_last_30_days ?? 0}
                    </td>
                    <td style={{ ...ROW_RULE, padding: '10px 12px', fontSize: 13, color: C.textSecondary, whiteSpace: 'nowrap' }}>{when(r.last_inbound_at)}</td>
                    <td style={{ ...ROW_RULE, padding: '10px 12px', fontSize: 13, color: C.textSecondary, whiteSpace: 'nowrap' }}>{when(r.expires_at)}</td>
                    <td style={{ ...ROW_RULE, padding: '10px 12px', fontSize: 13, color: C.textSecondary, minWidth: 320 }}>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ margin: 0, fontSize: 12, color: C.textMuted, maxWidth: 760 }}>
            A mailbox reads <strong>Unverified</strong> when the renewal job has not confirmed its
            subscription against Microsoft in the last 12 hours. That job runs every 6 hours, so it
            means the job is not running or cannot reach Graph — not necessarily that mail has stopped.
            Check the <em>Inbound (30 days)</em> column: mail landing is the strongest evidence there is.
          </p>
        </>
      )}
    </div>
  )
}
