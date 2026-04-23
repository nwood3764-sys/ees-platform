import { useState, useEffect, lazy, Suspense } from 'react'
import { Sidebar, MobileHeader, ComingSoon } from './components/UI'
import AuthGate from './components/AuthGate'
import { ToastProvider } from './components/Toast'
import { C, NAV_MODULES } from './data/constants'
import { supabase } from './lib/supabase'

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
const PeopleModule        = lazy(() => import('./modules/PeopleModule'))
const AdminModule         = lazy(() => import('./modules/admin'))
const PortalModule        = lazy(() => import('./modules/PortalModule'))

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
        animation: 'anura-spin 0.7s linear infinite',
      }} />
      <div style={{ fontSize: 13 }}>Loading…</div>
    </div>
  )
}

function AuthedApp({ session }) {
  const [activeModule, setActiveModule] = useState('home')
  // Mobile menu drawer state. Desktop ignores this entirely — the Sidebar
  // component only honors mobileOpen when useIsMobile() is true.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Desktop sidebar collapse state. Persisted to localStorage so the choice
  // survives reloads. Ignored on mobile (the drawer is always full-width).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return localStorage.getItem('anura.sidebar.collapsed') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('anura.sidebar.collapsed', sidebarCollapsed ? '1' : '0') } catch { /* storage disabled */ }
  }, [sidebarCollapsed])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const renderModule = () => {
    switch (activeModule) {
      case 'home':          return <HomeModule onNavigate={setActiveModule} />
      case 'outreach':      return <OutreachModule />
      case 'qualification': return <QualificationModule />
      case 'field':         return <FieldModule />
      case 'incentives':    return <IncentivesModule />
      case 'stock':         return <StockModule />
      case 'fleet':         return <FleetModule />
      case 'people':        return <PeopleModule />
      case 'admin':         return <AdminModule />
      case 'portal':        return <PortalModule />
      default:              return <ComingSoon label={activeModule.charAt(0).toUpperCase() + activeModule.slice(1)} />
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Inter, -apple-system, sans-serif', background: C.page, overflow: 'hidden' }}>
      <Sidebar
        activeModule={activeModule}
        onModuleChange={setActiveModule}
        userEmail={session?.user?.email}
        onSignOut={handleSignOut}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <MobileHeader
          onOpenMenu={() => setMobileMenuOpen(true)}
          moduleLabel={NAV_MODULES.find(m => m.id === activeModule)?.label || 'Anura'}
          moduleIcon={NAV_MODULES.find(m => m.id === activeModule)?.icon}
        />
        <Suspense fallback={<ModuleLoader />}>
          {renderModule()}
        </Suspense>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthGate>
      {(session) => (
        <ToastProvider>
          <AuthedApp session={session} />
        </ToastProvider>
      )}
    </AuthGate>
  )
}
