#!/usr/bin/env node
//
// Is the topbar's Setup menu actually ON TOP of the record page?
//
// Nicholas, 2026-09-01, with the gear open on a record: "I'm having a rendering
// issue when I go to page setup. This gets cut off. Can we make this be on
// top?" Half the menu was drawn under the record's breadcrumb and its Edit /
// Actions buttons.
//
// Reading the CSS cannot answer this, and reading it is precisely what kept the
// bug alive: every one of those menus declared a z-index that looked ample (the
// gear asked for 50, the user menu for 500) and painted underneath anyway,
// because the topbar's right-hand cluster is `position:absolute; z-index:10`
// and a positioned element with a z-index CREATES A STACKING CONTEXT — sealing
// every menu inside it at level 10, while the record's pinned header band sits
// at 30 in the root context.
//
// So this mounts the REAL gear inside the REAL cluster over a record-shaped
// page using the REAL stickyHeaderBandStyle, opens the menu, and HIT-TESTS the
// menu's own pixels: at every point down the menu, is the top-most element
// under the cursor the menu, or the record header?
//
// TWO POSITIVE CONTROLS, both of which must behave, or the run proves nothing:
//   • the legacy absolutely-positioned menu must be found UNDERNEATH the header
//     — if it reads as "on top", the hit-test is blind and every PASS is noise
//   • the same content through the shipped portal must be found on top, so a
//     PASS is the portal working rather than the harness passing everything
//
// Run with:  npm run verify:topbar-menus
//
// Not part of `npm run build:safe`: it needs a browser binary, and a deploy that
// depends on one breaks when the build image changes. The build gate for this
// behaviour is scripts/topbar-menu-fixture.mjs (the rules); this tool is how
// you prove the result.

import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'topbar-menu-check'

let chromium
try {
  ({ chromium } = await import('playwright-core'))
} catch {
  console.log([
    '',
    'verify:topbar-menus  SKIPPED — nothing was verified.',
    '',
    '  playwright-core is not installed. It is deliberately not a dependency:',
    '  this check is a tool, not a build step. To run it:',
    '',
    '    npm install --no-save playwright-core',
    '    npm run verify:topbar-menus',
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
  console.log('\nverify:topbar-menus  SKIPPED — nothing was verified.\n  No Chromium found under PLAYWRIGHT_BROWSERS_PATH. Set CHROMIUM_PATH to a binary.\n')
  process.exit(0)
}

// The gear renders nothing for a non-admin, so its profile lookup is stubbed.
// Nothing is ever fetched.
const stubLayoutService = {
  name: 'topbar-menu-check:stub-layout-service',
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
  server: { port: 5314, strictPort: true }, logLevel: 'error',
  // Scope the dependency pre-scan to THIS harness. Left to itself Vite scans
  // every index.html in the repo — including the app's own — and reports the
  // stub as missing three dozen layoutService exports it was never meant to
  // provide. Noise, but noise that reads like a broken harness.
  optimizeDeps: { entries: ['tools/topbar-menu-check/index.html'] },
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.goto('http://localhost:5314/tools/topbar-menu-check/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#cluster', { timeout: 30000 })

  // The premise: the cluster really is a stacking context below the band.
  const premise = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('cluster'))
    const band = getComputedStyle(document.getElementById('band'))
    return { clusterZ: cs.zIndex, clusterPos: cs.position, bandZ: band.zIndex, bandPos: band.position }
  })
  note(premise.clusterPos === 'absolute' && Number(premise.clusterZ) > 0,
    `the topbar cluster is a stacking context (position:${premise.clusterPos}, z-index:${premise.clusterZ})`)
  note(Number(premise.bandZ) > Number(premise.clusterZ),
    `the record header outranks it (band z-index ${premise.bandZ} > cluster ${premise.clusterZ}) — this is the whole defect`)

  // Hit-test a menu: walk down its own box and ask what is actually painted
  // there. `coveredBy` names the offender, so a FAIL says what won.
  const probe = async (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { found: false }
    const r = el.getBoundingClientRect()
    const band = document.getElementById('band')
    const pts = []
    // Sample down the menu, inset from the edges so a 1px border never decides.
    for (let f = 0.08; f <= 0.95; f += 0.12) {
      const y = r.top + r.height * f
      const x = r.left + r.width / 2
      const hit = document.elementFromPoint(x, y)
      pts.push({
        y: Math.round(y),
        ownedByMenu: !!hit && (el.contains(hit) || hit === el),
        coveredByBand: !!hit && band.contains(hit),
        hit: hit ? (hit.id || `${hit.tagName}:${(hit.textContent || '').trim().slice(0, 28)}`) : null,
      })
    }
    return {
      found: true,
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
      bandRect: { top: Math.round(band.getBoundingClientRect().top), bottom: Math.round(band.getBoundingClientRect().bottom) },
      pts,
    }
  }, selector)

  const overlapsBand = (p) => p.rect.bottom > p.bandRect.top

  // ── POSITIVE CONTROL 1: the menu exactly as it shipped ────────────────────
  await page.evaluate(() => window.__openLegacy())
  await page.waitForTimeout(120)
  const legacy = await probe('#legacy-menu')
  note(legacy.found, 'the legacy absolutely-positioned menu mounted')
  note(legacy.found && overlapsBand(legacy),
    `the legacy menu reaches down over the record header (menu ends ${legacy.rect?.bottom}, header starts ${legacy.bandRect?.top})`,
    'it does not overlap, so this control tests nothing — make the menu taller or the viewport shorter')
  const legacyCovered = legacy.found ? legacy.pts.filter(p => p.coveredByBand) : []
  note(legacyCovered.length > 0,
    `POSITIVE CONTROL — the OLD menu IS caught being painted over (${legacyCovered.length} of ${legacy.pts?.length} sample points hit the record header)`,
    'the control PASSED as "on top", so this hit-test cannot see the defect and every other result here is worthless')

  // ── POSITIVE CONTROL 2: the same content through the shipped portal ───────
  await page.evaluate(() => window.__openPortal())
  await page.waitForTimeout(160)
  const portal = await probe('#portal-menu-body')
  note(portal.found, 'the portalled menu mounted')
  note(portal.found && overlapsBand(portal),
    `the portalled menu also reaches over the record header (menu ends ${portal.rect?.bottom}, header starts ${portal.bandRect?.top})`,
    'if it does not overlap, the comparison with the control is not like-for-like')
  const portalCovered = portal.found ? portal.pts.filter(p => p.coveredByBand) : []
  note(portalCovered.length === 0,
    'the portalled menu is on top over its whole height',
    portalCovered.map(p => `y=${p.y} → ${p.hit}`).join(', '))

  // ── The real thing: the shipped Setup gear ────────────────────────────────
  await page.getByRole('button', { name: 'Setup' }).click()
  await page.waitForTimeout(200)
  const gearMounted = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menu"]')].some(m => /Edit Page Layout/.test(m.textContent || '')))
  note(gearMounted, 'the Setup gear opened its menu')

  const gear = await page.evaluate(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')]
      .find(m => /Edit Page Layout/.test(m.textContent || ''))
    if (!menu) return { found: false }
    const r = menu.getBoundingClientRect()
    const band = document.getElementById('band')
    const br = band.getBoundingClientRect()
    const pts = []
    for (let f = 0.08; f <= 0.95; f += 0.1) {
      const y = r.top + r.height * f
      const x = r.left + r.width / 2
      const hit = document.elementFromPoint(x, y)
      pts.push({
        y: Math.round(y),
        coveredByBand: !!hit && band.contains(hit),
        hit: hit ? (hit.id || `${hit.tagName}:${(hit.textContent || '').trim().slice(0, 28)}`) : null,
      })
    }
    // Every item the menu offers must be reachable, not just painted.
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map(el => {
      const q = el.getBoundingClientRect()
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2)
      return {
        label: (el.querySelector('div')?.textContent || el.textContent || '').trim().slice(0, 30),
        clickable: !!hit && el.contains(hit),
        blockedBy: hit && !el.contains(hit)
          ? (hit.id || `${hit.tagName}:${(hit.textContent || '').trim().slice(0, 24)}`) : null,
      }
    })
    return {
      found: true,
      portalled: menu.parentElement === document.body,
      position: getComputedStyle(menu).position,
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
      bandRect: { top: Math.round(br.top), bottom: Math.round(br.bottom) },
      pts, items,
    }
  })

  note(gear.found, 'the gear menu is in the document')
  note(gear.found && gear.portalled, 'the gear menu is a direct child of document.body (portalled)',
    'it is still inside the topbar cluster, so it is still sealed at the cluster’s z-index')
  note(gear.found && gear.position === 'fixed',
    `the gear menu positions itself with \`fixed\` (computed: ${gear.position})`)
  note(gear.found && overlapsBand(gear),
    `the gear menu extends down over the record header (menu ends ${gear.rect?.bottom}, header starts ${gear.bandRect?.top})`,
    'it does not reach the header, so this run did not reproduce the reported geometry')

  const gearCovered = gear.found ? gear.pts.filter(p => p.coveredByBand) : []
  note(gearCovered.length === 0,
    `the gear menu is painted on top over its whole height (${gear.pts?.length} sample points)`,
    gearCovered.map(p => `y=${p.y} → ${p.hit}`).join(', '))

  const blocked = gear.found ? gear.items.filter(i => !i.clickable) : []
  note(gear.found && gear.items.length >= 4 && blocked.length === 0,
    `every item in the menu is clickable (${gear.items?.map(i => i.label).join(', ')})`,
    blocked.map(i => `"${i.label}" blocked by ${i.blockedBy}`).join(', '))

  // Clicking a row must not close the menu by way of a stale outside-click
  // handler: a portalled panel is not inside the trigger's wrapper.
  const stillOpenAfterInsideClick = await page.evaluate(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')]
      .find(m => /Edit Page Layout/.test(m.textContent || ''))
    if (!menu) return false
    const header = menu.firstElementChild
    header?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return [...document.querySelectorAll('[role="menu"]')].some(m => /Edit Page Layout/.test(m.textContent || ''))
  })
  note(stillOpenAfterInsideClick, 'a mousedown inside the menu does not close it',
    'a leftover wrapRef outside-click test is treating the portalled panel as "outside"')

  // And an outside click still closes it.
  await page.mouse.click(400, 600)
  await page.waitForTimeout(150)
  const closed = await page.evaluate(() =>
    ![...document.querySelectorAll('[role="menu"]')].some(m => /Edit Page Layout/.test(m.textContent || '')))
  note(closed, 'clicking outside still closes the menu')

  note(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '))
} finally {
  await browser.close()
  await server.close()
}

console.log(failures === 0
  ? `\nverify:topbar-menus  ${checks} checks passed.\n`
  : `\nverify:topbar-menus  ${failures} of ${checks} checks FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
