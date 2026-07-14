import { useState, useEffect, useCallback } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from './UI'
import { fetchReviewQueue } from '../data/workOrderReviewService'
import HelpIcon from './help/HelpIcon'

// ---------------------------------------------------------------------------
// WorkOrderReviewQueue — Field module → Verification Reviews.
// Work orders in To Be Verified (awaiting the Project Coordinator) and the
// ones already sent back in Corrections Needed (awaiting the technician's
// rework). Clicking a row opens WorkOrderReviewScreen.
// ---------------------------------------------------------------------------

function QueueGroup({ title, rows, emptyText, onOpen, accent }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, padding: '0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {title}
        <span style={{ background: rows.length > 0 ? accent.bg : C.page, border: `1px solid ${rows.length > 0 ? accent.border : C.border}`, color: rows.length > 0 ? accent.text : C.textMuted, fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10 }}>{rows.length}</span>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>{emptyText}</div>
        ) : rows.map((r, i) => (
          <div key={r.id} onClick={() => onOpen(r)}
            style={{ display: 'grid', gridTemplateColumns: '110px 1.4fr 1fr 0.8fr 130px', gap: 14, padding: '13px 16px', alignItems: 'center', borderTop: i === 0 ? 'none' : `1px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.1s ease' }}
            onMouseEnter={e => e.currentTarget.style.background = '#fafbfd'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.textMuted }}>{r.recordNumber}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.workType || r.subject || r.name}</div>
              <div style={{ fontSize: 11.5, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[r.property, r.building, r.unit].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary }}>
              <div style={{ color: C.textPrimary, fontWeight: 500 }}>{r.technician || '—'}</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>Technician</div>
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary }}>
              <div style={{ color: C.textPrimary, fontWeight: 500 }}>{r.coordinator || '—'}</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>Coordinator</div>
            </div>
            <div style={{ fontSize: 11.5, color: C.textMuted, textAlign: 'right' }}>
              {r.submittedAt ? new Date(r.submittedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function WorkOrderReviewQueue({ onOpenReview }) {
  const [queue, setQueue] = useState({ awaiting: [], sentBack: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setQueue(await fetchReviewQueue())
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} onRetry={() => { setLoading(true); load() }} />

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 24, background: C.page }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              Verification Reviews
              <HelpIcon
                anchors={[
                  { type: 'concept', concept: 'work-order-verification-review' },
                  { type: 'object', object: 'work_orders' },
                ]}
                title="Verification Reviews"
              />
            </h2>
            <div style={{ fontSize: 13, color: C.textSecondary }}>
              Submitted work orders awaiting a step-by-step evidence review. Approve every applicable step to verify, or send back for corrections.
            </div>
          </div>
          <button onClick={() => { setLoading(true); load() }} style={{ padding: '6px 12px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: C.card, color: C.textSecondary, cursor: 'pointer', fontWeight: 500 }}>
            Refresh
          </button>
        </div>

        <QueueGroup
          title="Awaiting Review"
          rows={queue.awaiting}
          emptyText="Nothing waiting on review. Submitted work orders land here."
          onOpen={onOpenReview}
          accent={{ bg: '#e8f1fb', border: '#bcd9f2', text: '#1e466b' }}
        />
        <QueueGroup
          title="Sent Back — Corrections In Progress"
          rows={queue.sentBack}
          emptyText="No work orders are out for corrections."
          onOpen={onOpenReview}
          accent={{ bg: C.page, border: C.border, text: C.textMuted }}
        />
      </div>
    </div>
  )
}
