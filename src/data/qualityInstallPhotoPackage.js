// qualityInstallPhotoPackage — data + export for the Quality Install (QI) Tool.
//
// The QI Tool is triggered from the WI-IRA-MF-HOMES Final Project Payment Request
// incentive application. It pulls every evidence photo already captured on ANY
// work order under the incentive application's opportunity (across all projects),
// lets the Project Coordinator filter/search/select and drop photos into
// categories, then exports:
//   • a ZIP of the selected photos (full-resolution watermarked images that
//     retain their original EXIF/GPS), foldered by category;
//   • a PDF grouped by category, each photo captioned with its source work
//     order / step, capture time, and GPS.
// The PDF is saved onto the incentive application as a `qi_tool_pdf` document
// (the "QI Tool pdf" gallery) and both files download.
import { hydratePhotoUrls } from './storageService'
import { supabase } from '../lib/supabase'

function sanitizeSegment(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled'
}
function formatCaptureTime(iso) {
  if (!iso) return 'Capture time not recorded'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Capture time not recorded'
  return 'Captured ' + d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function formatGps(lat, lng) {
  if (typeof lat === 'number' && typeof lng === 'number') return `GPS ${lat.toFixed(6)}, ${lng.toFixed(6)}`
  return 'GPS not recorded'
}

// ── Load every evidence photo under the incentive application's opportunity ────
// Returns { opportunityId, photos, workTypes }. Each photo carries signed
// _thumbUrl / _originalUrl plus source metadata (work order, work type, step,
// category, capture time, GPS) for filtering and captioning.
export async function loadOpportunityEvidencePhotos(opportunityId) {
  if (!opportunityId) return { opportunityId: null, photos: [], workTypes: [], opportunityName: null, propertyName: null }
  const [{ data, error }, oppRes] = await Promise.all([
    supabase.rpc('list_opportunity_evidence_photos', { p_opportunity_id: opportunityId }),
    supabase.from('opportunities').select('opportunity_name, properties:property_id(property_name)').eq('id', opportunityId).maybeSingle(),
  ])
  if (error) throw new Error(`Could not load photos: ${error.message}`)
  const photos = await hydratePhotoUrls(data || [])
  const workTypes = Array.from(new Set(photos.map(p => p.work_type_name).filter(Boolean))).sort()
  return {
    opportunityId,
    opportunityName: oppRes?.data?.opportunity_name || null,
    propertyName: oppRes?.data?.properties?.property_name || null,
    photos,
    workTypes,
  }
}

// ── Image helpers ──────────────────────────────────────────────────────────────
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
    const img = new Image(); const url = URL.createObjectURL(blob)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}
async function downscaleToJpeg(blob, maxEdge = 1000, quality = 0.72) {
  const bmp = await blobToBitmap(blob)
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  if (bmp.close) bmp.close()
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), w, h }
}

// ── PDF layout (letter, points) ─────────────────────────────────────────────────
const PAGE_W = 612, PAGE_H = 792, M = 40
const CONTENT_W = PAGE_W - 2 * M, GAP = 16
const CELL_W = (CONTENT_W - GAP) / 2, IMG_BOX_H = 175, CAPTION_H = 30, ROW_H = IMG_BOX_H + CAPTION_H + 14
const NAVY = [13, 26, 46], MUTED = [74, 94, 122], EMERALD = [42, 171, 114], BORDER = [208, 216, 232], BAND = [240, 243, 248]

// ── Build ZIP + PDF from assembled category groups ───────────────────────────────
// groups: [{ category, photos: [photoRow…] }]. meta: { title lines }.
// onProgress(done, total). Returns { zipBlob, pdfBlob, baseName }.
export async function buildPhotoPackage({ groups, meta }, { onProgress } = {}) {
  const total = groups.reduce((n, g) => n + g.photos.length, 0)
  const [{ default: JSZip }, jspdfModule] = await Promise.all([import('jszip'), import('jspdf')])
  const JsPDF = jspdfModule.jsPDF || jspdfModule.default

  const zip = new JSZip()
  const usedPaths = new Set()
  const uniquePath = (p) => {
    let candidate = p, n = 1
    const dot = p.lastIndexOf('.'); const stem = dot > 0 ? p.slice(0, dot) : p; const ext = dot > 0 ? p.slice(dot) : ''
    while (usedPaths.has(candidate)) candidate = `${stem} (${++n})${ext}`
    usedPaths.add(candidate); return candidate
  }

  const doc = new JsPDF({ unit: 'pt', format: 'letter' })
  let y = M
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY)
  doc.text('Quality Install Verification', M, y + 4); y += 22
  doc.setFontSize(11); doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal')
  doc.text('Photo Documentation', M, y); y += 18
  doc.setFontSize(9.5); doc.setTextColor(...NAVY)
  for (const line of (meta?.lines || [])) { doc.text(String(line), M, y); y += 13 }
  doc.text(`Photos: ${total}`, M, y); y += 13
  doc.text(`Generated: ${new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, M, y); y += 13
  y += 6; doc.setDrawColor(...BORDER); doc.line(M, y, PAGE_W - M, y); y += 18

  const ensure = (need) => { if (y + need > PAGE_H - M) { doc.addPage(); y = M } }
  const drawCategoryHeading = (label, count) => {
    ensure(34 + ROW_H)
    doc.setFillColor(...BAND); doc.rect(M, y, CONTENT_W, 24, 'F')
    doc.setFillColor(...EMERALD); doc.rect(M, y, 4, 24, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...NAVY)
    doc.text(label, M + 12, y + 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
    doc.text(count === 1 ? '1 photo' : `${count} photos`, PAGE_W - M - 6, y + 16, { align: 'right' })
    y += 24 + 10
  }
  const drawCell = (dataUrl, w, h, col, photo) => {
    const x = M + col * (CELL_W + GAP)
    doc.setDrawColor(...BORDER); doc.rect(x, y, CELL_W, IMG_BOX_H)
    const scale = Math.min(CELL_W / w, IMG_BOX_H / h)
    const dw = Math.max(1, w * scale), dh = Math.max(1, h * scale)
    try { doc.addImage(dataUrl, 'JPEG', x + (CELL_W - dw) / 2, y + (IMG_BOX_H - dh) / 2, dw, dh) } catch { /* keep box */ }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    const src = [photo.work_order_record_number, photo.work_step_name].filter(Boolean).join(' · ')
    const cap = `${src}\n${formatCaptureTime(photo.taken_at)}  ·  ${formatGps(photo.latitude, photo.longitude)}`
    doc.text(doc.splitTextToSize(cap, CELL_W).slice(0, 3), x, y + IMG_BOX_H + 10)
  }

  let done = 0
  for (const group of groups) {
    if (!group.photos.length) continue
    drawCategoryHeading(group.category, group.photos.length)
    const catSeg = sanitizeSegment(group.category)
    let col = 0
    for (let i = 0; i < group.photos.length; i++) {
      const photo = group.photos[i]
      const url = photo._thumbUrl || photo._originalUrl
      try {
        const blob = await blobFromUrl(url)
        const src = sanitizeSegment([photo.work_order_record_number, photo.work_step_name].filter(Boolean).join(' - '))
        zip.file(uniquePath(`${catSeg}/${String(i + 1).padStart(2, '0')} ${src}.jpg`), blob)
        if (col === 0) ensure(ROW_H)
        const { dataUrl, w, h } = await downscaleToJpeg(blob)
        drawCell(dataUrl, w, h, col, photo)
      } catch {
        if (col === 0) ensure(ROW_H)
        doc.setDrawColor(...BORDER); doc.rect(M + col * (CELL_W + GAP), y, CELL_W, IMG_BOX_H)
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...MUTED)
        doc.text('Image unavailable', M + col * (CELL_W + GAP) + 8, y + IMG_BOX_H / 2)
      }
      col = col === 0 ? 1 : 0
      if (col === 0) y += ROW_H
      done++
      if (onProgress) onProgress(done, total)
    }
    if (col === 1) y += ROW_H
    y += 6
  }

  const [zipBlob, pdfBlob] = await Promise.all([
    zip.generateAsync({ type: 'blob' }),
    Promise.resolve(doc.output('blob')),
  ])
  const baseName = sanitizeSegment(`Quality Install Verification${meta?.baseSuffix ? ' - ' + meta.baseSuffix : ''} - Photos`)
  return { zipBlob, pdfBlob, baseName }
}

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
