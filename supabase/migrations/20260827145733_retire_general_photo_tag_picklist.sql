-- ─────────────────────────────────────────────────────────────────────────────
-- Retire the generic photo-tag picklist.
--
-- Ten values were seeded on 2026-08-24 as a starting vocabulary for tagging
-- photos — Before, After, Damage or Deficiency, and so on. They were the wrong
-- idea (Nicholas, 2026-08-27: "There shouldn't be an options or a general tag
-- section. That is not a thing. It's only the tags for the work steps for that
-- work plan").
--
-- A photo on a job documents part of THAT job. The vocabulary belongs to the
-- work plan — its work steps and the named shots each asks for — and a generic
-- list sitting alongside only competes with the real one. The picker no longer
-- reads this picklist at all, so leaving the rows active would leave a
-- configuration surface that governs nothing.
--
-- Inactive, not deleted: LEAP soft-retires, and the labels are still resolved
-- for any photo already carrying one of these values so its tag keeps reading
-- properly instead of turning into a raw string.
-- ─────────────────────────────────────────────────────────────────────────────

update public.picklist_values
set picklist_is_active = false
where picklist_object = 'photos'
  and picklist_field  = 'photo_type'
  and picklist_is_active;

-- Report what is still carrying one, so a live tag is never a surprise later.
do $$
declare
  v_rows bigint;
begin
  select count(*) into v_rows
  from public.photos p
  where p.is_deleted is not true
    and exists (
      select 1 from public.picklist_values pv
      where pv.picklist_object = 'photos'
        and pv.picklist_field  = 'photo_type'
        and pv.picklist_value  = p.photo_type
    );
  raise notice 'photos still tagged with a retired general tag: %', v_rows;
end $$;
