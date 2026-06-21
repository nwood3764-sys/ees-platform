import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Sidebar, MobileHeader, ComingSoon } from './components/UI'
import AuthGate from './components/AuthGate'
import { ToastProvider } from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import PasswordChangeModal from './components/PasswordChangeModal'
import IntegrationsModal from './components/IntegrationsModal'
import OutlookCallback from './pages/OutlookCallback'
import { GlobalSearchInline } from './components/GlobalSearch'
import { HelpProvider } from './components/help/HelpProvider'
import HelpPanel from './components/help/HelpPanel'
import HelpTopbarButton from './components/help/HelpTopbarButton'
import TopbarSetupGear from './components/TopbarSetupGear'
import TopbarUserMenu from './components/TopbarUserMenu'
import AssistantPanel from './components/AssistantPanel'
import NotificationBell from './components/NotificationBell'
import { C, NAV_MODULES } from './data/constants'
import { fetchAccessibleModules, moduleAllowed, fetchCanUseViewAs, fetchAllRoles, fetchModuleAccessForRole } from './data/layoutService'
import { supabase } from './lib/supabase'
import { useInputFocusScroll } from './lib/useInputFocusScroll'
import { useIsMobile } from './lib/useMediaQuery'
import { useUrlNavigation, getTableForSection } from './lib/urlNav'

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
const TasksModule         = lazy(() => import('./modules/TasksModule'))
const OutreachModule      = lazy(() => import('./modules/OutreachModule'))
const OutreachPropertiesModule = lazy(() => import('./modules/OutreachPropertiesModule'))
const QualificationModule = lazy(() => import('./modules/QualificationModule'))
const FieldModule         = lazy(() => import('./modules/FieldModule'))
const ProjectPlanningModule       = lazy(() => import('./modules/ProjectPlanningModule'))
const ProjectImplementationModule = lazy(() => import('./modules/ProjectImplementationModule'))
const DispatchModule      = lazy(() => import('./modules/DispatchModule'))
const IncentivesModule    = lazy(() => import('./modules/IncentivesModule'))
const StockModule         = lazy(() => import('./modules/StockModule'))
const FleetModule         = lazy(() => import('./modules/FleetModule'))
const ReportsModule       = lazy(() => import('./modules/ReportsModule'))
const AdminModule         = lazy(() => import('./modules/admin'))
const PortalModule        = lazy(() => import('./modules/PortalModule'))
const SearchResultsPage   = lazy(() => import('./modules/SearchResultsPage'))
const HelpCenterPage      = lazy(() => import('./pages/HelpCenterPage'))

// ─── View As control ─────────────────────────────────────────────────────────
// Topbar dropdown for permitted users (Admin / Project Coordinator) to preview
// another role's module navigation for troubleshooting. Simulates nav only —
// never identity or data access. Excludes the user's inability to escalate:
// the picker lists roles, and the server (module_access_for_role) re-checks
// permission, so this is a UI convenience over a server-enforced capability.
function ViewAsControl({ roles, active, onStart, onExit }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => (active ? onExit() : setOpen(o => !o))}
        title="View as role (troubleshooting)"
        aria-label="View as role"
        style={{
          appearance: 'none', cursor: 'pointer',
          width: 32, height: 32, borderRadius: 6,
          background: active ? '#07111f' : 'transparent',
          border: `1px solid ${active ? '#07111f' : C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
          stroke={active ? '#7eb3e8' : C.textSecondary}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {open && !active && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{
            position: 'absolute', top: 38, right: 0, zIndex: 41,
            width: 240, maxHeight: 360, overflowY: 'auto',
            background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8,
            boxShadow: '0 8px 24px rgba(13,26,46,0.16)', padding: 6,
          }}>
            <div style={{
              padding: '6px 10px 8px', fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.4, color: C.textMuted,
            }}>
              View navigation as
            </div>
            {roles.map(r => (
              <button
                key={r.id}
                onClick={() => { setOpen(false); onStart(r.id, r.role_name) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', appearance: 'none',
                  cursor: 'pointer', background: 'transparent', border: 'none',
                  padding: '9px 10px', borderRadius: 6, fontSize: 13.5, color: C.textPrimary,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = C.page)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {r.role_name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

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
    subsectionFromUrl,
    adminTabFromUrl,
    adminLayoutIdFromUrl,
    searchQuery,
    searchType,
    helpSlug,
    navigateToModule,
    navigateToSection,
    navigateToSubsection,
    navigateToSetup,
    navigateToRecord,
    navigateToSearch,
    closeRecord,
    replaceRecord,
  } = useUrlNavigation()

  // Module-level access. Loaded once per session; until it resolves we render
  // nothing role-gated (avoids a flash of modules the user can't keep). Admin
  // resolves to ['*'] and sees everything. Field/trade roles see only their
  // granted modules; portal roles see none of the internal app.
  const [accessibleModules, setAccessibleModules] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchAccessibleModules()
      .then(list => { if (!cancelled) setAccessibleModules(list) })
      .catch(() => { if (!cancelled) setAccessibleModules([]) })
    return () => { cancelled = true }
  }, [])

  // The sidebar list filtered to what this user may access.
  // ── View As (troubleshooting) ──────────────────────────────────────────────
  // A permitted user (Admin / Project Coordinator) can simulate another role's
  // module visibility. This overrides ONLY the nav set — never identity or data
  // access. viewAs = { roleId, roleName, modules } when active, else null.
  const [canViewAs, setCanViewAs] = useState(false)
  const [viewAsRoles, setViewAsRoles] = useState([])
  const [viewAs, setViewAs] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchCanUseViewAs().then(async (ok) => {
      if (cancelled || !ok) return
      setCanViewAs(true)
      try { setViewAsRoles(await fetchAllRoles()) } catch { /* non-fatal */ }
    })
    return () => { cancelled = true }
  }, [])

  const startViewAs = async (roleId, roleName) => {
    try {
      const modules = await fetchModuleAccessForRole(roleId)
      setViewAs({ roleId, roleName, modules })
      navigateToModule('home')
    } catch { /* surfaced by toast elsewhere; keep current view on failure */ }
  }
  const exitViewAs = () => { setViewAs(null) }

  // Effective module access = simulated set when View As is active, else own.
  const effectiveAccess = viewAs ? viewAs.modules : accessibleModules

  const navModules = effectiveAccess
    ? NAV_MODULES.filter(m => moduleAllowed(effectiveAccess, m.id))
    : NAV_MODULES

  // Guard: if the URL points at a module the user can't access, redirect to
  // their first allowed module (or home). Runs once access is known.
  useEffect(() => {
    if (!effectiveAccess) return
    if (activeModule && activeModule !== 'search' && activeModule !== 'help'
        && !moduleAllowed(effectiveAccess, activeModule)) {
      const fallback = navModules[0]?.id || 'home'
      navigateToModule(fallback)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAccess, activeModule])

  // Mobile menu drawer state. Desktop ignores this entirely — the Sidebar
  // component only honors mobileOpen when useIsMobile() is true.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Whether the change-password modal is open. Lives at the app root rather
  // than inside Sidebar/UserMenu because the modal is a full-screen overlay
  // and shouldn't be clipped by the sidebar's container.
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  // Integrations modal — Outlook Connect/Disconnect today, room for more later.
  const [integrationsOpen, setIntegrationsOpen] = useState(false)
  // Mobile search slide-down. Desktop's search bar is always visible so it
  // doesn't need a flag — just focus the input. On mobile the input is
  // hidden until the user taps the magnifier in MobileHeader.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  // Ref to the inline search input so the global Cmd/Ctrl+K listener can
  // focus it directly on desktop. On mobile the same listener flips
  // mobileSearchOpen and the component auto-focuses on mount.
  const searchInputRef = useRef(null)
  const isMobile = useIsMobile()
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

  // Global Cmd/Ctrl+K shortcut. Mirrors the ubiquitous spotlight/quick-find
  // pattern (Salesforce, Linear, Notion, GitHub). On desktop the search
  // bar is always visible — focus its input. On mobile the bar is hidden
  // by default — open the slide-down (component auto-focuses on mount).
  // preventDefault suppresses the browser's "search bookmarks" default on
  // Firefox.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKey = (e) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        if (isMobile) setMobileSearchOpen(true)
        else searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isMobile])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const renderModule = () => {
    // Module access guard. While access is resolving, or when the active
    // module isn't permitted (the redirect effect will move us), render a
    // neutral loading state rather than flash a module the user can't keep.
    if (!effectiveAccess) return <ModuleLoader />
    if (activeModule && activeModule !== 'search' && activeModule !== 'help'
        && !moduleAllowed(effectiveAccess, activeModule)) {
      return <ModuleLoader />
    }
    // All modules accept the same nav-prop bundle so any of them can drive
    // record-detail open/close via the URL. Modules without a record-detail
    // surface (HomeModule, PortalModule today) ignore them; the prop is
    // harmless to receive.
    const navProps = {
      selectedRecord,
      sectionFromUrl,
      subsectionFromUrl,
      adminTabFromUrl,
      adminLayoutIdFromUrl,
      onNavigateToRecord: navigateToRecord,
      onCloseRecord: closeRecord,
      onSectionChange: navigateToSection,
      onSubsectionChange: navigateToSubsection,
      onReplaceRecord: replaceRecord,
      onOpenSetup: navigateToSetup,
    }
    switch (activeModule) {
      case 'home':          return <HomeModule onNavigate={navigateToModule} onOpenSetup={navigateToSetup} onOpenRecord={navigateToRecord} />
      case 'tasks':         return <TasksModule {...navProps} />
      case 'enrollment':    return <OutreachModule {...navProps} />
      case 'outreach':      return <OutreachPropertiesModule {...navProps} />
      case 'qualification': return <QualificationModule {...navProps} />
      case 'field':         return <FieldModule {...navProps} />
      case 'planning':      return <ProjectPlanningModule {...navProps} />
      case 'implementation':return <ProjectImplementationModule {...navProps} />
      case 'dispatch':      return <DispatchModule {...navProps} />
      case 'incentives':    return <IncentivesModule {...navProps} />
      case 'stock':         return <StockModule {...navProps} />
      case 'fleet':         return <FleetModule {...navProps} />
      case 'reports':       return <ReportsModule {...navProps} />
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
      case 'help':          return <HelpCenterPage initialSlug={helpSlug} />
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
        modules={navModules}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <MobileHeader
          onOpenMenu={() => setMobileMenuOpen(true)}
          moduleLabel={NAV_MODULES.find(m => m.id === activeModule)?.label || 'Energy Efficiency Services'}
          moduleIcon={NAV_MODULES.find(m => m.id === activeModule)?.icon}
          onOpenSearch={() => setMobileSearchOpen(true)}
        />
        {/* Inline universal search + Help button. The search bar's own
            container is a centered 44px-tall row with border-bottom; we
            layer the HelpTopbarButton absolutely on top of it at right
            so it appears in the same row without disrupting the search
            input's centering. Hidden on the search results page itself,
            which has its own dedicated input — two would just be
            confusing — and on the Help Center page (since the panel
            wouldn't add value while reading articles full-width).
            */}
        {activeModule !== 'search' && activeModule !== 'help' && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <GlobalSearchInline
              inputRef={searchInputRef}
              mobileOpen={mobileSearchOpen}
              onCloseMobile={() => setMobileSearchOpen(false)}
              onNavigate={navigateToRecord}
              onViewAll={(q) => navigateToSearch(q)}
            />
            {/* Right-cluster: Help / Setup gear / User avatar — Salesforce
                top-right pattern. Absolute-positioned so we layer over the
                centered search bar without disrupting its layout. Hidden on
                mobile (the MobileHeader has its own profile/menu path). */}
            {!isMobile && (
              <div style={{
                position: 'absolute',
                top: 7,
                right: 16,
                zIndex: 10,
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <HelpTopbarButton
                  activeModule={activeModule}
                  selectedRecord={selectedRecord}
                />
                <NotificationBell onNavigateToRecord={navigateToRecord} />
                <TopbarSetupGear
                  selectedRecord={selectedRecord}
                  listTable={getTableForSection(activeModule, sectionFromUrl)}
                  activeModule={activeModule}
                  section={sectionFromUrl}
                  onOpenSetup={navigateToSetup}
                />
                <TopbarUserMenu
                  userEmail={session?.user?.email}
                  onSignOut={handleSignOut}
                  onChangePassword={() => setPasswordModalOpen(true)}
                  onOpenIntegrations={() => setIntegrationsOpen(true)}
                />
                {canViewAs && (
                  <ViewAsControl
                    roles={viewAsRoles}
                    active={viewAs}
                    onStart={startViewAs}
                    onExit={exitViewAs}
                  />
                )}
              </div>
            )}
          </div>
        )}
        {viewAs && (
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: '7px 14px',
            background: '#07111f', color: 'rgba(255,255,255,0.96)',
            fontSize: 13, fontWeight: 600,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7eb3e8"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
              </svg>
              Viewing as <span style={{ color: '#7eb3e8' }}>{viewAs.roleName}</span> — navigation is simulated; your data access is unchanged
            </span>
            <button
              onClick={exitViewAs}
              style={{
                appearance: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,0.12)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.22)', borderRadius: 6,
                fontSize: 12, fontWeight: 700, padding: '4px 12px',
              }}
            >
              Exit
            </button>
          </div>
        )}
        <Suspense fallback={<ModuleLoader />}>
          {/* Per-module error boundary. A crash inside any lazy module
              is contained here — the sidebar, topbar, and the rest of
              the chrome stay alive so the user can navigate away from
              the broken view. resetKeys auto-clears the error when the
              user changes modules or records, so navigating away from
              a broken record is enough to recover.

              Top-level boundary lives below in <App /> as a safety net
              for crashes in the chrome itself. */}
          <ErrorBoundary
            scope={`module:${activeModule || 'unknown'}`}
            resetKeys={[activeModule, selectedRecord?.id]}
          >
            {renderModule()}
          </ErrorBoundary>
        </Suspense>
      </div>

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

      <AssistantPanel
        activeModule={activeModule}
        selectedRecord={selectedRecord}
        listTable={getTableForSection(activeModule, sectionFromUrl)}
        onNavigateToRecord={navigateToRecord}
      />
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
    <ErrorBoundary scope="app">
      <AuthGate>
        {(session) => (
          <ToastProvider>
            <HelpProvider>
              {isOutlookCallback
                ? (
                  <div style={{ display: 'flex', height: '100vh', fontFamily: 'Inter, -apple-system, sans-serif', background: C.page }}>
                    <OutlookCallback />
                  </div>
                )
                : <AuthedApp session={session} />}
              {/* Global help side panel — opened by any HelpIcon anywhere in the tree. */}
              <HelpPanel />
            </HelpProvider>
          </ToastProvider>
        )}
      </AuthGate>
    </ErrorBoundary>
  )
}
