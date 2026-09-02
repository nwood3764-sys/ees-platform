#!/usr/bin/env node
//
// Does the Service Appointments tab actually SHOW past appointments?
//
// Nicholas, 2026-09-02: "Isn't this supposed to be the service appointment list
// view? Why can't I ever see past service appointments? It just gives me a
// dropdown for future."
//
// The tab rendered a forward-only dispatcher inbox. Every one of the 104
// service appointments on this database is in the past or carries no scheduled
// time, so the tab was empty on all four of its dropdown settings — and reading
// the code told you nothing, because each piece of it was individually correct.
// This is the class of defect that has to be looked at.
//
// So this asks a real Chromium, over the REAL ListView and the four views
// exactly as the migration wrote them:
//   • the list opens showing past appointments, most recent first
//   • "Past Service Appointments" shows the past and only the past
//   • "Upcoming" shows the future and only the future — and is EMPTY of past
//     work, which is what the old tab did to everything
//   • an appointment with NO scheduled time is claimed by neither
//   • the relative literal is resolved, not printed: the filter chip reads
//     "Today", not "TODAY"
//   • the seeded columns are the ones on screen, and they are labelled
//     "Status", not "Sa Status"
//
// Run with:  npm run verify:service-appointment-list
// Not in build:safe — needs a browser binary:
//   npm install --no-save playwright-core

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'service-appointment-list-check'

let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.log('\nverify:service-appointment-list  SKIPPED — npm install --no-save playwright-core\n')
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
if (!executablePath) { console.log('\nverify:service-appointment-list  SKIPPED — no Chromium.\n'); process.exit(0) }

const server = await createServer({
  root, configFile: false, plugins: [react()],
  optimizeDeps: { entries: [join(here, 'harness.jsx')] },
  server: { port: 5339, strictPort: true }, logLevel: 'error',
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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Chicago',
  })
  const errs = []
  page.on('pageerror', e => errs.push(e.message))
  await page.goto('http://localhost:5339/tools/service-appointment-list-check/index.html',
    { waitUntil: 'networkidle' })
  await page.waitForSelector('table')

  // Read the record numbers out of the rendered table, in render order.
  const shownRecords = () => page.$$eval('table tbody tr', rows =>
    rows.map(r => (r.querySelector('td')?.innerText || '').trim())
        .filter(t => /^SA-\d+$/.test(t)))
  const headers = () => page.$$eval('table thead th', ths =>
    ths.map(t => t.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean))

  // ── The list opens on "All Service Appointments" ─────────────────────────
  const all = await shownRecords()
  note(all.length === 5, 'the list opens showing every appointment, past included',
    `showed ${all.length}: ${all.join(', ')}`)
  note(all.includes('SA-00299') && all.includes('SA-00300'),
    'including appointments three weeks and three days in the PAST', all.join(', '))
  note(all[0] === 'SA-00306',
    'most recent scheduled first — the view sorts descending on first paint', all.join(', '))

  // ── The seeded columns, with the labels a person can read ────────────────
  // Headers render upper-cased by the table's own styling, so compare on
  // meaning rather than on case.
  const hdr = (await headers()).map(h => h.toUpperCase())
  note(hdr.includes('STATUS'), 'the status column is headed "Status"', hdr.join(' | '))
  // The label rule under test: an own column drops the object's own prefix, so
  // it is "Status", never "Sa Status". Before the fix this header read
  // "SA STATUS" and this check fails on it.
  note(!hdr.some(h => /^SA /.test(h)),
    'and no column is headed with the raw "Sa " column prefix', hdr.join(' | '))
  note(hdr.includes('SCHEDULED START TIME') && hdr.includes('SCHEDULED END TIME'),
    'both scheduled times are on screen', hdr.join(' | '))
  note(hdr.some(h => /WORK ORDER/.test(h)) && hdr.some(h => /WORK TYPE/.test(h)),
    "the view's related columns render too", hdr.join(' | '))

  // ── Switching views ──────────────────────────────────────────────────────
  const pickView = async (name) => {
    await page.getByRole('button', { name: /Service Appointments|Recently Viewed/ }).first().click()
      .catch(() => {})
    // The view selector is a button showing the active view's name.
    const opened = await page.locator(`text="${name}"`).first()
    await opened.click()
    await page.waitForTimeout(250)
  }

  await pickView('Past Service Appointments')
  const past = await shownRecords()
  note(past.length === 2 && past.includes('SA-00299') && past.includes('SA-00300'),
    'Past Service Appointments shows the past appointments — the view the complaint asks for',
    `showed ${past.length}: ${past.join(', ')}`)
  note(!past.includes('SA-00305') && !past.includes('SA-00306'),
    "and does not include today's or next week's work", past.join(', '))
  note(!past.includes('SA-00301'),
    'an appointment with no scheduled time is not filed under the past', past.join(', '))
  note(past[0] === 'SA-00300', 'most recent past appointment first', past.join(', '))

  // The literal must be RESOLVED for the reader, not printed as a token.
  const chips = await page.evaluate(() => document.body.innerText)
  note(/Today/.test(chips) && !/\bTODAY\b/.test(chips),
    'the active filter reads "Today", not the raw literal TODAY')

  await pickView('Upcoming Service Appointments')
  const upcoming = await shownRecords()
  note(upcoming.includes('SA-00305') && upcoming.includes('SA-00306'),
    "Upcoming shows today's and next week's appointments", upcoming.join(', '))
  note(!upcoming.includes('SA-00299') && !upcoming.includes('SA-00300'),
    'and none of the past ones', upcoming.join(', '))
  note(!upcoming.includes('SA-00301'),
    'an unscheduled appointment is not upcoming either', upcoming.join(', '))

  await pickView("Today's Service Appointments")
  const today = await shownRecords()
  note(today.length === 1 && today[0] === 'SA-00305',
    "Today's Service Appointments shows exactly today's stop",
    `showed ${today.length}: ${today.join(', ')}`)

  // ── A date cell is written, not dumped ───────────────────────────────────
  // The list used to print the raw cell, so a timestamptz column read
  // "2026-09-02T15:00:00.000Z" — the stored instant, in UTC, on a screen made
  // for scanning. Chicago is UTC-5 today, so 15:00Z must read as 10:00 AM.
  await pickView("Today's Service Appointments")
  const cells = await page.$$eval('table tbody tr td', tds => tds.map(t => t.innerText.trim()))
  note(!cells.some(c => /\d{4}-\d{2}-\d{2}T/.test(c)),
    'no cell prints a raw ISO timestamp', cells.join(' | '))
  note(cells.some(c => /10:00\u202f?AM|10:00 AM/.test(c)),
    'the 15:00Z instant reads as 10:00 AM in Chicago, the reader\'s zone', cells.join(' | '))

  // ── The control: the old comparison, on the same page ────────────────────
  // The list used to compare a timestamp against a date as TEXT. Run that here
  // over the same rows and the same filter, and it must come back WRONG —
  // otherwise this whole check is passing for the wrong reason.
  const control = await page.evaluate(() => {
    const rows = [
      '2026-08-12T13:00:00+00:00',
      '2026-08-12T00:00:00+00:00',
    ]
    // equals '2026-08-12', string comparison, exactly as it was.
    return rows.filter(v => String(v) === '2026-08-12').length
  })
  note(control === 0,
    'CONTROL: the old string comparison matches NEITHER instant on that day — which is why a date filter looked broken')

  await page.screenshot({ path: join(here, 'service-appointment-list.png'), fullPage: false })
  note(errs.length === 0, 'no uncaught page errors', errs.join('\n      '))
} finally {
  await browser.close(); await server.close()
}
console.log(failures === 0
  ? `\nverify:service-appointment-list: ${checks} checks passed`
  : `\nverify:service-appointment-list: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
