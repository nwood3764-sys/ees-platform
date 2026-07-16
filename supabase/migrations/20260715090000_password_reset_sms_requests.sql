-- =============================================================================
-- password_reset_sms_requests — audit + rate-limit log for the public
-- request-password-reset-sms edge function (phone-based "Forgot password?").
--
-- Infrastructure table (same class as internal_cron_auth), not a business
-- object: no record numbers, no soft-delete lifecycle, no owner. Every
-- request to the public endpoint is logged here — including throttled ones —
-- and the edge function counts recent rows per phone / per client IP to
-- enforce its rate limits (3 per phone per 15 min, 10 per IP per hour).
--
-- Access: service role only. The endpoint is unauthenticated by design, so
-- this table must never be readable by anon/authenticated — it holds phone
-- numbers and request patterns.
-- =============================================================================

CREATE TABLE public.password_reset_sms_requests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prsr_phone          text        NOT NULL CHECK (prsr_phone ~ '^\d{10}$'),
  prsr_client_ip      text,
  prsr_was_throttled  boolean     NOT NULL DEFAULT false,
  prsr_user_found     boolean     NOT NULL DEFAULT false,
  prsr_sms_dispatched boolean     NOT NULL DEFAULT false,
  prsr_created_at     timestamptz NOT NULL DEFAULT now()
);

-- The two lookups the rate limiter runs on every request.
CREATE INDEX idx_prsr_phone_created ON public.password_reset_sms_requests (prsr_phone, prsr_created_at);
CREATE INDEX idx_prsr_ip_created    ON public.password_reset_sms_requests (prsr_client_ip, prsr_created_at);

ALTER TABLE public.password_reset_sms_requests ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: with RLS enabled and zero policies, only the
-- service role (which bypasses RLS) can touch the table.
REVOKE ALL ON public.password_reset_sms_requests FROM anon, authenticated, PUBLIC;
