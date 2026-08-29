#!/usr/bin/env node
//
// Do a report's columns hold still?
//
// Nicholas, 2026-08-29: "I need a way to adjust the column widths and never have
// them change again. There's too much of this auto-scaling and moving around...
// It shouldn't change unless the user changes the widths."
//
// That is a claim about what a browser DOES, and it cannot be checked by reading
// CSS: under `table-layout: auto` the widths in the stylesheet are suggestions
// the browser is free to overrule from the content, and everything looks correct
// while the columns jump. So this drives the real report table in Chromium:
//
//   1. measure every column
//   2. change the DATA (one cell becomes far longer than its column) without
//      touching the columns — every width must be IDENTICAL
//   3. drag one column's grip — that column moves by what was dragged, and no
//      other column moves
//   4. change the data again — the dragged width survives
//
// A POSITIVE CONTROL runs the same data change against a plain auto-layout table
// and must FAIL step 2. If it ever passes, the check has stopped measuring
// anything and every PASS beside it is worthless.
//
// Run with:  npm run verify:report-column-widths
// (needs a browser: npm install --no-save playwright-core)

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'report-column-width-check'

let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.log('\nverify:report-column-widths  SKIPPED — nothing was verified.\n\n  npm install --no-save playwright-core\n  npm run verify:report-column-widths\n')
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
  console.log('\nverify:report-column-widths  SKIPPED — no Chromium under PLAYWRIGHT_BROWSERS_PATH.\n')
  process.exit(0)
}

const server = await createServer({
  root, plugins: [react()], configFile: false,
  server: { port: 5312, strictPort: true }, logLevel: 'error',
})
await server.listen()

let failures = 0, checks = 0
const note = (ok, label, detail) => {
  checks += 1
  if (ok) console.log(`PASS  ${label}`)
  else { failures += 1; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}

const browser = await chromium.launch({ executablePath })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 1 })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto('http://localhost:5312/tools/report-column-width-check/', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-case="report-tabular"] table', { timeout: 20000 })

  const widthsOf = (caseId) => page.evaluate((cid) => {
    const el = document.querySelector(`[data-case="${cid}"]`)
    return [...el.querySelectorAll('thead th')].map(th => Math.round(th.getBoundingClientRect().width))
  }, caseId)

  const layoutOf = (caseId) => page.evaluate((cid) =>
    getComputedStyle(document.querySelector(`[data-case="${cid}"] table`)).tableLayout, caseId)

  // A summary report states its grouped field on the group header and drops it
  // from the detail columns, so it renders one fewer than the tabular layout.
  // Pinned per case: "every column has a width" is only meaningful if the count
  // is the one that layout is supposed to draw.
  const EXPECTED_COLUMNS = { 'report-tabular': 3, 'report-summary': 2 }
  for (const caseId of ['report-tabular', 'report-summary']) {
    note((await layoutOf(caseId)) === 'fixed',
      `${caseId}: the table is laid out fixed (auto re-measures from the content)`)

    const before = await widthsOf(caseId)
    note(before.length === EXPECTED_COLUMNS[caseId] && before.every(w => w > 0),
      `${caseId}: all ${EXPECTED_COLUMNS[caseId]} columns have a width (${before.join(', ')})`)

    await page.click('#toggle-data')
    await page.waitForTimeout(120)
    const after = await widthsOf(caseId)
    note(JSON.stringify(before) === JSON.stringify(after),
      `${caseId}: a value far longer than its column moves nothing`,
      `before ${before.join(', ')} · after ${after.join(', ')}`)
    await page.click('#toggle-data')
    await page.waitForTimeout(120)
  }

  // ── The drag ───────────────────────────────────────────────────────────
  {
    const caseId = 'report-tabular'
    const before = await widthsOf(caseId)
    const grip = await page.evaluate((cid) => {
      const th = document.querySelector(`[data-case="${cid}"] thead th`)
      const g = th.querySelector('div[title]')
      const r = g.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, caseId)
    await page.mouse.move(grip.x, grip.y)
    await page.mouse.down()
    await page.mouse.move(grip.x + 90, grip.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(120)

    const dragged = await widthsOf(caseId)
    const delta = dragged[0] - before[0]
    note(Math.abs(delta - 90) <= 3, `report-tabular: dragging the first column's edge widened it by what was dragged (${delta}px of 90)`)
    note(JSON.stringify(dragged.slice(1)) === JSON.stringify(before.slice(1)),
      'report-tabular: the other columns did not move',
      `before ${before.slice(1).join(', ')} · after ${dragged.slice(1).join(', ')}`)

    // And the data still cannot move it.
    await page.click('#toggle-data')
    await page.waitForTimeout(120)
    const afterData = await widthsOf(caseId)
    note(JSON.stringify(dragged) === JSON.stringify(afterData),
      'report-tabular: a dragged width survives the data changing underneath it',
      `dragged ${dragged.join(', ')} · after ${afterData.join(', ')}`)
    await page.click('#toggle-data')
    await page.waitForTimeout(120)

    // Double-click the grip returns that column to its default.
    await page.mouse.dblclick(grip.x + 90, grip.y)
    await page.waitForTimeout(150)
    const reset = await widthsOf(caseId)
    note(reset[0] === before[0], `report-tabular: double-clicking the grip restores the default width (${reset[0]} of ${before[0]})`)
  }

  // ── Positive control: the same data change against auto layout ─────────
  {
    const moved = await page.evaluate(() => {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:700px'
      host.innerHTML = `<table id="ctl" style="table-layout:auto;width:700px">
        <thead><tr><th>Status</th><th>Amount</th><th>Date</th></tr></thead>
        <tbody><tr><td id="c">Prepared</td><td>2000</td><td>2026-08-29</td></tr></tbody></table>`
      document.body.appendChild(host)
      const w = () => [...host.querySelectorAll('th')].map(th => Math.round(th.getBoundingClientRect().width))
      const before = w()
      host.querySelector('#c').textContent =
        'Incentive Application To Be Prepared And Reviewed By The Program Administrator Before Submission'
      const after = w()
      host.remove()
      return JSON.stringify(before) !== JSON.stringify(after)
    })
    note(moved, 'POSITIVE CONTROL — an auto-layout table DOES move when the data grows (if this fails, the check measures nothing)')
  }

  note(pageErrors.length === 0, 'no page errors while rendering', pageErrors.join(' · '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\nverify:report-column-widths: ${checks - failures} of ${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
