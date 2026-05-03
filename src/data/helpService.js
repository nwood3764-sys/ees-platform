import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// helpService — data access for the in-app help system.
//
// Two read paths:
//   • lookupHelpArticles(anchors)   — surfaces the panel-side "what does this do?"
//   • searchHelpArticles(query)     — full library browse / search
//
// One write path used only by Admin > Help Articles:
//   • createHelpArticle / updateHelpArticle / softDeleteHelpArticle
//   • setArticleAnchors (replace all anchors atomically)
//
// Audience values: 'admin' | 'internal' | 'portal' | 'all'.
// ---------------------------------------------------------------------------

// ─── Audience resolution ─────────────────────────────────────────────────
//
// Map the logged-in user's role to a help audience. Roles that wear the
// admin hat see admin articles; roles that work inside the app but are not
// admins see internal articles; the partner-org and customer-org roles see
// portal articles. 'all'-audience articles are visible to everyone.

const ADMIN_ROLES = new Set(['Admin'])
const PORTAL_ROLES = new Set(['Property Owner','Property Manager','Subcontractor Partner'])

export function audienceForRoleName(roleName) {
  if (!roleName) return null
  if (ADMIN_ROLES.has(roleName)) return 'admin'
  if (PORTAL_ROLES.has(roleName)) return 'portal'
  return 'internal'
}

// ─── Lookup ──────────────────────────────────────────────────────────────

/**
 * Find help articles attached to the given anchors. Anchors are an array of
 * specs — the function returns articles that match ANY of them, deduped.
 *
 * Each spec is one of:
 *   { type: 'route',   route:  '/admin/roles' }
 *   { type: 'object',  object: 'work_orders' }
 *   { type: 'field',   object: 'work_orders', field: 'work_order_status' }
 *   { type: 'concept', concept: 'financial-tier' }
 */
export async function lookupHelpArticles(anchors, audience = null) {
  const { data, error } = await supabase.rpc('help_lookup_articles', {
    p_anchors: anchors || [],
    p_audience: audience,
  })
  if (error) throw error
  return data || []
}

// ─── Search ──────────────────────────────────────────────────────────────

export async function searchHelpArticles(query, audience = null, limit = 50) {
  const { data, error } = await supabase.rpc('help_search_articles', {
    p_query: query || '',
    p_audience: audience,
    p_limit: limit,
  })
  if (error) throw error
  return data || []
}

// ─── Admin: list / get / mutate ──────────────────────────────────────────

export async function fetchAllHelpArticles({ includeDrafts = true } = {}) {
  let q = supabase
    .from('help_articles')
    .select('id, ha_record_number, ha_slug, ha_title, ha_summary, ha_category, ha_audience, ha_is_published, ha_updated_at, ha_created_at')
    .eq('ha_is_deleted', false)
    .order('ha_title', { ascending: true })
  if (!includeDrafts) q = q.eq('ha_is_published', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function fetchHelpArticleById(id) {
  const { data: article, error: aErr } = await supabase
    .from('help_articles')
    .select('id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published, ha_created_at, ha_updated_at')
    .eq('id', id)
    .single()
  if (aErr) throw aErr

  const { data: anchors, error: anErr } = await supabase
    .from('help_article_anchors')
    .select('id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order')
    .eq('haa_article_id', id)
    .order('haa_sort_order', { ascending: true })
  if (anErr) throw anErr

  return { article, anchors: anchors || [] }
}

export async function createHelpArticle(payload) {
  const { data, error } = await supabase
    .from('help_articles')
    .insert({
      ha_slug:          payload.ha_slug,
      ha_title:         payload.ha_title,
      ha_summary:       payload.ha_summary || null,
      ha_body_markdown: payload.ha_body_markdown || '',
      ha_category:      payload.ha_category || null,
      ha_audience:      payload.ha_audience || 'all',
      ha_is_published:  !!payload.ha_is_published,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateHelpArticle(id, patch) {
  const fields = {}
  if ('ha_slug' in patch)          fields.ha_slug          = patch.ha_slug
  if ('ha_title' in patch)         fields.ha_title         = patch.ha_title
  if ('ha_summary' in patch)       fields.ha_summary       = patch.ha_summary
  if ('ha_body_markdown' in patch) fields.ha_body_markdown = patch.ha_body_markdown
  if ('ha_category' in patch)      fields.ha_category      = patch.ha_category
  if ('ha_audience' in patch)      fields.ha_audience      = patch.ha_audience
  if ('ha_is_published' in patch)  fields.ha_is_published  = patch.ha_is_published
  fields.ha_updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('help_articles')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function softDeleteHelpArticle(id, reason) {
  const { error } = await supabase
    .from('help_articles')
    .update({
      ha_is_deleted:      true,
      ha_deletion_reason: reason || 'Deleted via Help Articles admin',
      ha_deleted_at:      new Date().toISOString(),
      ha_updated_at:      new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

/**
 * Replace the full set of anchors for an article. Atomic for the consumer —
 * we delete then bulk-insert. The matching set on the table is small (each
 * article averages a handful of anchors), so this is straightforward.
 *
 * `anchors` shape: array of
 *   { type, route?, object?, field?, concept?, sort_order? }
 */
export async function setArticleAnchors(articleId, anchors) {
  const { error: delErr } = await supabase
    .from('help_article_anchors')
    .delete()
    .eq('haa_article_id', articleId)
  if (delErr) throw delErr
  if (!anchors || anchors.length === 0) return []

  const rows = anchors.map((a, i) => ({
    haa_article_id:   articleId,
    haa_anchor_type:  a.type,
    haa_route:        a.type === 'route'   ? a.route   : null,
    haa_object:       (a.type === 'object' || a.type === 'field') ? a.object : null,
    haa_field:        a.type === 'field'   ? a.field   : null,
    haa_concept:      a.type === 'concept' ? a.concept : null,
    haa_sort_order:   typeof a.sort_order === 'number' ? a.sort_order : i,
  }))

  const { data, error } = await supabase
    .from('help_article_anchors')
    .insert(rows)
    .select()
  if (error) throw error
  return data
}

// ─── Slug helper ─────────────────────────────────────────────────────────

export function slugify(input) {
  return (input || '')
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
