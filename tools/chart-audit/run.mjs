#!/usr/bin/env node
// Screenshots the real pie widget so a claim about legibility can be checked by
// LOOKING at it. Run: node tools/chart-audit/run.mjs [outDir]
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outDir = process.argv[2] || root
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'chart-audit'

let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.log('SKIPPED — npm install --no-save playwright-core'); process.exit(0)
}
function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) return null
  for (const entry of readdirSync(base)) {
    const p = join(base, entry, 'chrome-linux/chrome')
    if (entry.startsWith('chromium') && !entry.includes('headless_shell') && existsSync(p)) return p
  }
  return null
}
const executablePath = findChromium()
if (!executablePath) { console.log('SKIPPED — no Chromium'); process.exit(0) }

// Kept in step with the TYPES list in harness.jsx.
const TYPES_EXPECTED = 30

const server = await createServer({
  root, plugins: [react()], configFile: false,
  server: { port: 5319, strictPort: true }, logLevel: 'error',
})
await server.listen()
const browser = await chromium.launch({ executablePath })
try {
  const page = await browser.newPage({ viewport: { width: 980, height: 5200 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:5319/tools/chart-audit/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  // The chart resizes through a ResizeObserver, which fires asynchronously —
  // screenshotting too early photographs the canvas at its PREVIOUS size, which
  // reads as a clipped pie and sends you looking for a layout bug that is not
  // there.
  await page.waitForTimeout(1500)
  const cases = await page.locator('[data-case]').evaluateAll(els => els.map(e => e.dataset.case))
  for (const id of cases) {
    await page.locator(`[data-case="${id}"]`).screenshot({ path: join(outDir, `chart-${id}.png`) })
  }
  console.log(`wrote ${cases.length} tiles`)
  // The audit is also the guard. A widget that THROWS renders nothing and takes
  // its tile down with it — which is exactly how the gauge crash hid: it only
  // appears when the widget is given what the server really returns for its
  // query shape (an aggregate, with no rows), and never in a harness that hands
  // every widget rows.
  let failed = 0
  if (errors.length) { failed++; console.error(`  ✗ PAGE ERRORS: ${errors.join(' · ')}`) }
  else console.log('  ✓ no widget threw')
  if (cases.length !== TYPES_EXPECTED) {
    failed++
    console.error(`  ✗ rendered ${cases.length} tiles, expected ${TYPES_EXPECTED}`)
  } else console.log(`  ✓ all ${cases.length} widget types rendered`)
  // Every tile must have drawn SOMETHING. A silently blank widget is the other
  // way this fails, and it does not raise a page error.
  const blank = []
  for (const id of cases) {
    const painted = await page.locator(`[data-case="${id}"]`).evaluate(el =>
      !!el.querySelector('canvas, svg, table') || (el.innerText || '').replace(/\s/g, '').length > 2)
      // A metric tile is legitimately just "41 ROWS" — six characters. The bar
      // is "did it draw anything at all", not "is it wordy".
    if (!painted) blank.push(id)
  }
  if (blank.length) { failed++; console.error(`  ✗ blank tiles: ${blank.join(', ')}`) }
  else console.log('  ✓ every tile painted')
  process.exitCode = failed === 0 ? 0 : 1
} finally {
  await browser.close(); await server.close()
}
