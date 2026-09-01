// Fixture: every topbar dropdown is PORTALLED, never `position: absolute`.
//
// Nicholas, 2026-09-01, with the Setup gear open on a record page: "I'm having a
// rendering issue when I go to page setup. This gets cut off. Can we make this
// be on top?" Half the menu was drawn under the record's breadcrumb and its
// Edit / Actions buttons.
//
// Nothing was clipping it — it was being PAINTED OVER, and the reason is
// structural rather than a number anyone got wrong:
//
//   • The topbar's right-hand cluster in App.jsx is `position:absolute` with
//     `z-index:10`. A positioned element with a z-index CREATES A STACKING
//     CONTEXT, so every menu inside it is sealed at level 10 — whatever number
//     it gives itself. The gear's menu asked for 50 and the user menu for 500;
//     both were still level 10 to the rest of the page.
//   • The record page's pinned header band (src/lib/stickyRecordHeader.js) sits
//     at z-index 30 in the ROOT stacking context. 30 > 10, so the band and its
//     buttons painted over every one of those menus.
//
// Raising the cluster's number is the fix that comes back — the next pinned
// element that picks 40 breaks it again, and because the symptom LOOKS like
// clipping, the next session goes hunting for an `overflow` rule instead. The
// cure is to leave the page's stacking order entirely: render the panel in a
// portal on document.body (src/components/AnchoredPopover.jsx).
//
// So this suite refuses a hand-rolled `position:'absolute'` panel inside any
// topbar control, and requires each of them to go through AnchoredPopover.
// A POSITIVE CONTROL re-creates the old absolutely-positioned menu and must be
// rejected — if the control ever passes, the scan is not reading these files
// and every other check here is worthless.
//
// Run with:  node scripts/topbar-menu-fixture.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
let checks = 0
function check(label, ok, detail) {
  checks += 1
  if (ok) return
  failures += 1
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`)
}

// The controls that live in the topbar's right-hand cluster and open a panel.
// App.jsx is here for ViewAsControl, which is declared inline in it.
const TOPBAR_SOURCES = [
  'src/components/TopbarSetupGear.jsx',
  'src/components/NotificationBell.jsx',
  'src/components/TopbarUserMenu.jsx',
  'src/App.jsx',
]

// ── The rule, as a function, so the positive control runs the same code ──────
// A PANEL is a style object that positions itself with `absolute`, claims a
// z-index, AND paints a dropdown's chrome (a background, border or drop
// shadow). All three together are what the defect looked like: a menu trying to
// win a stacking fight it cannot win from inside the cluster.
//
// Both of the other two are needed to tell a panel from the things that are
// legitimately absolute in a topbar:
//
//   • the cluster itself — `position:absolute; z-index:10`, and it must stay
//     that way, since it layers the Help / bell / gear / avatar row over the
//     centred search bar. It paints nothing, so the chrome test excludes it. It
//     is checked separately below, as the stacking context it is.
//   • the bell's unread badge — absolute and painted, but it has no z-index; it
//     is a mark on its own button, not a panel over the page.
// Brace-BALANCED extraction, not `/\{[^{}]*\}/`. Nearly every panel in this
// codebase writes `border: \`1px solid ${C.border}\``, and a non-nesting regex
// stops dead at that inner brace — so the naive version silently skipped the
// exact style objects this suite exists to read, while still matching simpler
// ones and looking like it worked. The positive control below is what caught
// that; keep it.
export function styleObjects(source) {
  const blocks = []
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '{') continue
    let depth = 0
    let end = -1
    for (let j = i; j < source.length; j += 1) {
      if (source[j] === '{') depth += 1
      else if (source[j] === '}') {
        depth -= 1
        if (depth === 0) { end = j; break }
      }
    }
    if (end === -1) continue
    blocks.push(source.slice(i, end + 1))
  }
  return blocks
}

// A component body is also brace-balanced and can satisfy the rule by accident,
// with `position:'absolute'` from one style object and `background:` from
// another 300 lines away. Two constraints keep this to real style objects:
// a style object contains no JSX, and we keep only the INNERMOST block that
// satisfies the rule, so an enclosing body never stands in for the panel it
// holds.
const looksLikeStyleObject = (block) =>
  !/<[A-Za-z]/.test(block) && !/\breturn\b/.test(block) && block.length < 2000

export function absolutelyPositionedPanels(source) {
  const candidates = styleObjects(source).filter(block =>
    /position:\s*'absolute'/.test(block) &&
    /zIndex:/.test(block) &&
    /\bbackground:|\bboxShadow:|\bborder:/.test(block) &&
    looksLikeStyleObject(block))
  return candidates
    .filter(block => !candidates.some(other => other !== block && block.includes(other)))
    .map(block => block.replace(/\s+/g, ' ').slice(0, 120))
}

for (const rel of TOPBAR_SOURCES) {
  const src = readFileSync(join(root, rel), 'utf8')
  const offenders = absolutelyPositionedPanels(src)
  check(`${rel}: no hand-rolled absolutely-positioned panel`, offenders.length === 0,
    offenders.length
      ? `${offenders.length} found — portal it with AnchoredPopover instead:\n      ${offenders.join('\n      ')}`
      : undefined)
  check(`${rel}: opens its panel through AnchoredPopover`,
    /AnchoredPopover/.test(src),
    'the topbar cluster is a z-index:10 stacking context — an in-layout panel loses to the record header')
}

// ── The three z-indexes involved, read rather than assumed ───────────────────
const popover = readFileSync(join(root, 'src/components/AnchoredPopover.jsx'), 'utf8')
const bandZ = Number(
  readFileSync(join(root, 'src/lib/stickyRecordHeader.js'), 'utf8')
    .match(/stickyHeaderBandStyle\(\{[^}]*zIndex\s*=\s*(\d+)/)?.[1] ?? NaN)
const panelZ = Number(popover.match(/zIndex\s*=\s*(\d+)/)?.[1] ?? NaN)
check('the record header band declares a z-index the fixture can read', Number.isFinite(bandZ))
check('the popover declares a z-index the fixture can read', Number.isFinite(panelZ))
check(`the portalled panel outranks the record header band (${panelZ} > ${bandZ})`, panelZ > bandZ,
  'both are in the root stacking context once the panel is portalled, so the numbers finally mean something')

// ── The cluster, which is why none of this could be fixed with a number ──────
// Recorded rather than "fixed": the cluster's z-index is doing real work, and
// the next reader needs to know the stacking context is deliberate and that
// portalling — not a bigger number — is what gets a menu out of it.
const appSrc = readFileSync(join(root, 'src/App.jsx'), 'utf8')
const cluster = styleObjects(appSrc)
  .filter(b => /position:\s*'absolute'/.test(b) && /zIndex:\s*\d/.test(b) && /pointerEvents/.test(b))
  .sort((a, b) => a.length - b.length)[0]
check('the topbar cluster is still a stacking context the fixture knows about',
  !!cluster,
  'App.jsx no longer has the absolutely-positioned right-hand cluster this suite was written against — re-read it')
const clusterZ = Number(cluster?.match(/zIndex:\s*(\d+)/)?.[1] ?? NaN)
check('a panel inside the cluster could not outrank the record header by any number it picks',
  Number.isFinite(clusterZ) && clusterZ < bandZ,
  `cluster z-index ${clusterZ} vs band ${bandZ} — if the cluster ever outranks the band, this suite's premise has changed`)

// ── The portal itself ────────────────────────────────────────────────────────
check('AnchoredPopover renders into document.body',
  /createPortal\([\s\S]*document\.body/.test(popover),
  'a panel that stays in the page can always be painted over by something in it')
check('AnchoredPopover positions the panel with `fixed`, not `absolute`',
  /position:\s*'fixed'/.test(popover) && !/position:\s*'absolute'/.test(popover))
check('AnchoredPopover can carry a menu role',
  /role\s*=\s*'dialog'/.test(popover) && /role=\{role\}/.test(popover),
  'a list of commands is a menu, not a dialog — the role has to be the caller’s to set')

// ── The stale close handler, which is the trap inside the fix ────────────────
// AnchoredPopover owns outside-click and Escape. A component that ALSO keeps a
// `wrapRef.current.contains(e.target)` test closes its own panel the instant
// you click a row in it, because a portalled panel is not inside wrapRef.
for (const rel of TOPBAR_SOURCES.filter(f => f !== 'src/App.jsx')) {
  const src = readFileSync(join(root, rel), 'utf8')
  check(`${rel}: no leftover wrapRef outside-click test`,
    !/wrapRef/.test(src),
    'a portalled panel is not inside the trigger’s wrapper — this closes the menu on its own rows')
}

// ── Positive control: the code as it shipped before this fix ─────────────────
// If this passes, the scan above is not looking at anything.
const OLD_GEAR_MENU = `
  {open && (
    <div role="menu" style={{
      position: 'absolute',
      top: 'calc(100% + 6px)',
      right: 0,
      minWidth: 240,
      background: '#fff',
      border: \`1px solid \${C.border}\`,
      boxShadow: '0 6px 16px rgba(15, 23, 42, 0.10)',
      zIndex: 50,
      padding: '4px 0',
    }}>menu</div>
  )}
`
check('positive control: the old absolutely-positioned gear menu is rejected',
  absolutelyPositionedPanels(OLD_GEAR_MENU).length === 1,
  'the scan did not flag the exact markup that caused the defect — it is not reading style objects')

console.log(failures === 0
  ? `topbar-menu-fixture: ${checks} checks passed — ${TOPBAR_SOURCES.length} topbar controls portalled, panel z-index ${panelZ} over band ${bandZ}`
  : `topbar-menu-fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
