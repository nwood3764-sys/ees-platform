// ---------------------------------------------------------------------------
// photoTags — pure helpers for the work-order photo roll-up gallery.
//
// A photo carries two independent tags:
//
//   work step   the step it was captured for (`_work_step_name`, resolved
//               from the work_steps row by listWorkOrderPhotos)
//   photo tag   what the photo IS (`photo_type`) — for LEAP Pad captures this
//               is the named photo prompt from the work step template
//               ('kitchen_overall_photo'), whose human label lives on
//               work_step_template_fields.wstf_field_label; for ad hoc
//               uploads it is 'general', 'before', or 'after'
//
// Both drive a filter dropdown on the work order's Photos card, so a
// reviewer can pull "every Kitchen Overall Photo on this assessment" out of
// several hundred photos without opening each step.
//
// Kept free of React and of Supabase so the filter behaviour is testable —
// see scripts/photo-tags-fixture.mjs.
// ---------------------------------------------------------------------------

// Tags that describe nothing beyond "a photo" — they get no chip on the tile
// because every photo would carry one and the chip would stop meaning
// anything. They are still first-class entries in the filter dropdown.
const UNREMARKABLE_TAGS = new Set(['general', 'photo', ''])

export const ALL = 'all'
// Filter key + tag for a photo hanging off the work order itself rather than
// any one step (e.g. the Unable to Complete evidence photo, or a file dropped
// straight onto the work order's card).
export const WORK_ORDER_STEP_KEY = 'work_order'
// Filter key for a photo whose step could not be resolved.
export const UNASSIGNED_STEP_KEY = 'unassigned'

/**
 * Turn a raw photo_type into something a person can read. Used only when the
 * work step template carries no label for the tag (ad hoc types, legacy rows).
 *
 *   'kitchen_overall_photo' → 'Kitchen Overall Photo'
 *   'exterior_face_north'   → 'Exterior Face North'
 *   'before'                → 'Before'
 */
export function humanizePhotoTag(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return 'Untagged'
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

/**
 * Display label for a photo's tag. A label resolved from the work step
 * template always wins — that's the wording the technician saw in the field
 * and the wording the program reviewer expects to read back.
 *
 * @param {Object} photo             a photos row (may carry _photo_tag_label)
 * @param {Map<string,string>} [labels]  photo_type → template label
 */
export function photoTagLabel(photo, labels) {
  const raw = String(photo?.photo_type ?? '').trim()
  if (photo?._photo_tag_label) return photo._photo_tag_label
  const fromTemplate = labels?.get?.(raw)
  if (fromTemplate) return fromTemplate
  return humanizePhotoTag(raw)
}

/** True when the tag is worth printing on the thumbnail. */
export function isMeaningfulTag(raw) {
  return !UNREMARKABLE_TAGS.has(String(raw ?? '').trim().toLowerCase())
}

/**
 * Work-step filter options, ordered the way the steps run (which is the order
 * the photos are already in), with a count each.
 *
 * @returns {Array<{id:string,name:string,count:number,position:number}>}
 */
export function buildStepFilterOptions(items) {
  const byId = new Map()
  for (const p of items || []) {
    const id = p._work_step_id || UNASSIGNED_STEP_KEY
    const name = p._work_step_name || 'Unassigned step'
    const position = p._work_step_position ?? Number.MAX_SAFE_INTEGER
    const cur = byId.get(id) || { id, name, count: 0, position }
    cur.count += 1
    // Keep the smallest position seen so a step sorts by where it runs.
    if (position < cur.position) cur.position = position
    byId.set(id, cur)
  }
  return Array.from(byId.values()).sort((a, b) =>
    (a.position - b.position) || a.name.localeCompare(b.name))
}

/**
 * Photo-tag filter options with counts. Named tags (the ones a work step
 * template asked for) sort first alphabetically; the generic ones sink to the
 * bottom, because a reviewer is looking for "Refrigerator Nameplate", not
 * "General".
 *
 * @returns {Array<{id:string,label:string,count:number}>}
 */
export function buildTagFilterOptions(items, labels) {
  const byTag = new Map()
  for (const p of items || []) {
    const id = String(p.photo_type ?? '').trim() || 'general'
    const cur = byTag.get(id) || { id, label: photoTagLabel(p, labels), count: 0 }
    cur.count += 1
    byTag.set(id, cur)
  }
  return Array.from(byTag.values()).sort((a, b) => {
    const am = isMeaningfulTag(a.id) ? 0 : 1
    const bm = isMeaningfulTag(b.id) ? 0 : 1
    return (am - bm) || a.label.localeCompare(b.label)
  })
}

/**
 * Apply the gallery's filters. All three are independent and combine with AND,
 * matching what the two dropdowns and the report flag show on screen.
 *
 * @param {Array}  items
 * @param {Object} opts
 * @param {string} [opts.stepId='all']  work step id, WORK_ORDER_STEP_KEY, or 'all'
 * @param {string} [opts.tag='all']     photo_type, or 'all'
 * @param {boolean}[opts.reportOnly]    only photos flagged for the final report
 */
export function filterGalleryPhotos(items, { stepId = ALL, tag = ALL, reportOnly = false } = {}) {
  let list = items || []
  if (stepId !== ALL) {
    list = list.filter(p => (p._work_step_id || UNASSIGNED_STEP_KEY) === stepId)
  }
  if (tag !== ALL) {
    list = list.filter(p => (String(p.photo_type ?? '').trim() || 'general') === tag)
  }
  if (reportOnly) list = list.filter(p => p.include_in_final_report)
  return list
}

/**
 * Drop a filter selection that no longer matches anything — e.g. the step
 * filter is pinned to a step whose only photo was just deleted. Returns the
 * value to keep.
 */
export function reconcileFilterValue(value, options) {
  if (value === ALL) return ALL
  return (options || []).some(o => o.id === value) ? value : ALL
}
