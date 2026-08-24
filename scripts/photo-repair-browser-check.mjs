import { chromium } from 'playwright'

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.goto('http://localhost:5199/')

let pass = 0, fail = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`}`)
}
const txt = (id) => page.textContent(`[data-testid="${id}"]`)
async function runScenario(page, name) {
  await page.evaluate(n => window.__run(n), name)
  await page.waitForSelector('[data-card="a"]', { timeout: 5000 })
}

// ── 1. A pass runs to completion instead of freezing at 0 ──────────────────
await runScenario(page, 'single')
await page.waitForFunction(() => document.querySelector('[data-testid="reloaded-a"]')?.textContent === 'yes', { timeout: 8000 })
check('progress clears when the pass finishes', await txt('progress-a'), 'idle')
check('every photo was decoded', (await page.evaluate(() => window.__decoded)).length, 9)
check('the card reloaded after the pass', await txt('reloaded-a'), 'yes')
check('no tile is left on a spinner', await txt('rendering-a'), '0')
check('exactly one pass ran', await page.evaluate(() => window.__passStarts), 1)

// The regression: the reload hands back a NEW items array. That used to
// re-trigger the effect, abort the pass, and strand progress at 0.
await page.waitForTimeout(400)
check('the reload does not start a second pass', await page.evaluate(() => window.__passStarts), 1)
check('still idle after the reload settles', await txt('progress-a'), 'idle')

// ── 2. Render count stays bounded — the flicker ───────────────────────────
const rendersAfter = await page.evaluate(() => window.__renders)
check('render count is bounded, not a loop', rendersAfter < 40, true)
console.log(`      (renders: ${rendersAfter})`)

// ── 3. New data mid-pass must not cancel the decode ───────────────────────
await runScenario(page, 'single')
await page.waitForFunction(() => window.__decoded.length >= 1, { timeout: 5000 })
await page.click('[data-testid="churn-a"]')   // new items identity, mid-pass
await page.click('[data-testid="churn-a"]')
await page.waitForFunction(() => document.querySelector('[data-testid="reloaded-a"]')?.textContent === 'yes', { timeout: 8000 })
check('a pass survives new data arriving mid-flight', (await page.evaluate(() => window.__decoded)).length, 9)
check('churn did not start a competing pass', await page.evaluate(() => window.__passStarts), 1)

// ── 4. Two cards over the same photos ─────────────────────────────────────
await runScenario(page, 'twocards')
await page.waitForFunction(() => document.querySelector('[data-testid="reloaded-a"]')?.textContent === 'yes', { timeout: 9000 })
await page.waitForTimeout(500)
check('two cards decode each photo once, not twice', (await page.evaluate(() => window.__decoded)).length, 9)
check('both cards end idle', [await txt('progress-a'), await txt('progress-b')], ['idle', 'idle'])

// ── 5. A photo that fails still clears the progress line ──────────────────
await runScenario(page, 'withfailure')
await page.waitForFunction(() => document.querySelector('[data-testid="reloaded-a"]')?.textContent === 'yes', { timeout: 8000 })
await page.waitForTimeout(300)
check('progress clears even when a photo fails', await txt('progress-a'), 'idle')
check('the failed photo does not hold a spinner', await txt('rendering-a'), '0')
check('a failed photo is not retried automatically', await page.evaluate(() => window.__passStarts), 1)

// ── 6. Unmounting mid-pass ────────────────────────────────────────────────
await runScenario(page, 'single')
await page.waitForFunction(() => window.__decoded.length >= 1, { timeout: 5000 })
await page.evaluate(() => window.__unmount())
await page.waitForTimeout(400)
const afterUnmount = await page.evaluate(() => window.__decoded.length)
await page.waitForTimeout(400)
check('leaving the record stops the decode', await page.evaluate(() => window.__decoded.length), afterUnmount)
check('no React errors anywhere in the run', errors, [])

await b.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
