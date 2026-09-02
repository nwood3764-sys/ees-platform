#!/usr/bin/env node
//
// Does a datetime field actually accept a value in a real browser?
//
// Until 2026-09-02 no datetime field in LEAP was editable at all. The fix adds
// an <input type="datetime-local">, and that input has one unforgiving rule: a
// value it cannot parse is DISCARDED and the control renders blank — the exact
// symptom being fixed. A Node unit test cannot see that; only a browser can.
//
// So this asks a real Chromium, with the timezone forced so the assertions mean
// something:
//   • the input ACCEPTS what toDatetimeLocal produces (value survives)
//   • it shows LOCAL wall-clock, not UTC (8:00, not 13:00)
//   • typing into it stores the right instant back
//   • clearing it stores null rather than an empty string
//
// Run with:  npm run verify:datetime-field
// Not in build:safe — needs a browser binary.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'datetime-field-check'

let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.log('\nverify:datetime-field  SKIPPED — npm install --no-save playwright-core\n')
  process.exit(0)
}
function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) return null
  for (const e of readdirSync(base)) {
    const p = join(base, e, 'chrome-linux/chrome')
    if (e.startsWith('chromium') && !e.includes('headless_shell') && existsSync(p)) return p
  }
  return null
}
const executablePath = findChromium()
if (!executablePath) { console.log('\nverify:datetime-field  SKIPPED — no Chromium.\n'); process.exit(0) }

const server = await createServer({
  root, configFile: false, plugins: [react()],
  optimizeDeps: { entries: [join(here, 'harness.jsx')] },
  server: { port: 5331, strictPort: true }, logLevel: 'error',
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
  // The zone the technicians are in. A browser in UTC would hide the whole bug.
  const page = await browser.newPage({ timezoneId: 'America/Chicago' })
  const errs = []
  page.on('pageerror', e => errs.push(e.message))
  await page.goto('http://localhost:5331/tools/datetime-field-check/index.html', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-test="dt"]')

  const shown = await page.inputValue('[data-test="dt"]')
  note(shown !== '', 'the input ACCEPTED the value — it is not blank', `value was ${JSON.stringify(shown)}`)
  note(shown === '2026-09-02T08:00',
    'and shows LOCAL wall-clock (8:00 AM in Appleton), not the 13:00 UTC instant', shown)

  // Type a new time the way a person would.
  await page.fill('[data-test="dt"]', '2026-09-03T14:30')
  await page.waitForTimeout(120)
  const stored = await page.textContent('[data-test="stored"]')
  note(stored === '2026-09-03T19:30:00.000Z',
    'typing 2:30 PM local stores the matching UTC instant', stored)
  note(await page.inputValue('[data-test="dt"]') === '2026-09-03T14:30',
    'and the input still reads back what was typed')

  // Clearing must store null, not ''.
  await page.fill('[data-test="dt"]', '')
  await page.waitForTimeout(120)
  note((await page.textContent('[data-test="stored"]')) === 'NULL',
    'clearing the field stores null, not an empty string')

  note(errs.length === 0, 'no uncaught page errors', errs.join('\n      '))
} finally {
  await browser.close(); await server.close()
}
console.log(failures === 0
  ? `\nverify:datetime-field: ${checks} checks passed`
  : `\nverify:datetime-field: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
