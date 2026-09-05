// SignatureSendModal — send a LEAP-GENERATED document for signature.
//
// Distinct from SendForSignatureModal, which is the three-step envelope builder
// for DOCUMENT TEMPLATES: pick a template, edit recipients, set a subject. That
// one starts from a template and asks who signs. This one starts from a record
// whose document LEAP composes itself — a HEAR proposal, a HOMES payment
// request invoice — where the signer is already known from the record and the
// only real question is whether that inherited address is right.
//
// (An earlier cut of this file was written over SendForSignatureModal.jsx by
// mistake. Two different jobs, two components, two names.)
//
// Nicholas: "we need to send it out for signature and then through the LEAP
// software. Then it comes back when it's signed." Then, on the payment request:
// "you can do the signature stuff for the homes project payment request as well
// ... those are on incentive objects, right?" — yes: incentive_applications,
// record type WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST.
//
// ONE modal, configured per document, rather than one per programme. The two
// send paths differ only in which service loads the record and which sends it;
// everything a person sees and every guard they pass through is identical, and
// two copies of that is two chances for one to lose its recipient confirmation.
//
// The recipient is shown and editable BEFORE anything is sent, and the service
// puts the address through requireOutboundApproval on top of that. Both, on
// purpose: this email address is inherited from a record rather than typed, and
// the platform's hard rule exists because a populated field was once treated as
// consent to contact somebody.
//
// It does NOT set a status. The envelope's own status moves the enrollment
// (trg_zzz_enrollment_status_from_envelope) — Sent to "Proposal Signature
// Requested", Completed to "Enrollment To Be Submitted" — so the record cannot
// end up claiming something the envelope disagrees with.

import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { useToast } from './Toast'
import { Icon } from './UI'
import { backdropDismissProps } from '../lib/modalDismiss'
/**
 * The documents that can be sent for signature, and where each one lives.
 *
 * A registry rather than five props at each call site: the two documents differ
 * only in which service loads and sends them, and keeping that in one table is
 * what stops a third document arriving with its own half-copied modal — the
 * pattern that produced two Products cards and nine copies of an anchor list
 * elsewhere in this codebase.
 *
 * Services are imported lazily so opening an enrollment does not pull the HOMES
 * Asset Score parser, or vice versa.
 */
const DOCUMENTS = {
  hear_proposal: {
    noun: 'Proposal',
    whatHappensNext: "The proposal is generated from this opportunity's equipment, filed on the enrollment, and emailed to the property owner to sign. When they sign, the enrollment moves itself to Enrollment To Be Submitted.",
    async module() { return import('../data/hearProposalService') },
    load:      (m, id) => m.loadHearProposalContext(id),
    missingOf: (m, ctx) => m.hearProposalMissing(ctx),
    send:      (m, id, args) => m.sendHearProposalForSignature(id, args),
    subject:   ctx => `Please sign: ${(ctx?.enr?.enrollment_name || 'IRA Multifamily HEAR Proposal').trim()}`,
  },
  payment_request: {
    noun: 'Invoice',
    whatHappensNext: 'The Project Payment Request invoice is generated from this incentive application, filed on it, and emailed to the property owner to sign.',
    async module() { return import('../data/homesProposalService') },
    load:      (m, id) => m.loadPaymentRequestSignatureContext(id),
    missingOf: (m, ctx) => m.paymentRequestSignatureMissing(ctx),
    send:      (m, id, args) => m.sendPaymentRequestForSignature(id, args),
    subject:   ctx => `Please sign: ${(ctx?.fields?.pjPropName || 'Project')} — Payment Request Invoice`,
  },
}

/**
 * @param kind      a key of DOCUMENTS
 * @param recordId  the record the document is generated from and filed on
 */
export default function SignatureSendModal({ kind, recordId, onClose, onSent }) {
  const spec = DOCUMENTS[kind]
  const documentNoun = spec?.noun || 'Document'
  const whatHappensNext = spec?.whatHappensNext || null
  const toast = useToast()
  const [ctx, setCtx] = useState(null)          // null = loading
  const [missing, setMissing] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [svc, setSvc] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!spec) throw new Error(`No document is registered under "${kind}".`)
        const mod = await spec.module()
        if (cancelled) return
        setSvc(mod)
        const c = await spec.load(mod, recordId)
        if (cancelled) return
        setCtx(c)
        setMissing(spec.missingOf(mod, c))
        // Pre-filled from the record, and shown rather than assumed — the whole
        // point of the confirmation is that a person reads who this is going to.
        setName(c?.fields?.pjContact || '')
        setEmail(c?.fields?.pjEmail || '')
        setSubject(spec.subject(c))
      } catch (e) {
        if (!cancelled) setLoadError(e.message || String(e))
      }
    })()
    return () => { cancelled = true }
  }, [kind, recordId])

  const send = async () => {
    if (sending) return
    setSending(true)
    try {
      const r = await spec.send(svc, recordId, { name, email, subject })
      setResult(r)
      toast.success(r.emailed
        ? `Signature request emailed to ${email.trim()}`
        : 'Envelope created — the signing link is ready to share')
      if (onSent) onSent(r)
    } catch (e) {
      // A declined confirmation is a choice, not a failure — it gets no red toast.
      if (e?.declined) { toast.info?.('Not sent.') }
      else toast.error(`Send failed — ${e.message || e}`)
    } finally {
      setSending(false)
    }
  }

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.45)', zIndex: 9000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  }
  const card = {
    background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
    width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto',
    boxShadow: '0 12px 40px rgba(7,17,31,0.18)',
  }
  const label = { fontSize: 11.5, fontWeight: 600, color: C.textSecondary, marginBottom: 4, display: 'block' }
  const input = {
    width: '100%', padding: '7px 10px', fontSize: 13, border: `1px solid ${C.borderDark}`,
    borderRadius: 6, outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={overlay} {...backdropDismissProps(onClose, { disabled: sending })}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Icon path="M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z" size={16} color={C.emerald} />
            <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
              Send {documentNoun} for Signature
            </div>
          </div>
          <button onClick={sending ? undefined : onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', padding: 6, cursor: sending ? 'wait' : 'pointer', color: C.textMuted }}>
            <Icon path="M18 6 6 18M6 6l12 12" size={15} color="currentColor" />
          </button>
        </div>

        <div style={{ padding: 16 }}>
          {loadError && (
            <div style={{ fontSize: 13, color: C.textPrimary, background: C.cardSecondary,
              border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
              Could not load the {documentNoun}: {loadError}
            </div>
          )}

          {!loadError && ctx == null && (
            <div style={{ fontSize: 13, color: C.textMuted }}>Loading the {documentNoun}…</div>
          )}

          {/* A record that cannot produce a proposal says exactly what is
              missing, rather than failing at the send. */}
          {missing && missing.length > 0 && (
            <div style={{ fontSize: 13, color: C.textPrimary, background: C.cardSecondary,
              border: `1px solid ${C.borderDark}`, borderRadius: 6, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>This record is not ready to send.</div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                {missing.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          {ctx && missing && missing.length === 0 && !result && (
            <>
              <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.55, marginBottom: 14 }}>
                {whatHappensNext || `The ${documentNoun} is generated from this record, filed on it, and emailed to the property owner to sign.`}
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <span style={label}>Send to — name</span>
                  <input style={input} value={name} onChange={e => setName(e.target.value)}
                    placeholder="Property owner or authorized representative" />
                </div>
                <div>
                  <span style={label}>Send to — email</span>
                  <input style={input} value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="name@example.com" />
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>
                    Read this before you send — it is pre-filled from the record, not typed.
                  </div>
                </div>
                <div>
                  <span style={label}>Subject</span>
                  <input style={input} value={subject} onChange={e => setSubject(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {result && (
            <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {result.emailed ? 'Sent for signature.' : 'Envelope created.'}
              </div>
              {result.emailed
                ? <div>The property owner has been emailed.{result.statusNote ? ` ${result.statusNote}` : ''}</div>
                : <div>No email went out — share this link with the signer:</div>}
              {result.signingUrl && (
                <div style={{ marginTop: 8, wordBreak: 'break-all', fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11.5, background: C.cardSecondary, border: `1px solid ${C.border}`,
                  borderRadius: 6, padding: 10 }}>
                  {result.signingUrl}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 16px', borderTop: `1px solid ${C.border}` }}>
          <button onClick={onClose} disabled={sending}
            style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6,
              padding: '7px 14px', fontSize: 13, cursor: sending ? 'wait' : 'pointer', color: C.textSecondary }}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {ctx && missing && missing.length === 0 && !result && (
            <button onClick={send} disabled={sending || !email.trim()}
              style={{ background: (sending || !email.trim()) ? C.textMuted : C.emerald, color: '#fff',
                border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600,
                cursor: sending ? 'wait' : (email.trim() ? 'pointer' : 'not-allowed') }}>
              {sending ? 'Sending…' : 'Send for Signature'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
