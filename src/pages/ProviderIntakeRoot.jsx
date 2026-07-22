// =============================================================================
// ProviderIntakeRoot — public (anonymous) Service Provider signup form.
// Mounted at /provider-signup in main.jsx. Link to it from the state marketing
// sites (NC first). Submits to the `service-provider-intake` edge function,
// which lands the application + an inactive Service Provider account for review.
// =============================================================================

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'

const TRADES = [
  { v: 'hvac', l: 'HVAC' },
  { v: 'electrical', l: 'Electrical' },
  { v: 'weatherization', l: 'Weatherization' },
  { v: 'plumbing', l: 'Plumbing' },
  { v: 'general_contractor', l: 'General Contractor' },
]
const STATES = ['NC', 'WI', 'MI', 'CO', 'IN']
const ENTITY_TYPES = ['LLC', 'Corporation', 'S-Corporation', 'Partnership', 'Sole Proprietor', 'Other']

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function ProviderIntakeRoot() {
  const [f, setF] = useState({
    company_legal_name: '', dba_name: '', service_provider_type: 'hvac', entity_type: '', home_state: 'NC',
    business_phone: '', business_email: '', website: '',
    address_street: '', address_city: '', address_state: '', address_zip: '',
    number_of_employees: '',
    contact_first_name: '', contact_last_name: '', contact_title: '', contact_email: '', contact_phone: '',
    license_number: '', license_type: '', license_state: '', license_expiration_date: '',
    gl_carrier: '', gl_policy_number: '', gl_expiration_date: '',
    wc_carrier: '', wc_policy_number: '', wc_expiration_date: '',
    zips: '', notes: '',
    company_url: '', // honeypot
  })
  const [w9File, setW9File] = useState(null)
  const [phase, setPhase] = useState('form') // form | submitting | done | error
  const [errMsg, setErrMsg] = useState('')
  const [appNumber, setAppNumber] = useState(null)

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!f.company_legal_name.trim()) { setErrMsg('Please enter your company legal name.'); return }
    if (!f.contact_email.trim() && !f.business_email.trim()) { setErrMsg('Please enter an email address.'); return }
    setErrMsg(''); setPhase('submitting')
    try {
      let w9 = null
      if (w9File) {
        if (w9File.size > 10 * 1024 * 1024) { setErrMsg('W-9 file must be under 10 MB.'); setPhase('form'); return }
        w9 = { file_name: w9File.name, mime_type: w9File.type || 'application/pdf', base64: await readFileAsBase64(w9File) }
      }
      const zip_codes = f.zips.split(/[^0-9]+/).map((z) => z.trim()).filter((z) => z.length >= 5)
      const { zips, ...rest } = f
      const { data, error } = await supabase.functions.invoke('service-provider-intake', {
        body: { ...rest, zip_codes, w9 },
      })
      if (error) throw new Error(error.message || 'Submission failed.')
      if (data && data.ok === false) throw new Error(data.error || 'Submission failed.')
      setAppNumber(data?.application_number || null)
      setPhase('done')
    } catch (e2) {
      setErrMsg(e2?.message || 'Something went wrong. Please try again.')
      setPhase('form')
    }
  }

  // ── styles ──
  const label = { fontSize: 12, fontWeight: 600, color: C.textSecondary, display: 'block', marginBottom: 5 }
  const input = { width: '100%', padding: '10px 12px', border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 14, fontFamily: FONT, boxSizing: 'border-box', background: '#fff', color: C.textPrimary }
  const Field = ({ k, l, type = 'text', required, placeholder, half }) => (
    <div style={{ flex: half ? '1 1 220px' : '1 1 100%' }}>
      <label style={label}>{l}{required ? <span style={{ color: C.emeraldMid }}> *</span> : null}</label>
      <input style={input} type={type} value={f[k]} onChange={set(k)} placeholder={placeholder} required={required} />
    </div>
  )
  const Section = ({ title, sub, children }) => (
    <div style={{ marginTop: 26 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>{sub}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12 }}>{children}</div>
    </div>
  )

  if (phase === 'done') {
    return (
      <div style={{ minHeight: '100vh', background: C.page, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, maxWidth: 520, textAlign: 'center', boxShadow: '0 4px 20px rgba(13,26,46,0.06)' }}>
          <div style={{ width: 52, height: 52, borderRadius: 999, background: '#e8f8f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.emeraldMid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: 0 }}>Application received</h1>
          <p style={{ fontSize: 14, color: C.textSecondary, marginTop: 10, lineHeight: 1.5 }}>
            Thank you for applying to become an Energy Efficiency Services provider. Our team will review your
            application and reach out with next steps.
          </p>
          {appNumber && <div style={{ marginTop: 16, fontSize: 13, color: C.textMuted }}>Reference: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.textPrimary }}>{appNumber}</span></div>}
        </div>
      </div>
    )
  }

  const busy = phase === 'submitting'
  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: FONT }}>
      <div style={{ background: C.sidebar, padding: '20px 24px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.emerald} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Energy Efficiency Services</div>
            <div style={{ color: C.navInactive, fontSize: 12 }}>Service Provider Application</div>
          </div>
        </div>
      </div>

      <form onSubmit={submit} style={{ maxWidth: 780, margin: '0 auto', padding: '28px 24px 60px' }}>
        <p style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1.55 }}>
          Interested in performing HVAC, electrical, weatherization, plumbing, or general contracting work for
          Energy Efficiency Services? Tell us about your company below. Fields marked <span style={{ color: C.emeraldMid }}>*</span> are required.
        </p>

        {errMsg && <div style={{ marginTop: 16, background: '#e8f1fb', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{errMsg}</div>}

        <Section title="Company">
          <Field k="company_legal_name" l="Legal business name" required half />
          <Field k="dba_name" l="DBA / trade name" half />
          <div style={{ flex: '1 1 220px' }}>
            <label style={label}>Trade / service type<span style={{ color: C.emeraldMid }}> *</span></label>
            <select style={input} value={f.service_provider_type} onChange={set('service_provider_type')}>
              {TRADES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label style={label}>Primary state of operation<span style={{ color: C.emeraldMid }}> *</span></label>
            <select style={input} value={f.home_state} onChange={set('home_state')}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label style={label}>Business structure</label>
            <select style={input} value={f.entity_type} onChange={set('entity_type')}>
              <option value="">Select…</option>
              {ENTITY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <Field k="number_of_employees" l="Number of employees" type="number" half />
          <Field k="business_phone" l="Business phone" half />
          <Field k="business_email" l="Business email" type="email" half />
          <Field k="website" l="Website" half />
          <Field k="address_street" l="Street address" />
          <Field k="address_city" l="City" half />
          <Field k="address_state" l="State" half />
          <Field k="address_zip" l="ZIP" half />
        </Section>

        <Section title="Primary contact">
          <Field k="contact_first_name" l="First name" half />
          <Field k="contact_last_name" l="Last name" half />
          <Field k="contact_title" l="Title" half />
          <Field k="contact_email" l="Email" type="email" half />
          <Field k="contact_phone" l="Phone" half />
        </Section>

        <Section title="License">
          <Field k="license_number" l="License number" half />
          <Field k="license_type" l="License type" half />
          <Field k="license_state" l="License state" half />
          <Field k="license_expiration_date" l="License expiration" type="date" half />
        </Section>

        <Section title="Insurance">
          <Field k="gl_carrier" l="General liability carrier" half />
          <Field k="gl_policy_number" l="GL policy number" half />
          <Field k="gl_expiration_date" l="GL expiration" type="date" half />
          <Field k="wc_carrier" l="Workers' comp carrier" half />
          <Field k="wc_policy_number" l="WC policy number" half />
          <Field k="wc_expiration_date" l="WC expiration" type="date" half />
        </Section>

        <Section title="Areas of operation" sub="ZIP codes you serve, separated by commas or spaces.">
          <textarea value={f.zips} onChange={set('zips')} rows={2} placeholder="27601, 27603, 27605" style={{ ...input, resize: 'vertical' }} />
        </Section>

        <Section title="W-9" sub="Upload your completed W-9 (PDF or image, max 10 MB). Optional — you can also provide it later.">
          <input type="file" accept=".pdf,image/*" onChange={(e) => setW9File(e.target.files?.[0] || null)} style={{ fontSize: 13, color: C.textSecondary }} />
        </Section>

        <Section title="Anything else?">
          <textarea value={f.notes} onChange={set('notes')} rows={3} placeholder="Certifications, service areas, notes…" style={{ ...input, resize: 'vertical' }} />
        </Section>

        {/* honeypot — hidden from users, catches bots */}
        <input type="text" value={f.company_url} onChange={set('company_url')} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />

        <button type="submit" disabled={busy} style={{ marginTop: 30, padding: '13px 28px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Submitting…' : 'Submit application'}
        </button>
      </form>
    </div>
  )
}
