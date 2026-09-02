-- Nicholas, 2026-09-02, on a work order whose Send for Signature warned "No
-- signing anchors found": "Every template, you need at least one signature
-- anchor. That has to be mandatory for a signature document, right?"
--
-- Right, and nothing enforced it. A signature document with no anchor is a
-- document nobody can sign: the recipient receives the PDF and has nowhere to
-- put a signature, an initial or a date. The modal WARNED and then let the
-- send proceed anyway.
--
-- All five document templates were in that state, and three of them
-- (DT-00002 Income Qualification Statement, DT-00003 Subcontractor Master
-- Services Agreement, DT-00004 Project Completion Acknowledgment) were ACTIVE
-- and offerable for signing. Every one carries requires_signature = true.

create or replace function public.enforce_signature_template_has_anchor()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_status_value text;
begin
  -- Only a template that IS a signature document. A template that merely
  -- generates a PDF (a summary, a report) has nothing to sign and is none of
  -- this rule's business.
  if NEW.requires_signature is not true then
    return NEW;
  end if;

  -- Only an ACTIVE template. Draft is where a document is being written, and a
  -- rule that refuses to save a half-finished draft would make it impossible
  -- to author one at all -- you cannot add the anchor before you can save.
  select pv.picklist_value into v_status_value
    from public.picklist_values pv where pv.id = NEW.status;
  if v_status_value is distinct from 'Active' then
    return NEW;
  end if;

  -- Only an HTML-mode template. When the document is an uploaded asset (docx)
  -- the anchors live inside the FILE, which this rule cannot read -- refusing
  -- those would block a whole legitimate authoring route.
  if NEW.dt_template_asset_path is not null then
    return NEW;
  end if;

  -- The anchor pattern is the RENDERER's, character for character:
  -- ANCHOR_RE = /\(sig|initial|date|text)(\d+)\/g in
  -- supabase/functions/_shared/htmlToPdf.ts. The ordinal is required -- it is
  -- the recipient's position in the signing order, and without it there is
  -- nobody to attribute the signature to. Note '\init1\' is NOT valid: the
  -- renderer only knows 'initial'.
  if coalesce(NEW.body_html, '') !~ '\\(sig|initial|date|text)[0-9]+\\' then
    raise exception
      'Document template "%" requires a signature but carries no signing anchor, so a recipient would receive a PDF with nothing to sign. Add at least one anchor to the template body -- use the Insert Signature Tab picker on the template record, or type \sig1\ (also \initial1\, \date1\, \text1\; the number is the recipient position). Save it as Draft until then.',
      coalesce(NEW.name, NEW.dt_record_number, 'unnamed');
  end if;

  return NEW;
end $$;

drop trigger if exists trg_zz_signature_template_anchor on public.document_templates;
create trigger trg_zz_signature_template_anchor
  before insert or update on public.document_templates
  for each row execute function public.enforce_signature_template_has_anchor();

-- The Active templates already in violation are moved to Draft rather than
-- left Active-and-unsendable. This is the rule's own consequence, not a
-- separate decision: an Active signature template is offered in the Send for
-- Signature picker, so leaving them Active keeps offering documents that
-- cannot be signed. Reversible in one click once an anchor is added, and safe
-- -- ZERO envelopes have ever been created from any of them.
update public.document_templates dt
   set status = (select id from public.picklist_values
                  where picklist_object = 'document_templates'
                    and picklist_field  = 'status'
                    and picklist_value  = 'Draft'
                  limit 1)
 where dt.is_deleted is not true
   and dt.requires_signature is true
   and dt.dt_template_asset_path is null
   and coalesce(dt.body_html, '') !~ '\\(sig|initial|date|text)[0-9]+\\'
   and (select pv.picklist_value from public.picklist_values pv where pv.id = dt.status) = 'Active';

-- Reporting view of the gap, so "which templates cannot be signed" is a query
-- rather than an inspection of five bodies by hand.
create or replace function public.signature_templates_without_anchors()
returns table (dt_record_number text, name text, related_object text, status_value text)
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $$
  select dt.dt_record_number, dt.name, dt.related_object,
         (select pv.picklist_value from public.picklist_values pv where pv.id = dt.status)
    from public.document_templates dt
   where dt.is_deleted is not true
     and dt.requires_signature is true
     and dt.dt_template_asset_path is null
     and coalesce(dt.body_html, '') !~ '\\(sig|initial|date|text)[0-9]+\\';
$$;

comment on function public.signature_templates_without_anchors() is
  'Signature document templates whose body carries no signing anchor, so a recipient would receive a PDF with nothing to sign. Draft rows are expected here while being authored; an ACTIVE row is a defect and trg_zz_signature_template_anchor refuses to create one.';

revoke all on function public.signature_templates_without_anchors() from public;
revoke all on function public.signature_templates_without_anchors() from anon;

do $verify$
declare
  v_active_bad integer;
  v_active_id  uuid;
  v_base       public.document_templates%rowtype;
begin
  -- No ACTIVE signature template may lack an anchor any more.
  select count(*) into v_active_bad
    from public.signature_templates_without_anchors()
   where status_value = 'Active';
  if v_active_bad > 0 then
    raise exception 'Still % ACTIVE signature template(s) with no signing anchor', v_active_bad;
  end if;

  select id into v_active_id from public.picklist_values
   where picklist_object='document_templates' and picklist_field='status' and picklist_value='Active' limit 1;
  if v_active_id is null then
    raise exception 'document_templates status picklist is missing Active';
  end if;

  -- Probe rows are built by COPYING a live row and overriding only what the
  -- rule reads, so every unrelated NOT NULL column is satisfied by
  -- construction rather than guessed at one failure at a time.
  select * into v_base from public.document_templates
   where is_deleted is not true and owner_id is not null limit 1;

  -- The trigger must actually REFUSE. Proved by attempting the exact bad write,
  -- not by trusting that it was installed. The sub-block rolls the probe back.
  begin
    insert into public.document_templates
    select * from jsonb_populate_record(v_base, jsonb_build_object(
      'id', gen_random_uuid(), 'dt_record_number', '',
      'name', '__anchor rule probe bad__', 'status', v_active_id,
      'requires_signature', true, 'dt_template_asset_path', null,
      'body_html', '<p>No anchor anywhere in this body.</p>', 'is_deleted', false));
    raise exception 'PROBE_NOT_REFUSED';
  exception
    when sqlstate 'P0001' then
      if sqlerrm = 'PROBE_NOT_REFUSED' then
        raise exception 'The anchor rule did NOT refuse an Active signature template with no anchor';
      end if;
      -- else: refused by the rule, as required
  end;

  -- And it must ALLOW one that carries an anchor, or authoring is impossible.
  -- Deliberately raised afterwards so the probe row never persists.
  begin
    insert into public.document_templates
    select * from jsonb_populate_record(v_base, jsonb_build_object(
      'id', gen_random_uuid(), 'dt_record_number', '',
      'name', '__anchor rule probe ok__', 'status', v_active_id,
      'requires_signature', true, 'dt_template_asset_path', null,
      'body_html', '<p>Sign here: \sig1\</p>', 'is_deleted', false));
    raise exception 'PROBE_OK_ROLLBACK';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'PROBE_OK_ROLLBACK' then
        raise exception 'The anchor rule wrongly refused a template WITH an anchor: %', sqlerrm;
      end if;
      -- else: accepted, and the insert is rolled back with this sub-block
  end;
end
$verify$;

notify pgrst, 'reload schema';
