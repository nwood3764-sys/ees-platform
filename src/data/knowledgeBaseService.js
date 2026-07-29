import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// knowledgeBaseService — the company Knowledge Base (semantic search).
//
// Admins upload files or type notes into one general pool; text is extracted
// (Word/Excel/CSV/text in the browser, PDF server-side) and embedded so the
// LEAP assistant can search it by meaning. WRITE is Admin-only and READ is
// internal-only — both enforced in the database (RLS).
// ---------------------------------------------------------------------------

const BUCKET = 'knowledge-base'

function safeName(name) {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
}
function fileExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '')
  return m ? m[1].toLowerCase() : ''
}

// ─── Text extraction (client-side for text-based office formats) ───────────
// Returns extracted plain text, or '' when the browser can't extract it (PDF)
// — in that case the ingest edge function extracts it server-side.
export async function extractFileText(file) {
  const ext = fileExt(file.name)
  const type = file.type || ''
  try {
    if (ext === 'txt' || ext === 'md' || ext === 'csv' || type.startsWith('text/')) {
      return await file.text()
    }
    if (ext === 'docx' || type.includes('wordprocessingml')) {
      const mammoth = await import('mammoth')
      const buf = await file.arrayBuffer()
      const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
      return value || ''
    }
    if (ext === 'xlsx' || ext === 'xls' || type.includes('spreadsheet') || type.includes('excel')) {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      return wb.SheetNames
        .map(n => `# ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
        .join('\n\n')
    }
  } catch (e) {
    // Extraction failure isn't fatal — the file still uploads; it just won't be
    // searchable until re-indexed / OCR'd.
    console.warn('extractFileText failed', e)
    return ''
  }
  return '' // pdf and anything else → server-side
}

async function ingest(documentId) {
  const { data, error } = await supabase.functions.invoke('knowledge-ingest', {
    body: { document_id: documentId },
  })
  if (error) throw error
  return data
}

// Optional scope dropdowns.
export const KNOWLEDGE_STATES = ['WI', 'NC', 'MI', 'CO', 'IN']

// Program scope = opportunity record types (the real state×program×MF/SF axis).
export async function fetchProgramScopeOptions() {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('picklist_value, picklist_label, picklist_state')
    .eq('picklist_object', 'opportunities')
    .eq('picklist_field', 'record_type')
    .neq('picklist_is_active', false)
    .order('picklist_state', { ascending: true })
    .order('picklist_label', { ascending: true })
  if (error) throw error
  return data || []
}

// ─── Reads ─────────────────────────────────────────────────────────────────
export async function fetchAllKnowledgeDocuments() {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, kd_record_number, kd_title, kd_source_type, kd_file_name, kd_state, kd_opportunity_record_type, kd_is_indexed, kd_chunk_count, kd_index_error, kd_updated_at, kd_created_at')
    .eq('kd_is_deleted', false)
    .order('kd_updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchKnowledgeDocumentById(id) {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, kd_record_number, kd_title, kd_description, kd_source_type, kd_content_text, kd_file_name, kd_file_path, kd_mime_type, kd_file_size, kd_state, kd_opportunity_record_type, kd_is_indexed, kd_indexed_at, kd_chunk_count, kd_index_error, kd_created_at, kd_updated_at')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

// ─── Create: typed note ──────────────────────────────────────────────────────
export async function createKnowledgeNote({ title, description, content_text, state, program }) {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .insert({
      kd_title: title,
      kd_description: description || null,
      kd_source_type: 'note',
      kd_content_text: content_text || '',
      kd_state: state || null,
      kd_opportunity_record_type: program || null,
    })
    .select()
    .single()
  if (error) throw error
  try { await ingest(data.id) } catch (e) { console.warn('ingest note failed', e) }
  return data
}

// ─── Create: uploaded file ───────────────────────────────────────────────────
export async function uploadKnowledgeFile({ file, title, description, state, program }) {
  if (!file) throw new Error('file required')
  const extractedText = await extractFileText(file)

  // 1) Create the row (need its id for the storage path).
  const { data: row, error: insErr } = await supabase
    .from('knowledge_documents')
    .insert({
      kd_title: title || file.name,
      kd_description: description || null,
      kd_source_type: 'file',
      kd_content_text: extractedText || '',
      kd_file_name: file.name,
      kd_mime_type: file.type || null,
      kd_file_size: file.size || null,
      kd_state: state || null,
      kd_opportunity_record_type: program || null,
    })
    .select()
    .single()
  if (insErr) throw insErr

  // 2) Upload the original file.
  const path = `${row.id}/${Date.now()}-${safeName(file.name)}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (upErr) {
    // Roll back the row so we don't leave a fileless "file" document.
    try { await supabase.from('knowledge_documents').update({ kd_is_deleted: true, kd_deletion_reason: 'Upload failed', kd_deleted_at: new Date().toISOString() }).eq('id', row.id) } catch { /* noop */ }
    throw upErr
  }

  // 3) Record the path.
  const { error: pathErr } = await supabase
    .from('knowledge_documents')
    .update({ kd_file_path: path, kd_updated_at: new Date().toISOString() })
    .eq('id', row.id)
  if (pathErr) throw pathErr

  // 4) Index (chunk + embed; PDFs get extracted server-side here).
  try { await ingest(row.id) } catch (e) { console.warn('ingest file failed', e) }
  return row
}

// ─── Update / re-index / delete ──────────────────────────────────────────────
export async function updateKnowledgeDocument(id, patch, { reindex = false } = {}) {
  const fields = {}
  if ('title' in patch)       fields.kd_title = patch.title
  if ('description' in patch) fields.kd_description = patch.description || null
  if ('content_text' in patch) fields.kd_content_text = patch.content_text
  if ('state' in patch)       fields.kd_state = patch.state || null
  if ('program' in patch)     fields.kd_opportunity_record_type = patch.program || null
  fields.kd_updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('knowledge_documents')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  if (reindex) { try { await ingest(id) } catch (e) { console.warn('reindex failed', e) } }
  return data
}

export async function reindexKnowledgeDocument(id) {
  return ingest(id)
}

export async function softDeleteKnowledgeDocument(id, reason) {
  const { error } = await supabase
    .from('knowledge_documents')
    .update({
      kd_is_deleted: true,
      kd_deletion_reason: reason || 'Deleted via Knowledge Base admin',
      kd_deleted_at: new Date().toISOString(),
      kd_updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

// ─── Download the original file ──────────────────────────────────────────────
export async function knowledgeFileUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error) throw error
  return data?.signedUrl || null
}
