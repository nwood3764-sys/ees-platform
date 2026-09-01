#!/usr/bin/env node
// Drives the real dashboard filter editor in a real browser: picks a field from
// the grouped picker, reads back the map it built, and photographs the coverage
// line. Reading the JSX is not verification — the 2026-08-22 lesson.
// Run: node tools/dashboard-filter-check/run.mjs [outDir]
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outDir = process.argv[2] || root
process.env.VITE_SUPABASE_URL      ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'dashboard-filter-check'

let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.log('SKIPPED — npm install --no-save playwright-core'); process.exit(0)
}
function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) return null
  for (const entry of readdirSync(base)) {
    const p = join(base, entry, 'chrome-linux/chrome')
    if (entry.startsWith('chromium') && !entry.includes('headless_shell') && existsSync(p)) return p
  }
  return null
}
const executablePath = findChromium()
if (!executablePath) { console.log('SKIPPED — no Chromium'); process.exit(0) }

let pass = 0, fail = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`) }
}
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.error(`  ✗ ${name}`) } }

const server = await createServer({
  root, plugins: [react()], configFile: false,
  server: { port: 5317, strictPort: true }, logLevel: 'error',
})
await server.listen()
const browser = await chromium.launch({ executablePath })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:5317/tools/dashboard-filter-check/', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-case="fresh"] select', { timeout: 20000 })

  const state = async (id) => JSON.parse(await page.locator(`[data-case="${id}"] [data-state]`).innerText())
  const coverage = async (id) => (await page.locator(`[data-case="${id}"]`).innerText()).replace(/\s+/g, ' ')

  // The picker offers real fields, grouped by the object they live on.
  const groups = await page.locator('[data-case="fresh"] select optgroup').evaluateAll(
    els => els.map(e => e.label))
  check('fields are grouped by object', groups, ['Properties', 'Opportunities', 'Work Orders'])
  const opts = await page.locator('[data-case="fresh"] select option').evaluateAll(els => els.map(e => e.textContent))
  ok('a field is offered by its label, not its column name', opts.includes('State') && !opts.includes('property_state'))

  // Picking a field builds the map across every object that has an equivalent.
  await page.selectOption('[data-case="fresh"] select', 'properties::property_state')
  const fresh = await state('fresh')
  check('the picked column is the filter field', fresh.field_name, 'property_state')
  check('the map covers the source object and its equivalents', fresh.field_map,
    { properties: 'property_state', opportunities: 'opportunity_state' })
  ok('an object with no equivalent is left out', !('work_orders' in fresh.field_map))
  check('the value list is pointed at the source object', fresh.options,
    { source: 'distinct', object: 'properties', field: 'property_state' })
  const freshText = await coverage('fresh')
  ok('coverage names what it reaches', freshText.includes('Applies to Properties, Opportunities'))
  ok('coverage names what it misses', freshText.includes('Not applied to Work Orders'))

  // A filter saved before the map existed reaches only its own object, and says so.
  const legacyText = await coverage('legacy')
  ok('a legacy filter reports the objects it really reaches',
    legacyText.includes('Applies to Properties') && legacyText.includes('Not applied to Opportunities, Work Orders'))

  // A filter naming a column no widget has is called out rather than looking fine.
  const orphanText = await coverage('orphan')
  ok('an unreachable filter says so', orphanText.includes('Applies to no widget'))
  ok('and names the column it is stuck on', orphanText.includes('enrollment_program_id'))

  // Per-object mapping: "not filtered" is stored, not deleted.
  await page.locator('[data-case="mapped"] button', { hasText: 'Set fields per object' }).click()
  const selects = page.locator('[data-case="mapped"] select')
  check('one mapping control per object plus field and operator',
    await selects.count(), 5)
  await selects.nth(3).selectOption('')   // Opportunities → not filtered
  const mapped = await state('mapped')
  check('an excluded object is stored as an explicit blank, not dropped',
    mapped.field_map.opportunities, null)
  ok('the source object keeps its column', mapped.field_map.properties === 'property_state')
  ok('coverage updates to match', (await coverage('mapped')).includes('Not applied to Opportunities, Work Orders'))

  await page.screenshot({ path: join(outDir, 'dashboard-filter-editor.png'), fullPage: true })
  console.log(`wrote ${join(outDir, 'dashboard-filter-editor.png')}`)
  if (errors.length) { fail++; console.error(`PAGE ERRORS: ${errors.join(' · ')}`) }
  else console.log('no page errors')
} finally {
  await browser.close(); await server.close()
}
console.log(`dashboard-filter-check: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
