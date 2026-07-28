// =============================================================================
// ProviderIntakeRoot — public (anonymous) Service Provider signup.
// Mounted at /provider-signup. A guided multi-step funnel (not a wall of
// fields): trade → company → contact → credentials → coverage → review.
// Submits to the `service-provider-intake` edge function, which lands the
// application + an inactive Service Provider account for review.
// =============================================================================

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { blockNegativeKeys } from '../lib/numberInput'

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
const MONO = 'JetBrains Mono, ui-monospace, monospace'

const TRADES = [
  { v: 'hvac', l: 'HVAC', d: 'Heating, cooling, heat pumps', icon: 'M9.5 2a2.5 2.5 0 0 1 0 5H2 M12.5 21a2.5 2.5 0 0 0 0-5H2 M17 4.5a2.5 2.5 0 1 1 3 4.5H2' },
  { v: 'electrical', l: 'Electrical', d: 'Panels, wiring, service', icon: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z' },
  { v: 'weatherization', l: 'Weatherization', d: 'Insulation, air sealing', icon: 'M3 12l9-9 9 9 M5 10v10h14V10 M9 20v-6h6v6' },
  { v: 'plumbing', l: 'Plumbing', d: 'Water heaters, piping', icon: 'M12 22a7 7 0 0 0 7-7c0-3-3-7-7-11-4 4-7 8-7 11a7 7 0 0 0 7 7z' },
  { v: 'general_contractor', l: 'General Contractor', d: 'Multi-trade / turnkey', icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' },
]
const STATES = ['NC', 'WI', 'MI', 'CO', 'IN']
const ENTITY_TYPES = ['LLC', 'Corporation', 'S-Corporation', 'Partnership', 'Sole Proprietor', 'Other']
const STEPS = ['Trade', 'Company', 'Contact', 'Credentials', 'Coverage', 'Review']

// ── module-scope styles + helpers (keeping them out of the component keeps
//    inputs from remounting and losing focus on each keystroke) ──────────────
const labelStyle = { fontSize: 12.5, fontWeight: 600, color: C.textSecondary, display: 'block', marginBottom: 6 }
const inputStyle = { width: '100%', padding: '11px 13px', border: `1px solid ${C.borderDark}`, borderRadius: 9, fontSize: 14.5, fontFamily: FONT, boxSizing: 'border-box', background: '#fff', color: C.textPrimary, outline: 'none' }

function Field({ label, value, onChange, type = 'text', required, placeholder, half, optional }) {
  return (
    <div style={{ flex: half ? '1 1 220px' : '1 1 100%', minWidth: 0 }}>
      <label style={labelStyle}>
        {label}
        {required ? <span style={{ color: C.emeraldMid }}> *</span> : null}
        {optional ? <span style={{ color: C.textMuted, fontWeight: 400 }}> · optional</span> : null}
      </label>
      <input className="spi-input" style={inputStyle} type={type} value={value} onChange={onChange} placeholder={placeholder}
        min={type === 'number' ? 0 : undefined} onKeyDown={type === 'number' ? blockNegativeKeys() : undefined} />
    </div>
  )
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function Progress({ step }) {
  const pct = Math.round((step / (STEPS.length - 1)) * 100)
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.emeraldMid, textTransform: 'uppercase', letterSpacing: 0.5 }}>Step {step + 1} of {STEPS.length}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textMuted }}>{STEPS[step]}</span>
      </div>
      <div style={{ height: 6, background: C.border, borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: C.emerald, borderRadius: 999, transition: 'width 300ms ease' }} />
      </div>
    </div>
  )
}

export default function ProviderIntakeRoot() {
  const [step, setStep] = useState(0)
  const [f, setF] = useState({
    company_legal_name: '', dba_name: '', service_provider_type: '', entity_type: '', home_state: 'NC',
    business_phone: '', business_email: '', website: '',
    address_street: '', address_city: '', address_state: '', address_zip: '', number_of_employees: '',
    contact_first_name: '', contact_last_name: '', contact_title: '', contact_email: '', contact_phone: '',
    license_number: '', license_type: '', license_state: '', license_expiration_date: '',
    gl_carrier: '', gl_policy_number: '', gl_expiration_date: '',
    wc_carrier: '', wc_policy_number: '', wc_expiration_date: '',
    zips: '', notes: '', company_url: '', // company_url = honeypot
  })
  const [w9File, setW9File] = useState(null)
  const [phase, setPhase] = useState('form') // form | submitting | done
  const [errMsg, setErrMsg] = useState('')
  const [appNumber, setAppNumber] = useState(null)

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  const stepValid = () => {
    if (step === 0) return !!f.service_provider_type
    if (step === 1) return f.company_legal_name.trim().length > 0
    if (step === 2) return f.contact_first_name.trim().length > 0 && (f.contact_email.trim() || f.business_email.trim()).length > 0
    return true
  }
  const stepError = () => {
    if (step === 0) return 'Pick the type of work you do to continue.'
    if (step === 1) return 'Please enter your legal business name.'
    if (step === 2) return 'Please enter a contact first name and an email address.'
    return ''
  }

  const next = () => {
    if (!stepValid()) { setErrMsg(stepError()); return }
    setErrMsg(''); setStep((s) => Math.min(s + 1, STEPS.length - 1))
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }
  const back = () => { setErrMsg(''); setStep((s) => Math.max(s - 1, 0)) }

  const submit = async () => {
    setErrMsg(''); setPhase('submitting')
    try {
      let w9 = null
      if (w9File) {
        if (w9File.size > 10 * 1024 * 1024) { setErrMsg('W-9 file must be under 10 MB.'); setPhase('form'); return }
        w9 = { file_name: w9File.name, mime_type: w9File.type || 'application/pdf', base64: await readFileAsBase64(w9File) }
      }
      const zip_codes = f.zips.split(/[^0-9]+/).map((z) => z.trim()).filter((z) => z.length >= 5)
      const { zips, ...rest } = f
      const { data, error } = await supabase.functions.invoke('service-provider-intake', { body: { ...rest, zip_codes, w9 } })
      if (error) throw new Error(error.message || 'Submission failed.')
      if (data && data.ok === false) throw new Error(data.error || 'Submission failed.')
      setAppNumber(data?.application_number || null)
      setPhase('done')
    } catch (e2) {
      setErrMsg(e2?.message || 'Something went wrong. Please try again.')
      setPhase('form')
    }
  }

  const css = `
    .spi-input:focus, .spi-area:focus { border-color:${C.emerald}; box-shadow:0 0 0 3px rgba(62,207,142,0.15); }
    .spi-tile { transition: all 160ms ease; }
    .spi-tile:hover { border-color:${C.emerald}; transform: translateY(-1px); }
    .spi-btn { transition: all 150ms ease; }
    .spi-btn:hover { filter: brightness(0.97); }
    .spi-step { animation: spiUp 260ms ease; }
    @keyframes spiUp { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
  `

  if (phase === 'done') {
    return (
      <div style={{ minHeight: '100vh', background: C.page, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="spi-step" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 44, maxWidth: 520, textAlign: 'center', boxShadow: '0 8px 30px rgba(13,26,46,0.08)' }}>
          <div style={{ width: 58, height: 58, borderRadius: 999, background: '#e8f8f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.emeraldMid} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.textPrimary, margin: 0 }}>You're all set</h1>
          <p style={{ fontSize: 14.5, color: C.textSecondary, marginTop: 12, lineHeight: 1.55 }}>
            Thanks for applying to work with Energy Efficiency Services. Our team will review your application and reach out with next steps.
          </p>
          {appNumber && <div style={{ marginTop: 18, fontSize: 13, color: C.textMuted }}>Reference: <span style={{ fontFamily: MONO, color: C.textPrimary }}>{appNumber}</span></div>}
        </div>
      </div>
    )
  }

  const busy = phase === 'submitting'
  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: FONT }}>
      <style>{css}</style>
      <div style={{ background: C.sidebar, padding: '18px 24px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.emerald} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Energy Efficiency Services</div>
            <div style={{ color: C.navInactive, fontSize: 12 }}>Become a Service Provider</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '30px 20px 70px' }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '28px 28px 22px', boxShadow: '0 4px 20px rgba(13,26,46,0.05)' }}>
          <Progress step={step} />

          {errMsg && <div style={{ marginBottom: 18, background: '#e8f1fb', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 9, padding: '10px 14px', fontSize: 13 }}>{errMsg}</div>}

          <div key={step} className="spi-step">
            {step === 0 && (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: '0 0 4px' }}>What kind of work do you do?</h2>
                <p style={{ fontSize: 14, color: C.textSecondary, margin: '0 0 18px' }}>Pick the trade that best fits your company.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  {TRADES.map((t) => {
                    const sel = f.service_provider_type === t.v
                    return (
                      <button key={t.v} type="button" className="spi-tile" onClick={() => { setF((s) => ({ ...s, service_provider_type: t.v })); setErrMsg('') }}
                        style={{ textAlign: 'left', cursor: 'pointer', padding: 16, borderRadius: 11, background: sel ? '#eafaf3' : '#fff', border: `1.5px solid ${sel ? C.emerald : C.border}`, display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span style={{ width: 40, height: 40, borderRadius: 9, background: sel ? C.emerald : C.page, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={sel ? '#06231a' : C.textSecondary} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
                        </span>
                        <span>
                          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: C.textPrimary }}>{t.l}</span>
                          <span style={{ display: 'block', fontSize: 12, color: C.textMuted, marginTop: 1 }}>{t.d}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div style={{ marginTop: 20, maxWidth: 260 }}>
                  <label style={labelStyle}>Primary state you work in</label>
                  <select className="spi-input" style={inputStyle} value={f.home_state} onChange={set('home_state')}>
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: '0 0 4px' }}>About your company</h2>
                <p style={{ fontSize: 14, color: C.textSecondary, margin: '0 0 18px' }}>Just the basics — you can fill in the rest later.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  <Field label="Legal business name" value={f.company_legal_name} onChange={set('company_legal_name')} required />
                  <Field label="DBA / trade name" value={f.dba_name} onChange={set('dba_name')} half optional />
                  <div style={{ flex: '1 1 220px' }}>
                    <label style={labelStyle}>Business structure<span style={{ color: C.textMuted, fontWeight: 400 }}> · optional</span></label>
                    <select className="spi-input" style={inputStyle} value={f.entity_type} onChange={set('entity_type')}>
                      <option value="">Select…</option>
                      {ENTITY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <Field label="Business phone" value={f.business_phone} onChange={set('business_phone')} half optional />
                  <Field label="Business email" value={f.business_email} onChange={set('business_email')} type="email" half optional />
                  <Field label="Website" value={f.website} onChange={set('website')} half optional />
                  <Field label="Number of employees" value={f.number_of_employees} onChange={set('number_of_employees')} type="number" half optional />
                  <Field label="Street address" value={f.address_street} onChange={set('address_street')} optional />
                  <Field label="City" value={f.address_city} onChange={set('address_city')} half optional />
                  <Field label="State" value={f.address_state} onChange={set('address_state')} half optional />
                  <Field label="ZIP" value={f.address_zip} onChange={set('address_zip')} half optional />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: '0 0 4px' }}>Who should we contact?</h2>
                <p style={{ fontSize: 14, color: C.textSecondary, margin: '0 0 18px' }}>This is who we'll reach out to about the application and the portal invite.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  <Field label="First name" value={f.contact_first_name} onChange={set('contact_first_name')} required half />
                  <Field label="Last name" value={f.contact_last_name} onChange={set('contact_last_name')} half optional />
                  <Field label="Title" value={f.contact_title} onChange={set('contact_title')} half optional />
                  <Field label="Email" value={f.contact_email} onChange={set('contact_email')} type="email" required half />
                  <Field label="Phone" value={f.contact_phone} onChange={set('contact_phone')} half optional />
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: '0 0 4px' }}>License &amp; insurance</h2>
                <p style={{ fontSize: 14, color: C.textSecondary, margin: '0 0 18px' }}>Share what you have on hand — none of this is required to apply.</p>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>License</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  <Field label="License number" value={f.license_number} onChange={set('license_number')} half optional />
                  <Field label="License type" value={f.license_type} onChange={set('license_type')} half optional />
                  <Field label="License state" value={f.license_state} onChange={set('license_state')} half optional />
                  <Field label="License expiration" value={f.license_expiration_date} onChange={set('license_expiration_date')} type="date" half optional />
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, margin: '22px 0 10px' }}>Insurance</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  <Field label="General liability carrier" value={f.gl_carrier} onChange={set('gl_carrier')} half optional />
                  <Field label="GL policy number" value={f.gl_policy_number} onChange={set('gl_policy_number')} half optional />
                  <Field label="GL expiration" value={f.gl_expiration_date} onChange={set('gl_expiration_date')} type="date" half optional />
                  <Field label="Workers' comp carrier" value={f.wc_carrier} onChange={set('wc_carrier')} half optional />
                  <Field label="WC policy number" value={f.wc_policy_number} onChange={set('wc_policy_number')} half optional />
                  <Field label="WC expiration" value={f.wc_expiration_date} onChange={set('wc_expiration_date')} type="date" half optional />
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: '0 0 4px' }}>Coverage &amp; documents</h2>
                <p style={{ fontSize: 14, color: C.textSecondary, margin: '0 0 18px' }}>Where you work, and your W-9 if you have it ready.</p>
                <label style={labelStyle}>ZIP codes you serve<span style={{ color: C.textMuted, fontWeight: 400 }}> · separate with commas or spaces</span></label>
                <textarea className="spi-area" value={f.zips} onChange={set('zips')} rows={2} placeholder="27601, 27603, 27605" style={{ ...inputStyle, resize: 'vertical' }} />
                <div style={{ marginTop: 20 }}>
                  <label style={labelStyle}>W-9 document<span style={{ color: C.textMuted, fontWeight: 400 }}> · PDF or image, up to 10 MB — optional</span></label>
                  <label className="spi-tile" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, border: `1.5px dashed ${w9File ? C.emerald : C.borderDark}`, borderRadius: 11, cursor: 'pointer', background: w9File ? '#eafaf3' : '#fff' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={w9File ? C.emeraldMid : C.textMuted} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12" /></svg>
                    <span style={{ fontSize: 13.5, color: w9File ? C.textPrimary : C.textSecondary }}>{w9File ? w9File.name : 'Click to upload your W-9'}</span>
                    <input type="file" accept=".pdf,image/*" onChange={(e) => setW9File(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                  </label>
                </div>
                <div style={{ marginTop: 20 }}>
                  <label style={labelStyle}>Anything else?<span style={{ color: C.textMuted, fontWeight: 400 }}> · optional</span></label>
                  <textarea className="spi-area" value={f.notes} onChange={set('notes')} rows={3} placeholder="Certifications, crews, notes…" style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
              </>
            )}

            {step === 5 && (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: '0 0 4px' }}>Review &amp; submit</h2>
                <p style={{ fontSize: 14, color: C.textSecondary, margin: '0 0 18px' }}>Quick look before you send it over.</p>
                {[
                  ['Trade', TRADES.find((t) => t.v === f.service_provider_type)?.l],
                  ['State', f.home_state],
                  ['Company', f.company_legal_name],
                  ['Contact', [f.contact_first_name, f.contact_last_name].filter(Boolean).join(' ')],
                  ['Email', f.contact_email || f.business_email],
                  ['License', f.license_number || '—'],
                  ['ZIP areas', f.zips ? f.zips.split(/[^0-9]+/).filter((z) => z.length >= 5).length + ' ZIP codes' : '—'],
                  ['W-9', w9File ? w9File.name : 'Not attached'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 14 }}>
                    <span style={{ color: C.textMuted, minWidth: 110 }}>{k}</span>
                    <span style={{ color: C.textPrimary, fontWeight: 500 }}>{v || '—'}</span>
                  </div>
                ))}
                <p style={{ fontSize: 12.5, color: C.textMuted, marginTop: 16, lineHeight: 1.5 }}>By submitting you're applying to become an Energy Efficiency Services provider. We'll review and follow up — nothing is finalized until our team approves your application.</p>
              </>
            )}
          </div>

          {/* honeypot */}
          <input type="text" value={f.company_url} onChange={set('company_url')} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, gap: 12 }}>
            {step > 0 ? (
              <button type="button" className="spi-btn" onClick={back} disabled={busy} style={{ padding: '11px 20px', background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}`, borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Back</button>
            ) : <span />}
            {step < STEPS.length - 1 ? (
              <button type="button" className="spi-btn" onClick={next} style={{ padding: '11px 26px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 9, fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>Continue</button>
            ) : (
              <button type="button" className="spi-btn" onClick={submit} disabled={busy} style={{ padding: '11px 26px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 9, fontSize: 14.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>{busy ? 'Submitting…' : 'Submit application'}</button>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: C.textMuted, marginTop: 16 }}>Takes about two minutes · Questions? Reach out to your EES contact.</p>
      </div>
    </div>
  )
}
