-- ═══════════════════════════════════════════════════════════════════════════
-- Inbound email health: what the table SAYS must be what Graph and the mail
-- itself SHOW. Nothing asserts "active" on evidence it does not hold.
--
-- WHY (2026-09-05). Nicholas asked to activate the remaining state mailboxes.
-- Auditing first found that LEAP cannot tell anybody whether inbound email is
-- working for the mailboxes it ALREADY has, so activating four more would
-- repeat the same blindness four more times.
--
-- What was actually true on production before this migration:
--
--   * Inbound email WORKS. 643 messages have been captured across three
--     mailboxes since 2026-07-05 and were still arriving this morning.
--   * graph_subscriptions was written ONCE, at creation, and never again.
--     All three rows read gs_status = 'active' with gs_expiration
--     2026-07-08 — two months in the past — because renew-graph-subscriptions
--     renews at Microsoft and never writes the result back. The renewal RUNS
--     are logged (437 of them, the most recent minutes ago, renewing one
--     subscription successfully); the SUBSCRIPTIONS are not.
--   * So the row would read exactly the same if the subscription had been
--     deleted at Microsoft in July. A status that cannot change is not a
--     status. THAT is the blind spot, and it is the whole of it: the mail
--     itself was fine.
--   * Nothing in the client reads graph_subscriptions at all — no screen, no
--     report — so there was no surface where the staleness could be noticed.
--   * unmatched_inbox did not record WHICH mailbox a message arrived in. The
--     webhook parses it out of the subscription resource and then throws it
--     away, so the 643 captured messages could not be counted per mailbox and
--     could not be used as evidence that a mailbox is receiving.
--
-- Three artifacts, each built for one purpose:
--
--   reconcile_graph_subscriptions(jsonb)  — the renewal job hands over what
--     Graph actually returned; this writes it down, including the absences.
--   graph_subscription_health()           — one row per mailbox, verdict
--     derived from evidence, never from a stored status string.
--   unmatched_inbox.ui_mailbox            — which mailbox a message came in on.
--
-- THE FAILURE DIRECTION IS ALWAYS "UNVERIFIED", NEVER "HEALTHY". A subscription
-- that has not been confirmed by a renewal run inside the confirmation window
-- reads as unverified even though it may be perfectly alive — which is what
-- the three live rows read the moment this lands, and what they stop reading
-- the first time the cron runs. Claiming health on no evidence is the defect
-- being fixed; it must not be reintroduced by a friendlier default.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. What Graph last told us, and when ────────────────────────────────────
alter table public.graph_subscriptions
  add column if not exists gs_last_seen_at    timestamptz,
  add column if not exists gs_last_renewed_at timestamptz,
  add column if not exists gs_notification_url text;

comment on column public.graph_subscriptions.gs_last_seen_at is
  'When a renewal run last saw this subscription in Microsoft Graph''s own list. '
  'NULL, or older than the confirmation window, means the row is UNVERIFIED — '
  'it describes what LEAP believed, not what Graph currently holds.';
comment on column public.graph_subscriptions.gs_last_renewed_at is
  'When a renewal run last successfully extended this subscription''s expiry.';
comment on column public.graph_subscriptions.gs_notification_url is
  'Where Graph posts notifications for this subscription. A subscription '
  'pointing at some other endpoint is not delivering mail into LEAP.';

-- A subscription Graph no longer returns is gone. 'missing' is the word for it.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.graph_subscriptions'::regclass
      and conname = 'graph_subscriptions_gs_status_check'
  ) then
    alter table public.graph_subscriptions drop constraint graph_subscriptions_gs_status_check;
  end if;
end $$;

alter table public.graph_subscriptions
  add constraint graph_subscriptions_gs_status_check
  check (gs_status in ('active', 'missing', 'error'));

-- ── 2. Which mailbox an unmatched message arrived in ────────────────────────
alter table public.unmatched_inbox
  add column if not exists ui_mailbox text;

comment on column public.unmatched_inbox.ui_mailbox is
  'The shared mailbox this message arrived in, taken from the Graph '
  'subscription resource. NOT derivable from ui_to_address: a message that '
  'reached the box on Cc or Bcc names the box nowhere in To.';

create index if not exists unmatched_inbox_mailbox_received_idx
  on public.unmatched_inbox (lower(ui_mailbox), ui_received_at desc)
  where ui_is_deleted is not true;

-- Backfill what can be told, and only what can be told. The raw Graph payload
-- carries To and Cc; a mailbox that appears in neither (Bcc, or a forward into
-- the box) cannot be recovered and is left NULL rather than guessed.
update public.unmatched_inbox u
set ui_mailbox = m.mb
from (
  select u2.id,
         (select g.gs_mailbox
            from public.graph_subscriptions g
           where lower(
                   coalesce((select string_agg(r->'emailAddress'->>'address', ',')
                               from jsonb_array_elements(coalesce(u2.ui_raw_payload->'toRecipients', '[]'::jsonb)) r), '')
                   || ',' ||
                   coalesce((select string_agg(r->'emailAddress'->>'address', ',')
                               from jsonb_array_elements(coalesce(u2.ui_raw_payload->'ccRecipients', '[]'::jsonb)) r), '')
                 ) like '%' || lower(g.gs_mailbox) || '%'
           limit 1) as mb
    from public.unmatched_inbox u2
   where u2.ui_is_deleted is not true
     and u2.ui_mailbox is null
) m
where m.id = u.id and m.mb is not null;

-- ── 3. reconcile_graph_subscriptions ────────────────────────────────────────
-- The renewal job already enumerates every subscription the Azure app owns.
-- It hands that list here verbatim; this is the ONLY thing that writes
-- graph_subscriptions after creation, so the table cannot drift again.
--
-- Absence is the important half. A row whose subscription id is not in the
-- payload is not merely un-refreshed — Graph does not have it, so no mail is
-- being delivered for it, and it is marked 'missing' by name.
create or replace function public.reconcile_graph_subscriptions(p_live jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seen         text[] := '{}';
  v_item         jsonb;
  v_id           text;
  v_resource     text;
  v_mailbox      text;
  v_expiration   timestamptz;
  v_notify       text;
  v_now          timestamptz := now();
  v_upserted     int := 0;
  v_marked       int := 0;
  v_missing      text[] := '{}';
begin
  if p_live is null or jsonb_typeof(p_live) <> 'array' then
    raise exception 'reconcile_graph_subscriptions: p_live must be a JSON array of Graph subscriptions, got %',
      coalesce(jsonb_typeof(p_live), 'null')
      using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_live)
  loop
    v_id       := nullif(v_item->>'id', '');
    v_resource := coalesce(v_item->>'resource', '');
    v_notify   := nullif(v_item->>'notificationUrl', '');

    if v_id is null then
      raise exception 'reconcile_graph_subscriptions: a subscription in the payload has no id'
        using errcode = '22023';
    end if;

    -- /users/<mailbox>/mailFolders('inbox')/messages
    v_mailbox := substring(v_resource from 'users/([^/]+)');
    v_mailbox := coalesce(nullif(v_mailbox, ''), '(unknown mailbox)');

    begin
      v_expiration := (v_item->>'expirationDateTime')::timestamptz;
    exception when others then
      v_expiration := null;
    end;

    v_seen := v_seen || v_id;

    update public.graph_subscriptions
       set gs_mailbox          = v_mailbox,
           gs_resource         = v_resource,
           gs_expiration       = coalesce(v_expiration, gs_expiration),
           gs_notification_url = coalesce(v_notify, gs_notification_url),
           gs_status           = 'active',
           gs_error            = null,
           gs_last_seen_at     = v_now,
           gs_last_renewed_at  = case
                                   when v_expiration is not null
                                    and (gs_expiration is null or v_expiration > gs_expiration)
                                   then v_now else gs_last_renewed_at
                                 end,
           gs_updated_at       = v_now
     where gs_subscription_id = v_id;

    if not found then
      insert into public.graph_subscriptions
        (gs_mailbox, gs_subscription_id, gs_resource, gs_expiration,
         gs_notification_url, gs_status, gs_last_seen_at, gs_last_renewed_at,
         gs_created_at, gs_updated_at)
      values
        (v_mailbox, v_id, v_resource, v_expiration,
         v_notify, 'active', v_now, v_now, v_now, v_now);
    end if;

    v_upserted := v_upserted + 1;
  end loop;

  -- Everything Graph did not return. This is the state the old code could
  -- never reach and the reason a dead subscription read as healthy.
  update public.graph_subscriptions
     set gs_status     = 'missing',
         gs_error      = 'Microsoft Graph did not return this subscription on '
                         || to_char(v_now at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC. '
                         || 'It no longer exists, so no mail is being delivered for this mailbox. '
                         || 'Recreate it with create-graph-subscriptions.',
         gs_updated_at = v_now
   where gs_subscription_id <> all (v_seen)
     and gs_status is distinct from 'missing';
  get diagnostics v_marked = row_count;

  select coalesce(array_agg(gs_mailbox order by gs_mailbox), '{}')
    into v_missing
    from public.graph_subscriptions
   where gs_status = 'missing';

  return jsonb_build_object(
    'reconciled_at',      v_now,
    'live_subscriptions', v_upserted,
    'newly_missing',      v_marked,
    'missing_mailboxes',  to_jsonb(v_missing)
  );
end;
$$;

revoke all on function public.reconcile_graph_subscriptions(jsonb) from public, anon, authenticated;

comment on function public.reconcile_graph_subscriptions(jsonb) is
  'Records what Microsoft Graph actually returned, INCLUDING what it did not: '
  'a stored subscription absent from the payload is marked missing by name. '
  'Called by renew-graph-subscriptions with the service-role key; it is the '
  'only writer of graph_subscriptions after creation.';

-- ── 4. graph_subscription_health ────────────────────────────────────────────
-- One row per mailbox LEAP expects to receive on, plus any subscription for a
-- mailbox that is not configured. The verdict is DERIVED from evidence on
-- every call — the confirmation window, the expiry, and whether mail has
-- actually landed — never read out of gs_status alone, because a stored
-- status string is exactly what went stale for two months.
create or replace function public.graph_subscription_health()
returns table (
  mailbox              text,
  mailbox_state        text,
  mailbox_purpose      text,
  mailbox_is_active    boolean,
  subscription_id      text,
  expires_at           timestamptz,
  last_confirmed_at    timestamptz,
  last_inbound_at      timestamptz,
  inbound_last_30_days bigint,
  verdict              text,
  detail               text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with window_h as (select 12::int as hours),
  boxes as (
    select m.obm_address    as mailbox,
           m.obm_state      as mailbox_state,
           m.obm_purpose    as mailbox_purpose,
           m.obm_is_active  as mailbox_is_active
      from public.outbound_mailboxes m
     where m.obm_is_deleted is not true
    union
    -- A subscription for a mailbox nobody configured still receives mail and
    -- must not be invisible.
    select g.gs_mailbox, null, null, null
      from public.graph_subscriptions g
     where not exists (
       select 1 from public.outbound_mailboxes m2
        where m2.obm_is_deleted is not true
          and lower(m2.obm_address) = lower(g.gs_mailbox))
  ),
  subs as (
    select distinct on (lower(g.gs_mailbox))
           lower(g.gs_mailbox) as mb, g.*
      from public.graph_subscriptions g
     order by lower(g.gs_mailbox),
              (g.gs_status = 'active') desc,
              g.gs_expiration desc nulls last
  ),
  inbound as (
    select lower(u.ui_mailbox) as mb,
           max(u.ui_received_at) as last_at,
           count(*) filter (where u.ui_received_at > now() - interval '30 days') as n30
      from public.unmatched_inbox u
     where u.ui_is_deleted is not true and u.ui_mailbox is not null
     group by 1
    union all
    select lower(c.conv_our_address),
           max(m.msg_created_at),
           count(*) filter (where m.msg_created_at > now() - interval '30 days')
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.msg_is_deleted is not true
       and m.msg_direction = 'inbound'
       and m.msg_channel = 'email'
       and c.conv_our_address is not null
     group by 1
  ),
  inbound_rolled as (
    select mb, max(last_at) as last_at, sum(n30) as n30 from inbound group by mb
  )
  select
    b.mailbox,
    b.mailbox_state,
    b.mailbox_purpose,
    b.mailbox_is_active,
    s.gs_subscription_id,
    s.gs_expiration,
    s.gs_last_seen_at,
    i.last_at,
    coalesce(i.n30, 0),
    case
      when b.mailbox_is_active is not true and s.gs_subscription_id is null
        then 'Not set up'
      when s.gs_subscription_id is null
        then 'Not receiving'
      when s.gs_status = 'missing'
        then 'Not receiving'
      when s.gs_last_seen_at is null
        or s.gs_last_seen_at < now() - make_interval(hours => (select hours from window_h))
        then 'Unverified'
      when s.gs_expiration is null or s.gs_expiration <= now()
        then 'Not receiving'
      else 'Receiving'
    end,
    case
      when b.mailbox_is_active is not true and s.gs_subscription_id is null
        then 'This mailbox is switched off in LEAP and has no Graph subscription. '
             || 'Nothing is sent from it and nothing arrives into it.'
      when s.gs_subscription_id is null
        then 'This mailbox is active in LEAP but has no Graph subscription, so mail '
             || 'sent to it never reaches LEAP. Run create-graph-subscriptions for it.'
      when s.gs_status = 'missing'
        then coalesce(s.gs_error, 'Microsoft Graph no longer holds this subscription.')
      when s.gs_last_seen_at is null
        then 'The renewal job has never confirmed this subscription against Microsoft. '
             || 'It may well be alive — LEAP simply has no evidence either way. '
             || 'The next renewal run will say.'
      when s.gs_last_seen_at < now() - make_interval(hours => (select hours from window_h))
        then 'Microsoft last confirmed this subscription on '
             || to_char(s.gs_last_seen_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC, '
             || 'more than ' || (select hours from window_h) || ' hours ago. The renewal job '
             || 'runs every 6 hours, so it is not running or not reaching Graph.'
      when s.gs_expiration is null or s.gs_expiration <= now()
        then 'The subscription expired on '
             || to_char(s.gs_expiration at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
             || ' UTC and has not been renewed.'
      else 'Confirmed against Microsoft on '
           || to_char(s.gs_last_seen_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
           || ' UTC, valid until '
           || to_char(s.gs_expiration at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.'
    end
  from boxes b
  left join subs s on s.mb = lower(b.mailbox)
  left join inbound_rolled i on i.mb = lower(b.mailbox)
  order by
    case when b.mailbox_is_active then 0 else 1 end,
    b.mailbox_state nulls last,
    b.mailbox;
$$;

comment on function public.graph_subscription_health() is
  'Whether each mailbox is actually receiving into LEAP. The verdict is '
  'derived on every call from the confirmation timestamp, the expiry and the '
  'mail that has landed — never from gs_status alone, because a stored status '
  'string is what silently went stale for two months. A subscription not '
  'confirmed within the window reads Unverified, never Receiving.';

grant execute on function public.graph_subscription_health() to authenticated;

notify pgrst, 'reload schema';

-- ── 5. Assert what this migration claims ────────────────────────────────────
-- The behavioural proof of reconcile_graph_subscriptions is run separately in
-- a rolled-back transaction: block_hard_delete() refuses the cleanup a probe
-- would need, so a probe inside a migration takes the whole migration down
-- with it. What is asserted here is what a silent revert would break.
do $$
declare
  v_rows       int;
  v_backfilled int;
  v_unknown    int;
  v_verdicts   text;
begin
  -- The columns the reconcile writes into must exist.
  select count(*) into v_rows
    from information_schema.columns
   where table_schema = 'public' and table_name = 'graph_subscriptions'
     and column_name in ('gs_last_seen_at', 'gs_last_renewed_at', 'gs_notification_url');
  if v_rows <> 3 then
    raise exception 'graph_subscriptions is missing the confirmation columns (found % of 3)', v_rows;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'unmatched_inbox' and column_name = 'ui_mailbox'
  ) then
    raise exception 'unmatched_inbox.ui_mailbox was not added';
  end if;

  -- The backfill must have attributed the bulk of the captured mail, and must
  -- have left the genuinely unknowable rows alone rather than guessing.
  select count(*) filter (where ui_mailbox is not null),
         count(*) filter (where ui_mailbox is null)
    into v_backfilled, v_unknown
    from public.unmatched_inbox where ui_is_deleted is not true;
  if v_backfilled = 0 then
    raise exception 'ui_mailbox backfill attributed nothing; the derivation is wrong';
  end if;
  raise notice 'ui_mailbox: % attributed, % could not be told (Bcc or forwarded in)',
    v_backfilled, v_unknown;

  -- Every configured mailbox must appear in the health answer, or a mailbox
  -- can be silently absent from the one screen that reports on it.
  select count(*) into v_rows from public.graph_subscription_health();
  if v_rows < (select count(*) from public.outbound_mailboxes where obm_is_deleted is not true) then
    raise exception 'graph_subscription_health() returned % rows for % configured mailboxes',
      v_rows, (select count(*) from public.outbound_mailboxes where obm_is_deleted is not true);
  end if;

  -- THE CONTROL. The three live subscriptions have never been confirmed by a
  -- renewal run, so they must read Unverified — NOT Receiving. If a future
  -- change makes an unconfirmed subscription read as healthy, this fails.
  if exists (
    select 1 from public.graph_subscription_health()
     where last_confirmed_at is null and verdict = 'Receiving'
  ) then
    raise exception 'a subscription with no confirmation from Microsoft reported Receiving; '
                    'the failure direction must be Unverified';
  end if;

  select string_agg(mailbox || ' = ' || verdict, '; ' order by mailbox)
    into v_verdicts from public.graph_subscription_health();
  raise notice 'inbound email health: %', v_verdicts;
end $$;
