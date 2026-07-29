import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// programKnowledgeService — data access for the Program Knowledge Base.
//
// Per-program internal notes the LEAP assistant reads. WRITE is Admin-only and
// READ is internal-only — both enforced in the database (RLS), so these calls
// simply surface whatever the signed-in user is allowed to touch. A non-admin's
// insert/update/delete is rejected server-side.
// ---------------------------------------------------------------------------

export async function fetchAllProgramKnowledgeArticles() {
  const { data, error } = await supabase
    .from('program_knowledge_articles')
    .select('id, pka_record_number, program_id, pka_title, pka_category, pka_is_published, pka_updated_at, pka_created_at')
    .eq('pka_is_deleted', false)
    .order('pka_title', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchProgramKnowledgeArticleById(id) {
  const { data, error } = await supabase
    .from('program_knowledge_articles')
    .select('id, pka_record_number, program_id, pka_title, pka_body_markdown, pka_category, pka_is_published, pka_created_at, pka_updated_at')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createProgramKnowledgeArticle(payload) {
  const { data, error } = await supabase
    .from('program_knowledge_articles')
    .insert({
      program_id:        payload.program_id,
      pka_title:         payload.pka_title,
      pka_category:      payload.pka_category || null,
      pka_body_markdown: payload.pka_body_markdown || '',
      pka_is_published:  !!payload.pka_is_published,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProgramKnowledgeArticle(id, patch) {
  const fields = {}
  if ('program_id' in patch)        fields.program_id        = patch.program_id
  if ('pka_title' in patch)         fields.pka_title         = patch.pka_title
  if ('pka_category' in patch)      fields.pka_category      = patch.pka_category
  if ('pka_body_markdown' in patch) fields.pka_body_markdown = patch.pka_body_markdown
  if ('pka_is_published' in patch)  fields.pka_is_published  = patch.pka_is_published
  fields.pka_updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('program_knowledge_articles')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function softDeleteProgramKnowledgeArticle(id, reason) {
  const { error } = await supabase
    .from('program_knowledge_articles')
    .update({
      pka_is_deleted:      true,
      pka_deletion_reason: reason || 'Deleted via Program Knowledge admin',
      pka_deleted_at:      new Date().toISOString(),
      pka_updated_at:      new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}
