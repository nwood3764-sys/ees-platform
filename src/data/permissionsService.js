import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// permissionsService — data access for the Permission Builder.
//
// Two parallel access models live alongside each other:
//
//   • Role baseline    — the user's single assigned role grants object access
//                        (role_object_access) and per-field visibility/edit
//                        permissions (field_permissions).
//
//   • Permission Sets  — additive overrides assigned to specific users.
//                        Object access is additive (role OR any pset → granted),
//                        field permissions are an override (most restrictive
//                        permission set wins when multiple disagree).
//
// All resolution is centralized in three SQL functions on the server:
//   app_user_can(object, action)
//   app_user_field_visible(object, field)
//   app_user_field_editable(object, field)
// The frontend never re-implements that logic — this file just edits the
// underlying tables. RLS / app code calls the resolvers.
// ---------------------------------------------------------------------------

// ─── Roles ─────────────────────────────────────────────────────────────────

export async function fetchRolesList() {
  const { data, error } = await supabase
    .from('roles')
    .select('id, role_name, role_description, role_is_active')
    .order('role_name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchRoleById(roleId) {
  const { data, error } = await supabase
    .from('roles')
    .select('id, role_name, role_description, role_is_active')
    .eq('id', roleId)
    .single()
  if (error) throw error
  return data
}

// ─── Permission Sets ───────────────────────────────────────────────────────

export async function fetchPermissionSetsList() {
  const { data, error } = await supabase
    .from('permission_sets')
    .select('id, ps_name, ps_description, ps_is_active, ps_created_at, ps_updated_at')
    .eq('ps_is_deleted', false)
    .order('ps_name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchPermissionSetById(psId) {
  const { data, error } = await supabase
    .from('permission_sets')
    .select('id, ps_name, ps_description, ps_is_active, ps_created_at, ps_updated_at')
    .eq('id', psId)
    .single()
  if (error) throw error
  return data
}

export async function createPermissionSet({ ps_name, ps_description }) {
  const { data, error } = await supabase
    .from('permission_sets')
    .insert({
      ps_name,
      ps_description: ps_description || null,
      ps_is_active: true,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePermissionSet(psId, patch) {
  const { data, error } = await supabase
    .from('permission_sets')
    .update({ ...patch, ps_updated_at: new Date().toISOString() })
    .eq('id', psId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function softDeletePermissionSet(psId, reason) {
  const { error } = await supabase
    .from('permission_sets')
    .update({
      ps_is_deleted: true,
      ps_deletion_reason: reason || 'Deleted via Permission Builder',
      ps_updated_at: new Date().toISOString(),
    })
    .eq('id', psId)
  if (error) throw error
}

// ─── Role: Object Access ───────────────────────────────────────────────────

export async function fetchRoleObjectAccess(roleId) {
  const { data, error } = await supabase
    .from('role_object_access')
    .select('id, roa_object_name, roa_read, roa_create, roa_update, roa_delete')
    .eq('roa_role_id', roleId)
  if (error) throw error
  // Map: object_name -> { rowId, read, create, update, delete }
  const map = {}
  for (const row of data || []) {
    map[row.roa_object_name] = {
      rowId: row.id,
      read:   !!row.roa_read,
      create: !!row.roa_create,
      update: !!row.roa_update,
      delete: !!row.roa_delete,
    }
  }
  return map
}

// Upsert a single (role, object) row. If all four flags are false, delete.
export async function upsertRoleObjectAccess(roleId, objectName, perms) {
  const allOff = !perms.read && !perms.create && !perms.update && !perms.delete
  if (allOff) {
    const { error } = await supabase
      .from('role_object_access')
      .delete()
      .eq('roa_role_id', roleId)
      .eq('roa_object_name', objectName)
    if (error) throw error
    return null
  }
  const { data, error } = await supabase
    .from('role_object_access')
    .upsert({
      roa_role_id: roleId,
      roa_object_name: objectName,
      roa_read:   !!perms.read,
      roa_create: !!perms.create,
      roa_update: !!perms.update,
      roa_delete: !!perms.delete,
      roa_updated_at: new Date().toISOString(),
    }, { onConflict: 'roa_role_id,roa_object_name' })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Permission Set: Object Access ─────────────────────────────────────────

export async function fetchPSObjectAccess(psId) {
  const { data, error } = await supabase
    .from('permission_set_object_access')
    .select('id, psoa_object_name, psoa_read, psoa_create, psoa_update, psoa_delete')
    .eq('psoa_permission_set_id', psId)
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    map[row.psoa_object_name] = {
      rowId: row.id,
      read:   !!row.psoa_read,
      create: !!row.psoa_create,
      update: !!row.psoa_update,
      delete: !!row.psoa_delete,
    }
  }
  return map
}

export async function upsertPSObjectAccess(psId, objectName, perms) {
  const allOff = !perms.read && !perms.create && !perms.update && !perms.delete
  if (allOff) {
    const { error } = await supabase
      .from('permission_set_object_access')
      .delete()
      .eq('psoa_permission_set_id', psId)
      .eq('psoa_object_name', objectName)
    if (error) throw error
    return null
  }
  const { data, error } = await supabase
    .from('permission_set_object_access')
    .upsert({
      psoa_permission_set_id: psId,
      psoa_object_name: objectName,
      psoa_read:   !!perms.read,
      psoa_create: !!perms.create,
      psoa_update: !!perms.update,
      psoa_delete: !!perms.delete,
      psoa_updated_at: new Date().toISOString(),
    }, { onConflict: 'psoa_permission_set_id,psoa_object_name' })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Role: Field Permissions (per object) ──────────────────────────────────

export async function fetchRoleFieldPermissions(roleId, objectName) {
  const { data, error } = await supabase
    .from('field_permissions')
    .select('id, fp_field, fp_visible, fp_editable, fp_financial_tier')
    .eq('fp_role_id', roleId)
    .eq('fp_object', objectName)
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    map[row.fp_field] = {
      rowId: row.id,
      visible:        row.fp_visible,
      editable:       row.fp_editable,
      financial_tier: row.fp_financial_tier ?? null,
    }
  }
  return map
}

// Defaults are visible + editable + no tier. Persist a row only when the user
// changes at least one value away from default OR sets a tier — otherwise the
// row is unnecessary noise.
export async function upsertRoleFieldPermission(roleId, objectName, fieldName, perms) {
  const { visible = true, editable = true, financial_tier = null } = perms
  const isDefault = visible === true && editable === true && financial_tier == null
  if (isDefault) {
    const { error } = await supabase
      .from('field_permissions')
      .delete()
      .eq('fp_role_id', roleId)
      .eq('fp_object', objectName)
      .eq('fp_field', fieldName)
    if (error) throw error
    return null
  }
  // field_permissions doesn't have a unique constraint that PostgREST upsert
  // can target, so do a manual select-then-insert/update.
  const { data: existing, error: lookupErr } = await supabase
    .from('field_permissions')
    .select('id')
    .eq('fp_role_id', roleId)
    .eq('fp_object', objectName)
    .eq('fp_field', fieldName)
    .maybeSingle()
  if (lookupErr) throw lookupErr
  const payload = {
    fp_role_id: roleId,
    fp_object: objectName,
    fp_field: fieldName,
    fp_visible: visible,
    fp_editable: editable,
    fp_financial_tier: financial_tier,
    fp_updated_at: new Date().toISOString(),
  }
  if (existing) {
    const { data, error } = await supabase
      .from('field_permissions')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase
    .from('field_permissions')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Permission Set: Field Permissions ─────────────────────────────────────

export async function fetchPSFieldPermissions(psId, objectName) {
  const { data, error } = await supabase
    .from('permission_set_field_permissions')
    .select('id, psfp_field, psfp_visible, psfp_editable, psfp_financial_tier')
    .eq('psfp_permission_set_id', psId)
    .eq('psfp_object', objectName)
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    map[row.psfp_field] = {
      rowId: row.id,
      visible:        row.psfp_visible,
      editable:       row.psfp_editable,
      financial_tier: row.psfp_financial_tier ?? null,
    }
  }
  return map
}

// For psets we always persist explicit overrides — if the row exists with
// default visible=true/editable=true, that's still a meaningful "do not
// restrict" override that wins over a more restrictive role baseline.
export async function upsertPSFieldPermission(psId, objectName, fieldName, perms) {
  const { visible = true, editable = true, financial_tier = null } = perms
  const { data, error } = await supabase
    .from('permission_set_field_permissions')
    .upsert({
      psfp_permission_set_id: psId,
      psfp_object: objectName,
      psfp_field: fieldName,
      psfp_visible: visible,
      psfp_editable: editable,
      psfp_financial_tier: financial_tier,
      psfp_updated_at: new Date().toISOString(),
    }, { onConflict: 'psfp_permission_set_id,psfp_object,psfp_field' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePSFieldPermission(psId, objectName, fieldName) {
  const { error } = await supabase
    .from('permission_set_field_permissions')
    .delete()
    .eq('psfp_permission_set_id', psId)
    .eq('psfp_object', objectName)
    .eq('psfp_field', fieldName)
  if (error) throw error
}

// ─── User <-> Permission Set assignments ───────────────────────────────────

export async function fetchUsersAssignedToPS(psId) {
  const { data, error } = await supabase
    .from('user_permission_sets')
    .select(`
      id,
      ups_user_id,
      ups_created_at,
      user:users!user_permission_sets_ups_user_id_fkey (
        id, user_first_name, user_last_name, user_email, user_is_active,
        role:roles!users_role_id_fkey ( role_name )
      )
    `)
    .eq('ups_permission_set_id', psId)
  if (error) throw error
  return (data || []).map(r => ({
    id: r.id,
    userId: r.ups_user_id,
    name: [r.user?.user_first_name, r.user?.user_last_name].filter(Boolean).join(' ') || '—',
    email: r.user?.user_email || '—',
    role: r.user?.role?.role_name || '—',
    isActive: !!r.user?.user_is_active,
    assignedAt: r.ups_created_at,
  }))
}

export async function fetchAssignableUsers() {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, user_first_name, user_last_name, user_email, user_is_active,
      role:roles!users_role_id_fkey ( role_name )
    `)
    .eq('user_is_deleted', false)
    .order('user_last_name', { ascending: true })
  if (error) throw error
  return (data || []).map(u => ({
    id: u.id,
    name: [u.user_first_name, u.user_last_name].filter(Boolean).join(' ') || '—',
    email: u.user_email || '—',
    role: u.role?.role_name || '—',
    isActive: !!u.user_is_active,
  }))
}

export async function assignUserToPS(userId, psId) {
  const { data, error } = await supabase
    .from('user_permission_sets')
    .insert({ ups_user_id: userId, ups_permission_set_id: psId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function unassignUserFromPS(assignmentId) {
  const { error } = await supabase
    .from('user_permission_sets')
    .delete()
    .eq('id', assignmentId)
  if (error) throw error
}

// ─── Field discovery for a given object ────────────────────────────────────

// System / audit columns we hide from the field-permission editor — they're
// internal, never exposed to a non-admin, and would just clutter the matrix.
const HIDDEN_FIELD_PATTERNS = [
  /^id$/,
  /_record_number$/,
  /_created_at$/,
  /_created_by$/,
  /_updated_at$/,
  /_updated_by$/,
  /_is_deleted$/,
  /_deleted_at$/,
  /_deleted_by$/,
  /_deletion_reason$/,
  /^created_at$/,
  /^updated_at$/,
  /^is_deleted$/,
]

function isUserVisibleField(name) {
  return !HIDDEN_FIELD_PATTERNS.some(rx => rx.test(name))
}

// Returns a sorted list of fields admins can author permissions for on the
// given object, with a friendly label derived from the column name.
export async function fetchObjectFields(objectName) {
  const { data, error } = await supabase.rpc('describe_object_columns', { p_table: objectName })
  if (error) throw error
  const cols = (data || [])
    .filter(c => isUserVisibleField(c.column_name))
    .map(c => ({
      name: c.column_name,
      dataType: c.data_type,
      label: humanizeColumnName(c.column_name, objectName),
    }))
  cols.sort((a, b) => a.label.localeCompare(b.label))
  return cols
}

// Strip the table-name prefix the schema convention adds (e.g.
// `work_order_property_id` → `property_id` → `Property Id`) and title-case.
function humanizeColumnName(col, objectName) {
  // Find the longest prefix match against the singular root of the table name.
  // Most tables follow `{table_root}_{field}` — e.g. work_orders/work_order.
  const root = singularRoot(objectName)
  let stripped = col
  if (root && col.startsWith(root + '_')) stripped = col.slice(root.length + 1)
  return stripped
    .split('_')
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function singularRoot(table) {
  if (!table) return ''
  if (table.endsWith('ies')) return table.slice(0, -3) + 'y'
  if (table.endsWith('s'))   return table.slice(0, -1)
  return table
}
