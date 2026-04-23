import { useState, useEffect } from 'react';
import { C, STATUS_CFG, NAV_MODULES } from '../data/constants';
import { useIsMobile } from '../lib/useMediaQuery';
import { useSwipeToDismiss } from '../lib/useSwipeToDismiss';
import UserMenu from './UserMenu';

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
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? 'anura-hscroll' : ''} style={{
      background: C.card, borderBottom: `1px solid ${C.border}`,
      padding: isMobile ? '0 12px' : '0 24px',
      display: 'flex', alignItems: 'center', flexShrink: 0,
      ...(isMobile ? { scrollSnapType: 'x proximity' } : {}),
    }}>
      {sections.map(s => {
        const on = s.id === active;
        const count = counts[s.id];
        const urgent = urgentSections[s.id];
        return (
          <button key={s.id} onClick={() => onChange(s.id)} style={{
            padding: isMobile ? '12px 14px' : '10px 16px',
            background: 'none', border: 'none',
            borderBottom: on ? `2px solid ${C.emerald}` : '2px solid transparent',
            color: on ? C.textPrimary : C.textMuted,
            fontSize: isMobile ? 14 : 13,
            fontWeight: on ? 500 : 400, cursor: 'pointer', marginBottom: -1,
            display: 'flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap', flexShrink: 0,
            ...(isMobile ? { scrollSnapAlign: 'start' } : {}),
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

// ─── LoadingState ────────────────────────────────────────────────────────────
// Drop-in replacement for the previous "Loading…" spinner. On mobile renders
// six skeleton cards so the list shape is immediately visible and the
// perceived load time is shorter than a centered spinner. On desktop falls
// back to a centered spinner that matches the design system.
// ─────────────────────────────────────────────────────────────────────────────
export function LoadingState() {
  const isMobile = useIsMobile();
  if (!isMobile) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        color: C.textMuted,
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          border: `2.5px solid ${C.border}`,
          borderTopColor: C.emerald,
          animation: 'anura-spin 0.7s linear infinite',
        }} />
        <div style={{ fontSize: 13 }}>Loading…</div>
      </div>
    );
  }
  // Mobile skeleton — 6 placeholder cards that match the real card shape.
  // The shimmer animation is intentionally subtle; strong shimmers are
  // distracting when there's a real list coming in a second or two.
  return (
    <div style={{ flex: 1, overflow: 'hidden', padding: '8px 10px', background: C.page }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '12px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
            minHeight: 64,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                width: '28%', height: 10, borderRadius: 3,
                background: 'linear-gradient(90deg, #f0f3f8 0%, #e4e9f2 50%, #f0f3f8 100%)',
                backgroundSize: '200% 100%',
                animation: 'anura-shimmer 1.4s ease-in-out infinite',
                marginBottom: 8,
              }} />
              <div style={{
                width: '70%', height: 14, borderRadius: 3,
                background: 'linear-gradient(90deg, #f0f3f8 0%, #e4e9f2 50%, #f0f3f8 100%)',
                backgroundSize: '200% 100%',
                animation: 'anura-shimmer 1.4s ease-in-out infinite',
                animationDelay: '0.1s',
              }} />
            </div>
            <div style={{
              width: 56, height: 20, borderRadius: 10, flexShrink: 0,
              background: 'linear-gradient(90deg, #f0f3f8 0%, #e4e9f2 50%, #f0f3f8 100%)',
              backgroundSize: '200% 100%',
              animation: 'anura-shimmer 1.4s ease-in-out infinite',
              animationDelay: '0.2s',
            }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ErrorState ──────────────────────────────────────────────────────────────
// Consistent error presentation across modules. Optional onRetry shows a
// retry button; omit it to render a read-only error.
// ─────────────────────────────────────────────────────────────────────────────
export function ErrorState({ error, onRetry }) {
  const message = String(error?.message || error || 'Something went wrong')
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 10, padding: 24, textAlign: 'center',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b03a2e" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div style={{ color: '#b03a2e', fontSize: 14, fontWeight: 600 }}>Could not load records</div>
      <div style={{ color: C.textMuted, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', maxWidth: 560, wordBreak: 'break-word' }}>
        {message}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 6, background: C.emerald, color: '#fff',
            border: 'none', borderRadius: 6,
            padding: '9px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            minHeight: 40,
          }}
        >
          Try again
        </button>
      )}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
// Desktop (≥ 769px): fixed inline column. Two widths:
//                    - Expanded (default): 240px, icon + label.
//                    - Collapsed:           60px,  icon only, label via title tooltip.
//                    A chevron toggle on the right edge swaps between the two.
// Mobile  (≤ 768px): slide-in drawer with backdrop. Hidden until `mobileOpen`.
//                    Tapping a module closes the drawer automatically. The
//                    `collapsed` prop is ignored on mobile — the drawer is
//                    always fully expanded when visible.
//                    The caller is responsible for the hamburger that opens it
//                    (see MobileHeader below) and for maintaining `mobileOpen`.
// ─────────────────────────────────────────────────────────────────────────────
export function Sidebar({
  activeModule,
  onModuleChange,
  userEmail,
  onSignOut,
  onChangePassword,
  user = { name: 'Nicholas Wood', role: 'Admin', initials: 'NW' },
  mobileOpen = false,
  onMobileClose,
  collapsed = false,
  onToggleCollapse,
}) {
  const isMobile = useIsMobile();
  // `collapsed` only applies on desktop — the mobile drawer always shows full labels.
  const isCollapsed = !isMobile && collapsed;

  // Kept for backwards-compat with callers that passed a `user` prop; the
  // UserMenu component now handles display-name / role resolution itself by
  // hitting the users table. `user` remains as a seed for edge cases where no
  // Supabase session is present (e.g. storybook-style previews).
  void user;

  // ESC closes the drawer on mobile
  useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    const handler = (e) => { if (e.key === 'Escape' && onMobileClose) onMobileClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMobile, mobileOpen, onMobileClose]);

  // Swipe-to-dismiss for the mobile drawer. Hoisted up here — rather than
  // left below the early returns where it logically belongs — because hooks
  // must be called in the same order on every render. When the drawer is
  // closed Sidebar returns null; if useSwipeToDismiss were called after
  // that, React would see a different hook count on the tap-to-open render
  // ("rendered more hooks than during the previous render") and unmount the
  // whole tree, blanking the app. The `enabled` flag makes the hook a no-op
  // everywhere it doesn't apply (desktop, collapsed-drawer, etc.).
  const swipe = useSwipeToDismiss({
    direction: 'left',
    onDismiss: onMobileClose,
    enabled: isMobile && mobileOpen,
  });

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
        <div style={{
          padding: isCollapsed ? '18px 0 16px' : '18px 20px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: isCollapsed ? 'center' : 'flex-start',
        }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: C.emerald, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          {!isCollapsed && <span style={{ color: C.navActive, fontWeight: 600, fontSize: 15 }}>Anura</span>}
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
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto', overflowX: 'hidden' }}>
        {NAV_MODULES.map(m => {
          const on = m.id === activeModule;
          // Mobile rows are a bit taller for easier tapping (44px tap target minimum)
          const rowPadding = isMobile
            ? '14px 20px'
            : isCollapsed ? '11px 0' : '9px 20px';
          const rowFontSize = isMobile ? 15 : 13.5;
          return (
            <div
              key={m.id}
              onClick={() => handleModuleClick(m.id)}
              title={isCollapsed ? m.label : undefined}
              style={{
                display: 'flex', alignItems: 'center',
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                gap: isCollapsed ? 0 : 12,
                padding: rowPadding,
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
              {!isCollapsed && m.label}
            </div>
          );
        })}
      </nav>

      {/* User menu (profile + change password + sign out) */}
      <UserMenu
        userEmail={userEmail}
        onSignOut={onSignOut}
        onChangePassword={onChangePassword}
        isMobile={isMobile}
        isCollapsed={isCollapsed}
      />
    </>
  );

  // Desktop: inline flex column with optional collapse toggle
  if (!isMobile) {
    const width = isCollapsed ? 60 : 240;
    return (
      <div
        style={{
          width, background: C.sidebar,
          display: 'flex', flexDirection: 'column',
          flexShrink: 0, height: '100vh',
          position: 'relative',
          transition: 'width 180ms ease',
        }}
      >
        {inner}

        {/* Collapse/expand toggle — pull-tab on the right edge */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              position: 'absolute',
              top: 22,
              right: -11,
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: C.card,
              border: `1px solid ${C.border}`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.textSecondary,
              padding: 0,
              zIndex: 20,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.textPrimary; e.currentTarget.style.borderColor = C.borderDark; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.textSecondary; e.currentTarget.style.borderColor = C.border; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              {isCollapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
            </svg>
          </button>
        )}
      </div>
    );
  }

  // Mobile: fixed overlay + drawer with swipe-left to dismiss.
  // `swipe` was initialized at the top of the component (see the hoisted
  // useSwipeToDismiss call) to keep hook order stable across renders.
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
        {...swipe.handlers}
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: 'min(86vw, 320px)', background: C.sidebar,
          display: 'flex', flexDirection: 'column', zIndex: 460,
          boxShadow: '2px 0 24px rgba(0,0,0,0.35)',
          animation: 'anura-slide-in-left 220ms ease',
          overscrollBehavior: 'contain',
          ...swipe.style,
        }}
      >
        {inner}
      </div>
    </>
  );
}

// ─── MobileHeader ────────────────────────────────────────────────────────────
// A 52px app bar that appears above all module content on mobile only.
// Holds the hamburger trigger + the active module name. Renders nothing on
// desktop. Intentionally replaces per-module topbars on mobile to reclaim
// vertical space.
// ─────────────────────────────────────────────────────────────────────────────
export function MobileHeader({ onOpenMenu, moduleLabel, moduleIcon }) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <div style={{
      height: 52, flexShrink: 0, background: C.sidebar,
      display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 0 4px',
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        {moduleIcon && (
          <Icon path={moduleIcon} color={C.navActive} size={17} />
        )}
        <span style={{
          color: C.navActive, fontWeight: 600, fontSize: 17,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {moduleLabel || 'Anura'}
        </span>
      </div>
    </div>
  );
}
