/**
 * Recently Viewed Records — Salesforce "Recent Items" parity.
 *
 * Backed by two RPCs (migration 20260728203614_recently_viewed_records):
 *   • record_recently_viewed(p_object_table, p_record_id) — fire-and-forget when a
 *     record detail opens. Upserts a per-user, RLS-scoped footprint row.
 *   • list_recently_viewed(p_limit) — returns the caller's most-recently-viewed
 *     records in the EXACT column shape global_search returns (object_type,
 *     object_label, table_name, id, primary_label, secondary_label,
 *     record_number) plus last_viewed_at, so the search dropdown renders them
 *     with identical row markup.
 *
 * Only the object tables global_search covers are trackable; the write RPC
 * silently ignores anything else. Both calls are best-effort — a failure here
 * must never surface to the user or block navigation.
 */

import { supabase } from '../lib/supabase'

// Object tables the recents log tracks (mirrors the whitelist in the write RPC).
// Used to avoid firing the RPC for non-navigable hosts (e.g. local detail mounts
// of tables that aren't real objects).
const TRACKABLE_TABLES = new Set([
  'accounts', 'contacts', 'properties', 'buildings', 'units', 'opportunities',
  'projects', 'work_orders', 'incentive_applications', 'assessments', 'programs',
  'vehicles', 'equipment', 'product_items', 'users', 'envelopes', 'service_appointments',
])

/**
 * Record that the current user opened a record. Fire-and-forget: never awaited
 * for UI, never throws to the caller.
 */
export async function recordRecentlyViewed(objectTable, recordId) {
  if (!objectTable || !recordId || !TRACKABLE_TABLES.has(objectTable)) return
  try {
    await supabase.rpc('record_recently_viewed', {
      p_object_table: objectTable,
      p_record_id: recordId,
    })
  } catch {
    /* best-effort telemetry — a failed write must not affect the page */
  }
}

/**
 * Load the current user's most-recently-viewed records, newest first.
 * Returns an array of rows in global_search's column shape (+ last_viewed_at),
 * or [] on any error.
 */
export async function listRecentlyViewed(limit = 7) {
  try {
    const { data, error } = await supabase.rpc('list_recently_viewed', { p_limit: limit })
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Load the current user's most-recently-viewed records of a SINGLE object,
 * newest first — the data source for the "Recently Viewed" home card. Rows are
 * { id, primary_label, secondary_label, record_number, last_viewed_at }.
 * Returns [] on any error (best-effort, never throws to the card).
 */
export async function listRecentlyViewedForObject(objectTable, limit = 8) {
  if (!objectTable) return []
  try {
    const { data, error } = await supabase.rpc('list_recently_viewed_for_object', {
      p_object_table: objectTable,
      p_limit: limit,
    })
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
