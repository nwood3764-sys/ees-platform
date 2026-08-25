// ---------------------------------------------------------------------------
// pdfImages — fetch an image URL and hand back a JPEG data URL sized for a PDF.
//
// jsPDF embeds raster bytes verbatim, so a 12 MP phone capture would put ~4 MB
// in the file per photo. Every image is decoded through the browser (which
// also resolves the HEIC rendition path that hydratePhotoUrls signs) and
// re-encoded at a bounded long edge.
//
// Browser-only: uses fetch, createImageBitmap and a canvas. Callers keep it out
// of pure/node-tested modules.
// ---------------------------------------------------------------------------

export const PDF_IMAGE_MAX_EDGE = 1400
export const PDF_IMAGE_QUALITY  = 0.78

async function toBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob) } catch { /* fall through to <img> */ }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

/**
 * @returns {Promise<{dataUrl:string,w:number,h:number}|null>} null when the URL
 * is missing or the image cannot be decoded — a report never fails over one
 * unreadable photo; the renderer draws an empty box instead.
 */
export async function encodeImageForPdf(url, {
  maxEdge = PDF_IMAGE_MAX_EDGE, quality = PDF_IMAGE_QUALITY,
} = {}) {
  if (!url) return null
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch ${res.status}`)
  const bmp = await toBitmap(await res.blob())
  const sw = bmp.width || bmp.naturalWidth, sh = bmp.height || bmp.naturalHeight
  if (!sw || !sh) return null
  const scale = Math.min(1, maxEdge / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  if (bmp.close) bmp.close()
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), w, h }
}

// ---------------------------------------------------------------------------
// First page of a PDF, as a JPEG data URL.
//
// Used to preview an attached PDF inside a generated report. pdf.js is loaded
// from the same CDN build the Asset Score parser already uses, lazily, so a
// session that previews no PDF never downloads it.
// ---------------------------------------------------------------------------
const PDFJS_VERSION = '4.6.82'
const PDFJS_SCRIPT = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`

let _pdfjs = null
function loadPdfJs() {
  if (!_pdfjs) {
    _pdfjs = import(/* @vite-ignore */ PDFJS_SCRIPT)
      .then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m })
      .catch(err => { _pdfjs = null; throw err })
  }
  return _pdfjs
}

/**
 * @returns {Promise<{dataUrl:string,w:number,h:number}|null>} null when the URL
 * is missing or the file cannot be rendered — a preview is a nicety, and a
 * document that will not render still earns its row and its link.
 */
export async function renderPdfFirstPageForPdf(url, { maxEdge = 900, quality = 0.8 } = {}) {
  if (!url) return null
  const res = await fetch(url)
  if (!res.ok) throw new Error(`document fetch ${res.status}`)
  const data = await res.arrayBuffer()
  const pdfjs = await loadPdfJs()
  const pdf = await pdfjs.getDocument({ data }).promise
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2, maxEdge / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const ctx = canvas.getContext('2d')
    // A PDF page is transparent where it is blank; without this the preview
    // comes out on a black ground once flattened into JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return { dataUrl: canvas.toDataURL('image/jpeg', quality), w: canvas.width, h: canvas.height }
  } finally {
    try { await pdf.destroy() } catch { /* nothing to do */ }
  }
}
