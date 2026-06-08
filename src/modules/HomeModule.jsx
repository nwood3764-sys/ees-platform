import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { Icon } from '../components/UI'
import { resolveHomePage } from '../data/adminService'
import { getTemplate } from './admin/homePageTemplates'
import HomeComponentRenderer from './admin/HomeComponentRenderer'

// HomeModule renders the home screen entirely from a configured Home Page
// (home_pages + home_page_components), resolved per the current user's role
// or the org default. There is no built-in/hardcoded dashboard: the home
// screen is data-driven and editable through the Home Page builder in Setup,
// consistent with the rest of the platform. If no page resolves, the user is
// pointed at the builder to create one.
export default function HomeModule({ onNavigate, onOpenSetup, onOpenRecord }) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // undefined = loading, null = none resolved, object = configured page
  const [customPage, setCustomPage] = useState(undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    resolveHomePage()
      .then(p => { if (!cancelled) setCustomPage(p || null) })
      .catch(err => { if (!cancelled) { setError(err); setCustomPage(null) } })
    return () => { cancelled = true }
  }, [])

  if (customPage === undefined) {
    return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:C.textMuted, fontSize:13 }}>Loading home…</div>
  }

  if (error) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, padding:24 }}>
        <div style={{ color:'#b03a2e', fontSize:13, fontWeight:600 }}>Could not load the home page</div>
        <div style={{ color:C.textMuted, fontSize:12, fontFamily:'JetBrains Mono, monospace', maxWidth:560, textAlign:'center' }}>{String(error.message || error)}</div>
      </div>
    )
  }

  // No configured home page — point the user at the builder rather than
  // showing a hardcoded screen.
  if (!customPage) {
    return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div data-module-topbar="1" style={{ height: 54, background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: C.textMuted }}>Home</span>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
          <div style={{ color: C.textPrimary, fontSize: 15, fontWeight: 600 }}>No home page configured</div>
          <div style={{ color: C.textMuted, fontSize: 13, maxWidth: 440, textAlign: 'center' }}>
            Create a home page in Setup to define the landing screen for your team. Assign it to a role or set it as the org-wide default.
          </div>
          {onOpenSetup && (
            <button onClick={() => onOpenSetup('home_pages')}
              style={{ background: C.emerald, border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
              Open Home Page Builder
            </button>
          )}
        </div>
      </div>
    )
  }

  const tmpl = getTemplate(customPage.template)
  const comps = customPage.components || []
  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div data-module-topbar="1" style={{ height: 54, background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: C.textMuted }}>Home</span>
          <span style={{ color: C.textMuted }}>/</span>
          <span style={{ color: C.textPrimary, fontWeight: 500 }}>{customPage.name || 'Home'}</span>
        </div>
        {onOpenSetup && (
          <button onClick={() => onOpenSetup('home_pages')}
            style={{ background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 14px', fontSize: 12.5, color: C.textSecondary, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon path="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" size={13} color="currentColor" /> Edit Page
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: C.textMuted }}>{greeting} · {today}</div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {tmpl.regions.map(region => {
            const regionComps = comps.filter(c => c.region === region.key).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            return (
              <div key={region.key} style={{ flex: region.flex, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {regionComps.map(c => (
                  <HomeComponentRenderer key={c.id} component={{ type: c.type, sourceId: c.source_id, title: c.title, config: c.config }} onNavigate={(table, id) => onOpenRecord && onOpenRecord({ table, id, mode: 'view' })} />
                ))}
                {regionComps.length === 0 && <div style={{ color: C.textMuted, fontSize: 12, padding: 12 }}>&nbsp;</div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
