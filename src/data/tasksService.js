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
      id, task_record_number, subject, description, status, priority,
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
      id: t.task_record_number || t.id.slice(0, 8).toUpperCase(),
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

/**
 * The people a task can be assigned to.
 *
 * Active internal users only. An inactive user has no role at all
 * (app_current_role_name requires user_is_active), so assigning work to one
 * routes it to somebody who cannot sign in and cannot see it.
 */
export async function fetchAssignableUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, user_name, user_email')
    .eq('user_is_active', true)
    .eq('is_deleted', false)
    .order('user_name')
  if (error) throw error
  return (data || []).map(u => ({
    id: u.id,
    name: u.user_name || u.user_email || 'Unnamed user',
    email: u.user_email || '',
  }))
}

/**
 * The status and priority vocabularies, read from the database.
 *
 * Never hardcode these. They were hardcoded in TasksModule.jsx and disagreed
 * with both the column default and every writer, so a task could carry a status
 * that no filter in the UI would match. The values are the API names the
 * automations write; the labels are what a person reads ("Task Open").
 */
export async function fetchTaskPicklists() {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('picklist_field, picklist_value, picklist_label, picklist_sort_order')
    .eq('picklist_object', 'tasks')
    .eq('picklist_is_active', true)
    .order('picklist_sort_order')
  if (error) throw error
  const pick = (field) => (data || [])
    .filter(r => r.picklist_field === field)
    .map(r => ({ value: r.picklist_value, label: r.picklist_label || r.picklist_value }))
  return { status: pick('status'), priority: pick('priority') }
}

/**
 * Create a task and assign it to somebody.
 *
 * This is the path that did not exist. Every one of the 71 tasks on the
 * platform before this was written by a database trigger, because the client
 * had fetch, complete and reopen and no insert at all — which is why nobody
 * had ever made one.
 *
 * `owner_id` is required by the table and is the whole point of a task, so it
 * is required here rather than defaulted to the creator: LEAP's rule is that
 * every record has a NAMED owner assigned at creation, and silently assigning
 * work to whoever happened to open the form is how a task ends up owned by
 * somebody who never agreed to do it.
 *
 * `created_by_id` is stamped so the assignment notification can tell who sent
 * it — trg_task_create_notification deliberately stays quiet when a person
 * assigns a task to themselves, and it cannot know that without the creator.
 *
 * relatedObject / relatedId are optional: a task can hang off any record
 * (polymorphic, like documents), or off nothing at all when it is just
 * something somebody has to do.
 */
export async function createTask({
  subject,
  description = null,
  status = 'Open',
  priority = 'Normal',
  ownerId,
  dueDate = null,
  reminderDate = null,
  relatedObject = null,
  relatedId = null,
}) {
  const cleanSubject = String(subject || '').trim()
  if (!cleanSubject) throw new Error('A task needs a subject.')
  if (!ownerId) throw new Error('A task needs somebody assigned to it.')

  const { data: authData } = await supabase.auth.getUser()
  const authUid = authData?.user?.id || null
  let creatorId = null
  if (authUid) {
    const { data: meRow } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', authUid)
      .maybeSingle()
    creatorId = meRow?.id || null
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      // Left empty on purpose: trg_task_number fills it with the next TSK-,
      // the same way every other record-numbered object works.
      task_record_number: '',
      subject: cleanSubject,
      description: description ? String(description).trim() || null : null,
      status,
      priority,
      owner_id: ownerId,
      created_by_id: creatorId,
      due_date: dueDate || null,
      reminder_date: reminderDate || null,
      related_object: relatedObject || null,
      related_id: relatedId || null,
      is_automated: false,
      is_ai_created: false,
    })
    .select('id, task_record_number, subject, status, priority, due_date, owner_id')
    .single()
  if (error) throw error
  return data
}
