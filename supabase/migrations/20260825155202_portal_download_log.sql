-- =============================================================================
-- Every download a portal user takes, recorded.
--
-- Nicholas, 2026-08-25: "They can download stuff if we give them permission,
-- but we want a record if they download stuff."
--
-- Only DOWNLOADS are logged, not inline views: a single assessment page renders
-- dozens of photos, and a row per thumbnail would bury the thing this table
-- exists to show. The distinction is real — viewing streams a short-lived
-- watermarked URL, downloading hands over the original file.
--
-- Written only by the program-portal-file edge function, before it signs
-- anything. That is why file serving cannot be done client-side: a URL the
-- browser signs for itself cannot be logged.
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS public.seq_portal_download_log;

CREATE TABLE IF NOT EXISTS public.portal_download_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pdl_record_number     text NOT NULL,
  pdl_portal_user_id    uuid NOT NULL REFERENCES public.portal_users(id),
  pdl_account_id        uuid REFERENCES public.accounts(id),
  pdl_file_object       text NOT NULL,
  pdl_file_id           uuid NOT NULL,
  pdl_file_name         text,
  pdl_storage_bucket    text,
  pdl_storage_path      text,
  pdl_context_object    text,
  pdl_context_id        uuid,
  pdl_downloaded_at     timestamptz NOT NULL DEFAULT now(),
  pdl_is_deleted        boolean NOT NULL DEFAULT false,
  pdl_deleted_at        timestamptz,
  pdl_deleted_by        uuid REFERENCES public.users(id),
  pdl_created_at        timestamptz NOT NULL DEFAULT now(),
  pdl_updated_at        timestamptz NOT NULL DEFAULT now(),
  is_seed_data          boolean NOT NULL DEFAULT false,
  CONSTRAINT portal_download_log_object_check
    CHECK (pdl_file_object IN ('photos', 'documents'))
);

COMMENT ON TABLE public.portal_download_log IS
  'One row per file a portal user downloaded: who, which file, which record it was reached through, when. Written only by the program-portal-file edge function. Inline viewing is not logged — only taking a copy of the file.';

CREATE INDEX IF NOT EXISTS idx_pdl_portal_user ON public.portal_download_log (pdl_portal_user_id, pdl_downloaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdl_file ON public.portal_download_log (pdl_file_object, pdl_file_id);
CREATE INDEX IF NOT EXISTS idx_pdl_account ON public.portal_download_log (pdl_account_id, pdl_downloaded_at DESC);

CREATE OR REPLACE FUNCTION public.set_portal_download_log_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.pdl_record_number IS NULL OR NEW.pdl_record_number = '' THEN
    NEW.pdl_record_number := public.generate_record_number('PDL-', 'seq_portal_download_log');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pdl_record_number ON public.portal_download_log;
CREATE TRIGGER trg_pdl_record_number
  BEFORE INSERT ON public.portal_download_log
  FOR EACH ROW EXECUTE FUNCTION public.set_portal_download_log_number();

ALTER TABLE public.portal_download_log ENABLE ROW LEVEL SECURITY;

-- Internal staff read the log through the normal permission model. Nobody
-- writes it from a client — the edge function uses the service role.
DROP POLICY IF EXISTS app_select_pdl ON public.portal_download_log;
CREATE POLICY app_select_pdl ON public.portal_download_log
  FOR SELECT TO authenticated
  USING ((SELECT public.app_user_can('portal_download_log','read')));

NOTIFY pgrst, 'reload schema';
