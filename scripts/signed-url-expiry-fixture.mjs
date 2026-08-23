// ---------------------------------------------------------------------------
// signed-url-expiry-fixture.mjs
//
// Pins src/lib/signedUrlExpiry.js — the rule that decides whether a Supabase
// Storage signed URL can still be handed to the browser.
//
// The bug this guards against (2026-08-23): a PDF preview opened from an
// enrollment's Documents card rendered Storage's error body
//   {"statusCode":"400","error":"InvalidJWT","message":"\"exp\" claim ..."}
// inside the iframe, because the URL had been signed when the record page
// loaded and the click came after the 1-hour TTL lapsed.
//
// The dangerous cases are the two ends: a URL that is NOT signed at all must
// stay usable (nothing to re-sign), and a token we cannot read must NOT be
// treated as usable.
// ---------------------------------------------------------------------------

import {
  signedUrlExpiresAtMs,
  hasSignedUrlToken,
  isSignedUrlUsable,
  areSignedUrlsUsable,
  SIGNED_URL_EXPIRY_MARGIN_SECONDS,
} from '../src/lib/signedUrlExpiry.js'

let pass = 0
const failures = []
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass++
  else failures.push(`${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`)
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const NOW = 1_800_000_000_000 // fixed clock; never Date.now()
const at = (nowMs = NOW) => ({ nowMs })

// A signed URL in the shape Supabase actually returns.
function signed(expEpochSeconds, { path = 'enrollments/abc/def__file.pdf' } = {}) {
  const token = [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ url: `property-documents/${path}`, iat: Math.floor(NOW / 1000), exp: expEpochSeconds }),
    'c2lnbmF0dXJl',
  ].join('.')
  return `https://flyjigrijjjtcsvpgzvk.supabase.co/storage/v1/object/sign/property-documents/${path}?token=${token}`
}
const inSeconds = (s) => Math.floor(NOW / 1000) + s

// ── Expiry extraction ──────────────────────────────────────────────────────
check('exp is read out of the token payload',
  signedUrlExpiresAtMs(signed(inSeconds(3600))), (Math.floor(NOW / 1000) + 3600) * 1000)
check('a URL with no token has no expiry',
  signedUrlExpiresAtMs('https://example.org/public/logo.png'), null)
check('a token with no exp claim has no expiry',
  signedUrlExpiresAtMs(`https://x/o?token=${b64url({ alg: 'HS256' })}.${b64url({ url: '/a' })}.sig`), null)
check('a non-numeric exp is rejected',
  signedUrlExpiresAtMs(`https://x/o?token=${b64url({})}.${b64url({ exp: 'soon' })}.sig`), null)
check('garbage in the token position does not throw',
  signedUrlExpiresAtMs('https://x/o?token=not.a.jwt'), null)
check('null input', signedUrlExpiresAtMs(null), null)
check('non-string input', signedUrlExpiresAtMs({ url: 'x' }), null)

// ── Token detection ────────────────────────────────────────────────────────
check('signed URL carries a token', hasSignedUrlToken(signed(inSeconds(60))), true)
check('public URL carries no token', hasSignedUrlToken('https://x/pub/a.png'), false)
check('token as a later query param is still found',
  hasSignedUrlToken('https://x/o?download=Report.pdf&token=a.b.c'), true)
check('a "token" substring in the path is not a token param',
  hasSignedUrlToken('https://x/tokens/a.png'), false)
check('null carries no token', hasSignedUrlToken(null), false)

// ── Usability ──────────────────────────────────────────────────────────────
check('a fresh signed URL is usable', isSignedUrlUsable(signed(inSeconds(3600)), at()), true)
check('an expired signed URL is NOT usable — the reported bug',
  isSignedUrlUsable(signed(inSeconds(-1)), at()), false)
check('an hour-old 1h URL is NOT usable',
  isSignedUrlUsable(signed(inSeconds(0)), at()), false)
check('a URL expiring inside the safety margin is NOT usable',
  isSignedUrlUsable(signed(inSeconds(SIGNED_URL_EXPIRY_MARGIN_SECONDS - 1)), at()), false)
check('a URL expiring just past the margin is usable',
  isSignedUrlUsable(signed(inSeconds(SIGNED_URL_EXPIRY_MARGIN_SECONDS + 5)), at()), true)

// The two dangerous defaults.
check('an UNSIGNED url stays usable — there is nothing to re-sign',
  isSignedUrlUsable('https://x/storage/v1/object/public/avatars/a.png', at()), true)
check('a blob: URL stays usable', isSignedUrlUsable('blob:https://x/9f2a', at()), true)
check('a token we cannot read is NOT usable — never trust an unreadable token',
  isSignedUrlUsable('https://x/o?token=zzzz', at()), false)

check('no URL at all is not usable', isSignedUrlUsable(null, at()), false)
check('empty string is not usable', isSignedUrlUsable('', at()), false)
check('undefined is not usable', isSignedUrlUsable(undefined, at()), false)
check('a non-string is not usable', isSignedUrlUsable(12345, at()), false)

// A download-flavored URL (Content-Disposition: attachment) signs identically.
check('the download variant is judged the same way',
  isSignedUrlUsable(`${signed(inSeconds(3600))}&download=Report.pdf`, at()), true)
check('an expired download variant is refused',
  isSignedUrlUsable(`${signed(inSeconds(-30))}&download=Report.pdf`, at()), false)

// ── Batch form: what the gallery calls ─────────────────────────────────────
check('both URLs fresh → usable',
  areSignedUrlsUsable([signed(inSeconds(3600)), signed(inSeconds(3600))], at()), true)
check('one of the pair expired → the row must be re-signed',
  areSignedUrlsUsable([signed(inSeconds(3600)), signed(inSeconds(-5))], at()), false)
check('a null alongside a fresh URL is ignored, not fatal',
  areSignedUrlsUsable([signed(inSeconds(3600)), null], at()), true)
check('nothing present at all → re-sign',
  areSignedUrlsUsable([null, undefined], at()), false)
check('an empty list → re-sign', areSignedUrlsUsable([], at()), false)
check('a missing list → re-sign', areSignedUrlsUsable(undefined, at()), false)

// ── Clock movement: the same URL flips as time passes ──────────────────────
const url = signed(inSeconds(3600))
check('usable now', isSignedUrlUsable(url, at(NOW)), true)
check('usable 30 minutes in', isSignedUrlUsable(url, at(NOW + 30 * 60_000)), true)
check('not usable 59m30s in — inside the margin',
  isSignedUrlUsable(url, at(NOW + 59.5 * 60_000)), false)
check('not usable 90 minutes in', isSignedUrlUsable(url, at(NOW + 90 * 60_000)), false)

if (failures.length) {
  console.error(`signed-url-expiry-fixture: ${failures.length} FAILED, ${pass} passed\n`)
  failures.forEach(f => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log(`signed-url-expiry-fixture: ${pass} checks passed`)
