-- bulk_import_runs — audit log of every property-hierarchy import that gets
-- committed. One row per successful import; tracks who, when, source filename,
-- the row-by-row resolution decisions, and the IDs of every record created.
-- Survives the seed_data purge so the import history is preserved across
-- go-live.

CREATE TABLE IF NOT EXISTS public.bulk_import_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bir_record_number        text NOT NULL DEFAULT '',
  bir_import_type          text NOT NULL,
  bir_source_filename      text,
  bir_row_count            integer NOT NULL DEFAULT 0,
  bir_accounts_created     integer NOT NULL DEFAULT 0,
  bir_properties_created   integer NOT NULL DEFAULT 0,
  bir_buildings_created    integer NOT NULL DEFAULT 0,
  bir_units_created        integer NOT NULL DEFAULT 0,
  bir_decisions_json       jsonb NOT NULL DEFAULT '[]'::jsonb,
  bir_created_record_ids   jsonb NOT NULL DEFAULT '{}'::jsonb,
  bir_owner                uuid NOT NULL,
  bir_created_by           uuid NOT NULL,
  bir_created_at           timestamptz NOT NULL DEFAULT now(),
  bir_updated_by           uuid,
  bir_updated_at           timestamptz NOT NULL DEFAULT now(),
  bir_is_deleted           boolean NOT NULL DEFAULT false,
  bir_deleted_at           timestamptz,
  bir_deleted_by           uuid,
  bir_deletion_reason      text
);

CREATE INDEX IF NOT EXISTS idx_bulk_import_runs_created_at
  ON public.bulk_import_runs (bir_created_at DESC)
  WHERE NOT bir_is_deleted;

CREATE INDEX IF NOT EXISTS idx_bulk_import_runs_owner
  ON public.bulk_import_runs (bir_owner, bir_created_at DESC)
  WHERE NOT bir_is_deleted;

ALTER TABLE public.bulk_import_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bir_select ON public.bulk_import_runs;
CREATE POLICY bir_select ON public.bulk_import_runs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS bir_insert ON public.bulk_import_runs;
CREATE POLICY bir_insert ON public.bulk_import_runs FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS bir_update ON public.bulk_import_runs;
CREATE POLICY bir_update ON public.bulk_import_runs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Autonumber trigger
CREATE SEQUENCE IF NOT EXISTS public.seq_bulk_import_runs;

CREATE OR REPLACE FUNCTION public.set_bir_record_number()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.bir_record_number IS NULL OR NEW.bir_record_number = '' THEN
    NEW.bir_record_number := generate_record_number('BIR-', 'seq_bulk_import_runs');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bir_rn ON public.bulk_import_runs;
CREATE TRIGGER trg_bir_rn
  BEFORE INSERT ON public.bulk_import_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_bir_record_number();

COMMENT ON TABLE public.bulk_import_runs IS
  'Audit log of every committed bulk import. One row per successful import. Preserves who/when/what and the IDs of every created record so imports are reviewable and (eventually) reversible.';
