// Loading pdf.js, once per version.
//
// pdf.js is deliberately NOT bundled — it is imported from the CDN at runtime,
// which is the prod-verified way this app has done it since the Asset Score
// parser shipped. That loader had been copied three times (paperworkService,
// pdfImages, SigningPortal) at three different versions; this is the one
// definition of the loading half.
//
// It is only the LOADER that is shared. LEAP has two PDF text readers on
// purpose, and they must not be folded together:
//
//   * `extractPdfText` in paperworkService joins every item with a space. The
//     DOE Asset Score parser depends on the multi-space runs that produces —
//     it cuts a building name at "the first 2+ space gap" — so that join is
//     load-bearing there, not a bug.
//   * `rowsFromTextItems` in pdfTextLayout decides spacing by geometry, because
//     the Conduit Tech Manual J report is set in a font pdf.js emits one
//     kerning run at a time, where the space-join shatters every word.
//
// Two documents, two correct answers. Pointing the second at the first is what
// would break them both.

const memo = new Map()

/**
 * @param {string} version pdf.js version to load, e.g. '4.0.379'
 * @returns {Promise<object>} the pdf.js module, worker already configured
 */
export function loadPdfJs(version) {
  if (!memo.has(version)) {
    const script = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.min.mjs`
    const worker = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`
    memo.set(version, import(/* @vite-ignore */ script)
      .then(m => { m.GlobalWorkerOptions.workerSrc = worker; return m })
      // A failed load is not cached: one flaky CDN fetch must not poison every
      // later upload in the session.
      .catch(err => { memo.delete(version); throw err }))
  }
  return memo.get(version)
}
