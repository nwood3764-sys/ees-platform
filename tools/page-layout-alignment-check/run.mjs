#!/usr/bin/env node
//
// Do a page-layout section's rows actually line up?
//
// Nicholas, 2026-09-03, on an account: "We shouldn't have staggered rows on
// page layouts. If something's like two or three lines, the other ones just
// need to adjust. I don't understand this. There's only one field on each side,
// but they're staggered. This can't happen. This really does make the whole
// site look crappy."
//
// Two different things make a section read as staggered, and NEITHER is visible
// by reading the code — both are facts about boxes a browser laid out:
//
//   1. an empty slot, left when CSS grid could not place a field in a cell its
//      cursor had already passed, and
//   2. a separator that stops partway across the section, because each field
//      cell carried its own bottom border and the cells were top-aligned, so a
//      value wrapping to three lines put its rule far below its neighbour's.
//
// So this measures the rendered boxes: every row must tile the section's full
// width with no gap, and every cell in a row must share a top AND a bottom
// edge. The PRE-FIX grid is on the same page as a positive control and must
// fail both — a check that passes the old shape is measuring nothing.
//
// Run with:  node tools/page-layout-alignment-check/run.mjs
//
// Not part of `npm run build:safe`: it needs a browser binary, and a deploy
// that depends on one breaks when the build image changes. To run it:
//   npm install --no-save playwright-core

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'page-layout-alignment-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log('\npage-layout-alignment-check  SKIPPED — nothing was verified.\n  npm install --no-save playwright-core\n')
  process.exit(0)
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) return null
  for (const entry of readdirSync(base)) {
    for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(base, entry, rel)
      if (entry.startsWith('chromium') && !entry.includes('headless_shell') && existsSync(p)) return p
    }
  }
  return null
}
const executablePath = findChromium()
if (!executablePath) {
  console.log('\npage-layout-alignment-check  SKIPPED — no Chromium under PLAYWRIGHT_BROWSERS_PATH.\n')
  process.exit(0)
}

// Every module reaching for the live client gets the stub instead. Aliasing on
// the resolved path does not work — Vite matches the import SPECIFIER, and the
// modules write '../lib/supabase'.
function supabaseStubPlugin() {
  const stub = join(here, 'supabaseStub.js')
  return {
    name: 'page-layout-alignment-supabase-stub',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || !/(^|\/)supabase(\.js)?$/.test(source)) return null
      const r = await this.resolve(source, importer, { skipSelf: true })
      if (r && r.id.endsWith(join('src', 'lib', 'supabase.js'))) return stub
      return null
    },
  }
}

const server = await createServer({
  root, configFile: false,
  plugins: [react(), supabaseStubPlugin()],
  server: { port: 5327, strictPort: true }, logLevel: 'error',
})
await server.listen()

let failures = 0, checks = 0
const note = (ok, label, detail) => {
  checks += 1
  if (ok) console.log(`PASS  ${label}`)
  else { failures += 1; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}

const browser = await chromium.launch({ executablePath })

// The three boxes a section is rendered in. The declared column count is a
// ceiling: 3 columns in the main flow, 2 in the 480px right rail, 1 on a phone.
const SURFACES = [
  { name: 'desktop',    viewport: 1440, width: 1180, expect: { 'account-information': 3, 'service-provider': 2, uneven: 2 } },
  { name: 'right-rail', viewport: 1440, width: 480,  expect: { 'account-information': 2, 'service-provider': 2, uneven: 2 } },
  { name: 'phone',      viewport: 390,  width: 350,  expect: { 'account-information': 1, 'service-provider': 1, uneven: 1 } },
]

// Read the rendered geometry of one field group: its rows, and for each row the
// cells that tile it. A "cell" is a direct child of a row.
const READ_GROUPS = () => {
  const round = n => Math.round(n * 10) / 10
  const out = {}
  for (const group of document.querySelectorAll('[data-test]')) {
    const id = group.getAttribute('data-test')
    if (id === 'main-column') continue
    const legacy = group.querySelector('[data-legacy-grid]')
    const box = group.getBoundingClientRect()
    if (id.startsWith('editor-')) {
      // The editor draws rows of tiles; read the order and the row breaks off
      // the tiles' own text so the runner can compare it to the record page.
      // Rows and cells are marked, so this reads the editor's OWN structure
      // rather than guessing at nesting — the grid gained absolutely
      // positioned insertion lines on 2026-09-05 and a positional reader
      // silently started reporting every cell as blank.
      out[id] = {
        editor: true,
        rows: [...group.querySelectorAll('[data-field-row]')].map(r =>
          [...r.children].map(cell => {
            const tile = cell.querySelector('[data-cell-kind]')
            if (!tile || tile.getAttribute('data-cell-kind') === 'blank') return '—'
            return tile.getAttribute('data-cell-label') || ''
          })),
      }
      continue
    }
    if (legacy) {
      // The control: read the grid's own placement. An empty slot is a cell of
      // the 2-column grid that no item occupies.
      const cells = [...legacy.querySelectorAll('[data-legacy-cell]')].map(el => {
        const r = el.getBoundingClientRect()
        const inner = el.firstElementChild.getBoundingClientRect()
        return { left: round(r.left), right: round(r.right), top: round(r.top), ruleY: round(inner.bottom) }
      })
      const rowTops = [...new Set(cells.map(c => c.top))].sort((a, b) => a - b)
      out[id] = {
        legacy: true,
        left: round(box.left), right: round(box.right),
        rows: rowTops.map(t => cells.filter(c => c.top === t)),
      }
      continue
    }
    // The real widget: rows are the elements carrying the separator.
    const rowEls = [...group.children].filter(el => el.tagName === 'DIV' && el.children.length)
      .flatMap(el => [...el.children])
      .filter(el => getComputedStyle(el).borderBottomWidth !== '0px')
    out[id] = {
      legacy: false,
      left: round(box.left), right: round(box.right),
      rows: rowEls.map(row => {
        const rb = row.getBoundingClientRect()
        return {
          left: round(rb.left), right: round(rb.right),
          ruleY: round(rb.bottom),
          cells: [...row.children].map(cell => {
            const cb = cell.getBoundingClientRect()
            const field = cell.firstElementChild
            const label = field ? (field.querySelector('span')?.textContent || '').trim() : ''
            return {
              left: round(cb.left), right: round(cb.right),
              top: round(cb.top), bottom: round(cb.bottom),
              blank: cell.getAttribute('aria-hidden') === 'true' || !field,
              label,
              // How far down the cell's own painted content reaches. Under the
              // old shape this was the separator; now it must not decide one.
              contentBottom: field ? round(field.getBoundingClientRect().bottom) : round(cb.bottom),
            }
          }),
        }
      }),
    }
  }
  return out
}

try {
  for (const surface of SURFACES) {
    const page = await browser.newPage({ viewport: { width: surface.viewport, height: 1200 } })
    page.on('pageerror', e => console.log('PAGE ERROR', e.message))
    await page.goto(`http://localhost:5327/tools/page-layout-alignment-check/index.html?width=${surface.width}`)
    await page.waitForSelector('[data-test="service-provider"]', { timeout: 8000 })
    await page.waitForTimeout(400)

    const groups = await page.evaluate(READ_GROUPS)
    const tag = `[${surface.name} ${surface.width}px]`
    await page.screenshot({ path: join(here, `page-layout-${surface.name}.png`), fullPage: true })

    for (const [id, expectedCols] of Object.entries(surface.expect)) {
      const g = groups[id]
      if (!g) { note(false, `${tag} ${id} rendered`, 'group not found'); continue }

      // ── 1. No hole. Every row tiles the section edge to edge. ─────────────
      const gaps = []
      for (const row of g.rows) {
        let cursor = row.left
        for (const cell of row.cells) {
          if (cell.left - cursor > 1) gaps.push(`${cell.label || 'blank'} starts ${Math.round(cell.left - cursor)}px late`)
          cursor = cell.right
        }
        if (row.right - cursor > 1) gaps.push(`row ends ${Math.round(row.right - cursor)}px short`)
      }
      note(gaps.length === 0, `${tag} ${id} — every row tiles the section with no empty slot`, gaps.join('; '))

      // ── 2. No stagger. A row's cells share a top and a bottom. ────────────
      const ragged = []
      for (const row of g.rows) {
        const tops = new Set(row.cells.map(c => c.top))
        const bottoms = new Set(row.cells.map(c => c.bottom))
        if (tops.size > 1) ragged.push(`tops ${[...tops].join('/')}`)
        if (bottoms.size > 1) ragged.push(`bottoms ${[...bottoms].join('/')}`)
      }
      note(ragged.length === 0, `${tag} ${id} — the cells of a row start and end level`, ragged.join('; '))

      // ── 3. One separator per row, spanning the whole section. ─────────────
      const shortRules = g.rows.filter(r => Math.abs(r.right - r.left - (g.right - g.left)) > 2)
      note(shortRules.length === 0, `${tag} ${id} — every separator runs the full width of the section`,
        `${shortRules.length} of ${g.rows.length} rows fall short`)

      // ── 4. The declared column count is honoured, capped by the box. ──────
      const widest = g.rows.reduce((n, r) => Math.max(n, r.cells.length), 0)
      note(widest === expectedCols, `${tag} ${id} — renders ${expectedCols} column(s)`,
        `rendered ${widest}`)

      // Nothing may be blank except at the END of a row.
      const earlyBlank = g.rows.some(r => r.cells.some((c, i) => c.blank && i < r.cells.length - 1))
      note(!earlyBlank, `${tag} ${id} — no blank slot before the last cell of its row`)

      // No empty band. A three-column section reflowed into the 480px rail
      // repacked its spacers, two landed together and painted a row with
      // nothing in it between Billing State and Billing Zip — found here, not
      // by reading the code.
      const emptyRows = g.rows.filter(r => r.cells.every(c => c.blank || !c.label)).length
      note(emptyRows === 0, `${tag} ${id} — no row is drawn with nothing in it`,
        `${emptyRows} empty row(s)`)
    }

    // ── 5. The reported section, spelled out ───────────────────────────────
    const sp = groups['service-provider']
    if (surface.name === 'desktop') {
      note(sp.rows.length === 1, `${tag} the reported section is ONE row, not two`,
        `${sp.rows.length} rows`)
      note(sp.rows[0]?.cells.map(c => c.label).join(' | ') === 'Tax Classification | Tax Identification FEIN',
        `${tag} both fields sit side by side, in reading order`,
        sp.rows[0]?.cells.map(c => c.label).join(' | '))
    }

    // ── 5b. The editor draws the same rows the record page does ───────────
    // View == build. The editor and the page disagreeing about placement is
    // exactly what produced the stagger, so this compares them cell for cell.
    // Only on the desktop pass: the editor canvas is a DESIGN surface and
    // always draws the section's declared column count, while the record page
    // drops a column when the box it lands in is too narrow. That divergence is
    // deliberate — an admin lays out the full-width form, not the phone.
    for (const id of (surface.name === 'desktop' ? ['service-provider', 'account-information'] : [])) {
      const editor = groups[`editor-${id}`]
      const live = groups[id]
      if (!editor || !live) { note(false, `${tag} editor grid for ${id} rendered`); continue }
      const liveRows = live.rows.map(r => r.cells.map(c => (c.blank ? '—' : c.label)))
      const editorRows = editor.rows.map(r => r.map(t => (t === '—' ? '—' : t)))
      const same = JSON.stringify(liveRows.map(r => r.length)) === JSON.stringify(editorRows.map(r => r.length))
      note(same, `${tag} the layout editor lays ${id} out in the same rows as the record page`,
        `page ${JSON.stringify(liveRows)}\n      editor ${JSON.stringify(editorRows)}`)
    }

    // ── 6. A tall value does not move its neighbour's separator ────────────
    const uneven = groups['uneven']
    const tallRow = uneven.rows.find(r => r.cells.some(c => c.bottom - c.top > 55))
    if (tallRow) {
      const spread = Math.max(...tallRow.cells.map(c => c.bottom)) - Math.min(...tallRow.cells.map(c => c.bottom))
      note(spread <= 1, `${tag} a three-line value and a one-word value end on the same rule`,
        `${spread}px apart`)
    } else if (surface.name !== 'phone') {
      note(false, `${tag} the uneven section produced a tall row to measure`, 'no row over 55px')
    }

    // ── 7. POSITIVE CONTROLS — the pre-fix grid must fail 1 and 2 ──────────
    if (surface.name === 'desktop') {
      const legacySp = groups['legacy-service-provider']
      const singles = legacySp.rows.filter(r => r.length === 1).length
      note(legacySp.rows.length === 2 && singles === 2,
        `${tag} CONTROL — the pre-fix placement still puts the two fields on separate rows`,
        `${legacySp.rows.length} rows, ${singles} of them holding one field`)
      note(legacySp.rows[0][0].left > legacySp.left + 1,
        `${tag} CONTROL — the pre-fix placement still leaves the top-left slot empty`,
        `first cell starts ${Math.round(legacySp.rows[0][0].left - legacySp.left)}px in`)

      const legacyUneven = groups['legacy-uneven']
      const raggedRules = legacyUneven.rows.filter(r =>
        r.length > 1 && Math.max(...r.map(c => c.ruleY)) - Math.min(...r.map(c => c.ruleY)) > 1).length
      note(raggedRules > 0,
        `${tag} CONTROL — the pre-fix cells still put their separators at different heights`,
        `${raggedRules} ragged row(s)`)
    }

    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}

console.log(`\npage-layout-alignment-check  ${failures ? `${failures} FAILED` : 'all passed'}  (${checks} checks)\n`)
process.exit(failures ? 1 : 0)
