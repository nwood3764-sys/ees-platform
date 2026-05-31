// ===========================================================================
// recordActions.js
//
// Single-source-of-truth registry for every action that can appear in the
// RecordDetail topbar. Replaces the prior pattern of hardcoded conditional
// buttons in RecordDetail.jsx (which had grown unwieldy as actions
// accumulated: Edit, Clone, Delete, Generate Report, Schedule, Reschedule,
// Send for Signature, Publish, Unpublish, Archive, Restore, Preview, …).
//
// Architecture
// ------------
// Three concepts:
//
//   1. Registry (this file). Every action declared with: a stable key,
//      display label + icon, color, the objects it applies to, a
//      runtime `isAvailable(ctx)` predicate that filters by record
//      state, a `defaultTier` that says whether the action lands in
//      the visible primary cluster or in the Actions overflow menu by
//      default, and a `defaultSortOrder` that establishes the order
//      within its tier.
//
//   2. Overrides (page_layout_actions table). Per-layout rows that
//      override the registry's `defaultTier` / sort_order / label for
//      a specific action_key. Authored in LayoutEditor's Actions
//      section. Absence of an override row means "use registry
//      default."
//
//   3. Handlers (RecordDetail.jsx). The actual onClick functions live
//      with the state they operate on. RecordDetail builds a
//      `{[action_key]: handler}` map and hands it to TopbarActions.
//      The registry decides WHAT renders; RecordDetail wires HOW it
//      executes.
//
// Adding a new action
// -------------------
// 1. Define an ACTION_KEY entry below.
// 2. Add to ACTION_REGISTRY with applicableObjects, defaultTier,
//    defaultSortOrder, label, icon, color, and isAvailable.
// 3. In RecordDetail.jsx, add the handler to the actionHandlers map
//    in the topbar render.
// 4. (Optional) In LayoutEditor's Actions section, the new action
//    appears automatically — admins can promote/demote per layout.
// ===========================================================================

// ---------------------------------------------------------------------------
// Action keys — exported as a const map for use in handler maps and the
// LayoutEditor Actions section.
// ---------------------------------------------------------------------------
export const ACTION_KEYS = Object.freeze({
  EDIT:                    'edit',
  CLONE:                   'clone',
  DELETE:                  'delete',
  ADVANCE_TO_OPPORTUNITY:  'advance_to_opportunity',
  GENERATE_REPORT:         'generate_report',
  SCHEDULE_WORK_ORDERS:    'schedule_work_orders',
  RESCHEDULE_WORK_ORDERS:  'reschedule_work_orders',
  SCHEDULE_WORK_ORDER:     'schedule_work_order',
  RESCHEDULE_APPOINTMENT:  'reschedule_appointment',
  SEND_FOR_SIGNATURE:      'send_for_signature',
  RESEND_SIGNING_EMAIL:    'resend_signing_email',
  VOID_ENVELOPE:           'void_envelope',
  PREVIEW_PDF:             'preview_pdf',
  PREVIEW_DOCUMENT:        'preview_document',
  PREVIEW_EMAIL:           'preview_email',
  CLONE_TEMPLATE:          'clone_template',
  PUBLISH:                 'publish',
  UNPUBLISH:               'unpublish',
  ARCHIVE:                 'archive',
  RESTORE:                 'restore',
})

// ---------------------------------------------------------------------------
// Universal applicability — the literal string '*' on `applicableObjects`
// means "every object". Encoded as a separate sentinel rather than a list
// of every table name to keep the registry compact and self-documenting.
// ---------------------------------------------------------------------------
export const ALL_OBJECTS = '*'

// ---------------------------------------------------------------------------
// Color palette — paired with C.* from constants.js. Defining a named set
// here so each action's color choice is stable across desktop/mobile.
// ---------------------------------------------------------------------------
export const ACTION_COLORS = Object.freeze({
  EMERALD:    'emerald',           // primary affirmative
  BLUE:       'blue',              // scheduling / time-related
  SKY:        'sky',               // preview / read-only
  AMBER:      'amber',             // caution / unpublish / archive
  RED:        'red',               // destructive — delete / void
  NEUTRAL:    'neutral',           // clone / default
})

// ---------------------------------------------------------------------------
// THE REGISTRY.
//
// Each entry shape:
//   key                  — stable identifier, matches pla_action_key
//   label                — UI label
//   icon                 — SVG path string for the Icon component
//   color                — one of ACTION_COLORS
//   applicableObjects    — ALL_OBJECTS or array of table names
//   defaultTier          — 'primary' | 'menu'
//   defaultSortOrder     — integer; lower = earlier within tier
//   isAvailable(ctx)     — runtime predicate; ctx shape documented below
//
// isAvailable's ctx shape:
//   {
//     tableName,            // string
//     record,               // the record row
//     editing,              // boolean — true while user is in edit mode
//     statusLabel,          // resolved status label or null
//     lifecycle,            // lifecycle config object or null
//     lifecycleStatusValue, // 'Draft' | 'Active' | 'Archived' | null
//     lifecycleIsLocked,    // boolean
//     hasActiveTemplate,    // boolean — Send for Signature gate
//     envelopeIsResendable, // boolean
//     envelopeIsVoidable,   // boolean
//     hasRelatedObject,     // boolean — for template-record preview gates
//   }
//
// All actions are HIDDEN while `editing===true` except for Save and Cancel,
// which are NOT in this registry (they're built into the edit-mode shell
// in RecordDetail because they need direct access to the editor state).
// ---------------------------------------------------------------------------
export const ACTION_REGISTRY = Object.freeze({
  // ── Properties ────────────────────────────────────────────────────────────
  advance_to_opportunity: {
    key:                 ACTION_KEYS.ADVANCE_TO_OPPORTUNITY,
    label:               'Advance to Opportunity',
    icon:                'M13 7l5 5m0 0l-5 5m5-5H6',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['properties'],
    defaultTier:         'primary',
    defaultSortOrder:    15,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'properties',
  },

  edit: {
    key:                 ACTION_KEYS.EDIT,
    label:               'Edit',
    icon:                'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'primary',
    defaultSortOrder:    10,
    isAvailable: ({ editing, lifecycleIsLocked }) => !editing && !lifecycleIsLocked,
  },

  // ── Projects ────────────────────────────────────────────────────────────
  generate_report: {
    key:                 ACTION_KEYS.GENERATE_REPORT,
    label:               'Generate Report',
    icon:                'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['projects'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'projects',
  },
  schedule_work_orders: {
    key:                 ACTION_KEYS.SCHEDULE_WORK_ORDERS,
    label:               'Schedule Work Orders',
    icon:                'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['projects'],
    defaultTier:         'primary',
    defaultSortOrder:    30,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'projects',
  },
  reschedule_work_orders: {
    key:                 ACTION_KEYS.RESCHEDULE_WORK_ORDERS,
    label:               'Reschedule Work Orders',
    icon:                'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6 M16 2v4 M8 2v4 M3 10h18 M16 14v2.5l1.5 1.5 M16 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    color:               ACTION_COLORS.BLUE,
    applicableObjects:   ['projects'],
    defaultTier:         'menu',
    defaultSortOrder:    40,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'projects',
  },

  // ── Work orders ─────────────────────────────────────────────────────────
  schedule_work_order: {
    key:                 ACTION_KEYS.SCHEDULE_WORK_ORDER,
    label:               'Schedule',
    icon:                'M8 2v4 M16 2v4 M3 10h18 M19 16v6 M22 19h-6 M21 12.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ['work_orders'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing, statusLabel }) =>
      !editing && tableName === 'work_orders' && statusLabel === 'To Be Scheduled',
  },

  // ── Service appointments ────────────────────────────────────────────────
  reschedule_appointment: {
    key:                 ACTION_KEYS.RESCHEDULE_APPOINTMENT,
    label:               'Reschedule',
    icon:                'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6 M16 2v4 M8 2v4 M3 10h18 M16 14v2.5l1.5 1.5 M16 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    color:               ACTION_COLORS.BLUE,
    applicableObjects:   ['service_appointments'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'service_appointments',
  },

  // ── Send for Signature — gated by hasActiveTemplate, applies broadly ──
  send_for_signature: {
    key:                 ACTION_KEYS.SEND_FOR_SIGNATURE,
    label:               'Send for Signature',
    icon:                'M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z M16 8L2 22 M17.5 15H9',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'primary',
    defaultSortOrder:    50,
    isAvailable: ({ editing, hasActiveTemplate }) => !editing && hasActiveTemplate === true,
  },

  // ── Envelopes ───────────────────────────────────────────────────────────
  resend_signing_email: {
    key:                 ACTION_KEYS.RESEND_SIGNING_EMAIL,
    label:               'Resend Email',
    icon:                'M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.4 1.05L3.5 11l13.5 1L3.5 13l-1.5 6.35a1 1 0 0 0 1.4 1.05z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['envelopes'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing, envelopeIsResendable }) =>
      !editing && tableName === 'envelopes' && envelopeIsResendable === true,
  },
  void_envelope: {
    key:                 ACTION_KEYS.VOID_ENVELOPE,
    label:               'Void',
    icon:                'M18.36 5.64a9 9 0 1 1-12.72 0M5.64 5.64l12.72 12.72',
    color:               ACTION_COLORS.AMBER,
    applicableObjects:   ['envelopes'],
    defaultTier:         'menu',
    defaultSortOrder:    30,
    isAvailable: ({ tableName, editing, envelopeIsVoidable }) =>
      !editing && tableName === 'envelopes' && envelopeIsVoidable === true,
  },

  // ── Template previews (PRT / document / email) ──────────────────────────
  preview_pdf: {
    key:                 ACTION_KEYS.PREVIEW_PDF,
    label:               'Preview PDF',
    icon:                'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['project_report_templates'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing }) => !editing && tableName === 'project_report_templates',
  },
  preview_document: {
    key:                 ACTION_KEYS.PREVIEW_DOCUMENT,
    label:               'Preview PDF',
    icon:                'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['document_templates'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing, hasRelatedObject }) =>
      !editing && tableName === 'document_templates' && hasRelatedObject === true,
  },
  preview_email: {
    key:                 ACTION_KEYS.PREVIEW_EMAIL,
    label:               'Preview Email',
    icon:                'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
    color:               ACTION_COLORS.SKY,
    applicableObjects:   ['email_templates'],
    defaultTier:         'primary',
    defaultSortOrder:    20,
    isAvailable: ({ tableName, editing, hasRelatedObject }) =>
      !editing && tableName === 'email_templates' && hasRelatedObject === true,
  },

  // ── Lifecycle (publishable templates) ───────────────────────────────────
  clone_template: {
    key:                 ACTION_KEYS.CLONE_TEMPLATE,
    label:               'Clone Template',
    icon:                'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    60,
    isAvailable: ({ editing, lifecycle }) => !editing && !!lifecycle,
  },
  publish: {
    key:                 ACTION_KEYS.PUBLISH,
    label:               'Publish',
    icon:                'M5 13l4 4L19 7',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'primary',
    defaultSortOrder:    70,
    isAvailable: ({ editing, lifecycle, lifecycleStatusValue }) =>
      !editing && !!lifecycle && lifecycleStatusValue === 'Draft',
  },
  unpublish: {
    key:                 ACTION_KEYS.UNPUBLISH,
    label:               'Unpublish',
    icon:                'M3 10h11a4 4 0 014 4v0a4 4 0 01-4 4h-3M3 10l5 5m-5-5l5-5',
    color:               ACTION_COLORS.AMBER,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    80,
    isAvailable: ({ editing, lifecycle, lifecycleStatusValue }) =>
      !editing && !!lifecycle && lifecycleStatusValue === 'Active',
  },
  archive: {
    key:                 ACTION_KEYS.ARCHIVE,
    label:               'Archive',
    icon:                'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
    color:               ACTION_COLORS.NEUTRAL,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    85,
    isAvailable: ({ editing, lifecycle, lifecycleStatusValue }) =>
      !editing && !!lifecycle && lifecycleStatusValue === 'Active',
  },
  restore: {
    key:                 ACTION_KEYS.RESTORE,
    label:               'Restore to Draft',
    icon:                'M3 10h11a4 4 0 014 4v0a4 4 0 01-4 4h-3M3 10l5 5m-5-5l5-5',
    color:               ACTION_COLORS.EMERALD,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'primary',
    defaultSortOrder:    90,
    isAvailable: ({ editing, lifecycle, lifecycleStatusValue }) =>
      !editing && !!lifecycle && lifecycleStatusValue === 'Archived',
  },

  // ── Universal — defaulted to menu so they don't crowd the primary row ──
  clone: {
    key:                 ACTION_KEYS.CLONE,
    label:               'Clone',
    icon:                'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3',
    color:               ACTION_COLORS.NEUTRAL,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    900,
    isAvailable: ({ editing }) => !editing,
  },
  delete: {
    key:                 ACTION_KEYS.DELETE,
    label:               'Delete',
    icon:                'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z',
    color:               ACTION_COLORS.RED,
    applicableObjects:   ALL_OBJECTS,
    defaultTier:         'menu',
    defaultSortOrder:    1000,
    isAvailable: ({ editing }) => !editing,
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return every action definition that is applicable to the given object
 * (by table name). Does NOT filter by runtime availability — that's done
 * later inside resolveTopbarActions().
 */
export function actionsForObject(objectName) {
  return Object.values(ACTION_REGISTRY).filter(a =>
    a.applicableObjects === ALL_OBJECTS ||
    (Array.isArray(a.applicableObjects) && a.applicableObjects.includes(objectName))
  )
}

/**
 * Resolve the final, ordered topbar action lists (primary + menu) given:
 *   - objectName            — table name of the record being viewed
 *   - ctx                   — see ACTION_REGISTRY.* isAvailable shape
 *   - overrides             — page_layout_actions rows for the active layout
 *
 * Algorithm:
 *   1. Take registry entries applicable to the object.
 *   2. Drop entries where isAvailable(ctx) returns falsy.
 *   3. For each remaining entry, look up an override row by action_key.
 *      If found, apply the override's pla_display_tier / pla_sort_order /
 *      pla_label_override. Otherwise use the registry defaults.
 *   4. Group by tier. Sort each group by effective sortOrder, then label.
 *
 * Returns { primary: [...], menu: [...] } where each element is:
 *   { key, label, icon, color, sortOrder }
 *
 * Overrides whose action_key isn't in the registry are silently ignored
 * (forward-compat: a config row authored for an action that was later
 * removed from the registry shouldn't blow up the topbar).
 */
export function resolveTopbarActions({ objectName, ctx, overrides = [] }) {
  const overridesByKey = new Map()
  for (const o of overrides || []) {
    if (o?.pla_action_key && !o.pla_is_deleted) {
      overridesByKey.set(o.pla_action_key, o)
    }
  }

  const applicable = actionsForObject(objectName)
    .filter(def => {
      try { return def.isAvailable(ctx) }
      catch { return false }
    })

  const resolved = applicable.map(def => {
    const ov = overridesByKey.get(def.key)
    return {
      key:       def.key,
      label:     ov?.pla_label_override || def.label,
      icon:      def.icon,
      color:     def.color,
      tier:      ov?.pla_display_tier || def.defaultTier,
      sortOrder: typeof ov?.pla_sort_order === 'number'
                    ? ov.pla_sort_order
                    : def.defaultSortOrder,
    }
  })

  const sortFn = (a, b) =>
    (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label)

  return {
    primary: resolved.filter(a => a.tier === 'primary').sort(sortFn),
    menu:    resolved.filter(a => a.tier === 'menu').sort(sortFn),
  }
}

/**
 * Build the LayoutEditor's Actions section data: every registry entry
 * applicable to the layout's object, paired with its current override
 * (if any). UI uses this to render the per-layout configuration table.
 *
 * Returned shape:
 *   [{
 *     definition: <registry entry>,
 *     override:   <pla row | null>,
 *     effectiveTier:      'primary' | 'menu',
 *     effectiveSortOrder: integer,
 *     effectiveLabel:     string,
 *   }]
 *
 * Ordered by (effectiveSortOrder, label). Suitable to display as-is.
 */
export function buildLayoutActionConfig({ objectName, overrides = [] }) {
  const overridesByKey = new Map()
  for (const o of overrides || []) {
    if (o?.pla_action_key && !o.pla_is_deleted) {
      overridesByKey.set(o.pla_action_key, o)
    }
  }

  const rows = actionsForObject(objectName).map(def => {
    const ov = overridesByKey.get(def.key) || null
    return {
      definition: def,
      override:   ov,
      effectiveTier:      ov?.pla_display_tier || def.defaultTier,
      effectiveSortOrder: typeof ov?.pla_sort_order === 'number'
                              ? ov.pla_sort_order
                              : def.defaultSortOrder,
      effectiveLabel:     ov?.pla_label_override || def.label,
    }
  })

  rows.sort((a, b) =>
    (a.effectiveSortOrder - b.effectiveSortOrder) ||
    a.effectiveLabel.localeCompare(b.effectiveLabel)
  )

  return rows
}

/**
 * Resolve a color name from ACTION_COLORS into concrete style values.
 * Pure function so it can be used in both desktop and mobile renderers
 * without re-implementing the palette.
 *
 * The returned shape:
 *   { fg, bg, border, hoverBg, hoverBorder }
 * Suitable to spread into inline styles. Caller chooses which fields to
 * actually apply — a button might use {color: fg, border, background:bg}
 * while an overflow-menu item only uses {color: fg}.
 */
export function actionColors(C, color) {
  switch (color) {
    case ACTION_COLORS.EMERALD:
      return {
        fg: C.emerald, bg: C.page,
        border: '#a7f3d0', hoverBg: '#ecfdf5', hoverBorder: '#a7f3d0',
      }
    case ACTION_COLORS.BLUE:
      return {
        fg: '#2563eb', bg: C.page,
        border: '#bfdbfe', hoverBg: '#eff6ff', hoverBorder: '#bfdbfe',
      }
    case ACTION_COLORS.SKY:
      return {
        fg: '#0369a1', bg: C.page,
        border: '#bae6fd', hoverBg: '#f0f9ff', hoverBorder: '#bae6fd',
      }
    case ACTION_COLORS.AMBER:
      return {
        fg: '#b45309', bg: C.page,
        border: '#fcd34d', hoverBg: '#fffbeb', hoverBorder: '#fcd34d',
      }
    case ACTION_COLORS.RED:
      return {
        fg: '#b03a2e', bg: C.page,
        border: C.border, hoverBg: '#fef2f2', hoverBorder: '#fca5a5',
      }
    case ACTION_COLORS.NEUTRAL:
    default:
      return {
        fg: C.textSecondary, bg: C.page,
        border: C.border, hoverBg: '#eef2f7', hoverBorder: C.border,
      }
  }
}
