-- ─────────────────────────────────────────────────────────────────────────
-- Assistant conversation memory
--
-- Purpose: give the global LEAP Assistant a persistent, per-user memory so it
-- does not start blank every day. Each user's assistant turns (their message,
-- the assistant's reply, and the system "created records" notes) are stored
-- here; on open, the panel reloads the recent window (default last 2 days) so
-- the conversation — and the assistant's context — carries across sessions and
-- days.
--
-- Security model mirrors the existing assistant RPCs (save_assistant_task,
-- resolve_adhoc_assistant_flow): the table has RLS enabled with NO broad
-- policies, so direct PostgREST access is denied. All reads/writes go through
-- two SECURITY DEFINER RPCs that resolve the caller via current_app_user_id()
-- and scope every row to that user. A user can only ever see or write their
-- own assistant history.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.assistant_conversation_messages (
  id           uuid primary key default gen_random_uuid(),
  acm_user_id  uuid not null references public.users(id),
  acm_role     text not null check (acm_role in ('user', 'assistant')),
  acm_content  text not null,
  acm_context  jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  acm_is_deleted boolean not null default false
);

comment on table public.assistant_conversation_messages is
  'Per-user persistent memory for the global LEAP Assistant. One row per turn (user message, assistant reply, or system note). Read/written only via save_assistant_message / load_assistant_messages (SECURITY DEFINER, owner-scoped).';

-- Load path: newest-first slice per user within a time window.
create index if not exists idx_acm_user_created
  on public.assistant_conversation_messages (acm_user_id, created_at desc)
  where acm_is_deleted = false;

-- Lock the table down. RLS on, no policies → direct access denied; the
-- SECURITY DEFINER RPCs below are the only way in.
alter table public.assistant_conversation_messages enable row level security;

-- ── save_assistant_message ────────────────────────────────────────────────
-- Persist one turn for the current user. Returns the new row id.
create or replace function public.save_assistant_message(
  p_role    text,
  p_content text,
  p_context jsonb default null
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_user uuid;
  v_id   uuid;
begin
  v_user := current_app_user_id();
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_role not in ('user', 'assistant') then
    raise exception 'Invalid role %', p_role;
  end if;
  if p_content is null or length(btrim(p_content)) = 0 then
    return null;  -- nothing to store
  end if;

  insert into public.assistant_conversation_messages
    (acm_user_id, acm_role, acm_content, acm_context)
  values
    (v_user, p_role, p_content, p_context)
  returning id into v_id;

  return v_id;
end; $function$;

-- ── load_assistant_messages ───────────────────────────────────────────────
-- Return the current user's recent assistant history (last p_days, most recent
-- p_limit rows) in chronological order for replay into the panel + the model.
create or replace function public.load_assistant_messages(
  p_days  int default 2,
  p_limit int default 60
) returns table (
  id         uuid,
  role       text,
  content    text,
  context    jsonb,
  created_at timestamptz
)
  language plpgsql
  stable
  security definer
  set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_user  uuid;
  v_days  int := greatest(coalesce(p_days, 2), 1);
  v_limit int := least(greatest(coalesce(p_limit, 60), 1), 200);
begin
  v_user := current_app_user_id();
  if v_user is null then raise exception 'Not authenticated'; end if;

  return query
  with recent as (
    select m.id, m.acm_role as role, m.acm_content as content,
           m.acm_context as context, m.created_at
    from public.assistant_conversation_messages m
    where m.acm_user_id = v_user
      and m.acm_is_deleted = false
      and m.created_at >= now() - make_interval(days => v_days)
    order by m.created_at desc
    limit v_limit
  )
  select recent.id, recent.role, recent.content, recent.context, recent.created_at
  from recent
  order by recent.created_at asc;
end; $function$;

-- Grants: functions are the only entry point; the table stays locked. Revoke
-- both PUBLIC and the anon default-privilege grant so only signed-in users can
-- reach their own memory (anon would be rejected at runtime anyway, since
-- current_app_user_id() is null, but least-privilege closes the door).
revoke all on function public.save_assistant_message(text, text, jsonb) from public;
revoke all on function public.load_assistant_messages(int, int) from public;
revoke execute on function public.save_assistant_message(text, text, jsonb) from anon;
revoke execute on function public.load_assistant_messages(int, int) from anon;
grant execute on function public.save_assistant_message(text, text, jsonb) to authenticated;
grant execute on function public.load_assistant_messages(int, int) to authenticated;

notify pgrst, 'reload schema';
