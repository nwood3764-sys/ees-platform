// ─── uploadDeadline.js ───────────────────────────────────────────────────────
// Nothing in an evidence upload is allowed to wait forever.
//
// A photo upload is a chain of four steps — shrink, HEIF-decode, PUT the
// object, insert the row — and until now not one of them could time out. Every
// one of them CAN hang rather than fail: `createImageBitmap` and `canvas.toBlob`
// on a memory-pressed phone, the libheif `frame.display()` callback that simply
// never fires, and a PUT on a job-site uplink that goes away mid-body. A hung
// step leaves the spinner up and the screen silent, which is indistinguishable
// from a slow one — the technician waits, gives up, and marks the step Not
// Applicable to get past it. That is how evidence is lost: not by an error, by
// an absence of one.
//
// Two kinds of step, two different answers, and the difference matters:
//
//   OPTIONAL work (shrink, HEIF rendition) degrades. It exists to make the
//   upload smaller or the preview nicer; if it stalls, we abandon it and send
//   what we already have. Failing the upload because an optimisation hung would
//   be strictly worse than not optimising. `softDeadline` returns a fallback.
//
//   REQUIRED work (the storage PUT, the row insert) errors, by name, in words a
//   person can act on. `hardDeadline` throws.
//
// Deliberately NOT an AbortController: supabase-js's storage upload takes no
// signal, and the browser work (canvas, wasm decode) cannot be cancelled at all.
// The point is to stop WAITING on a step, not to pretend we stopped it — the
// abandoned work finishes into nothing and is collected.

/** Milliseconds each step of an evidence upload is allowed to take. */
export const UPLOAD_DEADLINES = {
  // Generous: a 12 MP re-encode on an old Android is genuinely slow. This is a
  // hang detector, not a performance budget.
  compress: 30000,
  heifDecode: 45000,
  // A big original on a bad uplink is the normal case out here, so this is long
  // enough that a working slow upload finishes and short enough that a dead one
  // is reported inside a coffee break.
  storageUpload: 180000,
  rowInsert: 45000,
}

/**
 * Await `work`, but give up after `ms` and return `fallback` instead.
 * For steps whose failure costs quality, never correctness.
 *
 * @param {Promise<T>} work
 * @param {number} ms
 * @param {T} fallback     what to use when the step does not answer in time
 * @param {string} [label] named in the console warning, so a recurring stall is
 *                         findable instead of merely felt as slowness
 * @returns {Promise<T>}
 */
export async function softDeadline(work, ms, fallback, label = 'step') {
  let timer = null
  const expired = Symbol('expired')
  try {
    const result = await Promise.race([
      Promise.resolve(work).catch(() => expired),
      new Promise((resolve) => { timer = setTimeout(resolve, ms, expired) }),
    ])
    if (result === expired) {
      // eslint-disable-next-line no-console
      console.warn(`${label} did not finish within ${Math.round(ms / 1000)}s — continuing without it`)
      return fallback
    }
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Await `work`, and throw a message the user can act on if it does not answer.
 * For steps the upload cannot be said to have happened without.
 *
 * The message says what stalled and what to do, because "Upload failed" on a
 * roof in Appleton tells a technician nothing.
 *
 * @param {Promise<T>} work
 * @param {number} ms
 * @param {string} message  shown to the user verbatim
 * @returns {Promise<T>}
 */
export async function hardDeadline(work, ms, message) {
  let timer = null
  const expired = Symbol('expired')
  try {
    const result = await Promise.race([
      work,
      new Promise((resolve) => { timer = setTimeout(resolve, ms, expired) }),
    ])
    if (result === expired) throw new Error(message)
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The wording for a step that never answered. One place, so it stays consistent. */
export function timedOutMessage(what, ms) {
  const secs = Math.round(ms / 1000)
  const when = secs >= 60
    ? `${Math.round(secs / 60)} minute${Math.round(secs / 60) === 1 ? '' : 's'}`
    : `${secs} seconds`
  return `${what} did not finish within ${when}. Nothing was lost — check your signal and try again.`
}
