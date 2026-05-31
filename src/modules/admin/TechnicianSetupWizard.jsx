import { useEffect, useRef, useState } from 'react'
import { C } from '../../data/constants'
import {
  inputStyle, buttonPrimaryStyle, buttonSecondaryStyle,
  FormField,
} from './adminStyles'
import { useIsMobile } from '../../lib/useMediaQuery'
import {
  fetchRoles, inviteUser,
  fetchPrograms, fetchActivePermissionSets, fetchServiceTerritories,
  provisionFieldTechnician,
} from '../../data/adminService'
import { useToast } from '../../components/Toast'

/**
 * TechnicianSetupWizard — guided, end-to-end provisioning of a field
 * technician as a LEAP User (not a Contact). Replaces the disconnected
 * "create a record" flow with a Salesforce-style screen flow:
 *
 *   Step 1  Identity & role  — name, email, field role, title, phone.
 *                              On Next, the invite-user edge function creates
 *                              the auth user + users row and emails a set-password
 *                              link. The returned user_id carries through.
 *   Step 2  Program access   — which programs this technician can see/work.
 *   Step 3  Permission sets   — additive permission sets on top of the role.
 *   Step 4  Service resource  — the service territory that makes them
 *                              schedulable in Dispatch (FSL Service Resource,
 *                              linked to the User).
 *   Step 5  Review & finish   — calls provision_field_technician to write
 *                              program scopes, permission sets, and the
 *                              user-linked service resource atomically.
 *
 * The user is created at the end of step 1 (so the invite goes out promptly);
 * if the admin cancels after that, the user still exists and can be finished
 * later — provisioning is idempotent.
 */

const FIELD_ROLE_NAMES = ['Team Lead', 'Lead Technician', 'Technician in Training', 'Project Site Lead']

const STEPS = [
  { key: 'identity', label: 'Identity & Role' },
  { key: 'programs', label: 'Program Access' },
  { key: 'permsets', label: 'Permission Sets' },
  { key: 'resource', label: 'Service Resource' },
  { key: 'review',   label: 'Review & Finish' },
]

export default function TechnicianSetupWizard({ onClose, onComplete }) {
  const isMobile = useIsMobile()
  const toast = useToast()
  const firstInputRef = useRef(null)

  const [stepIdx, setStepIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Step 1 — identity
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [email, setEmail]         = useState('')
  const [title, setTitle]         = useState('')
  const [phone, setPhone]         = useState('')
  const [roleId, setRoleId]       = useState('')
  const [roles, setRoles]         = useState([])

  // Created user (after step 1)
  const [userId, setUserId]       = useState(null)

  // Step 2/3/4 option lists + selections
  const [programs, setPrograms]   = useState([])
  const [permSets, setPermSets]   = useState([])
  const [territories, setTerritories] = useState([])
  const [selectedPrograms, setSelectedPrograms] = useState(() => new Set())
  const [selectedPermSets, setSelectedPermSets] = useState(() => new Set())
  const [territoryId, setTerritoryId] = useState('')

  // Load roles (field roles only) + option lists up front.
  useEffect(() => {
    let alive = true
    Promise.all([
      fetchRoles().catch(() => []),
      fetchPrograms().catch(() => []),
      fetchActivePermissionSets().catch(() => []),
      fetchServiceTerritories().catch(() => []),
    ]).then(([rolesData, programsData, permData, terrData]) => {
      if (!alive) return
      const fieldRoles = (rolesData || []).filter(r => FIELD_ROLE_NAMES.includes(r.name))
      setRoles(fieldRoles.length ? fieldRoles : (rolesData || []))
      // Only active programs are selectable (matches the WI-only go-live state).
      setPrograms((programsData || []).filter(p => String(p.status || '').toLowerCase().includes('active')))
      setPermSets(permData || [])
      setTerritories((terrData || []).filter(t => t.active !== 'Inactive'))
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const step = STEPS[stepIdx]

  function toggle(setObj, set, id) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setObj(next)
  }

  // Step 1 submit → create the user via invite, capture user_id, advance.
  async function createUserAndAdvance() {
    setError(null)
    if (!firstName.trim()) return setError('First name is required.')
    if (!lastName.trim())  return setError('Last name is required.')
    if (!email.trim())     return setError('Email is required.')
    if (!roleId)           return setError('Select a field role.')

    setBusy(true)
    try {
      const result = await inviteUser({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        roleId,
        title: title.trim() || undefined,
        phone: phone.trim() || undefined,
      })
      const newId = result?.user_id
      if (!newId) throw new Error('User was created but no id was returned.')
      setUserId(newId)
      toast.success(`Invite sent to ${result?.email || email.trim()}`)
      setStepIdx(1)
    } catch (err) {
      setError(err.message || 'Could not create the user.')
    } finally {
      setBusy(false)
    }
  }

  // Final submit → write program scopes / permission sets / service resource.
  async function finish() {
    setError(null)
    setBusy(true)
    try {
      await provisionFieldTechnician({
        userId,
        programIds: [...selectedPrograms],
        permissionSetIds: [...selectedPermSets],
        serviceTerritoryId: territoryId || null,
      })
      toast.success('Technician fully provisioned.')
      onComplete?.({ userId })
      onClose()
    } catch (err) {
      setError(err.message || 'Provisioning failed.')
      setBusy(false)
    }
  }

  function next() {
    setError(null)
    if (stepIdx === 0) { createUserAndAdvance(); return }
    if (stepIdx < STEPS.length - 1) { setStepIdx(stepIdx + 1); return }
    finish()
  }
  function back() {
    setError(null)
    // Can't go back to step 1 once the user is created — identity is locked in.
    if (stepIdx > 1) setStepIdx(stepIdx - 1)
  }

  const primaryLabel = busy
    ? (stepIdx === 0 ? 'Creating…' : stepIdx === STEPS.length - 1 ? 'Finishing…' : 'Working…')
    : (stepIdx === 0 ? 'Create & Continue' : stepIdx === STEPS.length - 1 ? 'Finish Setup' : 'Next')

  const roleName = roles.find(r => (r._id || r.id) === roleId)?.name || ''

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 700,
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Set Up Technician"
        style={{
          background: C.card,
          borderRadius: isMobile ? '12px 12px 0 0' : 10,
          padding: isMobile ? '22px 20px calc(20px + env(safe-area-inset-bottom))' : 26,
          width: isMobile ? '100%' : 560,
          maxWidth: '100%',
          maxHeight: isMobile ? '92vh' : '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header + step indicator */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
            Set Up Technician
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.45 }}>
            Provision a field technician as a LEAP user with login access, program access,
            permissions, and Dispatch scheduling — all in one flow.
          </div>
        </div>

        {/* Step rail */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          {STEPS.map((s, i) => (
            <div key={s.key} style={{
              fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 20,
              background: i === stepIdx ? C.emerald : (i < stepIdx ? '#e6f7ee' : C.cardSecondary),
              color: i === stepIdx ? '#fff' : (i < stepIdx ? '#1a7a4e' : C.textMuted),
              border: `1px solid ${i === stepIdx ? C.emeraldMid : C.border}`,
            }}>
              {i + 1}. {s.label}
            </div>
          ))}
        </div>

        {/* ── Step 1: Identity & Role ─────────────────────────────────── */}
        {step.key === 'identity' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="First Name" required>
                <input ref={firstInputRef} value={firstName} disabled={busy}
                  onChange={e => setFirstName(e.target.value)} style={inputStyle} autoComplete="given-name" />
              </FormField>
              <FormField label="Last Name" required>
                <input value={lastName} disabled={busy}
                  onChange={e => setLastName(e.target.value)} style={inputStyle} autoComplete="family-name" />
              </FormField>
            </div>
            <FormField label="Email" required
              hint="The technician gets a one-time link at this address to set their password.">
              <input type="email" value={email} disabled={busy}
                onChange={e => setEmail(e.target.value)} placeholder="user@EES-WI.org" style={inputStyle} />
            </FormField>
            <FormField label="Field Role" required
              hint="Determines base module and field-level access. Field roles only.">
              <select value={roleId} disabled={busy}
                onChange={e => setRoleId(e.target.value)} style={inputStyle}>
                <option value="">— Select —</option>
                {roles.map(r => (
                  <option key={r._id || r.id} value={r._id || r.id}>{r.name}</option>
                ))}
              </select>
            </FormField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Title" hint="Optional.">
                <input value={title} disabled={busy}
                  onChange={e => setTitle(e.target.value)} style={inputStyle} />
              </FormField>
              <FormField label="Phone" hint="Optional.">
                <input value={phone} disabled={busy}
                  onChange={e => setPhone(e.target.value)} style={inputStyle} placeholder="(555) 555-1234" />
              </FormField>
            </div>
          </div>
        )}

        {/* ── Step 2: Program Access ──────────────────────────────────── */}
        {step.key === 'programs' && (
          <CheckList
            emptyText="No active programs to assign."
            items={programs.map(p => ({ id: p._id, primary: p.name, secondary: `${p.shortName} · ${p.state}` }))}
            selected={selectedPrograms}
            onToggle={(id) => toggle(setSelectedPrograms, selectedPrograms, id)}
            hint="Which programs can this technician see and work? You can change this later in the user record."
          />
        )}

        {/* ── Step 3: Permission Sets ─────────────────────────────────── */}
        {step.key === 'permsets' && (
          <CheckList
            emptyText="No active permission sets defined."
            items={permSets.map(p => ({ id: p.id, primary: p.name, secondary: p.description }))}
            selected={selectedPermSets}
            onToggle={(id) => toggle(setSelectedPermSets, selectedPermSets, id)}
            hint="Additive permissions on top of the role. Optional — leave all unchecked to rely on the role alone."
          />
        )}

        {/* ── Step 4: Service Resource ────────────────────────────────── */}
        {step.key === 'resource' && (
          <FormField label="Service Territory"
            hint="Assigning a territory makes this technician a schedulable Service Resource in Dispatch. Optional — skip if they aren't scheduled yet.">
            <select value={territoryId} disabled={busy}
              onChange={e => setTerritoryId(e.target.value)} style={inputStyle}>
              <option value="">— None (not schedulable yet) —</option>
              {territories.map(t => (
                <option key={t._id || t.id} value={t._id || t.id}>{t.name || t.service_territory_name}</option>
              ))}
            </select>
          </FormField>
        )}

        {/* ── Step 5: Review ──────────────────────────────────────────── */}
        {step.key === 'review' && (
          <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.7 }}>
            <ReviewRow label="Name" value={`${firstName} ${lastName}`.trim()} />
            <ReviewRow label="Email" value={email} />
            <ReviewRow label="Field Role" value={roleName || '—'} />
            <ReviewRow label="Programs" value={
              selectedPrograms.size === 0 ? 'None'
                : programs.filter(p => selectedPrograms.has(p._id)).map(p => p.shortName).join(', ')
            } />
            <ReviewRow label="Permission Sets" value={
              selectedPermSets.size === 0 ? 'None'
                : permSets.filter(p => selectedPermSets.has(p.id)).map(p => p.name).join(', ')
            } />
            <ReviewRow label="Service Territory" value={
              territoryId
                ? (territories.find(t => (t._id || t.id) === territoryId)?.name
                   || territories.find(t => (t._id || t.id) === territoryId)?.service_territory_name || 'Selected')
                : 'None (not schedulable yet)'
            } />
            <div style={{ marginTop: 12, fontSize: 12, color: C.textMuted }}>
              The user was created and invited in step 1. Finishing writes the program access,
              permission sets, and Dispatch scheduling resource.
            </div>
          </div>
        )}

        {error && (
          <div style={{
            background: '#fdecea', border: '1px solid #f3b9b1', color: '#8a2d20',
            padding: '9px 12px', borderRadius: 6, fontSize: 12, marginTop: 14,
          }}>{error}</div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>
            Cancel
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {stepIdx > 1 && (
              <button type="button" onClick={back} disabled={busy} style={buttonSecondaryStyle}>
                Back
              </button>
            )}
            <button type="button" onClick={next} disabled={busy}
              style={{ ...buttonPrimaryStyle, opacity: busy ? 0.7 : 1 }}>
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CheckList({ items, selected, onToggle, hint, emptyText }) {
  return (
    <div>
      {hint && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12, lineHeight: 1.45 }}>{hint}</div>}
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: C.textMuted, padding: '12px 0' }}>{emptyText}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
          {items.map(it => {
            const on = selected.has(it.id)
            return (
              <button key={it.id} type="button" onClick={() => onToggle(it.id)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                  padding: '9px 11px', borderRadius: 6, cursor: 'pointer',
                  background: on ? '#e6f7ee' : C.card,
                  border: `1px solid ${on ? C.emeraldMid : C.border}`,
                }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
                  border: `1px solid ${on ? C.emeraldMid : C.borderDark}`,
                  background: on ? C.emerald : C.card,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"
                      strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </span>
                <span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: C.textPrimary }}>{it.primary}</span>
                  {it.secondary && <span style={{ display: 'block', fontSize: 11.5, color: C.textMuted }}>{it.secondary}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ReviewRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '3px 0' }}>
      <div style={{ width: 130, flexShrink: 0, color: C.textMuted, fontSize: 12.5 }}>{label}</div>
      <div style={{ color: C.textPrimary, fontSize: 12.5 }}>{value || '—'}</div>
    </div>
  )
}
