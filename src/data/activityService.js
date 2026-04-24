// -----------------------------------------------------------------------------
// activityService.js
//
// Fetches the unified activity timeline for a single record. Pulls from two
// sources:
//   - audit_log         — one row per INSERT/UPDATE/SOFT_DELETE/RESTORE/HARD_DELETE
//   - field_history     — one row per tracked field value change on UPDATE
//
// Both are written by the consolidated trigger `log_audit_and_field_history()`
// attached as `trg_audit_<table>` to every business table. The trigger reads
// `field_history_tracked_fields` to decide which columns are tracked.
//
// The returned timeline is a flat, chronologically-descending array. Field
// changes are grouped under their parent audit event when they share the same
// record, same actor, and a timestamp within 1 second (same trigger batch).
// This avoids showing 10 duplicate "UPDATE work_orders" rows for a single edit.
//
// Value resolution:
//   - Picklist UUIDs → picklist label
//   - User/lookup UUIDs → best-effort name from users table (for owner/
//     assigned_to style fields). Other lookups fall back to truncated UUID.
// -----------------------------------------------------------------------------

import { supabase } from '../lib/supabase'

// UUID regex used to detect which raw values should be resolved to labels.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v)
}

// Collect every UUID-looking string that appears as an old/new value in the
// field_history rows. We resolve these in bulk against picklist_values and
// users so display values are human-readable.
function collectReferencedUuids(fhRows) {
  const out = new Set()
  for (const r of fhRows) {
    if (isUuid(r.fh_old_value)) out.add(r.fh_old_value)
    if (isUuid(r.fh_new_value)) out.add(r.fh_new_value)
  }
  return [...out]
}

// Collect every actor UUID so we can resolve names in one query.
function collectActorUuids(auditRows, fhRows) {
  const out = new Set()
  for (const r of auditRows)  if (r.al_performed_by) out.add(r.al_performed_by)
  for (const r of fhRows)     if (r.fh_changed_by)   out.add(r.fh_changed_by)
  return [...out]
}

async function resolvePicklistLabels(uuids) {
  if (!uuids.length) return new Map()
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_label, picklist_value')
    .in('id', uuids)
  if (error) return new Map()
  const m = new Map()
  for (const r of data || []) {
    m.set(r.id, r.picklist_label || r.picklist_value)
  }
  return m
}

async function resolveUserNames(uuids) {
  if (!uuids.length) return new Map()
  const { data, error } = await supabase
    .from('users')
    .select('id, user_first_name, user_last_name, user_email')
    .in('id', uuids)
  if (error) return new Map()
  const m = new Map()
  for (const r of data || []) {
    const name = [r.user_first_name, r.user_last_name].filter(Boolean).join(' ').trim()
    m.set(r.id, name || r.user_email || r.id.slice(0, 8))
  }
  return m
}

// Build a single display string for a raw value. Tries picklist → user → raw.
function formatValue(raw, picklistMap, userMap) {
  if (raw === null || raw === undefined || raw === '') return '—'
  if (isUuid(raw)) {
    if (picklistMap.has(raw)) return picklistMap.get(raw)
    if (userMap.has(raw))     return userMap.get(raw)
    return raw.slice(0, 8) + '…'
  }
  // Booleans stored as 'true'/'false' text
  if (raw === 'true')  return 'Yes'
  if (raw === 'false') return 'No'
  return String(raw)
}

// Humanize a snake_case column name: 'work_order_status' → 'Work Order Status'
function humanizeFieldName(col) {
  if (!col) return ''
  return col
    .replace(/^(ia|wpt|wpte|wst|ppr|sa)_/, '')   // strip known short prefixes
    .replace(/_id$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Group field_history rows into batches by (changed_by, timestamp-bucket).
// A "batch" is all field changes from the same user within the same second —
// this is how they look as a single logical edit to the human reading the log.
function groupFieldHistoryByBatch(fhRows) {
  const batches = new Map()
  for (const r of fhRows) {
    const ts = new Date(r.fh_changed_at)
    const bucket = Math.floor(ts.getTime() / 1000)    // 1-second bucket
    const key = `${r.fh_changed_by || 'null'}|${bucket}`
    if (!batches.has(key)) {
      batches.set(key, {
        actorId:   r.fh_changed_by,
        timestamp: r.fh_changed_at,
        changes:   [],
      })
    }
    batches.get(key).changes.push(r)
  }
  return [...batches.values()]
}

// -----------------------------------------------------------------------------
// Public API: fetchActivityTimeline
//
// Returns a descending-chronological page of timeline entries plus a flag
// indicating whether either source hit its row cap (so the UI can render a
// "Load more" button). Pass the oldest timestamp from the current page back
// as `before` to fetch the next page.
//
// Signature:
//   fetchActivityTimeline(tableName, recordId, { before, auditLimit, fhLimit })
//     → { entries, hasMore }
//
// Each entry shape:
// {
//   id:         string   (unique per entry, for React keys)
//   kind:       'create' | 'update' | 'soft_delete' | 'restore' | 'hard_delete'
//   timestamp:  ISO string
//   actorId:    uuid | null
//   actorName:  string | 'System'
//   changes:    [{ field, fieldLabel, oldValue, newValue }]   (empty unless kind='update')
// }
//
// A field_history batch straddling a page boundary will render as two adjacent
// cards instead of one — acceptable for a log view, and avoids re-grouping
// across accumulated pages.
// -----------------------------------------------------------------------------

const DEFAULT_AUDIT_LIMIT = 500
const DEFAULT_FH_LIMIT    = 1000

export async function fetchActivityTimeline(tableName, recordId, opts = {}) {
  if (!tableName || !recordId) return { entries: [], hasMore: false }

  const auditLimit = opts.auditLimit ?? DEFAULT_AUDIT_LIMIT
  const fhLimit    = opts.fhLimit    ?? DEFAULT_FH_LIMIT
  const before     = opts.before || null

  // Both queries are filtered identically on record + date cursor so each page
  // represents a contiguous time window.
  let auditQuery = supabase
    .from('audit_log')
    .select('id, al_action, al_performed_by, al_performed_at, al_notes')
    .eq('al_object', tableName)
    .eq('al_record_id', recordId)
    .order('al_performed_at', { ascending: false })
    .limit(auditLimit)
  if (before) auditQuery = auditQuery.lt('al_performed_at', before)

  let fhQuery = supabase
    .from('field_history')
    .select('id, fh_field, fh_old_value, fh_new_value, fh_changed_by, fh_changed_at')
    .eq('fh_object', tableName)
    .eq('fh_record_id', recordId)
    .order('fh_changed_at', { ascending: false })
    .limit(fhLimit)
  if (before) fhQuery = fhQuery.lt('fh_changed_at', before)

  const [auditRes, fhRes] = await Promise.all([auditQuery, fhQuery])

  const auditRows = auditRes.error ? [] : (auditRes.data || [])
  const fhRows    = fhRes.error    ? [] : (fhRes.data    || [])

  // If either source came back with a full page, there's probably more to pull.
  const hasMore = auditRows.length >= auditLimit || fhRows.length >= fhLimit

  // Resolve picklist labels and user names in bulk.
  const [picklistMap, userMap] = await Promise.all([
    resolvePicklistLabels(collectReferencedUuids(fhRows)),
    resolveUserNames(collectActorUuids(auditRows, fhRows)),
  ])

  // Convert field_history rows into batched "update" entries, excluding rows
  // that correspond to an INSERT audit row (which already tells the full story).
  const batches = groupFieldHistoryByBatch(fhRows)

  // Helper: find the audit row within ±1 second of a batch that matches the
  // actor. This is how we tag a batch as an 'update' vs 'soft_delete' vs
  // 'restore' — the batch inherits the audit row's kind.
  function findAuditForBatch(batch) {
    const batchTs = new Date(batch.timestamp).getTime()
    for (const a of auditRows) {
      const at = new Date(a.al_performed_at).getTime()
      if (Math.abs(at - batchTs) <= 1000 &&
          (a.al_performed_by || null) === (batch.actorId || null)) {
        return a
      }
    }
    return null
  }

  // Track which audit rows we've already absorbed into a batch so we don't
  // double-report them as standalone entries.
  const consumedAuditIds = new Set()

  const updateEntries = batches.map(batch => {
    const audit = findAuditForBatch(batch)
    if (audit) consumedAuditIds.add(audit.id)
    const kind = audit ? actionToKind(audit.al_action) : 'update'
    return {
      id:        `batch-${batch.timestamp}-${batch.actorId || 'null'}`,
      kind,
      timestamp: batch.timestamp,
      actorId:   batch.actorId,
      actorName: batch.actorId ? (userMap.get(batch.actorId) || 'Unknown user') : 'System',
      changes:   batch.changes.map(c => ({
        field:      c.fh_field,
        fieldLabel: humanizeFieldName(c.fh_field),
        oldValue:   formatValue(c.fh_old_value, picklistMap, userMap),
        newValue:   formatValue(c.fh_new_value, picklistMap, userMap),
      })),
    }
  })

  // Any audit row NOT consumed by a batch is rendered as a standalone entry.
  // This covers creates (INSERT), deletes with no tracked fields, and edits
  // that touched only non-tracked fields.
  const standaloneEntries = auditRows
    .filter(a => !consumedAuditIds.has(a.id))
    .map(a => ({
      id:        `audit-${a.id}`,
      kind:      actionToKind(a.al_action),
      timestamp: a.al_performed_at,
      actorId:   a.al_performed_by,
      actorName: a.al_performed_by ? (userMap.get(a.al_performed_by) || 'Unknown user') : 'System',
      changes:   [],
    }))

  // Merge and sort descending.
  const entries = [...updateEntries, ...standaloneEntries]
  entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  return { entries, hasMore }
}

function actionToKind(action) {
  switch (action) {
    case 'INSERT':       return 'create'
    case 'UPDATE':       return 'update'
    case 'SOFT_DELETE':  return 'soft_delete'
    case 'RESTORE':      return 'restore'
    case 'HARD_DELETE':  return 'hard_delete'
    default:             return 'update'
  }
}
