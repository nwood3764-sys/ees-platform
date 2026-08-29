// =============================================================================
// constrainingParentChoice — when a create must ASK which parent it belongs to
//
// Some record types are decided by a parent record rather than by the object
// itself: an opportunity record type IS the program, so it decides which
// incentive application forms and which assessment record types belong to it
// (record_type_eligibility holds those edges).
//
// Creating such a child FROM that parent is unambiguous — the parent came with
// the click. Creating it from a BUILDING or a PROPERTY is not: a building runs
// several programs at once (1837 Alden Road runs WI-IRA-MF-HOMES and
// WI-IRA-MF-HOMES-AUDIT side by side), so "which program is this application
// for?" has more than one answer and the platform cannot know which.
//
// It used to guess — "the building's most recent live opportunity", ORDER BY
// created_at LIMIT 1 — and a guess here is not a harmless default: the guessed
// opportunity narrows the record-type picker to that one program's forms, so
// the other program's form was not merely un-defaulted, it was unreachable. On
// a building whose opportunities were created in one transaction the timestamps
// tie and the guess is a coin flip (Nicholas, 2026-08-29: "I could do it
// through the opportunity. I couldn't do it through the building.").
//
// So: derive when there is one answer, ASK when there is more than one. Same
// rule the record-type picker already applies to an unknown state — narrow and
// prompt, never widen and guess.
//
// Pure: no network, no React. The data half lives in
// src/data/createParentChoice.js; the prompt is RecordTypePicker's parent
// selector.
// =============================================================================

/** A stable order for the options a user is asked to choose between.
 *  Program label first (that IS the question being asked), then the record's
 *  own name, then its id — so the list never reorders between two renders and
 *  a single candidate resolves the same way every time. */
export function sortParentOptions(options) {
  const key = (o) => [
    String(o?.recordTypeLabel || '￿'),
    String(o?.label || '￿'),
    String(o?.id || ''),
  ]
  return [...(options || [])].sort((a, b) => {
    const ka = key(a), kb = key(b)
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1
      if (ka[i] > kb[i]) return 1
    }
    return 0
  })
}

/**
 * What the create owes the user, given what the seed already carried and which
 * parents are actually available beneath it.
 *
 * Returns:
 *   seededId    — the parent the create was launched from; never a choice.
 *   autoId      — the single available parent, derived rather than asked for.
 *   needsChoice — more than one, so the picker must ask.
 *   options     — the choices to offer, in stable order (empty unless asking).
 *
 * Zero candidates is NOT a choice and NOT an error: the child simply opens with
 * no parent and the user picks one on the form, exactly as before.
 */
export function resolveParentChoice({ seededId = null, candidates = [] } = {}) {
  const clean = (candidates || []).filter(c => c && c.id)
  if (seededId) return { seededId, autoId: null, needsChoice: false, options: [] }
  if (clean.length === 1) return { seededId: null, autoId: clean[0].id, needsChoice: false, options: [] }
  if (clean.length > 1) {
    return { seededId: null, autoId: null, needsChoice: true, options: sortParentOptions(clean) }
  }
  return { seededId: null, autoId: null, needsChoice: false, options: [] }
}

/** True when the picker still owes this choice — nothing chosen yet. */
export function parentChoiceOutstanding(parentChoices, chosenId) {
  return Boolean(parentChoices?.needsChoice) && !chosenId
}

/** The label a chosen option contributes to the picker's context. The program
 *  is what the user is really choosing, so it leads; the record name follows
 *  only when it says something the program label does not. */
export function describeParentOption(option) {
  if (!option) return ''
  const rt = String(option.recordTypeLabel || '').trim()
  const name = String(option.label || '').trim()
  if (rt && name) {
    return name.toLowerCase().endsWith(rt.toLowerCase()) ? name : `${name} — ${rt}`
  }
  return rt || name || String(option.id || '')
}
