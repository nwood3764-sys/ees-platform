-- PRG Phase 3 — link generated project reports back to the template
-- (and snapshot, when applicable) that produced them. Both columns are
-- nullable: most documents are not project reports, so they hold NULL.
-- When a project_report is regenerated from a frozen snapshot, both FKs
-- are populated; when it's generated against the live template, only
-- project_report_template_id is populated.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS project_report_template_id uuid NULL,
  ADD COLUMN IF NOT EXISTS project_report_template_snapshot_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'documents_project_report_template_id_fkey'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_project_report_template_id_fkey
      FOREIGN KEY (project_report_template_id)
      REFERENCES public.project_report_templates(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'documents_project_report_template_snapshot_id_fkey'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_project_report_template_snapshot_id_fkey
      FOREIGN KEY (project_report_template_snapshot_id)
      REFERENCES public.project_report_template_snapshots(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS documents_prt_id_idx
  ON public.documents (project_report_template_id)
  WHERE project_report_template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS documents_prtsn_id_idx
  ON public.documents (project_report_template_snapshot_id)
  WHERE project_report_template_snapshot_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'documents_prtsn_implies_prt_chk'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_prtsn_implies_prt_chk
      CHECK (
        project_report_template_snapshot_id IS NULL
        OR project_report_template_id IS NOT NULL
      );
  END IF;
END $$;
