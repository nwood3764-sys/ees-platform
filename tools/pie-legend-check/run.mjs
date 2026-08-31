#!/usr/bin/env node
// Screenshots the real pie widget so a claim about legibility can be checked by
// LOOKING at it. Run: node tools/pie-legend-check/run.mjs [outDir]
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outDir = process.argv[2] || root
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'pie-legend-check'

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

const server = await createServer({
  root, plugins: [react()], configFile: false,
  server: { port: 5313, strictPort: true }, logLevel: 'error',
})
await server.listen()
const browser = await chromium.launch({ executablePath })
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 1900 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:5313/tools/pie-legend-check/', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-case="wide"] canvas', { timeout: 20000 })
  // The chart resizes through a ResizeObserver, which fires asynchronously —
  // screenshotting too early photographs the canvas at its PREVIOUS size, which
  // reads as a clipped pie and sends you looking for a layout bug that is not
  // there.
  await page.waitForTimeout(1500)
  for (const id of ['wide', 'narrow', 'tiny', 'donut', 'bottom']) {
    await page.locator(`[data-case="${id}"]`).screenshot({ path: join(outDir, `pie-${id}.png`) })
    console.log(`wrote ${join(outDir, `pie-${id}.png`)}`)
  }
  console.log(errors.length ? `PAGE ERRORS: ${errors.join(' · ')}` : 'no page errors')
} finally {
  await browser.close(); await server.close()
}
