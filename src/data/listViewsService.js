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
//   • Default  — list_view_is_default = true; at most one default per
//                (object) for a given user is enforced client-side on save.
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

  const { data, error } = await supabase
    .from('saved_list_views')
    .select(`
      id, list_view_name, list_view_object, list_view_module,
      list_view_user_id, list_view_role_id, list_view_is_shared,
      list_view_is_default, list_view_sort_field, list_view_sort_direction,
      list_view_visible_columns, list_view_filters, list_view_owner
    `)
    .eq('list_view_object', objectName)
    .eq('is_deleted', false)
    .order('list_view_name', { ascending: true })

  if (error) throw error

  const rows = (data || []).filter(r =>
    r.list_view_is_shared === true ||
    (userId && r.list_view_user_id === userId) ||
    (roleId && r.list_view_role_id === roleId)
  )

  return rows.map(toSelectorView)
}

// Map a DB row to the shape the ListView selector expects.
function toSelectorView(r) {
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
    sortField: r.list_view_sort_field || null,
    sortDir: r.list_view_sort_direction || 'asc',
    visibleColumns: Array.isArray(r.list_view_visible_columns) ? r.list_view_visible_columns : null,
    isDefault: r.list_view_is_default === true,
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
    list_view_is_default: !!opts.isDefault,
    list_view_sort_field: opts.sortField || null,
    list_view_sort_direction: opts.sortDir || 'asc',
    list_view_visible_columns: opts.visibleColumns || null,
    list_view_filters: filtersPayload,
    list_view_owner: userId,
    list_view_created_by: userId,
  }

  if (opts.isDefault) await clearDefaultFor(opts.object, userId)

  const { data, error } = await supabase
    .from('saved_list_views').insert(row).select('id').single()
  if (error) throw error
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
  if (opts.isDefault !== undefined) {
    patch.list_view_is_default = !!opts.isDefault
    if (opts.isDefault && opts.object) await clearDefaultFor(opts.object, userId)
  }

  const { error } = await supabase.from('saved_list_views').update(patch).eq('id', id)
  if (error) throw error
}

// Soft-delete a saved view. A deletion_reason is required by the data
// standards; we supply a default for user-initiated deletes.
export async function deleteSavedView(id) {
  const { error } = await supabase
    .from('saved_list_views')
    .update({ is_deleted: true, deletion_reason: 'Deleted by user from list view selector' })
    .eq('id', id)
  if (error) throw error
}

// Clear any existing default for this object owned by this user, so a newly
// set default is the only one. Best-effort; failure here is non-fatal to the
// save itself (the new row still gets is_default=true).
async function clearDefaultFor(objectName, userId) {
  try {
    await supabase
      .from('saved_list_views')
      .update({ list_view_is_default: false })
      .eq('list_view_object', objectName)
      .eq('list_view_owner', userId)
      .eq('list_view_is_default', true)
      .eq('is_deleted', false)
  } catch { /* non-fatal */ }
}
