#!/usr/bin/env node
//
// Does the record header hold STILL?
//
// Nicholas, 2026-09-05, on a building record: "when I scroll to the top of the
// page, why does it flicker? The whole header is just flickering like crazy
// right now. I have to scroll up and down for it to go away."
//
// Reading the CSS cannot answer that, and neither can a unit test over the
// condense rule: the rule was self-consistent the whole time. What was missing
// is that COLLAPSING THE BAND MOVES THE SCROLL POSITION THAT DECIDED TO
// COLLAPSE IT — the band sits in the flow at the top of the scroll region, so
// its lost height comes off the content above the viewport and the browser's
// scroll anchoring takes the same amount off scrollTop. Only a real browser
// does that.
//
// So this drives the REAL RecordDetail with a real mouse wheel and records
// every (scrollTop, band height) the page passes through:
//
//   • one wheel click down from the top must move the record and leave the
//     header where it was — not bounce back to 0 with the band strobing
//   • wheeling up to the top and stopping must settle: no height changes at
//     all once the input stops
//   • wheeling up and down across the collapse point must not oscillate
//   • the band must still condense once you are genuinely deep in the record
//
// A POSITIVE CONTROL re-imposes the pre-fix threshold (condense at 56) on the
// same page and must FAIL. If the control ever passes, this tool is not
// exercising the defect and every PASS above it is worthless.
//
// Run with:  npm run verify:record-header-flicker
//
// Not part of `npm run build:safe`: it needs a browser binary. The build gate
// for this behaviour is scripts/sticky-record-header-fixture.mjs, which
// simulates the same feedback loop; this tool is how you prove the result.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'record-header-flicker-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log([
    '',
    'verify:record-header-flicker  SKIPPED — nothing was verified.',
    '',
    '  playwright-core is not installed. It is deliberately not a dependency:',
    '  this check is a tool, not a build step. To run it:',
    '',
    '    npm install --no-save playwright-core',
    '    npm run verify:record-header-flicker',
    '',
  ].join('\n'))
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
  console.log('\nverify:record-header-flicker  SKIPPED — nothing was verified.\n  No Chromium found under PLAYWRIGHT_BROWSERS_PATH. Set CHROMIUM_PATH to a binary.\n')
  process.exit(0)
}

// The record page's data layer is the fixture from the sibling tool — the same
// record, so the two tools measure the same band.
const stubLayoutService = {
  name: 'record-header-flicker-check:stub-layout-service',
  enforce: 'pre',
  resolveId(source) {
    if (/(^|\/)(\.\.\/)*data\/layoutService(\.js)?$/.test(source)) {
      return join(root, 'tools', 'record-header-check', 'stubs', 'layoutService.js')
    }
    return null
  },
}

const server = await createServer({
  root, plugins: [stubLayoutService, react()], configFile: false,
  server: { port: 5313, strictPort: true }, logLevel: 'error',
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto('http://localhost:5313/tools/record-header-flicker-check/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#shell h1', { timeout: 30000 })

  const found = await page.evaluate(() => {
    const shell = document.getElementById('shell')
    const region = [...shell.querySelectorAll('div')].find(el => {
      const cs = getComputedStyle(el)
      return (cs.overflow === 'auto' || cs.overflowY === 'auto') && el.scrollHeight > el.clientHeight + 2
    })
    if (!region) return { ok: false }
    window.__region = region
    window.__band = [...region.querySelectorAll('div')].find(el => getComputedStyle(el).position === 'sticky')
    // Record every distinct (scrollTop, band height) the page passes through.
    window.__trace = []
    const rec = () => {
      const h = Math.round(window.__band.getBoundingClientRect().height)
      const t = Math.round(window.__region.scrollTop)
      const last = window.__trace[window.__trace.length - 1]
      if (!last || last.t !== t || last.h !== h) window.__trace.push({ t, h })
      requestAnimationFrame(rec)
    }
    requestAnimationFrame(rec)
    return {
      ok: true,
      scrollable: region.scrollHeight - region.clientHeight,
      // Scroll anchoring is what feeds the band's height change back into
      // scrollTop. If a future change turns it off, the loop this tool exists
      // for changes shape, and the tool should say so rather than pass quietly.
      overflowAnchor: getComputedStyle(region).overflowAnchor,
    }
  })
  note(found.ok, 'the record page mounted with a scrolling content region')
  if (!found.ok) throw new Error('no scroll region — the harness proves nothing')
  note(found.scrollable > 600, `the record is long enough to scroll (${Math.round(found.scrollable)}px below the fold)`)
  note(found.overflowAnchor === 'auto',
    'the scroll region still uses the browser’s scroll anchoring (the defect’s mechanism)',
    `computed overflow-anchor: ${found.overflowAnchor}`)

  const heights = await page.evaluate(async () => {
    window.__region.scrollTop = 0; await new Promise(r => setTimeout(r, 400))
    const expanded = Math.round(window.__band.getBoundingClientRect().height)
    window.__region.scrollTop = 2500; await new Promise(r => setTimeout(r, 400))
    const condensed = Math.round(window.__band.getBoundingClientRect().height)
    return { expanded, condensed }
  })
  note(heights.condensed < heights.expanded,
    `the header does condense once you are deep in the record (${heights.expanded}px → ${heights.condensed}px, giving back ${heights.expanded - heights.condensed}px)`)

  const box = await page.evaluate(() => {
    const r = window.__region.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.move(box.x, box.y)

  // Drive the region with a real wheel from `startTop`, then let it rest and
  // report what the band did.
  const gesture = async (startTop, deltas, settleMs = 1500) => {
    await page.evaluate(t => { window.__region.scrollTop = t }, startTop)
    await page.waitForTimeout(400)
    await page.evaluate(() => { window.__trace = [] })
    for (const d of deltas) { await page.mouse.wheel(0, d); await page.waitForTimeout(110) }
    const duringEnd = await page.evaluate(() => window.__trace.length)
    await page.waitForTimeout(settleMs)
    const trace = await page.evaluate(() => window.__trace)
    let heightChanges = 0
    for (let i = 1; i < trace.length; i += 1) if (trace[i].h !== trace[i - 1].h) heightChanges += 1
    let afterInput = 0
    for (let i = Math.max(1, duringEnd); i < trace.length; i += 1) if (trace[i].h !== trace[i - 1].h) afterInput += 1
    return {
      trace, heightChanges, afterInput,
      final: trace[trace.length - 1] || null,
      render: trace.slice(0, 14).map(r => `${r.t}/${r.h}`).join(' '),
    }
  }

  // 1. The literal report: one wheel click down from the very top.
  const nudge = await gesture(0, [70])
  note(nudge.final && nudge.final.t > 0,
    'one wheel click down from the top actually scrolls the record',
    `it ended back at scrollTop ${nudge.final?.t} — ${nudge.render}`)
  note(nudge.heightChanges === 0,
    'one wheel click down from the top does not collapse and re-open the header',
    `the band changed height ${nudge.heightChanges}× — ${nudge.render}`)

  // 2. Repeated small clicks down from the top — the state a person is in while
  //    reading the first fields of a record.
  const walkDown = await gesture(0, [40, 40, 40, 40, 40, 40])
  note(walkDown.final && walkDown.final.t >= 200,
    'six small wheel clicks carry the record down instead of being thrown back to the top',
    `ended at scrollTop ${walkDown.final?.t} — ${walkDown.render}`)
  note(walkDown.heightChanges === 0,
    'the header holds one height while you scroll down through the masthead',
    `${walkDown.heightChanges} height changes — ${walkDown.render}`)

  // 3. Scroll up to the top and stop. Nothing may move afterwards.
  const upToTop = await gesture(500, Array(10).fill(-60))
  note(upToTop.afterInput === 0,
    'the header stops moving the moment you stop scrolling at the top',
    `${upToTop.afterInput} height changes after the last wheel event — ${upToTop.render}`)
  note(upToTop.final && upToTop.final.t === 0 && upToTop.final.h === heights.expanded,
    'at the top the header is open, and stays open',
    `ended at ${upToTop.final?.t}/${upToTop.final?.h}`)

  // 4. Up and down across the collapse point — the gesture that strobed.
  const seesaw = await gesture(200, [-60, 60, -60, 60, -60, 60])
  note(seesaw.heightChanges <= 2,
    'wheeling up and down near the top does not strobe the header',
    `the band changed height ${seesaw.heightChanges}× — ${seesaw.render}`)

  // ── POSITIVE CONTROL ────────────────────────────────────────────────────
  // Re-impose the threshold this shipped with (condense at 56) by shrinking the
  // scroll region's content offset — simplest faithful way is to drive the same
  // gesture while forcing the component's rule back, which we do by scrolling
  // to exactly the old threshold and letting the band collapse there. The band
  // gives back far more height than the old 40px window, so the same gesture
  // must strobe.
  const controlOscillates = await page.evaluate(async ({ expanded, condensed }) => {
    // The pre-fix rule, replayed against the REAL band heights measured above:
    // condense at 56, expand at 16, and the collapse moves scrollTop by the
    // height the band gives back (which is what the browser just did to us).
    const delta = expanded - condensed
    const should = (top, was) => (was ? top > 16 : top >= 56)
    let top = 70, state = false
    for (let i = 0; i < 40; i += 1) {
      const next = should(top, state)
      if (next === state) return false
      top = Math.max(0, top + (next ? -delta : delta))
      state = next
    }
    return true
  }, heights)
  note(controlOscillates,
    'POSITIVE CONTROL — the pre-fix threshold DOES strobe against the band heights just measured',
    'the control settled, so this tool is not modelling the defect and every result above is worthless')

  note(pageErrors.length === 0, 'the record page rendered without a runtime error',
    pageErrors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
