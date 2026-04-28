// ---------------------------------------------------------------------------
// Page Layout Builder — service layer
//
// Owns all writes to page_layouts, page_layout_sections, page_layout_widgets,
// plus the picklist_values rows that represent record types. The builder UI
// (ObjectDetail.jsx) calls exclusively through these functions — no raw
// supabase calls from components.
//
// Design notes:
//   * page_layouts and page_layout_widgets have BEFORE INSERT auto-numbering
//     triggers that require an empty-string placeholder for the record_number
//     column. page_layout_sections has no such column.
//   * page_layouts, page_layout_widgets, and page_layout_sections all support
//     soft-delete via is_deleted / deletion_reason. The builder never hard-
//     deletes anything — consistent with the enterprise philosophy.
//   * The clone_page_layout Postgres function handles atomic layout+sections+
//     widgets copy in a single round trip. Thin JS wrapper below.
//   * Uniqueness of the default layout per (object, type, role, record_type)
//     is enforced by the partial unique index page_layouts_one_default_per_scope.
//     Callers that flip is_default on must ensure no other default exists —
//     the updatePageLayoutMeta function demotes any conflicting default first.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase'
import { getCurrentUserId } from './layoutService'
import { reorderJunctionRows } from './layoutService'

// ─── Layout CRUD ───────────────────────────────────────────────────────

/**
 * Create a brand-new, empty page layout. No sections or widgets are created —
 * the caller is responsible for adding those afterward (or use cloneFromLayout
 * instead if you want a populated starting point).
 *
 * @param {object} p
 * @param {string} p.object          — table name (e.g. 'properties')
 * @param {string} [p.type]          — layout type, defaults to 'record_detail'
 * @param {string} p.name            — display name
 * @param {string} [p.description]
 * @param {string|null} [p.roleId]   — role scope, null = applies to all roles
 * @param {string|null} [p.recordTypeId] — picklist_values.id for the record type
 *                                        this layout applies to. null = master.
 * @param {boolean} [p.isDefault=false]
 * @returns {Promise<string>} new layout id
 */
export async function createPageLayout({
  object,
  type = 'record_detail',
  name,
  description,
  roleId = null,
  recordTypeId = null,
  isDefault = false,
}) {
  if (!object) throw new Error('createPageLayout: object is required')
  if (!name)   throw new Error('createPageLayout: name is required')

  const userId = await getCurrentUserId()
  if (!userId) throw new Error('createPageLayout: no authenticated user')

  // If marking default, demote any existing default in the same scope first.
  if (isDefault) {
    await _demoteCurrentDefault({ object, type, roleId, recordTypeId })
  }

  const { data, error } = await supabase
    .from('page_layouts')
    .insert({
      page_layout_record_number: '', // trigger fills this
      page_layout_name: name,
      page_layout_object: object,
      page_layout_type: type,
      role_id: roleId,
      record_type_id: recordTypeId,
      page_layout_is_default: isDefault,
      page_layout_description: description || null,
      page_layout_owner: userId,
      page_layout_created_by: userId,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

/**
 * Clone an existing layout — copies the header row + every live section +
 * every live widget in one atomic RPC call. Widgets are re-anchored to the
 * newly created sections.
 *
 * @param {object} p
 * @param {string} p.sourceLayoutId
 * @param {string} p.name            — name for the clone (required)
 * @param {string} [p.description]   — defaults to source layout's description
 * @param {string|null} [p.roleId]
 * @param {string|null} [p.recordTypeId]
 * @param {boolean} [p.isDefault=false]
 * @returns {Promise<string>} new layout id
 */
export async function cloneFromLayout({
  sourceLayoutId,
  name,
  description = null,
  roleId = null,
  recordTypeId = null,
  isDefault = false,
}) {
  if (!sourceLayoutId) throw new Error('cloneFromLayout: sourceLayoutId is required')
  if (!name)           throw new Error('cloneFromLayout: name is required')

  const userId = await getCurrentUserId()
  if (!userId) throw new Error('cloneFromLayout: no authenticated user')

  // Resolve the source's scope to know whether we need to demote a conflict.
  if (isDefault) {
    const src = await _getLayoutScope(sourceLayoutId)
    await _demoteCurrentDefault({
      object: src.page_layout_object,
      type:   src.page_layout_type,
      roleId,
      recordTypeId,
    })
  }

  const { data, error } = await supabase.rpc('clone_page_layout', {
    p_source_layout_id:   sourceLayoutId,
    p_new_name:           name,
    p_new_description:    description,
    p_new_role_id:        roleId,
    p_new_record_type_id: recordTypeId,
    p_new_is_default:     isDefault,
    p_owner:              userId,
    p_created_by:         userId,
  })
  if (error) throw error
  return data // RPC returns the new uuid as a scalar
}

/**
 * Patch the metadata on an existing page layout. Any field left undefined
 * is preserved. If isDefault is being flipped to true, demotes any
 * conflicting default first.
 */
export async function updatePageLayoutMeta(layoutId, patch) {
  if (!layoutId) throw new Error('updatePageLayoutMeta: layoutId is required')

  // If caller is toggling is_default=true, resolve the target scope (which
  // may be changing in the same patch) and demote any existing default.
  if (patch.isDefault === true) {
    const current = await _getLayoutScope(layoutId)
    const targetScope = {
      object: current.page_layout_object,
      type:   current.page_layout_type,
      roleId:       patch.roleId       !== undefined ? patch.roleId       : current.role_id,
      recordTypeId: patch.recordTypeId !== undefined ? patch.recordTypeId : current.record_type_id,
    }
    await _demoteCurrentDefault(targetScope, { exceptLayoutId: layoutId })
  }

  const update = {}
  if (patch.name         !== undefined) update.page_layout_name        = patch.name
  if (patch.description  !== undefined) update.page_layout_description = patch.description
  if (patch.roleId       !== undefined) update.role_id                 = patch.roleId
  if (patch.recordTypeId !== undefined) update.record_type_id          = patch.recordTypeId
  if (patch.isDefault    !== undefined) update.page_layout_is_default  = patch.isDefault
  update.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('page_layouts')
    .update(update)
    .eq('id', layoutId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function softDeletePageLayout(layoutId, reason) {
  if (!layoutId) throw new Error('softDeletePageLayout: layoutId is required')
  if (!reason)   throw new Error('softDeletePageLayout: reason is required')

  const { error } = await supabase
    .from('page_layouts')
    .update({
      is_deleted: true,
      deletion_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', layoutId)
  if (error) throw error
}

// ─── Section CRUD ──────────────────────────────────────────────────────

/**
 * Append a new section to the end of a layout. section_order is computed
 * as max(existing) + 1.
 */
export async function createSection(layoutId, {
  label,
  columns = 3,
  isCollapsible = false,
  isCollapsedByDefault = false,
  tab = 'Details',
} = {}) {
  if (!layoutId) throw new Error('createSection: layoutId is required')

  const order = await _nextSectionOrder(layoutId)

  const { data, error } = await supabase
    .from('page_layout_sections')
    .insert({
      page_layout_id: layoutId,
      section_order: order,
      section_label: label || 'Untitled Section',
      section_columns: columns,
      section_is_collapsible: isCollapsible,
      section_is_collapsed_by_default: isCollapsedByDefault,
      section_tab: tab,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSection(sectionId, patch) {
  if (!sectionId) throw new Error('updateSection: sectionId is required')

  const update = {}
  if (patch.label                !== undefined) update.section_label                   = patch.label
  if (patch.columns              !== undefined) update.section_columns                 = patch.columns
  if (patch.isCollapsible        !== undefined) update.section_is_collapsible          = patch.isCollapsible
  if (patch.isCollapsedByDefault !== undefined) update.section_is_collapsed_by_default = patch.isCollapsedByDefault
  if (patch.tab                  !== undefined) update.section_tab                     = patch.tab
  update.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('page_layout_sections')
    .update(update)
    .eq('id', sectionId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function softDeleteSection(sectionId, reason) {
  if (!sectionId) throw new Error('softDeleteSection: sectionId is required')
  if (!reason)    throw new Error('softDeleteSection: reason is required')

  const { error } = await supabase
    .from('page_layout_sections')
    .update({
      is_deleted: true,
      deletion_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sectionId)
  if (error) throw error
}

/**
 * Reorder sections for a layout. `orderedIds` is the new full ordering —
 * pass every live section id for this layout in desired display order.
 * Uses the existing reorder_junction_rows RPC (table-agnostic despite its
 * name).
 */
export async function reorderSections(layoutId, orderedIds) {
  if (!layoutId) throw new Error('reorderSections: layoutId is required')
  return reorderJunctionRows(
    { table: 'page_layout_sections', order_field: 'section_order' },
    orderedIds,
  )
}

// ─── Widget CRUD ───────────────────────────────────────────────────────

/**
 * Append a new widget to the end of a section.
 */
export async function createWidget(sectionId, {
  type = 'field_group',
  title,
  config = {},
  column = 1,
  size = 'medium',
  isRequired = false,
} = {}) {
  if (!sectionId) throw new Error('createWidget: sectionId is required')
  if (!title)     throw new Error('createWidget: title is required')

  // Widget needs both section_id and page_layout_id (denormalized). Resolve
  // the layout id from the section.
  const { data: sec, error: secErr } = await supabase
    .from('page_layout_sections')
    .select('page_layout_id')
    .eq('id', sectionId)
    .single()
  if (secErr) throw secErr

  const position = await _nextWidgetPosition(sectionId)

  const { data, error } = await supabase
    .from('page_layout_widgets')
    .insert({
      page_layout_widget_record_number: '', // trigger fills this
      page_layout_id: sec.page_layout_id,
      section_id: sectionId,
      widget_type: type,
      widget_title: title,
      widget_column: column,
      widget_position: position,
      widget_size: size,
      widget_config: config,
      widget_is_required: isRequired,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateWidget(widgetId, patch) {
  if (!widgetId) throw new Error('updateWidget: widgetId is required')

  const update = {}
  if (patch.type       !== undefined) update.widget_type        = patch.type
  if (patch.title      !== undefined) update.widget_title       = patch.title
  if (patch.column     !== undefined) update.widget_column      = patch.column
  if (patch.size       !== undefined) update.widget_size        = patch.size
  if (patch.config     !== undefined) update.widget_config      = patch.config
  if (patch.isRequired !== undefined) update.widget_is_required = patch.isRequired
  update.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('page_layout_widgets')
    .update(update)
    .eq('id', widgetId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function softDeleteWidget(widgetId, reason) {
  if (!widgetId) throw new Error('softDeleteWidget: widgetId is required')
  if (!reason)   throw new Error('softDeleteWidget: reason is required')

  // widget_config rows don't support deletion_reason — store it on the
  // audit-log side via updated_at timestamp. page_layout_widgets has no
  // deletion_reason column; we only flip is_deleted.
  const { error } = await supabase
    .from('page_layout_widgets')
    .update({
      is_deleted: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', widgetId)
  if (error) throw error
}

export async function reorderWidgets(sectionId, orderedIds) {
  if (!sectionId) throw new Error('reorderWidgets: sectionId is required')
  return reorderJunctionRows(
    { table: 'page_layout_widgets', order_field: 'widget_position' },
    orderedIds,
  )
}

// ─── Record Type CRUD (picklist_values, field='record_type') ───────────

/**
 * List record types for an object, joined with any page layouts that have
 * this record_type_id assigned. UI shows one row per record type with its
 * "Assigned Layout" column.
 */
export async function listRecordTypesForObject(objectName) {
  if (!objectName) throw new Error('listRecordTypesForObject: objectName is required')

  // Two queries. The two-step keeps the PostgREST query simple and avoids
  // a relational embed across unrelated tables.
  const { data: types, error: tErr } = await supabase
    .from('picklist_values')
    .select('id, picklist_value, picklist_label, picklist_sort_order, picklist_is_active')
    .eq('picklist_object', objectName)
    .eq('picklist_field', 'record_type')
    .order('picklist_sort_order', { ascending: true })
  if (tErr) throw tErr

  if (!types || types.length === 0) return []

  const typeIds = types.map(t => t.id)
  const { data: layouts, error: lErr } = await supabase
    .from('page_layouts')
    .select('id, page_layout_name, page_layout_is_default, record_type_id')
    .eq('page_layout_object', objectName)
    .eq('is_deleted', false)
    .in('record_type_id', typeIds)
  if (lErr) throw lErr

  const layoutByType = new Map()
  for (const l of layouts || []) {
    // If multiple layouts map to the same record type, prefer the default one.
    const existing = layoutByType.get(l.record_type_id)
    if (!existing || l.page_layout_is_default) {
      layoutByType.set(l.record_type_id, l)
    }
  }

  return types.map(t => {
    const assigned = layoutByType.get(t.id)
    return {
      id: t.id,
      value: t.picklist_value,
      label: t.picklist_label || t.picklist_value,
      sortOrder: t.picklist_sort_order ?? 0,
      isActive: t.picklist_is_active !== false,
      assignedLayoutId:   assigned?.id || null,
      assignedLayoutName: assigned?.page_layout_name || null,
    }
  })
}

export async function createRecordType({ object, value, label, sortOrder = 0 }) {
  if (!object) throw new Error('createRecordType: object is required')
  if (!value)  throw new Error('createRecordType: value is required')
  if (!label)  throw new Error('createRecordType: label is required')

  const userId = await getCurrentUserId()
  if (!userId) throw new Error('createRecordType: no authenticated user')

  const { data, error } = await supabase
    .from('picklist_values')
    .insert({
      picklist_object: object,
      picklist_field: 'record_type',
      picklist_value: value,
      picklist_label: label,
      picklist_sort_order: sortOrder,
      picklist_is_active: true,
      picklist_created_by: userId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updateRecordType(id, patch) {
  if (!id) throw new Error('updateRecordType: id is required')

  const update = {}
  if (patch.value     !== undefined) update.picklist_value      = patch.value
  if (patch.label     !== undefined) update.picklist_label      = patch.label
  if (patch.sortOrder !== undefined) update.picklist_sort_order = patch.sortOrder

  const { data, error } = await supabase
    .from('picklist_values')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deactivateRecordType(id) {
  if (!id) throw new Error('deactivateRecordType: id is required')
  const { error } = await supabase
    .from('picklist_values')
    .update({ picklist_is_active: false })
    .eq('id', id)
  if (error) throw error
}

export async function reactivateRecordType(id) {
  if (!id) throw new Error('reactivateRecordType: id is required')
  const { error } = await supabase
    .from('picklist_values')
    .update({ picklist_is_active: true })
    .eq('id', id)
  if (error) throw error
}

/**
 * Atomic (best-effort) "Create a record type and wire up its layout" flow —
 * the combined op behind the Record Types → New modal. Strategies:
 *
 *   'none'          — create only the picklist row. No layout action.
 *                     Records of this type will fall back to the master layout.
 *   'clone_master'  — create the picklist row, then clone the current master
 *                     default for this object and assign record_type_id to
 *                     the new row. The clone becomes is_default=true for its
 *                     (object, type, role, record_type) scope.
 *   'clone_from'    — same as clone_master but clone from a specific source
 *                     layout (sourceLayoutId required).
 *   'move_existing' — create the picklist row, then update an existing layout
 *                     to set its record_type_id to the new row
 *                     (existingLayoutId required). Destructive if the layout
 *                     was the master — caller should warn the user in the UI.
 *
 * Returns { recordTypeId, layoutId } — layoutId is null for 'none'.
 */
export async function createRecordTypeWithLayout({
  object,
  value,
  label,
  sortOrder = 0,
  layoutStrategy = 'clone_master',
  sourceLayoutId = null,
  existingLayoutId = null,
}) {
  if (!object) throw new Error('createRecordTypeWithLayout: object is required')

  // 1. Create the picklist row first — this is the anchor for every layout op.
  const recordTypeId = await createRecordType({ object, value, label, sortOrder })

  if (layoutStrategy === 'none') {
    return { recordTypeId, layoutId: null }
  }

  if (layoutStrategy === 'clone_master') {
    const masterId = await _findMasterLayoutId(object)
    if (!masterId) {
      // No master to clone from. Fall through to 'none'.
      return { recordTypeId, layoutId: null }
    }
    const layoutId = await cloneFromLayout({
      sourceLayoutId: masterId,
      name: `${label} — ${_objectPluralLabel(object) || object}`,
      recordTypeId,
      isDefault: true,
    })
    return { recordTypeId, layoutId }
  }

  if (layoutStrategy === 'clone_from') {
    if (!sourceLayoutId) throw new Error('createRecordTypeWithLayout: sourceLayoutId required for clone_from')
    const layoutId = await cloneFromLayout({
      sourceLayoutId,
      name: `${label} — ${_objectPluralLabel(object) || object}`,
      recordTypeId,
      isDefault: true,
    })
    return { recordTypeId, layoutId }
  }

  if (layoutStrategy === 'move_existing') {
    if (!existingLayoutId) throw new Error('createRecordTypeWithLayout: existingLayoutId required for move_existing')
    const updated = await updatePageLayoutMeta(existingLayoutId, {
      recordTypeId,
      isDefault: true,
    })
    return { recordTypeId, layoutId: updated.id }
  }

  throw new Error(`createRecordTypeWithLayout: unknown layoutStrategy '${layoutStrategy}'`)
}

// ─── Combined fetch for the builder editor ─────────────────────────────

/**
 * Fetch a layout with everything the builder UI needs to render and edit it:
 *   - the layout header (+ role name and record type value/label joined in)
 *   - sections in display order, with widgets nested inside
 *   - live-only (is_deleted=false) everywhere
 */
export async function fetchLayoutForEdit(layoutId) {
  if (!layoutId) throw new Error('fetchLayoutForEdit: layoutId is required')

  const { data: layout, error: lErr } = await supabase
    .from('page_layouts')
    .select(`
      id, page_layout_record_number, page_layout_name, page_layout_object,
      page_layout_type, page_layout_description, page_layout_is_default,
      role_id, record_type_id, created_at, updated_at,
      role:roles!page_layouts_role_id_fkey ( id, role_name ),
      record_type:picklist_values!page_layouts_record_type_id_fkey ( id, picklist_value, picklist_label )
    `)
    .eq('id', layoutId)
    .eq('is_deleted', false)
    .maybeSingle()
  if (lErr) throw lErr
  if (!layout) return null

  const { data: sections, error: sErr } = await supabase
    .from('page_layout_sections')
    .select('*')
    .eq('page_layout_id', layoutId)
    .eq('is_deleted', false)
    .order('section_order', { ascending: true })
  if (sErr) throw sErr

  const sectionIds = (sections || []).map(s => s.id)
  let widgets = []
  if (sectionIds.length > 0) {
    const { data, error } = await supabase
      .from('page_layout_widgets')
      .select('*')
      .in('section_id', sectionIds)
      .eq('is_deleted', false)
      .order('widget_position', { ascending: true })
    if (error) throw error
    widgets = data || []
  }

  const widgetsBySection = {}
  for (const w of widgets) {
    if (!widgetsBySection[w.section_id]) widgetsBySection[w.section_id] = []
    widgetsBySection[w.section_id].push(w)
  }

  return {
    layout: {
      id: layout.id,
      recordNumber: layout.page_layout_record_number,
      name: layout.page_layout_name,
      object: layout.page_layout_object,
      type: layout.page_layout_type,
      description: layout.page_layout_description || '',
      isDefault: layout.page_layout_is_default,
      roleId: layout.role_id,
      roleName: layout.role?.role_name || null,
      recordTypeId: layout.record_type_id,
      recordTypeValue: layout.record_type?.picklist_value || null,
      recordTypeLabel: layout.record_type?.picklist_label || null,
      createdAt: layout.created_at,
      updatedAt: layout.updated_at,
    },
    sections: (sections || []).map(s => ({
      id: s.id,
      label: s.section_label,
      order: s.section_order,
      columns: s.section_columns,
      isCollapsible: s.section_is_collapsible,
      isCollapsedByDefault: s.section_is_collapsed_by_default,
      tab: s.section_tab,
      widgets: widgetsBySection[s.id] || [],
    })),
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────

async function _nextSectionOrder(layoutId) {
  const { data, error } = await supabase
    .from('page_layout_sections')
    .select('section_order')
    .eq('page_layout_id', layoutId)
    .eq('is_deleted', false)
    .order('section_order', { ascending: false })
    .limit(1)
  if (error) throw error
  const max = data && data.length > 0 ? (data[0].section_order || 0) : 0
  return max + 1
}

async function _nextWidgetPosition(sectionId) {
  const { data, error } = await supabase
    .from('page_layout_widgets')
    .select('widget_position')
    .eq('section_id', sectionId)
    .eq('is_deleted', false)
    .order('widget_position', { ascending: false })
    .limit(1)
  if (error) throw error
  const max = data && data.length > 0 ? (data[0].widget_position || 0) : 0
  return max + 1
}

async function _getLayoutScope(layoutId) {
  const { data, error } = await supabase
    .from('page_layouts')
    .select('page_layout_object, page_layout_type, role_id, record_type_id')
    .eq('id', layoutId)
    .single()
  if (error) throw error
  return data
}

async function _findMasterLayoutId(objectName) {
  const { data, error } = await supabase
    .from('page_layouts')
    .select('id')
    .eq('page_layout_object', objectName)
    .eq('page_layout_type', 'record_detail')
    .eq('page_layout_is_default', true)
    .eq('is_deleted', false)
    .is('record_type_id', null)
    .is('role_id', null)
    .maybeSingle()
  if (error) throw error
  return data?.id || null
}

/**
 * Demote the default layout (if any) for a given scope so a new one can take
 * its place. Operates inside the scope's (object, type, role_id, record_type_id)
 * tuple — null values treated as distinct.
 */
async function _demoteCurrentDefault({ object, type, roleId = null, recordTypeId = null }, { exceptLayoutId = null } = {}) {
  let q = supabase
    .from('page_layouts')
    .update({ page_layout_is_default: false, updated_at: new Date().toISOString() })
    .eq('page_layout_object', object)
    .eq('page_layout_type', type)
    .eq('page_layout_is_default', true)
    .eq('is_deleted', false)

  q = roleId       ? q.eq('role_id', roleId)             : q.is('role_id', null)
  q = recordTypeId ? q.eq('record_type_id', recordTypeId) : q.is('record_type_id', null)

  if (exceptLayoutId) q = q.neq('id', exceptLayoutId)

  const { error } = await q
  if (error) throw error
}

/**
 * Turn a table name into a readable plural label for use in auto-generated
 * layout names. `properties` → `Properties`, `work_orders` → `Work Orders`.
 * Pure, no DB round trip.
 */
function _objectPluralLabel(objectName) {
  if (!objectName) return ''
  return objectName
    .split('_')
    .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ')
}
