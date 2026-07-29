-- ─── Knowledge Base (semantic / RAG) ────────────────────────────────────────
-- One general company "brain": drop in files (Word, Excel/CSV, text, PDF) or
-- typed notes, no required filing. The LEAP assistant searches the whole pool by
-- MEANING (embeddings, not keywords) and answers with citations.
--
-- Confusion guard (Nicholas, 2026-07-29): approved measures differ by state and
-- program, so each item can OPTIONALLY carry a State and/or Program (opportunity
-- record type) scope — never required (an upload is never blocked), but when set
-- it keeps WI answers out of NC questions via scope-aware retrieval.
--
-- Security: WRITE (upload/edit/delete) Admin-only; READ internal-only (portal
-- excluded); soft-delete + audit on the document; chunks are derived data.
--
-- Supersedes the program-anchored program_knowledge_articles (no real content).

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ── Retire the program-specific first cut (brand-new, no live data) ──────────
DROP FUNCTION IF EXISTS public.search_program_knowledge(text, text, integer);
DROP TABLE IF EXISTS public.program_knowledge_articles CASCADE;
DROP FUNCTION IF EXISTS public.trg_program_knowledge_articles_rn();
UPDATE public.help_articles SET ha_is_deleted = true, ha_deletion_reason = 'Replaced by the general Knowledge Base', ha_updated_at = now()
  WHERE ha_slug = 'program-knowledge-base' AND ha_is_deleted = false;

-- ── knowledge_documents — one row per uploaded file or typed note ────────────
CREATE TABLE public.knowledge_documents (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    kd_record_number text,
    kd_title text NOT NULL,
    kd_description text,                       -- brief human description (optional)
    kd_source_type text NOT NULL DEFAULT 'note',  -- 'note' | 'file'
    kd_content_text text NOT NULL DEFAULT '',     -- typed body OR extracted file text
    kd_file_name text,
    kd_file_path text,                        -- storage path in the knowledge-base bucket
    kd_mime_type text,
    kd_file_size bigint,
    kd_state text,                            -- optional scope: WI/NC/MI/CO/IN (null = all states)
    kd_opportunity_record_type text,          -- optional scope: e.g. WI-IRA-MF-HOMES (null = all programs)
    kd_is_indexed boolean NOT NULL DEFAULT false,
    kd_indexed_at timestamp with time zone,
    kd_chunk_count integer NOT NULL DEFAULT 0,
    kd_index_error text,
    kd_is_deleted boolean NOT NULL DEFAULT false,
    kd_deletion_reason text,
    kd_deleted_at timestamp with time zone,
    kd_deleted_by uuid,
    kd_created_at timestamp with time zone NOT NULL DEFAULT now(),
    kd_created_by uuid,
    kd_updated_at timestamp with time zone NOT NULL DEFAULT now(),
    kd_updated_by uuid,
    kd_search tsvector GENERATED ALWAYS AS (
      ((setweight(to_tsvector('english'::regconfig, COALESCE(kd_title, ''::text)), 'A'::"char")
      || setweight(to_tsvector('english'::regconfig, COALESCE(kd_description, ''::text)), 'B'::"char"))
      || setweight(to_tsvector('english'::regconfig, COALESCE(kd_content_text, ''::text)), 'C'::"char"))
    ) STORED,
    CONSTRAINT knowledge_documents_pkey PRIMARY KEY (id),
    CONSTRAINT knowledge_documents_source_type_check CHECK (kd_source_type IN ('note','file'))
);

CREATE INDEX idx_knowledge_documents_state     ON public.knowledge_documents USING btree (kd_state);
CREATE INDEX idx_knowledge_documents_program   ON public.knowledge_documents USING btree (kd_opportunity_record_type);
CREATE INDEX idx_knowledge_documents_indexed   ON public.knowledge_documents USING btree (kd_is_indexed, kd_is_deleted);
CREATE INDEX idx_knowledge_documents_search    ON public.knowledge_documents USING gin (kd_search);

-- ── knowledge_chunks — chunked text + embedding (derived, re-buildable) ──────
CREATE TABLE public.knowledge_chunks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    kc_document_id uuid NOT NULL,
    kc_chunk_index integer NOT NULL,
    kc_chunk_text text NOT NULL,
    kc_embedding extensions.vector(384),      -- gte-small (Supabase in-house model)
    kc_created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (id),
    CONSTRAINT knowledge_chunks_document_fkey
      FOREIGN KEY (kc_document_id) REFERENCES public.knowledge_documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_knowledge_chunks_document ON public.knowledge_chunks USING btree (kc_document_id);
CREATE INDEX idx_knowledge_chunks_embedding ON public.knowledge_chunks
  USING hnsw (kc_embedding extensions.vector_cosine_ops);

-- ── Record number KD-00001 ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_knowledge_documents_rn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  next_num integer;
BEGIN
  IF NEW.kd_record_number IS NULL OR NEW.kd_record_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(kd_record_number, '\D', '', 'g'), '')::integer), 0) + 1
      INTO next_num FROM public.knowledge_documents;
    NEW.kd_record_number := 'KD-' || lpad(next_num::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.trg_knowledge_documents_rn() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.trg_knowledge_documents_rn() TO authenticated, postgres, service_role;

CREATE TRIGGER trg_knowledge_documents_rn BEFORE INSERT ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION trg_knowledge_documents_rn();
CREATE TRIGGER trg_audit_knowledge_documents AFTER INSERT OR DELETE OR UPDATE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_knowledge_documents_no_hard_delete BEFORE DELETE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

-- ── RLS: read internal-only; write Admin-only ───────────────────────────────
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks    ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_select_knowledge_documents ON public.knowledge_documents
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (COALESCE(public.app_current_role_name() NOT IN ('Property Owner','Property Manager','Service Provider Partner'), false));
CREATE POLICY app_insert_knowledge_documents ON public.knowledge_documents
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.app_is_admin());
CREATE POLICY app_update_knowledge_documents ON public.knowledge_documents
  AS PERMISSIVE FOR UPDATE TO authenticated USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY app_delete_knowledge_documents ON public.knowledge_documents
  AS PERMISSIVE FOR DELETE TO authenticated USING (public.app_is_admin());

CREATE POLICY app_select_knowledge_chunks ON public.knowledge_chunks
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (COALESCE(public.app_current_role_name() NOT IN ('Property Owner','Property Manager','Service Provider Partner'), false));
CREATE POLICY app_insert_knowledge_chunks ON public.knowledge_chunks
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (public.app_is_admin());
CREATE POLICY app_update_knowledge_chunks ON public.knowledge_chunks
  AS PERMISSIVE FOR UPDATE TO authenticated USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY app_delete_knowledge_chunks ON public.knowledge_chunks
  AS PERMISSIVE FOR DELETE TO authenticated USING (public.app_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_chunks    TO authenticated;
GRANT ALL ON TABLE public.knowledge_documents TO postgres, service_role;
GRANT ALL ON TABLE public.knowledge_chunks    TO postgres, service_role;

-- ── Storage bucket for the original files (private) ──────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-base', 'knowledge-base', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "knowledge-base read internal" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge-base'
    AND COALESCE(public.app_current_role_name() NOT IN ('Property Owner','Property Manager','Service Provider Partner'), false));
CREATE POLICY "knowledge-base write admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge-base' AND public.app_is_admin());
CREATE POLICY "knowledge-base update admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'knowledge-base' AND public.app_is_admin());
CREATE POLICY "knowledge-base delete admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge-base' AND public.app_is_admin());

-- ── Scope-aware semantic match ──────────────────────────────────────────────
-- Vector similarity over published chunks, honoring optional State/Program
-- scope: a doc with NULL scope matches any query; a scoped doc only matches when
-- the query's scope is unset or equal — so a WI-scoped note never answers an
-- NC-scoped question. Internal staff only.
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  p_query_embedding extensions.vector,
  p_match_count integer DEFAULT 8,
  p_state text DEFAULT NULL,
  p_record_type text DEFAULT NULL
)
 RETURNS TABLE(
   kd_id uuid, kd_record_number text, kd_title text, kd_description text,
   kd_state text, kd_opportunity_record_type text, kd_file_name text,
   chunk_text text, similarity real
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_role  text := public.app_current_role_name();
  v_limit integer := GREATEST(1, LEAST(coalesce(p_match_count, 8), 20));
BEGIN
  IF v_role IS NULL OR v_role IN ('Property Owner','Property Manager','Service Provider Partner') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    d.id, d.kd_record_number, d.kd_title, d.kd_description,
    d.kd_state, d.kd_opportunity_record_type, d.kd_file_name,
    c.kc_chunk_text,
    (1 - (c.kc_embedding <=> p_query_embedding))::real AS similarity
  FROM public.knowledge_chunks c
  JOIN public.knowledge_documents d ON d.id = c.kc_document_id
  WHERE d.kd_is_deleted = false
    AND c.kc_embedding IS NOT NULL
    AND (p_state IS NULL OR d.kd_state IS NULL OR d.kd_state = p_state)
    AND (p_record_type IS NULL OR d.kd_opportunity_record_type IS NULL OR d.kd_opportunity_record_type = p_record_type)
  ORDER BY c.kc_embedding <=> p_query_embedding
  LIMIT v_limit;
END;
$function$
;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(extensions.vector, integer, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, integer, text, text) TO authenticated, postgres, service_role;

NOTIFY pgrst, 'reload schema';

-- ── Help article ────────────────────────────────────────────────────────────
INSERT INTO public.help_articles (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published)
VALUES ('', 'knowledge-base', 'Knowledge Base — the company brain the assistant answers from',
  'Upload files or notes into one searchable pool; the LEAP Assistant finds the answer by meaning and cites the source. Admins manage it; all internal staff can ask.',
$md$
## What it is

The **Knowledge Base** is one general pool — the company brain. Drop in files
(Word, Excel/CSV, text, PDFs) or typed notes: procedures, rate sheets, install
details, tips. There's **no required filing** — you don't have to put things in
the "right" folder.

Ask the **LEAP Assistant** a plain-English question and it searches the whole
pool by **meaning** (not exact keywords), pulls the most relevant passages, and
answers **citing the source document**.

## Keeping programs and states straight

Approved measures differ by state and program, so each item can optionally carry
a **State** and/or **Program** (e.g. WI-IRA-MF-HOMES). It's never required, but
when set it keeps a Wisconsin answer from showing up for a North Carolina
question. Leave both blank for knowledge that applies everywhere.

## Who can do what

- **Admins** upload, edit, and delete. Enforced in the database, so no one else
  can add or remove content.
- **All internal staff** can read it and ask the assistant. Portal (owner/
  partner) users cannot see it.
- Deletes are soft-deletes (recoverable) and audited.

## Adding knowledge (Admins)

Setup → **Administration → Knowledge Base**. **Upload a file** or **Add a note**,
give it a title, optionally a short description and a State/Program scope, and
save. LEAP extracts the text and indexes it so the assistant can read it.

## Asking

Open the assistant and ask naturally. It searches the whole brain, answers from
the best-matching passages, and cites the document. If nothing covers your
question, it says so rather than guessing.
$md$,
  'AI Assistant', 'internal', true);
