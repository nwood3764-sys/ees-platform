-- ---------------------------------------------------------------------------
-- Photos anchored on a work step must always carry work_step_id
--
-- `photos` records its parent twice: polymorphically (related_object +
-- related_id) and, for evidence, through the real FK `work_step_id`. Every
-- consumer that rolls photos UP to the work order walks the FK — the work
-- order photo gallery (listWorkOrderPhotos), the project report generator,
-- and the trigger that flips a work order to In Progress on first evidence
-- (trg_photos_start_wo, which is gated on work_step_id IS NOT NULL).
--
-- The Photos card on a WORK STEP's own record page uploaded with
-- related_object='work_steps' + related_id=<step id> but left work_step_id
-- NULL, so those photos existed on the step and were invisible to every
-- rollup: 113 live rows, 73 of them on WO-00204's assessment steps, and none
-- of them ever started their work order.
--
-- The client is fixed to pass the step id, but the invariant belongs in the
-- database so it holds for every writer — edge functions, imports, and any
-- future surface. A BEFORE trigger derives the FK from the polymorphic
-- anchor whenever it is missing.
-- ---------------------------------------------------------------------------

create or replace function public.photos_sync_work_step_anchor()
returns trigger
language plpgsql
as $$
begin
  -- A photo anchored on a work step IS a work-step photo. Fill the FK from
  -- the polymorphic anchor so every rollup sees it. Never overwrites an
  -- explicitly supplied work_step_id.
  if new.related_object = 'work_steps'
     and new.work_step_id is null
     and new.related_id is not null then
    new.work_step_id := new.related_id;
  end if;
  return new;
end;
$$;

revoke all on function public.photos_sync_work_step_anchor() from public, anon, authenticated;

drop trigger if exists trg_photos_sync_work_step_anchor on public.photos;
create trigger trg_photos_sync_work_step_anchor
  before insert or update of related_object, related_id, work_step_id
  on public.photos
  for each row
  execute function public.photos_sync_work_step_anchor();

-- Backfill the rows that were written before the invariant existed. Only
-- rows whose related_id really is a work step are touched.
update public.photos p
   set work_step_id = p.related_id,
       updated_at   = now()
  from public.work_steps ws
 where p.related_object = 'work_steps'
   and p.work_step_id is null
   and p.related_id = ws.id;

-- Index the rollup's access path. The work order gallery reads every photo
-- for a set of step ids; without this it is a sequential scan that grows
-- with the whole photo library.
create index if not exists idx_photos_work_step_live
  on public.photos (work_step_id)
  where is_deleted = false;

create index if not exists idx_photos_related_live
  on public.photos (related_object, related_id)
  where is_deleted = false;
