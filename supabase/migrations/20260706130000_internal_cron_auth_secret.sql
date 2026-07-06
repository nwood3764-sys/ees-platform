-- Shared secret so the pg_cron job can authenticate to
-- dispatch-scheduled-reports without embedding the service-role key.
--
-- The dispatcher runs reports with the service role (RLS-bypassing) and emails
-- their output to author-chosen recipients. Left unauthenticated, any caller
-- with the public anon key could POST {schedule_id} to force-send a schedule
-- and read data their own RLS forbids. The function now requires a secret sent
-- by the cron in the x-internal-cron-secret header. That secret lives here,
-- readable only by the service role (edge function) and postgres (pg_cron);
-- anon/authenticated are revoked.
--
-- Paired prod-only change (NOT in repo, like the other cron config): the
-- pg_cron job 'dispatch-scheduled-reports-every-15min' was re-registered via
-- cron.schedule() to send:
--   'x-internal-cron-secret', (select secret from public.internal_cron_auth where name='dispatch')
-- Deploy order: this table + cron re-register first (both live), then deploy
-- the gated dispatch-scheduled-reports function.

create table if not exists public.internal_cron_auth (
  name       text primary key,
  secret     text not null,
  created_at timestamptz not null default now()
);
alter table public.internal_cron_auth enable row level security;
revoke all on public.internal_cron_auth from anon, authenticated;

insert into public.internal_cron_auth (name, secret)
values ('dispatch', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

notify pgrst, 'reload schema';
