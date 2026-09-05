#!/usr/bin/env node
//
// Can a customer actually click the Sign box?
//
// Nicholas, on the live signing link for ENV-00016: "I can't click Sign. I
// can't do anything. The customer should be able to click the blue box and
// then click Sign." The date box beside it was filled and green.
//
// SigningPortal rendered one overlay layer PER TAB, each spanning the whole
// PDF page (inset: 0) and each turning pointer-events back ON. Layers stack in
// append order, so the LAST tab's transparent full-page layer sat on top of
// every marker before it. ENV-00016's two tabs sit at the SAME y — signature
// at x=20, date at x=334, both 26pt tall on page 1 — so the date's layer
// covered the signature marker outright. Clicking Sign landed on a transparent
// div with no handler and did nothing, while the date, a child of the topmost
// layer, filled fine.
//
// Every line of that CSS reads correctly. Which element owns a pixel is a fact
// about boxes a browser laid out, so this asks one:
//
//   real         the REAL TabOverlays out of src/pages/SigningPortal.jsx,
//                given the REAL ENV-00016 tab geometry read off production,
//                over the page wrap the real mounting code builds. Playwright
//                clicks each marker's centre with a real mouse.
//
//   CONTROL-old  the pre-fix layering on the same page. Its signature marker
//                MUST stay unclickable. If it ever becomes clickable, this
//                harness is not reproducing the defect and every PASS beside
//                it means nothing.
//
// Run with:  npm run verify:signing-tab-click
//
// Not part of `npm run build:safe`: it needs a browser binary. The build gate
// is scripts/open-signature-requests-fixture.mjs and the pure rules beside it;
// this tool is what proves the component behaves the way they assume.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'signing-tab-click-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log('\nverify:signing-tab-click  SKIPPED — nothing was verified.\n\n  npm install --no-save playwright-core\n  npm run verify:signing-tab-click\n')
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
  console.log('\nverify:signing-tab-click  SKIPPED — no Chromium under PLAYWRIGHT_BROWSERS_PATH.\n')
  process.exit(0)
}

const server = await createServer({
  root, configFile: false,
  plugins: [react()],
  optimizeDeps: { entries: [join(here, 'harness.jsx')] },
  server: { port: 5331, strictPort: true }, logLevel: 'error',
})
await server.listen()

let failures = 0, checks = 0
const check = (name, ok, detail = '') => {
  checks++
  if (ok) console.log(`PASS  ${name}`)
  else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const rel = '/' + join('tools', 'signing-tab-click-check', 'index.html').split('\\').join('/')
await page.goto(`http://localhost:5331${rel}`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-test="real-panel"] [data-signing-tab]', { timeout: 15000 })

// A real mouse click at the centre of a marker. Scroll first: an element below
// the fold has a box outside the viewport and the click lands nowhere, which
// reads exactly like the defect.
async function clickCentre(sel) {
  const el = await page.$(sel)
  if (!el) return false
  await el.scrollIntoViewIfNeeded()
  const box = await el.boundingBox()
  if (!box) return false
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  return true
}

// ── The real component, the real geometry ──────────────────────────────────
const rendered = await page.$$eval('[data-test="real-panel"] [data-signing-tab]',
  els => els.map(e => e.getAttribute('data-signing-tab-type')))
check('the real TabOverlays renders both ENV-00016 tabs',
  rendered.length === 2 && rendered.includes('signature') && rendered.includes('date'),
  `got ${JSON.stringify(rendered)}`)

// Which element actually owns the pixel a customer aims at.
for (const type of ['signature', 'date']) {
  const owns = await page.evaluate((t) => {
    const el = document.querySelector(`[data-test="real-panel"] [data-signing-tab-type="${t}"]`)
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit === el || el.contains(hit)
  }, type)
  check(`the ${type} marker owns its own centre pixel`, owns === true)
}

await page.evaluate(() => { window.__realClicks = [] })
await clickCentre('[data-test="real-panel"] [data-signing-tab-type="signature"]')
await clickCentre('[data-test="real-panel"] [data-signing-tab-type="date"]')
const realClicks = await page.evaluate(() => window.__realClicks)
check('clicking the Sign box fires the real onTabClick', realClicks.includes('ETAB-00006'),
  `clicks seen: ${JSON.stringify(realClicks)}`)
check('clicking the Date box fires it too', realClicks.includes('ETAB-00007'))
check('BOTH boxes are reachable, not just the last one', realClicks.length === 2)

// The layer must never take pointer events — that is the whole rule.
const layerInert = await page.evaluate(() => {
  const el = document.querySelector('[data-test="real-panel"] [data-signing-tab-type="signature"]')
  return getComputedStyle(el.parentElement).pointerEvents === 'none'
})
check('the overlay layer is inert (pointer-events:none)', layerInert === true)

const oneLayer = await page.evaluate(() => {
  const els = [...document.querySelectorAll('[data-test="real-panel"] [data-signing-tab]')]
  return new Set(els.map(e => e.parentElement)).size === 1
})
check('all markers on the page share ONE layer', oneLayer === true)

// ── CONTROL: the pre-fix layering must still be broken ─────────────────────
await page.evaluate(() => { window.__ctlClicks = [] })
await clickCentre('[data-test="control-panel"] [data-signing-tab="ctl-ETAB-00006"]')
await clickCentre('[data-test="control-panel"] [data-signing-tab="ctl-ETAB-00007"]')
const ctlClicks = await page.evaluate(() => window.__ctlClicks)
check('CONTROL: the pre-fix layering STILL swallows the signature click',
  !ctlClicks.includes('ETAB-00006'), `clicks seen: ${JSON.stringify(ctlClicks)}`)
check('CONTROL: the pre-fix layering still lets the LAST tab through',
  ctlClicks.includes('ETAB-00007'))

const ctlOwns = await page.evaluate(() => {
  const el = document.querySelector('[data-test="control-panel"] [data-signing-tab="ctl-ETAB-00006"]')
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return hit === el || el.contains(hit)
})
check('CONTROL: the pre-fix signature marker still does not own its pixel', ctlOwns === false)

await browser.close()
await server.close()

console.log(`\nverify:signing-tab-click: ${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
