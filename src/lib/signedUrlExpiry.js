// ---------------------------------------------------------------------------
// signedUrlExpiry.js — is a Supabase Storage signed URL still usable?
//
// Every private file in LEAP (documents, work-evidence photos) is reached
// through a signed URL: Supabase mints a short-lived JWT and hangs it off the
// URL as `?token=<jwt>`. Storage validates that token's `exp` claim on every
// request, so a URL that has aged past its TTL stops resolving to the file and
// starts resolving to a JSON error:
//
//     {"statusCode":"400","error":"InvalidJWT",
//      "message":"\"exp\" claim timestamp check failed","code":"InvalidJWT"}
//
// A <img> shows that as a broken image; an <iframe> renders the JSON itself,
// which is what a user sees instead of their PDF. The URL is minted once when
// a record page loads its gallery, but the click that uses it can come an hour
// later — so the URL must be checked, and re-signed, at the point of use.
//
// This module is the single definition of "still usable". It is pure and does
// no network work: it reads the `exp` claim out of the token and compares it
// against the clock, with a safety margin so a URL that is about to expire is
// never handed to a download that takes a few seconds to run.
// ---------------------------------------------------------------------------

// A signed URL is refused this many seconds BEFORE its real expiry. Covers the
// round trip plus the time a large file actually spends transferring, so we
// never start a fetch that expires halfway through.
export const SIGNED_URL_EXPIRY_MARGIN_SECONDS = 120

function decodeBase64Url(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(segment.length + ((4 - (segment.length % 4)) % 4), '=')
  if (typeof atob === 'function') return atob(padded)
  // Node (fixture runs) — no atob on very old runtimes.
  if (typeof Buffer !== 'undefined') return Buffer.from(padded, 'base64').toString('binary')
  return null
}

/**
 * Epoch milliseconds at which a signed URL's token expires, or null when the
 * URL carries no readable expiry (not a signed URL at all, or a malformed
 * token). Callers must distinguish those two cases via `hasSignedUrlToken`.
 */
export function signedUrlExpiresAtMs(url) {
  if (!url || typeof url !== 'string') return null
  const match = /[?&]token=([^&#]+)/.exec(url)
  if (!match) return null
  const parts = match[1].split('.')
  if (parts.length < 2) return null
  let payload
  try {
    const json = decodeBase64Url(parts[1])
    if (!json) return null
    payload = JSON.parse(json)
  } catch {
    return null
  }
  const exp = payload?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null
  return exp * 1000
}

/** True when the URL carries a Supabase-style `token` query parameter. */
export function hasSignedUrlToken(url) {
  return !!url && typeof url === 'string' && /[?&]token=[^&#]+/.test(url)
}

/**
 * Whether a URL can be handed to the browser right now.
 *
 *   - No URL at all              → false (nothing to use).
 *   - Not a signed URL           → true  (a public or blob: URL never expires,
 *                                         and there is nothing to re-sign).
 *   - Signed, expiry in future   → true, once the margin is subtracted.
 *   - Signed, expired or garbled → false (re-sign before using).
 */
export function isSignedUrlUsable(url, { nowMs = Date.now(), marginSeconds = SIGNED_URL_EXPIRY_MARGIN_SECONDS } = {}) {
  if (!url || typeof url !== 'string') return false
  if (!hasSignedUrlToken(url)) return true
  const expiresAt = signedUrlExpiresAtMs(url)
  // A token we cannot read is a token we cannot trust — re-sign rather than
  // hand the user a URL that may already be dead.
  if (expiresAt == null) return false
  return expiresAt - marginSeconds * 1000 > nowMs
}

/** True when EVERY supplied URL is usable. Empty/absent entries are ignored. */
export function areSignedUrlsUsable(urls, opts) {
  const present = (urls || []).filter(Boolean)
  if (present.length === 0) return false
  return present.every(u => isSignedUrlUsable(u, opts))
}
