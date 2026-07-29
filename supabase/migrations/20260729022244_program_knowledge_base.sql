-- ─── Program Knowledge Base ─────────────────────────────────────────────────
-- A per-program internal knowledge store: Admin-curated notes about how a
-- specific incentive/rebate PROGRAM actually works (rates, eligibility, process
-- changes, one-off exceptions) that aren't public and change on the fly. The
-- LEAP assistant reads it so any internal user can ask "how does the <program>
-- program handle X" and get an answer grounded in these notes.
--
-- This is program subject-matter knowledge — deliberately its OWN object,
-- separate from help_articles (which is how-to-use-the-platform).
--
-- Security model (per Nicholas, 2026-07-29):
--   • WRITE (create/update/delete) → system Admins only, enforced in RLS, so a
--     non-admin can never add or delete erroneous content even via the API.
--   • READ → internal staff only (portal/external roles excluded), so non-public
--     program knowledge stays internal.
--   • Delete is soft-delete → recycle bin, fully audited, like every LEAP record.

CREATE TABLE public.program_knowledge_articles (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    pka_record_number text,
    program_id uuid NOT NULL,
    pka_title text NOT NULL,
    pka_body_markdown text NOT NULL DEFAULT ''::text,
    pka_category text,
    pka_is_published boolean NOT NULL DEFAULT false,
    pka_is_deleted boolean NOT NULL DEFAULT false,
    pka_deletion_reason text,
    pka_deleted_at timestamp with time zone,
    pka_deleted_by uuid,
    pka_created_at timestamp with time zone NOT NULL DEFAULT now(),
    pka_created_by uuid,
    pka_updated_at timestamp with time zone NOT NULL DEFAULT now(),
    pka_updated_by uuid,
    pka_search tsvector GENERATED ALWAYS AS (
      ((setweight(to_tsvector('english'::regconfig, COALESCE(pka_title, ''::text)), 'A'::"char")
      || setweight(to_tsvector('english'::regconfig, COALESCE(pka_category, ''::text)), 'B'::"char"))
      || setweight(to_tsvector('english'::regconfig, COALESCE(pka_body_markdown, ''::text)), 'C'::"char"))
    ) STORED,
    CONSTRAINT program_knowledge_articles_pkey PRIMARY KEY (id),
    CONSTRAINT program_knowledge_articles_program_id_fkey
      FOREIGN KEY (program_id) REFERENCES public.programs(id)
);

CREATE INDEX idx_program_knowledge_program   ON public.program_knowledge_articles USING btree (program_id);
CREATE INDEX idx_program_knowledge_published ON public.program_knowledge_articles USING btree (pka_is_published, pka_is_deleted);
CREATE INDEX idx_program_knowledge_search    ON public.program_knowledge_articles USING gin (pka_search);

-- Record number PKA-00001, assigned on insert when blank.
CREATE OR REPLACE FUNCTION public.trg_program_knowledge_articles_rn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  next_num integer;
BEGIN
  IF NEW.pka_record_number IS NULL OR NEW.pka_record_number = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(pka_record_number, '\D', '', 'g'), '')::integer), 0) + 1
      INTO next_num
      FROM public.program_knowledge_articles;
    NEW.pka_record_number := 'PKA-' || lpad(next_num::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.trg_program_knowledge_articles_rn() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.trg_program_knowledge_articles_rn() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_program_knowledge_articles_rn() TO postgres;
GRANT EXECUTE ON FUNCTION public.trg_program_knowledge_articles_rn() TO service_role;

CREATE TRIGGER trg_program_knowledge_articles_rn BEFORE INSERT ON public.program_knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION trg_program_knowledge_articles_rn();
CREATE TRIGGER trg_audit_program_knowledge_articles AFTER INSERT OR DELETE OR UPDATE ON public.program_knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION log_audit_and_field_history();
CREATE TRIGGER trg_program_knowledge_articles_no_hard_delete BEFORE DELETE ON public.program_knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION block_hard_delete();

-- RLS: read = internal staff only; write = Admin only.
ALTER TABLE public.program_knowledge_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_select_program_knowledge_articles ON public.program_knowledge_articles
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    COALESCE(
      public.app_current_role_name() NOT IN ('Property Owner','Property Manager','Service Provider Partner'),
      false
    )
  );

CREATE POLICY app_insert_program_knowledge_articles ON public.program_knowledge_articles
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.app_is_admin());

CREATE POLICY app_update_program_knowledge_articles ON public.program_knowledge_articles
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

CREATE POLICY app_delete_program_knowledge_articles ON public.program_knowledge_articles
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (public.app_is_admin());

-- Table grants — authenticated (RLS gates the rest); NOT anon (non-public data).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.program_knowledge_articles TO authenticated;
GRANT ALL ON TABLE public.program_knowledge_articles TO postgres;
GRANT ALL ON TABLE public.program_knowledge_articles TO service_role;

-- ─── Assistant retrieval RPC ────────────────────────────────────────────────
-- Ranked full-text search over published program knowledge, optionally scoped
-- to a program matched by name/short_name/description. Internal-only: portal
-- (external) callers get nothing back. Returns the note body so the assistant
-- can answer from it, tagged with the program it belongs to.
CREATE OR REPLACE FUNCTION public.search_program_knowledge(p_program_query text DEFAULT NULL, p_query text DEFAULT NULL, p_limit integer DEFAULT 5)
 RETURNS TABLE(pka_record_number text, program_name text, program_short_name text, program_state text, pka_title text, pka_category text, pka_body_markdown text, match_rank real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role      text := public.app_current_role_name();
  v_has_query boolean := (p_query IS NOT NULL AND length(trim(p_query)) > 0);
  v_has_prog  boolean := (p_program_query IS NOT NULL AND length(trim(p_program_query)) > 0);
  v_tsquery   tsquery;
  v_limit     integer := GREATEST(1, LEAST(coalesce(p_limit, 5), 10));
BEGIN
  -- Internal staff only. Unresolved role or a portal/external role → nothing.
  IF v_role IS NULL OR v_role IN ('Property Owner','Property Manager','Service Provider Partner') THEN
    RETURN;
  END IF;

  IF v_has_query THEN
    v_tsquery := websearch_to_tsquery('english', p_query);
  END IF;

  RETURN QUERY
  SELECT
    k.pka_record_number, p.name, p.short_name, p.state,
    k.pka_title, k.pka_category, k.pka_body_markdown,
    CASE WHEN v_has_query THEN ts_rank(k.pka_search, v_tsquery) ELSE 0::real END
  FROM public.program_knowledge_articles k
  JOIN public.programs p ON p.id = k.program_id
  WHERE k.pka_is_deleted = false
    AND k.pka_is_published = true
    AND p.is_deleted = false
    AND (NOT v_has_prog OR (
           p.name ILIKE '%' || p_program_query || '%'
        OR COALESCE(p.short_name, '')  ILIKE '%' || p_program_query || '%'
        OR COALESCE(p.description, '') ILIKE '%' || p_program_query || '%'
    ))
    AND (NOT v_has_query OR k.pka_search @@ v_tsquery)
  ORDER BY
    CASE WHEN v_has_query THEN ts_rank(k.pka_search, v_tsquery) ELSE 0::real END DESC,
    p.name ASC, k.pka_title ASC
  LIMIT v_limit;
END;
$function$
;

REVOKE ALL ON FUNCTION public.search_program_knowledge(p_program_query text, p_query text, p_limit integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.search_program_knowledge(p_program_query text, p_query text, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_program_knowledge(p_program_query text, p_query text, p_limit integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.search_program_knowledge(p_program_query text, p_query text, p_limit integer) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Help article (record number auto-assigned).
INSERT INTO public.help_articles (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published)
VALUES ('', 'program-knowledge-base', 'Program Knowledge Base — ask LEAP about a specific program',
  'A per-program internal knowledge store the LEAP Assistant reads, so anyone can ask how a program works. Admins curate it; everyone else can read and ask.',
$md$
## What it is

The **Program Knowledge Base** is a per-program store of internal notes about how
a specific program actually runs — rates, eligibility rules, process changes,
and the one-off exceptions that come up as programs change on the fly. It's the
place to keep the non-public knowledge that isn't in a public program guide.

Each note is attached to one **Program** record and the **LEAP Assistant reads
it**, so any internal user can ask the assistant a plain-English question about
a program and get an answer grounded in these notes — e.g. *"How does the
WI-IRA-MF-HOMES program handle the audit invoice this year?"*

## Who can do what

- **Only system Admins can add, edit, or delete** program knowledge. This is
  enforced in the database, not just the screen — no one else can change it,
  so the knowledge base can't be filled with erroneous entries.
- **All internal staff can read it and ask the assistant about it.** Portal
  (owner/partner) users cannot see it — program knowledge stays internal.
- Deletes are soft-deletes (recycle bin) and everything is audited.

## Adding knowledge (Admins)

Setup → **Business Configuration → Program Knowledge**. Click **New**, pick the
program, give the note a title, and write the body in Markdown. Set it to
**Published** when it's ready — the assistant only reads published notes, so a
half-written draft stays private until you publish it. Add as many notes per
program as you like (group them with the Category field, e.g. *Rates*,
*Eligibility*, *Process Changes*, *Exceptions*).

## Asking about a program

Open the assistant and ask naturally — name the program and what you want to
know. It searches that program's knowledge and answers from it, citing the note.
If there's no note covering the question, it will say so rather than guess.
$md$,
  'AI Assistant', 'internal', true);
