#!/usr/bin/env node
//
// Does a work step actually ACCEPT a photo?
//
// From 2026-08-22 to 2026-09-02 it did not, on the inline step card that
// Building Access, Machine and Dumpster Setup and every other non-guided work
// plan uses — on the phone AND on the work order record page's Work Plan tab.
// Nothing errored, nothing reached the server, and the spinner never even
// started. Technicians marked required evidence steps "Not Applicable — Photo
// does not upload" to get past a Complete button that would never enable.
//
// The cause was two lines in the wrong order — the handler kept the LIVE
// FileList and then cleared the input, which empties that same list — and the
// reason it survived eleven days is that reading the code tells you nothing.
// Both orderings look correct. Only a browser knows that `input.value = ''`
// reaches back into the list you are holding.
//
// So this asks a real Chromium, on the real component:
//
//   real         mount the REAL WorkOrderDetail on WO-00243 (the work order
//                Roman Rufino could not photograph), put a REAL file on the
//                step card's REAL hidden <input> with Playwright, and require
//                the file to arrive at the upload call. Only the network is
//                stubbed.
//
//   CONTROL-old  the pre-fix handler shape against its own real <input> on the
//                same page. It MUST see zero files. If this ever passes, the
//                browser is not behaving the way the defect requires and every
//                other result here is worthless.
//
// Run with:  npm run verify:photo-upload
//
// Not part of `npm run build:safe`: it needs a browser binary, and a deploy
// that depends on one breaks when the build image changes. The build gate is
// scripts/photo-input-event-fixture.mjs, which pins the ordering statically
// against a modelled FileList. This tool is what proves the model is right.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'photo-upload-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log([
    '',
    'verify:photo-upload  SKIPPED — nothing was verified.',
    '',
    '  playwright-core is not installed. It is deliberately not a dependency:',
    '  this check is a tool, not a build step. To run it:',
    '',
    '    npm install --no-save playwright-core',
    '    npm run verify:photo-upload',
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
  console.log('\nverify:photo-upload  SKIPPED — nothing was verified.\n  No Chromium under PLAYWRIGHT_BROWSERS_PATH. Set CHROMIUM_PATH to a binary.\n')
  process.exit(0)
}

// Swap only the network: the service modules the screen talks to. The
// component, the inputs and the handler under test are the shipped ones.
// Vite matches the import SPECIFIER, so this resolves then compares.
function stubPlugin() {
  const map = [
    [join('src', 'fieldMobile', 'fieldMobileService.js'), join(here, 'fieldMobileServiceStub.js')],
    [join('src', 'data', 'storageService.js'), join(here, 'storageServiceStub.js')],
  ]
  return {
    name: 'photo-upload-check-stubs',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || source.startsWith('\0')) return null
      if (!/fieldMobileService|storageService/.test(source)) return null
      const r = await this.resolve(source, importer, { skipSelf: true })
      if (!r) return null
      for (const [tail, stub] of map) if (r.id.endsWith(tail)) return stub
      return null
    },
  }
}

const server = await createServer({
  root, configFile: false,
  plugins: [react(), stubPlugin()],
  // Scan from the harness only. Left to itself the dep scanner crawls the whole
  // app and reports every export the two stubs do not have, which is noise:
  // nothing outside this screen is mounted.
  optimizeDeps: { entries: [join(here, 'harness.jsx')] },
  server: { port: 5326, strictPort: true }, logLevel: 'error',
})
await server.listen()

let failures = 0, checks = 0
const note = (ok, label, detail) => {
  checks += 1
  if (ok) console.log(`PASS  ${label}`)
  else { failures += 1; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}

// Real files on disk, because setInputFiles needs real bytes — and because a
// FileList of three is what "Dumpster Trailer Location Photos — Front, Side and
// Back" asks for, the step that sat at Photos: 0/3.
const dir = mkdtempSync(join(tmpdir(), 'leap-photo-check-'))
// A 1x1 JPEG: a real decodable image, so nothing downstream rejects it on
// content rather than on the bug under test.
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
const paths = []
for (const name of ['front.jpg', 'side.jpg', 'back.jpg']) {
  const p = join(dir, name)
  writeFileSync(p, JPEG_1PX)
  paths.push(p)
}
const notAPhoto = join(dir, 'delivery-note.pdf')
writeFileSync(notAPhoto, Buffer.from('%PDF-1.4\n%%EOF\n'))

const browser = await chromium.launch({ executablePath })
try {
  // A phone, because that is where the technician was standing.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto('http://localhost:5326/tools/photo-upload-check/index.html', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-test="control-old"]', { timeout: 20000 })

  // ── PREMISE ──────────────────────────────────────────────────────────────
  // Everything below depends on one browser behaviour. Prove it here, on a
  // real <input>, rather than assuming it.
  await page.setInputFiles('[data-test="control-old"]', paths[0])
  const premise = await page.evaluate(() => {
    const el = document.querySelector('[data-test="control-old"]')
    return { saw: window.__controlOldSaw, stillHasFiles: el.files.length }
  })
  note(premise.saw === 0,
    'CONTROL-old: the shipped-2026-08-22 handler sees ZERO files from a real picker',
    `it saw ${premise.saw} — the browser is not reproducing the defect, so nothing here is meaningful`)

  await page.setInputFiles('[data-test="control-new"]', paths[0])
  const fixed = await page.evaluate(() => window.__controlNewSaw)
  note(fixed === 1,
    'the same input, read in the fixed order, yields the file',
    `saw ${fixed}`)

  // ── The real component ───────────────────────────────────────────────────
  // Addressed by SELECTOR on every interaction, never by a handle held across a
  // re-render. A handle to a detached input accepts files and fires `change` at
  // an element React is no longer listening to — which is a real failure mode
  // this screen had (see WorkOrderShell) and would otherwise be mistaken here
  // for the bug under test.
  const CAMERA = '[data-test="real"] input[type="file"][accept="image/*"]:not([multiple])'
  const FOLDER = '[data-test="real"] input[type="file"][accept="image/*"][multiple]'

  const realInputs = await page.$$('[data-test="real"] input[type="file"][accept="image/*"]')
  note(realInputs.length >= 2,
    'the step card renders its camera AND folder inputs',
    `found ${realInputs.length}`)

  // One photo, camera leg.
  await page.setInputFiles(CAMERA, paths[0])
  await page.waitForFunction(() => window.__captured.length > 0, null, { timeout: 10000 })
    .catch(() => {})
  let got = await page.evaluate(() => window.__captured.slice())
  note(got.length === 1 && got[0].name === 'front.jpg',
    'a photo taken on the step card REACHES the upload call',
    JSON.stringify(got))
  note(got[0]?.workStepId === 'ws-key-checkout',
    'and it is filed against the step it was taken on, not the work order',
    JSON.stringify(got[0]))
  note(got[0]?.photoType === 'general',
    'tagged with the leg the button asked for')
  note(got[0]?.size > 0, 'with real bytes, not an empty file', `size ${got[0]?.size}`)

  // Three at once from the folder picker — the dumpster step's own shape.
  await page.evaluate(() => { window.__captured.length = 0 })
  await page.setInputFiles(FOLDER, paths)
  await page.waitForFunction(() => window.__captured.length >= 3, null, { timeout: 15000 })
    .catch(() => {})
  got = await page.evaluate(() => window.__captured.slice())
  note(got.length === 3,
    'all three of a Front / Side / Back folder pick arrive, in order',
    JSON.stringify(got.map(g => g.name)))
  note(got.map(g => g.name).join(',') === 'front.jpg,side.jpg,back.jpg',
    'and in the order they were chosen')

  // A non-image must be refused OUT LOUD. Silence here is the same class of
  // defect as the one being fixed.
  await page.evaluate(() => { window.__captured.length = 0 })
  await page.setInputFiles(FOLDER, notAPhoto)
  await page.waitForTimeout(900)
  const rejected = await page.evaluate(() => ({
    uploaded: window.__captured.length,
    said: /skipped|not an image|no photo/i.test(document.body.innerText),
    text: (document.body.innerText.match(/[^\n]*(skipped|not an image|No photo)[^\n]*/i) || [''])[0],
  }))
  note(rejected.uploaded === 0, 'a PDF on the photo picker is not uploaded as a photo')
  note(rejected.said, 'and the screen SAYS it was skipped instead of going quiet', rejected.text)

  // ── The input survives the screen re-rendering around it ─────────────────
  // Every toast, busy flag and completed step re-renders this screen while a
  // picker may be open. If a re-render replaces the <input>, the photo the
  // technician just chose fires `change` at a detached element and is lost with
  // no error — the same disappearance, from a different cause. So: force a
  // re-render (an upload's own toast does it), then upload again through the
  // SAME element node and require it to still be wired.
  await page.evaluate(() => {
    window.__captured.length = 0
    window.__inputNode = document.querySelector(
      '[data-test="real"] input[type="file"][accept="image/*"][multiple]')
  })
  // A toast IS a state change on this screen, and one happens after every
  // capture, every error and every completed step.
  await page.setInputFiles(FOLDER, notAPhoto)
  await page.waitForTimeout(500)
  const survived = await page.evaluate(() => ({
    sameNode: window.__inputNode === document.querySelector(
      '[data-test="real"] input[type="file"][accept="image/*"][multiple]'),
    stillInDocument: document.contains(window.__inputNode),
  }))
  note(survived.sameNode && survived.stillInDocument,
    'the file input is the SAME node after the screen re-renders around it',
    JSON.stringify(survived))

  // And a capture through that same, still-mounted node lands.
  await page.evaluate(() => { window.__captured.length = 0 })
  await page.setInputFiles(FOLDER, paths[0])
  await page.waitForFunction(() => window.__captured.length >= 1, null, { timeout: 10000 }).catch(() => {})
  const after = await page.evaluate(() => window.__captured.length)
  note(after === 1, 'and a photo chosen after all that still reaches the upload call', `uploaded ${after}`)

  // The refresh that follows a capture must not blank the screen either: a
  // non-silent reload replaces the step list with "Loading…", which is how an
  // in-flight batch lost its progress and a half-typed field its text.
  const blanked = await page.evaluate(() => /Loading…/.test(
    document.querySelector('[data-test="real"]')?.innerText || ''))
  note(!blanked, 'the step list is not replaced by "Loading…" after a capture')

  // ── Video belongs to Video steps (Nicholas, 2026-09-02) ──────────────────
  const videoButtons = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-test="real"] input[type="file"][accept="video/*"]')]
    const text = document.querySelector('[data-test="real"]')?.innerText || ''
    return { videoInputs: cards.length, offersRecordVideo: /record video/i.test(text) }
  })
  note(videoButtons.videoInputs === 2,
    'only the one Video step carries video inputs (camera + folder), not every step',
    `found ${videoButtons.videoInputs}`)

  note(pageErrors.length === 0, 'no uncaught page errors', pageErrors.join('\n      '))
} finally {
  await browser.close()
  await server.close()
}

console.log(failures === 0
  ? `\nverify:photo-upload: ${checks} checks passed`
  : `\nverify:photo-upload: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
