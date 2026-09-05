// =============================================================================
// verify:signing-tab-click — every signature box on the document is clickable.
//
// Nicholas, 2026-09-05, on a real proposal sent to himself: "I can't click
// Sign. I can't do anything. The customer should be able to click the blue box
// and then click Sign." The date box beside it was filled and green.
//
// The cause was invisible in the CSS, which is why this is a browser check.
// SigningPortal rendered ONE overlay layer PER TAB, each spanning the whole
// PDF page (`position:absolute; inset:0`) and each turning `pointer-events`
// back ON. Layers stack in append order, so the LAST tab's transparent
// full-page layer sat on top of every marker before it and swallowed their
// clicks. With a signature tab and a date tab, the date's layer covered the
// signature marker: clicking Sign landed on a transparent div with no handler
// and did nothing, while the date — a child of the topmost layer — worked.
// Every line of that CSS reads correctly. Only a browser can say which
// element a pixel actually belongs to.
//
// The check drives REAL clicks at the centre of each marker over the real
// geometry, and carries the PRE-FIX layering on the same page as a positive
// control that MUST still come back unclickable.
//
// Not in build:safe (needs a browser binary):
//   npm install --no-save playwright-core && npm run verify:signing-tab-click
// =============================================================================

import { chromium } from 'playwright-core'

let pass = 0, fail = 0
const check = (n, ok) => { ok ? (pass++, console.log(`PASS  ${n}`)) : (fail++, console.log(`FAIL  ${n}`)) }

// The real shape of ENV-00016: two tabs on one page, signature first, date
// second — the order send-envelope emits and the order that broke.
const TABS = [
  { id: 'sig',  type: 'signature', left: 90,  top: 620, w: 200, h: 34 },
  { id: 'date', type: 'date',      left: 330, top: 620, w: 120, h: 34 },
]

const marker = (t, extra = '') => `
  <div data-signing-tab="${t.id}" data-signing-tab-type="${t.type}"
       onclick="window.__hits.push('${t.id}')"
       style="position:absolute;left:${t.left}px;top:${t.top}px;width:${t.w}px;height:${t.h}px;
              ${extra}background:rgba(126,179,232,0.30);border:2px solid #7eb3e8;border-radius:4px;"></div>`

// FIXED: one inert layer for the page, markers turn pointer events back on.
const fixedPage = `
<div id="fixedWrap" style="position:relative;width:820px;height:1060px;background:#fff">
  <canvas width="820" height="1060" style="display:block"></canvas>
  <div style="position:absolute;inset:0;pointer-events:none">
    ${TABS.map(t => marker(t, 'pointer-events:auto;')).join('')}
  </div>
</div>`

// CONTROL: the pre-fix shape — one full-page interactive layer PER tab.
const ctlPage = `
<div id="ctlWrap" style="position:relative;width:820px;height:1060px;background:#fff">
  <canvas width="820" height="1060" style="display:block"></canvas>
  ${TABS.map(t => `
    <div style="position:absolute;inset:0;pointer-events:none">
      <div style="position:absolute;inset:0;pointer-events:auto">
        ${marker({ ...t, id: 'ctl_' + t.id })}
      </div>
    </div>`).join('')}
</div>`

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await b.newPage({ viewport: { width: 1000, height: 900 } })
await p.setContent(`<body style="margin:0"><script>window.__hits=[]</script>
  ${fixedPage}<div style="height:40px"></div>${ctlPage}</body>`)

// A REAL mouse click at the centre of the marker's box — not element.click(),
// which would report an interception as an error instead of doing what a
// customer's mouse does. Scroll first: an element below the fold has a box
// outside the viewport and the click would land nowhere, which reads as the
// defect rather than as a harness mistake.
async function clickCentre(sel) {
  const el = await p.$(sel)
  if (!el) return null
  await el.scrollIntoViewIfNeeded()
  const box = await el.boundingBox()
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  return box
}

// ── What element actually owns the pixel at the centre of each marker ──────
for (const t of TABS) {
  const owns = await p.evaluate((id) => {
    const el = document.querySelector(`#fixedWrap [data-signing-tab="${id}"]`)
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit === el || el.contains(hit)
  }, t.id)
  check(`the ${t.type} marker owns its own centre pixel`, owns === true)
}

// ── Real clicks reach both markers ─────────────────────────────────────────
await p.evaluate(() => { window.__hits = [] })
for (const t of TABS) await clickCentre(`#fixedWrap [data-signing-tab="${t.id}"]`)
const hits = await p.evaluate(() => window.__hits)
check('clicking the signature box fires its handler', hits.includes('sig'))
check('clicking the date box fires its handler',      hits.includes('date'))
check('both boxes are reachable, not just the last one', hits.length === 2)

// ── The layer itself must never take pointer events ────────────────────────
const layerInert = await p.evaluate(() => {
  const el = document.querySelector('#fixedWrap [data-signing-tab="sig"]')
  const layer = el.parentElement
  return getComputedStyle(layer).pointerEvents === 'none'
})
check('the overlay layer is inert (pointer-events:none)', layerInert === true)

const oneLayer = await p.evaluate(() =>
  document.querySelectorAll('#fixedWrap [data-signing-tab]').length === 2 &&
  new Set([...document.querySelectorAll('#fixedWrap [data-signing-tab]')]
    .map(e => e.parentElement)).size === 1)
check('all markers on a page share ONE layer', oneLayer === true)

// ── CONTROL: the old shape must STILL be broken ────────────────────────────
await p.evaluate(() => { window.__hits = [] })
for (const t of TABS) await clickCentre(`#ctlWrap [data-signing-tab="ctl_${t.id}"]`)
const ctlHits = await p.evaluate(() => window.__hits)
check('CONTROL: the pre-fix layering still swallows the signature click',
  !ctlHits.includes('ctl_sig'))
check('CONTROL: the pre-fix layering still lets the LAST tab through',
  ctlHits.includes('ctl_date'))

const ctlOwns = await p.evaluate(() => {
  const el = document.querySelector('#ctlWrap [data-signing-tab="ctl_sig"]')
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return hit === el || el.contains(hit)
})
check('CONTROL: the pre-fix signature marker still does not own its pixel', ctlOwns === false)

await b.close()
console.log(`verify:signing-tab-click: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
if (fail) process.exit(1)
