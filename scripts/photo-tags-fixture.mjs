// Fixture test for the work order photo roll-up's tags and filters.
//
// The behaviour that broke (Nicholas, 2026-08-22): WO-00204's Photos card read
// "0" while 73 photos sat on its work steps. The read was fixed in
// storageService (it now unions the work-step grain and the work-order grain);
// what's covered here is everything downstream of that — how a photo's two
// tags are labelled, what the two filter dropdowns offer, and that filtering
// by one never quietly drops photos that belong to the other.
//
// Run with:  node scripts/photo-tags-fixture.mjs

import {
  ALL,
  WORK_ORDER_STEP_KEY,
  UNASSIGNED_STEP_KEY,
  humanizePhotoTag,
  photoTagLabel,
  isMeaningfulTag,
  buildStepFilterOptions,
  buildTagFilterOptions,
  filterGalleryPhotos,
  reconcileFilterValue,
} from '../src/lib/photoTags.js'

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

// A Multifamily Energy Assessment work order, shaped like WO-00204: named
// photo prompts captured in LEAP Pad, ad hoc 'general' photos uploaded from a
// work step's own record page, one photo on the work order itself, and one
// photo whose step is not on this work order (the "can't happen" row that
// must still not vanish).
const items = [
  { id: 'p1', photo_type: 'exterior_face_north', include_in_final_report: true,
    _work_step_id: 's1', _work_step_name: 'Building Photos', _work_step_position: 1 },
  { id: 'p2', photo_type: 'exterior_face_south', include_in_final_report: false,
    _work_step_id: 's1', _work_step_name: 'Building Photos', _work_step_position: 1 },
  { id: 'p3', photo_type: 'general', include_in_final_report: false,
    _work_step_id: 's1', _work_step_name: 'Building Photos', _work_step_position: 1 },
  { id: 'p4', photo_type: 'kitchen_refrigerator_nameplate_photo', include_in_final_report: true,
    _work_step_id: 's3', _work_step_name: 'Kitchen', _work_step_position: 3 },
  { id: 'p5', photo_type: 'general', include_in_final_report: false,
    _work_step_id: 's2', _work_step_name: 'Roof / Ceiling', _work_step_position: 2 },
  { id: 'p6', photo_type: 'general', include_in_final_report: false,
    _work_step_id: WORK_ORDER_STEP_KEY, _work_step_name: 'Work Order',
    _work_step_position: Number.MAX_SAFE_INTEGER - 1 },
  { id: 'p7', photo_type: 'before', include_in_final_report: false,
    _work_step_id: UNASSIGNED_STEP_KEY, _work_step_name: 'Unassigned step',
    _work_step_position: Number.MAX_SAFE_INTEGER },
]

// ── Labels ─────────────────────────────────────────────────────────────────
check('humanize snake case', humanizePhotoTag('kitchen_overall_photo'), 'Kitchen Overall Photo')
check('humanize hyphens', humanizePhotoTag('exterior-face-north'), 'Exterior Face North')
check('humanize shouty input', humanizePhotoTag('ATTIC_PHOTO'), 'Attic Photo')
check('humanize empty', humanizePhotoTag(''), 'Untagged')
check('humanize null', humanizePhotoTag(null), 'Untagged')

// The label on the work step template always wins — that's the wording the
// technician saw in the field.
const templateLabels = new Map([
  ['kitchen_refrigerator_nameplate_photo', 'Refrigerator Nameplate'],
])
check('template label wins', photoTagLabel(items[3], templateLabels), 'Refrigerator Nameplate')
check('resolved label on the row wins',
  photoTagLabel({ photo_type: 'x_photo', _photo_tag_label: 'Resolved' }, templateLabels), 'Resolved')
check('falls back to humanized', photoTagLabel(items[0], templateLabels), 'Exterior Face North')
check('no label map at all', photoTagLabel(items[0]), 'Exterior Face North')

// Generic legs carry no information a chip could add.
check('general is not chip-worthy', isMeaningfulTag('general'), false)
check('empty is not chip-worthy', isMeaningfulTag(''), false)
check('undefined is not chip-worthy', isMeaningfulTag(undefined), false)
check('before is chip-worthy', isMeaningfulTag('before'), true)
check('a named prompt is chip-worthy', isMeaningfulTag('attic_photo'), true)

// ── Work step dropdown ─────────────────────────────────────────────────────
const stepOpts = buildStepFilterOptions(items)
check('step options are in execution order, work order last',
  stepOpts.map(o => o.id), ['s1', 's2', 's3', WORK_ORDER_STEP_KEY, UNASSIGNED_STEP_KEY])
check('step counts', stepOpts.map(o => o.count), [3, 1, 1, 1, 1])
check('step names', stepOpts.map(o => o.name),
  ['Building Photos', 'Roof / Ceiling', 'Kitchen', 'Work Order', 'Unassigned step'])
check('every photo is reachable from some step option',
  stepOpts.reduce((n, o) => n + o.count, 0), items.length)
check('no photos, no options', buildStepFilterOptions([]), [])
check('undefined items', buildStepFilterOptions(undefined), [])

// ── Tag dropdown ───────────────────────────────────────────────────────────
const tagOpts = buildTagFilterOptions(items, templateLabels)
check('named tags sort first, generic sinks',
  tagOpts.map(o => o.id),
  ['before', 'exterior_face_north', 'exterior_face_south',
   'kitchen_refrigerator_nameplate_photo', 'general'])
check('tag counts', tagOpts.map(o => o.count), [1, 1, 1, 1, 3])
check('tag labels use the template wording',
  tagOpts.find(o => o.id === 'kitchen_refrigerator_nameplate_photo').label, 'Refrigerator Nameplate')
check('every photo is reachable from some tag option',
  tagOpts.reduce((n, o) => n + o.count, 0), items.length)

// ── Filtering ──────────────────────────────────────────────────────────────
check('unfiltered returns everything',
  filterGalleryPhotos(items, {}).map(p => p.id), items.map(p => p.id))
check('filter by step',
  filterGalleryPhotos(items, { stepId: 's1' }).map(p => p.id), ['p1', 'p2', 'p3'])
check('filter by the work order itself',
  filterGalleryPhotos(items, { stepId: WORK_ORDER_STEP_KEY }).map(p => p.id), ['p6'])
check('filter by tag across steps',
  filterGalleryPhotos(items, { tag: 'general' }).map(p => p.id), ['p3', 'p5', 'p6'])
check('step and tag combine with AND',
  filterGalleryPhotos(items, { stepId: 's1', tag: 'general' }).map(p => p.id), ['p3'])
check('report flag combines too',
  filterGalleryPhotos(items, { reportOnly: true }).map(p => p.id), ['p1', 'p4'])
check('report flag with a step',
  filterGalleryPhotos(items, { stepId: 's1', reportOnly: true }).map(p => p.id), ['p1'])
check('a combination with no matches returns empty',
  filterGalleryPhotos(items, { stepId: 's2', tag: 'before' }), [])
check('filtering never mutates the input', items.length, 7)

// A photo with no photo_type at all filters as 'general' rather than
// disappearing from both the dropdown and the grid.
const untyped = [{ id: 'u1', _work_step_id: 's1', _work_step_name: 'Building Photos', _work_step_position: 1 }]
check('untyped photo lands under general',
  buildTagFilterOptions(untyped).map(o => o.id), ['general'])
check('untyped photo is reachable by the general filter',
  filterGalleryPhotos(untyped, { tag: 'general' }).map(p => p.id), ['u1'])

// ── Stale selections ───────────────────────────────────────────────────────
check('a live selection is kept', reconcileFilterValue('s1', stepOpts), 's1')
check('a deleted step falls back to all', reconcileFilterValue('s9', stepOpts), ALL)
check('all stays all', reconcileFilterValue(ALL, stepOpts), ALL)
check('no options at all falls back to all', reconcileFilterValue('s1', []), ALL)

if (failures > 0) {
  console.error(`\nphoto-tags fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`photo-tags fixture: ${checks} checks passed`)
