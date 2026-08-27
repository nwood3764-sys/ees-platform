// ---------------------------------------------------------------------------
// storageKey — turning a real-world file name into a Supabase Storage key.
//
// Lucas Wood, 2026-08-27, uploading a manufacturer spec sheet to WO-00208:
//
//   "AZ25E15D – GE Zoneline Deluxe Series Cooling and Electric Heat Unit.pdf:
//    Storage upload failed: Invalid key: work_orders/…__AZ25E15D_–_GE_…pdf"
//
// The same PDF uploaded to the same record by someone else worked. Nothing
// about the record, the bucket, or the person's permissions was involved: the
// file name carried an EN DASH (U+2013, the character Word and every vendor's
// PDF title inserts where a person typed a hyphen), and Supabase Storage
// validates the object key against an ASCII-only character set:
//
//   word characters (ASCII letters, digits, underscore) and  / ! - . * ' ( )
//   space & $ @ = ; : + , ?
//
// Anything else — an en dash, a curly apostrophe, a non-breaking space, an
// accented letter, an emoji, any non-Latin script — is rejected outright with
// "Invalid key", after the bytes have already been uploaded.
//
// The old sanitizer replaced path separators, quotes and whitespace and left
// everything else alone, so it only ever produced a valid key by luck: every
// file anyone had uploaded until now happened to be pure ASCII (verified —
// 0 of 2,503 live storage objects carry a character outside that set).
//
// So the rule here is stated the other way round, which is the only way it can
// be right: an ALLOWLIST of characters known to be safe, and everything else
// becomes an underscore. A name that is entirely unrepresentable (a Japanese
// file name, say) still yields a usable key rather than an error — the storage
// key only has to be readable, since the display name is kept verbatim on the
// documents row and collisions are prevented by the record id in front of it.
// ---------------------------------------------------------------------------

// Typographic characters a person never typed deliberately but which arrive in
// file names constantly (Word autocorrect, a vendor's PDF title, a paste out of
// a spec sheet). Mapped to their ASCII intent so the key stays readable instead
// of decaying into a row of underscores. Written as escapes on purpose — an
// invisible non-breaking space sitting in a character class is unreviewable.
const TYPOGRAPHIC_TO_ASCII = [
  // hyphen, non-breaking hyphen, figure/en/em dash, horizontal bar, minus,
  // small/fullwidth hyphens
  [/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-'],
  // curly single quotes, primes, acute accent used as an apostrophe
  [/[\u2018\u2019\u201A\u201B\u2032\u00B4]/g, ''],
  // curly double quotes and the double prime
  [/[\u201C\u201D\u201E\u201F\u2033]/g, ''],
  [/\u2026/g, '.'],                          // horizontal ellipsis
  [/[\u00D7\u2715\u2716]/g, 'x'],           // multiplication sign / heavy crosses
  // every other flavour of space: NBSP, en/em/thin/hair spaces, narrow NBSP,
  // word joiner, ideographic space, zero-width space
  [/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u2060\u3000]/g, ' '],
]

// What survives into the key. Deliberately narrower than what Supabase itself
// accepts: a key holding spaces, quotes or question marks is legal but has to
// be escaped by every consumer (signed URLs, a download attribute, the Graph
// attachment path), and there is nothing to gain from carrying them.
const UNSAFE_RUN = /[^A-Za-z0-9._-]+/g

const EXTENSION = /\.([A-Za-z0-9]{1,12})$/

/**
 * A file name reduced to characters Supabase Storage accepts in an object key.
 *
 * @param {string} name        the original file name (a full path is accepted;
 *                             only its last segment is used)
 * @param {Object} [opts]
 * @param {string} [opts.fallback='file']  used when nothing survives sanitizing
 * @param {number} [opts.maxLength=120]    cap on the returned name; the
 *                                         extension is preserved, never cut
 * @returns {string}           always a non-empty, key-safe file name
 */
export function storageSafeFileName(name, opts = {}) {
  const fallback = opts.fallback || 'file'
  const maxLength = opts.maxLength || 120

  // A file name is the last path segment — a browser hands us a bare name, but
  // a caller passing a path must never be able to write outside its prefix.
  const raw = String(name == null ? '' : name).split(/[\\/]/).pop() || ''

  // Decompose accents (café → cafe) rather than losing the letter to an
  // underscore, then map the typographic characters worth keeping readable.
  let out = raw.normalize('NFKD').replace(/[\u0300-\u036F]/g, '')
  for (const [pattern, replacement] of TYPOGRAPHIC_TO_ASCII) out = out.replace(pattern, replacement)

  out = out
    .replace(UNSAFE_RUN, '_')
    .replace(/\.{2,}/g, '.')   // never `..` — not a path segment, not a traversal
    .replace(/_{2,}/g, '_')

  // Split the extension off BEFORE trimming, so a name that is entirely
  // unrepresentable (a Japanese file name, say) still returns `file.pdf` and
  // not a file called `pdf`.
  const m = EXTENSION.exec(out)
  const ext = m ? m[0] : ''
  let stem = ext ? out.slice(0, -ext.length) : out
  stem = stem.replace(/^[._-]+/, '').replace(/[._-]+$/, '')
  if (!stem) stem = fallback

  if (stem.length + ext.length > maxLength) {
    stem = stem.slice(0, Math.max(1, maxLength - ext.length)).replace(/[._-]+$/, '') || fallback
  }

  return stem + ext
}

/**
 * Whether a whole storage key (path included) is one Supabase will accept.
 * This is the service's own rule, not ours: word characters plus
 * `/ ! - . * ' ( ) space & $ @ = ; : + , ?`. Used to assert before an upload,
 * so a bad key is named by the code that built it rather than reported by the
 * API after the bytes have crossed the wire.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isStorageSafeKey(key) {
  if (typeof key !== 'string' || key.length === 0) return false
  return /^[\w/!\-.*'() &$@=;:+,?]*$/.test(key)
}
