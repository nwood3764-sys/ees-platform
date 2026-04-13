import { useState } from 'react'
import { Sidebar, ComingSoon } from './components/UI'
import AuthGate from './components/AuthGate'
import { C } from './data/constants'
import { supabase } from './lib/supabase'
import HomeModule from './modules/HomeModule'
import OutreachModule from './modules/OutreachModule'
import QualificationModule from './modules/QualificationModule'
import FieldModule from './modules/FieldModule'
import IncentivesModule from './modules/IncentivesModule'

function AuthedApp({ session }) {
  const [activeModule, setActiveModule] = useState('home')

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
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {renderModule()}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthGate>
      {(session) => <AuthedApp session={session} />}
    </AuthGate>
  )
}
