// Topbar-menu stacking harness — NOT shipped.
//
// Mounts the REAL TopbarSetupGear inside the REAL topbar structure from
// App.jsx — the right-hand cluster, `position:absolute` with `z-index:10`,
// which is the stacking context that trapped the menu — above a record-shaped
// scroll region whose pinned header uses the REAL stickyHeaderBandStyle.
//
// Then a browser driver opens the menu and hit-tests its own pixels. That is
// the only way to answer "is the menu on top": every one of these menus read
// correctly in source (the gear asked for z-index 50, the user menu for 500)
// and painted underneath anyway.
//
// The gear is admin-gated, so getCurrentUserProfile is stubbed (stubs/
// layoutService.js). Everything else — the component, AnchoredPopover, the
// pinned-header module — is the shipped code.
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import TopbarSetupGear from '../../src/components/TopbarSetupGear'
import AnchoredPopover from '../../src/components/AnchoredPopover'
import { stickyHeaderBandStyle } from '../../src/lib/stickyRecordHeader'
import { C } from '../../src/data/constants'

// The POSITIVE CONTROL: the menu exactly as it shipped before the fix — an
// absolutely-positioned panel inside the cluster, asking for z-index 50. It
// must be found UNDER the record header. If the control ever reads as "on
// top", the hit-test is not looking at these menus and every PASS is worthless.
function LegacyAbsoluteMenu({ open }) {
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button id="legacy-trigger" type="button">legacy</button>
      {open && (
        <div id="legacy-menu" role="menu" style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          minWidth: 240, background: '#fff', border: `1px solid ${C.border}`,
          borderRadius: 6, boxShadow: '0 6px 16px rgba(15,23,42,0.10)',
          zIndex: 50, padding: '4px 0',
        }}>
          <div style={{ padding: '8px 14px' }}>Legacy item one</div>
          <div style={{ padding: '8px 14px' }}>Legacy item two</div>
          <div style={{ padding: '8px 14px' }}>Legacy item three</div>
          <div style={{ padding: '8px 14px' }}>Legacy item four</div>
        </div>
      )}
    </div>
  )
}

// A second control in the other direction: the SAME content through the shipped
// portal. Proves the harness can distinguish the two, so a PASS on the real
// gear means the portal, not the harness being blind to both.
function PortalledMenu({ open, onClose }) {
  const ref = useRef(null)
  return (
    <div style={{ display: 'inline-block' }}>
      <button id="portal-trigger" ref={ref} type="button">portal</button>
      <AnchoredPopover
        anchorRef={ref} open={open} onClose={onClose} role="menu"
        width={240} align="right" maxHeight={420}
        panelStyle={{ background: '#fff', border: `1px solid ${C.border}`, padding: '4px 0' }}
      >
        <div id="portal-menu-body">
          <div style={{ padding: '8px 14px' }}>Portal item one</div>
          <div style={{ padding: '8px 14px' }}>Portal item two</div>
          <div style={{ padding: '8px 14px' }}>Portal item three</div>
          <div style={{ padding: '8px 14px' }}>Portal item four</div>
        </div>
      </AnchoredPopover>
    </div>
  )
}

function Shell() {
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [portalOpen, setPortalOpen] = useState(false)
  window.__openLegacy = () => setLegacyOpen(true)
  window.__openPortal = () => setPortalOpen(true)

  return (
    <div id="shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* The topbar, as App.jsx builds it: a relative strip holding the search
          bar, with the right-hand cluster absolutely positioned over it. */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ height: 44, borderBottom: `1px solid ${C.border}`, background: '#fff' }} />
        <div id="cluster" style={{
          position: 'absolute', top: 7, right: 16, zIndex: 10,
          pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <LegacyAbsoluteMenu open={legacyOpen} />
          <PortalledMenu open={portalOpen} onClose={() => setPortalOpen(false)} />
          <TopbarSetupGear
            selectedRecord={{ table: 'properties', id: 'rec-1' }}
            listTable={null}
            activeModule="enrollment"
            section="properties"
            onOpenSetup={() => {}}
          />
        </div>
      </div>

      {/* The record page underneath, with the REAL pinned header band. */}
      <div id="record" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div id="band" style={stickyHeaderBandStyle({ padX: 24, padY: 20, condensed: false })}>
          <div style={{ fontSize: 12, color: C.textSecondary }}>
            1056 Hillview Drive - Whitewater / 1056 Hillview Drive - Whitewater - 1056
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button style={{ padding: '8px 14px' }}>Edit</button>
            <button style={{ padding: '8px 14px' }}>Send for Signature</button>
            <button style={{ padding: '8px 14px' }}>Actions</button>
          </div>
        </div>
        <div style={{ height: 2400 }} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Shell />)
