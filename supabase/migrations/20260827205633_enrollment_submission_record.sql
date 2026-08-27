-- =============================================================================
-- Enrollment Submission Record — the filing's own document.
--
-- Nicholas, 2026-08-27, on finding an "In report" flag on an enrollment's
-- documents: "Are we creating an enrollment report? … Probably good to have one
-- PDF file that works similarly to our assessment report, so we can have it so
-- we know exactly what was submitted. The downloadable links for documents."
--
-- We were not. The flag shipped that morning for the assessment report's
-- document manifest and was not scoped, so it appeared on every documents
-- gallery — including the one added to enrollments the same day — while only
-- the work-order assessment report ever read it. On an enrollment it wrote a
-- value nothing consumed: 67 documents across six typed slots, zero flagged.
--
-- An enrollment IS a submission — one record type per packet EES files — so
-- the honest fix is not to hide the control but to build the consumer. This
-- migration registers the document that reads it.
--
-- Keyed by the ENROLLMENT's record type, not the assessment's: the assessment
-- report is the deliverable of a building walk and is keyed by the assessment
-- work order. Separate purposes, separate kinds, separate section types,
-- separate templates. One document KEY across programs, because the shape of a
-- filing is the same everywhere and program wording already rides the
-- template-scoped-to-record-type axis every other submittal document uses.
-- =============================================================================

-- 1. The new kind. The check constraint is an explicit whitelist, so a new
--    engine has to be admitted here before its templates can exist.
alter table public.submittal_document_templates
  drop constraint if exists submittal_document_templates_sdt_kind_check;
alter table public.submittal_document_templates
  add constraint submittal_document_templates_sdt_kind_check
  check (sdt_kind = any (array[
    'audit', 'proposal', 'invoice',
    'sealed_proposal', 'sealed_invoice',
    'combustion_safety_notification',
    'energy_assessment_report',
    'enrollment_submission_report'
  ]));

-- 2. The generated PDF needs a document type of its own, so a filed record is
--    distinguishable from the attachments it lists. Without this its own row
--    would come back labelled by the raw slug.
insert into public.picklist_values (
  picklist_object, picklist_field, picklist_value, picklist_label,
  picklist_sort_order, picklist_is_active
)
select 'documents', 'document_type', 'enrollment_submission_record',
       'Enrollment Submission Record',
       coalesce((select max(picklist_sort_order) + 1 from public.picklist_values
                  where picklist_object='documents' and picklist_field='document_type'), 100),
       true
where not exists (
  select 1 from public.picklist_values
   where picklist_object='documents' and picklist_field='document_type'
     and picklist_value='enrollment_submission_record'
);

-- 3. The template, seeded byte-for-byte from the built-in default in
--    DEFAULT_DOCUMENT_SECTIONS.enrollmentSubmissionRecord, so the stored
--    template and the code fallback are the same document. Editing it in
--    Setup → Submittal Document Templates → Edit Sections is what makes the
--    layout data rather than a deploy.
do $$
declare
  v_template_id uuid;
  v_owner       uuid;
begin
  -- Every record has a named owner (platform rule), and sdt_owner is NOT NULL.
  select id into v_owner from public.users
   where user_is_deleted is not true
   order by (user_email = 'nicholas.wood@ees-wi.org') desc, user_created_at
   limit 1;
  if v_owner is null then
    raise exception 'no active user to own the submission record template';
  end if;

  select id into v_template_id
    from public.submittal_document_templates
   where sdt_document_key = 'enrollment_submission_record'
     and sdt_opportunity_record_type is null
     and sdt_is_deleted = false;

  if v_template_id is null then
    insert into public.submittal_document_templates (
      sdt_record_number, sdt_name, sdt_description, sdt_kind, sdt_document_key,
      sdt_opportunity_record_type, sdt_is_active, sdt_is_deleted,
      sdt_owner, sdt_created_by, is_seed_data
    ) values (
      '', 'Enrollment Submission Record',
      'What an enrollment filed with the program: the submitted values, and a manifest of the attached documents with a download link for each.',
      'enrollment_submission_report', 'enrollment_submission_record', null, true, false,
      v_owner, v_owner, true
    ) returning id into v_template_id;
  end if;

  -- Soft-delete any previous section set rather than dropping it: a template's
  -- history is the record of how a filing used to be laid out.
  update public.submittal_document_template_sections
     set sdts_is_deleted = true
   where sdt_id = v_template_id
     and sdts_is_deleted = false;

  insert into public.submittal_document_template_sections (
    sdts_record_number, sdt_id, sdts_name, sdts_section_type, sdts_config,
    sdts_sort_order, sdts_is_active, sdts_is_deleted, sdts_owner, sdts_created_by, is_seed_data
  ) values
    ('', v_template_id, 'Submission Cover', 'submission_cover', '{}'::jsonb, 10, true, false, v_owner, v_owner, true),
    ('', v_template_id, 'What Was Submitted', 'submission_summary',
       jsonb_build_object('heading', 'What Was Submitted'), 20, true, false, v_owner, v_owner, true),
    ('', v_template_id, 'Documents Submitted', 'submission_document_manifest',
       jsonb_build_object('heading', 'Documents Submitted'), 30, true, false, v_owner, v_owner, true),
    ('', v_template_id, 'Record Footer', 'submission_footer', '{}'::jsonb, 40, true, false, v_owner, v_owner, true);

  -- Assert what was built, rather than assuming it.
  if (select count(*) from public.submittal_document_template_sections
       where sdt_id = v_template_id and sdts_is_deleted = false) <> 4 then
    raise exception 'enrollment submission record template did not end up with its 4 sections';
  end if;
end
$$;

notify pgrst, 'reload schema';
