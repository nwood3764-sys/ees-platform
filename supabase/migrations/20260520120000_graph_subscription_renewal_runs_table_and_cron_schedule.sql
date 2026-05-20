-- ─────────────────────────────────────────────────────────────────────
-- Graph subscription renewal observability + cron schedule.
--
-- The renew-graph-subscriptions edge function PATCHes every Graph
-- subscription nearing expiry every 6 hours. This migration:
--   1. Adds a small observability table that captures one row per cron
--      run (mode, attempted, succeeded, failed[], renewal window).
--   2. Schedules the edge function via pg_cron at 0 */6 * * * so a
--      missed run can be detected against the table.
--
-- The function is safe to call in mock mode (no Azure AD env vars):
--   it returns a no-op summary and the cron logs land cleanly. When the
--   Azure AD app registration finally lands, subscription renewal
--   becomes automatic — no code change at that point.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.graph_subscription_renewal_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gsrr_ran_at  timestamptz NOT NULL DEFAULT now(),
  gsrr_summary jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE  public.graph_subscription_renewal_runs IS
  'One row per renew-graph-subscriptions cron run. gsrr_summary captures the function''s response body — mode (mock|real), attempted, succeeded, failed[] with per-subscription errors, and the renewal_window_h that was used.';
COMMENT ON COLUMN public.graph_subscription_renewal_runs.gsrr_ran_at IS
  'Wall-clock time the renewal function completed its work (not when the cron fired).';
COMMENT ON COLUMN public.graph_subscription_renewal_runs.gsrr_summary IS
  'Verbatim JSON summary returned by renew-graph-subscriptions. Schema is intentionally untyped here — the function owns the shape.';

-- Most-recent-first index for the operability view that surfaces the
-- last N runs. Index pruning of old rows is left to a future cleanup
-- task; the table grows ~1460 rows/year at the 6-hour cadence.
CREATE INDEX IF NOT EXISTS idx_gsrr_ran_at_desc
  ON public.graph_subscription_renewal_runs (gsrr_ran_at DESC);

-- RLS: only admins read the renewal-runs table. The renewal function
-- writes via service role and bypasses RLS by definition.
ALTER TABLE public.graph_subscription_renewal_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gsrr_admin_read ON public.graph_subscription_renewal_runs;
CREATE POLICY gsrr_admin_read
  ON public.graph_subscription_renewal_runs
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- Schedule the cron job. 6-hour cadence vs the ~3-day subscription
-- lifetime gives a comfortable safety margin — three consecutive
-- failures still leave time to react. The job posts to the function
-- with the pre-shared key in a custom header so cron is authenticated
-- without a user JWT.
--
-- The vault secret 'graph_renewal_cron_secret' must be set out of band
-- (Supabase dashboard → Project Settings → Vault) to match the
-- GRAPH_RENEWAL_CRON_SECRET env var on the edge function. Until the
-- vault entry exists the header sends a literal sentinel value
-- '__pending_secret__' which the function rejects with 401 in real
-- mode and accepts in mock mode. So the cron lands gracefully even
-- before the secret is configured.
DO $cron$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    v_secret := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'graph_renewal_cron_secret' LIMIT 1);
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;
  IF v_secret IS NULL OR v_secret = '' THEN
    v_secret := '__pending_secret__';
  END IF;

  -- Unschedule a prior copy if one already exists, so this migration is
  -- re-runnable without duplicating jobs.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'renew-graph-subscriptions-every-6h') THEN
    PERFORM cron.unschedule('renew-graph-subscriptions-every-6h');
  END IF;

  PERFORM cron.schedule(
    'renew-graph-subscriptions-every-6h',
    '0 */6 * * *',
    format($job$
      SELECT net.http_post(
        url     := 'https://flyjigrijjjtcsvpgzvk.supabase.co/functions/v1/renew-graph-subscriptions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-graph-renewal-secret', %L
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 60000
      ) AS request_id;
    $job$, v_secret)
  );
END
$cron$;

-- Verify the cron job exists exactly once with the expected schedule.
DO $$
DECLARE n_jobs integer; v_schedule text;
BEGIN
  SELECT COUNT(*), MAX(schedule) INTO n_jobs, v_schedule
    FROM cron.job WHERE jobname = 'renew-graph-subscriptions-every-6h';
  IF n_jobs <> 1 THEN
    RAISE EXCEPTION 'renew-graph-subscriptions cron job count mismatch — expected 1, got %', n_jobs;
  END IF;
  IF v_schedule <> '0 */6 * * *' THEN
    RAISE EXCEPTION 'renew-graph-subscriptions cron schedule mismatch — expected "0 */6 * * *", got "%"', v_schedule;
  END IF;
END
$$;
