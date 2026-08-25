// -----------------------------------------------------------------------------
// outlookMsgParse.js — reading an Outlook .msg file.
//
// Dragging a message out of Outlook on Windows hands the browser a .msg file,
// not an .eml, so without this the one drag Nicholas actually asked for would
// be the one drag that does not work. A .msg is an OLE2 Compound File: a small
// FAT-like filesystem whose streams are MAPI properties. Nothing in the stack
// reads that, and no dependency was added for it — this is ~250 lines of
// well-specified format, and a parser we own is a parser we can fixture.
//
// Two sources of truth live inside one .msg and they disagree by design:
//
//   • MAPI properties  — always present, and the only source on a SENT item.
//   • PR_TRANSPORT_MESSAGE_HEADERS — the real RFC-822 header block, present on
//     a RECEIVED item, carrying the Message-ID that lets a second drop of the
//     same email be recognised instead of duplicated.
//
// Neither is preferred wholesale. Each field takes the source that is actually
// authoritative for it, and recipients are the UNION of both, because a reply
// filed from the Sent folder has no transport headers at all.
//
// Pure: an ArrayBuffer in, a ParsedEmail out. No DOM, no network.
// -----------------------------------------------------------------------------

import {
  normalizeParsedEmail,
  parseAddressList,
  parseHeaderBlock,
  parseEmailDate,
  decodeMimeWords,
  isEmailAddress,
} from './emailMessageParse.js'

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ENDOFCHAIN = 0xfffffffe
const FREESECT   = 0xffffffff

// ── Compound File ────────────────────────────────────────────────────────────

export function isCompoundFile(buffer) {
  if (!buffer || buffer.byteLength < 512) return false
  const b = new Uint8Array(buffer, 0, 8)
  return CFB_SIGNATURE.every((v, i) => b[i] === v)
}

function readCompoundFile(buffer) {
  if (!isCompoundFile(buffer)) {
    throw new Error('This is not an Outlook .msg file — its signature does not match.')
  }
  const view = new DataView(buffer)
  const u32 = (off) => view.getUint32(off, true)
  const u16 = (off) => view.getUint16(off, true)

  const sectorSize     = 1 << u16(0x1e)
  const miniSectorSize = 1 << u16(0x20)
  const numFatSectors  = u32(0x2c)
  const firstDirSector = u32(0x30)
  const miniCutoff     = u32(0x38)
  const firstMiniFat   = u32(0x3c)
  const numMiniFat     = u32(0x40)
  const firstDifat     = u32(0x44)
  const numDifat       = u32(0x48)

  if (sectorSize !== 512 && sectorSize !== 4096) {
    throw new Error(`Unsupported .msg sector size (${sectorSize}).`)
  }
  const sectorOffset = (sector) => (sector + 1) * sectorSize
  const maxSector = Math.floor(buffer.byteLength / sectorSize)

  // DIFAT: the first 109 FAT sector numbers sit in the header; the rest are
  // chained through DIFAT sectors, each ending with a pointer to the next.
  const fatSectors = []
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const s = u32(0x4c + i * 4)
    if (s === FREESECT || s === ENDOFCHAIN) break
    fatSectors.push(s)
  }
  let difat = firstDifat
  let difatGuard = 0
  while (difat !== ENDOFCHAIN && difat !== FREESECT &&
         fatSectors.length < numFatSectors && difatGuard++ < numDifat + 8) {
    const base = sectorOffset(difat)
    if (base + sectorSize > buffer.byteLength) break
    const perSector = sectorSize / 4 - 1
    for (let i = 0; i < perSector && fatSectors.length < numFatSectors; i++) {
      const s = u32(base + i * 4)
      if (s === FREESECT || s === ENDOFCHAIN) continue
      fatSectors.push(s)
    }
    difat = u32(base + sectorSize - 4)
  }

  const readFatTable = (sectors) => {
    const table = new Uint32Array(sectors.length * (sectorSize / 4))
    let n = 0
    for (const s of sectors) {
      const base = sectorOffset(s)
      if (base + sectorSize > buffer.byteLength) break
      for (let i = 0; i < sectorSize / 4; i++) table[n++] = u32(base + i * 4)
    }
    return table.subarray(0, n)
  }
  const fat = readFatTable(fatSectors)

  // Walks an allocation chain. The bound is the TABLE's length, never the
  // file's sector count: mini-FAT indices address 64-byte mini sectors inside
  // the root's mini stream, so bounding them by the number of 512-byte sectors
  // in the file silently truncates every stream past the first few kilobytes —
  // which reads as "this recipient has no address" rather than as an error.
  const followChain = (start, table) => {
    const chain = []
    let s = start
    let guard = 0
    const limit = table.length + 8
    while (s !== ENDOFCHAIN && s !== FREESECT && guard++ < limit) {
      if (s >= table.length) break
      chain.push(s)
      s = table[s]
    }
    return chain
  }

  const readSectorChain = (start, size) => {
    const chain = followChain(start, fat).filter(s => s < maxSector)
    const out = new Uint8Array(chain.length * sectorSize)
    chain.forEach((s, i) => {
      const base = sectorOffset(s)
      out.set(new Uint8Array(buffer, base, Math.min(sectorSize, buffer.byteLength - base)), i * sectorSize)
    })
    return size == null ? out : out.subarray(0, size)
  }

  // Directory entries, 128 bytes each.
  const dirBytes = readSectorChain(firstDirSector, null)
  const entryCount = Math.floor(dirBytes.length / 128)
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength)
  const entries = []
  for (let i = 0; i < entryCount; i++) {
    const off = i * 128
    const nameLen = Math.max(0, dirView.getUint16(off + 64, true) - 2)
    let name = ''
    for (let c = 0; c < nameLen; c += 2) name += String.fromCharCode(dirView.getUint16(off + c, true))
    entries.push({
      index: i,
      name,
      type: dirView.getUint8(off + 66),          // 1 storage, 2 stream, 5 root
      left: dirView.getUint32(off + 68, true),
      right: dirView.getUint32(off + 72, true),
      child: dirView.getUint32(off + 76, true),
      start: dirView.getUint32(off + 116, true),
      size: Number(dirView.getBigUint64(off + 120, true)),
    })
  }
  if (!entries.length) throw new Error('The .msg file has no directory.')

  // Streams smaller than the cutoff live inside the root entry's mini stream.
  const root = entries[0]
  const miniStream = root.size > 0 ? readSectorChain(root.start, root.size) : new Uint8Array(0)
  const miniFat = numMiniFat > 0 ? readFatTable(followChain(firstMiniFat, fat)) : new Uint32Array(0)

  const readStream = (entry) => {
    if (!entry || entry.size === 0) return new Uint8Array(0)
    if (entry.size < miniCutoff && entry.index !== 0) {
      const chain = followChain(entry.start, miniFat)
      const out = new Uint8Array(chain.length * miniSectorSize)
      chain.forEach((s, i) => {
        const base = s * miniSectorSize
        if (base >= miniStream.length) return
        out.set(miniStream.subarray(base, Math.min(base + miniSectorSize, miniStream.length)), i * miniSectorSize)
      })
      return out.subarray(0, entry.size)
    }
    return readSectorChain(entry.start, entry.size)
  }

  // Children of a storage, walked through the red-black tree. A flat scan of
  // the directory would mix a recipient's own subject-shaped streams into the
  // message's, which is exactly the bug that makes hand-rolled .msg readers
  // return the wrong sender.
  const childrenOf = (entry) => {
    const out = []
    const seen = new Set()
    const walk = (idx) => {
      if (idx === FREESECT || idx >= entries.length || seen.has(idx)) return
      seen.add(idx)
      const e = entries[idx]
      walk(e.left)
      out.push(e)
      walk(e.right)
    }
    walk(entry.child)
    return out
  }

  return { entries, root, readStream, childrenOf }
}

// ── MAPI properties ──────────────────────────────────────────────────────────

const SUBSTG = /^__substg1\.0_([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})$/

function decodeUtf16(bytes) {
  let out = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8))
  return out
}

function decodeAscii(bytes) {
  if (typeof TextDecoder === 'function') {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes) } catch { /* fall through */ }
  }
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

// Every property of one storage: strings from their own streams, fixed-width
// values from __properties_version1.0.
function readProperties(cfb, storage, propertiesHeaderSize) {
  const strings = new Map()   // '0037' -> value
  const binaries = new Map()
  const fixed = new Map()     // '0039' -> { type, lo, hi }
  for (const child of cfb.childrenOf(storage)) {
    const m = SUBSTG.exec(child.name)
    if (!m) continue
    const [, id, type] = m
    const key = id.toUpperCase()
    const t = type.toUpperCase()
    const bytes = cfb.readStream(child)
    if (t === '001F') strings.set(key, decodeUtf16(bytes))
    else if (t === '001E') strings.set(key, decodeAscii(bytes))
    else if (t === '0102') binaries.set(key, bytes)
  }
  const propsEntry = cfb.childrenOf(storage).find(c => c.name === '__properties_version1.0')
  if (propsEntry) {
    const bytes = cfb.readStream(propsEntry)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let off = propertiesHeaderSize; off + 16 <= bytes.length; off += 16) {
      const type = view.getUint16(off, true)
      const id = view.getUint16(off + 2, true)
      const lo = view.getUint32(off + 8, true)
      const hi = view.getUint32(off + 12, true)
      fixed.set(id.toString(16).toUpperCase().padStart(4, '0'), { type, lo, hi })
    }
  }
  return { strings, binaries, fixed }
}

function fileTimeToIso(entry) {
  if (!entry) return null
  const ticks = entry.hi * 4294967296 + entry.lo   // 100-nanosecond intervals since 1601
  if (!ticks) return null
  const ms = ticks / 10000 - 11644473600000
  if (!Number.isFinite(ms) || ms < 0) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const P = {
  SUBJECT:                '0037',
  BODY:                   '1000',
  HTML:                   '1013',
  TRANSPORT_HEADERS:      '007D',
  CLIENT_SUBMIT_TIME:     '0039',
  DELIVERY_TIME:          '0E06',
  INTERNET_MESSAGE_ID:    '1035',
  SENDER_NAME:            '0C1A',
  SENDER_EMAIL:           '0C1F',
  SENDER_SMTP:            '5D01',
  SENT_REPR_NAME:         '0042',
  SENT_REPR_EMAIL:        '0065',
  SENT_REPR_SMTP:         '5D02',
  DISPLAY_TO:             '0E04',
  DISPLAY_CC:             '0E03',
  RECIP_DISPLAY_NAME:     '3001',
  RECIP_EMAIL:            '3003',
  RECIP_ADDRTYPE:         '3002',
  RECIP_SMTP:             '39FE',
  RECIP_TYPE:             '0C15',
}

function firstValidAddress(...candidates) {
  for (const c of candidates) {
    const v = String(c || '').trim()
    if (isEmailAddress(v)) return v
  }
  return ''
}

// ── Public ───────────────────────────────────────────────────────────────────

export function parseOutlookMsg(buffer, { fileName = null } = {}) {
  const cfb = readCompoundFile(buffer)
  const props = readProperties(cfb, cfb.root, 32)   // top-level message header is 32 bytes
  const warnings = []

  // Recipients, from their own sub-storages. This is the only place a SENT
  // item records who it went to.
  const mapiTo = []
  const mapiCc = []
  for (const child of cfb.childrenOf(cfb.root)) {
    if (child.type !== 1 || !/^__recip_version1\.0/.test(child.name)) continue
    const rp = readProperties(cfb, child, 8)        // recipient storage header is 8 bytes
    const addrType = String(rp.strings.get(P.RECIP_ADDRTYPE) || '').toUpperCase()
    const address = firstValidAddress(
      rp.strings.get(P.RECIP_SMTP),
      addrType === 'SMTP' ? rp.strings.get(P.RECIP_EMAIL) : '',
      rp.strings.get(P.RECIP_EMAIL),
    )
    if (!address) continue
    const person = { name: String(rp.strings.get(P.RECIP_DISPLAY_NAME) || '').trim(), address }
    const kind = rp.fixed.get(P.RECIP_TYPE)?.lo
    if (kind === 2) mapiCc.push(person)
    else if (kind === 3) continue                   // Bcc on a sent item is not a participant of the thread
    else mapiTo.push(person)
  }

  // The real header block, when the message was received.
  const transport = String(props.strings.get(P.TRANSPORT_HEADERS) || '')
  const headers = transport ? parseHeaderBlock(transport) : null
  const head = (name) => (headers?.get(name)?.[0] || '')

  const headerFrom = parseAddressList(head('from'))[0] || null
  const senderName = String(props.strings.get(P.SENDER_NAME) ||
                            props.strings.get(P.SENT_REPR_NAME) || '').trim()
  const fromAddress = firstValidAddress(
    props.strings.get(P.SENDER_SMTP),
    props.strings.get(P.SENT_REPR_SMTP),
    headerFrom?.address,
    props.strings.get(P.SENDER_EMAIL),
    props.strings.get(P.SENT_REPR_EMAIL),
  )
  if (!fromAddress) {
    warnings.push('Outlook stored the sender as an internal directory entry with no SMTP address, so the sender could not be read from the file.')
  }

  const merge = (a, b) => {
    const out = []
    const seen = new Set()
    for (const person of [...a, ...b]) {
      const k = person.address.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(person)
    }
    return out
  }
  const to = merge(mapiTo, parseAddressList(head('to')))
  const cc = merge(mapiCc, parseAddressList(head('cc')))

  const htmlBytes = props.binaries.get(P.HTML)
  const bodyHtml = htmlBytes && htmlBytes.length ? decodeAscii(htmlBytes)
                 : String(props.strings.get(P.HTML) || '')

  const sentAt = fileTimeToIso(props.fixed.get(P.CLIENT_SUBMIT_TIME)) ||
                 parseEmailDate(head('date')) ||
                 fileTimeToIso(props.fixed.get(P.DELIVERY_TIME))
  if (!sentAt) warnings.push('The file carries no send time — the time it was filed will be used instead.')

  return normalizeParsedEmail({
    source: 'outlook_msg_file',
    fileName,
    from: { name: senderName || headerFrom?.name || '', address: fromAddress },
    to,
    cc,
    subject: String(props.strings.get(P.SUBJECT) || decodeMimeWords(head('subject')) || '').trim(),
    sentAt,
    bodyHtml,
    bodyText: String(props.strings.get(P.BODY) || ''),
    internetMessageId: String(props.strings.get(P.INTERNET_MESSAGE_ID) || head('message-id') || '').trim(),
    warnings,
  })
}

