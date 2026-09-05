#!/usr/bin/env node
//
// Does dropping a Manual J on the card actually do anything, in a real browser?
//
// Two things here can only fail in a browser, and both fail SILENTLY:
//
//   1. The drop / file-input handlers. On 2026-09-02 a work-step photo upload
//      read `e.target.files` and then cleared the input — clearing empties the
//      live FileList you are holding, so the loop ran zero times, no error, no
//      spinner, nothing. Technicians closed steps as "Photo does not upload"
//      for eleven days. Every line of it read correctly.
//   2. pdf.js. It loads as an ES module from a CDN and runs a worker; nothing
//      in Node exercises the path the browser actually takes.
//
// So this drives the REAL card with the REAL 2506 Frazier Ave report — once by
// dropping it, once through the hidden input — and requires the review panel to
// come back with the numbers the fixture pins. Alongside it, the pre-fix
// handler shape runs on the same page as a CONTROL that must still see zero
// files: if that ever passes, this harness is not reproducing a browser and
// every PASS beside it is worthless.
//
// Run with:  npm run verify:manual-j-drop
// Not in build:safe — needs a browser binary and the pdf.js CDN.
//   npm install --no-save playwright-core

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'manual-j-drop-check'

const PDF = join(here, 'manual-j-report.pdf')
if (!existsSync(PDF)) {
  console.log('\nverify:manual-j-drop  SKIPPED — tools/manual-j-drop-check/manual-j-report.pdf is missing\n')
  process.exit(0)
}

let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.log('\nverify:manual-j-drop  SKIPPED — npm install --no-save playwright-core\n')
  process.exit(0)
}

// The same pdf.js build the app loads from the CDN, served locally.
const PDFJS_MODULE = join(root, 'node_modules/pdfjs-dist/build/pdf.min.mjs')
const PDFJS_WORKER = join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
if (!existsSync(PDFJS_MODULE) || !existsSync(PDFJS_WORKER)) {
  console.log('\nverify:manual-j-drop  SKIPPED — npm install --no-save pdfjs-dist@4.0.379\n')
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
if (!executablePath) { console.log('\nverify:manual-j-drop  SKIPPED — no Chromium.\n'); process.exit(0) }

// Swap only the database. The card, its inputs, its handlers, pdf.js, the
// layout pass and the parser are all the shipped ones.
function stubPlugin() {
  const target = join('src', 'data', 'manualJService.js')
  const stub = join(here, 'manualJServiceStub.js')
  return {
    name: 'manual-j-drop-check-stubs',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || source.startsWith('\0')) return null
      if (!/manualJService/.test(source)) return null
      if (importer === stub) return null           // the stub re-exports the real one
      const r = await this.resolve(source, importer, { skipSelf: true })
      if (!r) return null
      return r.id.endsWith(target) ? stub : null
    },
  }
}

const server = await createServer({
  root, configFile: false,
  plugins: [react(), stubPlugin()],
  optimizeDeps: { entries: [join(here, 'harness.jsx')] },
  server: { port: 5341, strictPort: true }, logLevel: 'error',
})
await server.listen()

let failures = 0, checks = 0
const note = (ok, label, detail) => {
  checks += 1
  if (ok) console.log(`PASS  ${label}`)
  else { failures += 1; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}

const pdfBytes = readFileSync(PDF)
// pdf.js is fetched from the CDN at runtime, exactly as the app does it. In a
// sandbox whose outbound HTTPS goes through a proxy, Chromium has to be told
// about it or the import fails with ERR_TUNNEL_CONNECTION_FAILED and the check
// looks like a broken drop handler.
const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy || null
const browser = await chromium.launch({
  executablePath,
  ...(proxyServer ? { proxy: { server: proxyServer, bypass: 'localhost,127.0.0.1' } } : {}),
})
try {
  const page = await browser.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(e.message))

  // pdf.js is served from the identical local build rather than fetched from
  // cdnjs. The app's own loader, its version, its worker and every byte it
  // parses are unchanged — only where the module came from differs, and a CDN
  // that is unreachable (a locked-down network, an offline laptop) would
  // otherwise make this read as a broken drop handler, which is precisely the
  // failure it exists to detect.
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', route => {
    const file = route.request().url().endsWith('pdf.worker.min.mjs') ? PDFJS_WORKER : PDFJS_MODULE
    route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(file) })
  })

  await page.goto('http://localhost:5341/tools/manual-j-drop-check/index.html', { waitUntil: 'networkidle' })
  await page.waitForSelector('input[type="file"]', { state: 'attached' })

  // ── the drop path ────────────────────────────────────────────────────────
  // A real DragEvent carrying a real File, built in the page, on the real zone.
  await page.evaluate(async (b64) => {
    const bin = atob(b64)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    const file = new File([buf], 'Manual_J_Report_2506_Frazier_Ave.pdf', { type: 'application/pdf' })
    const dt = new DataTransfer()
    dt.items.add(file)
    // The drop zone is the input's PARENT. Picking the first div that merely
    // CONTAINS the text lands on an ancestor, and an event dispatched there
    // never reaches the handler below it — events bubble up, not down.
    const zone = document.querySelector('input[type=file]').parentElement
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, pdfBytes.toString('base64'))

  // pdf.js fetches its module and worker from the CDN, then reads 38 pages.
  await page.waitForSelector('text=Which load is this building sized to?', { timeout: 60000 })
  note(true, 'dropping the report opens the review panel — the drop handler saw the file')

  const body = await page.textContent('body')
  note(/1 Story Handicap End Unit With Basement/.test(body),
    'the review panel names the subject read off the PDF')
  note(/2506 Frazier Ave, Madison, WI 53713/.test(body), 'and its address')
  note(/DANE COUNTY REGIONAL AP, WI/.test(body), 'and the weather station')
  note(/-1°F outdoor/.test(body), 'and the winter design temperature')

  // The candidates, and the double count stated with its arithmetic.
  note(/Whole building/.test(body) && /Whole Home, exactly as printed/.test(body),
    'both the corrected and the printed whole-home loads are offered')
  note(/29,882 Btu\/h heating/.test(body), 'the corrected building load is shown')
  note(/46,735 Btu\/h heating/.test(body), 'the printed load is shown too, not hidden')
  note(/16,853 Btu\/h of it is the same load twice/.test(body),
    'and the double count is stated with its arithmetic')
  note(/Counts shared rooms twice/.test(body), 'the printed figure carries its warning badge')

  // The recommended one is preselected, and it is NOT the printed one.
  const preselected = await page.evaluate(() => {
    const radios = [...document.querySelectorAll('input[name="manual-j-basis"]')]
    const on = radios.find(r => r.checked)
    return on ? on.closest('label').textContent : null
  })
  note(preselected && /Whole building/.test(preselected) && !/exactly as printed/.test(preselected),
    'the corrected load is preselected, never the printed one', preselected)

  // The NEEP fields are filled from the report; the year is not invented.
  const loadField = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('div')]
    const l = labels.find(d => d.textContent.trim() === 'Heating design load (Btu/h)')
    return l && l.parentElement.querySelector('input')?.value
  })
  note(loadField === '29882', 'the heating design load field is filled from the report', loadField)

  const yearField = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('div')]
    const l = labels.find(d => d.textContent.trim() === 'Home construction year')
    return l && l.parentElement.querySelector('input')?.value
  })
  note(yearField === '', 'the construction year is left EMPTY — a Manual J does not carry one', yearField)
  note(/Not on the Manual J and not on this building in LEAP/.test(body),
    'and the screen says why it is empty rather than leaving a blank box')
  note(/Still needed for equipment selection: Home construction year/.test(body),
    'the missing field is named before saving')

  // Choosing a different basis moves the number.
  await page.evaluate(() => {
    const radios = [...document.querySelectorAll('input[name="manual-j-basis"]')]
    const printed = radios.find(r => /exactly as printed/.test(r.closest('label').textContent))
    printed.click()
  })
  await page.waitForTimeout(150)
  const afterSwitch = await page.evaluate(() => {
    const l = [...document.querySelectorAll('div')].find(d => d.textContent.trim() === 'Heating design load (Btu/h)')
    return l && l.parentElement.querySelector('input')?.value
  })
  note(afterSwitch === '46735', 'choosing the printed basis moves the design load to it', afterSwitch)

  // Save hands over the reviewed values AND the whole parse.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Save to this assessment/.test(x.textContent))
    b.click()
  })
  await page.waitForFunction(() => window.__saved, null, { timeout: 15000 })
  const saved = await page.evaluate(() => window.__saved)
  note(saved.blockCount === 17, 'all 17 load blocks are handed to the save', String(saved.blockCount))
  note(saved.materialCount === 14, 'and all 14 building assemblies', String(saved.materialCount))
  note(saved.values.designHeatingLoadBtuh === '46735' || saved.values.designHeatingLoadBtuh === 46735,
    'the load SAVED is the one the reviewer chose, not the one first proposed',
    String(saved.values.designHeatingLoadBtuh))
  note(saved.values.designLoadBasisId === 'whole_home_as_printed',
    'and the basis they chose on is saved with it', saved.values.designLoadBasisId)
  note(/\.pdf$/.test(saved.fileName || ''), 'the PDF goes with it as the evidence artifact', saved.fileName)

  // ── the hidden-input path, and the CONTROL ───────────────────────────────
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('input[type="file"]', { state: 'attached' })
  await page.setInputFiles('input[type="file"]', PDF)
  await page.waitForSelector('text=Which load is this building sized to?', { timeout: 60000 })
  note(true, 'choosing the file through the hidden input opens the same review panel')

  // CONTROL: the pre-fix ordering, on a real input with a real file. It must
  // still come back with zero files, or this harness is not reproducing a live
  // FileList and nothing above it means anything.
  const controlSaw = await page.evaluate(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    document.body.appendChild(input)
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'x.pdf', { type: 'application/pdf' }))
    input.files = dt.files
    const live = input.files      // hold the LIVE list, as the 2026-08-22 code did
    input.value = ''              // …then clear the input, which empties it
    return live.length
  })
  note(controlSaw === 0,
    'CONTROL: clearing the input before snapshotting it really does empty the FileList',
    `saw ${controlSaw} files — the harness is not reproducing a live FileList`)

  note(errs.length === 0, 'no uncaught page errors', errs.join('\n      '))
} finally {
  await browser.close(); await server.close()
}
console.log(failures === 0
  ? `\nverify:manual-j-drop: ${checks} checks passed`
  : `\nverify:manual-j-drop: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
