import { useState, useEffect } from 'react';
import { C, STATUS_CFG, NAV_MODULES } from '../data/constants';
import { useIsMobile } from '../lib/useMediaQuery';

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

export function TableRow({ children, onClick, onDoubleClick, selected }) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr
      onClick={onClick}
      onDoubleClick={onDoubleClick}
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

// ─── Sidebar ─────────────────────────────────────────────────────────────────
// Desktop (≥ 769px): fixed 240px inline column — renders as a flex child.
// Mobile (≤ 768px):  slide-in drawer with backdrop. Hidden until `mobileOpen`.
//                    Tapping a module closes the drawer automatically.
//                    The caller is responsible for the hamburger that opens it
//                    (see MobileHeader below) and for maintaining `mobileOpen`.
// ─────────────────────────────────────────────────────────────────────────────
export function Sidebar({
  activeModule,
  onModuleChange,
  userEmail,
  onSignOut,
  user = { name: 'Nicholas Wood', role: 'Admin', initials: 'NW' },
  mobileOpen = false,
  onMobileClose,
}) {
  const isMobile = useIsMobile();

  // Derive display values from the authenticated email when available so the
  // sidebar reflects whoever is actually signed in rather than a hardcoded
  // default. Falls back to the `user` prop for non-auth usages.
  const displayName = userEmail ? userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : user.name;
  const displayInitials = userEmail
    ? userEmail.split('@')[0].split(/[._]/).map((s) => s[0]?.toUpperCase() || '').join('').slice(0, 2)
    : user.initials;
  const displayRole = userEmail ? userEmail : user.role;

  // ESC closes the drawer on mobile
  useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    const handler = (e) => { if (e.key === 'Escape' && onMobileClose) onMobileClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMobile, mobileOpen, onMobileClose]);

  const handleModuleClick = (id) => {
    onModuleChange(id);
    if (isMobile && onMobileClose) onMobileClose();
  };

  // On mobile, when drawer is closed, render nothing (keeps the DOM clean and
  // prevents the fixed element from intercepting taps).
  if (isMobile && !mobileOpen) return null;

  // Shared inner content (same on desktop and mobile)
  const inner = (
    <>
      {/* Logo (desktop only; mobile shows the logo in the header bar) */}
      {!isMobile && (
        <div style={{ padding: '18px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: C.emerald, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <span style={{ color: C.navActive, fontWeight: 600, fontSize: 15 }}>Anura</span>
        </div>
      )}

      {/* Mobile drawer header: logo left, close button right */}
      {isMobile && (
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: C.emerald, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <span style={{ color: C.navActive, fontWeight: 600, fontSize: 16 }}>Anura</span>
          </div>
          <button
            onClick={onMobileClose}
            aria-label="Close menu"
            style={{
              background: 'transparent', border: 'none', padding: 6, borderRadius: 6,
              cursor: 'pointer', color: C.navInactive, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {NAV_MODULES.map(m => {
          const on = m.id === activeModule;
          // Mobile rows are a bit taller for easier tapping (44px tap target minimum)
          const rowPadding = isMobile ? '14px 20px' : '9px 20px';
          const rowFontSize = isMobile ? 15 : 13.5;
          return (
            <div key={m.id} onClick={() => handleModuleClick(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: rowPadding,
                cursor: 'pointer', color: on ? C.navActive : C.navInactive,
                background: on ? C.sidebarHover : 'transparent',
                borderLeft: on ? `3px solid ${C.emerald}` : '3px solid transparent',
                fontSize: rowFontSize, fontWeight: on ? 500 : 400, transition: 'all 0.12s',
                userSelect: 'none',
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = C.sidebarHover; }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon path={m.icon} color="currentColor" size={isMobile ? 17 : 15} />
              {m.label}
            </div>
          );
        })}
      </nav>

      {/* User + sign out */}
      <div style={{
        padding: isMobile ? '14px 20px calc(14px + env(safe-area-inset-bottom)) 20px' : '12px 20px',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: isMobile ? 32 : 28, height: isMobile ? 32 : 28, borderRadius: '50%', background: C.emerald,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: isMobile ? 12 : 11, fontWeight: 600, color: '#07111f', flexShrink: 0
        }}>
          {displayInitials || 'U'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.navActive, fontSize: isMobile ? 13 : 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
          <div style={{ color: C.navInactive, fontSize: isMobile ? 11 : 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayRole}</div>
        </div>
        {onSignOut && (
          <button
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            style={{
              background: 'transparent', border: 'none', padding: isMobile ? 8 : 4, borderRadius: 4,
              cursor: 'pointer', color: C.navInactive,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.navActive }}
            onMouseLeave={e => { e.currentTarget.style.color = C.navInactive }}
          >
            <Icon path="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" size={isMobile ? 16 : 14} color="currentColor" />
          </button>
        )}
      </div>
    </>
  );

  // Desktop: inline flex column
  if (!isMobile) {
    return (
      <div style={{ width: 240, background: C.sidebar, display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100vh' }}>
        {inner}
      </div>
    );
  }

  // Mobile: fixed overlay + drawer
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onMobileClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(7, 17, 31, 0.55)',
          zIndex: 450, animation: 'anura-fade-in 200ms ease',
        }}
      />
      {/* Drawer */}
      <div
        role="dialog"
        aria-label="Navigation menu"
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: 'min(86vw, 320px)', background: C.sidebar,
          display: 'flex', flexDirection: 'column', zIndex: 460,
          boxShadow: '2px 0 24px rgba(0,0,0,0.35)',
          animation: 'anura-slide-in-left 220ms ease',
          overscrollBehavior: 'contain',
        }}
      >
        {inner}
      </div>
    </>
  );
}

// ─── MobileHeader ────────────────────────────────────────────────────────────
// A slim 48px app bar that appears above all module content on mobile only.
// Holds the hamburger trigger + wordmark. Renders nothing on desktop.
// ─────────────────────────────────────────────────────────────────────────────
export function MobileHeader({ onOpenMenu }) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <div style={{
      height: 48, flexShrink: 0, background: C.sidebar,
      display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 4px',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
    }}>
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        style={{
          background: 'transparent', border: 'none', padding: 10, borderRadius: 6,
          cursor: 'pointer', color: C.navActive,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 44, minHeight: 44,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6"  x2="21" y2="6"  />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 24, height: 24, borderRadius: 5, background: C.emerald, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        </div>
        <span style={{ color: C.navActive, fontWeight: 600, fontSize: 15 }}>Anura</span>
      </div>
    </div>
  );
}
