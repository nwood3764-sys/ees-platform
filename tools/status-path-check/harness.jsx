// Harness for tools/status-path-check/run.mjs — mounts the REAL
// StatusPathWidget with the REAL nine-stage incentive-application lifecycle
// prod returns, at the width the record page actually gives it. Only the
// transport is stubbed (tools/status-path-check/supabaseStub.js).

import { createRoot } from 'react-dom/client'
import StatusPathWidget from '../../src/components/StatusPathWidget'
import { ToastProvider } from '../../src/components/Toast'

const WIDGET = {
  id: 'w-status-path',
  widget_type: 'status_path',
  widget_config: { status_field: 'ia_status', show_guidance: true, show_completed_count: true },
}

// IA-00013 as it stands on prod: submitted, awaiting the program's response.
const RECORD = {
  id: '3af23847-6b95-4195-a2d0-6255067f140e',
  ia_record_number: 'IA-00013',
  ia_record_type: '3220bb9f-af8b-467a-be6a-32ce0cacaa47',
  ia_status: 'c5bfe7f1-21e2-4970-a24f-4c340ca12d47',
}

// The record page's main column width, driven by the runner so one harness
// covers desktop, tablet and phone.
const COLUMN = Number(new URLSearchParams(location.search).get('column')) || 1180

// The chevron geometry as it shipped before 2026-09-01, kept as a positive
// control: every stage but the current one flexed to `1 1 0` with the label as
// a centered flex child, and `text-overflow` on a flex container does nothing —
// so the label was clipped at BOTH ends with no ellipsis. If the check passes
// this, the check is measuring the wrong thing.
function LegacyStrip() {
  return (
    <div data-test="legacy-strip" style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
      {STAGES.map((label, i) => {
        const isCurrent = label === CURRENT
        return (
          <div key={label} data-legacy-chevron title={label} style={{
            flex: isCurrent ? '0 0 auto' : '1 1 0',
            minWidth: isCurrent ? 'auto' : 0,
            height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: `0 ${i === STAGES.length - 1 ? 14 : 18}px 0 ${i === 0 ? 14 : 22}px`,
            background: isCurrent ? '#3ecf8e' : '#f7f9fc',
            color: isCurrent ? '#fff' : '#4a5e7a',
            fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis', marginLeft: i === 0 ? 0 : -2,
          }}>
            {label}
          </div>
        )
      })}
    </div>
  )
}

const CURRENT = 'Incentive Application Submitted — Awaiting Program Response'
const STAGES = [
  'Incentive Application To Be Prepared',
  'Incentive Application To Be Verified',
  'Incentive Application To Be Submitted',
  CURRENT,
  'Incentive Application Pre-Approved',
  'Incentive Application Approved',
  'Incentive Application Corrections Needed',
  'Incentive Application Denied',
  'Incentive Application Withdrawn',
]

function Harness() {
  return (
    <ToastProvider>
      {/* The record page's main column at a 1440-wide desktop viewport. */}
      <div data-test="main-column" style={{ width: COLUMN, padding: 12 }}>
        <StatusPathWidget
          widget={WIDGET}
          parentRecordId={RECORD.id}
          tableName="incentive_applications"
          record={RECORD}
          onStatusChanged={() => {}}
        />
      </div>

      <div data-test="legacy-column" style={{ width: COLUMN, padding: 12 }}>
        <LegacyStrip />
      </div>
    </ToastProvider>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
