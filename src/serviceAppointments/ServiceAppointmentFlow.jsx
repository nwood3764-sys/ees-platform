// ─── ServiceAppointmentFlow.jsx ─────────────────────────────────────────────────────────
// 4-step customer scheduling flow for a specific work_type slug.
//
//   intake  →  slots  →  confirm  →  success
//
// State machine driven by useState; no external router. Each step renders
// inside its own card. Edge function errors (out_of_territory, slot_taken,
// no_availability, validation errors) surface as banners in the relevant step.
//
// Mobile-first layout: cards stack vertically, form fields are 16px (no iOS
// zoom on focus), tap targets are ≥ 44px tall.

import { useState, useMemo } from 'react'
import { computeAvailability, createServiceAppointment, requestDispatcherFollowup } from './serviceAppointmentService'
import {
  C, card, label, input, inputFocus, buttonPrimary, buttonSecondary,
  errorBanner, RADIUS, formatChicagoSlot, formatChicagoTimeRange,
} from './styles'

// ─── slug → display metadata + intake config ────────────────────────────────
// Mirrors WT-00072..00075. The `intake` array lists per-slug extra form fields
// beyond the base contact + address. When more work_types ship, this gets
// driven by the work_type record itself (intake_fields_json).

const SLUG_META = {
  'single-family-assessment': {
    title:    'Single-Family Energy Assessment',
    durationLabel: '90 minutes',
    intake:   [],
  },
  'townhome-assessment': {
    title:    'Townhome Energy Assessment',
    durationLabel: '90 minutes',
    intake:   [],
  },
  'multifamily-energy-assessment': {
    title:    'Multifamily Energy Assessment',
    durationLabel: '60 minutes per building',
    intake: [{
      name:        'number_of_buildings',
      label:       'How many buildings on the property?',
      type:        'number',
      placeholder: 'e.g. 3',
      min:         1,
      max:         50,
    }],
  },
  'multifamily-diagnostic-assessment': {
    title:    'Multifamily Diagnostic Assessment',
    durationLabel: '120 minutes per building',
    intake: [{
      name:        'number_of_buildings',
      label:       'How many buildings on the property?',
      type:        'number',
      placeholder: 'e.g. 3',
      min:         1,
      max:         50,
    }],
  },
}

const US_STATES = ['WI','NC','CO','MI','IN','IL','MN','IA']

// ─── ServiceAppointmentFlow (main) ─────────────────────────────────────────────────────

export default function ServiceAppointmentFlow({ slug }) {
  const meta = SLUG_META[slug]

  const [step,           setStep]           = useState('intake') // intake|loading|slots|confirming|scheduling|success
  const [customerInfo,   setCustomerInfo]   = useState({
    firstName: '', lastName: '', phone: '', email: '',
    street: '', city: '', state: 'WI', zip: '',
    intake: {},
  })
  const [availability,   setAvailability]   = useState(null)
  const [selectedSlot,   setSelectedSlot]   = useState(null)
  const [appointmentResult,  setAppointmentResult]  = useState(null)
  const [error,          setError]          = useState(null)

  if (!meta) {
    return (
      <div style={card}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          Service not found
        </h1>
        <p style={{ color: C.textSecondary, marginBottom: 16 }}>
          We couldn't find a scheduling page for "{slug}". You may have followed
          a stale link — try our service menu.
        </p>
        <a href="/sa" style={{ color: C.emeraldMid, fontWeight: 600 }}>
          ← Back to all services
        </a>
      </div>
    )
  }

  // Fire-and-await capture for the three customer-dead-end branches. We
  // await it (rather than fire-and-forget) so the user message can reflect
  // success/failure of the lead capture — but on capture failure we still
  // show the "we'll reach out" banner because the customer can't act on
  // the error and a dispatcher will see the gap from the missing log
  // entry on their side. Most importantly, never block the UI on a
  // capture error: the customer's day shouldn't be ruined by our backend.
  async function captureDispatcherFollowup(info, slugVal, reason) {
    try {
      await requestDispatcherFollowup({
        customer_first_name: info.firstName,
        customer_last_name:  info.lastName,
        phone: info.phone,
        email: info.email,
        address: {
          street: info.street,
          city:   info.city,
          state:  info.state,
          zip:    info.zip,
        },
        work_type_slug: slugVal,
        reason,
      })
    } catch (e) {
      // Swallow — the banner is shown either way. Log to console for
      // post-mortem debugging.
      console.error('requestDispatcherFollowup failed', e)
    }
  }

  async function handleIntakeSubmit(info) {
    setCustomerInfo(info)
    setError(null)
    setStep('loading')
    try {
      const result = await computeAvailability({
        slug,
        address: { street: info.street, city: info.city, state: info.state, zip: info.zip },
        intake:  info.intake,
        days:    14,
      })
      if (result.status === 'out_of_territory') {
        await captureDispatcherFollowup(info, slug, 'out_of_territory')
        setError("This address is outside our current service area, but we've captured your details. A dispatcher will reach out within 1 business day to discuss options.")
        setStep('intake')
        return
      }
      if (result.status === 'no_qualifying_resources') {
        await captureDispatcherFollowup(info, slug, 'no_qualifying_resources')
        setError("No certified auditors are currently available in your area for this service. We've captured your request — a dispatcher will reach out within 1 business day with next steps.")
        setStep('intake')
        return
      }
      if (result.status === 'no_availability' || !result.slots || result.slots.length === 0) {
        await captureDispatcherFollowup(info, slug, 'no_availability')
        setError("No availability in the next 14 days. We've captured your request — a dispatcher will reach out within 1 business day to find a time that works.")
        setStep('intake')
        return
      }
      if (result.status !== 'ok') {
        setError(result.message || 'Could not load availability. Please try again.')
        setStep('intake')
        return
      }
      setAvailability(result)
      setStep('slots')
    } catch (err) {
      setError(err.message || 'Could not load availability. Please try again.')
      setStep('intake')
    }
  }

  function handleSlotSelect(slot) {
    setSelectedSlot(slot)
    setStep('confirming')
  }

  async function handleConfirm() {
    setError(null)
    setStep('scheduling')
    try {
      const result = await createServiceAppointment({
        slug,
        start_iso:           selectedSlot.start_iso,
        end_iso:             selectedSlot.end_iso,
        resource_id:         selectedSlot.resource_id,
        customer_first_name: customerInfo.firstName,
        customer_last_name:  customerInfo.lastName,
        phone:               customerInfo.phone,
        email:               customerInfo.email,
        address: {
          street: customerInfo.street, city: customerInfo.city,
          state:  customerInfo.state,  zip:  customerInfo.zip,
        },
        intake: customerInfo.intake,
      })
      if (result.status === 'slot_taken') {
        // The slot was just taken by someone else — go back to fresh slots.
        setError("That time slot was just taken by another customer. Please pick another.")
        // Re-fetch availability before sending the customer back.
        try {
          const fresh = await computeAvailability({
            slug,
            address: { street: customerInfo.street, city: customerInfo.city, state: customerInfo.state, zip: customerInfo.zip },
            intake:  customerInfo.intake,
            days:    14,
          })
          if (fresh.status === 'ok') setAvailability(fresh)
        } catch { /* keep the stale availability */ }
        setStep('slots')
        return
      }
      if (result.status !== 'ok') {
        setError(result.message || 'Scheduling failed. Please try again.')
        setStep('confirming')
        return
      }
      setAppointmentResult(result)
      setStep('success')
    } catch (err) {
      setError(err.message || 'Scheduling failed. Please try again.')
      setStep('confirming')
    }
  }

  // ─── render the current step ──────────────────────────────────────────────

  if (step === 'success') {
    return (
      <SuccessStep
        meta={meta}
        slot={selectedSlot}
        customerInfo={customerInfo}
        result={appointmentResult}
      />
    )
  }

  return (
    <div>
      <Stepper step={step} />
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        {meta.title}
      </h1>
      <div style={{ color: C.textSecondary, fontSize: 14, marginBottom: 20 }}>
        {meta.durationLabel}
      </div>

      {error && <div style={errorBanner}>{error}</div>}

      {step === 'intake' && (
        <IntakeStep
          meta={meta}
          initial={customerInfo}
          onSubmit={handleIntakeSubmit}
        />
      )}
      {step === 'loading' && <LoadingStep label="Looking for available times…" />}
      {step === 'slots' && availability && (
        <SlotsStep
          availability={availability}
          onSelect={handleSlotSelect}
          onBack={() => { setError(null); setStep('intake') }}
        />
      )}
      {step === 'confirming' && (
        <ConfirmStep
          meta={meta}
          slot={selectedSlot}
          customerInfo={customerInfo}
          onConfirm={handleConfirm}
          onBack={() => { setError(null); setStep('slots') }}
        />
      )}
      {step === 'scheduling' && <LoadingStep label="Confirming your appointment…" />}
    </div>
  )
}

// ─── Stepper ────────────────────────────────────────────────────────────────

function Stepper({ step }) {
  const steps = ['intake', 'slots', 'confirming']
  const labels = ['Your info', 'Pick a time', 'Confirm']
  const activeIdx = step === 'intake' ? 0
                  : step === 'loading' ? 0
                  : step === 'slots' ? 1
                  : step === 'confirming' ? 2
                  : step === 'scheduling' ? 2 : 0
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: i <= activeIdx ? C.emerald : C.border,
            color:      i <= activeIdx ? '#fff' : C.textMuted,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700,
          }}>{i + 1}</div>
          <div style={{
            fontSize: 12,
            color:    i <= activeIdx ? C.textPrimary : C.textMuted,
            fontWeight: i === activeIdx ? 600 : 400,
          }}>{labels[i]}</div>
          {i < steps.length - 1 && (
            <div style={{
              flex: 1, height: 2, marginLeft: 4,
              background: i < activeIdx ? C.emerald : C.border,
            }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── IntakeStep ─────────────────────────────────────────────────────────────

function IntakeStep({ meta, initial, onSubmit }) {
  const [form, setForm] = useState(initial)
  const [focused, setFocused] = useState(null)
  const [validation, setValidation] = useState(null)

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }
  function updateIntake(field, value) {
    setForm(f => ({ ...f, intake: { ...f.intake, [field]: value } }))
  }

  function validate() {
    const required = ['firstName','lastName','phone','email','street','city','state','zip']
    for (const f of required) {
      if (!String(form[f] || '').trim()) return `${labelFor(f)} is required.`
    }
    const phoneDigits = String(form.phone).replace(/\D/g, '').replace(/^1/, '')
    if (phoneDigits.length !== 10) return 'Please enter a valid 10-digit phone number.'
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return 'Please enter a valid email address.'
    if (!/^\d{5}$/.test(String(form.zip).slice(0,5))) return 'ZIP must be 5 digits.'
    if (String(form.state).length !== 2) return 'State must be a 2-letter code.'
    for (const f of meta.intake) {
      const v = form.intake[f.name]
      if (v === undefined || v === '' || v === null) return `${f.label.replace(/\?$/, '')} is required.`
      if (f.type === 'number') {
        const n = Number(v)
        if (!Number.isFinite(n) || n < (f.min ?? 1) || n > (f.max ?? Infinity)) {
          return `${f.label.replace(/\?$/, '')} must be between ${f.min ?? 1} and ${f.max ?? '∞'}.`
        }
      }
    }
    return null
  }

  function handleSubmit(e) {
    e.preventDefault()
    const v = validate()
    if (v) { setValidation(v); return }
    setValidation(null)
    onSubmit(form)
  }

  const styledInput = (field) => ({
    ...input,
    ...(focused === field ? inputFocus : {}),
  })

  return (
    <form style={card} onSubmit={handleSubmit}>
      {validation && <div style={errorBanner}>{validation}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="First name">
          <input type="text" value={form.firstName} onChange={e => update('firstName', e.target.value)}
                 onFocus={() => setFocused('firstName')} onBlur={() => setFocused(null)}
                 style={styledInput('firstName')} autoComplete="given-name" required />
        </Field>
        <Field label="Last name">
          <input type="text" value={form.lastName} onChange={e => update('lastName', e.target.value)}
                 onFocus={() => setFocused('lastName')} onBlur={() => setFocused(null)}
                 style={styledInput('lastName')} autoComplete="family-name" required />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Phone">
          <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)}
                 onFocus={() => setFocused('phone')} onBlur={() => setFocused(null)}
                 style={styledInput('phone')} placeholder="(608) 555-1234" autoComplete="tel" required />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={e => update('email', e.target.value)}
                 onFocus={() => setFocused('email')} onBlur={() => setFocused(null)}
                 style={styledInput('email')} placeholder="you@example.com" autoComplete="email" required />
        </Field>
      </div>

      <Field label="Service address">
        <input type="text" value={form.street} onChange={e => update('street', e.target.value)}
               onFocus={() => setFocused('street')} onBlur={() => setFocused(null)}
               style={{ ...styledInput('street'), marginBottom: 8 }} placeholder="Street address" autoComplete="street-address" required />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
        <input type="text" value={form.city} onChange={e => update('city', e.target.value)}
               onFocus={() => setFocused('city')} onBlur={() => setFocused(null)}
               style={styledInput('city')} placeholder="City" autoComplete="address-level2" required />
        <select value={form.state} onChange={e => update('state', e.target.value.toUpperCase())}
                onFocus={() => setFocused('state')} onBlur={() => setFocused(null)}
                style={styledInput('state')} autoComplete="address-level1" required>
          {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="text" value={form.zip} onChange={e => update('zip', e.target.value)}
               onFocus={() => setFocused('zip')} onBlur={() => setFocused(null)}
               style={styledInput('zip')} placeholder="ZIP" inputMode="numeric" pattern="\d{5}" maxLength={5} autoComplete="postal-code" required />
      </div>

      {meta.intake.map(f => (
        <div key={f.name} style={{ marginBottom: 16 }}>
          <Field label={f.label}>
            <input
              type={f.type}
              value={form.intake[f.name] ?? ''}
              onChange={e => updateIntake(f.name, e.target.value)}
              onFocus={() => setFocused(`intake-${f.name}`)}
              onBlur={() => setFocused(null)}
              style={styledInput(`intake-${f.name}`)}
              placeholder={f.placeholder}
              min={f.min} max={f.max}
              required
            />
          </Field>
        </div>
      ))}

      <button type="submit" style={buttonPrimary}>Find available times →</button>
    </form>
  )
}

function Field({ label: labelText, children }) {
  return (
    <div>
      <label style={label}>{labelText}</label>
      {children}
    </div>
  )
}

function labelFor(field) {
  return { firstName: 'First name', lastName: 'Last name', phone: 'Phone',
           email: 'Email', street: 'Street address', city: 'City',
           state: 'State', zip: 'ZIP' }[field] || field
}

// ─── SlotsStep ──────────────────────────────────────────────────────────────

function SlotsStep({ availability, onSelect, onBack }) {
  // Group slots by Chicago date; within each date, dedupe by start_iso
  // (multiple Techs at the same time collapse to one tappable button — the
  // edge function's day-fill ordering puts the preferred resource first).
  const byDay = useMemo(() => {
    const map = new Map()
    const seenInDay = new Map()
    for (const slot of availability.slots) {
      const { date } = formatChicagoSlot(slot.start_iso)
      const dayKey = date
      if (!map.has(dayKey)) {
        map.set(dayKey, [])
        seenInDay.set(dayKey, new Set())
      }
      if (seenInDay.get(dayKey).has(slot.start_iso)) continue
      seenInDay.get(dayKey).add(slot.start_iso)
      map.get(dayKey).push(slot)
    }
    return Array.from(map.entries())
  }, [availability])

  return (
    <div>
      <div style={{
        ...card,
        background: C.cardSecondary,
        marginBottom: 16,
        padding: '12px 16px',
        fontSize: 13,
        color: C.textSecondary,
      }}>
        <div>Service area: <strong style={{ color: C.textPrimary }}>{availability.territory.name}</strong></div>
        <div>Estimated duration: <strong style={{ color: C.textPrimary }}>{availability.effective_duration_minutes} minutes</strong></div>
      </div>

      {byDay.map(([dayLabel, slots]) => (
        <div key={dayLabel} style={{ ...card, marginBottom: 12 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: C.textPrimary,
            marginBottom: 12, paddingBottom: 8,
            borderBottom: `1px solid ${C.border}`,
          }}>
            {dayLabel}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 8,
          }}>
            {slots.map((slot, i) => {
              const { time } = formatChicagoSlot(slot.start_iso)
              return (
                <button
                  key={`${slot.start_iso}-${i}`}
                  onClick={() => onSelect(slot)}
                  style={{
                    padding: '12px 8px',
                    fontSize: 14, fontWeight: 500,
                    color: C.textPrimary,
                    background: C.card,
                    border: `1px solid ${C.borderDark}`,
                    borderRadius: RADIUS,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = C.emerald
                    e.currentTarget.style.background  = C.emeraldBg
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = C.borderDark
                    e.currentTarget.style.background  = C.card
                  }}
                >
                  {time}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <button type="button" onClick={onBack} style={{ ...buttonSecondary, marginTop: 8 }}>
        ← Edit your information
      </button>
    </div>
  )
}

// ─── ConfirmStep ────────────────────────────────────────────────────────────

function ConfirmStep({ meta, slot, customerInfo, onConfirm, onBack }) {
  const { date, time } = formatChicagoSlot(slot.start_iso)
  const range = formatChicagoTimeRange(slot.start_iso, slot.end_iso)

  return (
    <div>
      <div style={card}>
        <SummaryRow label="Service" value={meta.title} />
        <SummaryRow label="When" value={`${date}`} highlight />
        <SummaryRow label="Time" value={range} />
        <SummaryRow label="Auditor" value={slot.resource_first_name} />
        <SummaryRow
          label="Address"
          value={`${customerInfo.street}, ${customerInfo.city}, ${customerInfo.state} ${customerInfo.zip}`}
        />
        <SummaryRow
          label="Customer"
          value={`${customerInfo.firstName} ${customerInfo.lastName} · ${customerInfo.phone} · ${customerInfo.email}`}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button type="button" onClick={onBack} style={{ ...buttonSecondary, flex: 1 }}>
          ← Back
        </button>
        <button type="button" onClick={onConfirm} style={{ ...buttonPrimary, flex: 2 }}>
          Confirm appointment
        </button>
      </div>
    </div>
  )
}

function SummaryRow({ label: text, value, highlight }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 16,
      padding: '12px 0',
      borderBottom: `1px solid ${C.border}`,
      flexWrap: 'wrap',
    }}>
      <div style={{ ...label, marginBottom: 0, alignSelf: 'center', minWidth: 80 }}>{text}</div>
      <div style={{
        textAlign: 'right',
        fontSize:  highlight ? 16 : 14,
        fontWeight: highlight ? 600 : 500,
        color: C.textPrimary,
        flex: 1, minWidth: 200,
      }}>{value}</div>
    </div>
  )
}

// ─── SuccessStep ────────────────────────────────────────────────────────────

function SuccessStep({ meta, slot, customerInfo, result }) {
  const { date, time } = formatChicagoSlot(slot.start_iso)
  const range = formatChicagoTimeRange(slot.start_iso, slot.end_iso)
  const manageUrl = result.manage_url || `/sa/manage/${result.service_appointment_token}`

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 64, height: 64, borderRadius: '50%',
          background: C.emeraldBg, marginBottom: 16,
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12l5 5 9-10" stroke={C.emeraldDark} strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>
          You're scheduled.
        </h1>
        <p style={{ color: C.textSecondary, fontSize: 15 }}>
          Your appointment is confirmed for <strong style={{ color: C.textPrimary }}>{date}</strong>.
        </p>
      </div>

      <div style={card}>
        <SummaryRow label="Service" value={meta.title} />
        <SummaryRow label="When" value={date} highlight />
        <SummaryRow label="Time" value={range} />
        <SummaryRow label="Auditor" value={slot.resource_first_name} />
        <SummaryRow
          label="Address"
          value={`${customerInfo.street}, ${customerInfo.city}, ${customerInfo.state} ${customerInfo.zip}`}
        />
      </div>

      <div style={{
        ...card,
        background:  C.cardSecondary,
        marginTop:   12,
        fontSize:    13,
        color:       C.textSecondary,
        lineHeight:  1.5,
      }}>
        <strong style={{ color: C.textPrimary, display: 'block', marginBottom: 6 }}>
          What happens next
        </strong>
        Your auditor will arrive at the scheduled time. Please make sure they
        can access the property and any mechanical areas (basement, attic,
        utility closet). The assessment takes about{' '}
        {Math.round((new Date(slot.end_iso) - new Date(slot.start_iso)) / 60000)} minutes.
        <br /><br />
        Bookmark this link to view or reschedule your appointment:
        <br />
        <a href={manageUrl} style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12, color: C.emeraldMid,
          wordBreak: 'break-all', textDecoration: 'none',
        }}>{manageUrl}</a>
      </div>
    </div>
  )
}

// ─── LoadingStep ────────────────────────────────────────────────────────────

function LoadingStep({ label: text }) {
  return (
    <div style={{
      ...card,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: '48px 24px',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: `3px solid ${C.border}`,
        borderTopColor: C.emerald,
        animation: 'ees-spin 0.7s linear infinite',
      }} />
      <div style={{ color: C.textSecondary, fontSize: 14 }}>{text}</div>
      <style>{`@keyframes ees-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
