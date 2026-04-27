// =============================================================================
// _shared/htmlToPdf.ts
//
// Lightweight HTML → PDF layout engine built on pdf-lib. Handles the subset
// of HTML that legal/program templates actually use:
//
//   Block:    <p>, <div>, <h1>-<h6>, <ul>/<ol>/<li>, <br>, <hr>,
//             <table>/<tr>/<td>/<th>, <pre>
//   Inline:   <strong>/<b>, <em>/<i>, <u>, <span>
//   Other:    plain text, &nbsp;, &amp;, &lt;, &gt;, &quot;, &#NN;
//
// Anchor strings (\sig1\, \initial2\, \date3\, \text4\) are detected during
// layout. When found, they're NOT drawn into the PDF — instead, their
// bounding box is emitted as part of the result. The signing-portal
// overlay step uses those boxes to position recipient signatures.
//
// What this is NOT: a full HTML/CSS engine. CSS classes are ignored,
// inline `style` attributes are ignored except `text-align`, floats and
// positioning don't exist. For most legal templates this is fine; for
// complex layouts the author should fall back to authoring in Word and
// uploading docx (which goes through mammoth → simplified HTML before
// hitting this engine).
// =============================================================================

import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1"

export interface AnchorMatch {
  anchor_string: string         // e.g. "\\sig1\\"
  tab_type: "signature" | "initial" | "date" | "text"
  ordinal: number               // 1, 2, 3, ... — maps to recipient.recipient_order
  page: number                  // 1-indexed
  x: number                     // PDF coordinates (origin bottom-left)
  y: number
  width: number
  height: number
}

export interface RenderResult {
  pdfBytes: Uint8Array
  anchors: AnchorMatch[]
  pageCount: number
}

// Page geometry — Letter portrait
const PAGE_W       = 612
const PAGE_H       = 792
const MARGIN_X     = 54
const MARGIN_TOP   = 72
const MARGIN_BOT   = 72
const CONTENT_W    = PAGE_W - MARGIN_X * 2

// Default tab box dimensions (PDF points)
const TAB_DEFAULTS: Record<string, { width: number, height: number }> = {
  signature: { width: 180, height: 36 },
  initial:   { width: 60,  height: 30 },
  date:      { width: 90,  height: 18 },
  text:      { width: 140, height: 18 },
}

// Anchor regex — captures the type and ordinal so the consumer can route
// each tab to the right recipient
const ANCHOR_RE = /\\(sig|initial|date|text)(\d+)\\/g

// HTML-entity map for the entities our parser actually decodes
const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": "\u00a0",
  "&amp;":  "&",
  "&lt;":   "<",
  "&gt;":   ">",
  "&quot;": '"',
  "&apos;": "'",
  "&mdash;": "\u2014",
  "&ndash;": "\u2013",
  "&hellip;": "\u2026",
  "&copy;":  "\u00a9",
  "&reg;":   "\u00ae",
}

function decodeEntities(s: string): string {
  return s.replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => {
    if (m in ENTITY_MAP) return ENTITY_MAP[m]
    if (m.startsWith("&#")) {
      const cp = parseInt(m.slice(2, -1), 10)
      if (!Number.isNaN(cp)) return String.fromCodePoint(cp)
    }
    return m
  })
}

// ─── HTML parser (block-level) ──────────────────────────────────────────
// Tokenizes HTML into a flat list of block nodes. Inline formatting is
// preserved as runs within each block. Tables get a 2D grid of cells.

type Run = { text: string, bold: boolean, italic: boolean, underline: boolean }
type Block =
  | { kind: "paragraph", runs: Run[], align: "left" | "center" | "right", indent: number }
  | { kind: "heading", runs: Run[], level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: "list_item", runs: Run[], ordered: boolean, index: number, indent: number }
  | { kind: "hr" }
  | { kind: "page_break" }
  | { kind: "table", rows: Run[][][] }   // rows[r][c] = runs in cell

function parseHtml(html: string): Block[] {
  // Strip <head>, <script>, <style>, comments
  let h = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")

  // mammoth wraps everything in <body>...</body> sometimes; unwrap
  const bodyMatch = h.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) h = bodyMatch[1]

  const blocks: Block[] = []
  let listStack: { ordered: boolean, index: number }[] = []
  let cursor = 0

  // Tokenize into top-level chunks: paragraphs, headings, lists, tables, etc.
  // Walk the string and dispatch on the next opening tag.
  while (cursor < h.length) {
    const remaining = h.slice(cursor)

    // Skip leading whitespace between blocks
    const ws = remaining.match(/^\s+/)
    if (ws) { cursor += ws[0].length; continue }

    if (remaining.startsWith("<")) {
      // Page break: <div style="page-break-after:always"> or explicit class
      const pbMatch = remaining.match(/^<(?:div|p)[^>]*page-break[^>]*>(?:[\s\S]*?<\/(?:div|p)>)?/i)
      if (pbMatch) { blocks.push({ kind: "page_break" }); cursor += pbMatch[0].length; continue }

      // <hr>
      const hrMatch = remaining.match(/^<hr\s*\/?>/i)
      if (hrMatch) { blocks.push({ kind: "hr" }); cursor += hrMatch[0].length; continue }

      // Headings
      const hMatch = remaining.match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i)
      if (hMatch) {
        blocks.push({
          kind: "heading",
          level: parseInt(hMatch[1], 10) as 1 | 2 | 3 | 4 | 5 | 6,
          runs: parseInline(hMatch[2]),
        })
        cursor += hMatch[0].length
        continue
      }

      // Lists
      const ulMatch = remaining.match(/^<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/i)
      if (ulMatch) {
        const ordered = ulMatch[1].toLowerCase() === "ol"
        const items = ulMatch[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)
        let idx = 1
        for (const item of items) {
          blocks.push({
            kind: "list_item",
            runs: parseInline(item[1]),
            ordered,
            index: idx++,
            indent: listStack.length,
          })
        }
        cursor += ulMatch[0].length
        continue
      }

      // Table — flatten cells; render as a grid
      const tableMatch = remaining.match(/^<table[^>]*>([\s\S]*?)<\/table>/i)
      if (tableMatch) {
        const rows: Run[][][] = []
        for (const tr of tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const cells: Run[][] = []
          for (const cell of tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
            cells.push(parseInline(cell[1]))
          }
          if (cells.length > 0) rows.push(cells)
        }
        if (rows.length > 0) blocks.push({ kind: "table", rows })
        cursor += tableMatch[0].length
        continue
      }

      // Paragraph
      const pMatch = remaining.match(/^<(p|div)[^>]*>([\s\S]*?)<\/\1>/i)
      if (pMatch) {
        const tag = pMatch[0]
        const styleMatch = tag.match(/style="([^"]*)"/i)
        let align: "left" | "center" | "right" = "left"
        if (styleMatch) {
          const style = styleMatch[1].toLowerCase()
          if (style.includes("text-align:center") || style.includes("text-align: center")) align = "center"
          else if (style.includes("text-align:right") || style.includes("text-align: right")) align = "right"
        }
        blocks.push({
          kind: "paragraph",
          runs: parseInline(pMatch[2]),
          align,
          indent: 0,
        })
        cursor += pMatch[0].length
        continue
      }

      // Generic block we don't recognize — skip the opening tag and continue
      const skip = remaining.match(/^<[^>]+>/)
      if (skip) { cursor += skip[0].length; continue }
      cursor++  // safety
    } else {
      // Loose text outside any block — wrap as a paragraph
      const next = remaining.search(/<[a-z!\/]/i)
      const chunk = next < 0 ? remaining : remaining.slice(0, next)
      const trimmed = chunk.replace(/\s+/g, " ").trim()
      if (trimmed.length > 0) {
        blocks.push({ kind: "paragraph", runs: parseInline(trimmed), align: "left", indent: 0 })
      }
      cursor += next < 0 ? remaining.length : next
    }
  }
  return blocks
}

// Parse inline formatting within a block. Returns flat runs with bold/italic/
// underline state. Unknown tags are stripped.
function parseInline(html: string): Run[] {
  const runs: Run[] = []
  const stack: Array<"bold" | "italic" | "underline"> = []
  let i = 0
  let buf = ""

  const flush = () => {
    if (!buf) return
    runs.push({
      text: decodeEntities(buf),
      bold:      stack.includes("bold"),
      italic:    stack.includes("italic"),
      underline: stack.includes("underline"),
    })
    buf = ""
  }

  while (i < html.length) {
    const ch = html[i]
    if (ch === "<") {
      const close = html.indexOf(">", i)
      if (close < 0) { buf += ch; i++; continue }
      const tag = html.slice(i + 1, close).trim().toLowerCase()
      i = close + 1
      const isClose = tag.startsWith("/")
      const tagName = (isClose ? tag.slice(1) : tag).split(/\s/)[0]
      let style: "bold" | "italic" | "underline" | null = null
      if (tagName === "strong" || tagName === "b") style = "bold"
      else if (tagName === "em" || tagName === "i") style = "italic"
      else if (tagName === "u")                     style = "underline"
      else if (tagName === "br") { flush(); buf = "\n"; flush(); continue }
      if (style) {
        flush()
        if (isClose) {
          const idx = stack.lastIndexOf(style)
          if (idx >= 0) stack.splice(idx, 1)
        } else {
          stack.push(style)
        }
      }
      // unknown tags: drop silently
    } else {
      buf += ch
      i++
    }
  }
  flush()
  return runs
}

// ─── Layout engine ──────────────────────────────────────────────────────

interface Cursor {
  page: PDFPage
  pageIndex: number    // 1-based
  y: number            // current y-position from top-of-content
}

interface LayoutCtx {
  doc: PDFDocument
  pages: PDFPage[]
  cursor: Cursor
  fontRegular: PDFFont
  fontBold:    PDFFont
  fontItalic:  PDFFont
  fontBoldItalic: PDFFont
  anchors: AnchorMatch[]
}

const ink   = rgb(0.05, 0.10, 0.18)
const muted = rgb(0.55, 0.62, 0.72)
const lineC = rgb(0.85, 0.89, 0.94)

function newPage(ctx: LayoutCtx): void {
  const p = ctx.doc.addPage([PAGE_W, PAGE_H])
  ctx.pages.push(p)
  ctx.cursor.page = p
  ctx.cursor.pageIndex = ctx.pages.length
  ctx.cursor.y = PAGE_H - MARGIN_TOP
}

function ensureRoom(ctx: LayoutCtx, needed: number): void {
  if (ctx.cursor.y - needed < MARGIN_BOT) newPage(ctx)
}

function pickFont(ctx: LayoutCtx, run: { bold: boolean, italic: boolean }): PDFFont {
  if (run.bold && run.italic) return ctx.fontBoldItalic
  if (run.bold)               return ctx.fontBold
  if (run.italic)             return ctx.fontItalic
  return ctx.fontRegular
}

// Wrap a list of runs into lines that fit `maxWidth`. Each line is a list
// of (run, text, width) segments. Anchor strings within a run are split
// out as their own segments so the renderer can choose to skip drawing
// them and emit anchor positions instead.
interface Segment { run: Run, text: string, width: number, isAnchor: boolean, anchorMeta?: { type: string, ordinal: number } }

function measure(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size)
}

function splitRunByAnchors(run: Run): Array<{ text: string, isAnchor: boolean, anchorMeta?: { type: string, ordinal: number } }> {
  const out: Array<{ text: string, isAnchor: boolean, anchorMeta?: { type: string, ordinal: number } }> = []
  ANCHOR_RE.lastIndex = 0
  let last = 0
  let m: RegExpExecArray | null
  while ((m = ANCHOR_RE.exec(run.text)) !== null) {
    if (m.index > last) out.push({ text: run.text.slice(last, m.index), isAnchor: false })
    out.push({
      text: m[0], isAnchor: true,
      anchorMeta: { type: m[1], ordinal: parseInt(m[2], 10) },
    })
    last = m.index + m[0].length
  }
  if (last < run.text.length) out.push({ text: run.text.slice(last), isAnchor: false })
  return out
}

function wrapRuns(ctx: LayoutCtx, runs: Run[], fontSize: number, maxWidth: number): Segment[][] {
  const lines: Segment[][] = []
  let line: Segment[] = []
  let lineWidth = 0

  const pushLine = () => {
    lines.push(line)
    line = []
    lineWidth = 0
  }

  for (const run of runs) {
    const parts = splitRunByAnchors(run)
    for (const part of parts) {
      if (part.isAnchor) {
        const f = pickFont(ctx, run)
        const w = measure(f, part.text, fontSize)
        // Anchors break to a new line if they don't fit
        if (lineWidth + w > maxWidth && line.length > 0) pushLine()
        line.push({ run, text: part.text, width: w, isAnchor: true, anchorMeta: part.anchorMeta })
        lineWidth += w
        continue
      }
      // Word-wrap this part
      const tokens = part.text.split(/(\s+|\n)/)
      for (const token of tokens) {
        if (token === "") continue
        if (token === "\n") { pushLine(); continue }
        const f = pickFont(ctx, run)
        const w = measure(f, token, fontSize)
        if (lineWidth + w > maxWidth && line.length > 0) {
          // trim trailing whitespace on current line
          while (line.length && /^\s+$/.test(line[line.length - 1].text)) {
            lineWidth -= line[line.length - 1].width
            line.pop()
          }
          pushLine()
        }
        if (line.length === 0 && /^\s+$/.test(token)) continue  // skip leading ws
        line.push({ run, text: token, width: w, isAnchor: false })
        lineWidth += w
      }
    }
  }
  if (line.length) pushLine()
  return lines
}

function drawLines(
  ctx: LayoutCtx,
  lines: Segment[][],
  fontSize: number,
  align: "left" | "center" | "right",
  startX: number,
  maxWidth: number,
): void {
  const lineHeight = fontSize * 1.45
  for (const line of lines) {
    ensureRoom(ctx, lineHeight)
    const usedWidth = line.reduce((s, seg) => s + seg.width, 0)
    let x = startX
    if (align === "center") x = startX + (maxWidth - usedWidth) / 2
    if (align === "right")  x = startX + (maxWidth - usedWidth)

    const baselineY = ctx.cursor.y - fontSize * 0.85
    for (const seg of line) {
      if (seg.isAnchor) {
        // Don't draw the anchor text. Emit its bounding box at the
        // current pen position. The width comes from TAB_DEFAULTS for
        // the anchor's type; the height matches as well. Anchor x/y
        // pin to the bottom-left of the tab box in PDF coordinates.
        const tabType = (seg.anchorMeta?.type === "sig" ? "signature" : seg.anchorMeta!.type) as
          "signature" | "initial" | "date" | "text"
        const dims = TAB_DEFAULTS[tabType]
        ctx.anchors.push({
          anchor_string: seg.text,
          tab_type: tabType,
          ordinal: seg.anchorMeta!.ordinal,
          page: ctx.cursor.pageIndex,
          x: x,
          y: baselineY - 2,
          width:  dims.width,
          height: dims.height,
        })
        // Reserve horizontal space proportional to the tab so subsequent
        // text doesn't overlap. We don't reserve vertical space — the
        // tab will be drawn over whatever is here at signing time.
        x += Math.min(dims.width, seg.width)
        continue
      }
      const f = pickFont(ctx, seg.run)
      ctx.cursor.page.drawText(seg.text, {
        x, y: baselineY, size: fontSize, font: f, color: ink,
      })
      if (seg.run.underline) {
        ctx.cursor.page.drawLine({
          start: { x, y: baselineY - 1.5 },
          end:   { x: x + seg.width, y: baselineY - 1.5 },
          thickness: 0.5, color: ink,
        })
      }
      x += seg.width
    }
    ctx.cursor.y -= lineHeight
  }
}

function drawHeading(ctx: LayoutCtx, runs: Run[], level: number): void {
  const sizeMap: Record<number, number> = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11 }
  const fontSize = sizeMap[level] || 13
  // Heading uses bold weight for all runs
  const boldRuns = runs.map(r => ({ ...r, bold: true }))
  ensureRoom(ctx, fontSize * 1.6)
  ctx.cursor.y -= 6
  drawLines(ctx, wrapRuns(ctx, boldRuns, fontSize, CONTENT_W), fontSize, "left", MARGIN_X, CONTENT_W)
  ctx.cursor.y -= 4
}

function drawListItem(ctx: LayoutCtx, runs: Run[], ordered: boolean, index: number, indent: number): void {
  const fontSize = 11
  const bulletX  = MARGIN_X + indent * 18
  const textX    = bulletX + 18
  const maxW     = CONTENT_W - (textX - MARGIN_X)
  const lines    = wrapRuns(ctx, runs, fontSize, maxW)
  if (lines.length === 0) return
  ensureRoom(ctx, fontSize * 1.6)
  // Bullet on first line baseline
  const bullet = ordered ? `${index}.` : "\u2022"
  ctx.cursor.page.drawText(bullet, {
    x: bulletX, y: ctx.cursor.y - fontSize * 0.85,
    size: fontSize, font: ctx.fontRegular, color: ink,
  })
  drawLines(ctx, lines, fontSize, "left", textX, maxW)
}

function drawHr(ctx: LayoutCtx): void {
  ensureRoom(ctx, 18)
  const y = ctx.cursor.y - 6
  ctx.cursor.page.drawLine({
    start: { x: MARGIN_X, y },
    end:   { x: PAGE_W - MARGIN_X, y },
    thickness: 0.5, color: lineC,
  })
  ctx.cursor.y -= 18
}

function drawTable(ctx: LayoutCtx, rows: Run[][][]): void {
  // Equal column widths, fixed cell padding. Tables that exceed a page
  // get split row-by-row (no header repeat — keep it simple for now).
  if (rows.length === 0) return
  const cols = Math.max(...rows.map(r => r.length))
  if (cols === 0) return
  const colW = CONTENT_W / cols
  const fontSize = 10
  const padding  = 6

  for (const row of rows) {
    // Pre-wrap each cell to compute row height
    const cellLines = row.map(c => wrapRuns(ctx, c, fontSize, colW - padding * 2))
    const rowHeight = Math.max(
      fontSize * 1.45,
      ...cellLines.map(ls => ls.length * fontSize * 1.45),
    ) + padding * 2

    ensureRoom(ctx, rowHeight)
    const top = ctx.cursor.y
    const bottom = top - rowHeight

    // Cell borders
    for (let c = 0; c <= cols; c++) {
      const x = MARGIN_X + c * colW
      ctx.cursor.page.drawLine({
        start: { x, y: top }, end: { x, y: bottom },
        thickness: 0.4, color: lineC,
      })
    }
    ctx.cursor.page.drawLine({
      start: { x: MARGIN_X, y: top }, end: { x: PAGE_W - MARGIN_X, y: top },
      thickness: 0.4, color: lineC,
    })
    ctx.cursor.page.drawLine({
      start: { x: MARGIN_X, y: bottom }, end: { x: PAGE_W - MARGIN_X, y: bottom },
      thickness: 0.4, color: lineC,
    })

    for (let c = 0; c < row.length; c++) {
      const lines = cellLines[c]
      const cellX = MARGIN_X + c * colW + padding
      const savedY = ctx.cursor.y
      ctx.cursor.y = top - padding
      drawLines(ctx, lines, fontSize, "left", cellX, colW - padding * 2)
      ctx.cursor.y = savedY
    }
    ctx.cursor.y = bottom
  }
  ctx.cursor.y -= 6
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function renderHtmlToPdf(html: string): Promise<RenderResult> {
  const doc = await PDFDocument.create()
  const fontRegular    = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold       = await doc.embedFont(StandardFonts.HelveticaBold)
  const fontItalic     = await doc.embedFont(StandardFonts.HelveticaOblique)
  const fontBoldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique)

  const ctx: LayoutCtx = {
    doc, pages: [],
    cursor: null as any,
    fontRegular, fontBold, fontItalic, fontBoldItalic,
    anchors: [],
  }
  ctx.cursor = { page: null as any, pageIndex: 0, y: 0 }
  newPage(ctx)

  const blocks = parseHtml(html)
  for (const b of blocks) {
    switch (b.kind) {
      case "paragraph": {
        const fontSize = 11
        drawLines(ctx, wrapRuns(ctx, b.runs, fontSize, CONTENT_W), fontSize, b.align, MARGIN_X, CONTENT_W)
        ctx.cursor.y -= 4
        break
      }
      case "heading":   drawHeading(ctx, b.runs, b.level); break
      case "list_item": drawListItem(ctx, b.runs, b.ordered, b.index, b.indent); break
      case "hr":        drawHr(ctx); break
      case "page_break": newPage(ctx); break
      case "table":     drawTable(ctx, b.rows); break
    }
  }

  const pdfBytes = await doc.save()
  return { pdfBytes, anchors: ctx.anchors, pageCount: ctx.pages.length }
}
