// Cards a page layout can carry, and where each one may be placed.
//
// A CARD is a widget the record page draws as its own panel — a related list,
// a documents or photos gallery, a Communications panel, an embedded report, a
// work plan, publish history. Fields are not cards; they live in a field group
// inside a section.
//
// Why this module exists (2026-08-27): the layout editor could add exactly TWO
// card types — a related list and a Communications panel. Documents galleries,
// photo galleries, reports, work plans and publish history existed only where a
// migration had seeded them, so "put Documents on this layout" was a database
// change, on every object. Nicholas, from an enrollment record: "I wanna put
// documents on the right sidebar and on the related tabs, but it's not giving
// that option. I should be able to put them in both places… For every single
// record type of every single object, I should be able to duplicate them on the
// side and in the details record detail pages tabs."
//
// So the catalog is the answer to BOTH halves:
//
//   * every card the renderer can draw is offered, on every object that can
//     host it — the availability rule is stated here once, as data, instead of
//     being implied by which migrations happened to run;
//   * a card is copied into any other section — the right rail, another tab, a
//     new section — because placement lives on the SECTION, so the same card in
//     two places is genuinely two widget rows, and duplicating one is a pure
//     array transform rather than a special case in the renderer.
//
// Pure: no React, no Supabase, no clock. New keys are passed in by the caller
// so a copy is deterministic and testable. Pinned by
// scripts/layout-cards-fixture.mjs.

import { OBJECT_CONVERSATION_FK } from './conversationAnchors.js'

// What the omni-channel card is CALLED, in one place: the palette that places
// it, the card the record page draws, and the migration that seeded it all say
// the same word. It answered to "Conversations" on 47 seeded layouts and
// "Communications" in the palette until 2026-09-03, so the same card had two
// names depending on which screen you were on.
export const CONVERSATION_CARD_TITLE = 'Communications'

// ─── What the record page draws as a card ────────────────────────────────────
// Kept in sync with RecordDetail's renderRecordCard: every type here is drawn
// by that one function, in the main flow and in the right rail alike.

export const CARD_WIDGET_TYPES = new Set([
  'related_list', 'file_gallery', 'conversation_panel', 'conversation_messages',
  'conversation_list', 'report', 'prtsn_history', 'work_plan',
])

/** True when this widget is a card (drawn as its own panel), not a field group. */
export function isCardWidget(widgetOrType) {
  const t = typeof widgetOrType === 'string'
    ? widgetOrType
    : (widgetOrType?.type || widgetOrType?.widget_type)
  return CARD_WIDGET_TYPES.has(t)
}

// ─── Object-scoped availability ──────────────────────────────────────────────

// Objects whose records can host a Communications (two-way email) panel, and
// the FK column on `conversations` that anchors a thread to them. A
// conversation_panel stores its anchor as widget_config.fk.
//
// This used to be one of eight hand-kept copies of that fact. There is now one
// client definition — conversationAnchors.js — and the database derives its
// own from the conversations table's foreign keys. Re-exported here because
// the layout palette has always been imported for it.
export { OBJECT_CONVERSATION_FK }

// Objects a PHOTOS gallery may be placed on. Mirror of PHOTO_ALLOWED_OBJECTS in
// storageService — photos route to an evidence bucket by object, and a gallery
// on anything else fails loudly at upload time. Offering it would be offering a
// card that cannot work; Documents is the card for everything else.
export const PHOTO_GALLERY_OBJECTS = new Set([
  'work_orders', 'work_steps', 'vehicle_inspections', 'vehicle_activity_items',
])

// ─── The catalog ─────────────────────────────────────────────────────────────
//
//   id            stable palette key (not a widget_type — Documents and Photos
//                 are both file_gallery, and they are different cards)
//   widgetType    what gets written to page_layout_widgets.widget_type
//   configure     'related_list' opens the related-list builder; 'gallery' and
//                 'report' open the card config modal; null needs no setup
//   onePerLayout  the record page shows one of these per record, so a second
//                 is offered as disabled rather than silently allowed
//
// `availableOn` returns null when the card may be placed, or the reason it may
// not — the reason is shown in the palette, because "the option isn't there" is
// exactly the complaint this module answers.
export const CARD_CATALOG = [
  {
    id: 'related_list',
    widgetType: 'related_list',
    label: 'Related List',
    description: 'Child records in a table — any object below this one.',
    defaultTitle: 'Related List',
    configure: 'related_list',
    availableOn: () => null,
    buildConfig: () => ({}),
  },
  {
    id: 'documents',
    widgetType: 'file_gallery',
    label: 'Documents',
    description: 'Upload, preview, multi-select and bulk-download files on this record.',
    defaultTitle: 'Documents',
    configure: 'gallery',
    availableOn: () => null,
    buildConfig: () => ({ target: 'documents', document_type: 'attachment' }),
  },
  {
    id: 'photos',
    widgetType: 'file_gallery',
    label: 'Photos',
    description: 'Field photo evidence — capture, tag, watermark, lightbox.',
    defaultTitle: 'Photos',
    configure: 'gallery',
    availableOn: (object) => PHOTO_GALLERY_OBJECTS.has(object)
      ? null
      : 'Photos are field evidence and only route to a bucket on work orders, work steps and vehicle inspections. Use a Documents card here.',
    buildConfig: () => ({ target: 'photos' }),
  },
  {
    id: 'conversation_panel',
    widgetType: 'conversation_panel',
    label: CONVERSATION_CARD_TITLE,
    description: 'Two-way email threads anchored to this record.',
    defaultTitle: CONVERSATION_CARD_TITLE,
    configure: null,
    onePerLayout: true,
    availableOn: (object) => OBJECT_CONVERSATION_FK[object]
      ? null
      : 'Conversations carry no foreign key to this object, so a thread cannot be anchored to one of its records.',
    buildConfig: (object) => ({
      fk: OBJECT_CONVERSATION_FK[object], table: 'conversations', channel_filter: null,
    }),
  },
  {
    id: 'report',
    widgetType: 'report',
    label: 'Report',
    description: 'A saved report rendered inline, optionally filtered to this record.',
    defaultTitle: 'Report',
    configure: 'report',
    availableOn: () => null,
    buildConfig: () => ({ report_id: null, max_rows: 50 }),
  },
  {
    id: 'work_plan',
    widgetType: 'work_plan',
    label: 'Work Plan',
    description: 'The work order’s plan, its steps and their evidence.',
    defaultTitle: 'Work Plan',
    configure: null,
    onePerLayout: true,
    availableOn: (object) => object === 'work_orders'
      ? null
      : 'A work plan belongs to a work order.',
    buildConfig: () => ({}),
  },
  {
    id: 'prtsn_history',
    widgetType: 'prtsn_history',
    label: 'Publish History',
    description: 'Published generations of this template.',
    defaultTitle: 'Publish History',
    configure: null,
    onePerLayout: true,
    availableOn: (object) => object === 'project_report_templates'
      ? null
      : 'Publish history is recorded for project report templates.',
    buildConfig: () => ({}),
  },
]

const CARD_BY_ID = new Map(CARD_CATALOG.map(c => [c.id, c]))

/** One catalog entry by palette id, or null. */
export function cardDefinition(cardId) {
  return CARD_BY_ID.get(cardId) || null
}

/**
 * The palette for one object: every card, each carrying whether it can be
 * placed here and — when it can't — why.
 *
 * `sections` is the editor's current canvas state; it decides the
 * one-per-layout cards. Nothing is hidden: a card an admin cannot place is
 * shown disabled with its reason, because a silently absent option is the
 * defect this replaces.
 */
export function availableCards(object, sections) {
  const placed = new Set()
  for (const s of sections || []) {
    for (const w of (s?.widgets || [])) {
      const t = w?.type || w?.widget_type
      if (t) placed.add(t)
    }
  }
  return CARD_CATALOG.map(card => {
    const objectReason = card.availableOn(object)
    if (objectReason) return { ...card, disabled: true, disabledReason: objectReason }
    if (card.onePerLayout && placed.has(card.widgetType)) {
      return {
        ...card,
        disabled: true,
        disabledReason: `This layout already has a ${card.label} card. A record shows one.`,
      }
    }
    return { ...card, disabled: false, disabledReason: null }
  })
}

/**
 * A new widget for the canvas from a catalog id. `key` is supplied by the
 * caller (the editor's key counter) so this stays deterministic.
 *
 * Returns null for an unknown id or a card the object cannot host — a caller
 * that ignores availability still cannot write an unplaceable card.
 */
export function buildCardWidget(cardId, object, key) {
  const card = CARD_BY_ID.get(cardId)
  if (!card) return null
  if (card.availableOn(object)) return null
  return {
    key,
    type: card.widgetType,
    title: card.defaultTitle,
    column: 1,
    size: 'medium',
    isRequired: false,
    config: card.buildConfig(object),
  }
}

// ─── Copying a card to another placement ─────────────────────────────────────

/** The right rail's target group / pseudo-tab name. */
export const RIGHT_RAIL = '__right_sidebar__'

/**
 * Where a card can be copied to: every section on the layout, grouped by the
 * surface it renders on, each group ending with "a new section".
 *
 * Groups come out in the record page's own order — Details, Related, custom
 * tabs alphabetically, then the right sidebar last, mirroring the editor's tab
 * bar (the rail pill sits on the far right). Grouping in section_order instead
 * put "Right sidebar" between two tabs, which reads as a third tab and made the
 * list's shape depend on which section happened to be second.
 *
 * The source section is included — copying a card beside itself is pointless
 * but not wrong, and excluding it would take a whole GROUP away when a tab has
 * only one section. It carries `isSource` so the caller can mark it.
 *
 * `tabs` names tabs that exist in the editor but hold no section yet, so a
 * freshly created tab is a target before anything is on it.
 */
export function cardCopyTargets(sections, sourceSectionKey, tabs) {
  const list = (sections || []).filter(Boolean)

  const custom = [...new Set([
    ...list.filter(s => (s.placement || 'main') !== 'right').map(s => s.tab || 'Details'),
    ...(tabs || []),
  ])].filter(t => t !== 'Details' && t !== 'Related').sort((a, b) => a.localeCompare(b))

  const groups = [
    { name: 'Details', tab: 'Details', placement: 'main' },
    { name: 'Related', tab: 'Related', placement: 'main' },
    ...custom.map(t => ({ name: t, tab: t, placement: 'main' })),
    { name: 'Right sidebar', tab: 'Details', placement: 'right' },
  ]

  const targets = []
  for (const g of groups) {
    const inGroup = list.filter(s => g.placement === 'right'
      ? (s.placement || 'main') === 'right'
      : (s.placement || 'main') !== 'right' && (s.tab || 'Details') === g.tab)
    for (const s of inGroup) {
      targets.push({
        id: `section::${s.key}`,
        kind: 'section',
        sectionKey: s.key,
        group: g.name,
        label: s.label || 'Untitled Section',
        isSource: s.key === sourceSectionKey,
      })
    }
    targets.push({
      id: g.placement === 'right' ? `new::${RIGHT_RAIL}` : `new::${g.tab}`,
      kind: 'new',
      tab: g.tab,
      placement: g.placement,
      group: g.name,
      label: 'New section…',
      isSource: false,
    })
  }
  return targets
}

/**
 * Copy one card into a target from cardCopyTargets, returning the next
 * sections array. The original is left exactly where it is — this is a
 * duplicate, not a move (a move is the existing ⠿ drag).
 *
 * `keys` supplies the new widget key and, for a 'new' target, the new section
 * key, so the whole operation is deterministic.
 *
 * A copied card keeps its title and its whole config, because it is meant to be
 * THE SAME card in a second place — a Documents gallery copied to the rail
 * lists the same files under the same heading. Returns the sections unchanged
 * when the widget or the target cannot be found.
 */
export function copyCardTo(sections, widgetKey, target, keys) {
  const list = sections || []
  let source = null
  for (const s of list) {
    const w = (s?.widgets || []).find(x => x.key === widgetKey)
    if (w) { source = w; break }
  }
  if (!source || !target) return list

  const copy = { ...source, key: keys.widgetKey, config: cloneConfig(source.config) }

  if (target.kind === 'section') {
    if (!list.some(s => s?.key === target.sectionKey)) return list
    return list.map(s => s.key !== target.sectionKey
      ? s
      : { ...s, widgets: [...(s.widgets || []), copy] })
  }

  if (target.kind === 'new') {
    const onRail = target.placement === 'right'
    const section = {
      key: keys.sectionKey,
      label: copy.title || 'New Section',
      columns: onRail ? 1 : 2,
      tab: onRail ? 'Details' : (target.tab || 'Details'),
      isCollapsible: false,
      isCollapsedByDefault: false,
      placement: onRail ? 'right' : 'main',
      widgets: [copy],
    }
    return [...list, section]
  }

  return list
}

// A config is plain JSON (arrays of column descriptors, via chains). A shallow
// spread would let the copy and the original share the same `columns` array,
// so editing one would silently edit the other.
function cloneConfig(config) {
  if (config == null) return {}
  return JSON.parse(JSON.stringify(config))
}

/**
 * Where a card of this type already sits on the layout, so the palette and the
 * copy menu can say "Documents is already on the Related tab" instead of
 * letting an admin add a third one by accident. Returns [{title, tab}].
 */
export function cardPlacements(sections, widgetType) {
  const out = []
  for (const s of sections || []) {
    for (const w of (s?.widgets || [])) {
      if ((w?.type || w?.widget_type) !== widgetType) continue
      out.push({
        title: w.title || w.widget_title || '',
        tab: (s.placement || 'main') === 'right' ? 'Right sidebar' : (s.tab || 'Details'),
        section: s.label || 'Untitled Section',
      })
    }
  }
  return out
}
