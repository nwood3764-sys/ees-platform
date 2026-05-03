import { useState, useEffect, lazy, Suspense } from 'react'
import { Sidebar, MobileHeader, ComingSoon } from './components/UI'
import AuthGate from './components/AuthGate'
import { ToastProvider } from './components/Toast'
import PasswordChangeModal from './components/PasswordChangeModal'
import IntegrationsModal from './components/IntegrationsModal'
import OutlookCallback from './pages/OutlookCallback'
import { GlobalSearchTrigger, GlobalSearchModal } from './components/GlobalSearch'
import { C, NAV_MODULES } from './data/constants'
import { supabase } from './lib/supabase'
import { useInputFocusScroll } from './lib/useInputFocusScroll'
import { useUrlNavigation } from './lib/urlNav'

// ─── Lazy-loaded modules ─────────────────────────────────────────────────────
// Each module becomes its own webpack/rollup chunk. Only the active module's
// JavaScript is downloaded, parsed, and evaluated. Switching modules fetches
// the chunk on demand and caches it for the session.
//
// Impact: initial bundle drops significantly. First meaningful paint on
// cellular improves, and Admin (the largest single module) no longer loads
// for users who never open it.
// ─────────────────────────────────────────────────────────────────────────────
const HomeModule          = lazy(() => import('./modules/HomeModule'))
const OutreachModule      = lazy(() => import('./modules/OutreachModule'))
const QualificationModule = lazy(() => import('./modules/QualificationModule'))
const FieldModule         = lazy(() => import('./modules/FieldModule'))
const IncentivesModule    = lazy(() => import('./modules/IncentivesModule'))
const StockModule         = lazy(() => import('./modules/StockModule'))
const FleetModule         = lazy(() => import('./modules/FleetModule'))
const AdminModule         = lazy(() => import('./modules/admin'))
const PortalModule        = lazy(() => import('./modules/PortalModule'))
const SearchResultsPage   = lazy(() => import('./modules/SearchResultsPage'))

// ─── Module loading fallback ─────────────────────────────────────────────────
// Shown while a lazy chunk is in flight. Minimal + branded so the user sees
// it for a beat rather than a white flash. Page background so the handoff
// to the real module is visually seamless.
function ModuleLoader() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: C.page, color: C.textMuted, gap: 12,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: `2.5px solid ${C.border}`,
        borderTopColor: C.emerald,
        animation: 'ees-spin 0.7s linear infinite',
      }} />
      <div style={{ fontSize: 13 }}>Loading…</div>
    </div>
  )
}

function AuthedApp({ session }) {
  // URL-driven navigation. Replaces what used to be a local activeModule
  // useState — now `activeModule` and `selectedRecord` come from the URL,
  // which means every record has a stable shareable address. See
  // src/lib/urlNav.js for the URL scheme and the table-to-module map.
  const {
    activeModule,
    selectedRecord,
    sectionFromUrl,
    searchQuery,
    searchType,
    navigateToModule,
    navigateToSection,
    navigateToRecord,
    navigateToSearch,
    closeRecord,
    replaceRecord,
  } = useUrlNavigation()

  // Mobile menu drawer state. Desktop ignores this entirely — the Sidebar
  // component only honors mobileOpen when useIsMobile() is true.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Whether the change-password modal is open. Lives at the app root rather
  // than inside Sidebar/UserMenu because the modal is a full-screen overlay
  // and shouldn't be clipped by the sidebar's container.
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  // Integrations modal — Outlook Connect/Disconnect today, room for more later.
  const [integrationsOpen, setIntegrationsOpen] = useState(false)
  // Global search modal — opens via top-bar trigger, mobile header magnifier,
  // or Cmd/Ctrl+K. Lives at the app root so the modal portal can sit above
  // every module and the keyboard shortcut works regardless of which module
  // is currently mounted.
  const [searchOpen, setSearchOpen] = useState(false)
  // Desktop sidebar collapse state. Persisted to localStorage so the choice
  // survives reloads. Ignored on mobile (the drawer is always full-width).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return localStorage.getItem('ees.sidebar.collapsed') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('ees.sidebar.collapsed', sidebarCollapsed ? '1' : '0') } catch { /* storage disabled */ }
  }, [sidebarCollapsed])

  // Global: when an input focuses on a touch device, scroll it into view
  // once the keyboard has finished opening. Quiet no-op on desktop.
  useInputFocusScroll()

  // Edge-swipe to open the mobile nav drawer (iOS-native pattern).
  // Listens for touchstart within 20px of the left screen edge; if the user
  // drags rightward more than 60px and the drawer is closed, opens it.
  // Desktop listeners remain dormant. Skipped when the drawer is already open
  // — useSwipeToDismiss on the drawer itself handles close-by-swipe.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (!isTouch) return
    let startX = null, startY = null
    const onStart = (e) => {
      if (mobileMenuOpen) return
      const t = e.touches[0]
      if (!t) return
      // Only engage if the touch starts right at the left edge
      if (t.clientX > 20) return
      startX = t.clientX; startY = t.clientY
    }
    const onMove = (e) => {
      if (startX == null) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      // Trigger only on a clearly rightward drag (dx dominates dy)
      if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        setMobileMenuOpen(true)
        startX = null; startY = null
      }
    }
    const onEnd = () => { startX = null; startY = null }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [mobileMenuOpen])

  // Global Cmd/Ctrl+K shortcut to open universal search. Mirrors the
  // ubiquitous spotlight/quick-find pattern (Salesforce, Linear, Notion,
  // GitHub). Listens at document level so the shortcut works regardless of
  // which module is mounted or which element is focused. preventDefault
  // suppresses the browser's "search bookmarks" default on Firefox.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKey = (e) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const renderModule = () => {
    // All modules accept the same nav-prop bundle so any of them can drive
    // record-detail open/close via the URL. Modules without a record-detail
    // surface (HomeModule, PortalModule today) ignore them; the prop is
    // harmless to receive.
    const navProps = {
      selectedRecord,
      sectionFromUrl,
      onNavigateToRecord: navigateToRecord,
      onCloseRecord: closeRecord,
      onSectionChange: navigateToSection,
      onReplaceRecord: replaceRecord,
    }
    switch (activeModule) {
      case 'home':          return <HomeModule onNavigate={navigateToModule} />
      case 'outreach':      return <OutreachModule {...navProps} />
      case 'qualification': return <QualificationModule {...navProps} />
      case 'field':         return <FieldModule {...navProps} />
      case 'incentives':    return <IncentivesModule {...navProps} />
      case 'stock':         return <StockModule {...navProps} />
      case 'fleet':         return <FleetModule {...navProps} />
      case 'admin':         return <AdminModule {...navProps} />
      case 'portal':        return <PortalModule {...navProps} />
      case 'search':        return (
        <SearchResultsPage
          searchQuery={searchQuery}
          searchType={searchType}
          onNavigateToRecord={navigateToRecord}
          onNavigateToSearch={navigateToSearch}
        />
      )
      default:              return <ComingSoon label={activeModule.charAt(0).toUpperCase() + activeModule.slice(1)} />
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Inter, -apple-system, sans-serif', background: C.page, overflow: 'hidden' }}>
      <Sidebar
        activeModule={activeModule}
        onModuleChange={navigateToModule}
        userEmail={session?.user?.email}
        onSignOut={handleSignOut}
        onChangePassword={() => setPasswordModalOpen(true)}
        onOpenIntegrations={() => setIntegrationsOpen(true)}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <MobileHeader
          onOpenMenu={() => setMobileMenuOpen(true)}
          moduleLabel={NAV_MODULES.find(m => m.id === activeModule)?.label || 'Energy Efficiency Services'}
          moduleIcon={NAV_MODULES.find(m => m.id === activeModule)?.icon}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <GlobalSearchTrigger onOpen={() => setSearchOpen(true)} />
        <Suspense fallback={<ModuleLoader />}>
          {renderModule()}
        </Suspense>
      </div>

      {searchOpen && (
        <GlobalSearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onNavigate={navigateToRecord}
          onViewAll={(q) => navigateToSearch(q)}
        />
      )}

      {passwordModalOpen && (
        <PasswordChangeModal
          userEmail={session?.user?.email}
          onClose={() => setPasswordModalOpen(false)}
        />
      )}

      {integrationsOpen && (
        <IntegrationsModal
          onClose={() => setIntegrationsOpen(false)}
        />
      )}
    </div>
  )
}

export default function App() {
  // /auth/outlook-callback bypasses the module chrome (no sidebar) but still
  // runs inside AuthGate — the callback edge fn requires the user's Supabase
  // JWT. ToastProvider is included so the success page can use toasts later
  // if we add them.
  const isOutlookCallback = typeof window !== 'undefined'
    && window.location.pathname === '/auth/outlook-callback'

  return (
    <AuthGate>
      {(session) => (
        <ToastProvider>
          {isOutlookCallback
            ? (
              <div style={{ display: 'flex', height: '100vh', fontFamily: 'Inter, -apple-system, sans-serif', background: C.page }}>
                <OutlookCallback />
              </div>
            )
            : <AuthedApp session={session} />}
        </ToastProvider>
      )}
    </AuthGate>
  )
}
