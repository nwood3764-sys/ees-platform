// Colour maths for the chart-palette fixture: OKLab/OKLCH, WCAG contrast, and
// the Machado-Oliveira-Fernandes (2009) colour-blindness simulation at severity
// 1.0 — the same model the thresholds are calibrated to, so swapping it would
// invalidate them.
//
// Test-only. It exists so the palette's guarantees are RE-COMPUTED on every
// build rather than trusted from a comment: the previous palette read fine in
// the source and failed every one of these.

const s2lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const hex2srgb = h => { h = h.trim().replace(/^#/, ''); return [0,2,4].map(i => parseInt(h.slice(i, i+2), 16) / 255) }
const lin = h => hex2srgb(h).map(s2lin)
const relLum = h => { const [r,g,b] = lin(h); return 0.2126*r + 0.7152*g + 0.0722*b }

export function contrast(a, b) {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function oklabFromLin([r, g, b]) {
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)
  return [
    0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
    1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.8086757660*s,
  ]
}

/** OKLCH [L, C, H°] of a hex. */
export function oklch(hex) {
  const [L, a, b] = oklabFromLin(lin(hex))
  return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360]
}

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
const simulate = (hex, kind) => {
  const v = lin(hex), M = MACHADO[kind]
  return M.map(row => row[0]*v[0] + row[1]*v[1] + row[2]*v[2])
}

/** Euclidean distance in OKLab ×100, optionally under a simulated CVD. */
export function deltaE(a, b, kind = null) {
  const A = oklabFromLin(kind ? simulate(a, kind) : lin(a))
  const B = oklabFromLin(kind ? simulate(b, kind) : lin(b))
  return Math.hypot(A[0]-B[0], A[1]-B[1], A[2]-B[2]) * 100
}

/** The worst pair on a list of index pairs, under protan and deutan. */
export function worstPair(palette, pairs) {
  let worst = { d: Infinity, kind: null, a: null, b: null }
  for (const kind of ['protan', 'deutan']) {
    for (const [i, j] of pairs) {
      const d = deltaE(palette[i], palette[j], kind)
      if (d < worst.d) worst = { d, kind, a: palette[i], b: palette[j] }
    }
  }
  return worst
}

/** Worst pair with full colour vision — neighbours must be separable for everyone. */
export function worstPairNormal(palette, pairs) {
  let worst = { d: Infinity, a: null, b: null }
  for (const [i, j] of pairs) {
    const d = deltaE(palette[i], palette[j])
    if (d < worst.d) worst = { d, a: palette[i], b: palette[j] }
  }
  return worst
}

export const chainPairs = n => Array.from({ length: n - 1 }, (_, i) => [i, i + 1])

/**
 * The pairs a pie of n slices puts side by side: consecutive, plus the wrap
 * from the last slice back to the first. This is the pairlist the linear
 * check misses, and the one that caught two greens touching.
 */
export const ringPairs = n => n < 3 ? chainPairs(n) : [...chainPairs(n), [n - 1, 0]]

export const THRESHOLDS = {
  BAND_LIGHT: [0.43, 0.77],   // OKLCH L
  CHROMA_FLOOR: 0.10,         // below this a hue reads as gray
  CVD_TARGET: 8.0,            // OKLab ΔE×100, protan/deutan
  NORMAL_FLOOR: 15.0,         // OKLab ΔE×100, full colour vision
  CONTRAST_MIN: 3.0,          // WCAG vs the chart surface
}
