// Video-playback harness — NOT shipped.
//
// Mounts the REAL DocumentPreviewModal from src/components/FileGallery.jsx
// against video documents, so the driver can ask a browser the only question
// that matters: did it decode, and if it could not, did LEAP say so.
//
// The playable case is recorded IN the browser (canvas → MediaRecorder → Blob),
// so it is a genuine video file this Chromium genuinely decodes, with no fixture
// binary checked into the repo and no pretending.
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DocumentPreviewModal } from '../../src/components/FileGallery'
import { ToastProvider } from '../../src/components/Toast'

/** Record a second of a moving canvas into a real video Blob. */
async function recordCanvasVideo() {
  const canvas = document.createElement('canvas')
  canvas.width = 160; canvas.height = 120
  const ctx = canvas.getContext('2d')
  const stream = canvas.captureStream(25)
  const type = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find(t => window.MediaRecorder?.isTypeSupported?.(t))
  if (!type) throw new Error('this browser records no video type')
  const rec = new MediaRecorder(stream, { mimeType: type })
  const parts = []
  rec.ondataavailable = e => { if (e.data.size) parts.push(e.data) }
  const done = new Promise(res => { rec.onstop = res })
  rec.start()
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = i % 2 ? '#3ecf8e' : '#07111f'
    ctx.fillRect(0, 0, 160, 120)
    await new Promise(r => setTimeout(r, 25))
  }
  rec.stop()
  await done
  return new Blob(parts, { type: type.split(';')[0] })
}

// Bytes that are NOT a video, served under a video name and mime. This is the
// .MOV-Chrome-cannot-decode case, reproduced deterministically: the element
// fires `error`, which is the branch the fallback message hangs off.
const UNDECODABLE = URL.createObjectURL(
  new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])], { type: 'video/quicktime' }))

function Case({ id, doc, url }) {
  return (
    <div data-case={id} style={{ position: 'relative', height: 420, margin: 16, border: '1px solid #d0d8e8' }}>
      <DocumentPreviewModal
        doc={{ ...doc, _url: url, _previewUrl: url }}
        onDownload={() => {}}
        onClose={() => {}}
      />
    </div>
  )
}

function Harness() {
  const [playableUrl, setPlayableUrl] = useState(null)
  const [recordError, setRecordError] = useState(null)
  useEffect(() => {
    recordCanvasVideo()
      .then(blob => setPlayableUrl(URL.createObjectURL(blob)))
      .catch(e => setRecordError(e.message))
  }, [])

  if (recordError) return <div data-record-error>{recordError}</div>
  if (!playableUrl) return <div data-recording>recording…</div>

  return (
    <ToastProvider>
      <Case
        id="playable"
        url={playableUrl}
        doc={{
          id: 'v1', name: 'attic-360.webm', mime_type: 'video/webm',
          file_size_bytes: 1234567, created_at: '2026-08-27T22:20:36Z',
          storage_bucket: 'work-evidence', storage_path: 'work_steps/x/v1__attic-360.webm',
          document_type: 'video',
        }}
      />
      <Case
        id="CONTROL-undecodable"
        url={UNDECODABLE}
        doc={{
          id: 'v2', name: 'IMG_0346.MOV', mime_type: 'video/quicktime',
          file_size_bytes: 429941992, created_at: '2026-08-27T22:20:36Z',
          storage_bucket: 'work-evidence', storage_path: 'work_steps/y/v2__IMG_0346.MOV',
          document_type: 'video',
        }}
      />
    </ToastProvider>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
