import { useState } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useIsMobile } from '../../lib/useMediaQuery'
import RecordDetail from '../../components/RecordDetail'
import SetupHome from './SetupHome'
import ObjectManager from './ObjectManager'
import ObjectDetail from './ObjectDetail'

// ---------------------------------------------------------------------------
// AdminModule — Salesforce-style Setup shell.
//
// Top bar: breadcrumb (Setup / [current tab or record])
// Primary tabs: Setup Home | Object Manager
//   - Setup Home:  left tree nav + content pane (renders list of whatever node is selected)
//   - Object Manager: searchable list of 89 tables → click one → ObjectDetail with sub-tabs
// Both tabs can open individual record detail pages (contacts, templates, etc.)
// ---------------------------------------------------------------------------

export default function AdminModule() {
  const [tab, setTab] = useState('setup')               // 'setup' | 'objects'
  const [selectedObject, setSelectedObject] = useState(null)   // catalog entry from ObjectManager
  const [selectedRecord, setSelectedRecord] = useState(null)   // { table, id, name?, mode?, prefill? }
  const isMobile = useIsMobile()
  // Dismissible "use desktop" banner. Persisted so the user only sees it once
  // per device. Admin tools like the object manager and page layout editor
  // are dense tables that don't adapt well to phone screens, so we set the
  // expectation upfront rather than pretending the mobile experience is good.
  const [desktopNoticeDismissed, setDesktopNoticeDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return localStorage.getItem('ees.admin.desktopNotice.dismissed') === '1' } catch { return false }
  })
  const dismissDesktopNotice = () => {
    setDesktopNoticeDismissed(true)
    try { localStorage.setItem('ees.admin.desktopNotice.dismissed', '1') } catch { /* storage disabled */ }
  }

  const openObjectManager = () => {
    setTab('objects')
    setSelectedObject(null)
    setSelectedRecord(null)
  }

  const openRecord = (payload) => {
    // Called when a child list view wants to open a record detail page.
    // `payload` shape: { table, id, name?, mode?, prefill? }
    setSelectedRecord(payload)
  }

  const closeRecord = () => setSelectedRecord(null)

  // Breadcrumb trail — depends on current view
  const crumbs = buildCrumbs(tab, selectedObject, selectedRecord)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ─── Mobile-only "use desktop" notice ────────────────────────
          Admin contains dense table UIs (Object Manager, page layout
          editor, permission matrix) that we don't adapt for touch. Set
          the expectation upfront instead of letting the user fight
          cramped tables. Dismissible + persisted per-device. */}
      {isMobile && !desktopNoticeDismissed && (
        <div style={{
          flexShrink: 0,
          background: '#fef7e0',
          borderBottom: '1px solid #f5d680',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          fontSize: 13,
          color: '#8b5a00',
          lineHeight: 1.35,
        }}>
          <div style={{ flexShrink: 0, marginTop: 1 }}>
            <Icon path="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} color="#c97f0a" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontWeight: 600 }}>Admin works best on desktop.</strong>{' '}
            The Object Manager, page layout editor, and permission tools are designed for a larger screen.
          </div>
          <button
            onClick={dismissDesktopNotice}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              padding: 4,
              borderRadius: 4,
              cursor: 'pointer',
              color: '#8b5a00',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 28,
              minHeight: 28,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ─── Top bar — breadcrumb + reports ─────────────────────────── */}
      <div data-module-topbar="1" style={{
        height: 54, background: C.card, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1
            return (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span style={{ color: C.textMuted }}>/</span>}
                <span
                  onClick={crumb.onClick}
                  style={{
                    color: isLast ? C.textPrimary : C.textMuted,
                    fontWeight: isLast ? 500 : 400,
                    cursor: crumb.onClick ? 'pointer' : 'default',
                  }}
                  onMouseEnter={e => { if (crumb.onClick && !isLast) e.currentTarget.style.color = C.emerald }}
                  onMouseLeave={e => { if (crumb.onClick && !isLast) e.currentTarget.style.color = C.textMuted }}
                >
                  {crumb.label}
                </span>
              </span>
            )
          })}
        </div>
        <button style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
          padding: '6px 12px', fontSize: 12.5, color: C.textSecondary, cursor: 'pointer', fontWeight: 500,
        }}>
          <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" size={13} color={C.textSecondary}/>
          Reports
        </button>
      </div>

      {/* ─── Primary tab bar — Setup Home / Object Manager ──────────── */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '0 24px', display: 'flex', alignItems: 'center', flexShrink: 0,
      }}>
        <TabButton
          label="Setup Home"
          active={tab === 'setup' && !selectedRecord}
          onClick={() => { setTab('setup'); setSelectedObject(null); setSelectedRecord(null) }}
        />
        <TabButton
          label="Object Manager"
          active={tab === 'objects' && !selectedRecord}
          onClick={openObjectManager}
        />
      </div>

      {/* ─── Content ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {selectedRecord ? (
          <RecordDetail
            tableName={selectedRecord.table}
            recordId={selectedRecord.id}
            onBack={closeRecord}
            mode={selectedRecord.mode || 'view'}
            onRecordCreated={r => setSelectedRecord({ table: r.table, id: r.id })}
            prefill={selectedRecord.prefill}
            onNavigateToRecord={r => setSelectedRecord({ table: r.table, id: r.id, mode: r.mode, prefill: r.prefill })}
          />
        ) : tab === 'setup' ? (
          <SetupHome onOpenObjectManager={openObjectManager} onOpenRecord={openRecord} />
        ) : selectedObject ? (
          <ObjectDetail obj={selectedObject} onBack={() => setSelectedObject(null)} />
        ) : (
          <ObjectManager onOpenObject={obj => setSelectedObject(obj)} />
        )}
      </div>
    </div>
  )
}

// ─── Primary tab button ────────────────────────────────────────────────

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '11px 18px', background: 'none', border: 'none',
        borderBottom: active ? `2px solid ${C.emerald}` : '2px solid transparent',
        color: active ? C.textPrimary : C.textMuted,
        fontSize: 13, fontWeight: active ? 500 : 400,
        cursor: 'pointer', marginBottom: -1,
      }}
    >
      {label}
    </button>
  )
}

// ─── Breadcrumb builder ────────────────────────────────────────────────

function buildCrumbs(tab, selectedObject, selectedRecord) {
  const crumbs = [{ label: 'Admin', onClick: null }]
  if (tab === 'setup') {
    crumbs.push({ label: 'Setup Home', onClick: null })
  } else {
    crumbs.push({ label: 'Object Manager', onClick: null })
    if (selectedObject) crumbs.push({ label: selectedObject.pluralLabel, onClick: null })
  }
  if (selectedRecord) {
    crumbs.push({ label: selectedRecord.name || selectedRecord.table, onClick: null })
  }
  return crumbs
}
