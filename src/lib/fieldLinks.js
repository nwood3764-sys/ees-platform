// ---------------------------------------------------------------------------
// fieldLinks — turn a stored contact-method value into a real, actionable link.
//
// A phone number, an email address, and a website are not text: clicking them
// should place the call (or hand off to Teams / FaceTime / the desk phone),
// open the mail client, or open the site. Every LEAP surface that renders a
// field value routes through here so the behavior is identical everywhere, and
// so a value that ISN'T a usable link (a storage path in a url-typed column, a
// "call the office" note in a phone column) degrades to plain text instead of
// producing a dead or dangerous anchor.
//
// Pure module — no React, no DOM. Fixture-tested by
// scripts/field-links-fixture.mjs.
// ---------------------------------------------------------------------------

// The logical field types that carry a link. Anything else renders as text.
export const LINKABLE_FIELD_TYPES = new Set(['email', 'phone', 'url'])

export function isLinkableFieldType(type) {
  return LINKABLE_FIELD_TYPES.has(type)
}

// Format a US phone number for display: 5152978363 -> (515) 297-8363,
// 15152978363 -> (515) 297-8363. Anything that isn't a clean 10/11-digit US
// number (extensions, international, already-formatted oddities) is returned
// untouched so we never mangle a value we don't recognize.
export function formatUsPhoneDisplay(raw) {
  if (raw == null || raw === '') return raw
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return String(raw)
}

// ── Email ───────────────────────────────────────────────────────────────────
// Deliberately conservative: one address, no whitespace, a dot-bearing domain.
// A field holding "billing@x.com, ap@x.com" or "ask the site manager" stays
// text rather than producing a mailto: that opens a broken draft.
const EMAIL_RE = /^[^\s@,;<>()[\]\\]+@[^\s@,;<>()[\]\\]+\.[A-Za-z]{2,}$/

export function emailHref(raw) {
  if (raw == null) return null
  const value = String(raw).trim()
  if (!EMAIL_RE.test(value)) return null
  return `mailto:${encodeURI(value)}`
}

// ── Phone ───────────────────────────────────────────────────────────────────
// tel: is what hands the number to whatever the device registered as its phone
// handler — the dialer on a mobile, Teams / the softphone on a desktop.
// Extensions are preserved as the RFC 3966 `;ext=` parameter, which Teams and
// most softphones dial after connecting.
const PHONE_EXT_RE = /(?:\s|^)(?:e?xt?\.?|extension|#)\s*[:.]?\s*(\d{1,6})\s*$/i

export function phoneHref(raw) {
  if (raw == null) return null
  let value = String(raw).trim()
  if (!value) return null

  // Split off a trailing extension before counting digits, so "608-555-1212
  // ext 214" doesn't read as a 13-digit international number.
  let ext = null
  const extMatch = value.match(PHONE_EXT_RE)
  if (extMatch) {
    ext = extMatch[1]
    value = value.slice(0, extMatch.index).trim()
  }

  // A second number in the same field ("555-1212 / 555-1213") is ambiguous —
  // we can't know which one to dial, so leave it as text.
  if (/[,/;]|\bor\b/i.test(value)) return null

  const hadPlus = value.trimStart().startsWith('+')
  const digits = value.replace(/\D/g, '')
  if (!digits) return null

  let dialable
  if (!hadPlus && digits.length === 10) dialable = `+1${digits}`
  else if (!hadPlus && digits.length === 11 && digits[0] === '1') dialable = `+${digits}`
  else if (hadPlus && digits.length >= 8 && digits.length <= 15) dialable = `+${digits}`
  // A bare 7-digit local number has no area code; dial it as typed rather than
  // guessing a region.
  else if (!hadPlus && digits.length >= 7 && digits.length <= 15) dialable = digits
  else return null

  return ext ? `tel:${dialable};ext=${ext}` : `tel:${dialable}`
}

// ── URL ─────────────────────────────────────────────────────────────────────
// Accepts what people actually type into a website field: a full URL, a bare
// host ("jesholdings.com"), or a host with a path ("www.rm-ha.org/locations").
// Only http(s) survives — javascript:, data:, and file: are never linked — and
// a value that looks like a storage key or a filename is left as text, which is
// what keeps a mistyped url-typed column from rendering a dead link.
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?::\d{2,5})?$/
const FILE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|svg|tiff?|mp4|mov|webm|m4v|pdf|docx?|xlsx?|pptx?|csv|txt|zip|json)$/i

export function urlHref(raw) {
  if (raw == null) return null
  const value = String(raw).trim()
  if (!value || /\s/.test(value)) return null

  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
  let candidate
  if (hasScheme) {
    if (!/^https?:\/\//i.test(value)) return null
    candidate = value
  } else {
    // Bare host (optionally with a path/query/hash). The host itself has to
    // look like a domain, and must not be a filename — "photo.jpg/thumb" is a
    // storage path, not a site.
    const host = value.split(/[/?#]/)[0]
    if (!HOST_RE.test(host) || FILE_EXT_RE.test(host)) return null
    candidate = `https://${value}`
  }

  let parsed
  try { parsed = new URL(candidate) } catch { return null }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname.includes('.')) return null
  return parsed.href
}

// ── Resolver ────────────────────────────────────────────────────────────────
// Returns null when the value can't be turned into a usable link — callers
// render plain text in that case.
//
//   { href, kind, newTab, title }
//
// `newTab` is true only for websites: mailto:/tel: hand off to a native app,
// and opening a blank tab for them leaves an empty window behind.
export function resolveFieldLink(type, raw, { label } = {}) {
  if (!isLinkableFieldType(type)) return null
  if (raw == null || raw === '') return null
  const value = String(raw).trim()
  if (!value) return null

  if (type === 'email') {
    const href = emailHref(value)
    return href ? { href, kind: 'email', newTab: false, title: `Email ${value}` } : null
  }
  if (type === 'phone') {
    const href = phoneHref(value)
    return href ? { href, kind: 'phone', newTab: false, title: `Call ${formatUsPhoneDisplay(value)}` } : null
  }
  const href = urlHref(value)
  if (!href) return null
  return { href, kind: 'url', newTab: true, title: `Open ${label ? `${label} — ` : ''}${value} in a new tab` }
}
