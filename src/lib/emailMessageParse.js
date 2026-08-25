// -----------------------------------------------------------------------------
// emailMessageParse.js — reading an email that arrived as a FILE.
//
// LEAP's email layer has always known how to send through Microsoft Graph and
// how to match a reply back to the thread it belongs to. It had no way at all
// to take an email that happened somewhere else — in somebody's own Outlook,
// forwarded by a program administrator, or older than the account itself — and
// put it on the record it belongs to.
//
// That email arrives as a dropped file, so this module turns a file (or the
// text a drag carries when there is no file) into one shape:
//
//   ParsedEmail {
//     source, fileName, from {name,address}, to [], cc [],
//     subject, sentAt (ISO string | null),
//     bodyHtml, bodyText, internetMessageId, warnings []
//   }
//
// Everything here is PURE — no React, no Supabase, no DOM — because the whole
// point is that it can be pinned by a fixture. What the addresses MEAN is not
// decided here: that is resolve_email_participants in the database, which can
// see contacts and accounts and this cannot.
// -----------------------------------------------------------------------------

// ── RFC 2047 encoded words ───────────────────────────────────────────────────
// "=?utf-8?B?SmFuZSBIZW5kZXJzb24=?=" is a display name, not the literal text a
// header shows. Undecoded, every non-ASCII sender name would read as gibberish.

function decodeBase64ToBytes(b64) {
  const clean = String(b64).replace(/\s+/g, '')
  if (typeof atob === 'function') {
    const bin = atob(clean)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  // Node (fixtures) — Buffer is available there and atob is not, in older runtimes.
  return new Uint8Array(Buffer.from(clean, 'base64'))
}

function decodeBytes(bytes, charset) {
  const cs = String(charset || 'utf-8').toLowerCase()
  try {
    if (typeof TextDecoder === 'function') {
      return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs, { fatal: false }).decode(bytes)
    }
  } catch {
    // Unknown charset label — fall through to a byte-for-byte reading rather
    // than losing the message entirely.
  }
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

function decodeQuotedPrintableToBytes(text, { underscoreIsSpace = false } = {}) {
  const src = String(text)
  const out = []
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '=') {
      // A trailing "=" before a newline is a soft line break: it disappears.
      if (src[i + 1] === '\r' && src[i + 2] === '\n') { i += 2; continue }
      if (src[i + 1] === '\n') { i += 1; continue }
      const hex = src.slice(i + 1, i + 3)
      if (/^[0-9a-fA-F]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; continue }
      out.push(ch.charCodeAt(0))
      continue
    }
    if (underscoreIsSpace && ch === '_') { out.push(0x20); continue }
    const code = ch.charCodeAt(0)
    if (code < 256) out.push(code)
    else {
      // Already decoded text (a .msg body, say) — keep the character.
      for (const b of new TextEncoder().encode(ch)) out.push(b)
    }
  }
  return new Uint8Array(out)
}

export function decodeMimeWords(input) {
  if (!input) return ''
  const str = String(input)
  // Adjacent encoded words separated only by whitespace are one run: the
  // whitespace between them is an artifact of line folding, not content.
  return str.replace(
    /(?:=\?[^?]+\?[BbQq]\?[^?]*\?=)(?:\s*=\?[^?]+\?[BbQq]\?[^?]*\?=)*/g,
    (run) => {
      const words = run.match(/=\?[^?]+\?[BbQq]\?[^?]*\?=/g) || []
      return words.map(w => {
        const m = /^=\?([^?]+)\?([BbQq])\?([^?]*)\?=$/.exec(w)
        if (!m) return w
        const [, charset, enc, payload] = m
        try {
          const bytes = enc.toUpperCase() === 'B'
            ? decodeBase64ToBytes(payload)
            : decodeQuotedPrintableToBytes(payload, { underscoreIsSpace: true })
          return decodeBytes(bytes, charset)
        } catch {
          return w
        }
      }).join('')
    },
  )
}

// ── Address lists ────────────────────────────────────────────────────────────
// Split on commas that are NOT inside quotes or angle brackets, so
// `"Wood, Nicholas" <nw@x.com>, jane@y.com` is two people, not three.

export function parseAddressList(raw) {
  if (!raw) return []
  const str = decodeMimeWords(String(raw))
  const parts = []
  let buf = ''
  let inQuote = false
  let inAngle = false
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '"' && str[i - 1] !== '\\') { inQuote = !inQuote; buf += ch; continue }
    if (!inQuote && ch === '<') { inAngle = true; buf += ch; continue }
    if (!inQuote && ch === '>') { inAngle = false; buf += ch; continue }
    if (!inQuote && !inAngle && (ch === ',' || ch === ';')) { parts.push(buf); buf = ''; continue }
    buf += ch
  }
  parts.push(buf)

  const seen = new Set()
  const out = []
  for (const part of parts) {
    const person = parseSingleAddress(part)
    if (!person) continue
    const key = person.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(person)
  }
  return out
}

function parseSingleAddress(part) {
  const text = String(part || '').trim()
  if (!text) return null
  let name = ''
  let address = ''
  const angle = /<([^<>]*)>/.exec(text)
  if (angle) {
    address = angle[1].trim()
    name = text.slice(0, angle.index).trim()
  } else {
    address = text
  }
  // Outlook writes an internal X.500 path when there is no SMTP address at
  // all; it is not an address and must not be offered as one.
  if (address.startsWith('/O=') || address.startsWith('/o=')) return null
  name = name.replace(/^"(.*)"$/s, '$1').trim()
  address = address.replace(/^mailto:/i, '').replace(/[\s]/g, '')
  if (!isEmailAddress(address)) return null
  return { name: name || '', address }
}

export function isEmailAddress(value) {
  const v = String(value || '').trim()
  if (!v || v.length > 320) return false
  // Deliberately permissive on the local part and strict about the shape: one
  // @, a dot in the domain, no whitespace, no angle brackets left over.
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v)
}

// ── Headers ──────────────────────────────────────────────────────────────────

// Unfold (RFC 5322 §2.2.3) then split into a lower-cased multimap.
export function parseHeaderBlock(block) {
  const unfolded = String(block || '').replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ')
  const headers = new Map()
  for (const line of unfolded.split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (!headers.has(key)) headers.set(key, [])
    headers.get(key).push(value)
  }
  return headers
}

function header(headers, name) {
  const list = headers.get(name)
  return list && list.length ? list[0] : ''
}

export function parseEmailDate(raw) {
  if (!raw) return null
  const cleaned = String(raw).replace(/\s*\([^)]*\)\s*$/, '').trim()
  const t = Date.parse(cleaned)
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString()
}

// ── MIME bodies ──────────────────────────────────────────────────────────────

function contentTypeOf(headers) {
  const raw = header(headers, 'content-type') || 'text/plain'
  const [type, ...params] = raw.split(';')
  const out = { type: type.trim().toLowerCase(), params: {} }
  for (const p of params) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    const k = p.slice(0, eq).trim().toLowerCase()
    let v = p.slice(eq + 1).trim()
    v = v.replace(/^"(.*)"$/s, '$1')
    out.params[k] = v
  }
  return out
}

function decodePartBody(rawBody, headers) {
  const encoding = (header(headers, 'content-transfer-encoding') || '7bit').toLowerCase()
  const ct = contentTypeOf(headers)
  const charset = ct.params.charset || 'utf-8'
  if (encoding === 'base64') return decodeBytes(decodeBase64ToBytes(rawBody), charset)
  if (encoding === 'quoted-printable') return decodeBytes(decodeQuotedPrintableToBytes(rawBody), charset)
  return rawBody
}

// Split one MIME entity into its header block and its raw body.
function splitEntity(text) {
  const normalized = String(text).replace(/\r\n/g, '\n')
  const blank = normalized.indexOf('\n\n')
  if (blank < 0) return { headerBlock: normalized, body: '' }
  return { headerBlock: normalized.slice(0, blank), body: normalized.slice(blank + 2) }
}

// Walk a (possibly nested) MIME tree and keep the best html and text bodies.
// Attachments are deliberately skipped: the original file is what gets stored,
// so re-extracting its parts would be a second, lossier copy of the same thing.
function collectBodies(rawEntity, out, depth = 0) {
  if (depth > 8) return
  const { headerBlock, body } = splitEntity(rawEntity)
  const headers = parseHeaderBlock(headerBlock)
  const ct = contentTypeOf(headers)
  const disposition = (header(headers, 'content-disposition') || '').toLowerCase()

  if (ct.type.startsWith('multipart/')) {
    const boundary = ct.params.boundary
    if (!boundary) return
    const marker = `--${boundary}`
    const segments = body.split(marker)
    // First segment is the preamble, a trailing "--" closes the set.
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]
      if (seg.startsWith('--')) break
      collectBodies(seg.replace(/^\n/, ''), out, depth + 1)
    }
    return
  }

  if (disposition.startsWith('attachment')) return
  if (ct.type === 'text/html' && !out.html) out.html = decodePartBody(body, headers)
  else if (ct.type === 'text/plain' && !out.text) out.text = decodePartBody(body, headers)
}

// ── .eml ─────────────────────────────────────────────────────────────────────

export function parseEmlText(text, { fileName = null, source = 'eml_file' } = {}) {
  const warnings = []
  const { headerBlock, body } = splitEntity(text)
  const headers = parseHeaderBlock(headerBlock)

  const fromList = parseAddressList(header(headers, 'from'))
  const from = fromList[0] || { name: '', address: '' }
  const to = parseAddressList(header(headers, 'to'))
  const cc = parseAddressList(header(headers, 'cc'))

  const bodies = { html: '', text: '' }
  collectBodies(text, bodies)

  const sentAt = parseEmailDate(header(headers, 'date'))
  if (!sentAt) warnings.push('The email carries no readable Date header — the time it was filed will be used instead.')
  if (!from.address) warnings.push('The email carries no readable From address.')

  return normalizeParsedEmail({
    source,
    fileName,
    from,
    to,
    cc,
    subject: decodeMimeWords(header(headers, 'subject')),
    sentAt,
    bodyHtml: bodies.html || '',
    bodyText: bodies.text || (bodies.html ? '' : body),
    internetMessageId: (header(headers, 'message-id') || '').trim(),
    warnings,
  })
}

// ── A drag that carried no file ──────────────────────────────────────────────
//
// Not every mail client hands the browser a file. When one hands over only
// text, the honest thing is to read what is actually there — Outlook's own
// plain-text drop payload starts with the From/Sent/To/Subject block — and to
// say plainly when it is not enough, rather than filing a message whose sender
// we guessed.

const TEXT_HEADER_PATTERNS = [
  { key: 'from',    re: /^\s*(?:from)\s*:\s*(.+)$/i },
  { key: 'to',      re: /^\s*(?:to)\s*:\s*(.+)$/i },
  { key: 'cc',      re: /^\s*(?:cc)\s*:\s*(.+)$/i },
  { key: 'subject', re: /^\s*(?:subject)\s*:\s*(.+)$/i },
  { key: 'date',    re: /^\s*(?:sent|date)\s*:\s*(.+)$/i },
]

export function parseDraggedText(text, { fileName = null, source = 'dragged_text' } = {}) {
  const raw = String(text || '')
  if (!raw.trim()) return null

  // A full RFC-822 source pasted in is worth reading as one.
  if (/^\s*(received|message-id|from)\s*:/im.test(raw) && /\n\s*\n/.test(raw) &&
      /^\s*(mime-version|content-type|message-id)\s*:/im.test(raw)) {
    return parseEmlText(raw, { fileName, source })
  }

  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const found = {}
  let lastHeaderLine = -1
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    for (const { key, re } of TEXT_HEADER_PATTERNS) {
      if (found[key]) continue
      const m = re.exec(lines[i])
      if (m) { found[key] = m[1].trim(); lastHeaderLine = i }
    }
  }

  const fromList = parseAddressList(found.from || '')
  if (!fromList.length) return null

  const body = lines.slice(lastHeaderLine + 1).join('\n').trim()
  return normalizeParsedEmail({
    source,
    fileName,
    from: fromList[0],
    to: parseAddressList(found.to || ''),
    cc: parseAddressList(found.cc || ''),
    subject: found.subject || '',
    sentAt: parseEmailDate(found.date || ''),
    bodyHtml: '',
    bodyText: body,
    internetMessageId: '',
    warnings: ['Read from the text of the drag — the mail client did not hand over the message file, so there is no Message-ID to recognise a second copy by.'],
  })
}

// ── Shared normalization ─────────────────────────────────────────────────────

export function normalizeParsedEmail(input) {
  const p = input || {}
  const from = p.from && isEmailAddress(p.from.address)
    ? { name: String(p.from.name || '').trim(), address: p.from.address.trim() }
    : { name: String(p.from?.name || '').trim(), address: '' }

  const clean = (list) => (Array.isArray(list) ? list : [])
    .map(x => (typeof x === 'string' ? { name: '', address: x } : x))
    .filter(x => x && isEmailAddress(x.address))
    .map(x => ({ name: String(x.name || '').trim(), address: String(x.address).trim() }))

  const to = dedupeByAddress(clean(p.to))
  // Someone on both lines is a To, not a Cc — listing them twice would double
  // them in the participant record.
  const toKeys = new Set(to.map(x => x.address.toLowerCase()))
  const cc = dedupeByAddress(clean(p.cc)).filter(x => !toKeys.has(x.address.toLowerCase()))

  const subject = String(p.subject || '').replace(/\s+/g, ' ').trim()
  let messageId = String(p.internetMessageId || '').trim()
  if (messageId && !/^<.*>$/.test(messageId)) messageId = `<${messageId}>`

  return {
    source: p.source || 'eml_file',
    fileName: p.fileName || null,
    from,
    to,
    cc,
    subject,
    sentAt: p.sentAt || null,
    bodyHtml: String(p.bodyHtml || ''),
    bodyText: String(p.bodyText || ''),
    internetMessageId: messageId,
    warnings: Array.isArray(p.warnings) ? p.warnings.filter(Boolean) : [],
  }
}

function dedupeByAddress(list) {
  const seen = new Set()
  const out = []
  for (const x of list) {
    const k = x.address.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  return out
}

// Every address on the message, From first — what the database is asked to
// resolve, and the order the preview lists people in.
export function participantAddresses(parsed) {
  if (!parsed) return []
  const all = []
  if (parsed.from?.address) all.push(parsed.from.address)
  for (const x of parsed.to || []) all.push(x.address)
  for (const x of parsed.cc || []) all.push(x.address)
  const seen = new Set()
  return all.filter(a => {
    const k = a.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// Is this email ready to file? A message with no sender cannot be attributed,
// which is the one thing filing it is for.
export function parsedEmailBlockers(parsed) {
  const blockers = []
  if (!parsed) { blockers.push('Nothing readable was dropped.'); return blockers }
  if (!parsed.from?.address) blockers.push('No sender address could be read, so the email cannot be attributed to anyone.')
  if (!parsed.to.length && !parsed.cc.length) blockers.push('No recipient address could be read.')
  return blockers
}

// Which parser a dropped file needs, by name and by type. Outlook writes
// .msg; every other client writes RFC-822 as .eml (and Apple Mail as .emlx).
export function emailFileKind(file) {
  const name = String(file?.name || '').toLowerCase()
  const type = String(file?.type || '').toLowerCase()
  if (name.endsWith('.msg') || type === 'application/vnd.ms-outlook') return 'msg'
  if (name.endsWith('.eml') || name.endsWith('.emlx') || name.endsWith('.mht') ||
      type === 'message/rfc822' || type === 'application/octet-stream') return 'eml'
  if (type.startsWith('text/')) return 'eml'
  return null
}
