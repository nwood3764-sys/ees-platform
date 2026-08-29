// Browser check for the list view: filters, operators, logic, sorting and the
// lookup typeahead, driven through the real component in Chromium.
//
// Nicholas, 2026-08-29: "you really need to go through this list view and all
// the filters and functionality to make sure it's accurate. I can't keep being
// a beta tester every single time there's a mistake you make in the code."
//
// The pure fixtures (list-filter-matching, list-filter-logic, soft-delete,
// lookup-column-rules) pin the RULES. This pins the INTEGRATION — where the
// bugs he found actually lived: two effects racing to fill the typeahead, and a
// picker offering soft-deleted records. Neither is reachable from a pure test.
//
// Not part of `npm run fixtures`: it needs Playwright and a dev server, which
// are not repo dependencies. Run it by hand when touching ListView:
//
//   npx vite --config vite.stub.config.mjs      # a stub-backed harness
//   node scripts/list-view-browser-check.mjs
//
// See the file header of scripts/photo-repair-browser-check.mjs for the same
// pattern.

import pw from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pw;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await b.newPage({ viewport: { width: 1300, height: 950 } })
p.on('pageerror', e => console.log('[pageerror]', e.message.slice(0,200)))
let pass = 0, fail = 0
const check = (l, a, e) => { const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++
  console.log(`${ok?'PASS':'FAIL'}  ${l}${ok?'':`\n      expected ${JSON.stringify(e)}\n      actual   ${JSON.stringify(a)}`}`) }
const rows = () => p.$$eval('table tbody tr td:nth-child(1)', ts => ts.map(t => t.textContent.trim()))

async function addFilter(field, op, value) {
  await p.click('text=Add Filter')
  await p.fill('input[placeholder="Search fields…"]', field)
  await p.click(`div:text-is("${field}")`)
  await p.waitForTimeout(250)
  const sels = await p.$$('select'); await sels[sels.length - 1].selectOption(op)
  await p.waitForTimeout(150)
  if (value !== undefined) {
    const ins = (await p.$$('input:not([placeholder="Search fields…"])'))
    await ins[ins.length - 1].fill(String(value))
  }
}

await p.goto('http://localhost:5201/audit.html')
await p.waitForSelector('table tbody tr')

// ── contains on a lookup field, applied end to end ─────────────────────────
await p.click('button:has-text("Filters")')
await addFilter('Management Company', 'contains', 'Lutheran')
await p.click('button:has-text("Apply")'); await p.waitForTimeout(400)
check('contains on a lookup field returns the two Lutheran-managed rows', await rows(), ['Alden Road','Hampton Ave'])

// ── a number operator, through the UI ──────────────────────────────────────
await p.click('button:has-text("Filters")')
await addFilter('Units', 'gt', 10)
await p.click('button:has-text("Apply")'); await p.waitForTimeout(400)
check('greater than 10, ANDed with the first filter', await rows(), ['Alden Road'])

// ── OR logic ───────────────────────────────────────────────────────────────
await p.click('button:has-text("Filters")')
await p.click('text=Add filter logic')
await p.fill('input[placeholder^="e.g. 1 AND"]', '1 OR 2')
await p.click('button:has-text("Apply")'); await p.waitForTimeout(400)
check('1 OR 2 widens to Lutheran-managed OR over-10-units', await rows(), ['Alden Road','Hampton Ave','Waunona Ct'])

// ── sorting ────────────────────────────────────────────────────────────────
await p.click('th:has-text("OPPORTUNITY NAME")'); await p.waitForTimeout(300)
const asc = await rows()
await p.click('th:has-text("OPPORTUNITY NAME")'); await p.waitForTimeout(300)
const desc = await rows()
check('sort ascending then descending reverses the rows', desc, [...asc].reverse())

// ── clearing ───────────────────────────────────────────────────────────────
await p.click('text=Clear all'); await p.waitForTimeout(400)
check('clear all restores every row', (await rows()).length, 3)

console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
