// Record-header pinning harness — NOT shipped.
//
// Mounts the REAL RecordDetail (with its data layer stubbed, see
// stubs/layoutService.js) inside the same shell the app gives it: a fixed-height
// flex column whose only scrolling child is the record's own content region.
// A browser driver then scrolls that region and measures what the user sees.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from '../../src/components/Toast'
import RecordDetail from '../../src/components/RecordDetail'

function Shell() {
  return (
    <ToastProvider>
      {/* The module surface: a viewport-height column, exactly as App renders it. */}
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
