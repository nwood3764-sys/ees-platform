-- ─────────────────────────────────────────────────────────────────────────────
-- Include in final report — for DOCUMENTS, mirroring photos.
--
-- Photos have carried `include_in_final_report` since 2026-07-20: a curator
-- flags the shots that belong in the deliverable once, and the report reads the
-- flag. Documents had no equivalent, so the only way to say which of them
-- belonged in a report was to re-pick them by hand on every generation
-- (Nicholas, 2026-08-27: "You shouldn't have to have the user select them every
-- time they generate a report. It needs to function just like the photo
-- section").
--
-- Deliberately identical to the photo columns — same names, same default, same
-- shape of setter — because it IS the same concept on a second object. A
-- report-building consumer can then read one column name across both.
--
-- The flag is internal curation only. It never appears on the document itself,
-- and it does not restrict who can see or download the file.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.documents
  add column if not exists include_in_final_report    boolean not null default false,
  add column if not exists report_inclusion_marked_by uuid references public.users(id),
  add column if not exists report_inclusion_marked_at timestamptz;

comment on column public.documents.include_in_final_report is
  'Internal curation flag: this document belongs in the record''s final report. Set via set_document_report_inclusion().';

-- Partial index: the only query that matters is "the flagged ones on this
-- record", which is a small slice of a large table.
create index if not exists documents_in_final_report_idx
  on public.documents (related_object, related_id)
  where include_in_final_report and is_deleted is not true;

-- Setter mirrors set_photo_report_inclusion exactly, including stamping who
-- marked it and when, and clearing both when the flag comes off — the audit
-- trail is the point of the columns.
create or replace function public.set_document_report_inclusion(p_document_id uuid, p_include boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_user uuid := current_app_user_id();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  update public.documents
     set include_in_final_report    = coalesce(p_include, false),
         report_inclusion_marked_by = case when p_include then v_user else null end,
         report_inclusion_marked_at = case when p_include then now()  else null end
   where id = p_document_id
     and is_deleted is not true;
  if not found then
    raise exception 'document not found: %', p_document_id;
  end if;
  return coalesce(p_include, false);
end
$function$;

revoke all on function public.set_document_report_inclusion(uuid, boolean) from public;
revoke all on function public.set_document_report_inclusion(uuid, boolean) from anon;
grant execute on function public.set_document_report_inclusion(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
