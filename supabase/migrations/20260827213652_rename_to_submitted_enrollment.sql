-- =============================================================================
-- "Submission Record" → SUBMITTED ENROLLMENT.
--
-- Nicholas, within the hour of the first cut shipping: "Where did you get
-- Submission Record? That doesn't make any sense. How about 'Submitted
-- Enrollment'? It should be the name again, be changing names on us."
--
-- He is right, and the rule is worth recording: a document ABOUT an enrollment
-- is called an enrollment. Minting "Submission Record" invented a noun the
-- platform does not use for an object it already had a name for, and then the
-- registry made it worse by giving each record type its own variant of that
-- noun — "Assessment Preapproval Submission Record", "North Carolina IRA
-- Multifamily Submission Record" — one document with its name drifting eight
-- ways. The program belongs in the subtitle. The name stays put.
--
-- Renamed rather than re-seeded: the template is the same document, one hour
-- old, and its section rows keep their ids and their history.
--
-- Deliberately NOT a compatibility alias. The old kind and key shipped an hour
-- ago and nothing has been generated under them (verified below: zero
-- documents), so leaving both spellings alive would only give the next person
-- two names for one thing — which is the defect being fixed.
-- =============================================================================

do $$
declare
  v_template_id uuid;
  v_stale       int;
begin
  -- Nothing may have been filed under the old name. If anything was, stop:
  -- a generated document is a record of a filing and is not silently retyped.
  select count(*) into v_stale
    from public.documents
   where document_type = 'enrollment_submission_record' and is_deleted is not true;
  if v_stale > 0 then
    raise exception 'rename aborted: % document(s) already filed as enrollment_submission_record', v_stale;
  end if;

  -- 1. Drop the whitelist FIRST. The rows still carry the old kind, so adding
  --    the new constraint before renaming them fails on its own data.
  alter table public.submittal_document_templates
    drop constraint if exists submittal_document_templates_sdt_kind_check;

  -- 2. The template itself.
  select id into v_template_id
    from public.submittal_document_templates
   where sdt_document_key = 'enrollment_submission_record'
     and sdt_is_deleted = false;

  if v_template_id is not null then
    update public.submittal_document_templates
       set sdt_name         = 'Submitted Enrollment',
           sdt_kind         = 'submitted_enrollment',
           sdt_document_key = 'submitted_enrollment',
           sdt_description  = 'What an enrollment filed with the program: the submitted values, and a manifest of the attached documents with a download link for each.'
     where id = v_template_id;

    -- 3. Its section types, which the renderer looks up by name.
    update public.submittal_document_template_sections
       set sdts_section_type = case sdts_section_type
             when 'submission_cover'             then 'submitted_enrollment_cover'
             when 'submission_summary'           then 'submitted_enrollment_summary'
             when 'submission_document_manifest' then 'submitted_enrollment_documents'
             when 'submission_note'              then 'submitted_enrollment_note'
             when 'submission_footer'            then 'submitted_enrollment_footer'
             else sdts_section_type end,
           sdts_name = case sdts_name
             when 'Submission Cover' then 'Cover'
             when 'Record Footer'    then 'Footer'
             else sdts_name end
     where sdt_id = v_template_id;
  end if;

  -- 4. Put the whitelist back, now that no row violates it.
  alter table public.submittal_document_templates
    add constraint submittal_document_templates_sdt_kind_check
    check (sdt_kind = any (array[
      'audit', 'proposal', 'invoice',
      'sealed_proposal', 'sealed_invoice',
      'combustion_safety_notification',
      'energy_assessment_report',
      'submitted_enrollment'
    ]));

  -- 5. The document type the generated PDF is filed under.
  update public.picklist_values
     set picklist_value = 'submitted_enrollment',
         picklist_label = 'Submitted Enrollment'
   where picklist_object = 'documents' and picklist_field = 'document_type'
     and picklist_value = 'enrollment_submission_record';

  -- 6. Assert the old name is gone everywhere it could hide.
  if exists (select 1 from public.submittal_document_templates
              where (sdt_document_key = 'enrollment_submission_record'
                     or sdt_kind = 'enrollment_submission_report')
                and sdt_is_deleted = false) then
    raise exception 'a template still carries the old name';
  end if;
  if exists (select 1 from public.submittal_document_template_sections
              where sdts_section_type like 'submission\_%' and sdts_is_deleted = false) then
    raise exception 'a section still carries the old type';
  end if;
  if exists (select 1 from public.picklist_values
              where picklist_object = 'documents' and picklist_field = 'document_type'
                and picklist_value = 'enrollment_submission_record') then
    raise exception 'the old document type still exists';
  end if;
end
$$;

notify pgrst, 'reload schema';
