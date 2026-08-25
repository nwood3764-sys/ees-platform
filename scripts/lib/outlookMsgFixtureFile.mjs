// Builds a real Outlook .msg (OLE2 compound file) in memory.
//
// Shared by the email-drop fixture and the browser drop check, because the
// only honest proof that the .msg reader works is a byte stream it has to
// walk — and both places need the same stream. Kept out of src/ deliberately:
// nothing the app ships ever WRITES a .msg, only reads one.

const SECTOR = 512
const MINI = 64
const ENDOFCHAIN = 0xfffffffe
const FREESECT = 0xffffffff
const FATSECT = 0xfffffffd

const utf16 = (s) => {
  const b = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 0xff; b[i * 2 + 1] = s.charCodeAt(i) >> 8 }
  return b
}
const ascii = (s) => Uint8Array.from([...s].map(c => c.charCodeAt(0) & 0xff))

// Fixed-width MAPI properties, as they sit in __properties_version1.0.
function propertiesStream(headerSize, props) {
  const buf = new Uint8Array(headerSize + props.length * 16)
  const dv = new DataView(buf.buffer)
  props.forEach((p, i) => {
    const off = headerSize + i * 16
    dv.setUint16(off, p.type, true)
    dv.setUint16(off + 2, p.id, true)
    dv.setUint32(off + 8, p.lo >>> 0, true)
    dv.setUint32(off + 12, (p.hi || 0) >>> 0, true)
  })
  return buf
}

function isoToFileTime(iso) {
  const ticks = (Date.parse(iso) + 11644473600000) * 10000
  return { lo: ticks % 4294967296, hi: Math.floor(ticks / 4294967296) }
}

// Writes a compound file from a tree of storages and streams.
function buildCompoundFile(rootChildren) {
  const entries = [{ name: 'Root Entry', type: 5, child: -1, left: -1, right: -1, data: null }]
  const addTree = (nodes) => {
    const ids = []
    for (const n of nodes) {
      const id = entries.length
      entries.push({ name: n.name, type: n.type === 'storage' ? 1 : 2, child: -1, left: -1, right: -1, data: n.data || null })
      ids.push(id)
      if (n.type === 'storage') entries[id].child = addTree(n.children || [])
    }
    // A right-leaning chain is a valid (if unbalanced) sibling tree.
    for (let i = 0; i < ids.length - 1; i++) entries[ids[i]].right = ids[i + 1]
    return ids.length ? ids[0] : -1
  }
  entries[0].child = addTree(rootChildren)

  // Every stream in this fixture is small, which is exactly the mini-stream
  // path a real .msg uses — the path a reader that only walks the big FAT
  // silently gets wrong.
  const miniChunks = []
  let miniSector = 0
  for (const e of entries) {
    if (e.type !== 2 || !e.data) continue
    const padded = new Uint8Array(Math.ceil(Math.max(e.data.length, 1) / MINI) * MINI)
    padded.set(e.data)
    e.miniStart = miniSector
    e.miniCount = padded.length / MINI
    miniSector += e.miniCount
    miniChunks.push(padded)
  }
  const miniStream = new Uint8Array(miniSector * MINI)
  { let at = 0; for (const c of miniChunks) { miniStream.set(c, at); at += c.length } }

  const miniFat = new Uint32Array(Math.max(miniSector, 1)).fill(FREESECT)
  for (const e of entries) {
    if (e.type !== 2 || !e.data) continue
    for (let i = 0; i < e.miniCount; i++) {
      miniFat[e.miniStart + i] = i === e.miniCount - 1 ? ENDOFCHAIN : e.miniStart + i + 1
    }
  }

  const dirBytes = new Uint8Array(Math.ceil(entries.length / 4) * SECTOR)
  const dv = new DataView(dirBytes.buffer)
  entries.forEach((e, i) => {
    const off = i * 128
    const nm = utf16(e.name)
    dirBytes.set(nm, off)
    dv.setUint16(off + 64, nm.length + 2, true)
    dv.setUint8(off + 66, e.type)
    dv.setUint32(off + 68, e.left < 0 ? FREESECT : e.left, true)
    dv.setUint32(off + 72, e.right < 0 ? FREESECT : e.right, true)
    dv.setUint32(off + 76, e.child < 0 ? FREESECT : e.child, true)
    if (i === 0) {
      dv.setUint32(off + 116, 0, true)                 // mini stream starts at the first data sector
      dv.setBigUint64(off + 120, BigInt(miniStream.length), true)
    } else if (e.type === 2) {
      dv.setUint32(off + 116, e.data ? e.miniStart : ENDOFCHAIN, true)
      dv.setBigUint64(off + 120, BigInt(e.data ? e.data.length : 0), true)
    } else {
      dv.setUint32(off + 116, ENDOFCHAIN, true)
    }
  })

  const miniFatBytes = new Uint8Array(Math.ceil((miniFat.length * 4) / SECTOR) * SECTOR)
  new Uint8Array(miniFat.buffer, 0, miniFat.length * 4).forEach((b, i) => { miniFatBytes[i] = b })

  const miniStreamPadded = new Uint8Array(Math.ceil(Math.max(miniStream.length, 1) / SECTOR) * SECTOR)
  miniStreamPadded.set(miniStream)

  // Sector layout: [0]=FAT, then mini stream, then directory, then mini FAT.
  const miniStreamSectors = miniStreamPadded.length / SECTOR
  const dirSectors = dirBytes.length / SECTOR
  const miniFatSectors = miniFatBytes.length / SECTOR
  const total = 1 + miniStreamSectors + dirSectors + miniFatSectors
  if (total > SECTOR / 4) throw new Error('fixture compound file outgrew a single FAT sector')

  const fat = new Uint32Array(SECTOR / 4).fill(FREESECT)
  fat[0] = FATSECT
  const chain = (start, count) => {
    for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? ENDOFCHAIN : start + i + 1
  }
  const miniStreamStart = 1
  const dirStart = miniStreamStart + miniStreamSectors
  const miniFatStart = dirStart + dirSectors
  chain(miniStreamStart, miniStreamSectors)
  chain(dirStart, dirSectors)
  chain(miniFatStart, miniFatSectors)

  const out = new Uint8Array(SECTOR * (1 + total))
  const hv = new DataView(out.buffer)
  out.set(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 0)
  hv.setUint16(0x1e, 9, true)          // sector shift → 512
  hv.setUint16(0x20, 6, true)          // mini sector shift → 64
  hv.setUint32(0x2c, 1, true)          // one FAT sector
  hv.setUint32(0x30, dirStart, true)
  hv.setUint32(0x38, 4096, true)       // mini stream cutoff
  hv.setUint32(0x3c, miniFatStart, true)
  hv.setUint32(0x40, miniFatSectors, true)
  hv.setUint32(0x44, ENDOFCHAIN, true) // no DIFAT sectors
  hv.setUint32(0x48, 0, true)
  for (let i = 0; i < 109; i++) hv.setUint32(0x4c + i * 4, i === 0 ? 0 : FREESECT, true)

  const put = (sector, bytes) => out.set(bytes, SECTOR * (sector + 1))
  put(0, new Uint8Array(fat.buffer))
  put(miniStreamStart, miniStreamPadded)
  put(dirStart, dirBytes)
  put(miniFatStart, miniFatBytes)
  // The root entry's mini stream starts at the first mini-stream sector, which
  // the reader resolves through the big FAT — so record it as sector 1.
  new DataView(out.buffer).setUint32(SECTOR * (dirStart + 1) + 116, miniStreamStart, true)
  return out.buffer
}

export const substg = (id, type, data) => ({ name: `__substg1.0_${id}${type}`, type: 'stream', data })
export const strProp = (id, value) => substg(id, '001F', utf16(value))
export { propertiesStream, isoToFileTime, buildCompoundFile, ascii, utf16 }
