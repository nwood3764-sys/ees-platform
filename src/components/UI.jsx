import { useState } from 'react';
import { C, STATUS_CFG, NAV_MODULES } from '../data/constants';

export function Badge({ s }) {
  const cfg = STATUS_CFG[s] || { bg: '#f0f3f8', color: '#4a5e7a', dot: '#8fa0b8' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: cfg.bg, color: cfg.color,
      fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap'
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
      {s}
    </span>
  );
}

export function Icon({ path, size = 15, color = 'currentColor', weight = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export function TableRow({ children, onClick, selected }) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: 'pointer',
        background: selected ? '#f0f9f5' : hovered ? '#f7f9fc' : 'transparent',
        transition: 'background 0.1s',
        borderLeft: selected ? `3px solid ${C.emerald}` : '3px solid transparent',
      }}
    >
      {children}
    </tr>
  );
}

export function ProgramTag({ value }) {
  if (!value) return <span style={{ color: C.textMuted }}>—</span>;
  return (
    <span style={{
      background: '#e8f3fb', color: '#1a5a8a',
      fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 3
    }}>
      {value}
    </span>
  );
}

export function Topbar({ breadcrumb, onReports }) {
  return (
    <div style={{
      height: 54, background: C.card, borderBottom: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', flexShrink: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        {breadcrumb.map((b, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: C.textMuted }}>/</span>}
            <span style={{
              color: i === breadcrumb.length - 1 ? C.textPrimary : C.textMuted,
              fontWeight: i === breadcrumb.length - 1 ? 500 : 400
            }}>{b}</span>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {onReports && (
          <button onClick={onReports} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
            padding: '6px 12px', fontSize: 12.5, color: C.textSecondary, cursor: 'pointer', fontWeight: 500
          }}>
            <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" size={13} color={C.textSecondary} />
            Reports
          </button>
        )}
      </div>
    </div>
  );
}

export function SectionTabs({ sections, active, onChange, counts = {}, urgentSections = {} }) {
  return (
    <div style={{
      background: C.card, borderBottom: `1px solid ${C.border}`,
      padding: '0 24px', display: 'flex', alignItems: 'center', flexShrink: 0
    }}>
      {sections.map(s => {
        const on = s.id === active;
        const count = counts[s.id];
        const urgent = urgentSections[s.id];
        return (
          <button key={s.id} onClick={() => onChange(s.id)} style={{
            padding: '10px 16px', background: 'none', border: 'none',
            borderBottom: on ? `2px solid ${C.emerald}` : '2px solid transparent',
            color: on ? C.textPrimary : C.textMuted, fontSize: 13,
            fontWeight: on ? 500 : 400, cursor: 'pointer', marginBottom: -1,
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            {s.label}
            {urgent > 0 && (
              <span style={{ background: C.danger, color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
                {urgent}
              </span>
            )}
            {count != null && !urgent && (
              <span style={{ background: C.page, color: C.textMuted, fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 10 }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ComingSoon({ label }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.borderDark} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      <div style={{ color: C.textPrimary, fontWeight: 500, fontSize: 16 }}>{label} — Coming Soon</div>
      <div style={{ color: C.textMuted, fontSize: 13 }}>This module is in the build queue.</div>
    </div>
  );
}

export function Sidebar({ activeModule, onModuleChange, userEmail, onSignOut, user = { name: 'Nicholas Wood', role: 'Admin', initials: 'NW' } }) {
  // If an auth email is provided, derive display values from it so the
  // sidebar reflects whoever is actually signed in rather than a hardcoded
  // default. Falls back to the `user` prop for non-auth usages.
  const displayName = userEmail ? userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : user.name
  const displayInitials = userEmail
    ? userEmail.split('@')[0].split(/[._]/).map((s) => s[0]?.toUpperCase() || '').join('').slice(0, 2)
    : user.initials
  const displayRole = userEmail ? userEmail : user.role
  return (
    <div style={{ width: 240, background: C.sidebar, display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100vh' }}>
      {/* Logo */}
      <div style={{ padding: '18px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: C.emerald, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        </div>
        <span style={{ color: C.navActive, fontWeight: 600, fontSize: 15 }}>Anura</span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {NAV_MODULES.map(m => {
          const on = m.id === activeModule;
          return (
            <div key={m.id} onClick={() => onModuleChange(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px',
                cursor: 'pointer', color: on ? C.navActive : C.navInactive,
                background: on ? C.sidebarHover : 'transparent',
                borderLeft: on ? `3px solid ${C.emerald}` : '3px solid transparent',
                fontSize: 13.5, fontWeight: on ? 500 : 400, transition: 'all 0.12s'
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = C.sidebarHover; }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon path={m.icon} color="currentColor" />
              {m.label}
            </div>
          );
        })}
      </nav>

      {/* User + sign out */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: C.emerald,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 600, color: '#07111f', flexShrink: 0
        }}>
          {displayInitials || 'U'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.navActive, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
          <div style={{ color: C.navInactive, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayRole}</div>
        </div>
        {onSignOut && (
          <button
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              borderRadius: 4,
              cursor: 'pointer',
              color: C.navInactive,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.navActive }}
            onMouseLeave={e => { e.currentTarget.style.color = C.navInactive }}
          >
            <Icon path="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" size={14} color="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
}
