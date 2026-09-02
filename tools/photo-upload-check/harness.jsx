// Two panels, one browser.
//
//   real         the REAL WorkOrderDetail, on the REAL work order that broke.
//                Playwright puts a real file on its real hidden <input>; the
//                only thing swapped out is the network.
//
//   CONTROL-old  the handler shape that shipped on 2026-08-22, wired to its own
//                real <input>. It MUST come back with zero files. If it ever
//                reports a file, this harness is not reproducing a browser's
//                live FileList and every PASS beside it means nothing.

import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import WorkOrderDetail from '../../src/fieldMobile/WorkOrderDetail'
import { imageFilesFromInputEvent } from '../../src/lib/photoDrop'
import { captured } from './fieldMobileServiceStub'

window.__captured = captured

function ControlOld() {
  const [seen, setSeen] = useState(null)
  // Verbatim the pre-fix shape: keep the live list, clear the input, then read.
  const onFile = async (e) => {
    const files = e.target.files
    e.target.value = ''
    const list = Array.from(files)
    setSeen(list.length)
    window.__controlOldSaw = list.length
  }
  // The same input read in the fixed order, for a side-by-side on one page.
  const onFileFixed = async (e) => {
    const { files } = imageFilesFromInputEvent(e)
    window.__controlNewSaw = files.length
  }
  return (
    <div style={{ padding: 12 }}>
      <input data-test="control-old" type="file" accept="image/*" multiple onChange={onFile} />
      <input data-test="control-new" type="file" accept="image/*" multiple onChange={onFileFixed} />
      <span data-test="control-old-saw">{seen === null ? '—' : seen}</span>
    </div>
  )
}

function Harness() {
  return (
    <div>
      <div data-test="real"><WorkOrderDetail woId="wo-243" navigate={() => {}} embedded /></div>
      <div data-test="control"><ControlOld /></div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
