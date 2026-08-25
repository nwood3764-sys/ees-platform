// -----------------------------------------------------------------------------
// droppedEmail.js — turning a DROP into a ParsedEmail.
//
// This is the thin, browser-facing half of email filing: it works out what the
// drag actually handed over and routes it to the right pure parser. The three
// shapes a mail client can produce, in the order they are tried:
//
//   1. A real file — .msg from Outlook, .eml from anything else, or a file
//      dragged out of Explorer / Finder.
//   2. A VIRTUAL file — dragging a message straight out of Outlook on Windows
//      gives Chromium a file descriptor rather than a path, and `getAsFile()`
//      returns null for it. `webkitGetAsEntry()` is the only way to reach the
//      bytes, and skipping that step is why most in-browser "drop an email
//      here" targets silently do nothing when you drag from Outlook itself.
//   3. Only text — some clients (and Outlook on the web) put nothing but
//      text/plain and text/html on the drag. Those are read for a From/Sent/
//      To/Subject block, and the result says plainly that it came from text.
//
// A drag that yields none of the three is reported as such. Guessing a sender
// would file the email against the wrong person, which is worse than not
// filing it.
// -----------------------------------------------------------------------------

import { parseEmlText, parseDraggedText, emailFileKind } from './emailMessageParse.js'
import { parseOutlookMsg, isCompoundFile } from './outlookMsgParse.js'

// A .msg with a large attachment is still small next to what LEAP's photo
// pipeline handles; anything past this is not an email being filed by hand.
export const MAX_EMAIL_FILE_BYTES = 30 * 1024 * 1024

// Does this drag look like it might carry an email? Used on dragover, where
// the file list is not readable yet and only the type list is.
export function dragCarriesEmail(dataTransfer) {
  if (!dataTransfer) return false
  const types = Array.from(dataTransfer.types || [])
  return types.includes('Files') ||
         types.includes('text/plain') ||
         types.includes('text/html')
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`))
    reader.readAsArrayBuffer(file)
  })
}

function decodeTextBuffer(buffer) {
  const bytes = new Uint8Array(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    let out = ''
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
    return out
  }
}

// One file → one ParsedEmail. The compound-file signature is checked before
// the file name is trusted, so a .msg saved as "message.eml" still parses.
export async function parseEmailFile(file) {
  if (!file) throw new Error('No file was dropped.')
  if (file.size > MAX_EMAIL_FILE_BYTES) {
    throw new Error(`${file.name} is larger than ${Math.round(MAX_EMAIL_FILE_BYTES / 1024 / 1024)}MB and was not read.`)
  }
  const buffer = await readFileAsArrayBuffer(file)
  if (isCompoundFile(buffer)) return parseOutlookMsg(buffer, { fileName: file.name })

  const kind = emailFileKind(file)
  if (kind === 'msg') {
    throw new Error(`${file.name} says it is an Outlook message but does not have the format of one.`)
  }
  const text = decodeTextBuffer(buffer)
  const parsed = parseEmlText(text, { fileName: file.name })
  if (!parsed.from.address) {
    // Not RFC-822 after all — try it as a plain-text mail dump before giving up.
    const fallback = parseDraggedText(text, { fileName: file.name, source: 'pasted_text' })
    if (fallback) return fallback
  }
  return parsed
}

// A DataTransfer is only valid for the duration of the drop event: its item
// list is emptied the moment the handler returns, and getAsFile() /
// webkitGetAsEntry() / getData() all stop working after the first await. So
// the drop handler takes a SYNCHRONOUS snapshot, and every asynchronous read
// happens afterwards against that snapshot. Awaiting mid-loop is the reason
// "drop two emails at once" so often files only the first.
export function snapshotDrop(dataTransfer) {
  const files = []
  const entries = []
  let text = ''
  if (!dataTransfer) return { files, entries, text }

  try { text = dataTransfer.getData?.('text/plain') || '' } catch { text = '' }

  for (const item of Array.from(dataTransfer.items || [])) {
    if (item.kind !== 'file') continue
    let direct = null
    try { direct = item.getAsFile?.() || null } catch { direct = null }
    if (direct) { files.push(direct); continue }
    // Virtual file (a message dragged straight out of Outlook on Windows):
    // getAsFile() returns null and the entry is the only way to the bytes.
    let entry = null
    try { entry = item.webkitGetAsEntry?.() || null } catch { entry = null }
    if (entry && entry.isFile) entries.push(entry)
  }
  if (!files.length && !entries.length) {
    for (const f of Array.from(dataTransfer.files || [])) files.push(f)
  }
  return { files, entries, text }
}

function entryToFile(entry) {
  return new Promise(resolve => {
    try { entry.file(resolve, () => resolve(null)) } catch { resolve(null) }
  })
}

/**
 * Read a snapshotted drop into emails.
 * @returns {Promise<{emails: ParsedEmail[], errors: string[]}>}
 */
export async function readDropSnapshot(snapshot) {
  const emails = []
  const errors = []
  const { files = [], entries = [], text = '' } = snapshot || {}

  const all = [...files]
  for (const entry of entries) {
    const f = await entryToFile(entry)
    if (f) all.push(f)
    else errors.push(`Your mail client offered "${entry.name || 'a message'}" but the browser could not read it.`)
  }

  for (const file of all) {
    // A drag can carry the message plus loose attachments; only the message
    // itself is an email, and a dropped photo is not a filing mistake worth
    // an error message.
    if (!emailFileKind(file) && !/\.(msg|eml|emlx)$/i.test(file.name || '')) continue
    try {
      emails.push(await parseEmailFile(file))
    } catch (err) {
      errors.push(err.message || String(err))
    }
  }

  if (!emails.length) {
    const fromText = parseDraggedText(text)
    if (fromText) emails.push(fromText)
  }

  if (!emails.length && !errors.length) {
    errors.push(all.length
      ? 'Nothing dropped looked like an email. Drag the message itself, or a saved .msg or .eml file.'
      : 'Your mail client did not hand over the message. Save it as a .msg or .eml file and drop that instead.')
  }
  return { emails, errors }
}
