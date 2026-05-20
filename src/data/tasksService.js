// Tasks data layer. The tasks table is a global to-do queue with polymorphic
// related_object / related_id columns, so tasks can attach to any record
// type without per-table foreign keys.

import { supabase } from '../lib/supabase'

/**
 * Fetch tasks for the global Tasks module. Modes:
 *   'mine'      — owned by the current user
 *   'all'       — every live task
 *   'automated' — only is_automated = true (system-created tasks)
 *   'overdue'   — due_date < today AND status not Completed
 */
export async function fetchTasks(mode = 'all') {
  // Resolve current public.users.id from auth.uid (the FK target for owner_id
  // is public.users.id, not auth.uid). Do this regardless of mode so the
  // 'You' label rendering can compare correctly.
  const { data: authData } = await supabase.auth.getUser()
  const authUid = authData?.user?.id || null
  let myUserId = null
  if (authUid) {
    const { data: meRow } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', authUid)
      .maybeSingle()
    myUserId = meRow?.id || null
  }

  let query = supabase
    .from('tasks')
    .select(`
      id, task_number, subject, description, status, priority,
      due_date, completed_date, owner_id, related_object, related_id,
      is_automated, automation_rule, created_at, updated_at,
      owner:users!tasks_owner_id_fkey ( id, user_name, user_email )
    `)
    .eq('is_deleted', false)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(500)

  if (mode === 'mine' && myUserId) {
    query = query.eq('owner_id', myUserId)
  } else if (mode === 'automated') {
    query = query.eq('is_automated', true)
  } else if (mode === 'overdue') {
    const today = new Date().toISOString().slice(0, 10)
    query = query.lt('due_date', today).neq('status', 'Completed')
  }

  const { data, error } = await query
  if (error) throw error

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (data || []).map(t => {
    const due = t.due_date ? new Date(t.due_date) : null
    const isOverdue = due && due < today && t.status !== 'Completed'
    return {
      id: t.task_number || t.id.slice(0, 8).toUpperCase(),
      _id: t.id,
      subject: t.subject || '(no subject)',
      description: t.description || '',
      status: t.status || 'Open',
      priority: t.priority || 'Normal',
      dueDate: t.due_date,
      dueDateDisplay: t.due_date || '—',
      ownerName: t.owner?.user_name || t.owner?.user_email || '—',
      ownerIsMe: myUserId && t.owner_id === myUserId,
      relatedObject: t.related_object || '—',
      relatedId: t.related_id || null,
      isAutomated: !!t.is_automated,
      automationRule: t.automation_rule || '',
      isOverdue,
      createdAt: t.created_at,
    }
  })
}

export async function markTaskComplete(taskId) {
  const today = new Date().toISOString().slice(0, 10)
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'Completed', completed_date: today, updated_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
}

export async function reopenTask(taskId) {
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'Open', completed_date: null, updated_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
}
