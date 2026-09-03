// Fixture test for the page-layout card catalog.
//
// The rule this pins: every card the record page can draw is offered by the
// palette on every object that can host it, and any card can be copied into any
// other section — the right rail, another tab, a new section — without the
// original moving. Before 2026-08-27 the editor could add exactly two card
// types, so "put Documents on this layout" was a database change.
//
// The cases are drawn from the real layouts that exposed it: the
// WI-IRA-MF-HOMES-PR — Enrollments layout (a Related-tab Documents card that
// was a related list, and a right-rail section), and the work order layouts
// that carry the only work_plan cards in the platform.
//
// Run with:  node scripts/layout-cards-fixture.mjs

import {
  CARD_WIDGET_TYPES,
  CARD_CATALOG,
  RIGHT_RAIL,
  isCardWidget,
  cardDefinition,
  availableCards,
  buildCardWidget,
  cardCopyTargets,
  copyCardTo,
  cardPlacements,
} from '../src/lib/layoutCards.js'

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

// ─── The canvas state the editor holds ───────────────────────────────────────
// Modelled on WI-IRA-MF-HOMES-PR — Enrollments: typed document slots on the
// Details tab, a right-rail section, and a Related tab carrying cards.
const enrollmentSections = () => [
  {
    key: 'sec-1', label: 'Supporting Documentation', tab: 'Details', placement: 'main', columns: 2,
    widgets: [
      { key: 'w-fg', type: 'field_group', title: 'Fields', config: { fields: [] } },
      { key: 'w-hpxml', type: 'file_gallery', title: 'Reservation HPXMLv4 / BuildingSync File',
        config: { target: 'documents', document_type: 'reservation_hpxml' } },
    ],
  },
  {
    key: 'sec-rail', label: 'Documents', tab: 'Details', placement: 'right', columns: 1,
    widgets: [
      { key: 'w-assess', type: 'related_list', title: 'Assessments',
        config: { table: 'assessments', fk: 'building_id', columns: [{ name: 'assessment_name' }] } },
    ],
  },
  {
    key: 'sec-rel', label: 'New Section', tab: 'Related', placement: 'main', columns: 2,
    widgets: [
      { key: 'w-docs', type: 'related_list', title: 'Documents',
        config: { table: 'documents', fk: 'related_id', columns: [{ name: 'name' }] } },
    ],
  },
]

// ─── Card identity ───────────────────────────────────────────────────────────

check('a field group is not a card', isCardWidget('field_group'), false)
check('a documents gallery is a card', isCardWidget('file_gallery'), true)
check('a widget row is recognised by its widget_type', isCardWidget({ widget_type: 'work_plan' }), true)
check('a canvas widget is recognised by its type', isCardWidget({ type: 'report' }), true)
check('status_path is page chrome, not a card', isCardWidget('status_path'), false)
check('map renders inside a section, not as a card', isCardWidget('map'), false)

// Every catalog entry must name a type the renderer actually draws — a card
// offered by the palette that the record page ignores is worse than no card.
for (const card of CARD_CATALOG) {
  check(`catalog "${card.id}" names a drawable card type`,
    CARD_WIDGET_TYPES.has(card.widgetType), true)
}
check('Documents and Photos are separate cards on one widget type',
  CARD_CATALOG.filter(c => c.widgetType === 'file_gallery').map(c => c.id),
  ['documents', 'photos'])
check('an unknown palette id has no definition', cardDefinition('nope'), null)

// ─── Availability, per object ────────────────────────────────────────────────

const enrollmentCards = availableCards('enrollments', enrollmentSections())
check('every card is offered on enrollments, none hidden',
  enrollmentCards.length, CARD_CATALOG.length)
check('Documents can be placed on an enrollment — the complaint that started this',
  enrollmentCards.find(c => c.id === 'documents').disabled, false)
check('Related List can be placed on an enrollment',
  enrollmentCards.find(c => c.id === 'related_list').disabled, false)
check('Report can be placed on an enrollment',
  enrollmentCards.find(c => c.id === 'report').disabled, false)
check('Photos is refused on an enrollment, and says why',
  enrollmentCards.find(c => c.id === 'photos').disabled, true)
check('the Photos refusal names Documents as the card to use instead',
  /Documents card/.test(enrollmentCards.find(c => c.id === 'photos').disabledReason), true)
// Nicholas, 2026-09-03: "we need to have a communication on all enrollment
// objects and all incentive record objects." conversations gained an
// enrollment_id anchor that day; before it, this card was correctly refused
// here, which is why the check reads the other way now.
check('Communications can be placed on an enrollment',
  enrollmentCards.find(c => c.id === 'conversation_panel').disabled, false)
// CONTROL — an object with no anchor column on conversations is still refused,
// and says why. A card that cannot hold a thread must not be offered.
const workStepCards = availableCards('work_steps', [])
check('Communications is refused on a work step',
  workStepCards.find(c => c.id === 'conversation_panel').disabled, true)
check('the refusal explains that no thread can be anchored there',
  /foreign key/.test(workStepCards.find(c => c.id === 'conversation_panel').disabledReason), true)
check('Work Plan is refused off a work order',
  enrollmentCards.find(c => c.id === 'work_plan').disabled, true)
check('Publish History is refused off a project report template',
  enrollmentCards.find(c => c.id === 'prtsn_history').disabled, true)

const workOrderCards = availableCards('work_orders', [])
check('Photos can be placed on a work order', workOrderCards.find(c => c.id === 'photos').disabled, false)
check('Work Plan can be placed on a work order', workOrderCards.find(c => c.id === 'work_plan').disabled, false)
check('Communications can be placed on a work order',
  workOrderCards.find(c => c.id === 'conversation_panel').disabled, false)

const withPlan = availableCards('work_orders', [
  { key: 's', tab: 'Details', widgets: [{ key: 'w', type: 'work_plan', config: {} }] },
])
check('a second Work Plan is refused — a record shows one',
  withPlan.find(c => c.id === 'work_plan').disabled, true)
check('a second Documents gallery is NOT refused — slots are many per layout',
  availableCards('enrollments', [
    { key: 's', tab: 'Details', widgets: [{ key: 'w', type: 'file_gallery', config: { target: 'documents' } }] },
  ]).find(c => c.id === 'documents').disabled, false)
check('a second Related List is never refused',
  availableCards('enrollments', enrollmentSections()).find(c => c.id === 'related_list').disabled, false)

// ─── Building a card ─────────────────────────────────────────────────────────

const docsCard = buildCardWidget('documents', 'enrollments', 'w-new-1')
check('a Documents card is a documents-target catch-all gallery',
  { type: docsCard.type, config: docsCard.config },
  { type: 'file_gallery', config: { target: 'documents', document_type: 'attachment' } })
check('a Documents card is titled Documents', docsCard.title, 'Documents')
check('a new card carries the key it was given', docsCard.key, 'w-new-1')

const commsCard = buildCardWidget('conversation_panel', 'properties', 'w-new-2')
check('a Communications card anchors to this object’s FK on conversations',
  commsCard.config, { fk: 'property_id', table: 'conversations', channel_filter: null })
check('a Photos card on a work order targets photos',
  buildCardWidget('photos', 'work_orders', 'w-new-3').config, { target: 'photos' })
check('a Photos card cannot be built for an enrollment even by id',
  buildCardWidget('photos', 'enrollments', 'w-new-4'), null)
check('an unknown card id builds nothing', buildCardWidget('nope', 'enrollments', 'w-new-5'), null)

// ─── Copy targets ────────────────────────────────────────────────────────────

const targets = cardCopyTargets(enrollmentSections(), 'sec-rel', ['Assessment'])
check('every existing section is a target, grouped by where it renders',
  targets.filter(t => t.kind === 'section').map(t => `${t.group}/${t.label}`),
  ['Details/Supporting Documentation', 'Related/New Section', 'Right sidebar/Documents'])
// Groups follow the record page's own tab order with the rail LAST, not the
// order sections happen to be stored in. Grouping by section_order put "Right
// sidebar" between two tabs, where it reads as a third tab — caught in the
// browser by tools/layout-card-check, not by this file, which is why that tool
// exists.
check('groups run Details, Related, custom tabs, then the right sidebar last',
  [...new Set(targets.map(t => t.group))],
  ['Details', 'Related', 'Assessment', 'Right sidebar'])
check('each group ends with its own "new section" entry',
  targets.filter(t => t.group === 'Right sidebar').map(t => t.kind),
  ['section', 'new'])
check('the source section is offered and marked as the source',
  targets.find(t => t.sectionKey === 'sec-rel').isSource, true)
check('a new section is offered on every tab and on the right sidebar',
  targets.filter(t => t.kind === 'new').map(t => t.group),
  ['Details', 'Related', 'Assessment', 'Right sidebar'])
check('the right sidebar’s new-section entry is the LAST target in the list',
  targets.at(-1).id, `new::${RIGHT_RAIL}`)
check('the right-sidebar new-section target carries placement right',
  targets.find(t => t.id === `new::${RIGHT_RAIL}`).placement, 'right')
check('an empty tab with no sections is still a target',
  targets.some(t => t.kind === 'new' && t.tab === 'Assessment'), true)
check('Details and Related are targets on a layout that has neither',
  cardCopyTargets([], null, []).map(t => t.group),
  ['Details', 'Related', 'Right sidebar'])
check('a tab named Details or Related is not duplicated as a custom tab',
  cardCopyTargets([], null, ['Details', 'Related']).map(t => t.group),
  ['Details', 'Related', 'Right sidebar'])

// ─── Copying ─────────────────────────────────────────────────────────────────

// The exact thing asked for: the same Documents card in the right sidebar AND
// on the Related tab.
const railTarget = targets.find(t => t.id === 'section::sec-rail')
const copied = copyCardTo(enrollmentSections(), 'w-docs', railTarget, { widgetKey: 'w-copy-1' })
check('the copy lands in the right-rail section',
  copied.find(s => s.key === 'sec-rail').widgets.map(w => w.key),
  ['w-assess', 'w-copy-1'])
check('the original stays on the Related tab — this duplicates, never moves',
  copied.find(s => s.key === 'sec-rel').widgets.map(w => w.key),
  ['w-docs'])
check('the copy keeps its title and type',
  (() => { const w = copied.find(s => s.key === 'sec-rail').widgets[1]; return [w.title, w.type] })(),
  ['Documents', 'related_list'])
check('the copy’s config equals the original’s',
  copied.find(s => s.key === 'sec-rail').widgets[1].config,
  { table: 'documents', fk: 'related_id', columns: [{ name: 'name' }] })

// A shallow copy would have the two cards sharing one columns array, so
// editing either would silently edit the other.
const shared = copyCardTo(enrollmentSections(), 'w-docs', railTarget, { widgetKey: 'w-copy-2' })
const originalCfg = shared.find(s => s.key === 'sec-rel').widgets[0].config
const copyCfg = shared.find(s => s.key === 'sec-rail').widgets[1].config
copyCfg.columns.push({ name: 'document_type' })
check('the copy’s config is deep-cloned, not shared with the original',
  originalCfg.columns.length, 1)

const newSection = copyCardTo(
  enrollmentSections(), 'w-hpxml',
  targets.find(t => t.id === `new::${RIGHT_RAIL}`),
  { widgetKey: 'w-copy-3', sectionKey: 'sec-new-1' })
check('a copy into a new right-rail section creates it with placement right',
  (() => { const s = newSection.find(x => x.key === 'sec-new-1'); return [s.placement, s.columns, s.tab] })(),
  ['right', 1, 'Details'])
check('the new section is named for the card it holds',
  newSection.find(s => s.key === 'sec-new-1').label,
  'Reservation HPXMLv4 / BuildingSync File')
check('the new section holds exactly the copy',
  newSection.find(s => s.key === 'sec-new-1').widgets.map(w => w.key), ['w-copy-3'])
check('the original slot is untouched on the Details tab',
  newSection.find(s => s.key === 'sec-1').widgets.map(w => w.key), ['w-fg', 'w-hpxml'])

const newTabSection = copyCardTo(
  enrollmentSections(), 'w-docs',
  targets.find(t => t.id === 'new::Assessment'),
  { widgetKey: 'w-copy-4', sectionKey: 'sec-new-2' })
check('a copy into a new tab section carries that tab and main placement',
  (() => { const s = newTabSection.find(x => x.key === 'sec-new-2'); return [s.tab, s.placement] })(),
  ['Assessment', 'main'])

check('copying an unknown widget changes nothing',
  copyCardTo(enrollmentSections(), 'nope', railTarget, { widgetKey: 'x' }).length,
  enrollmentSections().length)
check('copying into a section that no longer exists changes nothing',
  copyCardTo(enrollmentSections(), 'w-docs', { kind: 'section', sectionKey: 'gone' }, { widgetKey: 'x' })
    .flatMap(s => s.widgets).length,
  enrollmentSections().flatMap(s => s.widgets).length)
check('copying with no target changes nothing',
  copyCardTo(enrollmentSections(), 'w-docs', null, { widgetKey: 'x' }).length,
  enrollmentSections().length)

// ─── Where a card already sits ───────────────────────────────────────────────

check('an existing card reports every placement it has',
  cardPlacements(enrollmentSections(), 'related_list').map(p => `${p.title}@${p.tab}`),
  ['Assessments@Right sidebar', 'Documents@Related'])
check('a card type nobody placed reports none',
  cardPlacements(enrollmentSections(), 'work_plan'), [])
check('after a copy the card reports both placements',
  cardPlacements(copied, 'related_list').map(p => p.tab),
  ['Right sidebar', 'Right sidebar', 'Related'])

console.log(failures === 0
  ? `layout-cards fixture: ${checks} checks passed`
  : `layout-cards fixture: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
