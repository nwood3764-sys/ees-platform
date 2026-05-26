import { Component } from 'react'
import { C } from '../data/constants'
import { logClientError } from '../lib/clientErrorLogger'

// ─── ErrorBoundary ───────────────────────────────────────────────────────
// React's only way to catch a child render exception. Must be a class —
// useErrorBoundary doesn't exist in stable React yet.
//
// Two placements:
//   1. Top-level around AuthedApp. Catches anything that escapes a
//      module-level boundary, plus errors in the chrome (sidebar, topbar).
//   2. Per-module inside <Suspense>. Catches a module crash so the
//      sidebar and topbar stay alive and the user can navigate away.
//
// Props:
//   • children    — what to render when no error
//   • scope       — short label used in the fallback heading and logged
//                   to client_errors.ce_module. Example: 'app', 'module:field'.
//   • onReset?    — optional callback invoked when the user clicks
//                   "Try again". By default we just clear our error state.
//                   App.jsx passes a function that navigates home, so a
//                   broken module doesn't immediately re-crash.
//   • resetKeys?  — array of values; when any of them changes the
//                   boundary auto-resets. Used to clear the error when
//                   the user navigates to a different module.
// ─────────────────────────────────────────────────────────────────────────

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = {
      error:        null,
      errorInfo:    null,
      logId:        null,    // CE-#### from the server, populated post-insert
      showDetails:  false,
      copied:       false,
    }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    // Fire-and-forget. We're already showing fallback UI; the insert can
    // resolve in the background and update our state with the record id.
    logClientError(error, errorInfo, { module: this.props.scope })
      .then(recordNumber => {
        if (recordNumber) this.setState({ logId: recordNumber })
      })
  }

  componentDidUpdate(prevProps) {
    // Auto-reset when a tracked key changes. Used by App.jsx to clear
    // the error when the user navigates to a different module/record.
    if (!this.state.error) return
    const prev = prevProps.resetKeys || []
    const next = this.props.resetKeys || []
    if (prev.length !== next.length) {
      this.reset()
      return
    }
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== next[i]) {
        this.reset()
        return
      }
    }
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null, logId: null, showDetails: false, copied: false })
    if (this.props.onReset) this.props.onReset()
  }

  copyDetails = () => {
    const { error, errorInfo, logId } = this.state
    const text = [
      `Reference: ${logId || '(not yet logged)'}`,
      `Scope: ${this.props.scope || 'unknown'}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : 'n/a'}`,
      `Time: ${new Date().toISOString()}`,
      `User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`,
      '',
      `${error?.name || 'Error'}: ${error?.message || String(error)}`,
      '',
      'Stack:',
      error?.stack || '(no stack)',
      '',
      'Component stack:',
      errorInfo?.componentStack || '(no component stack)',
    ].join('\n')

    try {
      navigator.clipboard.writeText(text)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2500)
    } catch {
      // Fallback: select a hidden textarea. Skipped here for brevity —
      // every browser that runs our build supports clipboard.writeText.
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    const { error, logId, showDetails, copied } = this.state
    const scope = this.props.scope || 'unknown'

    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '48px 24px',
        background: C.page,
        minHeight: '100%',
        overflow: 'auto',
      }}>
        <div style={{
          maxWidth: 720,
          width: '100%',
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: '28px 32px',
          boxShadow: '0 1px 3px rgba(13,26,46,0.04)',
          fontFamily: 'Inter, -apple-system, sans-serif',
          color: C.textPrimary,
        }}>
          {/* Icon + heading row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 8,
              background: '#fef2f2',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                   stroke="#b03a2e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9"  x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>Something went wrong</div>
              <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>
                The {scope.replace(/^module:/, '')} view hit an unexpected error.
              </div>
            </div>
          </div>

          {/* The actual error message — most useful single line */}
          <div style={{
            background: C.cardSecondary,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: '12px 14px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 13,
            color: C.textPrimary,
            wordBreak: 'break-word',
            marginBottom: 16,
          }}>
            <span style={{ color: '#b03a2e', fontWeight: 600 }}>{error?.name || 'Error'}:</span>{' '}
            {error?.message || String(error)}
          </div>

          {/* Reference + actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
            <div style={{
              fontSize: 12,
              color: C.textMuted,
              padding: '4px 10px',
              background: C.cardSecondary,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              Reference: <span style={{ color: C.textPrimary, fontWeight: 600 }}>
                {logId || 'logging…'}
              </span>
            </div>
            <div style={{ flex: 1 }} />
            <button
              onClick={this.copyDetails}
              style={{
                fontSize: 13,
                padding: '6px 12px',
                background: C.card,
                border: `1px solid ${C.borderDark}`,
                borderRadius: 6,
                color: C.textSecondary,
                cursor: 'pointer',
                fontFamily: 'Inter, -apple-system, sans-serif',
              }}
            >
              {copied ? 'Copied' : 'Copy details'}
            </button>
            <button
              onClick={this.reset}
              style={{
                fontSize: 13,
                padding: '6px 12px',
                background: C.emerald,
                border: `1px solid ${C.emeraldMid}`,
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer',
                fontFamily: 'Inter, -apple-system, sans-serif',
                fontWeight: 500,
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                fontSize: 13,
                padding: '6px 12px',
                background: C.card,
                border: `1px solid ${C.borderDark}`,
                borderRadius: 6,
                color: C.textSecondary,
                cursor: 'pointer',
                fontFamily: 'Inter, -apple-system, sans-serif',
              }}
            >
              Reload page
            </button>
          </div>

          {/* Expandable stack */}
          <button
            onClick={() => this.setState({ showDetails: !showDetails })}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 12,
              color: C.textSecondary,
              fontFamily: 'Inter, -apple-system, sans-serif',
              textDecoration: 'underline',
            }}
          >
            {showDetails ? 'Hide technical details' : 'Show technical details'}
          </button>

          {showDetails && (
            <pre style={{
              marginTop: 12,
              padding: '12px 14px',
              background: '#0d1a2e',
              color: '#d6e1f5',
              borderRadius: 6,
              fontSize: 11,
              fontFamily: 'JetBrains Mono, monospace',
              lineHeight: 1.5,
              overflow: 'auto',
              maxHeight: 320,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {error?.stack || '(no stack)'}
              {this.state.errorInfo?.componentStack ? '\n\nComponent stack:\n' + this.state.errorInfo.componentStack : ''}
            </pre>
          )}

          <div style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: `1px solid ${C.border}`,
            fontSize: 12,
            color: C.textMuted,
            lineHeight: 1.55,
          }}>
            This error has been logged automatically. The rest of the platform is still working —
            you can navigate to another module from the sidebar. If this keeps happening,
            share the reference code above.
          </div>
        </div>
      </div>
    )
  }
}
