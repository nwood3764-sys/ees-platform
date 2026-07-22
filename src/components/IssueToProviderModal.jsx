// IssueToProviderModal — staff action on a Work Order. Picks a service provider
// and calls generate_service_provider_proposal(), which prices the work order's
// installed measures via the state/per-provider payout book and issues the
// proposal to the provider (they Accept/Decline it in the provider portal).

import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { useToast } from './Toast'
import { fetchActiveServiceProviders, issueWorkOrderToProvider } from '../data/serviceProviderService'

export default function IssueToProviderModal({ workOrderId, onClose, onIssued }) {
  const toast = useToast()
  const [providers, setProviders] = useState(null)
  const [providerId, setProviderId] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchActiveServiceProviders()
      .then((list) => { if (!cancelled) { setProviders(list); if (list.length === 1) setProviderId(list[0].id) } })
      .catch((e) => { if (!cancelled) { setErr(e?.message || 'Failed to load providers.'); setProviders([]) } })
    return () => { cancelled = true }
  }, [])

  async function submit() {
    if (!providerId) { setErr('Select a service provider.'); return }
    setSubmitting(true); setErr('')
    try {
      const r = await issueWorkOrderToProvider(providerId, workOrderId, notes.trim() || null)
      toast?.success?.(`Proposal ${r?.record_number || ''} issued to the provider.`.trim())
      onIssued?.(r); onClose?.()
    } catch (e) {
      setErr(e?.message || 'Could not issue the proposal.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>Issue to Provider</div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>Generate a priced proposal from this work order's installed measures and issue it to a service provider.</div>
          </div>
          <button style={closeButton} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={bodyStyle}>
          {err && <div style={errorBox}>{err}</div>}
          <label style={labelStyle}>Service provider</label>
          {providers === null ? (
            <div style={readStyle}>Loading providers…</div>
          ) : providers.length === 0 ? (
            <div style={noteBox}>No active service providers yet. Approve a provider application first (Service Providers module).</div>
          ) : (
            <select style={inputStyle} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Select a provider…</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.account_name}
                  {p.trade?.picklist_label ? ` — ${p.trade.picklist_label}` : ''}
                  {p.account_service_provider_home_state ? ` (${p.account_service_provider_home_state})` : ''}
                </option>
              ))}
            </select>
          )}

          <div style={{ height: 12 }} />
          <label style={labelStyle}>Notes (optional)</label>
          <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the provider should know…" />

          <div style={{ ...noteBox, marginTop: 12 }}>Payout amounts come from the state / provider payout price book. Measures without a configured rate are issued at $0 for you to price before the provider accepts.</div>
        </div>

        <div style={footerStyle}>
          <button style={btnSecondary} onClick={onClose} disabled={submitting}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: (submitting || !providerId) ? 0.6 : 1, cursor: (submitting || !providerId) ? 'default' : 'pointer' }} onClick={submit} disabled={submitting || !providerId}>
            {submitting ? 'Issuing…' : 'Issue proposal'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const card = { background: C.card, borderRadius: 8, width: '92%', maxWidth: 520, boxShadow: '0 20px 50px -12px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }
const headerStyle = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${C.border}`, gap: 8 }
const closeButton = { background: 'transparent', border: 'none', padding: 4, cursor: 'pointer', color: C.textSecondary, borderRadius: 4, fontSize: 15 }
const bodyStyle = { padding: 16, overflow: 'auto' }
const footerStyle = { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '12px 16px', borderTop: `1px solid ${C.border}` }
const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }
const readStyle = { fontSize: 13, color: C.textPrimary, lineHeight: 1.45 }
const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, color: C.textPrimary, background: '#fff', border: `1px solid ${C.borderDark}`, borderRadius: 6, boxSizing: 'border-box', fontFamily: 'inherit' }
const errorBox = { padding: '8px 10px', background: '#e8f1fb', color: '#1a5a8a', border: '1px solid #bcd9f2', borderRadius: 6, fontSize: 12.5, marginBottom: 10 }
const noteBox = { padding: '8px 10px', background: '#f0f7ff', color: '#1e3a5f', border: '1px solid #d3e4f5', borderRadius: 6, fontSize: 12, lineHeight: 1.5 }
const btnSecondary = { padding: '8px 15px', fontSize: 12.5, fontWeight: 500, background: '#fff', color: C.textPrimary, border: `1px solid ${C.borderDark}`, borderRadius: 6, cursor: 'pointer' }
const btnPrimary = { padding: '8px 15px', fontSize: 12.5, fontWeight: 600, background: C.emeraldMid, color: 'white', border: `1px solid ${C.emeraldMid}`, borderRadius: 6 }
