// The REAL conversion helpers, driving a REAL <input type="datetime-local">.
// The question a browser has to answer: does the input ACCEPT the string
// toDatetimeLocal produces? An input that rejects its value shows blank — which
// is exactly the symptom being fixed, so a green unit test proves nothing here.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { toDatetimeLocal, fromDatetimeLocal } from '../../src/lib/datetimeField'

window.__conv = { toDatetimeLocal, fromDatetimeLocal }

function Harness() {
  const [stored, setStored] = useState('2026-09-02T13:00:00+00:00')
  return (
    <div style={{ padding: 20, fontFamily: 'system-ui' }}>
      <input
        data-test="dt"
        type="datetime-local"
        value={toDatetimeLocal(stored)}
        onChange={e => setStored(fromDatetimeLocal(e.target.value))}
      />
      <div data-test="stored">{stored === null ? 'NULL' : String(stored)}</div>
    </div>
  )
}
createRoot(document.getElementById('root')).render(<Harness />)
