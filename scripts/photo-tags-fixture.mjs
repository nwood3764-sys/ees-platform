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
  reconcileSelection,
  selectionSet,
  selectionLabel,
  toggleSelection,
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
check('filter by one step',
  filterGalleryPhotos(items, { steps: ['s1'] }).map(p => p.id), ['p1', 'p2', 'p3'])
check('filter by the work order itself',
  filterGalleryPhotos(items, { steps: [WORK_ORDER_STEP_KEY] }).map(p => p.id), ['p6'])
check('filter by one tag across steps',
  filterGalleryPhotos(items, { tags: ['general'] }).map(p => p.id), ['p3', 'p5', 'p6'])
check('step and tag combine with AND',
  filterGalleryPhotos(items, { steps: ['s1'], tags: ['general'] }).map(p => p.id), ['p3'])
check('report flag combines too',
  filterGalleryPhotos(items, { reportOnly: true }).map(p => p.id), ['p1', 'p4'])
check('report flag with a step',
  filterGalleryPhotos(items, { steps: ['s1'], reportOnly: true }).map(p => p.id), ['p1'])
check('a combination with no matches returns empty',
  filterGalleryPhotos(items, { steps: ['s2'], tags: ['before'] }), [])
check('filtering never mutates the input', items.length, 7)

// ── Multi-select: several steps, several tags ──────────────────────────────
// Within one dropdown the choices are an OR; between the two they are an AND.
check('two steps at once',
  filterGalleryPhotos(items, { steps: ['s1', 's3'] }).map(p => p.id), ['p1', 'p2', 'p3', 'p4'])
check('three steps at once',
  filterGalleryPhotos(items, { steps: ['s1', 's2', 's3'] }).map(p => p.id),
  ['p1', 'p2', 'p3', 'p4', 'p5'])
check('two tags at once',
  filterGalleryPhotos(items, { tags: ['exterior_face_north', 'before'] }).map(p => p.id),
  ['p1', 'p7'])
check('several steps AND several tags',
  filterGalleryPhotos(items, { steps: ['s1', 's3'], tags: ['general', 'exterior_face_north'] })
    .map(p => p.id), ['p1', 'p3'])
check('a Set works as well as an array',
  filterGalleryPhotos(items, { steps: new Set(['s1', 's3']) }).map(p => p.id),
  ['p1', 'p2', 'p3', 'p4'])
// Clearing the last checkbox must WIDEN to everything, never blank the grid.
check('an empty selection means all',
  filterGalleryPhotos(items, { steps: [] }).map(p => p.id), items.map(p => p.id))
check('an empty tag selection means all',
  filterGalleryPhotos(items, { steps: [], tags: [] }).map(p => p.id), items.map(p => p.id))
check("the literal 'all' still means all",
  filterGalleryPhotos(items, { steps: ALL }).map(p => p.id), items.map(p => p.id))
check('a single string still works',
  filterGalleryPhotos(items, { steps: 's1' }).map(p => p.id), ['p1', 'p2', 'p3'])

check('selectionSet of nothing is null', selectionSet([]), null)
check('selectionSet of all is null', selectionSet(ALL), null)
check('selectionSet drops blanks', Array.from(selectionSet(['s1', '', null, 's2'])), ['s1', 's2'])

check('toggle adds', toggleSelection([], 's1'), ['s1'])
check('toggle adds a second', toggleSelection(['s1'], 's2'), ['s1', 's2'])
check('toggle removes', toggleSelection(['s1', 's2'], 's1'), ['s2'])
check('toggling the last one back to empty', toggleSelection(['s1'], 's1'), [])

check('closed label with nothing chosen', selectionLabel([], stepOpts, 'All work steps (7)'),
  'All work steps (7)')
check('closed label names one', selectionLabel(['s1'], stepOpts, 'all'), 'Building Photos')
check('closed label names two', selectionLabel(['s1', 's2'], stepOpts, 'all'),
  'Building Photos, Roof / Ceiling')
check('closed label counts beyond two', selectionLabel(['s1', 's2', 's3'], stepOpts, 'all'),
  'Building Photos +2 more')

// A photo with no photo_type at all filters as 'general' rather than
// disappearing from both the dropdown and the grid.
const untyped = [{ id: 'u1', _work_step_id: 's1', _work_step_name: 'Building Photos', _work_step_position: 1 }]
check('untyped photo lands under general',
  buildTagFilterOptions(untyped).map(o => o.id), ['general'])
check('untyped photo is reachable by the general filter',
  filterGalleryPhotos(untyped, { tags: ['general'] }).map(p => p.id), ['u1'])

// ── Stale selections ───────────────────────────────────────────────────────
check('live selections are kept', reconcileSelection(['s1', 's2'], stepOpts), ['s1', 's2'])
check('a deleted step is dropped', reconcileSelection(['s1', 's9'], stepOpts), ['s1'])
// Every choice gone means "all", never a grid filtered to nothing.
check('all choices gone falls back to all', reconcileSelection(['s9'], stepOpts), [])
check('all stays all', reconcileSelection(ALL, stepOpts), [])
check('no options at all falls back to all', reconcileSelection(['s1'], []), [])

if (failures > 0) {
  console.error(`\nphoto-tags fixture: ${failures} of ${checks} checks FAILED`)
  process.exit(1)
}
console.log(`photo-tags fixture: ${checks} checks passed`)
