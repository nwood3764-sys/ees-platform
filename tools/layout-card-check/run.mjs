#!/usr/bin/env node
//
// Can an admin actually place a Documents card, and put the same card in the
// right sidebar AND on a tab?
//
// Nicholas, 2026-08-27: "I wanna put documents on the right sidebar and on the
// related tabs, but it's not giving that option… For every single record type
// of every single object, I should be able to duplicate them on the side and in
// the details record detail pages tabs."
//
// The pure rules are pinned by scripts/layout-cards-fixture.mjs. That proves
// the CATALOG and the TRANSFORM. It cannot prove that the palette renders, that
// the card an admin clicks is the card that gets built, or that the copy picker
// offers the right sidebar as a target — and "the option isn't there" is
// exactly a rendering complaint. Per the 2026-08-22 lesson (reading the code
// was not enough to see the lost section), that half is checked in a real
// browser: click the buttons, read back where the cards ended up.
//
// Run with:  node tools/layout-card-check/run.mjs
//
// Not part of `npm run build:safe`: it needs a browser binary, and a deploy that
// depends on one breaks when the build image changes. To run it:
//   npm install --no-save playwright-core

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

// The harness imports the real modules, which import the Supabase client, which
// logs at module scope without these. Nothing is ever fetched.
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'layout-card-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log('\nlayout-card-check  SKIPPED — nothing was verified.\n  npm install --no-save playwright-core\n')
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
  console.log('\nlayout-card-check  SKIPPED — no Chromium under PLAYWRIGHT_BROWSERS_PATH.\n')
  process.exit(0)
}

const server = await createServer({
  root, plugins: [react()], configFile: false,
  server: { port: 5317, strictPort: true }, logLevel: 'error',
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto('http://localhost:5317/tools/layout-card-check/', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-test="placements"]', { timeout: 20000 })

  const placements = () => page.$$eval('[data-placement]', els => els.map(e => ({
    surface: e.dataset.surface, type: e.dataset.type, title: e.dataset.title,
    docType: e.dataset.doctype, target: e.dataset.target,
  })))

  // ── The palette opens and offers Documents ─────────────────────────────────
  await page.click('[data-test="open-palette"]')
  await page.waitForSelector('text=Add a card', { timeout: 5000 })

  const buttons = await page.$$eval('button', els => els
    .filter(e => /Related List|Documents|Photos|Communications|Report|Work Plan|Publish History/.test(e.textContent || ''))
    .map(e => ({ text: (e.textContent || '').trim().split('\n')[0].trim(), disabled: e.disabled })))

  const labelled = (name) => buttons.find(b => b.text.startsWith(name))
  note(!!labelled('Documents'), 'the palette offers a Documents card on an enrollment')
  note(!!labelled('Related List'), 'the palette offers a Related List')
  note(!!labelled('Report'), 'the palette offers a Report')
  note(labelled('Photos') && labelled('Photos').disabled,
    'Photos is offered but disabled on an enrollment — refused with a reason, not hidden')
  note(labelled('Communications') && labelled('Communications').disabled,
    'Communications is disabled on an enrollment (conversations has no enrollment_id)')
  note(labelled('Work Plan') && labelled('Work Plan').disabled, 'Work Plan is disabled off a work order')

  const photoReason = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim().startsWith('Photos'))
    return b ? b.textContent : ''
  })
  note(/Documents card/.test(photoReason),
    'the Photos refusal tells the admin which card to use instead',
    photoReason.slice(0, 160))

  // Clicking Documents places a documents-target catch-all gallery.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim().startsWith('Documents'))
    b.click()
  })
  await page.waitForFunction(() => document.querySelectorAll('[data-placement]').length === 4, { timeout: 5000 })

  let rows = await placements()
  const placed = rows.find(r => r.type === 'file_gallery' && r.surface === 'Related')
  note(!!placed, 'clicking Documents places a card on the Related tab')
  note(placed && placed.target === 'documents' && placed.docType === 'attachment',
    'the placed card is a documents catch-all gallery — the card with upload and bulk download',
    placed && JSON.stringify(placed))

  // ── Copy the same card into the right sidebar ─────────────────────────────
  await page.click('[data-test="copy-docs"]')
  await page.waitForSelector('text=Right sidebar', { timeout: 5000 })

  const groups = await page.$$eval('[role], div', () => {
    const out = []
    for (const el of document.querySelectorAll('div')) {
      const t = (el.textContent || '').trim()
      if (el.children.length === 0 && /^(Details|Related|Right sidebar)$/.test(t)) out.push(t)
    }
    return out
  })
  note(groups.includes('Right sidebar'), 'the copy picker offers the right sidebar as a destination')
  note(groups.includes('Details') && groups.includes('Related'), 'and every tab on the layout', groups.join(', '))

  // Choose the existing right-rail section, then copy.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Documents')
    b.click()
  })
  await page.click('text=Copy card')
  await page.waitForFunction(() => document.querySelectorAll('[data-placement]').length === 5, { timeout: 5000 })

  rows = await placements()
  const docCards = rows.filter(r => r.title === 'Documents' && r.type === 'related_list')
  note(docCards.length === 2, `the card now sits in two places (${docCards.length})`)
  note(docCards.some(r => r.surface === 'Right sidebar') && docCards.some(r => r.surface === 'Related'),
    'one in the right sidebar and one on the Related tab — what was asked for',
    docCards.map(r => r.surface).join(' + '))

  // ── Copy into a NEW right-rail section ────────────────────────────────────
  await page.click('[data-test="copy-new"]')
  await page.waitForSelector('text=Copy card', { timeout: 5000 })
  await page.evaluate(() => {
    // The last "+ New section" button belongs to the Right sidebar group.
    const news = [...document.querySelectorAll('button')].filter(x => (x.textContent || '').trim().startsWith('+ New section'))
    news[news.length - 1].click()
  })
  await page.click('text=Copy card')
  await page.waitForFunction(() => document.querySelectorAll('[data-placement]').length === 6, { timeout: 5000 })

  rows = await placements()
  const hpxml = rows.filter(r => r.docType === 'reservation_hpxml')
  note(hpxml.length === 2, 'a slot card copies too, into a section that did not exist')
  note(hpxml.some(r => r.surface === 'Right sidebar') && hpxml.some(r => r.surface === 'Details'),
    'the copy is in the new right-rail section and the original is still on Details',
    hpxml.map(r => r.surface).join(' + '))
  note(hpxml.every(r => r.docType === 'reservation_hpxml'),
    'the copy keeps the slot’s document type, so it lists the same files')

  note(pageErrors.length === 0, 'no uncaught errors while driving the modals', pageErrors.join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(failures === 0
  ? `\nlayout-card-check: ${checks} checks passed`
  : `\nlayout-card-check: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
