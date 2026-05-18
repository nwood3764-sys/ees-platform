-- ─── DFR resolution stamping trigger ─────────────────────────────────
-- Auto-stamps dfr_resolved_at + dfr_resolved_by when the dfr_status
-- transitions to Resolved or Closed; clears them on transitions back
-- to Open or In Progress.
--
-- This keeps the resolution timestamps consistent regardless of which
-- update path the dispatcher uses:
--   • Queue's Close button → updateDfrStatus() in dispatcherFollowups.js
--     (already stamps explicitly; the trigger is idempotent for this path)
--   • Record-detail page → FieldGroup editor writes dfr_status raw
--     (previously left resolved_at/by NULL — bug)
--   • Direct SQL → trigger ensures correctness
--
-- We use current_app_user_id() to resolve auth.uid() → public.users.id.
-- If the caller doesn't have an auth session (service role / pg_cron /
-- direct SQL), current_app_user_id() returns NULL and we only stamp
-- the timestamp.

create or replace function public.trg_dfr_stamp_resolution()
returns trigger
language plpgsql
as $$
declare
  v_old_value text;
  v_new_value text;
begin
  if OLD.dfr_status is distinct from NEW.dfr_status then
    select picklist_value into v_old_value
    from picklist_values where id = OLD.dfr_status;
    select picklist_value into v_new_value
    from picklist_values where id = NEW.dfr_status;

    if v_new_value in ('Resolved', 'Closed') then
      -- Only stamp if the caller didn't explicitly set them. Lets the
      -- data service write its own values (e.g. backfill scripts that
      -- want to preserve historical timestamps).
      if NEW.dfr_resolved_at is null or NEW.dfr_resolved_at = OLD.dfr_resolved_at then
        NEW.dfr_resolved_at := now();
      end if;
      if NEW.dfr_resolved_by is null or NEW.dfr_resolved_by = OLD.dfr_resolved_by then
        begin
          NEW.dfr_resolved_by := current_app_user_id();
        exception when others then
          NEW.dfr_resolved_by := null;
        end;
      end if;
    elsif v_new_value in ('Open', 'In Progress') then
      -- Flipping back to active wipes the resolution fields so the
      -- queue UI sees a clean slate.
      NEW.dfr_resolved_at := null;
      NEW.dfr_resolved_by := null;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_dfr_stamp_resolution on public.dispatcher_followup_requests;
create trigger trg_dfr_stamp_resolution
  before update on public.dispatcher_followup_requests
  for each row execute function public.trg_dfr_stamp_resolution();
