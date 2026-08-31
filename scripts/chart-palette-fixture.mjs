// chart-palette fixture — the chart colours are readable, and provably so.
//
// Nicholas, 2026-08-31, asked for the seven series colours to be re-stepped.
// The set they replaced failed every check below while reading perfectly well
// in the source file, which is the whole reason this fixture exists: the
// guarantees are RE-COMPUTED here on every build, never trusted from a comment.
//
// The checks are the data-viz standard: an OKLCH lightness band and chroma
// floor, WCAG contrast against the surfaces a widget actually sits on, and
// OKLab ΔE separation under the Machado (2009) colour-blindness simulation.

import { CHART_COLORS } from '../src/data/constants.js'
import {
  contrast, oklch, deltaE, worstPair, worstPairNormal,
  chainPairs, ringPairs, THRESHOLDS as T,
} from './lib/paletteChecks.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) pass++
  else { fail++; console.error(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`) }
}
const check = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`)

// The two surfaces a chart is drawn on. A widget body is the white card; a
// tile header and several module panels are the secondary card — a colour that
// only clears contrast on one of them is readable on half the platform.
const CARD = '#ffffff', CARD2 = '#f7f9fc'

check('seven slots', CHART_COLORS.length, 7)
ok('every slot is a six-digit hex', CHART_COLORS.every(c => /^#[0-9a-f]{6}$/.test(c)))
ok('no slot is repeated', new Set(CHART_COLORS).size === CHART_COLORS.length)

// ── The design system's own rule: no red, no orange, anywhere ─────────────
// OKLCH hue 0–70° is the red/orange arc, and 70–105° is the amber that means
// "warning" — a status colour, never a series.
for (const c of CHART_COLORS) {
  const H = oklch(c)[2]
  ok(`${c} is not red or orange`, !(H < 70 || H > 345), `hue ${H.toFixed(0)}°`)
  ok(`${c} is not the warning amber`, !(H >= 70 && H <= 105), `hue ${H.toFixed(0)}°`)
}

// ── Lightness band and chroma floor ───────────────────────────────────────
// The band is a RANGE, and the palette uses it: seven identities cannot ride on
// hue alone, because red-green colour blindness collapses the hue channel. The
// set alternates a light and a deep tier so lightness carries part of it.
for (const c of CHART_COLORS) {
  const [L, C] = oklch(c)
  ok(`${c} sits in the lightness band`, L >= T.BAND_LIGHT[0] && L <= T.BAND_LIGHT[1], `L ${L.toFixed(3)}`)
  ok(`${c} clears the chroma floor (does not read gray)`, C >= T.CHROMA_FLOOR, `C ${C.toFixed(3)}`)
}
{
  const Ls = CHART_COLORS.map(c => oklch(c)[0])
  ok('the set really is two tiers, not one flat lightness',
    Math.max(...Ls) - Math.min(...Ls) > 0.12, `spread ${(Math.max(...Ls) - Math.min(...Ls)).toFixed(3)}`)
}

// ── Contrast on BOTH card surfaces ────────────────────────────────────────
// This is the check the old palette failed six times out of seven, and what
// "I can't even see that" looked like from the outside.
for (const c of CHART_COLORS) {
  ok(`${c} clears 3:1 on the white card`, contrast(c, CARD) >= T.CONTRAST_MIN, `${contrast(c, CARD).toFixed(2)}:1`)
  ok(`${c} clears 3:1 on the secondary card`, contrast(c, CARD2) >= T.CONTRAST_MIN, `${contrast(c, CARD2).toFixed(2)}:1`)
}

// ── Separation: the linear chain, for bars, lines, stacks and legends ─────
{
  const w = worstPair(CHART_COLORS, chainPairs(CHART_COLORS.length))
  ok('every adjacent pair separates under protanopia and deuteranopia',
    w.d >= T.CVD_TARGET, `worst ${w.a}↔${w.b} ΔE ${w.d.toFixed(1)} (${w.kind})`)
  const n = worstPairNormal(CHART_COLORS, chainPairs(CHART_COLORS.length))
  ok('and with full colour vision too',
    n.d >= T.NORMAL_FLOOR, `worst ${n.a}↔${n.b} ΔE ${n.d.toFixed(1)}`)
}

// ── Separation: every pie ring ────────────────────────────────────────────
// A pie of n slices closes 1..n back to 1, so slot 1 borders every other slot
// at SOME series count. Checking only the linear chain hides that: the first
// candidate for this palette passed the chain and put two greens together at
// ΔE 3.2 in the seven-slice ring.
for (let n = 2; n <= CHART_COLORS.length; n++) {
  const ring = CHART_COLORS.slice(0, n)
  const w = worstPair(ring, ringPairs(n))
  ok(`a ${n}-slice pie separates every touching pair`,
    w.d >= T.CVD_TARGET, `worst ${w.a}↔${w.b} ΔE ${w.d.toFixed(1)} (${w.kind})`)
}

// ── The maths itself, so a broken checker cannot pass a broken palette ────
// Without these, a bug in paletteChecks.mjs reports every palette as fine.
ok('contrast of a colour with itself is 1:1', Math.abs(contrast('#3ecf8e', '#3ecf8e') - 1) < 1e-9)
ok('black on white is 21:1', Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01)
ok('a colour has zero distance from itself', deltaE('#009c65', '#009c65') < 1e-9)
ok('white is lighter than black in OKLCH', oklch('#ffffff')[0] > oklch('#000000')[0])
ok('gray has no chroma', oklch('#808080')[1] < 0.01)
ok('a saturated hue does', oklch('#009c65')[1] > 0.10)
check('a ring of 3 wraps back to the start', ringPairs(3), [[0,1],[1,2],[2,0]])
check('a pair is not a ring', ringPairs(2), [[0,1]])

// Positive control: the palette this replaced MUST fail, or the fixture is
// measuring nothing. Its known faults are named individually so a future edit
// that "fixes" the checker is caught here rather than in production.
{
  const OLD = ['#3ecf8e','#7eb3e8','#1e466b','#a78bfa','#2aab72','#5eead4','#8fa0b8']
  const bandFails = OLD.filter(c => { const L = oklch(c)[0]; return L < T.BAND_LIGHT[0] || L > T.BAND_LIGHT[1] })
  check('the old palette had two colours outside the lightness band', bandFails, ['#1e466b','#5eead4'])
  const grayFails = OLD.filter(c => oklch(c)[1] < T.CHROMA_FLOOR)
  check('and three that read as gray', grayFails, ['#7eb3e8','#1e466b','#8fa0b8'])
  const dim = OLD.filter(c => contrast(c, CARD) < T.CONTRAST_MIN)
  ok('and six below 3:1 on the white card', dim.length === 6, `${dim.length}: ${dim.join(',')}`)
  ok('so the positive control fails, which proves these checks bite',
    bandFails.length > 0 && grayFails.length > 0 && dim.length > 0)
}

console.log(`chart-palette fixture: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
