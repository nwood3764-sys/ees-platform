// Record-header FLICKER harness — NOT shipped.
//
// The sibling tool (tools/record-header-check) asks whether the pinned header
// stays on screen. This one asks whether it holds STILL — mounting the same
// real RecordDetail so a browser driver can scroll it the way a person does and
// watch what the band's height does afterwards.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from '../../src/components/Toast'
import RecordDetail from '../../src/components/RecordDetail'

function Shell() {
  return (
    <ToastProvider>
      <div id="shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <RecordDetail
          tableName="incentive_applications"
          recordId="rec-1"
          mode="view"
          onBack={() => {}}
          onNavigateToRecord={() => {}}
        />
      </div>
    </ToastProvider>
  )
}

createRoot(document.getElementById('root')).render(<Shell />)
