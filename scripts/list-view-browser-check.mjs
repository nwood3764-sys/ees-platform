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
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`)
}
const rows = () => p.$$eval('table tbody tr td:nth-child(1)', ts => ts.map(t => t.textContent.trim()))

await p.goto('http://localhost:5201/audit.html')
await p.waitForSelector('table tbody tr')
check('all rows render', (await rows()).length, 3)

// ── The typeahead race: type a phrase, with the FIRST request deliberately slow
await p.click('button:has-text("Filters")')
await p.click('text=Add Filter')
await p.fill('input[placeholder="Search fields…"]', 'Management')
await p.click('div:text-is("Management Company")')
await p.waitForTimeout(300)
const valueBox = 'input[placeholder="Search and select…"], input[placeholder*="Search"]'
const box = (await p.$$(valueBox)).pop()
await box.click()
for (const ch of 'Lutheran social services') { await p.keyboard.type(ch, { delay: 25 }) }
await p.waitForTimeout(2200)   // long enough for the slow first response to land

const shown = await p.$$eval('div[style*="380"] label, div[style*="380"] div',
  els => els.map(e => e.textContent.trim()).filter(t => /Lutheran|City|Staples|Grace|MADISON/i.test(t) && t.length < 80))
const uniq = [...new Set(shown)]
console.log('   options offered:', uniq)
check('a stale response cannot overwrite the current query',
  uniq.some(t => /1st City|Staples/i.test(t)), false)
check('the matching account is offered',
  uniq.some(t => /Lutheran Social Services of Wisconsin and Upper Michigan, Inc\./.test(t)), true)
check('soft-deleted duplicates are not offered',
  uniq.filter(t => /LUTHERAN SOCIAL SERVICES OF WISCONSIN AND UPPER MICHIGAN,$/.test(t)).length, 0)

console.log('\n   requests the code issued:', await p.evaluate(() => window.__requestLog))
console.log(`\n${pass} passed, ${fail} failed`)
await b.close()
process.exit(fail ? 1 : 0)
