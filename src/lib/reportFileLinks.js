// ---------------------------------------------------------------------------
// reportFileLinks — serve a report's file links from LEAP's own domain.
//
// Adobe Acrobat's trust manager prompts before following ANY link out of a PDF:
//
//     Security Warning
//     This document is trying to connect to:
//     flyjigrijjjtcsvpgzvk.supabase.co
//     If you trust this site, choose Allow.
//
// The prompt itself cannot be suppressed from inside the document — it is the
// reader's setting, not the file's. What the document controls is WHICH HOST it
// names, and that is the actual problem here: a program reviewer opening an
// official assessment report is asked to trust a string of random characters
// they have never seen. The honest answer to "do you trust this site" is "I have
// no idea", so they Block, and the evidence link is dead.
//
// Rewriting the link onto leap.energyefficiencyservices.org does not remove the
// prompt. It makes the prompt answerable: the reviewer sees the domain the
// report came from, Allows once, and Acrobat's "Remember this action for this
// site" makes it the last time they are asked.
//
// Nothing about access changes. The signed token still travels in the query
// string and still governs the file; only the hostname in front of it differs,
// and netlify.toml proxies that path straight through to storage.
// ---------------------------------------------------------------------------

// The public site. Deliberately a constant rather than window.location.origin:
// a report generated from a deploy preview would otherwise bake the preview's
// hostname into a document that gets filed with a program and read for years.
export const REPORT_LINK_ORIGIN = 'https://leap.energyefficiencyservices.org'

// The path LEAP serves storage through. Must match the proxy rule in
// netlify.toml, which sits ABOVE the SPA catch-all so it is matched first.
export const STORAGE_PROXY_PREFIX = '/evidence/'

// Where a SHORT link lives. `/f/<token>` — the whole point is that this fits on
// one line, so Gmail's redirect page and Acrobat's prompt show something a
// person can read and trust instead of 500 characters of JWT.
export const SHORT_LINK_PREFIX = '/f/'

/**
 * The public link for a minted report-file token.
 * @param {string} token  from mint_report_file_link
 */
export function shortFileLink(token, origin = REPORT_LINK_ORIGIN) {
  const t = String(token || '').trim()
  if (!t) return null
  return `${origin.replace(/\/+$/, '')}${SHORT_LINK_PREFIX}${t}`
}

// What a Supabase signed object URL looks like, at the point the bucket begins.
const SIGN_MARKER = '/storage/v1/object/sign/'

/**
 * Rewrite a Supabase signed storage URL onto LEAP's own domain.
 *
 * Returns the input unchanged when it is not a signed storage URL, so passing
 * an already-proxied link, a data: URL or null is harmless — the caller never
 * has to know which kind it holds.
 *
 * @param {string|null} signedUrl
 * @param {string} [origin]  override, for tests
 */
export function proxiedStorageUrl(signedUrl, origin = REPORT_LINK_ORIGIN) {
  // Anything that is not a usable string becomes null rather than being handed
  // back. Returning a number or an object here would put it straight into the
  // PDF as a link target.
  if (typeof signedUrl !== 'string' || !signedUrl) return null
  const at = signedUrl.indexOf(SIGN_MARKER)
  if (at < 0) return signedUrl
  // Everything after the marker is "<bucket>/<path...>?token=…", which is
  // exactly what the proxy rule's :splat expects.
  const rest = signedUrl.slice(at + SIGN_MARKER.length)
  if (!rest) return signedUrl
  return `${origin.replace(/\/+$/, '')}${STORAGE_PROXY_PREFIX}${rest}`
}
