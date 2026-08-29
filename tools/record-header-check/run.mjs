#!/usr/bin/env node
//
// Does the record header actually stay on screen while you scroll the record?
//
// Nicholas, 2026-08-29, halfway down an incentive application: "when we scroll
// down on a page, we kind of lose everything. We don't really know where we're
// at. I need this section here to remain locked so the Save button and edit
// buttons are still available, but the user also knows where they're at."
//
// Reading the CSS cannot answer that — the last several pinning defects in this
// repo all read correctly in source and painted wrong in a browser (a colour
// token the palette never defined; a nav state the URL could not carry). So
// this mounts the REAL RecordDetail, scrolls its content region, and measures
// what a person would see:
//
//   • the band holds its position at the top of the scroll region, at every
//     offset, including fractional ones
//   • it paints an OPAQUE background — photographed, so a transparent band that
//     lets the fields draw through it is caught however it got that way
//   • the record's name and its action buttons are still on screen 2,000px down
//   • the tab bar pins directly under the band and never overlaps it
//
// A POSITIVE CONTROL strips the band's background on purpose and must FAIL. If
// the control ever passes, the photograph is not looking at the band and every
// other PASS in the run is worthless.
//
// Run with:  npm run verify:record-header
//
// Not part of `npm run build:safe`: it needs a browser binary, and a deploy that
// depends on one breaks when the build image changes. The build gate for this
// behaviour is scripts/sticky-record-header-fixture.mjs (the rules) and
// scripts/pinned-header-fixture.mjs (opaque backgrounds); this tool is how you
// prove the result.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

// The real modules import the Supabase client, which throws at module scope
// without these. Nothing is ever fetched — layoutService is stubbed.
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'record-header-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log([
    '',
    'verify:record-header  SKIPPED — nothing was verified.',
    '',
    '  playwright-core is not installed. It is deliberately not a dependency:',
    '  this check is a tool, not a build step. To run it:',
    '',
    '    npm install --no-save playwright-core',
    '    npm run verify:record-header',
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
  console.log('\nverify:record-header  SKIPPED — nothing was verified.\n  No Chromium found under PLAYWRIGHT_BROWSERS_PATH. Set CHROMIUM_PATH to a binary.\n')
  process.exit(0)
}

// Swap the record page's data layer for the fixture. Everything else — the
// component, its layout code, the pinned-header module — is the shipped code.
const stubLayoutService = {
  name: 'record-header-check:stub-layout-service',
  enforce: 'pre',
  resolveId(source) {
    if (/(^|\/)(\.\.\/)*data\/layoutService(\.js)?$/.test(source)) {
      return join(here, 'stubs', 'layoutService.js')
    }
    return null
  },
}

const server = await createServer({
  root, plugins: [stubLayoutService, react()], configFile: false,
  server: { port: 5312, strictPort: true }, logLevel: 'error',
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto('http://localhost:5312/tools/record-header-check/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#shell h1', { timeout: 30000 })

  // The record's own scroll region, and the sticky elements inside it.
  const found = await page.evaluate(() => {
    const shell = document.getElementById('shell')
    const all = [...shell.querySelectorAll('div')]
    const region = all.find(el => {
      const cs = getComputedStyle(el)
      return (cs.overflow === 'auto' || cs.overflowY === 'auto') && el.scrollHeight > el.clientHeight + 2
    })
    if (!region) return { ok: false }
    const stickies = [...region.querySelectorAll('div')].filter(el => getComputedStyle(el).position === 'sticky')
    window.__region = region
    window.__band = stickies[0] || null
    window.__tabs = stickies[1] || null
    return {
      ok: true,
      stickyCount: stickies.length,
      scrollable: region.scrollHeight - region.clientHeight,
      bandBg: window.__band ? getComputedStyle(window.__band).backgroundColor : null,
      tabsBg: window.__tabs ? getComputedStyle(window.__tabs).backgroundColor : null,
    }
  })

  note(found.ok, 'the record page mounted with a scrolling content region')
  if (!found.ok) throw new Error('no scroll region — the harness proves nothing')
  note(found.scrollable > 600, `the record is long enough to scroll (${Math.round(found.scrollable)}px below the fold)`)
  note(found.stickyCount >= 2, `the header band and the tab bar are both pinned (${found.stickyCount} sticky elements)`)
  note(found.bandBg !== 'rgba(0, 0, 0, 0)', 'the header band paints a background', `computed ${found.bandBg}`)
  note(found.tabsBg !== 'rgba(0, 0, 0, 0)', 'the tab bar paints a background', `computed ${found.tabsBg}`)

  const geom = async (top) => {
    await page.evaluate(t => { window.__region.scrollTop = t }, top)
    await page.waitForTimeout(80)
    return page.evaluate(() => {
      const r = window.__region.getBoundingClientRect()
      const b = window.__band.getBoundingClientRect()
      const t = window.__tabs ? window.__tabs.getBoundingClientRect() : null
      const buttons = [...window.__band.querySelectorAll('button')].map(el => {
        const q = el.getBoundingClientRect()
        return { text: (el.textContent || '').trim().slice(0, 24), top: q.top, bottom: q.bottom, height: q.height }
      })
      const h1 = window.__band.querySelector('h1')
      const nameEl = h1 || [...window.__band.querySelectorAll('span')]
        .find(s => (s.textContent || '').includes('1226 West Florence Street'))
      return {
        regionTop: r.top, regionBottom: r.bottom,
        bandTop: b.top, bandBottom: b.bottom, bandHeight: b.height,
        tabsTop: t?.top ?? null, tabsBottom: t?.bottom ?? null,
        buttons,
        nameVisible: !!nameEl && nameEl.getBoundingClientRect().bottom <= r.bottom
          && nameEl.getBoundingClientRect().top >= r.top - 1,
        nameText: (nameEl?.textContent || '').trim().slice(0, 40),
      }
    })
  }

  const atRest = await geom(0)
  note(Math.abs(atRest.bandTop - atRest.regionTop) <= 1,
    'at rest the header sits at the top of the record', `band ${atRest.bandTop} vs region ${atRest.regionTop}`)

  const offsets = [0, 1, 7.5, 40, 60, 120, 340, 900, 2000]
  const drift = []
  for (const top of offsets) {
    const g = await geom(top)
    if (Math.abs(g.bandTop - g.regionTop) > 1) drift.push(`${top}→${Math.round(g.bandTop)}`)
  }
  note(drift.length === 0, 'the header stays locked to the top at every scroll offset',
    `it moved at scrollTop ${drift.join(', ')}`)

  const deep = await geom(2000)
  note(deep.bandHeight < atRest.bandHeight,
    `the header condenses once you scroll (${Math.round(atRest.bandHeight)}px → ${Math.round(deep.bandHeight)}px)`)
  note(deep.nameVisible, 'the record’s own name is still on screen 2,000px down', deep.nameText)
  note(deep.buttons.length > 0 && deep.buttons.every(b => b.top >= deep.regionTop - 1 && b.bottom <= deep.regionBottom),
    `the header’s action buttons are still reachable 2,000px down (${deep.buttons.map(b => b.text).join(', ') || 'none'})`)
  note(deep.tabsTop !== null && deep.tabsTop >= deep.bandBottom - 1,
    'the tab bar pins under the header rather than behind it',
    `tabs at ${Math.round(deep.tabsTop)}, band ends at ${Math.round(deep.bandBottom)}`)
  note(deep.tabsTop !== null && deep.tabsTop - deep.bandBottom < 6,
    'the tab bar pins DIRECTLY under the header — no strip of content between them',
    `gap ${Math.round((deep.tabsTop ?? 0) - deep.bandBottom)}px`)

  // ── The photograph ──────────────────────────────────────────────────────
  // Every offset below is deep enough that the band is condensed, so the band
  // itself is not changing: any pixel that moves is the record scrolling
  // THROUGH the header.
  const clip = await page.evaluate(() => {
    const b = window.__band.getBoundingClientRect()
    // Exclude the overlay scrollbar gutter — its thumb is supposed to move.
    return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width - 20, height: b.height }
  })
  const shoot = async () => {
    const hashes = new Map()
    for (const top of [200, 260, 333.5, 700, 1200, 1900, 2600]) {
      await page.evaluate(t => { window.__region.scrollTop = t }, top)
      await page.waitForTimeout(70)
      const png = await page.screenshot({ clip })
      const h = createHash('sha256').update(png).digest('hex').slice(0, 12)
      if (!hashes.has(h)) hashes.set(h, [])
      hashes.get(h).push(top)
    }
    return [...hashes.entries()]
  }

  const shots = await shoot()
  note(shots.length === 1,
    `the header band is pixel-identical at every scroll offset (${Math.round(clip.width)}x${Math.round(clip.height)}px photographed)`,
    shots.map(([h, tops]) => `${h} @ ${tops.join(',')}`).join(' | '))

  // POSITIVE CONTROL — strip the background and the same photograph must fail.
  await page.evaluate(() => { window.__band.style.background = 'transparent' })
  const control = await shoot()
  note(control.length > 1,
    'POSITIVE CONTROL — a see-through header IS caught by this photograph',
    'the control PASSED, so the photograph is not looking at the band and every other result here is worthless')
  await page.evaluate(() => { window.__band.style.background = '' })

  // ── The literal ask: "so the Save button … is still available" ──────────
  await page.evaluate(() => { window.__region.scrollTop = 0 })
  const hasEdit = await page.evaluate(() =>
    [...window.__band.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'Edit'))
  note(hasEdit, 'the header offers Edit at rest')
  if (hasEdit) {
    // A real click, not el.click(): the point is to drive the control the way a
    // person does.
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.waitForTimeout(800)
    const saving = await page.evaluate(() => {
      window.__region.scrollTop = 2000
      const r = window.__region.getBoundingClientRect()
      const btns = [...window.__band.querySelectorAll('button')]
      const save = btns.find(b => (b.textContent || '').trim().startsWith('Save'))
      if (!save) return { found: false, labels: btns.map(b => (b.textContent || '').trim()) }
      const q = save.getBoundingClientRect()
      return { found: true, onScreen: q.top >= r.top - 1 && q.bottom <= r.bottom, top: q.top }
    })
    await page.waitForTimeout(120)
    const stillThere = await page.evaluate(() => {
      const r = window.__region.getBoundingClientRect()
      const save = [...window.__band.querySelectorAll('button')].find(b => (b.textContent || '').trim().startsWith('Save'))
      if (!save) return false
      const q = save.getBoundingClientRect()
      return q.top >= r.top - 1 && q.bottom <= r.bottom
    })
    note(saving.found && stillThere,
      'editing 2,000px down the record, Save is still on screen in the pinned header',
      saving.found ? 'it scrolled out of the region' : `buttons in the band: ${(saving.labels || []).join(', ')}`)
  }

  note(pageErrors.length === 0, 'the record page rendered without a runtime error',
    pageErrors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
