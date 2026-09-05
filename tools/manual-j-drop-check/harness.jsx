// The REAL Manual J card, with only the database swapped out.
//
// Playwright drops the REAL Conduit Tech report on its REAL drop zone and puts
// the same bytes on its REAL hidden <input type="file">. What a Node test
// cannot see, and what this exists for:
//
//   * a drop handler that reads e.dataTransfer.files after an await, or an
//     input handler that clears the input before snapshotting it, sees ZERO
//     files and fails in total silence (the 2026-09-02 defect);
//   * pdf.js only runs in a browser, so the whole extraction path — worker,
//     CDN module, text items — is unexercised until one runs it.

import { createRoot } from 'react-dom/client'
import ManualJReportCard from '../../src/components/ManualJReportCard'
import { captured } from './manualJServiceStub'

window.__captured = captured

createRoot(document.getElementById('root')).render(
  <div style={{ padding: 20, fontFamily: 'system-ui', background: '#f0f3f8' }}>
    <ManualJReportCard recordId="a0000000-0000-0000-0000-000000000001" />
  </div>
)
