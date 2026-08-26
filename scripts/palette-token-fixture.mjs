// Fixture: no code may name a LEAP colour the palette does not define.
//
// `src/data/constants.js` exports `C`, the one place a LEAP colour is named.
// A key that is referenced but not defined evaluates to `undefined`, and
// `background: undefined` is not an error — React drops the declaration and the
// surface renders transparent. That is silent: nothing throws, nothing warns,
// and the page looks *nearly* right.
//
// It bit hard. `C.cardSecondary` — the secondary card surface in the design
// system since day one — was referenced in 34 files and defined in none, so
// every pinned table header in reports and dashboards painted no background and
// the rows scrolled straight through it (Nicholas, 2026-08-25, on the Enrolments
// home widget: "the text overlaps the column headers"). Several sessions moved
// the sticky rule around; the background had never painted.
//
// Two checks:
//   1. every C.<key> referenced anywhere in src/ exists in the palette
//   2. the design system's own named colours exist, with the documented values
//
// Run with:  node scripts/palette-token-fixture.mjs

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

// ── The palette, read the way the app reads it ───────────────────────────────
const constantsPath = join(srcDir, 'data/constants.js')
const constantsSrc = readFileSync(constantsPath, 'utf8')
const paletteBody = constantsSrc.match(/export const C = \{([\s\S]*?)\n\};/)
if (!paletteBody) {
  console.error('FAIL  could not find `export const C = { … };` in src/data/constants.js')
  process.exit(1)
}
const defined = new Map(
  [...paletteBody[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*'([^']*)'/gm)].map(m => [m[1], m[2]])
)

// ── 1. Every referenced key is defined ───────────────────────────────────────
//
// Scoped to files that import C from constants: `C` is also a local colour
// object inside the paperwork/PDF builders, and those are a different palette.
const IMPORTS_C = /import\s*\{[^}]*\bC\b[^}]*\}\s*from\s*['"][^'"]*constants['"]/

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(p)
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) yield p
  }
}

const referenced = new Map() // key -> Set(file)
for (const file of sourceFiles(srcDir)) {
  const text = readFileSync(file, 'utf8')
  if (!IMPORTS_C.test(text)) continue
  for (const m of text.matchAll(/\bC\.([A-Za-z0-9_]+)\b/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], new Set())
    referenced.get(m[1]).add(relative(root, file))
  }
}

check('the scan found the palette in use', referenced.size > 5,
  `only ${referenced.size} distinct C.<key> references found — the scan is probably broken`)

for (const [key, files] of [...referenced].sort()) {
  const where = [...files].slice(0, 3).join(', ') + (files.size > 3 ? ` (+${files.size - 3} more)` : '')
  check(`C.${key} is defined in the palette`, defined.has(key),
    `referenced in ${where} — add it to C in src/data/constants.js, or point the code at the token that already means this`)
}

// ── 2. The design system's named colours exist, with their documented values ──
//
// From CLAUDE.md → Design system. These are the ones a surface is built from;
// if one goes missing the surface silently loses its paint.
const DESIGN_SYSTEM = {
  sidebar:        '#07111f',
  page:           '#f0f3f8',
  card:           '#ffffff',
  cardSecondary:  '#f7f9fc',
  border:         '#e4e9f2',
  borderDark:     '#d0d8e8',
  emerald:        '#3ecf8e',
  emeraldMid:     '#2aab72',
  sky:            '#7eb3e8',
  textPrimary:    '#0d1a2e',
  textSecondary:  '#4a5e7a',
  textMuted:      '#8fa0b8',
}
for (const [key, value] of Object.entries(DESIGN_SYSTEM)) {
  check(`design system: C.${key} === ${value}`, defined.get(key) === value,
    `palette has ${defined.has(key) ? defined.get(key) : '(undefined)'}`)
}

// No red or orange anywhere in the palette — error and warning states are blue
// or navy (CLAUDE.md, absolute). A hex whose red channel dominates both others
// by a wide margin is one of those, and would read as a rule change.
for (const [key, value] of defined) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) continue
  const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
  check(`C.${key} is not a red/orange`, !(r > 150 && r - g > 60 && r - b > 60), `${value}`)
}

console.log(failures === 0
  ? `palette-token-fixture: ${checks} checks passed`
  : `palette-token-fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
