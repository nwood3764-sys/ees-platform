import { useEffect } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useIsMobile } from '../lib/useMediaQuery'
import OutlookConnectionCard from './OutlookConnectionCard'

// ---------------------------------------------------------------------------
// IntegrationsModal — user-level integrations management.
//
// Today this hosts a single card (Microsoft Outlook). The shape of the modal
// is intentionally generic so future integrations (Twilio for SMS, Slack
// for channel posts, DocuSign for fallback signing, etc.) can be added as
// additional cards without restructuring the surrounding chrome.
//
// Mounted at the App root next to PasswordChangeModal so the overlay isn't
// clipped by the sidebar's container. Opened from UserMenu's "Integrations"
// item.
// ---------------------------------------------------------------------------

export default function IntegrationsModal({ onClose }) {
  const isMobile = useIsMobile()

  // Close on Escape.
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 700,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Integrations"
        style={{
          background: C.card,
          borderRadius: isMobile ? '12px 12px 0 0' : 10,
          padding: isMobile ? '22px 20px calc(20px + env(safe-area-inset-bottom))' : 26,
          width: isMobile ? '100%' : 520,
          maxWidth: '100%',
          maxHeight: isMobile ? '90vh' : '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#eef4fc', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon path="M14 7l-5 5 5 5M5 7l5 5-5 5" size={15} color="#2557a7" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Integrations
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
              Connect external services that Anura can act on your behalf.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.textMuted, padding: 4, lineHeight: 0, marginRight: -6, marginTop: -4,
            }}
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6"  y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <OutlookConnectionCard />
        </div>
      </div>
    </div>
  )
}
