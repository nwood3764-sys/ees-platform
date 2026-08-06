// HomesIntakePanel.jsx — staff intake for pre-qualified NC single-family
// homeowners. Paste the inquiry info; on submit it creates the CRM chain
// (Account / Contact / Property[single-family] / Building[single-family] /
// Opportunity[NC SF HOMES audit] / Project) and emails the homeowner a
// personalized "Schedule Now" link from the NC mailbox. The success panel
// shows the created opportunity and the exact link that was sent.

import { useState, useEffect } from 'react'
import { C } from '../../data/constants'
import { useToast } from '../Toast'
import { submitHomesIntake, fetchAmiTierOptions } from '../../data/homesIntakeService'

const BLANK = {
  firstName: '', lastName: '', email: '', phone: '',
  street: '', city: '', state: 'NC', zip: '', amiTier: '', notes: '',
}

export default function HomesIntakePanel({ onNavigateToRecord }) {
  const toast = useToast()
  const [form, setForm] = useState(BLANK)
  const [amiOptions, setAmiOptions] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchAmiTierOptions()
      .then(opts => { if (!cancelled) setAmiOptions(opts) })
      .catch(() => { /* dropdown just stays empty; not fatal */ })
    return () => { cancelled = true }
  }, [])

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setResult(null)
    try {
      const res = await submitHomesIntake(form)
      setResult(res)
      const emailedOk = res?.email && (res.email.status === 'ok' || res.email.http_status === 200)
      toast?.success?.(
        emailedOk
          ? `Intake created (${res.opportunity_record_number}) — welcome email sent.`
          : `Intake created (${res.opportunity_record_number}). Email may not have sent — check the link below.`
      )
      setForm(BLANK)
    } catch (err) {
      toast?.error?.(err.message || 'Intake failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', background: C.page }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>New HOMES Intake</div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
            Enter a pre-qualified North Carolina single-family homeowner. We'll create the account,
            property, and opportunity, then email them a personalized link to schedule their assessment.
          </div>
        </div>

        <form onSubmit={handleSubmit}
              style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24 }}>
          <SectionLabel>Homeowner</SectionLabel>
          <Row>
            <Field label="First name" required>
              <input style={inputStyle} value={form.firstName} onChange={e => set('firstName', e.target.value)} required />
            </Field>
            <Field label="Last name" required>
              <input style={inputStyle} value={form.lastName} onChange={e => set('lastName', e.target.value)} required />
            </Field>
          </Row>
          <Row>
            <Field label="Email" required>
              <input type="email" style={inputStyle} value={form.email} onChange={e => set('email', e.target.value)} required />
            </Field>
            <Field label="Phone" required>
              <input style={inputStyle} value={form.phone} onChange={e => set('phone', e.target.value)}
                     placeholder="(704) 555-0123" required />
            </Field>
          </Row>

          <SectionLabel style={{ marginTop: 20 }}>Property</SectionLabel>
          <Row>
            <Field label="Street address" required span={2}>
              <input style={inputStyle} value={form.street} onChange={e => set('street', e.target.value)} required />
            </Field>
          </Row>
          <Row>
            <Field label="City">
              <input style={inputStyle} value={form.city} onChange={e => set('city', e.target.value)} />
            </Field>
            <Field label="State">
              <input style={inputStyle} value={form.state} onChange={e => set('state', e.target.value.toUpperCase())}
                     maxLength={2} />
            </Field>
            <Field label="ZIP" required>
              <input style={inputStyle} value={form.zip} onChange={e => set('zip', e.target.value)}
                     maxLength={5} required />
            </Field>
          </Row>

          <SectionLabel style={{ marginTop: 20 }}>Program</SectionLabel>
          <Row>
            <Field label="AMI tier" hint="Drives the HOMES price book — set now or during review.">
              <select style={inputStyle} value={form.amiTier} onChange={e => set('amiTier', e.target.value)}>
                <option value="">— Not yet determined —</option>
                {amiOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Notes" span={2}>
              <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }}
                        value={form.notes} onChange={e => set('notes', e.target.value)}
                        placeholder="Referral source, eligibility notes, anything the auditor should know…" />
            </Field>
          </Row>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="submit" disabled={submitting}
                    style={{
                      background: submitting ? C.textMuted : C.emerald,
                      color: '#07111f', fontWeight: 600, fontSize: 14,
                      border: 'none', borderRadius: 8, padding: '11px 24px',
                      cursor: submitting ? 'default' : 'pointer',
                    }}>
              {submitting ? 'Creating…' : 'Create & send scheduling link'}
            </button>
          </div>
        </form>

        {result && <ResultCard result={result} onNavigateToRecord={onNavigateToRecord} />}
      </div>
    </div>
  )
}

function ResultCard({ result, onNavigateToRecord }) {
  const toast = useToast()
  const emailedOk = result?.email && (result.email.status === 'ok' || result.email.http_status === 200)
  const url = result?.schedule_url || ''

  function copyLink() {
    if (!url) return
    navigator.clipboard?.writeText(url)
      .then(() => toast?.success?.('Scheduling link copied.'))
      .catch(() => { /* clipboard blocked; the link is visible to copy manually */ })
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, marginTop: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
        Intake created — {result.opportunity_record_number}
      </div>
      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 14 }}>
        {emailedOk
          ? 'The welcome email with a personalized scheduling link was sent from the NC mailbox and logged to the homeowner’s Communications.'
          : 'Records were created, but the welcome email may not have sent. You can copy the scheduling link below and send it manually.'}
      </div>

      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: C.textMuted, marginBottom: 6 }}>
        Personalized scheduling link
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input readOnly value={url} style={{ ...inputStyle, flex: 1, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
        <button onClick={copyLink}
                style={{ background: C.page, border: `1px solid ${C.borderDark}`, borderRadius: 8,
                         padding: '0 16px', fontSize: 13, fontWeight: 600, color: C.textPrimary, cursor: 'pointer' }}>
          Copy
        </button>
      </div>

      {onNavigateToRecord && result.opportunity_id && (
        <button onClick={() => onNavigateToRecord('opportunities', result.opportunity_id)}
                style={{ marginTop: 14, background: 'transparent', border: 'none', color: C.emeraldMid,
                         fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          Open opportunity →
        </button>
      )}
    </div>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 11px', fontSize: 14, color: C.textPrimary,
  background: '#fff', border: `1px solid ${C.borderDark}`, borderRadius: 8, outline: 'none',
}

function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em',
                  color: C.textMuted, fontWeight: 600, marginBottom: 10, ...style }}>
      {children}
    </div>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>{children}</div>
}

function Field({ label, children, required, hint, span = 1 }) {
  return (
    <div style={{ flex: span === 2 ? '1 1 100%' : '1 1 160px', minWidth: 160 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 5 }}>
        {label}{required && <span style={{ color: C.sky, marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}
