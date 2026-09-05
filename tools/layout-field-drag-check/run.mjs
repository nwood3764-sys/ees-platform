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
// The reported layout is 2 columns with no full-width field, which is the easy
// half, so two more shapes are on the page: a THREE-column section (where a
// flow scatters fields furthest) and a section carrying a FULL-WIDTH field
// (which belongs to no column — it is a row of its own and splits the section
// into bands, the one shape where "cols independent stacks" is the wrong
// answer). Both must move exactly one field too.
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
const page = await browser.newPage({ viewport: { width: 1200, height: 2400 } })
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
    // A tile is picked up by its ⠿ handle, exactly as an admin does it — the
    // drag listeners are on the handle so the label, the ↔ toggle and the ×
    // stay clickable.
    const h = tile.querySelector('[data-drag-handle]').getBoundingClientRect()
    return {
      handle: [h.left + h.width / 2, h.top + h.height / 2],
      centre: [r.left + r.width / 2, r.top + r.height / 2],
      box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    }
  }, { testId, label })
}

// The strips under the columns only exist while a drag is in flight, so this
// reads them mid-drag: press, move, then measure.
async function columnEndBox(testId, col) {
  return page.evaluate(({ testId, col }) => {
    const group = document.querySelector(`[data-test="${testId}"]`)
    const el = group.querySelector(`[data-column-end="${col}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.height < 2) return null
    return { centre: [r.left + r.width / 2, r.top + r.height / 2] }
  }, { testId, col })
}

// How many fields ended up in a different COLUMN. "Moving one field must not
// move five others" is a claim about this number.
const COLUMN_CHANGES = ({ before, after }) => {
  const cols = (rows) => {
    const m = {}
    rows.forEach(row => row.forEach((label, c) => {
      if (label && label !== '—' && label !== 'Empty slot') m[label] = c
    }))
    return m
  }
  const a = cols(before), b = cols(after)
  return Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]).length
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
async function drag(from, to, opts = {}) {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + 8, from[1] + 8, { steps: 4 })
  if (opts.hover) await page.waitForTimeout(150)
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
  // Nicholas: "I can't move one field and have five other fields move around."
  // Column 2 reads Opportunity / Project / Property / Assessor Name. Dropping
  // Building on Project puts it at Project's position IN COLUMN 2.
  {
    const src = await tileBox('live-information', 'Building')
    const dst = await tileBox('live-information', 'Project')
    await drag(src.handle, dst.centre)
    const after = await page.evaluate(READ, 'live-information')
    note(eq(after.map(r => r[1]),
      ['Opportunity', 'Building', 'Project', 'Property', 'Assessor Name', '—']),
      'the dragged field lands in the column it was dropped on, at that position',
      JSON.stringify(after.map(r => r[1])))
    note(eq(after.map(r => r[0]),
      ['Name', 'Property Contact for IQ Assessment', 'Gas Fuel Provider',
       'Date Of Iq Assessment', 'Start Time Of Iq Assessment', 'End Time Of Iq Assessment']),
      'the column it came from closes up and nothing in it changes side',
      JSON.stringify(after.map(r => r[0])))
    note(await page.evaluate(COLUMN_CHANGES, { before: BEFORE, after }) === 1,
      'EXACTLY ONE field changed column — the one that was dragged',
      JSON.stringify(await page.evaluate(COLUMN_CHANGES, { before: BEFORE, after })))
  }

  // ── 2. CONTROL — the flow, which is what was being reported ──────────────
  {
    const src = await tileBox('control-information', 'Building')
    const dst = await tileBox('control-information', 'Assessor Name')
    await drag(src.handle, dst.centre)
    const after = await page.evaluate(READ, 'control-information')
    const changed = await page.evaluate(COLUMN_CHANGES, { before: BEFORE, after })
    note(changed >= 3,
      `CONTROL: under the flow rule the same drag re-columns ${changed} fields`,
      JSON.stringify(after))
  }

  // ── 3. Within one column, the other column never notices ────────────────
  await reload()
  {
    const src = await tileBox('live-information', 'End Time Of Iq Assessment')
    const dst = await tileBox('live-information', 'Building')
    await drag(src.handle, dst.centre)
    const after = await page.evaluate(READ, 'live-information')
    note(eq(after.map(r => r[0]).slice(0, 3),
      ['Name', 'End Time Of Iq Assessment', 'Building']),
      'a field dragged up its own column lands where it was dropped',
      JSON.stringify(after.map(r => r[0])))
    note(eq(after.map(r => r[1]), BEFORE.map(r => r[1])),
      'and the other column is byte for byte what it was',
      JSON.stringify(after.map(r => r[1])))
  }

  // ── 4. An empty slot is filled, and nothing else moves at all ───────────
  await reload()
  {
    const src = await tileBox('live-information', 'End Time Of Iq Assessment')
    const slot = await tileBox('live-information', 'Empty slot')
    await drag(src.handle, slot.centre)
    const after = await page.evaluate(READ, 'live-information')
    note(eq(after[4], ['Date Of Iq Assessment', 'End Time Of Iq Assessment']),
      'a field dropped on an empty slot takes that exact cell',
      JSON.stringify(after))
    note(await page.evaluate(COLUMN_CHANGES, { before: BEFORE, after }) === 1,
      'and it is the only field that changed column',
      JSON.stringify(after))
  }

  // ── 5. A NEAR MISS never sends the field to the end ─────────────────────
  // The 6px gap between two rows is inside the section but on no cell. It used
  // to fall through to the section, which meant "append" — so missing a tile by
  // a few pixels sent the field to the end of the layout and re-columned
  // everything after it.
  await reload()
  {
    const src = await tileBox('live-information', 'Building')
    const a = await tileBox('live-information', 'Property Contact for IQ Assessment')
    const b = await tileBox('live-information', 'Gas Fuel Provider')
    const gap = [a.centre[0], (a.box.bottom + b.box.top) / 2]
    await drag(src.handle, gap)
    const after = await page.evaluate(READ, 'live-information')
    note(after[after.length - 1][0] !== 'Building',
      'a drop in the gap between two rows does NOT send the field to the end',
      JSON.stringify(after))
    note(await page.evaluate(COLUMN_CHANGES, { before: BEFORE, after }) <= 1,
      'and a near miss never moves a field sideways',
      JSON.stringify(after))
  }

  // ── 6. The bottom of a full column is reachable ─────────────────────────
  await reload()
  {
    const src = await tileBox('live-information', 'Building')
    const strip = await columnEndBox('live-information', 1)
    note(strip != null, 'each column carries a drop strip under it while dragging')
    await drag(src.handle, strip.centre, { hover: true })
    const after = await page.evaluate(READ, 'live-information')
    note(after[after.length - 1][1] === 'Building',
      'a field dropped under a column goes to the bottom of that column',
      JSON.stringify(after.map(r => r[1])))
  }

  // ── 7. Across sections it is a move, and the source column closes up ────
  await reload()
  {
    const src = await tileBox('live-information', 'Building')
    const dst = await tileBox('live-occupancy', 'Number Of Units')
    await drag(src.handle, dst.centre)
    const info = await page.evaluate(READ, 'live-information')
    const occ  = await page.evaluate(READ, 'live-occupancy')
    note(eq(occ.map(r => r[1]), ['Building', 'Number Of Units']),
      'a field dragged into another section lands in the column it was dropped on',
      JSON.stringify(occ))
    note(eq(info.map(r => r[0]).slice(0, 2), ['Name', 'Property Contact for IQ Assessment']),
      'and the column it left closes up behind it',
      JSON.stringify(info.map(r => r[0])))
  }

  // ── 8. THREE columns — the model is not a two-column special case ───────
  // A flow scatters a 3-column section further than a 2-column one, so the
  // shape that was reported is the easy half.
  await reload()
  {
    const before = await page.evaluate(READ, 'live-threecol')
    note(eq(before.slice(0, 2), [
      ['Alpha', 'Bravo', 'Charlie'],
      ['Delta', 'Echo', 'Foxtrot'],
    ]) && before[2][0] === 'Golf',
      'a 3-column section renders as three columns', JSON.stringify(before))

    const src = await tileBox('live-threecol', 'Foxtrot')
    const dst = await tileBox('live-threecol', 'Bravo')
    await drag(src.handle, dst.centre)
    const after = await page.evaluate(READ, 'live-threecol')
    note(eq(after.map(r => r[1]), ['Foxtrot', 'Bravo', 'Echo']),
      '3 columns: the dragged field takes the position it was dropped on, in that column',
      JSON.stringify(after))
    const REAL = (rows, c) => rows.map(r => r[c]).filter(x => x && x !== '—' && x !== 'Empty slot')
    note(eq(REAL(after, 0), ['Alpha', 'Delta', 'Golf']) && eq(REAL(after, 2), ['Charlie']),
      '3 columns: the untouched columns hold exactly the fields they held',
      JSON.stringify(after))
    note(await page.evaluate(COLUMN_CHANGES, { before, after }) === 1,
      '3 columns: EXACTLY ONE field changed column',
      JSON.stringify(await page.evaluate(COLUMN_CHANGES, { before, after })))
  }

  // ── 9. A FULL-WIDTH field is a row of its own and splits the section ────
  await reload()
  {
    const before = await page.evaluate(READ, 'live-bands')
    note(eq(before, [
      ['Papa', 'Quebec'],
      ['Romeo'],
      ['Sierra', 'Tango'],
      ['Uniform', '—'],
    ]), 'a full-width field renders as a row of its own', JSON.stringify(before))

    const src = await tileBox('live-bands', 'Uniform')
    const dst = await tileBox('live-bands', 'Tango')
    await drag(src.handle, dst.centre)
    const after = await page.evaluate(READ, 'live-bands')
    note(eq(after[0], ['Papa', 'Quebec']) && eq(after[1], ['Romeo']),
      'a drag below the full-width row leaves everything above it untouched',
      JSON.stringify(after))
    note(await page.evaluate(COLUMN_CHANGES, { before, after }) === 1,
      'full-width band: EXACTLY ONE field changed column',
      JSON.stringify(after))
  }

  // ── 10. The full-width field itself moves as a whole row ────────────────
  await reload()
  {
    const before = await page.evaluate(READ, 'live-bands')
    const src = await tileBox('live-bands', 'Romeo')
    const dst = await tileBox('live-bands', 'Papa')
    await drag(src.handle, dst.centre)
    const after = await page.evaluate(READ, 'live-bands')
    const romeoRow = after.findIndex(r => r.includes('Romeo'))
    note(romeoRow >= 0 && after[romeoRow].length === 1,
      'the full-width field stays a row of its own after being dragged',
      JSON.stringify(after))
    note(await page.evaluate(COLUMN_CHANGES, { before, after }) === 0,
      'and dragging it changes no other field\'s column',
      JSON.stringify(after))
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
