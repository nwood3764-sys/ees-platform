#!/usr/bin/env node
//
// Does a field go where you drop it?
//
// Nicholas, 2026-09-05, in the page-layout editor on the assessments
// WI-IRA-MF-HOMES-AUDIT layout: "In hindsight, it's not even allowing me to
// move it. I just moved the building over to the right, and it moved the
// property, the building, and the project back to the left."
//
// Neither half of that is visible by reading the source. Whether a drop lands
// on a tile or on the 14px insertion line overlaying its edge is decided by
// the boxes a browser laid out and by dnd-kit's collision detection over them,
// so this drives real mouse drags over the REAL FieldRowGrid, inside a real
// DndContext using the editor's own collision detection, on the field array
// production actually stores for that layout.
//
// Beside it, the same grid resolving drops the way the editor did before this
// change. The reported drag must still come back a NO-OP there — a check that
// cannot reproduce the bug is measuring nothing.
//
// Run with:  node tools/layout-field-drag-check/run.mjs
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
process.env.VITE_SUPABASE_ANON_KEY ||= 'layout-field-drag-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log('\nlayout-field-drag-check  SKIPPED — nothing was verified.\n  npm install --no-save playwright-core\n')
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
  console.log('\nlayout-field-drag-check  SKIPPED — no Chromium under PLAYWRIGHT_BROWSERS_PATH.\n')
  process.exit(0)
}

function supabaseStubPlugin() {
  const stub = join(here, 'supabaseStub.js')
  return {
    name: 'layout-field-drag-supabase-stub',
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
  server: { port: 5328, strictPort: true }, logLevel: 'error',
})
await server.listen()

let failures = 0, checks = 0
const note = (ok, label, detail) => {
  checks += 1
  if (ok) console.log(`PASS  ${label}`)
  else { failures += 1; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } })
page.on('pageerror', e => console.log('PAGE ERROR', e.message))

// The rendered grid, read off the editor's own markers: one array per row, one
// entry per cell. This is what the admin sees, not what the array holds.
const READ = (testId) => {
  const group = document.querySelector(`[data-test="${testId}"]`)
  if (!group) return null
  return [...group.querySelectorAll('[data-field-row]')].map(row =>
    [...row.children].map(cell => {
      const tile = cell.querySelector('[data-cell-kind]')
      if (!tile) return '?'
      const kind = tile.getAttribute('data-cell-kind')
      if (kind === 'blank') return '—'
      return tile.getAttribute('data-cell-label') || ''
    }))
}

// The centre of a tile, and the centre of the insertion line on its leading
// edge. Both are read from the live boxes; the line is deliberately narrow, so
// aiming at it by arithmetic rather than by measurement would prove nothing.
async function tileBox(testId, label) {
  return page.evaluate(({ testId, label }) => {
    const group = document.querySelector(`[data-test="${testId}"]`)
    const tile = [...group.querySelectorAll('[data-cell-kind]')]
      .find(t => t.getAttribute('data-cell-label') === label)
    if (!tile) return null
    const r = tile.getBoundingClientRect()
    const cell = tile.closest('[data-field-cell]')
    const lines = cell ? [...cell.querySelectorAll('[data-insert-line]')] : []
    const line = lines[0] || null
    const trail = lines.find(l => l.getAttribute('data-insert-after') !== null) || null
    const lr = line ? line.getBoundingClientRect() : null
    const tr = trail ? trail.getBoundingClientRect() : null
    // A tile is picked up by its ⠿ handle, exactly as an admin does it — the
    // drag listeners are on the handle so the label, the ↔ toggle and the ×
    // stay clickable.
    const h = tile.querySelector('[data-drag-handle]').getBoundingClientRect()
    return {
      handle: [h.left + h.width / 2, h.top + h.height / 2],
      centre: [r.left + r.width / 2, r.top + r.height / 2],
      line: lr ? [lr.left + lr.width / 2, lr.top + lr.height / 2] : null,
      after: tr ? [tr.left + tr.width / 2, tr.top + tr.height / 2] : null,
    }
  }, { testId, label })
}

async function blankBox(testId) {
  return page.evaluate(({ testId }) => {
    const group = document.querySelector(`[data-test="${testId}"]`)
    const blank = group.querySelector('[data-cell-kind="blank"]')
    if (!blank) return null
    const r = blank.getBoundingClientRect()
    return { centre: [r.left + r.width / 2, r.top + r.height / 2] }
  }, { testId })
}

// A real drag: press, cross the 4px activation distance, travel in steps so
// dnd-kit measures on the way, release.
async function drag(from, to) {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + 8, from[1] + 8, { steps: 4 })
  await page.mouse.move(to[0], to[1], { steps: 12 })
  await page.mouse.move(to[0], to[1])
  await page.mouse.up()
  await page.waitForTimeout(150)
}

async function reload() {
  await page.goto(`http://localhost:5328/tools/layout-field-drag-check/index.html`)
  await page.waitForSelector('[data-test="live-information"]', { timeout: 8000 })
  await page.waitForTimeout(250)
}

const BEFORE = [
  ['Name', 'Opportunity'],
  ['Building', 'Project'],
  ['Property Contact for IQ Assessment', 'Property'],
  ['Gas Fuel Provider', 'Assessor Name'],
  ['Date Of Iq Assessment', 'Empty slot'],
  ['Start Time Of Iq Assessment', 'Empty slot'],
  ['End Time Of Iq Assessment', '—'],
]

try {
  await reload()
  note(eq(await page.evaluate(READ, 'live-information'), BEFORE),
    'the reported section renders exactly as the screenshot showed it',
    JSON.stringify(await page.evaluate(READ, 'live-information')))

  // ── 1. THE REPORTED DRAG: Building into the right-hand column ────────────
  // Nicholas, 2026-09-05: "If I move something over, it goes in between the two
  // existing fields." To put Building on the right he drops it between Project
  // and Property Contact — the line at the start of row 3.
  {
    const src = await tileBox('live-information', 'Building')
    const dst = await tileBox('live-information', 'Property Contact for IQ Assessment')
    await drag(src.handle, dst.line)
    const after = await page.evaluate(READ, 'live-information')
    note(String(await page.evaluate(() => window.__lastOver)).startsWith('ins::'),
      'a drop aimed at the gutter resolves to the insertion line, not the tile beside it',
      String(await page.evaluate(() => window.__lastOver)))
    note(eq(after[1], ['Project', 'Building']),
      'the field lands between the two fields it was dropped between',
      JSON.stringify(after[1]))
    note(eq(after.slice(2), BEFORE.slice(2)),
      'and nothing below the drop moves at all',
      JSON.stringify(after))
  }

  // ── 1b. "I moved the building over to the right" ─────────────────────────
  // Aimed at the RIGHT-HAND END of the row Building is on. There is a target
  // there now: without one, the nearest thing to drop on was the row below,
  // which is how a drag meant to move a field one place across a row ended up
  // rearranging the section.
  await reload()
  {
    const src = await tileBox('live-information', 'Building')
    const dst = await tileBox('live-information', 'Project')
    note(dst.after != null, 'the last cell of a row carries an insertion line on its right edge')
    await drag(src.handle, dst.after)
    const after = await page.evaluate(READ, 'live-information')
    note(eq(after[1], ['Project', 'Building']),
      'dropping Building off the right-hand end of its row puts it in the right-hand column',
      JSON.stringify(after[1]))
    note(eq(after.slice(2), BEFORE.slice(2)),
      'and every row below it is untouched',
      JSON.stringify(after))
  }

  // ── 2. NOTHING EVER TRADES PLACES ────────────────────────────────────────
  // "I don't want fields to trade places ever. That's never, ever a good
  // functionality." A drop on a tile puts the field in FRONT of that tile; the
  // tile moves along one cell and is never thrown across the section.
  await reload()
  {
    const src = await tileBox('live-information', 'Building')
    const dst = await tileBox('live-information', 'Assessor Name')
    await drag(src.handle, dst.centre)
    const after = await page.evaluate(READ, 'live-information')
    note(String(await page.evaluate(() => window.__lastOver)).startsWith('fld::'),
      'the drop resolved to the tile, not to the insertion line overlaying its edge',
      String(await page.evaluate(() => window.__lastOver)))
    note(eq(after[3], ['Building', 'Assessor Name']),
      'the dragged field takes the cell and the tile moves along one place',
      JSON.stringify(after[3]))
    note(!after.some(r => r[0] === 'Assessor Name'),
      'the displaced field is NOT thrown into the other column',
      JSON.stringify(after))
  }

  // ── 3. CONTROL — the pre-fix resolution still does nothing ───────────────
  {
    const src = await tileBox('control-information', 'Building')
    const dst = await tileBox('control-information', 'Project')
    await drag(src.handle, dst.centre)
    const after = await page.evaluate(READ, 'control-information')
    note(eq(after, BEFORE),
      'CONTROL: a one-slot forward drag under the old rule still does nothing at all',
      JSON.stringify(after))
  }

  // ── 4. An empty slot is the one target that pushes nothing ───────────────
  await reload()
  {
    const src = await tileBox('live-information', 'Assessor Name')
    const slot = await tileBox('live-information', 'Empty slot')
    await drag(src.handle, slot.centre)
    const after = await page.evaluate(READ, 'live-information')
    note(eq(after[3], ['Gas Fuel Provider', 'Date Of Iq Assessment']),
      'a field dropped on an empty slot fills it',
      JSON.stringify(after))
    note(after.every(r => r.length === 2),
      'and every row is still whole',
      JSON.stringify(after))
  }

  // ── 5. Across sections it is a move, and the source closes up ────────────
  await reload()
  {
    const src = await tileBox('live-information', 'Building')
    const dst = await tileBox('live-occupancy', 'Number Of Units')
    await drag(src.handle, dst.centre)
    const info = await page.evaluate(READ, 'live-information')
    const occ  = await page.evaluate(READ, 'live-occupancy')
    note(eq(occ[0], ['Building Sq Ft', 'Building']),
      'a field dragged into another section lands at the cell it was dropped on',
      JSON.stringify(occ))
    note(eq(info[1], ['Project', 'Property Contact for IQ Assessment']),
      'and the section it left closes up behind it — a field leaving does not punch a hole',
      JSON.stringify(info[1]))
  }

  // ── 6. An empty slot is itself draggable ────────────────────────────────
  await reload()
  {
    const src = await tileBox('live-information', 'Empty slot')
    const dst = await tileBox('live-information', 'Opportunity')
    await drag(src.handle, dst.centre)
    const after = await page.evaluate(READ, 'live-information')
    note(eq(after[0], ['Name', 'Empty slot']),
      'an empty slot can be dragged to the cell it should blank',
      JSON.stringify(after[0]))
  }

  await page.screenshot({ path: join(here, 'layout-field-drag.png'), fullPage: true })
} finally {
  await browser.close()
  await server.close()
}

console.log(failures === 0
  ? `\nlayout-field-drag-check  all passed  (${checks} checks)\n`
  : `\nlayout-field-drag-check  ${failures} of ${checks} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
