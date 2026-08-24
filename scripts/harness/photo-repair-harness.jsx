import { useCallback, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { usePhotoRepair } from '../../src/lib/usePhotoRepair.js'
import { resetRepairQueue } from '../../src/lib/photoRepairQueue.js'

const mkPhotos = (n, rendered = false) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    storage_path_original: `${i + 1}.heic`,
    ...(rendered ? { _thumbUrl: `https://x/${i + 1}.jpg` } : {}),
  }))

// Global counters the test reads.
window.__renders = 0
window.__passStarts = 0
window.__decoded = []

function Card({ id, initial = 9, failIds = [], recordKey = 'wo:1' }) {
  window.__renders++
  const [items, setItems] = useState(() => mkPhotos(initial))
  const doneRef = useRef(false)

  // Stand-in for repairUnrenderedPhotos: decodes one photo per tick.
  const runRepair = useCallback(async (todo, { signal, onProgress }) => {
    window.__passStarts++
    const failedIds = []
    let repaired = 0
    for (let i = 0; i < todo.length; i++) {
      if (signal?.aborted) break
      await new Promise(r => setTimeout(r, 12))
      window.__decoded.push(todo[i].id)
      if (failIds.includes(todo[i].id)) failedIds.push(todo[i].id)
      else repaired++
      onProgress({ done: i + 1, total: todo.length, repaired, failed: failedIds.length })
    }
    return { repaired, failed: failedIds.length, failedIds }
  }, [failIds])

  // Stand-in for refresh(): reloads rows, now rendered — a NEW array identity,
  // which is what used to retrigger and cancel the effect.
  const onRepaired = useCallback(async () => {
    doneRef.current = true
    setItems(mkPhotos(initial, true).map(p =>
      failIds.includes(p.id) ? { ...p, _thumbUrl: null } : p))
  }, [initial, failIds])

  const { progress, renderingIds } = usePhotoRepair({
    photos: items, enabled: true, runRepair, onRepaired, recordKey,
  })

  return (
    <div data-card={id}>
      <div data-testid={`progress-${id}`}>
        {progress ? `Rendering ${progress.done} of ${progress.total}` : 'idle'}
      </div>
      <div data-testid={`rendering-${id}`}>{renderingIds.size}</div>
      <div data-testid={`reloaded-${id}`}>{doneRef.current ? 'yes' : 'no'}</div>
      <button onClick={() => setItems(p => [...p])} data-testid={`churn-${id}`}>churn</button>
    </div>
  )
}

function App() {
  const [state, setState] = useState({ scenario: null, run: 0 })
  // Bump `run` so each scenario is a FRESH mount even when it repeats.
  window.__run = (s) => {
    resetRepairQueue()
    window.__renders = 0; window.__passStarts = 0; window.__decoded = []
    setState(prev => ({ scenario: null, run: prev.run + 1 }))
    setTimeout(() => setState(prev => ({ scenario: s, run: prev.run + 1 })), 0)
  }
  window.__unmount = () => setState(prev => ({ scenario: null, run: prev.run + 1 }))
  const { scenario, run } = state
  if (!scenario) return <div data-testid="empty">empty</div>
  if (scenario === 'single') return <Card key={run} id="a" />
  if (scenario === 'twocards') return <><Card key={`a${run}`} id="a" /><Card key={`b${run}`} id="b" /></>
  if (scenario === 'withfailure') return <Card key={run} id="a" initial={4} failIds={['p2']} />
  return null
}
createRoot(document.getElementById('root')).render(<App />)
