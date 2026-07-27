// Guard for number inputs.
//
// Business number fields in LEAP — bedrooms, square footage, floor level, unit
// counts, quantities, amounts, durations, odometer readings — are never
// negative. A native <input type="number"> lets a user reach a negative value
// three ways: the spinner down-arrow, typing a leading "-", or pasting "-6".
// These helpers close all three on any input they're wired into.
//
// A field that legitimately needs negatives (rare — e.g. a chart reference
// line) opts out by passing allowNegative: true, which restores the browser
// default. Nothing is hardcoded per-field: the caller supplies the flag.

// onKeyDown guard: block the minus/plus sign keys so a negative can't be typed
// in the first place. Everything else — digits, the decimal point, edit and
// navigation keys — passes through untouched. Compose with an existing
// onKeyDown handler via composeKeyDown when the input already has one.
export function blockNegativeKeys(allowNegative = false) {
  return (e) => {
    if (allowNegative) return
    if (e.key === '-' || e.key === '+') e.preventDefault()
  }
}

// Chain the negative-key guard ahead of an input's existing onKeyDown (e.g. the
// Enter/Escape commit handlers on inline list-view editors), so both run.
export function composeKeyDown(existing, allowNegative = false) {
  const guard = blockNegativeKeys(allowNegative)
  return (e) => {
    guard(e)
    if (!e.defaultPrevented && existing) existing(e)
  }
}

// Backstop for the spinner and for pasted text, neither of which fires a
// per-character keydown. Clamps a negative to 0 and leaves empty / null / valid
// values exactly as they were, preserving in-progress typing. Accepts either a
// raw string (straight from the input) or an already-parsed number.
export function clampNonNegative(raw, allowNegative = false) {
  if (allowNegative) return raw
  if (raw === '' || raw == null) return raw
  const n = Number(raw)
  if (Number.isNaN(n)) return raw
  return n < 0 ? 0 : raw
}

// The min attribute value for a number input: 0 unless negatives are allowed,
// in which case leave it unset so the browser imposes no floor.
export function nonNegativeMin(allowNegative = false) {
  return allowNegative ? undefined : 0
}
