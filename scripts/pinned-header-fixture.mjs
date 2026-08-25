// Fixture: anything pinned with `position: sticky` paints an OPAQUE background.
//
// A pinned header, toolbar or frozen column stays put while content scrolls
// underneath it. If it has no background — or a background that resolves to
// nothing — the content scrolls straight THROUGH it and the two sets of text are
// drawn on top of each other.
//
// That is the bug this suite exists to stop repeating (Nicholas, 2026-08-25, on
// the Enrolments home widget: "when I scroll on a dashboard home widget, the text
// overlaps the column headers. That cannot happen again"). Every pinned header in
// reports and dashboards DID declare `background: C.cardSecondary` — but the
// palette never defined `cardSecondary`, so the declaration was dropped and the
// header painted nothing. Declaring a background is not enough; the value has to
// be a colour, and it has to be opaque.
//
// So this suite reads the value, not just the key:
//   - every style object containing position:'sticky' declares background
//   - every branch of that value (ternaries and || chains included) is either an
//     opaque colour literal or a palette token that IS an opaque colour
//
// Run with:  node scripts/pinned-header-fixture.mjs

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')

let failures = 0
let checks = 0
function check(label, ok, detail) {
  checks += 1
  if (!ok) { failures += 1; console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`) }
}

// ── The palette, and which of its colours are opaque ─────────────────────────
const constantsSrc = readFileSync(join(srcDir, 'data/constants.js'), 'utf8')
const paletteBody = constantsSrc.match(/export const C = \{([\s\S]*?)\n\};/)
const palette = new Map(
  [...(paletteBody?.[1] ?? '').matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*'([^']*)'/gm)].map(m => [m[1], m[2]])
)

const OPAQUE_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const OPAQUE_RGB = /^rgb\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+\s*\)$/i

function isOpaqueColour(value) {
  if (value == null) return false
  const v = String(value).trim()
  if (OPAQUE_HEX.test(v) || OPAQUE_RGB.test(v)) return true
  // rgba() counts only at full alpha; anything less lets rows show through.
  const rgba = v.match(/^rgba\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+\s*[,/]\s*([\d.]+)\s*\)$/i)
  if (rgba) return parseFloat(rgba[1]) === 1
  return false
}

// One branch of a background expression: a quoted literal, or C.<key>.
function describeBranch(branch) {
  const b = branch.trim()
  const literal = b.match(/^['"]([^'"]*)['"]$/)
  if (literal) {
    return isOpaqueColour(literal[1])
      ? { ok: true }
      : { ok: false, why: `'${literal[1]}' is not an opaque colour` }
  }
  const token = b.match(/^C\.([A-Za-z0-9_]+)$/)
  if (token) {
    if (!palette.has(token[1])) return { ok: false, why: `C.${token[1]} is not defined in the palette — it renders as nothing` }
    return isOpaqueColour(palette.get(token[1]))
      ? { ok: true }
      : { ok: false, why: `C.${token[1]} is ${palette.get(token[1])}, which is not opaque` }
  }
  return { ok: false, why: `cannot tell whether \`${b}\` is an opaque colour — use a palette token or a hex literal` }
}

// ── Walk every style object that pins itself ─────────────────────────────────
function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(p)
    else if (/\.jsx?$/.test(entry.name)) yield p
  }
}

// The object literal surrounding an index: back to its unmatched `{`, then
// forward to the brace that closes it.
function enclosingLiteral(text, index) {
  let depth = 0
  let open = -1
  for (let i = index; i >= 0; i--) {
    const c = text[i]
    if (c === '}') depth += 1
    else if (c === '{') { if (depth === 0) { open = i; break } depth -= 1 }
  }
  if (open < 0) return null
  depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) return text.slice(open, i + 1) }
  }
  return null
}

let pinned = 0
for (const file of sourceFiles(srcDir)) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/position:\s*['"]sticky['"]/g)) {
    pinned += 1
    const where = `${relative(root, file)}:${text.slice(0, match.index).split('\n').length}`
    const literal = enclosingLiteral(text, match.index)
    if (!literal) { check(`${where}: pinned style could be read`, false, 'no enclosing object literal found'); continue }

    const declared = literal.match(/\bbackground(?:Color)?\s*:\s*([^,}\n]+)/)
    if (!declared) {
      check(`${where}: pinned element declares a background`, false,
        'a sticky element with no background lets the scrolled content draw through it')
      continue
    }
    // Split ternaries and || chains — every branch is painted at some point.
    // A segment that a `?` follows is the CONDITION, not a colour, so it is
    // dropped: in `isSelected ? '#f0faf6' : C.card` only the last two paint.
    const parts = declared[1].split(/(\?|:|\|\|)/).map(s => s.trim())
    const branches = parts.filter((part, i) =>
      part && part !== '?' && part !== ':' && part !== '||' && parts[i + 1] !== '?')
    for (const branch of branches) {
      const verdict = describeBranch(branch)
      check(`${where}: background \`${branch}\` is an opaque colour`, verdict.ok, verdict.why)
    }
  }
}

check('the scan found the pinned elements', pinned >= 20,
  `only ${pinned} sticky styles found — the scan is probably broken`)

console.log(failures === 0
  ? `pinned-header-fixture: ${checks} checks passed across ${pinned} pinned styles`
  : `pinned-header-fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
