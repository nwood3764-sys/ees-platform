// saveErrorMessage — turn a failed write into a sentence a person can act on.
//
// Nicholas, 2026-08-25, hitting Save As on a report: "it gave me a big error
// about duplicate." What he saw was the database's own words —
// `duplicate key value violates unique constraint
// "report_filters_rfilt_report_id_rfilt_filter_index_key"` — printed where a
// person was meant to read it. A constraint name is a fact about the schema,
// not an instruction to a user.
//
// This says what happened and what to do, and keeps the raw text as `detail`
// so it can still be shown to whoever needs it (and so nothing is hidden from
// the person reporting a bug).
//
// Pure — no imports, no I/O. Pinned by scripts/save-error-message-fixture.mjs.

// Postgres error codes worth naming. Anything else keeps the raw message,
// which is better than a vague "something went wrong" that says nothing.
const CODES = {
  '23505': 'duplicate',
  '23503': 'reference',
  '23502': 'required',
  '23514': 'invalid',
  '22001': 'too_long',
  '22003': 'out_of_range',
  '42501': 'not_allowed',
  'PGRST301': 'signed_out',
}

/**
 * @param err     the thrown error (a PostgREST error object or an Error)
 * @param object  what was being saved, in the user's words ("report")
 * @returns { message, detail, kind } — `message` is what to show; `detail` is
 *          the original text, for a "details" affordance; `kind` names the
 *          case so a caller can style or branch on it.
 */
export function describeSaveError(err, { object = 'record' } = {}) {
  // An error object with an empty message must not stringify to
  // "[object Object]" — that is exactly the kind of text this module exists
  // to keep off the screen.
  const raw = (typeof err === 'string' ? err : (err?.message ?? '')).toString().trim()
  const code = String(err?.code || '')
  const kind = CODES[code] || inferKind(raw)
  const detail = [raw, err?.details, err?.hint].filter(Boolean).join(' — ') || 'No further detail.'

  switch (kind) {
    case 'duplicate':
      return {
        kind,
        detail,
        message: `This ${object} could not be saved because something in it is already recorded as unique — a name or a number that another record already uses. Change the value that has to be unique, then save again.`,
      }
    case 'reference':
      return {
        kind,
        detail,
        message: `This ${object} points at a record that no longer exists. Re-pick the related record, then save again.`,
      }
    case 'required':
      return {
        kind,
        detail,
        message: `A required field on this ${object} is empty. Fill it in, then save again.` + fieldHint(raw),
      }
    case 'invalid':
      return {
        kind,
        detail,
        message: `A value on this ${object} isn't one this field accepts. Correct it, then save again.`,
      }
    case 'too_long':
      return { kind, detail, message: `A value on this ${object} is longer than its field allows. Shorten it, then save again.` }
    case 'out_of_range':
      return { kind, detail, message: `A number on this ${object} is larger than its field allows.` }
    case 'not_allowed':
      return { kind, detail, message: `You don't have permission to save this ${object}. Ask an administrator for access to it.` }
    case 'signed_out':
      return { kind, detail, message: 'Your session ended before this could be saved. Sign in again — your changes are still on screen.' }
    case 'offline':
      return { kind, detail, message: `This ${object} couldn't reach the server. Check your connection and save again — your changes are still on screen.` }
    default:
      return { kind: 'unknown', detail, message: raw || `This ${object} could not be saved.` }
  }
}

// No code to go on (a raw Error, a fetch failure) — read the text.
function inferKind(raw) {
  const t = raw.toLowerCase()
  if (!t) return 'unknown'
  if (t.includes('duplicate key')) return 'duplicate'
  if (t.includes('violates foreign key')) return 'reference'
  if (t.includes('null value in column')) return 'required'
  if (t.includes('violates check constraint')) return 'invalid'
  if (t.includes('permission denied') || t.includes('row-level security')) return 'not_allowed'
  if (t.includes('failed to fetch') || t.includes('networkerror') || t.includes('load failed')) return 'offline'
  return 'unknown'
}

// `null value in column "rpt_name" of relation "reports"` → name the column.
function fieldHint(raw) {
  const m = /null value in column "([^"]+)"/i.exec(raw)
  return m ? ` The empty field is ${m[1]}.` : ''
}
