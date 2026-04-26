-- ─────────────────────────────────────────────────────────────────────────
-- project_report_template_snapshots (PRTSN)
--
-- Frozen copy of a PRT + its PRTS sections, captured at publish time.
-- Lets us reconstruct exactly what a template looked like when a particular
-- version was made Active, so historical reports can be audited or
-- regenerated against the original template content even after the live
-- template has been edited and re-published.
--
-- One row per (prt_id, prtsn_version) tuple. publish_project_report_template
-- writes a row here at the same instant it flips status to Active. Replaying
-- old reports later reads the JSON blobs rather than the live PRT/PRTS rows.
--
-- prtsn_template_json: a single jsonb object — the entire PRT row at the
-- moment of publish (no rewriting; uses to_jsonb on the row).
-- prtsn_sections_json: a jsonb array of PRTS rows, ordered by
-- prts_section_order ascending, with deleted sections excluded. Each element
-- is the full PRTS row (to_jsonb).
-- ─────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.seq_project_report_template_snapshots;

CREATE TABLE public.project_report_template_snapshots (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prtsn_record_number      text NOT NULL,
  prt_id                   uuid NOT NULL REFERENCES public.project_report_templates(id) ON DELETE RESTRICT,
  prtsn_version            integer NOT NULL,
  prtsn_template_json      jsonb NOT NULL,
  prtsn_sections_json      jsonb NOT NULL,
  prtsn_published_at       timestamptz NOT NULL DEFAULT now(),
  prtsn_published_by       uuid REFERENCES public.users(id),

  -- Standard audit columns (matching the rest of the schema)
  prtsn_owner              uuid REFERENCES public.users(id),
  prtsn_is_deleted         boolean NOT NULL DEFAULT false,
  prtsn_deleted_at         timestamptz,
  prtsn_deleted_by         uuid REFERENCES public.users(id),
  prtsn_deletion_reason    text,
  prtsn_created_by         uuid REFERENCES public.users(id),
  prtsn_created_at         timestamptz NOT NULL DEFAULT now(),
  prtsn_updated_by         uuid REFERENCES public.users(id),
  prtsn_updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prtsn_unique_template_version UNIQUE (prt_id, prtsn_version)
);

CREATE INDEX idx_prtsn_prt_id ON public.project_report_template_snapshots(prt_id);
CREATE INDEX idx_prtsn_published_at ON public.project_report_template_snapshots(prtsn_published_at);

-- Auto-numbering trigger (matches the pattern used by every other table)
CREATE OR REPLACE FUNCTION public.set_prtsn_record_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.prtsn_record_number := public.generate_record_number('PRTSN-', 'seq_project_report_template_snapshots');
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_prtsn_rn
  BEFORE INSERT ON public.project_report_template_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_prtsn_record_number();

-- Standard updated_at trigger
CREATE TRIGGER trg_prtsn_updated_at
  BEFORE UPDATE ON public.project_report_template_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS — match the rest of the PRT family. Snapshots are reference data;
-- everyone authenticated can read, internal staff can do anything (including
-- soft-delete if a snapshot was created in error). Snapshots are normally
-- written only by the publish RPC, never by hand.
ALTER TABLE public.project_report_template_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read ON public.project_report_template_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY internal_staff_prtsn ON public.project_report_template_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_report_template_snapshots TO authenticated;
GRANT USAGE ON SEQUENCE public.seq_project_report_template_snapshots TO authenticated;
