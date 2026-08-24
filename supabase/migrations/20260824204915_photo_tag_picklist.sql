-- ─────────────────────────────────────────────────────────────────────────────
-- Photo tags for evidence that belongs to no work step.
--
-- `photos.photo_type` is the tag: what the photo IS. For a LEAP Pad capture it
-- is the named prompt from the work step template ('kitchen_overall_photo'),
-- whose wording lives on work_step_template_fields.wstf_field_label, and the
-- watermark, the gallery filter and the work-step evidence gates all read it.
--
-- A photo uploaded straight onto a work order's Photos card has no step and
-- therefore no template, so it was written 'general' and there was no way to
-- say what it was — not at upload, not afterwards. Sixty photos of a job all
-- read "Work Order", the watermark on each said "general", and the tag filter
-- could not separate them.
--
-- The missing piece is a vocabulary a person can choose from, so this seeds one
-- as an ordinary picklist: object `photos`, field `photo_type`. Manage it at
-- Setup → Picklists like any other — add the tags this work actually needs,
-- retire the ones it does not. Nothing here is compiled into the app.
--
-- Values are stored HUMAN-READABLE ('Equipment Nameplate', not
-- 'equipment_nameplate') because photo_type is printed verbatim onto the
-- watermark by process-photo. A machine-token value would put
-- "equipment_nameplate" on the face of an evidence photo that goes to a program
-- reviewer.
--
-- 'Before' and 'After' are seeded deliberately and must keep those exact
-- spellings: the work-step evidence gates count them as
-- `lower(coalesce(photo_type,'')) = 'before'`, so the capitalised label
-- satisfies the same gate the LEAP Pad legacy legs do. 'general' is NOT a
-- value — it is what an untagged photo carries, and the picker offers
-- "No tag" for that.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_description)
select
  'photos', 'photo_type', v.value, v.value, true, v.sort_order, v.description
from (values
  ('Before',                10, 'Conditions before the work started.'),
  ('After',                 20, 'Conditions after the work was completed.'),
  ('Work in Progress',      30, 'The work underway — mid-job documentation.'),
  ('Existing Conditions',   40, 'What was found on arrival, unrelated to a specific step.'),
  ('Damage or Deficiency',  50, 'Damage, a defect, or a condition that needs raising.'),
  ('Equipment Nameplate',   60, 'A nameplate, rating label or serial number.'),
  ('Materials',             70, 'Materials delivered, staged or installed.'),
  ('Access',                80, 'Entry, keys, lockboxes, hatches — how the crew got in.'),
  ('Safety Concern',        90, 'A hazard or safety condition on site.'),
  ('Completed Work',       100, 'The finished result, for sign-off or submittal.')
) as v(value, sort_order, description)
where not exists (
  select 1 from public.picklist_values pv
  where pv.picklist_object = 'photos'
    and pv.picklist_field  = 'photo_type'
    and pv.picklist_value  = v.value
);
