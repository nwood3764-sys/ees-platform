// qualityInstallPhotoPackage — builds the Quality Install Verification photo
// evidence package from a verification work order:
//   1. a ZIP of every evidence photo, named and foldered per category → work
//      step (full-resolution watermarked images — the step name, GPS, and
//      capture timestamp are burned in and the original EXIF/GPS is retained);
//   2. a PDF laying the photos out grouped by category → work step, each with a
//      caption (capture time · GPS), so a reviewer sees coverage at a glance.
//
// Both are produced in a SINGLE fetch pass (each photo is downloaded once: the
// full blob goes into the ZIP, a downscaled copy goes into the PDF to keep the
// PDF a sane size even when a large building samples ~240 photos).
//
// The category comes from work_steps.work_step_category (migration
// 20260731005201); steps with no category collapse into a single trailing
// group so the export still works for any work order.
import { listWorkOrderPhotos, hydratePhotoUrls } from './storageService'
import { supabase } from '../lib/supabase'

const UNCATEGORIZED = 'Other Photos'

function sanitizeSegment(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled'
}

function leafName(name) {
  // Building names can be stored as a path ("1837 / 1837"); show the leaf.
  if (!name) return null
  const parts = String(name).split('/').map(p => p.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : String(name)
}

function formatCaptureTime(iso) {
  if (!iso) return 'Capture time not recorded'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Capture time not recorded'
  return 'Captured ' + d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatGps(lat, lng) {
  if (typeof lat === 'number' && typeof lng === 'number') {
    return `GPS ${lat.toFixed(6)}, ${lng.toFixed(6)}`
  }
  return 'GPS not recorded'
}

// ── Load + group ────────────────────────────────────────────────────────────
// Returns { workOrder, groups, totalPhotos, stepCount, emptyStepCount }.
// groups: [{ category, steps: [{ stepId, name, position, photos: [row…] }] }]
// ordered so each category appears in work-step execution order, Air Sealing
// before Insulation.
export async function loadQualityInstallPhotoPackage(workOrderId) {
  // Work order label context (building / property names via embeds).
  const { data: wo, error: woErr } = await supabase
    .from('work_orders')
    .select('id, work_order_record_number, work_order_name, building_id, property_id, opportunity_id, ' +
            'buildings:building_id(building_name, building_number_or_name), properties:property_id(property_name)')
    .eq('id', workOrderId)
    .maybeSingle()
  if (woErr) throw new Error(`work order load failed: ${woErr.message}`)

  // All (non-deleted) steps for the WO, with the category we group by.
  const { data: steps, error: stepErr } = await supabase
    .from('work_steps')
    .select('id, work_step_name, work_step_execution_order, work_step_plan_execution_order, work_step_category')
    .eq('work_order_id', workOrderId)
    .eq('work_step_is_deleted', false)
  if (stepErr) throw new Error(`work steps load failed: ${stepErr.message}`)

  const stepOrder = (s) => s.work_step_execution_order ?? s.work_step_plan_execution_order ?? Number.MAX_SAFE_INTEGER
  const orderedSteps = [...(steps || [])].sort((a, b) => stepOrder(a) - stepOrder(b))

  // Photos (with signed URLs), grouped by step.
  const rawPhotos = await listWorkOrderPhotos(workOrderId)
  const photos = await hydratePhotoUrls(rawPhotos)
  const photosByStep = new Map()
  for (const p of photos) {
    const k = p._work_step_id
    if (!photosByStep.has(k)) photosByStep.set(k, [])
    photosByStep.get(k).push(p)
  }

  // Build category groups in first-seen (execution) order.
  const groupIndex = new Map()
  const groups = []
  let totalPhotos = 0
  let emptyStepCount = 0
  for (const s of orderedSteps) {
    const cat = s.work_step_category || UNCATEGORIZED
    if (!groupIndex.has(cat)) {
      groupIndex.set(cat, groups.length)
      groups.push({ category: cat, steps: [] })
    }
    const stepPhotos = photosByStep.get(s.id) || []
    totalPhotos += stepPhotos.length
    if (stepPhotos.length === 0) emptyStepCount++
    groups[groupIndex.get(cat)].steps.push({
      stepId: s.id,
      name: s.work_step_name || 'Untitled step',
      position: stepOrder(s),
      photos: stepPhotos,
    })
  }

  const buildingLabel = leafName(wo?.buildings?.building_number_or_name) || leafName(wo?.buildings?.building_name) || null
  const propertyLabel = wo?.properties?.property_name || null

  return {
    workOrder: {
      id: workOrderId,
      recordNumber: wo?.work_order_record_number || null,
      name: wo?.work_order_name || 'Quality Install Verification',
      buildingLabel,
      propertyLabel,
    },
    groups,
    totalPhotos,
    stepCount: orderedSteps.length,
    emptyStepCount,
  }
}

// ── Image helpers ─────────────────────────────────────────────────────────────
async function blobFromUrl(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch ${res.status}`)
  return await res.blob()
}

async function blobToBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob) } catch { /* fall through */ }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

async function downscaleToJpeg(blob, maxEdge = 1000, quality = 0.72) {
  const bmp = await blobToBitmap(blob)
  const w0 = bmp.width, h0 = bmp.height
  const scale = Math.min(1, maxEdge / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  if (bmp.close) bmp.close()
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), w, h }
}

// ── PDF layout constants (letter, points) ─────────────────────────────────────
const PAGE_W = 612, PAGE_H = 792, M = 40
const CONTENT_W = PAGE_W - 2 * M
const GAP = 16
const CELL_W = (CONTENT_W - GAP) / 2
const IMG_BOX_H = 175
const CAPTION_H = 26
const ROW_H = IMG_BOX_H + CAPTION_H + 14
const NAVY = [13, 26, 46]
const MUTED = [74, 94, 122]
const EMERALD = [42, 171, 114]
const BORDER = [208, 216, 232]
const BAND = [240, 243, 248]

// ── Build ZIP + PDF ───────────────────────────────────────────────────────────
// pkg = the object from loadQualityInstallPhotoPackage. onProgress(done,total).
// Returns { zipBlob, pdfBlob, baseName }.
export async function buildQualityInstallPhotoPackage(pkg, { onProgress } = {}) {
  const { workOrder, groups, totalPhotos } = pkg
  const [{ default: JSZip }, jspdfModule] = await Promise.all([import('jszip'), import('jspdf')])
  const JsPDF = jspdfModule.jsPDF || jspdfModule.default

  const zip = new JSZip()
  const usedPaths = new Set()
  const uniquePath = (p) => {
    let candidate = p, n = 1
    const dot = p.lastIndexOf('.')
    const stem = dot > 0 ? p.slice(0, dot) : p
    const ext = dot > 0 ? p.slice(dot) : ''
    while (usedPaths.has(candidate)) { candidate = `${stem} (${++n})${ext}` }
    usedPaths.add(candidate)
    return candidate
  }

  const doc = new JsPDF({ unit: 'pt', format: 'letter' })
  let y = M

  // Cover header
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY)
  doc.text('Quality Install Verification', M, y + 4); y += 22
  doc.setFontSize(11); doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal')
  doc.text('Photo Documentation', M, y); y += 18
  doc.setFontSize(9.5); doc.setTextColor(...NAVY)
  const ctxLines = []
  if (workOrder.propertyLabel) ctxLines.push(`Property: ${workOrder.propertyLabel}`)
  if (workOrder.buildingLabel) ctxLines.push(`Building: ${workOrder.buildingLabel}`)
  if (workOrder.recordNumber) ctxLines.push(`Work Order: ${workOrder.recordNumber}`)
  ctxLines.push(`Photos: ${totalPhotos}`)
  ctxLines.push(`Generated: ${new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)
  for (const line of ctxLines) { doc.text(line, M, y); y += 13 }
  y += 6
  doc.setDrawColor(...BORDER); doc.line(M, y, PAGE_W - M, y); y += 18

  const ensure = (needed) => { if (y + needed > PAGE_H - M) { doc.addPage(); y = M } }

  const drawCategoryHeading = (label) => {
    ensure(34 + ROW_H)
    doc.setFillColor(...BAND); doc.rect(M, y, CONTENT_W, 24, 'F')
    doc.setFillColor(...EMERALD); doc.rect(M, y, 4, 24, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...NAVY)
    doc.text(label, M + 12, y + 16)
    y += 24 + 10
  }

  const drawStepHeading = (label, count) => {
    ensure(22 + (count > 0 ? ROW_H : 18))
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY)
    doc.text(label, M, y + 10)
    const cntTxt = count === 1 ? '1 photo' : `${count} photos`
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
    doc.text(cntTxt, PAGE_W - M, y + 10, { align: 'right' })
    y += 16
    doc.setDrawColor(...BORDER); doc.line(M, y, PAGE_W - M, y); y += 10
  }

  const drawPhotoCell = (dataUrl, w, h, col, photo) => {
    const x = M + col * (CELL_W + GAP)
    // border box
    doc.setDrawColor(...BORDER); doc.rect(x, y, CELL_W, IMG_BOX_H)
    const scale = Math.min(CELL_W / w, IMG_BOX_H / h)
    const dw = Math.max(1, w * scale), dh = Math.max(1, h * scale)
    const ix = x + (CELL_W - dw) / 2, iy = y + (IMG_BOX_H - dh) / 2
    try { doc.addImage(dataUrl, 'JPEG', ix, iy, dw, dh) } catch { /* skip a bad image, keep the box */ }
    // caption
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    const cap = `${formatCaptureTime(photo.taken_at)}  ·  ${formatGps(photo.latitude, photo.longitude)}`
    const wrapped = doc.splitTextToSize(cap, CELL_W)
    doc.text(wrapped.slice(0, 2), x, y + IMG_BOX_H + 11)
  }

  let done = 0
  for (const group of groups) {
    drawCategoryHeading(group.category)
    for (const step of group.steps) {
      drawStepHeading(step.name, step.photos.length)
      if (step.photos.length === 0) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
        doc.text('No photos captured for this step.', M, y + 8); y += 20
        continue
      }
      const catSeg = sanitizeSegment(group.category)
      const stepSeg = sanitizeSegment(step.name)
      let col = 0
      for (let i = 0; i < step.photos.length; i++) {
        const photo = step.photos[i]
        const url = photo._thumbUrl || photo._originalUrl
        try {
          const blob = await blobFromUrl(url)
          // ZIP: full-resolution watermarked image, named per category/step.
          const base = `${String(i + 1).padStart(2, '0')} ${stepSeg}.jpg`
          zip.file(uniquePath(`${catSeg}/${stepSeg}/${base}`), blob)
          // PDF: downscaled copy.
          if (col === 0) ensure(ROW_H)
          const { dataUrl, w, h } = await downscaleToJpeg(blob)
          drawPhotoCell(dataUrl, w, h, col, photo)
        } catch {
          // Fetch/decode failed — leave a placeholder cell so the count still reads true.
          if (col === 0) ensure(ROW_H)
          doc.setDrawColor(...BORDER); doc.rect(M + col * (CELL_W + GAP), y, CELL_W, IMG_BOX_H)
          doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...MUTED)
          doc.text('Image unavailable', M + col * (CELL_W + GAP) + 8, y + IMG_BOX_H / 2)
        }
        col = col === 0 ? 1 : 0
        if (col === 0) y += ROW_H
        done++
        if (onProgress) onProgress(done, totalPhotos)
      }
      if (col === 1) y += ROW_H // close a half-filled row
      y += 6
    }
  }

  const [zipBlob, pdfBlob] = await Promise.all([
    zip.generateAsync({ type: 'blob' }),
    Promise.resolve(doc.output('blob')),
  ])

  const labelBits = [workOrder.recordNumber, workOrder.buildingLabel].filter(Boolean).join(' - ')
  const baseName = sanitizeSegment(`Quality Install Verification ${labelBits ? '- ' + labelBits : ''} - Photos`)
  return { zipBlob, pdfBlob, baseName }
}

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
