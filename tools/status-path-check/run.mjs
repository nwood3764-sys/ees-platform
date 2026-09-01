#!/usr/bin/env node
//
// Does the status path actually render its chevrons — and are the stage
// labels readable when it does?
//
// Nicholas, 2026-09-01, on an incentive application: "I don't think the
// chevrons are working on the incentive application page layout." Every
// incentive-application layout carries a status_path widget and the
// picklist_values_for_record_type RPC returns all nine stages, so nothing in
// the data explains it. Per the 2026-08-22 lesson (reading the code was not
// enough to see the lost section), the rendering half is checked in a real
// browser: measure every chevron, and read back how much of each label
// survives its box.
//
// Run with:  node tools/status-path-check/run.mjs
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
process.env.VITE_SUPABASE_ANON_KEY ||= 'status-path-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log('\nstatus-path-check  SKIPPED — nothing was verified.\n  npm install --no-save playwright-core\n')
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
  console.log('\nstatus-path-check  SKIPPED — no Chromium under PLAYWRIGHT_BROWSERS_PATH.\n')
  process.exit(0)
}

// Every module that reaches for the live client gets the stub instead. Aliasing
// on the resolved path does not work — Vite matches the import SPECIFIER, and
// the widget writes '../lib/supabase'.
function supabaseStubPlugin() {
  const stub = join(here, 'supabaseStub.js')
  return {
    name: 'status-path-supabase-stub',
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
  server: { port: 5321, strictPort: true }, logLevel: 'error',
})
await server.listen()

let failures = 0, checks = 0
const note = (ok, label, detail) => {
  checks += 1
  if (ok) console.log(`PASS  ${label}`)
  else { failures += 1; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}

const browser = await chromium.launch({ executablePath })

// The record page's main column at each of the platform's breakpoints. A path
// that only works on a wide desktop is not fixed — the strip is above the fold
// on a phone too.
const SURFACES = [
  { name: 'desktop', viewport: 1440, column: 1180 },
  { name: 'tablet',  viewport: 900,  column: 820 },
  { name: 'phone',   viewport: 390,  column: 350 },
]

try {
  for (const surface of SURFACES) {
    const page = await browser.newPage({ viewport: { width: surface.viewport, height: 900 } })
    page.on('pageerror', e => console.log('PAGE ERROR', e.message))
    await page.goto(`http://localhost:5321/tools/status-path-check/index.html?column=${surface.column}`)
    await page.waitForSelector('[data-chevron]', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(400)

    const seen = await page.evaluate(() => {
      const col = document.querySelector('[data-test="main-column"]')
      if (!col) return null
      const colWidth = col.clientWidth
      const measure = el => {
        const label = el.querySelector('span') || el
        return {
          label: el.getAttribute('title'),
          width: Math.round(el.getBoundingClientRect().width),
          top: Math.round(el.getBoundingClientRect().top),
          clipPath: getComputedStyle(el).clipPath,
          truncated: label.scrollWidth > label.clientWidth + 1,
          overflowsCard: Math.round(el.getBoundingClientRect().width) > colWidth + 1,
        }
      }
      return {
        colWidth,
        stages: [...col.querySelectorAll('[data-chevron]')].map(measure),
        actions: [...col.querySelectorAll('button')].map(b => b.textContent.trim()),
        // Anything on the card that announces the record's current status.
        currentStatusMentions: [...col.querySelectorAll('*')].filter(el =>
          el.children.length === 0 &&
          el.textContent.trim() === 'Incentive Application Submitted — Awaiting Program Response'
        ).length,
      }
    })

    const tag = `[${surface.name} ${surface.viewport}px]`
    note(seen && seen.stages.length === 9, `${tag} all nine stages render as chevrons`,
      seen ? `rendered ${seen.stages.length}` : 'no main column found')
    if (!seen || !seen.stages.length) { await page.close(); continue }

    await page.screenshot({ path: join(here, `status-path-${surface.name}.png`), fullPage: true })

    const rows = new Set(seen.stages.map(s => s.top)).size
    console.log(`\n  ${tag} ${rows} row(s), card ${seen.colWidth}px`)
    for (const s of seen.stages) {
      console.log(`  ${String(s.width).padStart(4)}px  ${s.truncated ? 'CUT ' : '    '}  ${s.label}`)
    }
    console.log('')

    // The defect: every stage but the current one was squeezed to 89px and its
    // label clipped at both ends. Desktop and tablet must show every stage in
    // full; a phone may ellipsis a long one, but nothing may burst the card.
    if (surface.name === 'phone') {
      note(seen.stages.every(s => !s.overflowsCard),
        `${tag} no chevron is wider than the card`,
        seen.stages.filter(s => s.overflowsCard).map(s => s.label).join(', '))
    } else {
      const cut = seen.stages.filter(s => s.truncated)
      note(cut.length === 0, `${tag} every stage label is readable in full`,
        cut.map(s => `${s.label} (${s.width}px)`).join(', '))
    }

    note(seen.stages.filter(s => s.clipPath && s.clipPath !== 'none').length >= seen.stages.length - 1,
      `${tag} the segments are chevron-shaped, not plain rectangles`)

    // One card, one status. The path used to sit above a second card whose
    // only job was to repeat the current status and offer these same buttons.
    note(seen.actions.length === 4,
      `${tag} the four permitted moves are offered inside the path card`,
      `found ${seen.actions.length}: ${seen.actions.join(' | ')}`)
    note(seen.currentStatusMentions === 1,
      `${tag} the current status is stated once, not twice`,
      `stated ${seen.currentStatusMentions} times`)

    // The checker itself, checked: the pre-fix geometry is on the page as a
    // positive control and must come back truncated. A check that passes both
    // shapes is measuring nothing.
    if (surface.name === 'desktop') {
      const legacyCut = await page.evaluate(() =>
        [...document.querySelectorAll('[data-legacy-chevron]')]
          .filter(el => el.scrollWidth > el.clientWidth + 1).length
      )
      note(legacyCut >= 8, `${tag} POSITIVE CONTROL — the pre-fix strip still fails this check`,
        `only ${legacyCut} of 9 legacy chevrons truncated`)
    }

    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}

console.log(`\nstatus-path-check  ${failures ? `${failures} FAILED` : 'all passed'}  (${checks} checks)\n`)
process.exit(failures ? 1 : 0)
