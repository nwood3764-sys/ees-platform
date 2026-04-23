import { useState } from 'react'
import { Sidebar, MobileHeader, ComingSoon } from './components/UI'
import AuthGate from './components/AuthGate'
import { ToastProvider } from './components/Toast'
import { C } from './data/constants'
import { supabase } from './lib/supabase'
import HomeModule from './modules/HomeModule'
import OutreachModule from './modules/OutreachModule'
import QualificationModule from './modules/QualificationModule'
import FieldModule from './modules/FieldModule'
import IncentivesModule from './modules/IncentivesModule'
import StockModule from './modules/StockModule'
import FleetModule from './modules/FleetModule'
import PeopleModule from './modules/PeopleModule'
import AdminModule from './modules/admin'
import PortalModule from './modules/PortalModule'

function AuthedApp({ session }) {
  const [activeModule, setActiveModule] = useState('home')
  // Mobile menu drawer state. Desktop ignores this entirely — the Sidebar
  // component only honors mobileOpen when useIsMobile() is true.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <MobileHeader onOpenMenu={() => setMobileMenuOpen(true)} />
        {renderModule()}
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
