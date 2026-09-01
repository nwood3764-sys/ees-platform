// =============================================================================
// statusPathLabels — what a status chevron is allowed to say
//
// LEAP names every status "[Object] [State]" (the platform's explicit-status
// rule), so a nine-stage incentive-application path repeats the words
// "Incentive Application" nine times and has ~40px of room left over for the
// part that differs. The strip then reads:
//
//   pplication To B | pplication To | plication To B | ... | Application V
//
// The shared half is what the record page already tells you — you are on an
// incentive application — so the chevron carries the STATE and the full label
// stays on the hover tooltip and on the line under the strip.
//
// The prefix is DERIVED from the stage set, never hardcoded per object: a set
// with nothing in common (work_order_status: "New", "Scheduled", …) is left
// exactly as it is. Three rules keep the derivation honest:
//
//   1. Whole words only. "Pre-Approved" is never cut to "Approved".
//   2. Every stage keeps at least one word, and the shortened stages stay
//      distinct from one another — a path with two chevrons reading the same
//      thing is worse than a path of long labels.
//   3. The prefix may not end on a function word, so "To Be Prepared" /
//      "To Be Verified" is left alone. What is worth dropping is an object
//      name ("Enrollment", "Payment Request"), not a piece of grammar.
// =============================================================================

// Words that carry no identity on their own. A candidate prefix ending on one
// of these is grammar, not a subject, so it is backed off a word at a time.
const FUNCTION_WORDS = new Set([
  'a', 'an', 'and', 'at', 'be', 'been', 'being', 'by', 'for', 'from', 'in',
  'is', 'not', 'of', 'on', 'or', 'the', 'to', 'with',
])

// Punctuation a stage uses to separate its state from a qualifier
// ("Submitted — Awaiting Program Response"). Left stranded by a strip, it is
// dropped with the prefix.
const LEADING_SEPARATOR = /^[—–\-:·|,]+\s*/

const words = (label) => String(label ?? '').trim().split(/\s+/).filter(Boolean)

/**
 * The leading words every label shares, as a string — '' when there is no
 * prefix worth dropping. Comparison is case-insensitive; the casing returned
 * is the first label's.
 */
export function sharedStatusLabelPrefix(labels) {
  const rows = (labels || []).map(words).filter(w => w.length > 0)
  if (rows.length < 2) return ''

  // Never consume a whole label: every stage keeps at least one word.
  const limit = Math.min(...rows.map(w => w.length)) - 1
  if (limit < 1) return ''

  let common = 0
  while (common < limit) {
    const word = rows[0][common].toLowerCase()
    if (!rows.every(w => w[common].toLowerCase() === word)) break
    common += 1
  }

  // Back off a word at a time: the longest common run may end on a function
  // word, or may collapse two stages onto the same shortened label.
  for (let n = common; n >= 1; n -= 1) {
    if (FUNCTION_WORDS.has(rows[0][n - 1].toLowerCase())) continue
    const shortened = rows.map(w => trimSeparator(w.slice(n).join(' ')))
    if (shortened.some(s => !s)) continue
    if (new Set(shortened.map(s => s.toLowerCase())).size !== shortened.length) continue
    return rows[0].slice(0, n).join(' ')
  }
  return ''
}

/** One label with `prefix` removed. Returns the label untouched if it doesn't carry the prefix. */
export function shortStatusLabel(label, prefix) {
  const text = String(label ?? '').trim()
  if (!prefix) return text
  const w = words(text)
  const p = words(prefix)
  if (w.length <= p.length) return text
  for (let i = 0; i < p.length; i += 1) {
    if (w[i].toLowerCase() !== p[i].toLowerCase()) return text
  }
  return trimSeparator(w.slice(p.length).join(' ')) || text
}

/** Every label shortened by their own shared prefix, in the order given. */
export function stripSharedStatusPrefix(labels) {
  const prefix = sharedStatusLabelPrefix(labels)
  return (labels || []).map(l => shortStatusLabel(l, prefix))
}

function trimSeparator(text) {
  return String(text ?? '').replace(LEADING_SEPARATOR, '').trim()
}
