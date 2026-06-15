// ─── KnowledgeScreen.jsx ─────────────────────────────────────────────────────
// Field knowledge base — placeholder surface. Reached from the drawer. The
// content (work-type guides, reference docs, safety) is a separate build; this
// gives the drawer link a real destination with the app shell rather than a
// dead 404, and an honest empty state.
// ─────────────────────────────────────────────────────────────────────────────

import AppChrome from './AppChrome'
import { C, FONT } from './styles'

function BookIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.textMuted}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

export default function KnowledgeScreen({ navigate }) {
  return (
    <AppChrome title="Knowledge base" activeKey={null} navigate={navigate}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center',
        padding: '48px 24px', gap: 14,
      }}>
        <BookIcon />
        <div style={{ fontFamily: FONT, fontSize: 17, fontWeight: 700, color: C.textPrimary }}>
          Knowledge base
        </div>
        <div style={{ fontFamily: FONT, fontSize: 14, color: C.textSecondary, maxWidth: 320, lineHeight: 1.5 }}>
          Work-type guides, reference documents, and field procedures will live
          here. This section is being built.
        </div>
        <button
          onClick={() => navigate('/field')}
          style={{
            marginTop: 8, appearance: 'none', border: 'none', cursor: 'pointer',
            background: C.emerald, color: '#062018', fontFamily: FONT,
            fontWeight: 700, fontSize: 14, borderRadius: 8, padding: '11px 18px',
          }}
        >
          Back to Home
        </button>
      </div>
    </AppChrome>
  )
}
