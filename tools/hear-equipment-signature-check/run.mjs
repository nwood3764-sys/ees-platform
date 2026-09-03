#!/usr/bin/env node
//
// Does the equipment step actually appear, and does Send Proposal for Signature
// actually open?
//
// Both shipped on 2026-09-03 having been proved only at the database and PDF
// level. Nicholas had already caught two screens that day whose code read
// correctly and whose behaviour did not — a Products card that drew itself
// twice, and an equipment requirement that silently stopped applying. Reading
// the code is not verification of a screen.
//
// So this asks a real Chromium, on the real components:
//
//   1  a HEAR measure with an approved model opens the equipment step and
//      offers exactly that model — not the whole catalogue
//   2  a HEAR measure with NO approved model offers a way forward rather than
//      dead-ending, which is the state Nicholas hit on the heat pump
//   3  creating a model from that form adds the line with it attached
//   4  a measure that installs nothing model-numbered (Electrical Wiring) adds
//      in one click and never opens the step
//   5  the signature modal loads, PRE-FILLS the recipient from the record, and
//      will not send with the address emptied
//
//   CONTROL  the stub refuses an equipment-requiring line with no equipment,
//            exactly as the database trigger does. If a line ever gets added
//            without one, the harness is not reproducing production and every
//            PASS beside it is worthless.
//
// Run with:  npm run verify:hear-equipment-signature
//
// Not part of `npm run build:safe`: it needs a browser binary.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'hear-equipment-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log([
    '', 'verify:hear-equipment-signature  SKIPPED — nothing was verified.', '',
    '  playwright-core is not installed. It is deliberately not a dependency:',
    '  this check is a tool, not a build step. To run it:', '',
    '    npm install --no-save playwright-core',
    '    npm run verify:hear-equipment-signature', '',
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
  console.log('\nverify:hear-equipment-signature  SKIPPED — nothing was verified.\n  No Chromium under PLAYWRIGHT_BROWSERS_PATH. Set CHROMIUM_PATH to a binary.\n')
  process.exit(0)
}

function stubPlugin() {
  const map = [
    [join('src', 'data', 'opportunityProductsService.js'), join(here, 'opportunityProductsServiceStub.js')],
    [join('src', 'data', 'hearProposalService.js'),        join(here, 'hearProposalServiceStub.js')],
  ]
  return {
    name: 'hear-equipment-check-stubs',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || source.startsWith('\0')) return null
      if (!/opportunityProductsService|hearProposalService/.test(source)) return null
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto(`http://localhost:5331${join('/', 'tools', 'hear-equipment-signature-check', 'index.html')}`)
  await page.waitForSelector('text=Products', { timeout: 15000 })

  // A screen that throws on mount renders nothing and every later query would
  // report "not found" for the wrong reason.
  note(pageErrors.length === 0, 'the Products card mounts without a page error',
    pageErrors.join(' | '))

  const openPicker = async () => {
    const add = page.locator('button', { hasText: 'Add Product' }).first()
    await add.click()
    await page.waitForSelector('text=ENERGY STAR Ventilation', { timeout: 8000 })
  }

  // ── 1. A measure WITH an approved model ────────────────────────────────
  await openPicker()
  await page.locator('button', { hasText: 'ENERGY STAR Ventilation' }).first().click()
  const stepHeading = page.locator('text=Which equipment is being installed?')
  note(await stepHeading.isVisible().catch(() => false),
    'picking ENERGY STAR Ventilation opens the equipment step')

  const fanVisible = await page.locator('button', { hasText: 'Panasonic FV-0511VF1' }).first()
    .isVisible().catch(() => false)
  note(fanVisible, 'the step offers the approved model')

  // Scoped, not the whole catalogue: the heat pump must NOT be offered as a
  // model for ventilation.
  const wrongModel = await page.locator('button', { hasText: 'Heat Pump for Space Heating' }).count()
  note(wrongModel === 0, 'the step does NOT offer models from other measures')

  await page.locator('button', { hasText: 'Panasonic FV-0511VF1' }).first().click()
  await page.waitForTimeout(400)
  let added = await page.evaluate(() => window.__products.added)
  note(added.length === 1 && added[0].equipmentProductId === 'e-fan',
    'the line is added WITH the chosen equipment',
    JSON.stringify(added))

  // ── 2 + 3. A measure with NO approved model ────────────────────────────
  await openPicker()
  await page.locator('button', { hasText: 'Heat Pump for Space Heating' }).first().click()
  await page.waitForSelector('text=Which equipment is being installed?', { timeout: 8000 })

  const emptyMsg = await page.locator('text=No approved models are set up').isVisible().catch(() => false)
  note(emptyMsg, 'a measure with no approved models SAYS so')

  const newBtn = page.locator('button', { hasText: '+ New equipment model' }).first()
  note(await newBtn.isVisible().catch(() => false),
    'and offers a way forward rather than dead-ending — this is the heat pump case')

  await newBtn.click()
  await page.locator('input[placeholder*="Manufacturer"]').fill('Mitsubishi Electric')
  await page.locator('input[placeholder*="Model number"]').fill('MSZ-FH12NA')
  await page.locator('button', { hasText: 'Add and use it' }).first().click()
  await page.waitForTimeout(600)

  const created = await page.evaluate(() => window.__products.created)
  note(created.length === 1 && created[0].modelNumber === 'MSZ-FH12NA',
    'the form creates the equipment', JSON.stringify(created))

  added = await page.evaluate(() => window.__products.added)
  note(added.length === 2 && added[1].equipmentProductId === 'e-new-1',
    'and the line is added with the equipment it just created', JSON.stringify(added))

  // ── 4. A measure that installs nothing model-numbered ──────────────────
  await openPicker()
  await page.locator('button', { hasText: 'Electrical Wiring' }).first().click()
  await page.waitForTimeout(500)
  const stepOpened = await page.locator('text=Which equipment is being installed?')
    .isVisible().catch(() => false)
  note(!stepOpened, 'Electrical Wiring does NOT open the equipment step')

  added = await page.evaluate(() => window.__products.added)
  note(added.length === 3 && added[2].equipmentProductId === null,
    'and adds in one click with no equipment', JSON.stringify(added))

  // ── CONTROL ────────────────────────────────────────────────────────────
  // The stub refuses an equipment-requiring line with no equipment, as the
  // database does. Prove that refusal is real, or nothing above means anything.
  const refused = await page.evaluate(async () => {
    const m = await import('/tools/hear-equipment-signature-check/opportunityProductsServiceStub.js')
    try { await m.addOpportunityProduct('opp-199', 'm-vent', 9, null); return false }
    catch { return true }
  })
  note(refused, 'CONTROL: a ventilation line with no equipment really is refused')

  // ── 5. Send Proposal for Signature ─────────────────────────────────────
  await page.locator('[data-test="open-modal"]').click()
  await page.waitForSelector('text=Send Proposal for Signature', { timeout: 8000 })
  await page.waitForTimeout(600)

  const emailInput = page.locator('input[placeholder*="@"]').first()
  const prefilled = await emailInput.inputValue().catch(() => '')
  note(prefilled === 'dennis.hanson@example.org',
    'the signature modal PRE-FILLS the recipient from the record', `got "${prefilled}"`)

  const nameInput = page.locator('input[placeholder*="Property owner"]').first()
  note((await nameInput.inputValue().catch(() => '')) === 'Dennis Hanson',
    'and pre-fills the signer name')

  // The address is inherited, not typed — so it has to be readable before
  // sending, which is the whole reason it is shown.
  note(await emailInput.isVisible(), 'the recipient address is visible before sending')

  const sendBtn = page.locator('button', { hasText: 'Send for Signature' }).first()
  note(await sendBtn.isEnabled(), 'Send is enabled with a recipient')

  await emailInput.fill('')
  await page.waitForTimeout(200)
  note(!(await sendBtn.isEnabled()), 'Send is DISABLED with the address emptied')

  await emailInput.fill('dennis.hanson@example.org')
  await page.waitForTimeout(200)
  await sendBtn.click()
  await page.waitForTimeout(700)
  const sent = await page.evaluate(() => window.__proposal.sent)
  note(sent.length === 1 && sent[0].email === 'dennis.hanson@example.org',
    'sending passes the recipient through', JSON.stringify(sent))

  const confirmed = await page.locator('text=Sent for signature').isVisible().catch(() => false)
  note(confirmed, 'and the modal confirms what happened rather than closing silently')

  note(pageErrors.length === 0, 'no page error across the whole run', pageErrors.join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
