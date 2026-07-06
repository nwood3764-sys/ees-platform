-- =====================================================================
-- Attachment virus-scan layer (v1)
--
-- Microsoft Exchange Online Protection already scans every message that
-- transits the shared mailboxes; message_attachments rows nevertheless sat
-- at ma_virus_scan_status='pending' forever because LEAP recorded no
-- verdict of its own on the stored copy. The scan-message-attachments edge
-- function now runs deterministic policy checks (EICAR, executable magic
-- bytes, dangerous extensions, content-type spoofing) and writes a verdict.
-- This migration adds the verdict metadata columns, the 'blocked' status,
-- and the pg_cron schedule that drives the scanner.
-- =====================================================================

-- --- Verdict metadata ---------------------------------------------------
ALTER TABLE public.message_attachments
  ADD COLUMN IF NOT EXISTS ma_virus_scan_engine text,
  ADD COLUMN IF NOT EXISTS ma_virus_scan_detail text;

-- --- 'blocked' status (policy-tripped, distinct from AV 'infected') ------
ALTER TABLE public.message_attachments
  DROP CONSTRAINT IF EXISTS message_attachments_ma_virus_scan_status_check;
ALTER TABLE public.message_attachments
  ADD CONSTRAINT message_attachments_ma_virus_scan_status_check
  CHECK (ma_virus_scan_status = ANY (ARRAY[
    'pending'::text, 'clean'::text, 'infected'::text, 'blocked'::text, 'scan_failed'::text
  ]));

-- --- Cron ---------------------------------------------------------------
-- The 5-minute pg_cron job (scan-message-attachments-every-5min) that
-- drives the scanner is production-only configuration, created directly in
-- prod alongside renew-graph-subscriptions-every-6h. It is deliberately NOT
-- in this migration: the job command embeds the production functions URL
-- and the shared pipeline secret, neither of which belongs in the repo or
-- on sandbox branch databases. Pattern:
--
--   SELECT cron.schedule('scan-message-attachments-every-5min', '*/5 * * * *',
--     $$ SELECT net.http_post(
--          url     := '<prod functions url>/scan-message-attachments',
--          headers := jsonb_build_object('Content-Type','application/json',
--                                        'x-graph-renewal-secret','<shared pipeline secret>'),
--          body    := '{}'::jsonb, timeout_milliseconds := 120000) $$);
