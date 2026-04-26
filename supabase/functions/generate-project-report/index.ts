// =============================================================================
// generate-project-report
//
// Two modes, dispatched by `preview` in the request body.
//
// ── Generate mode (default) ───────────────────────────────────────────────
// Reads a project + its full work-order/work-step/photo chain, walks the
// project_report_templates → project_report_template_sections rows, and
// renders the report as a PDF. Uploads the PDF to property-documents and
// inserts a documents row pointing at it so the project's Documents widget
// picks it up automatically.
//
// Template resolution order:
//   1. explicit prt_id passed in the request
//   2. PRTRTA assignment whose project_record_type matches this project
//      and prtrta_is_default = true
//   3. PRT row with prt_is_default_for_unmapped = true (the seeded fallback)
//
// Active-only status gate: only PRTs with prt_status = "Active" can generate
// real reports. Drafts and Archived templates are rejected with a 400.
//
// ── Preview mode (preview: true) ──────────────────────────────────────────
// Renders the same PDF against a synthetic in-memory project graph. No
// project is read from the DB, no documents row is created, no storage
// upload happens — the PDF is returned as a binary `application/pdf`
// response so the browser can open it in a new tab.
//
// Preview requires `prt_id` (the template being previewed) but not
// `project_id`. The Active-only status gate is bypassed so authors can
// preview Draft and Archived templates while iterating.
//
// Renderer support: cover_page, project_summary, work_orders_overview,
// work_order_section, custom_text, page_break, footer. Other section types
// render a placeholder "[Section: <type> — not yet supported]" line so a
// template authored in the Phase 2 Builder UI doesn't silently drop content.
//
// All authentication piggybacks on the caller's JWT (verify_jwt = true). RLS
// already grants `authenticated` SELECT on every table we read here, so no
// service role is required.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1"

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

const C = {
  textPrimary:   rgb(13 / 255,  26 / 255,  46 / 255),
  textSecondary: rgb(74 / 255,  94 / 255, 122 / 255),
  textMuted:     rgb(143 / 255, 160 / 255, 184 / 255),
  border:        rgb(228 / 255, 233 / 255, 242 / 255),
  borderDark:    rgb(208 / 255, 216 / 255, 232 / 255),
  emerald:       rgb(62 / 255,  207 / 255, 142 / 255),
  white:         rgb(1, 1, 1),
  ink:           rgb(7 / 255,   17 / 255,  31 / 255),
  card:          rgb(247 / 255, 249 / 255, 252 / 255),
}

// 8.5 x 11 inch Letter portrait, in PDF points (72 / inch)
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54   // 0.75"
const TOP_MARGIN = 72
const BOTTOM_MARGIN = 72
const CONTENT_W = PAGE_W - MARGIN * 2

const SUPPORTED_PHOTO_MIME = new Set(["image/jpeg", "image/jpg", "image/png"])

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

interface Picklist {
  id: string
  picklist_object: string
  picklist_field: string
  picklist_value: string
  picklist_label: string
}

interface PRT {
  id: string
  prt_record_number: string
  prt_name: string
  prt_description: string | null
  prt_record_type: string | null
  prt_status: string | null
  prt_orientation: string | null
  prt_paper_size: string | null
  prt_version: number
  prt_is_default_for_unmapped: boolean
}

interface PRTS {
  id: string
  prts_record_number: string
  prt_id: string
  prts_section_order: number
  prts_section_type: string
  prts_section_title: string | null
  prts_body_template: string | null
  prts_config: Record<string, any>
  prts_filter_config: Record<string, any>
  prts_show_if_empty: boolean
  prts_page_break_after: boolean
  // resolved
  section_type_value: string
}

interface Project {
  id: string
  project_record_number: string | null
  project_name: string | null
  project_record_type: string | null
  project_status: string | null
  project_owner: string | null
  property_id: string | null
  project_account_id: string | null
}

interface WorkOrder {
  id: string
  work_order_record_number: string | null
  work_order_name: string | null
  work_order_status: string | null
  work_order_record_type: string | null
  work_type_id: string | null
  project_id: string
}

interface WorkStep {
  id: string
  work_step_record_number: string | null
  work_step_name: string | null
  work_step_description: string | null
  work_step_status: string | null
  work_step_execution_order: number | null
  work_step_plan_execution_order: number | null
  work_step_start_time: string | null
  work_step_end_time: string | null
  work_step_owner: string | null
  work_order_id: string
}

interface Photo {
  id: string
  caption: string | null
  photo_type: string | null
  taken_at: string | null
  taken_by: string | null
  latitude: number | null
  longitude: number | null
  storage_bucket: string | null
  storage_path_original: string | null
  storage_path_watermarked: string | null
  mime_type: string | null
  related_object: string
  related_id: string
  work_step_id: string | null
}

// ───────────────────────────────────────────────────────────────────────────
// Cursor — running y-position with auto page breaks.
// ───────────────────────────────────────────────────────────────────────────

class Cursor {
  pdf: PDFDocument
  pages: PDFPage[] = []
  page: PDFPage
  y: number
  font: PDFFont
  fontBold: PDFFont

  constructor(pdf: PDFDocument, font: PDFFont, fontBold: PDFFont) {
    this.pdf = pdf
    this.font = font
    this.fontBold = fontBold
    this.page = this.newPage()
    this.y = PAGE_H - TOP_MARGIN
  }

  newPage(): PDFPage {
    const p = this.pdf.addPage([PAGE_W, PAGE_H])
    this.pages.push(p)
    this.page = p
    this.y = PAGE_H - TOP_MARGIN
    return p
  }

  ensureSpace(needed: number) {
    if (this.y - needed < BOTTOM_MARGIN) this.newPage()
  }

  pageBreak() { this.newPage() }
}

// ───────────────────────────────────────────────────────────────────────────
// Drawing primitives
// ───────────────────────────────────────────────────────────────────────────

function drawText(cur: Cursor, text: string, opts: {
  size?: number
  color?: ReturnType<typeof rgb>
  bold?: boolean
  x?: number
  maxWidth?: number
  lineHeight?: number
} = {}) {
  const size = opts.size ?? 11
  const color = opts.color ?? C.textPrimary
  const font = opts.bold ? cur.fontBold : cur.font
  const x = opts.x ?? MARGIN
  const maxWidth = opts.maxWidth ?? CONTENT_W
  const lineHeight = opts.lineHeight ?? size * 1.4

  const lines = wrapText(text || "", font, size, maxWidth)
  for (const line of lines) {
    cur.ensureSpace(lineHeight)
    cur.page.drawText(line, { x, y: cur.y - size, size, font, color })
    cur.y -= lineHeight
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [""]
  const out: string[] = []
  for (const rawLine of text.split("\n")) {
    if (!rawLine) { out.push(""); continue }
    const words = rawLine.split(/\s+/)
    let line = ""
    for (const w of words) {
      const trial = line ? line + " " + w : w
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
        line = trial
      } else {
        if (line) out.push(line)
        // single very-long token — hard chunk
        if (font.widthOfTextAtSize(w, size) > maxWidth) {
          let chunk = ""
          for (const ch of w) {
            const t2 = chunk + ch
            if (font.widthOfTextAtSize(t2, size) <= maxWidth) chunk = t2
            else { out.push(chunk); chunk = ch }
          }
          line = chunk
        } else {
          line = w
        }
      }
    }
    out.push(line)
  }
  return out
}

function drawDivider(cur: Cursor, opts: { color?: ReturnType<typeof rgb>, padBefore?: number, padAfter?: number } = {}) {
  const padBefore = opts.padBefore ?? 6
  const padAfter = opts.padAfter ?? 10
  cur.ensureSpace(padBefore + 1 + padAfter)
  cur.y -= padBefore
  cur.page.drawLine({
    start: { x: MARGIN, y: cur.y },
    end:   { x: PAGE_W - MARGIN, y: cur.y },
    thickness: 0.5,
    color: opts.color ?? C.border,
  })
  cur.y -= padAfter
}

function drawKeyValueRow(cur: Cursor, key: string, val: string, opts: { keyW?: number, size?: number } = {}) {
  const size = opts.size ?? 10.5
  const keyW = opts.keyW ?? 150
  const lineHeight = size * 1.5
  cur.ensureSpace(lineHeight)
  cur.page.drawText(key, {
    x: MARGIN, y: cur.y - size, size,
    font: cur.fontBold, color: C.textSecondary,
  })
  // Value: wrap if long
  const lines = wrapText(val ?? "—", cur.font, size, CONTENT_W - keyW)
  let first = true
  for (const line of lines) {
    if (!first) cur.ensureSpace(lineHeight)
    cur.page.drawText(line, {
      x: MARGIN + keyW, y: cur.y - size, size,
      font: cur.font, color: C.textPrimary,
    })
    cur.y -= lineHeight
    first = false
  }
}

function drawTableHeader(cur: Cursor, columns: { label: string, w: number }[], rowH = 22) {
  cur.ensureSpace(rowH + 2)
  cur.page.drawRectangle({
    x: MARGIN, y: cur.y - rowH, width: CONTENT_W, height: rowH,
    color: C.card,
  })
  let x = MARGIN + 8
  for (const col of columns) {
    cur.page.drawText(col.label, {
      x, y: cur.y - rowH + 7, size: 9.5,
      font: cur.fontBold, color: C.textSecondary,
    })
    x += col.w
  }
  cur.y -= rowH
  cur.page.drawLine({
    start: { x: MARGIN, y: cur.y }, end: { x: PAGE_W - MARGIN, y: cur.y },
    thickness: 0.5, color: C.borderDark,
  })
}

function drawTableRow(cur: Cursor, columns: { label: string, w: number }[], values: string[], rowH = 20) {
  cur.ensureSpace(rowH + 2)
  let x = MARGIN + 8
  for (let i = 0; i < columns.length; i++) {
    const v = values[i] ?? ""
    const lines = wrapText(v, cur.font, 9.5, columns[i].w - 8)
    cur.page.drawText(lines[0] || "", {
      x, y: cur.y - rowH + 6, size: 9.5,
      font: cur.font, color: C.textPrimary,
    })
    x += columns[i].w
  }
  cur.y -= rowH
  cur.page.drawLine({
    start: { x: MARGIN, y: cur.y }, end: { x: PAGE_W - MARGIN, y: cur.y },
    thickness: 0.25, color: C.border,
  })
}

// ───────────────────────────────────────────────────────────────────────────
// Section renderers
// ───────────────────────────────────────────────────────────────────────────

interface RenderCtx {
  cur: Cursor
  client: SupabaseClient
  project: Project
  workOrders: WorkOrder[]
  workStepsByWO: Map<string, WorkStep[]>
  photosByStep: Map<string, Photo[]>
  photosByWO: Map<string, Photo[]>  // photos with related_object='work_orders'
  picklistById: Map<string, Picklist>
  userNamesById: Map<string, string>
  property: any | null
  account: any | null
  generatedAt: Date
  generatedByName: string
  watermarkChoice: "watermarked" | "original"
  prt: PRT
}

async function renderCoverPage(ctx: RenderCtx, section: PRTS) {
  const cfg = section.prts_config || {}
  const { cur } = ctx
  // Center the cover content vertically
  cur.y = PAGE_H - 220

  drawText(cur, cfg.title || "Project Report", { size: 30, bold: true })
  cur.y -= 8

  drawText(cur, ctx.project.project_name || "Untitled Project", { size: 18, color: C.textSecondary })
  if (ctx.project.project_record_number) {
    drawText(cur, ctx.project.project_record_number, {
      size: 12, color: C.textMuted,
    })
  }

  cur.y -= 30
  drawDivider(cur, { padAfter: 20 })

  if (ctx.property) {
    drawText(cur, ctx.property.property_name || "", { size: 13, bold: true })
    const addr = [
      ctx.property.property_address_line_1,
      ctx.property.property_city && `${ctx.property.property_city}, ${ctx.property.property_state || ""} ${ctx.property.property_postal_code || ""}`.trim(),
    ].filter(Boolean).join("\n")
    if (addr) drawText(cur, addr, { size: 11, color: C.textSecondary })
  }

  cur.y -= 40

  if (cfg.show_generation_date !== false) {
    drawKeyValueRow(cur, "Generated", ctx.generatedAt.toLocaleString("en-US", {
      dateStyle: "long", timeStyle: "short",
    }))
  }
  if (cfg.show_generated_by !== false) {
    drawKeyValueRow(cur, "Generated by", ctx.generatedByName)
  }
  if (cfg.show_watermark_flag !== false) {
    drawKeyValueRow(cur, "Photo variant", ctx.watermarkChoice === "watermarked" ? "Watermarked" : "Original")
  }
  drawKeyValueRow(cur, "Template", `${ctx.prt.prt_name} (${ctx.prt.prt_record_number}, v${ctx.prt.prt_version})`)
  drawKeyValueRow(cur, "Total work orders", String(ctx.workOrders.length))
  const totalSteps = Array.from(ctx.workStepsByWO.values()).reduce((a, b) => a + b.length, 0)
  drawKeyValueRow(cur, "Total work steps", String(totalSteps))
  let totalPhotos = 0
  for (const arr of ctx.photosByStep.values()) totalPhotos += arr.length
  for (const arr of ctx.photosByWO.values()) totalPhotos += arr.length
  drawKeyValueRow(cur, "Total photos", String(totalPhotos))
}

async function renderProjectSummary(ctx: RenderCtx, section: PRTS) {
  const cfg = section.prts_config || {}
  const { cur, project, picklistById } = ctx

  drawText(cur, section.prts_section_title || "Project Summary", { size: 16, bold: true })
  drawDivider(cur)

  if (cfg.show_record_number !== false && project.project_record_number) {
    drawKeyValueRow(cur, "Record number", project.project_record_number)
  }
  if (cfg.show_name !== false) {
    drawKeyValueRow(cur, "Project name", project.project_name || "—")
  }
  if (cfg.show_record_type !== false && project.project_record_type) {
    drawKeyValueRow(cur, "Record type", picklistById.get(project.project_record_type)?.picklist_label || "—")
  }
  if (cfg.show_status !== false && project.project_status) {
    drawKeyValueRow(cur, "Status", picklistById.get(project.project_status)?.picklist_label || "—")
  }
  if (cfg.show_owner !== false && project.project_owner) {
    drawKeyValueRow(cur, "Owner", ctx.userNamesById.get(project.project_owner) || "—")
  }
  if (cfg.show_property !== false && ctx.property) {
    drawKeyValueRow(cur, "Property", ctx.property.property_name || "—")
    const addrParts = [
      ctx.property.property_address_line_1,
      ctx.property.property_address_line_2,
      [ctx.property.property_city, ctx.property.property_state, ctx.property.property_postal_code].filter(Boolean).join(" "),
    ].filter(Boolean).join(", ")
    if (addrParts) drawKeyValueRow(cur, "Address", addrParts)
  }
  if (cfg.show_account !== false && ctx.account) {
    drawKeyValueRow(cur, "Account", ctx.account.account_name || "—")
  }
}

async function renderWorkOrdersOverview(ctx: RenderCtx, section: PRTS) {
  const { cur, workOrders, workStepsByWO, photosByStep, photosByWO, picklistById } = ctx

  drawText(cur, section.prts_section_title || "Work Orders Overview", { size: 16, bold: true })
  drawDivider(cur)

  if (workOrders.length === 0) {
    drawText(cur, "No work orders found for this project.", { color: C.textMuted, size: 11 })
    return
  }

  const cols = [
    { label: "Number",   w: 90  },
    { label: "Name",     w: 200 },
    { label: "Status",   w: 100 },
    { label: "Steps",    w: 50  },
    { label: "Photos",   w: 50  },
  ]
  drawTableHeader(cur, cols)
  for (const wo of workOrders) {
    const stepCount = workStepsByWO.get(wo.id)?.length ?? 0
    let photoCount = (photosByWO.get(wo.id)?.length ?? 0)
    for (const step of (workStepsByWO.get(wo.id) || [])) {
      photoCount += (photosByStep.get(step.id)?.length ?? 0)
    }
    drawTableRow(cur, cols, [
      wo.work_order_record_number || "—",
      wo.work_order_name || "—",
      wo.work_order_status ? (picklistById.get(wo.work_order_status)?.picklist_label || "—") : "—",
      String(stepCount),
      String(photoCount),
    ])
  }
}

async function renderWorkOrderSection(ctx: RenderCtx, section: PRTS) {
  const cfg = section.prts_config || {}
  const { cur, workOrders, workStepsByWO, photosByStep, photosByWO, picklistById } = ctx

  if (workOrders.length === 0) {
    if (!section.prts_show_if_empty) return
    drawText(cur, "No work orders found for this project.", { color: C.textMuted, size: 11 })
    return
  }

  let firstWO = true
  for (const wo of workOrders) {
    if (!firstWO && cfg.page_break_per_iteration !== false) cur.pageBreak()
    firstWO = false

    drawText(cur, `Work Order: ${wo.work_order_record_number || ""}`.trim(), { size: 16, bold: true })
    if (wo.work_order_name) {
      drawText(cur, wo.work_order_name, { size: 13, color: C.textSecondary })
    }
    drawDivider(cur)

    drawKeyValueRow(cur, "Status",
      wo.work_order_status ? (picklistById.get(wo.work_order_status)?.picklist_label || "—") : "—")
    drawKeyValueRow(cur, "Record type",
      wo.work_order_record_type ? (picklistById.get(wo.work_order_record_type)?.picklist_label || "—") : "—")

    const steps = workStepsByWO.get(wo.id) || []
    drawKeyValueRow(cur, "Work steps", String(steps.length))

    const woPhotos = photosByWO.get(wo.id) || []
    let stepPhotoTotal = 0
    for (const s of steps) stepPhotoTotal += (photosByStep.get(s.id)?.length ?? 0)
    drawKeyValueRow(cur, "Photos", String(woPhotos.length + stepPhotoTotal))

    cur.y -= 6

    // Work-order-level photos (not pinned to a specific step)
    if (cfg.include_photos !== false && woPhotos.length > 0) {
      drawText(cur, "Work order photos", { size: 12, bold: true, color: C.textSecondary })
      drawDivider(cur, { padBefore: 2, padAfter: 6, color: C.border })
      await renderPhotoGrid(ctx, woPhotos, cfg)
    }

    if (cfg.include_work_steps !== false) {
      for (const step of steps) {
        cur.y -= 8
        drawText(
          cur,
          `Step ${step.work_step_execution_order ?? step.work_step_plan_execution_order ?? "?"} — ${step.work_step_name || "Untitled"}`,
          { size: 13, bold: true }
        )
        if (step.work_step_description) {
          drawText(cur, step.work_step_description, { size: 10.5, color: C.textSecondary })
        }
        if (cfg.include_step_metadata !== false) {
          if (step.work_step_status) {
            drawKeyValueRow(cur, "Status",
              picklistById.get(step.work_step_status)?.picklist_label || "—",
              { keyW: 80, size: 10 })
          }
          if (step.work_step_start_time || step.work_step_end_time) {
            const range = [
              step.work_step_start_time && new Date(step.work_step_start_time).toLocaleString(),
              step.work_step_end_time   && new Date(step.work_step_end_time).toLocaleString(),
            ].filter(Boolean).join(" → ")
            if (range) drawKeyValueRow(cur, "Time", range, { keyW: 80, size: 10 })
          }
          if (step.work_step_owner) {
            drawKeyValueRow(cur, "Owner",
              ctx.userNamesById.get(step.work_step_owner) || "—",
              { keyW: 80, size: 10 })
          }
        }

        const stepPhotos = photosByStep.get(step.id) || []
        if (cfg.include_photos !== false && stepPhotos.length > 0) {
          cur.y -= 4
          await renderPhotoGrid(ctx, stepPhotos, cfg)
        }
      }
    }
  }
}

async function renderPhotoGrid(ctx: RenderCtx, photos: Photo[], cfg: any) {
  const { cur, client } = ctx
  const cols = Math.max(1, Math.min(3, cfg.photo_grid_columns ?? 2))
  const gap = 12
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols
  const cellH = cellW * 0.75 // 4:3 framing
  const captionH = 36
  const rowH = cellH + captionH + 14

  for (let i = 0; i < photos.length; i += cols) {
    cur.ensureSpace(rowH + 8)
    const rowTopY = cur.y
    for (let c = 0; c < cols; c++) {
      const photo = photos[i + c]
      if (!photo) continue
      const x = MARGIN + c * (cellW + gap)
      const yTop = rowTopY
      const yBottom = yTop - cellH

      // Draw cell border
      cur.page.drawRectangle({
        x, y: yBottom, width: cellW, height: cellH,
        borderColor: C.borderDark, borderWidth: 0.5, color: C.card,
      })

      // Try to embed the photo
      const embedded = await tryEmbedPhoto(client, photo, cur.pdf, ctx.watermarkChoice)
      if (embedded) {
        const { image, w, h } = embedded
        const scale = Math.min((cellW - 8) / w, (cellH - 8) / h)
        const drawW = w * scale
        const drawH = h * scale
        const dx = x + (cellW - drawW) / 2
        const dy = yBottom + (cellH - drawH) / 2
        cur.page.drawImage(image, { x: dx, y: dy, width: drawW, height: drawH })
      } else {
        cur.page.drawText("[image unavailable]", {
          x: x + 8, y: yBottom + cellH / 2 - 5,
          size: 9, font: cur.font, color: C.textMuted,
        })
      }

      // Caption block below the cell
      const captionY = yBottom - 4
      const captionLines: string[] = []
      if (cfg.show_photo_caption !== false && photo.caption) captionLines.push(photo.caption)
      const meta: string[] = []
      if (cfg.show_photo_taken_at !== false && photo.taken_at) {
        meta.push(new Date(photo.taken_at).toLocaleString())
      }
      if (cfg.show_photo_gps !== false && photo.latitude != null && photo.longitude != null) {
        meta.push(`${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`)
      }
      if (cfg.show_photo_taken_by !== false && photo.taken_by) {
        meta.push(ctx.userNamesById.get(photo.taken_by) || "")
      }
      if (meta.length) captionLines.push(meta.filter(Boolean).join(" • "))

      let yy = captionY
      for (const line of captionLines.slice(0, 2)) {
        const trimmed = wrapText(line, cur.font, 8.5, cellW)[0] || ""
        cur.page.drawText(trimmed, {
          x, y: yy - 8, size: 8.5,
          font: cur.font, color: C.textSecondary,
        })
        yy -= 11
      }
    }
    cur.y = rowTopY - rowH
  }
}

async function tryEmbedPhoto(
  client: SupabaseClient,
  photo: Photo,
  pdf: PDFDocument,
  watermarkChoice: "watermarked" | "original",
): Promise<{ image: any, w: number, h: number } | null> {
  try {
    const bucket = photo.storage_bucket || "work-evidence"
    let path: string | null = null
    if (watermarkChoice === "watermarked" && photo.storage_path_watermarked) {
      path = photo.storage_path_watermarked
    } else if (photo.storage_path_original) {
      path = photo.storage_path_original
    } else if (watermarkChoice === "watermarked" && photo.storage_path_original) {
      // Fallback: requested watermarked but only original exists
      path = photo.storage_path_original
    }
    if (!path) return null

    const mime = (photo.mime_type || "").toLowerCase()
    if (!SUPPORTED_PHOTO_MIME.has(mime) && !path.match(/\.(jpe?g|png)$/i)) {
      // We can only embed JPG and PNG with pdf-lib without a decoder library
      return null
    }

    const { data, error } = await client.storage.from(bucket).download(path)
    if (error || !data) return null
    const bytes = new Uint8Array(await data.arrayBuffer())

    const isPng = mime.includes("png") || /\.png$/i.test(path)
    const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    return { image, w: image.width, h: image.height }
  } catch (e) {
    console.warn("photo embed failed", photo.id, (e as Error).message)
    return null
  }
}

async function renderFooter(ctx: RenderCtx, section: PRTS) {
  // Footer applies to every page after the fact.
  const cfg = section.prts_config || {}
  const showPage = cfg.show_page_numbers !== false
  const showDate = cfg.show_generation_date !== false
  const showId = cfg.show_record_id !== false
  const showCo = cfg.show_company_name !== false

  const lineY = 36
  const total = ctx.cur.pages.length

  for (let i = 0; i < total; i++) {
    const p = ctx.cur.pages[i]
    p.drawLine({
      start: { x: MARGIN, y: lineY + 14 }, end: { x: PAGE_W - MARGIN, y: lineY + 14 },
      thickness: 0.5, color: C.border,
    })
    const left = [
      showCo ? (cfg.company_name || "Energy Efficiency Services of Wisconsin") : null,
      showDate ? ctx.generatedAt.toLocaleDateString() : null,
    ].filter(Boolean).join("  •  ")
    if (left) {
      p.drawText(left, {
        x: MARGIN, y: lineY, size: 8.5,
        font: ctx.cur.font, color: C.textMuted,
      })
    }
    if (showId) {
      const id = `${ctx.project.project_record_number || ""} / ${ctx.prt.prt_record_number}`
      const idW = ctx.cur.font.widthOfTextAtSize(id, 8.5)
      p.drawText(id, {
        x: (PAGE_W - idW) / 2, y: lineY, size: 8.5,
        font: ctx.cur.font, color: C.textMuted,
      })
    }
    if (showPage) {
      const txt = `Page ${i + 1} of ${total}`
      const w = ctx.cur.font.widthOfTextAtSize(txt, 8.5)
      p.drawText(txt, {
        x: PAGE_W - MARGIN - w, y: lineY, size: 8.5,
        font: ctx.cur.font, color: C.textMuted,
      })
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Data loading
// ───────────────────────────────────────────────────────────────────────────

async function loadAllPicklists(client: SupabaseClient): Promise<Map<string, Picklist>> {
  const map = new Map<string, Picklist>()
  // Pull only what we need: status, record_type fields across the relevant objects
  const { data, error } = await client.from("picklist_values").select("id,picklist_object,picklist_field,picklist_value,picklist_label")
    .in("picklist_object", [
      "projects", "work_orders", "work_steps",
      "project_report_templates", "project_report_template_sections",
    ])
  if (error) throw new Error(`picklists load failed: ${error.message}`)
  for (const r of (data || [])) map.set(r.id, r as Picklist)
  return map
}

// Find a picklist row by its (object, field, value) triple. Returns the row's
// id, or null if no row matches. Used by the preview-mode synthetic graph to
// pick realistic status / record_type UUIDs so the rendered PDF shows real
// labels ("Project Scheduled") instead of dashes.
function findPicklistIdByValue(
  map: Map<string, Picklist>,
  object: string,
  field: string,
  value: string,
): string | null {
  for (const row of map.values()) {
    if (row.picklist_object === object && row.picklist_field === field && row.picklist_value === value) {
      return row.id
    }
  }
  return null
}

async function loadUserNames(client: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  const map = new Map<string, string>()
  if (ids.length === 0) return map
  const { data, error } = await client.from("users").select("id,user_first_name,user_last_name,user_email").in("id", ids)
  if (error) {
    console.warn("user names load failed (non-fatal):", error.message)
    return map
  }
  for (const u of (data || [])) {
    const full = [u.user_first_name, u.user_last_name].filter(Boolean).join(" ").trim() || u.user_email || u.id
    map.set(u.id, full)
  }
  return map
}

async function loadProjectGraph(client: SupabaseClient, projectId: string) {
  const { data: project, error: pErr } = await client.from("projects").select("*").eq("id", projectId).single()
  if (pErr || !project) throw new Error(`project ${projectId} not found: ${pErr?.message || "missing"}`)

  let property: any = null
  if (project.property_id) {
    const r = await client.from("properties").select("*").eq("id", project.property_id).maybeSingle()
    if (!r.error) property = r.data
  }
  let account: any = null
  if (project.project_account_id) {
    const r = await client.from("accounts").select("*").eq("id", project.project_account_id).maybeSingle()
    if (!r.error) account = r.data
  }

  const { data: workOrders, error: woErr } = await client.from("work_orders")
    .select("*").eq("project_id", projectId).eq("work_order_is_deleted", false)
    .order("work_order_record_number", { ascending: true })
  if (woErr) throw new Error(`work_orders load failed: ${woErr.message}`)

  const woIds = (workOrders || []).map((w: WorkOrder) => w.id)

  let workSteps: WorkStep[] = []
  if (woIds.length > 0) {
    const r = await client.from("work_steps").select("*").in("work_order_id", woIds).eq("work_step_is_deleted", false)
      .order("work_step_execution_order", { ascending: true, nullsFirst: false })
    if (r.error) throw new Error(`work_steps load failed: ${r.error.message}`)
    workSteps = (r.data as WorkStep[]) || []
  }

  const stepIds = workSteps.map((s) => s.id)

  // Photos: union of work_step_id FK + polymorphic related_object/related_id
  const photos: Photo[] = []
  const seen = new Set<string>()
  if (stepIds.length > 0) {
    const r = await client.from("photos").select("*").in("work_step_id", stepIds).eq("is_deleted", false)
    if (r.error) throw new Error(`photos by step load failed: ${r.error.message}`)
    for (const p of (r.data || [])) {
      if (!seen.has(p.id)) { photos.push(p as Photo); seen.add(p.id) }
    }
  }
  if (woIds.length > 0) {
    const r = await client.from("photos").select("*")
      .eq("related_object", "work_orders").in("related_id", woIds).eq("is_deleted", false)
    if (r.error) throw new Error(`photos by WO load failed: ${r.error.message}`)
    for (const p of (r.data || [])) {
      if (!seen.has(p.id)) { photos.push(p as Photo); seen.add(p.id) }
    }
    // Also: photos with related_object='work_steps' but no work_step_id FK (legacy / belt-and-suspenders)
    const r2 = await client.from("photos").select("*")
      .eq("related_object", "work_steps").in("related_id", stepIds).eq("is_deleted", false)
    if (r2.error) throw new Error(`photos by step poly load failed: ${r2.error.message}`)
    for (const p of (r2.data || [])) {
      if (!seen.has(p.id)) { photos.push(p as Photo); seen.add(p.id) }
    }
  }

  // Group
  const workStepsByWO = new Map<string, WorkStep[]>()
  for (const s of workSteps) {
    if (!workStepsByWO.has(s.work_order_id)) workStepsByWO.set(s.work_order_id, [])
    workStepsByWO.get(s.work_order_id)!.push(s)
  }
  const photosByStep = new Map<string, Photo[]>()
  const photosByWO = new Map<string, Photo[]>()
  for (const p of photos) {
    if (p.work_step_id) {
      if (!photosByStep.has(p.work_step_id)) photosByStep.set(p.work_step_id, [])
      photosByStep.get(p.work_step_id)!.push(p)
    } else if (p.related_object === "work_orders") {
      if (!photosByWO.has(p.related_id)) photosByWO.set(p.related_id, [])
      photosByWO.get(p.related_id)!.push(p)
    } else if (p.related_object === "work_steps") {
      // photo polymorphically attached to a step but missing work_step_id FK
      if (!photosByStep.has(p.related_id)) photosByStep.set(p.related_id, [])
      photosByStep.get(p.related_id)!.push(p)
    }
  }

  return { project: project as Project, property, account, workOrders: (workOrders as WorkOrder[]) || [], workStepsByWO, photosByStep, photosByWO }
}

// ───────────────────────────────────────────────────────────────────────────
// Synthetic project graph for preview mode.
//
// Returns the same shape as loadProjectGraph but assembled in-memory from
// hard-coded fixture data. Status and record_type fields are resolved to
// real picklist UUIDs from the loaded picklist map so the rendered labels
// look like a real report; if a picklist value can't be found (e.g. the
// expected seed row was renamed), the field falls back to null and the
// renderer shows "—".
//
// The synthetic graph deliberately includes no photos. tryEmbedPhoto would
// fail to resolve fake storage paths and render "[image unavailable]"
// placeholders everywhere, which gives false-negative previews. Authors
// who need to validate photo embedding should run a real Generate Report
// against a real project that has photos.
// ───────────────────────────────────────────────────────────────────────────

function buildSyntheticGraph(picklistById: Map<string, Picklist>, callerUserId: string | null) {
  const previewProjectId      = "00000000-0000-0000-0000-000000000001"
  const previewPropertyId     = "00000000-0000-0000-0000-000000000002"
  const previewAccountId      = "00000000-0000-0000-0000-000000000003"
  const previewWorkOrder1Id   = "00000000-0000-0000-0000-000000000010"
  const previewWorkOrder2Id   = "00000000-0000-0000-0000-000000000011"

  // Resolve picklist UUIDs by their machine value. If a value isn't seeded
  // we fall back to null and the renderer prints "—" — preview still works,
  // just with a couple of empty status cells.
  const projectStatus     = findPicklistIdByValue(picklistById, "projects",    "project_status",    "Project Scheduled")
  const projectRecordType = findPicklistIdByValue(picklistById, "projects",    "record_type",       "Single_Family")
  const woStatus          = findPicklistIdByValue(picklistById, "work_orders", "work_order_status", "Scheduled")
  const woRecordType      = findPicklistIdByValue(picklistById, "work_orders", "record_type",       "General")
  const wsStatusDone      = findPicklistIdByValue(picklistById, "work_steps",  "work_step_status",  "Completed")
  const wsStatusPending   = findPicklistIdByValue(picklistById, "work_steps",  "work_step_status",  "New")

  const project: Project = {
    id: previewProjectId,
    project_record_number: "PROJ-PREVIEW",
    project_name: "Sample Project for Preview",
    project_record_type: projectRecordType,
    project_status: projectStatus,
    project_owner: callerUserId,
    property_id: previewPropertyId,
    project_account_id: previewAccountId,
  }

  const property = {
    id: previewPropertyId,
    property_name: "Sample Multifamily Property",
    property_address_line_1: "3218 Progress Rd",
    property_address_line_2: null,
    property_city: "Madison",
    property_state: "WI",
    property_postal_code: "53716",
  }

  const account = {
    id: previewAccountId,
    account_name: "Sample Property Owner LLC",
  }

  const workOrders: WorkOrder[] = [
    {
      id: previewWorkOrder1Id,
      work_order_record_number: "WO-PREVIEW-1",
      work_order_name: "Heat Pump Install — Building A, Unit 101",
      work_order_status: woStatus,
      work_order_record_type: woRecordType,
      work_type_id: null,
      project_id: previewProjectId,
    },
    {
      id: previewWorkOrder2Id,
      work_order_record_number: "WO-PREVIEW-2",
      work_order_name: "Insulation & Air Sealing — Building A, Unit 101",
      work_order_status: woStatus,
      work_order_record_type: woRecordType,
      work_type_id: null,
      project_id: previewProjectId,
    },
  ]

  const mkStep = (
    woId: string, idx: number, name: string, description: string, statusId: string | null,
  ): WorkStep => ({
    id: `${woId.slice(0, 28)}${String(100 + idx).padStart(8, "0")}`,
    work_step_record_number: `WS-PREVIEW-${woId.endsWith("10") ? "1" : "2"}-${idx}`,
    work_step_name: name,
    work_step_description: description,
    work_step_status: statusId,
    work_step_execution_order: idx,
    work_step_plan_execution_order: idx,
    work_step_start_time: null,
    work_step_end_time: null,
    work_step_owner: callerUserId,
    work_order_id: woId,
  })

  const workStepsByWO = new Map<string, WorkStep[]>()
  workStepsByWO.set(previewWorkOrder1Id, [
    mkStep(previewWorkOrder1Id, 1, "Pre-install site verification",
      "Confirm panel capacity, refrigerant line route, and condensate drain path before staging equipment.",
      wsStatusDone),
    mkStep(previewWorkOrder1Id, 2, "Outdoor unit set & line set run",
      "Set outdoor unit on pad, route line set through wall penetration, seal and insulate.",
      wsStatusDone),
    mkStep(previewWorkOrder1Id, 3, "Indoor head install & commissioning",
      "Mount indoor head, connect line set + control wire, evacuate, charge, and run startup test.",
      wsStatusPending),
  ])
  workStepsByWO.set(previewWorkOrder2Id, [
    mkStep(previewWorkOrder2Id, 1, "Pre-work blower door test",
      "Baseline ACH50 reading recorded. Confirm test conditions and tape readings to job folder.",
      wsStatusDone),
    mkStep(previewWorkOrder2Id, 2, "Air sealing — attic & rim joist",
      "Seal top plates, plumbing/wire penetrations, and rim joist with two-part foam.",
      wsStatusDone),
    mkStep(previewWorkOrder2Id, 3, "Dense-pack cellulose to attic",
      "Blow attic insulation to R-60. Verify depth markers at 4 corners + center.",
      wsStatusPending),
  ])

  // No photos in preview — see comment block above.
  const photosByStep = new Map<string, Photo[]>()
  const photosByWO   = new Map<string, Photo[]>()

  return { project, property, account, workOrders, workStepsByWO, photosByStep, photosByWO }
}

async function resolveTemplate(client: SupabaseClient, project: Project, explicitPrtId?: string): Promise<{ prt: PRT, sections: PRTS[] }> {
  let prt: PRT | null = null
  if (explicitPrtId) {
    const r = await client.from("project_report_templates").select("*")
      .eq("id", explicitPrtId).eq("prt_is_deleted", false).maybeSingle()
    if (r.error) throw new Error(`PRT lookup failed: ${r.error.message}`)
    prt = r.data as PRT | null
  }
  // Try assignment by record type
  if (!prt && project.project_record_type) {
    const r = await client.from("project_report_template_record_type_assignments")
      .select("prt_id").eq("project_record_type", project.project_record_type)
      .eq("prtrta_is_default", true).eq("prtrta_is_deleted", false).maybeSingle()
    if (!r.error && r.data?.prt_id) {
      const rp = await client.from("project_report_templates").select("*")
        .eq("id", r.data.prt_id).eq("prt_is_deleted", false).maybeSingle()
      if (!rp.error) prt = rp.data as PRT | null
    }
  }
  // Fallback: unmapped default
  if (!prt) {
    const r = await client.from("project_report_templates").select("*")
      .eq("prt_is_default_for_unmapped", true).eq("prt_is_deleted", false).maybeSingle()
    if (r.error) throw new Error(`unmapped default PRT lookup failed: ${r.error.message}`)
    prt = r.data as PRT | null
  }
  if (!prt) throw new Error("No project report template available — admin must seed at least one PRT with prt_is_default_for_unmapped=true.")

  const sr = await client.from("project_report_template_sections").select("*")
    .eq("prt_id", prt.id).eq("prts_is_deleted", false)
    .order("prts_section_order", { ascending: true })
  if (sr.error) throw new Error(`PRT sections load failed: ${sr.error.message}`)

  const picklistMap = await loadAllPicklists(client)
  const sections: PRTS[] = (sr.data || []).map((s: any) => ({
    ...s,
    section_type_value: picklistMap.get(s.prts_section_type)?.picklist_value || "unknown",
  }))
  return { prt, sections }
}

// Preview-mode template loader. Loads strictly by prt_id without any
// assignment-cascade or unmapped-default fallback — preview is always
// previewing one specific template, period. Throws a clear error if the
// template is missing or soft-deleted.
async function resolveTemplateById(client: SupabaseClient, prtId: string): Promise<{ prt: PRT, sections: PRTS[] }> {
  const r = await client.from("project_report_templates").select("*")
    .eq("id", prtId).eq("prt_is_deleted", false).maybeSingle()
  if (r.error) throw new Error(`PRT lookup failed: ${r.error.message}`)
  const prt = r.data as PRT | null
  if (!prt) throw new Error(`Template ${prtId} not found (or has been deleted).`)

  const sr = await client.from("project_report_template_sections").select("*")
    .eq("prt_id", prt.id).eq("prts_is_deleted", false)
    .order("prts_section_order", { ascending: true })
  if (sr.error) throw new Error(`PRT sections load failed: ${sr.error.message}`)

  const picklistMap = await loadAllPicklists(client)
  const sections: PRTS[] = (sr.data || []).map((s: any) => ({
    ...s,
    section_type_value: picklistMap.get(s.prts_section_type)?.picklist_value || "unknown",
  }))
  return { prt, sections }
}

// ───────────────────────────────────────────────────────────────────────────
// Section dispatch
// ───────────────────────────────────────────────────────────────────────────

async function renderSection(ctx: RenderCtx, section: PRTS) {
  switch (section.section_type_value) {
    case "cover_page":             return renderCoverPage(ctx, section)
    case "project_summary":        return renderProjectSummary(ctx, section)
    case "work_orders_overview":   return renderWorkOrdersOverview(ctx, section)
    case "work_order_section":     return renderWorkOrderSection(ctx, section)
    case "footer":                 /* deferred — runs after all pages exist */ return
    case "page_break":             ctx.cur.pageBreak(); return
    case "custom_text": {
      const body = section.prts_body_template || ""
      drawText(ctx.cur, body || "", { size: 11 })
      return
    }
    default: {
      const label = section.section_type_value
      drawText(ctx.cur, `[Section: ${label} — not yet supported in renderer]`, {
        size: 9, color: C.textMuted,
      })
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP entry point
// ───────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const body = await req.json()
    const previewMode: boolean = body?.preview === true
    const projectId: string | undefined = body?.project_id
    const explicitPrtId: string | undefined = body?.prt_id
    const watermarkChoice: "watermarked" | "original" =
      body?.use_watermarked === false ? "original" : "watermarked"

    // Per-mode argument validation. Preview mode requires prt_id (we're
    // previewing a specific template, server-side template resolution from
    // a project doesn't apply). Generate mode requires project_id.
    if (previewMode) {
      if (!explicitPrtId) {
        return jsonResponse({ error: "prt_id is required when preview=true" }, 400)
      }
    } else {
      if (!projectId) return jsonResponse({ error: "project_id is required" }, 400)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!
    const authHeader = req.headers.get("Authorization") || ""

    // User-scoped client — relies on RLS authenticated_read on every table
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    // Identify caller (for documents.uploaded_by + report metadata)
    const { data: userData } = await client.auth.getUser()
    const userId = userData?.user?.id ?? null
    const userEmail = userData?.user?.email ?? null
    let generatedByName = userEmail || "Unknown"
    if (userId) {
      const r = await client.from("users").select("user_first_name,user_last_name,user_email").eq("id", userId).maybeSingle()
      if (!r.error && r.data) {
        const full = [r.data.user_first_name, r.data.user_last_name].filter(Boolean).join(" ").trim()
        if (full) generatedByName = full
        else if (r.data.user_email) generatedByName = r.data.user_email
      }
    }

    const picklistById = await loadAllPicklists(client)

    // ── Project graph: real or synthetic ────────────────────────────────
    let project: Project, property: any, account: any
    let workOrders: WorkOrder[]
    let workStepsByWO: Map<string, WorkStep[]>
    let photosByStep: Map<string, Photo[]>
    let photosByWO: Map<string, Photo[]>

    if (previewMode) {
      const synthetic = buildSyntheticGraph(picklistById, userId)
      project       = synthetic.project
      property      = synthetic.property
      account       = synthetic.account
      workOrders    = synthetic.workOrders
      workStepsByWO = synthetic.workStepsByWO
      photosByStep  = synthetic.photosByStep
      photosByWO    = synthetic.photosByWO
    } else {
      const real = await loadProjectGraph(client, projectId!)
      project       = real.project
      property      = real.property
      account       = real.account
      workOrders    = real.workOrders
      workStepsByWO = real.workStepsByWO
      photosByStep  = real.photosByStep
      photosByWO    = real.photosByWO
    }

    // ── Template resolution ─────────────────────────────────────────────
    // Preview mode always uses the explicit prt_id (validated above) and
    // skips the record-type assignment / unmapped-default cascade — the
    // user is looking at a specific PRT and wants to see THAT PRT render.
    const { prt, sections } = previewMode
      ? await resolveTemplateById(client, explicitPrtId!)
      : await resolveTemplate(client, project, explicitPrtId)

    // Status gate — only Active templates can be used for real generation.
    // Drafts are unpublished and may have unresolved issues; Archived
    // templates are retired. Preview mode bypasses this gate so authors can
    // see what a Draft renders to before publishing.
    if (!previewMode) {
      const prtStatusValue = prt.prt_status ? picklistById.get(prt.prt_status)?.picklist_value : null
      if (prtStatusValue !== "Active") {
        const label = prt.prt_record_number || prt.prt_name || "template"
        const statusLabel = prtStatusValue || "unknown"
        return jsonResponse({
          error: `${label} is in ${statusLabel} status. Only Active (published) templates can generate reports — publish the template first, or pick a different one.`,
        }, 400)
      }
    }

    // User-name map: project_owner + step_owner + photo.taken_by
    const userIds: string[] = []
    if (project.project_owner) userIds.push(project.project_owner)
    for (const arr of workStepsByWO.values()) for (const s of arr) if (s.work_step_owner) userIds.push(s.work_step_owner)
    for (const arr of photosByStep.values()) for (const p of arr) if (p.taken_by) userIds.push(p.taken_by)
    for (const arr of photosByWO.values())   for (const p of arr) if (p.taken_by) userIds.push(p.taken_by)
    const userNamesById = await loadUserNames(client, userIds)

    // Belt-and-suspenders for preview mode: the synthetic graph stamps the
    // caller's auth uid on project_owner / work_step_owner. If the DB
    // lookup in loadUserNames couldn't resolve that uid (e.g. when
    // auth.users.id and public.users.id are out of sync, which they
    // currently are for some accounts), fall back to the generatedByName
    // we already computed up top so Owner doesn't render as "—".
    if (previewMode && userId && !userNamesById.has(userId)) {
      userNamesById.set(userId, generatedByName)
    }

    // Build PDF
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const cur = new Cursor(pdf, font, fontBold)

    const ctx: RenderCtx = {
      cur, client, project, workOrders, workStepsByWO, photosByStep, photosByWO,
      picklistById, userNamesById, property, account,
      generatedAt: new Date(),
      generatedByName,
      watermarkChoice,
      prt,
    }

    // Pass 1 — render everything except footer. Compute the index of the
    // last renderable (non-footer) section up-front so we can suppress a
    // trailing prts_page_break_after — otherwise that page break creates
    // an empty page at the end of the report (the footer pass stamps all
    // pages, including the blank one, with the page-X-of-Y line).
    const renderableSections = sections.filter((s) => s.section_type_value !== "footer")
    for (let i = 0; i < renderableSections.length; i++) {
      const sec = renderableSections[i]
      await renderSection(ctx, sec)
      const isLast = i === renderableSections.length - 1
      if (sec.prts_page_break_after && !isLast) cur.pageBreak()
    }
    // Pass 2 — footer (knows total page count)
    const footer = sections.find((s) => s.section_type_value === "footer")
    if (footer) await renderFooter(ctx, footer)

    const titlePrefix = previewMode ? "PREVIEW — " : ""
    pdf.setTitle(`${titlePrefix}${project.project_record_number || ""} ${project.project_name || "Project Report"}`.trim())
    pdf.setProducer("Anura")
    pdf.setCreator(`Anura • ${prt.prt_name} (${prt.prt_record_number} v${prt.prt_version})${previewMode ? " • PREVIEW" : ""}`)
    pdf.setCreationDate(ctx.generatedAt)

    const pdfBytes = await pdf.save()

    // ── Preview short-circuit: return binary PDF, no upload, no DB write ─
    if (previewMode) {
      const datePart = ctx.generatedAt.toISOString().slice(0, 10)
      const previewFileName = `${prt.prt_record_number || "template"}_preview_${datePart}.pdf`
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${previewFileName}"`,
          "X-Anura-Mode": "preview",
          "X-Anura-Prt-Id": prt.id,
          "X-Anura-Prt-Version": String(prt.prt_version),
          "X-Anura-Page-Count": String(cur.pages.length),
        },
      })
    }

    // ── Generate mode: upload + insert documents row ────────────────────
    const docId = crypto.randomUUID()
    const fileNameBase = (project.project_record_number || project.id).replace(/[^A-Za-z0-9_\-]/g, "_")
    const datePart = ctx.generatedAt.toISOString().slice(0, 10)
    const fileName = `${fileNameBase}_Project_Report_${datePart}_${watermarkChoice}.pdf`
    const path = `projects/${projectId}/reports/${docId}__${fileName}`

    const upload = await client.storage.from("property-documents").upload(path, pdfBytes, {
      contentType: "application/pdf", upsert: false,
    })
    if (upload.error) throw new Error(`PDF upload failed: ${upload.error.message}`)

    const insertRow = {
      id: docId,
      storage_bucket: "property-documents",
      storage_path: path,
      name: `${project.project_name || "Project"} — Project Report (${datePart})`,
      document_type: "project_report",
      category: prt.prt_record_number,
      file_size_bytes: pdfBytes.byteLength,
      mime_type: "application/pdf",
      related_object: "projects",
      related_id: projectId,
      uploaded_by: userId,
    }
    const ins = await client.from("documents").insert(insertRow).select().single()
    if (ins.error) {
      try { await client.storage.from("property-documents").remove([path]) } catch { /* noop */ }
      throw new Error(`documents insert failed: ${ins.error.message}`)
    }

    return jsonResponse({
      ok: true,
      document_id: docId,
      storage_bucket: "property-documents",
      storage_path: path,
      file_size_bytes: pdfBytes.byteLength,
      page_count: cur.pages.length,
      template: { prt_id: prt.id, prt_record_number: prt.prt_record_number, prt_name: prt.prt_name, prt_version: prt.prt_version },
      watermark_variant: watermarkChoice,
    }, 200)
  } catch (e) {
    console.error("generate-project-report failed", e)
    return jsonResponse({ error: (e as Error).message || "unknown" }, 500)
  }
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
