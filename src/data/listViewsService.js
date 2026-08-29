// ===========================================================================
// listViewsService.js
//
// Persistence for user- and role-scoped list views against the existing
// `saved_list_views` table. The ListView component's selector reads through
// these functions so "Save View", rename, edit, delete, share, and set-default
// survive reloads — previously Save View only wrote to local React state and
// vanished on refresh.
//
// Scope model (mirrors the table's columns):
//   • Personal — list_view_user_id = me, is_shared = false, role_id = null
//   • Role     — list_view_role_id = <role>, is_shared = false
//   • Shared   — is_shared = true (visible to everyone)
//   • Default  — one row per (user, object) in list_view_user_defaults
//                pointing at the user's chosen saved view. The default is a
//                property of the USER, never of the view row itself — the old
//                saved_list_views.list_view_is_default flag is deprecated
//                (it lived on shared rows, so one user's default changed
//                everyone's, and stale flags on rows owned by other user
//                records could never be cleared — the "two stars" bug).
//
// System views are defined per-module as in-code constants. To let users
// edit them, an edited system view is persisted as a saved row carrying the
// original system id in list_view_filters meta (key __system_base) so the
// selector can overlay the saved version on top of the constant.
//
// Auto-number: list_view_record_number is filled by a BEFORE INSERT trigger —
// pass '' (empty string), never null, per the established pattern.
// ===========================================================================

import { supabase } from '../lib/supabase'
import { getCurrentUserId } from './layoutService'

// Resolve the current user's role_id (nullable). Cached for the session.
let _cachedRoleId = null
export async function getCurrentRoleId() {
  if (_cachedRoleId !== null) return _cachedRoleId
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) { _cachedRoleId = null; return null }
  const { data } = await supabase
    .from('users').select('role_id').eq('auth_user_id', user.id).maybeSingle()
  _cachedRoleId = data?.role_id || null
  return _cachedRoleId
}
export function clearListViewCache() { _cachedRoleId = null }

// ---------------------------------------------------------------------------
// Load all saved views visible to the current user for one object.
// RLS already allows SELECT broadly; we additionally filter to views that are
// shared, owned by me, or scoped to my role, so the selector only shows what's
// relevant. Returns rows shaped for the ListView selector.
// ---------------------------------------------------------------------------
export async function fetchSavedViewsForObject(objectName) {
  if (!objectName) return []
  const [userId, roleId] = await Promise.all([
    getCurrentUserId().catch(() => null),
    getCurrentRoleId().catch(() => null),
  ])

  const [{ data, error }, defaultViewId] = await Promise.all([
    supabase
      .from('saved_list_views')
      .select(`
        id, list_view_name, list_view_object, list_view_module,
        list_view_user_id, list_view_role_id, list_view_is_shared,
        list_view_sort_field, list_view_sort_direction,
        list_view_visible_columns, list_view_filters, list_view_filter_logic,
        list_view_column_widths, list_view_owner
      `)
      .eq('list_view_object', objectName)
      .eq('is_deleted', false)
      .order('list_view_name', { ascending: true }),
    fetchDefaultViewId(objectName, userId),
  ])

  if (error) throw error

  const rows = (data || []).filter(r =>
    r.list_view_is_shared === true ||
    (userId && r.list_view_user_id === userId) ||
    (roleId && r.list_view_role_id === roleId)
  )

  return rows.map(r => toSelectorView(r, defaultViewId))
}

// The current user's default view id for this object, from the per-user
// pointer table. RLS already limits rows to the current user; the explicit
// user filter keeps the query self-documenting. Null when no default is set.
async function fetchDefaultViewId(objectName, userId) {
  if (!userId) return null
  try {
    const { data } = await supabase
      .from('list_view_user_defaults')
      .select('saved_list_view_id')
      .eq('list_view_default_user_id', userId)
      .eq('list_view_default_object', objectName)
      .maybeSingle()
    return data?.saved_list_view_id || null
  } catch {
    return null
  }
}

// 'all' and an empty expression both mean "match every filter", which is the
// column's NULL. Storing the word would be storing the default twice.
function normalizeFilterLogic(logic) {
  const e = String(logic ?? '').trim()
  if (!e || e.toLowerCase() === 'all') return null
  return e
}

// Only real, positive pixel widths are stored, so a stray value can never make
// a column unreadable when the view is reopened. An empty map stores as NULL —
// "no widths saved" rather than "every width is nothing".
function normalizeColumnWidths(widths) {
  if (!widths || typeof widths !== 'object' || Array.isArray(widths)) return null
  const out = {}
  for (const [field, px] of Object.entries(widths)) {
    const n = Number(px)
    if (!field || !Number.isFinite(n) || n <= 0) continue
    out[field] = Math.round(n)
  }
  return Object.keys(out).length > 0 ? out : null
}

// Map a DB row to the shape the ListView selector expects. isDefault is
// per-user: true only when the row is THIS user's pinned default.
function toSelectorView(r, defaultViewId) {
  // list_view_filters stores both the filter array and optional meta. We keep
  // backward-compat: if it's a plain array, treat it as filters; if it's an
  // object { filters, __system_base }, unpack.
  let filters = []
  let systemBase = null
  const f = r.list_view_filters
  if (Array.isArray(f)) filters = f
  else if (f && typeof f === 'object') {
    filters = Array.isArray(f.filters) ? f.filters : []
    systemBase = f.__system_base || null
  }
  const scope =
    r.list_view_is_shared ? 'shared' :
    r.list_view_role_id   ? 'role'   : 'personal'
  return {
    id: r.id,
    _persisted: true,
    name: r.list_view_name,
    filters,
    // How those filters combine. NULL means match-all — the meaning of every
    // view saved before filter logic existed.
    filterLogic: r.list_view_filter_logic || 'all',
    sortField: r.list_view_sort_field || null,
    sortDir: r.list_view_sort_direction || 'asc',
    visibleColumns: Array.isArray(r.list_view_visible_columns) ? r.list_view_visible_columns : null,
    // The view's own column widths. Null means none were saved, and the list
    // falls back to whatever this browser remembers.
    columnWidths: (r.list_view_column_widths && typeof r.list_view_column_widths === 'object'
      && !Array.isArray(r.list_view_column_widths)) ? r.list_view_column_widths : null,
    isDefault: Boolean(defaultViewId) && r.id === defaultViewId,
    scope,
    roleId: r.list_view_role_id || null,
    systemBase,
  }
}

// ---------------------------------------------------------------------------
// Create a new saved view.
//   opts: { name, object, module, filters, sortField, sortDir,
//           visibleColumns, scope: 'personal'|'role'|'shared',
//           roleId?, isDefault?, systemBase? }
// ---------------------------------------------------------------------------
export async function createSavedView(opts) {
  const userId = await getCurrentUserId()
  const roleId = opts.scope === 'role' ? (opts.roleId || await getCurrentRoleId()) : null

  const filtersPayload = opts.systemBase
    ? { filters: opts.filters || [], __system_base: opts.systemBase }
    : (opts.filters || [])

  const row = {
    list_view_record_number: '',                 // BEFORE INSERT trigger fills
    list_view_name: opts.name.trim(),
    list_view_object: opts.object,
    list_view_module: opts.module || opts.object,
    list_view_user_id: opts.scope === 'personal' ? userId : null,
    list_view_role_id: roleId,
    list_view_is_shared: opts.scope === 'shared',
    list_view_sort_field: opts.sortField || null,
    list_view_sort_direction: opts.sortDir || 'asc',
    list_view_visible_columns: opts.visibleColumns || null,
    list_view_filters: filtersPayload,
    list_view_filter_logic: normalizeFilterLogic(opts.filterLogic),
    list_view_column_widths: normalizeColumnWidths(opts.columnWidths),
    list_view_owner: userId,
    list_view_created_by: userId,
  }

  const { data, error } = await supabase
    .from('saved_list_views').insert(row).select('id').single()
  if (error) throw error
  if (opts.isDefault) await setDefaultViewForObject(opts.object, data.id)
  return data.id
}

// ---------------------------------------------------------------------------
// Update an existing saved view (rename, re-save filters/sort/columns,
// change scope, toggle default).
// ---------------------------------------------------------------------------
export async function updateSavedView(id, opts) {
  const userId = await getCurrentUserId()
  const patch = {}
  if (opts.name        !== undefined) patch.list_view_name = opts.name.trim()
  if (opts.sortField   !== undefined) patch.list_view_sort_field = opts.sortField || null
  if (opts.sortDir     !== undefined) patch.list_view_sort_direction = opts.sortDir || 'asc'
  if (opts.visibleColumns !== undefined) patch.list_view_visible_columns = opts.visibleColumns || null
  if (opts.filterLogic !== undefined) patch.list_view_filter_logic = normalizeFilterLogic(opts.filterLogic)
  if (opts.columnWidths !== undefined) patch.list_view_column_widths = normalizeColumnWidths(opts.columnWidths)
  if (opts.filters     !== undefined || opts.systemBase !== undefined) {
    patch.list_view_filters = opts.systemBase
      ? { filters: opts.filters || [], __system_base: opts.systemBase }
      : (opts.filters || [])
  }
  if (opts.scope !== undefined) {
    patch.list_view_is_shared = opts.scope === 'shared'
    patch.list_view_role_id   = opts.scope === 'role' ? (opts.roleId || await getCurrentRoleId()) : null
    patch.list_view_user_id   = opts.scope === 'personal' ? userId : null
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('saved_list_views').update(patch).eq('id', id)
    if (error) throw error
  }

  // Default is a per-user pointer, not a row column: setting it pins this view
  // for the current user only; unsetting removes the pin only if it points here.
  if (opts.isDefault === true && opts.object) {
    await setDefaultViewForObject(opts.object, id)
  } else if (opts.isDefault === false && opts.object) {
    await clearDefaultViewForObject(opts.object, id)
  }
}

// Soft-delete a saved view. A deletion_reason is required by the data
// standards; we supply a default for user-initiated deletes. The current
// user's default pin is dropped if it pointed at the deleted view (other
// users' pins simply resolve to nothing until they pick a new default).
export async function deleteSavedView(id) {
  const { error } = await supabase
    .from('saved_list_views')
    .update({ is_deleted: true, deletion_reason: 'Deleted by user from list view selector' })
    .eq('id', id)
  if (error) throw error
  try {
    const userId = await getCurrentUserId()
    await supabase
      .from('list_view_user_defaults')
      .delete()
      .eq('list_view_default_user_id', userId)
      .eq('saved_list_view_id', id)
  } catch { /* non-fatal: a dangling pin is ignored on load */ }
}

// Pin a saved view as the current user's default for an object. The unique
// constraint on (user, object) makes this a true replace: whatever was the
// default before — including a view owned by someone else — stops being it.
export async function setDefaultViewForObject(objectName, savedViewId) {
  const userId = await getCurrentUserId()
  const { error } = await supabase
    .from('list_view_user_defaults')
    .upsert({
      list_view_default_user_id: userId,
      list_view_default_object: objectName,
      saved_list_view_id: savedViewId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'list_view_default_user_id,list_view_default_object' })
  if (error) throw error
}

// Remove the current user's default for an object. When savedViewId is given,
// only clears if the pin currently points at that view (used when un-toggling
// "Make this my default view" on a specific view).
export async function clearDefaultViewForObject(objectName, savedViewId = null) {
  const userId = await getCurrentUserId()
  let q = supabase
    .from('list_view_user_defaults')
    .delete()
    .eq('list_view_default_user_id', userId)
    .eq('list_view_default_object', objectName)
  if (savedViewId) q = q.eq('saved_list_view_id', savedViewId)
  const { error } = await q
  if (error) throw error
}
