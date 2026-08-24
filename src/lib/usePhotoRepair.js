import { useCallback, useEffect, useRef, useState } from 'react'
import {
  selectRepairTargets,
  markAttempted,
  markFailed,
  withRepairLock,
} from './photoRepairQueue'

// ---------------------------------------------------------------------------
// usePhotoRepair — render unrendered photos automatically, without the card
// tearing down its own work.
//
// This is a hook rather than an effect inlined in FileGallery because the first
// version SHIPPED BROKEN in a way that only shows up in React's actual
// scheduling (Nicholas, 2026-08-24: "Rendering 0 of 9 photos", stuck, screen
// flickering). Pulling it out is what makes it drivable in a real browser.
//
// The defect, exactly: the effect listed `items` as a dependency AND wrote to
// `items` (flipping each photo to watermark_status 'pending' for the tile
// spinner). So the moment a pass started it changed its own dependency, React
// ran the cleanup, the cleanup aborted the controller, and the abort branch
// returned early WITHOUT clearing progress. The re-run then found every photo
// already in the attempt registry and did nothing. Net effect: the pass killed
// itself on its first tick, the banner froze at 0, and every tile sat on a
// spinner forever.
//
// Three rules come out of that, and they are what this hook exists to hold:
//
//   1. A pass never writes to `items`. Which photos are being rendered right
//      now is its own state (`renderingIds`), so starting a pass cannot change
//      the input that triggered it.
//   2. A running pass is never cancelled by new data. Re-entry is refused with
//      a ref; the abort signal belongs to the RECORD (and unmount), not to
//      every re-render.
//   3. Progress is always cleared, on every exit path — success, failure,
//      skipped-because-another-card-holds-the-lock, and abort. A stuck
//      progress line is what a person actually sees when this goes wrong.
// ---------------------------------------------------------------------------

const EMPTY = new Set()

/**
 * @param {Object}   args
 * @param {Array}    args.photos     the card's current items
 * @param {boolean}  args.enabled    false for a documents card
 * @param {Function} args.runRepair  (photos, {signal, onProgress}) => {repaired, failed, failedIds}
 * @param {Function} args.onRepaired called after a pass that did work, to reload
 * @param {string}   args.recordKey  changes when the card points at another record
 *
 * @returns {{progress: {done:number,total:number}|null, renderingIds: Set<string>}}
 */
export function usePhotoRepair({ photos, enabled, runRepair, onRepaired, recordKey }) {
  const [progress, setProgress] = useState(null)
  const [renderingIds, setRenderingIds] = useState(EMPTY)

  const runningRef = useRef(false)
  const abortRef = useRef(null)
  const liveRef = useRef(true)

  // Latest callbacks without making them scheduling inputs. A parent that
  // rebuilds `onRepaired` each render must not be able to restart a pass.
  const runRepairRef = useRef(runRepair)
  const onRepairedRef = useRef(onRepaired)
  runRepairRef.current = runRepair
  onRepairedRef.current = onRepaired

  useEffect(() => {
    liveRef.current = true
    return () => { liveRef.current = false }
  }, [])

  // The abort signal belongs to the record, not to the data. Moving to another
  // record (or unmounting) stops the work; new photos arriving does not.
  useEffect(() => {
    const controller = new AbortController()
    abortRef.current = controller
    return () => controller.abort()
  }, [recordKey])

  const startPass = useCallback(async (todo) => {
    const ids = todo.map(p => p.id)
    markAttempted(ids)
    runningRef.current = true
    setRenderingIds(prev => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })

    let ran = null
    try {
      ran = await withRepairLock(async () => {
        if (liveRef.current) setProgress({ done: 0, total: todo.length })
        return runRepairRef.current(todo, {
          signal: abortRef.current?.signal,
          onProgress: ({ done, total }) => {
            if (liveRef.current) setProgress({ done, total })
          },
        })
      })
      if (ran?.failedIds?.length) markFailed(ran.failedIds)
    } catch {
      // A pass that throws is a failed pass, not a stuck card. The photos stay
      // marked attempted, so they surface as "could not render" with a retry.
      markFailed(ids)
    } finally {
      runningRef.current = false
      // Rule 3: every exit path clears. An unmounted card skips the state
      // writes but must still release the running flag above.
      if (liveRef.current) {
        setProgress(null)
        setRenderingIds(prev => {
          if (prev.size === 0) return prev
          const next = new Set(prev)
          for (const id of ids) next.delete(id)
          return next.size === prev.size ? prev : next
        })
      }
    }

    // Reload only when work actually happened and this card is still the one
    // on screen. `ran` is null when another card held the lock — it is doing
    // the same work and its own reload will bring the results here.
    if (ran && liveRef.current && !abortRef.current?.signal.aborted) {
      await onRepairedRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (runningRef.current) return          // rule 2: never restart over a live pass
    const todo = selectRepairTargets(photos)
    if (todo.length === 0) return
    startPass(todo)
    // No cleanup that cancels: an items change is new data, not a reason to
    // throw away a decode that is halfway through.
  }, [photos, enabled, startPass])

  return { progress, renderingIds }
}
