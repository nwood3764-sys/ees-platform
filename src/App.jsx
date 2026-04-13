import { useState } from 'react'
import { Sidebar, ComingSoon } from './components/UI'
import { C } from './data/constants'
import HomeModule from './modules/HomeModule'
import OutreachModule from './modules/OutreachModule'
import QualificationModule from './modules/QualificationModule'
import FieldModule from './modules/FieldModule'
import IncentivesModule from './modules/IncentivesModule'

export default function App() {
  const [activeModule, setActiveModule] = useState('home')

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
      <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {renderModule()}
      </div>
    </div>
  )
}
