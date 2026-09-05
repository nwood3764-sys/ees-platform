// =============================================================================
// modal-dismiss-fixture — a modal is never dismissed by a drag that merely
// ENDED on its backdrop.
//
// Nicholas, 2026-09-05, on the Send Proposal for Signature dialog: "when I
// click in and I highlight, and then when I click up, the dialog disappears...
// if I click just in it and then I use my keyboard to delete the existing
// text, it's fine."
//
// A `click` fires on the nearest common ancestor of where the mouse went DOWN
// and where it came UP. Drag-select inside a text field, release past the edge
// of the card, and that ancestor is the backdrop — so `onClick={onClose}`
// fires, and so does the more careful-looking
// `onClick={e => { if (e.target === e.currentTarget) onClose() }}`, because
// e.target IS the backdrop on that event. Both readings look correct. The
// dialog vanishes taking the address he was editing with it, and this was on
// 28 backdrops across the platform.
//
// Two guards: the decision itself is pinned as a pure function, and no
// backdrop may hand-roll the old shapes again.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { shouldDismissOnBackdrop, backdropDismissProps } from '../src/lib/modalDismiss.js'

let pass = 0, fail = 0
const check = (n, ok) => { ok ? (pass++, console.log(`PASS  ${n}`)) : (fail++, console.log(`FAIL  ${n}`)) }

// ── The rule ───────────────────────────────────────────────────────────────
check('a deliberate click on the backdrop closes',        shouldDismissOnBackdrop(true, true) === true)
check('a drag OUT of the card onto the backdrop does not', shouldDismissOnBackdrop(false, true) === false)
check('a press on the backdrop released in the card does not', shouldDismissOnBackdrop(true, false) === false)
check('a click entirely inside the card does not',         shouldDismissOnBackdrop(false, false) === false)

// The reported case, stated as itself: mouse DOWN in the email input, UP on
// the backdrop. The old `e.target === e.currentTarget` test would have said
// yes here, because on that click e.target is the backdrop.
check('THE REPORTED CASE: drag-select from a field, release on the backdrop, stays open',
  shouldDismissOnBackdrop(false, true) === false)

// ── The handlers behave the same way against a DOM-shaped stand-in ─────────
function drive(props, downOn, upOn) {
  const backdrop = { dataset: {} }
  let closed = false
  const p = props(() => { closed = true })
  p.onMouseDown?.({ target: downOn === 'backdrop' ? backdrop : {}, currentTarget: backdrop })
  p.onMouseUp?.({   target: upOn   === 'backdrop' ? backdrop : {}, currentTarget: backdrop })
  return closed
}
check('handlers close on backdrop-down + backdrop-up',
  drive(backdropDismissProps, 'backdrop', 'backdrop') === true)
check('handlers ignore card-down + backdrop-up',
  drive(backdropDismissProps, 'card', 'backdrop') === false)
check('handlers ignore backdrop-down + card-up',
  drive(backdropDismissProps, 'backdrop', 'card') === false)

// A second gesture must not inherit the first one's arming.
;(() => {
  const backdrop = { dataset: {} }
  let n = 0
  const p = backdropDismissProps(() => { n++ })
  p.onMouseDown({ target: backdrop, currentTarget: backdrop })
  p.onMouseUp({   target: backdrop, currentTarget: backdrop })
  p.onMouseUp({   target: backdrop, currentTarget: backdrop })   // stray release
  check('a stray second release does not close again', n === 1)
})()

// A backdrop that must not be dismissed mid-save gets no handlers at all,
// rather than a no-op that could arm and then fire once the save finishes.
check('a disabled backdrop exposes no handlers',
  Object.keys(backdropDismissProps(() => {}, { disabled: true })).length === 0)
check('a backdrop with no onClose exposes no handlers',
  Object.keys(backdropDismissProps(undefined)).length === 0)

// ── No backdrop hand-rolls the old shapes ──────────────────────────────────
const files = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e)
    if (statSync(f).isDirectory()) walk(f)
    else if (f.endsWith('.jsx')) files.push(f)
  }
})('src')

const offenders = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((l, i) => {
    const ctx = lines.slice(Math.max(0, i - 5), i + 7).join('\n')
    const isBackdrop = ((ctx.includes('inset: 0') || ctx.includes('inset:0')) && ctx.includes('fixed'))
      || /style=\{(overlay|backdrop|scrim)\b/.test(l)
    if (!isBackdrop) return
    if (l.includes('<button') || l.includes('aria-label')) return
    if (/onClick=\{\(e\)\s*=>\s*\{\s*if\s*\(e\.target\s*===\s*e\.currentTarget/.test(l)
        || /onClick=\{(onClose|onCancel)\}/.test(l)
        || /onClick=\{[A-Za-z_$][\w$.]*\s*\?\s*undefined\s*:\s*(onClose|onCancel)\}/.test(l)) {
      offenders.push(`${f}:${i + 1}`)
    }
  })
}
if (offenders.length) offenders.forEach(o => console.log(`      hand-rolled backdrop dismiss at ${o}`))
check('no backdrop dismisses on a raw click', offenders.length === 0)

// The rule is actually in use, so the check above cannot pass by there being
// no backdrops left at all.
const wired = files.filter(f => readFileSync(f, 'utf8').includes('backdropDismissProps(')).length
check('the shared rule is wired into the platform\'s backdrops', wired >= 25)

console.log(`modal-dismiss-fixture: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
if (fail) process.exit(1)
