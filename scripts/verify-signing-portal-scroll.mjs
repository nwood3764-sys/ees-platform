// =============================================================================
// verify:signing-portal-scroll — a signer can reach the signature field.
//
// Reported 2026-09-05: "I can't scroll down to review the document. When I
// click the Sign In Submit, it doesn't work." The submit bar read
// "1 of 2 fields complete" and refused with "Please fill all 2 fields".
//
// One root cause for both. src/index.css sets
//   html, body { height: 100%; overflow: hidden }
// for the main app's fixed-sidebar shell, and the signing portal is served
// from the same bundle. It laid itself out as `min-height: 100vh` and relied
// on the WINDOW scrolling — which that rule makes impossible. A document
// taller than the viewport was unreachable, the signature tab sits below the
// fold, so the signer could never fill it and the submit could never pass.
// A customer could not sign at all.
//
// The portal now owns its own scroll container. This check runs a real
// Chromium against the REAL global stylesheet, with the pre-fix shell on the
// same page as a positive control that MUST still come back unreachable.
// Reading the CSS is not verification of this defect — every line of it read
// correctly while nobody could sign.
//
// Not in build:safe (needs a browser binary):
//   npm install --no-save playwright-core && npm run verify:signing-portal-scroll
// =============================================================================

import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'

const globalCss = readFileSync('src/index.css', 'utf8')
let pass = 0, fail = 0
const check = (n, ok) => { ok ? (pass++, console.log(`PASS  ${n}`)) : (fail++, console.log(`FAIL  ${n}`)) }

// A tall document, the header/footer chrome, in both shells.
const doc = '<div style="width:820px">' + Array.from({length:40},(_,i)=>
  `<p style="height:60px;margin:0;background:${i%2?'#eef':'#fff'}">line ${i}</p>`).join('') +
  '<div id="SIGTAB" style="height:40px;background:#3ecf8e">signature field</div></div>'

const page_ = `
<style>${globalCss}</style>
<div id="fixed" style="height:100dvh;display:flex;flex-direction:column;overflow:hidden">
  <header style="flex-shrink:0;height:60px;background:#fff">header</header>
  <main id="fixedScroll" style="flex:1;min-height:0;overflow-y:auto;padding:20px;display:flex;justify-content:center;align-items:flex-start">${doc}</main>
  <footer style="flex-shrink:0;height:80px;background:#fff">footer</footer>
</div>
<div id="control" style="min-height:100vh;display:flex;flex-direction:column">
  <header style="position:sticky;top:0;height:60px;background:#fff">header</header>
  <main id="ctlScroll" style="flex:1;padding:20px;display:flex;justify-content:center">${doc.replace('SIGTAB','SIGTAB_CTL')}</main>
  <footer style="position:sticky;bottom:0;height:80px;background:#fff">footer</footer>
</div>`

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.setContent(page_)

// The global rule really is in force — otherwise this proves nothing.
const bodyOverflow = await p.evaluate(() => getComputedStyle(document.body).overflow)
check('global html/body overflow:hidden is in force', bodyOverflow === 'hidden')
const windowScrollable = await p.evaluate(() => {
  const el = document.scrollingElement || document.documentElement
  window.scrollTo(0, 500)
  return (el.scrollTop || window.scrollY) > 0
})
check('the WINDOW cannot scroll (this is why it broke)', !windowScrollable)

// FIXED shell: main is a real scroller and reaches the signature field.
const fixed = await p.evaluate(() => {
  const m = document.getElementById('fixedScroll')
  const before = m.scrollTop
  m.scrollTop = m.scrollHeight
  const tab = document.getElementById('SIGTAB').getBoundingClientRect()
  const box = m.getBoundingClientRect()
  return { canScroll: m.scrollHeight > m.clientHeight + 2, moved: m.scrollTop > before,
           tabVisible: tab.top >= box.top - 1 && tab.bottom <= box.bottom + 1 }
})
check('fixed: the document pane is scrollable', fixed.canScroll)
check('fixed: it actually scrolls', fixed.moved)
check('fixed: the signature field can be reached', fixed.tabVisible)

// CONTROL: the pre-fix shell must still be unreachable.
const ctl = await p.evaluate(() => {
  const m = document.getElementById('ctlScroll')
  m.scrollTop = m.scrollHeight
  const tab = document.getElementById('SIGTAB_CTL').getBoundingClientRect()
  return { scrolled: m.scrollTop > 0, tabOffscreen: tab.top > window.innerHeight }
})
check('CONTROL: pre-fix pane does not scroll', !ctl.scrolled)
check('CONTROL: pre-fix signature field is off-screen and unreachable', ctl.tabOffscreen)

await b.close()
console.log(`signing-portal-scroll: ${pass} passed${fail?`, ${fail} FAILED`:''}`)
process.exit(fail ? 1 : 0)
