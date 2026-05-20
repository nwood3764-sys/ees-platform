// notificationsService.js
//
// Reads the in-app notification queue for the currently signed-in user via
// SECURITY DEFINER RPCs that scope to auth.uid() server-side. No client code
// should ever write to the notifications table directly — notifications are
// produced by database triggers (e.g. tasks INSERT/owner_id UPDATE) and the
// automation executor.
//
// API surface:
//   loadUnreadCount()             -> int    (for the bell badge)
//   loadRecent(limit = 30)        -> rows   (for the dropdown list)
//   markRead(notificationId)      -> int    (rows updated, 0 or 1)
//   markAllRead()                 -> int    (rows updated)
//
// Each row shape:
//   { id, notification_type, title, body, related_object, related_id,
//     is_read, read_at, is_automated, triggered_by, created_at }

import { supabase } from '../lib/supabase'

export async function loadUnreadCount() {
  const { data, error } = await supabase.rpc('notifications_unread_count')
  if (error) throw error
  return Number(data || 0)
}

export async function loadRecent(limit = 30) {
  const { data, error } = await supabase.rpc('notifications_list_recent', { p_limit: limit })
  if (error) throw error
  return data || []
}

export async function markRead(notificationId) {
  if (!notificationId) return 0
  const { data, error } = await supabase.rpc('notifications_mark_read', { p_notification_id: notificationId })
  if (error) throw error
  return Number(data || 0)
}

export async function markAllRead() {
  const { data, error } = await supabase.rpc('notifications_mark_all_read')
  if (error) throw error
  return Number(data || 0)
}
