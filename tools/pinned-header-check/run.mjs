#!/usr/bin/env node
//
// Does row text ever paint inside a pinned column header while you scroll?
//
// Nicholas has reported this four or five times over several months — "when I
// scroll on a dashboard home widget, the text overlaps the column headers." Each
// time it was investigated by reading CSS and each time it came back, because
// reading CSS cannot see what a browser paints. The last root cause was a colour
// token the palette never defined (`C.cardSecondary`), which made every pinned
// header transparent while every line of CSS looked correct.
//
// So this checks the thing he actually sees, in a real browser:
//
//   photograph the header band, scroll the rows underneath it, photograph it
//   again — at a dozen offsets including fractional ones — and require the
//   pixels to be IDENTICAL every time.
//
// That is mechanism-independent. A transparent background, a z-index mistake, a
// compositing ghost and a stale repaint all change those pixels; none of them
// can hide from it.
//
// Two edges of the band are excluded, both instrument rather than product: the
// container's rounded-corner arc (Chromium re-resolves its anti-aliasing when
// the scrolling layer changes) and the overlay scrollbar's gutter (the thumb is
// SUPPOSED to move). A POSITIVE CONTROL case has its header background stripped
// on purpose and must FAIL — if it ever passes, the exclusions have started
// masking the defect and every other PASS in the run is worthless.
//
// Run with:  npm run verify:pinned-headers
//
// Not part of `npm run build:safe`: it needs a browser binary, and a deploy that
// depends on one is a deploy that breaks when the build image changes. The build
// gate for this defect is scripts/palette-token-fixture.mjs and
// scripts/pinned-header-fixture.mjs, which catch the cause statically. This tool
// is how you prove the result.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

// The harness imports the real modules, which import the Supabase client, which
// throws at module scope without these. Nothing is ever fetched.
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'pinned-header-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log([
    '',
    'verify:pinned-headers  SKIPPED — nothing was verified.',
    '',
    '  playwright-core is not installed. It is deliberately not a dependency:',
    '  this check is a tool, not a build step. To run it:',
    '',
    '    npm install --no-save playwright-core',
    '    npm run verify:pinned-headers',
    '',
  ].join('\n'))
  process.exit(0)
}

// Chromium is provided by the environment (PLAYWRIGHT_BROWSERS_PATH), not
// downloaded. Find it rather than assuming a version-stamped path.
import { readdirSync, existsSync } from 'node:fs'
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
  console.log('\nverify:pinned-headers  SKIPPED — nothing was verified.\n  No Chromium found under PLAYWRIGHT_BROWSERS_PATH. Set CHROMIUM_PATH to a binary.\n')
  process.exit(0)
}

const server = await createServer({
  root, plugins: [react()], configFile: false,
  server: { port: 5311, strictPort: true }, logLevel: 'error',
})
await server.listen()

let failures = 0, checks = 0, controlSeen = false
const note = (ok, label, detail) => {
  checks += 1
  if (ok) console.log(`PASS  ${label}`)
  else { failures += 1; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}

const browser = await chromium.launch({ executablePath })
try {
  const page = await browser.newPage({ viewport: { width: 780, height: 2400 }, deviceScaleFactor: 2 })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto('http://localhost:5311/tools/pinned-header-check/', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-case] table', { timeout: 20000 })

  const cases = await page.$$eval('[data-case]', els => els.map(e => e.dataset.case))
  note(cases.length >= 6, `the harness mounted its cases (${cases.length} found)`)

  for (const id of cases) {
    const isControl = id.startsWith('CONTROL')
    if (isControl) controlSeen = true

    // The scroll box that owns this case's rows.
    const box = await page.evaluateHandle((cid) => {
      const rootEl = document.querySelector(`[data-case="${cid}"]`)
      const table = rootEl.querySelector('table')
      if (!table) return null
      let el = table.parentElement
      while (el && el !== rootEl && !(el.scrollHeight > el.clientHeight + 2)) el = el.parentElement
      return el && el.scrollHeight > el.clientHeight + 2 ? el : null
    }, id)

    const scrolls = await box.evaluate(el => !!el)
    note(scrolls, `${id}: actually scrolls (a case that cannot scroll proves nothing)`)
    if (!scrolls) continue

    const band = await page.evaluate((cid) => {
      const rootEl = document.querySelector(`[data-case="${cid}"]`)
      const th = [...rootEl.querySelectorAll('th')].filter(t => getComputedStyle(t).position === 'sticky')
      if (!th.length) return null
      const r = th.map(t => t.getBoundingClientRect())
      let el = rootEl.querySelector('table').parentElement
      while (el && el !== rootEl && !(el.scrollHeight > el.clientHeight + 2)) el = el.parentElement
      const b = el.getBoundingClientRect()
      const GUTTER = 20
      const ARC = Math.ceil(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) + 2
      const left  = Math.max(Math.min(...r.map(v => v.left)), b.left) + ARC
      const right = Math.min(Math.max(...r.map(v => v.right)), b.right - GUTTER)
      return {
        x: left + window.scrollX, y: Math.min(...r.map(v => v.top)) + window.scrollY,
        width: right - left,
        height: Math.max(...r.map(v => v.bottom)) - Math.min(...r.map(v => v.top)),
        bg: getComputedStyle(th[0]).backgroundColor, arc: ARC, gutter: GUTTER,
      }
    }, id)

    if (!band) {
      // Not a failure — it means this surface pins nothing, which cannot
      // overlap. Reported so the gap stays visible instead of reading as a pass.
      console.log(`NOTE  ${id}: has no pinned header at all — its column headers scroll out of sight`)
      continue
    }

    note(isControl ? band.bg === 'rgba(0, 0, 0, 0)' : band.bg !== 'rgba(0, 0, 0, 0)',
      isControl ? `${id}: the control really is see-through` : `${id}: pinned header background is not transparent`,
      `computed ${band.bg}`)

    const clip = { x: band.x, y: band.y, width: band.width, height: band.height }
    const hashes = new Map()
    const drift = []
    for (const top of [0, 1, 3, 7, 9.5, 14, 21.5, 40, 83, 140, 260, 400]) {
      await box.evaluate((el, t) => { el.scrollTop = t }, top)
      await page.waitForTimeout(60)
      const y = await page.evaluate((cid) => {
        const th = [...document.querySelector(`[data-case="${cid}"]`).querySelectorAll('th')]
          .filter(t => getComputedStyle(t).position === 'sticky')
        return Math.min(...th.map(t => t.getBoundingClientRect().top)) + window.scrollY
      }, id)
      if (Math.abs(y - band.y) > 0.5) drift.push(`${top}→y=${y}`)
      const png = await page.screenshot({ clip })
      const h = createHash('sha256').update(png).digest('hex').slice(0, 12)
      if (!hashes.has(h)) hashes.set(h, [])
      hashes.get(h).push(top)
    }
    note(drift.length === 0, `${id}: pinned header stays put while the rows move`,
      `it moved at scrollTop ${drift.join(', ')} (expected y=${band.y})`)

    const distinct = [...hashes.entries()]
    const geom = `${Math.round(band.width)}x${Math.round(band.height)}px; ${band.arc}px corner arc + ${band.gutter}px scrollbar gutter excluded`
    if (isControl) {
      note(distinct.length > 1,
        `${id}: POSITIVE CONTROL — the narrowed band still catches a see-through header`,
        'the control PASSED, so the exclusions are masking the defect and every other result in this run is worthless')
    } else {
      note(distinct.length === 1,
        `${id}: header band is pixel-identical at every scroll offset (${geom})`,
        distinct.length === 1 ? '' : `${distinct.length} distinct renderings — rows are painting inside the header: ` +
          distinct.map(([h, tops]) => `${h} @ scrollTop ${tops.join(',')}`).join(' | '))
    }
    await box.evaluate(el => { el.scrollTop = 0 })

    // ── The other axis ─────────────────────────────────────────────────────
    // A table that also scrolls SIDEWAYS can lose its row labels the same way a
    // scrolling one loses its column headings, and it reads worse: a grid of
    // numbers with nothing naming the rows. Same test, turned ninety degrees.
    const scrollsX = await box.evaluate(el => el.scrollWidth > el.clientWidth + 2)
    if (!scrollsX) continue

    const lane = await page.evaluate((cid) => {
      const rootEl = document.querySelector(`[data-case="${cid}"]`)
      const pinned = [...rootEl.querySelectorAll('td, th')]
        .filter(c => { const s = getComputedStyle(c); return s.position === 'sticky' && s.left !== 'auto' })
      if (!pinned.length) return null
      let el = rootEl.querySelector('table').parentElement
      while (el && el !== rootEl && !(el.scrollHeight > el.clientHeight + 2)) el = el.parentElement
      const b = el.getBoundingClientRect()
      const r = pinned.map(c => c.getBoundingClientRect())
      const ARC = Math.ceil(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) + 2
      const top = Math.max(Math.min(...r.map(v => v.top)), b.top) + ARC
      const bottom = Math.min(Math.max(...r.map(v => v.bottom)), b.bottom - 20)
      return {
        x: Math.min(...r.map(v => v.left)) + window.scrollX,
        y: top + window.scrollY,
        width: Math.min(Math.max(...r.map(v => v.right)), b.right) - Math.min(...r.map(v => v.left)),
        height: bottom - top,
        bg: getComputedStyle(pinned[0]).backgroundColor,
      }
    }, id)

    if (!lane) {
      const decided = await page.getAttribute(`[data-case="${id}"]`, 'data-x-pin-decided')
      console.log(decided
        ? `NOTE  ${id}: pins no column sideways, deliberately — ${decided}`
        : `NOTE  ${id}: scrolls sideways but pins no column — its row labels scroll out of sight`)
      continue
    }
    note(lane.bg !== 'rgba(0, 0, 0, 0)', `${id}: pinned row-label column is not transparent`, `computed ${lane.bg}`)

    const laneClip = { x: lane.x, y: lane.y, width: lane.width, height: lane.height }
    const laneHashes = new Map()
    for (const left of [0, 1, 3, 7, 9.5, 14, 40, 120, 400, 900]) {
      await box.evaluate((el, l) => { el.scrollLeft = l }, left)
      await page.waitForTimeout(60)
      const png = await page.screenshot({ clip: laneClip })
      const h = createHash('sha256').update(png).digest('hex').slice(0, 12)
      if (!laneHashes.has(h)) laneHashes.set(h, [])
      laneHashes.get(h).push(left)
    }
    const laneDistinct = [...laneHashes.entries()]
    note(laneDistinct.length === 1,
      `${id}: pinned row-label column is pixel-identical at every horizontal offset (${Math.round(lane.width)}x${Math.round(lane.height)}px)`,
      laneDistinct.length === 1 ? '' : `${laneDistinct.length} distinct renderings — cells are painting inside the pinned column: ` +
        laneDistinct.map(([h, ls]) => `${h} @ scrollLeft ${ls.join(',')}`).join(' | '))
    await box.evaluate(el => { el.scrollLeft = 0 })
  }

  note(controlSeen, 'the positive control case was present in the run')
  note(pageErrors.length === 0, 'no page errors while rendering', pageErrors.join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(failures === 0
  ? `\nverify:pinned-headers: ${checks} checks passed`
  : `\nverify:pinned-headers: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
