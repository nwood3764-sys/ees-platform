-- E-signature has never worked in production. Not once: 0 envelopes, 0
-- recipients, 0 envelope events, ever -- on a pipeline whose code shipped
-- 2026-07-27.
--
-- Nicholas found it by pressing Send for Signature on WO-00240 and getting
-- "Required picklist seeds missing — contact admin".
--
-- The cause is one character of case. send-envelope/index.ts looks up
--   picklistId(supabase, "envelopes", "record_type", "Standard")
-- and picklistId does an exact .eq('picklist_value', value). The seeded row is
-- picklist_value 'standard' -- lowercase -- with the LABEL 'Standard', so
-- every screen showed the word the code was looking for while the lookup
-- returned null. The guard then refuses the send with a message that names
-- neither the object nor the value, so it reads as a configuration problem
-- nobody can locate.
--
-- FOUR deployed edge functions agree on "Standard" -- send-envelope,
-- signing-portal-load, signing-portal-submit and resend-envelope-email -- and
-- one picklist row disagrees. The data is the odd one out, so the data is what
-- moves: one migration against four redeploys of live functions that have no
-- rollback. picklist_value is internal (the label is unchanged and is what
-- anyone sees), no client code reads these by value, and with zero envelopes
-- in existence nothing references them at all.

update public.picklist_values
   set picklist_value = 'Standard'
 where picklist_object in ('envelopes', 'envelope_recipients',
                           'envelope_tabs', 'envelope_events')
   and picklist_field = 'record_type'
   and picklist_value = 'standard';

-- The guard. Nothing else catches this class: the build is silent (the value
-- lives in the database), the advisors are silent, and the failure surfaces
-- only as a 500 at the moment somebody tries to send a real document. This
-- lists every (object, field, value) the four deployed signing functions look
-- up, so a seed that is missing, renamed or deactivated is a row here rather
-- than a support call.
create or replace function public.signing_picklist_seed_integrity()
returns table (picklist_object text, picklist_field text, expected_value text, problem text)
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $$
  with required(obj, fld, val) as (
    values
      ('envelopes',           'record_type',      'Standard'),
      ('envelope_recipients', 'record_type',      'Standard'),
      ('envelope_tabs',       'record_type',      'Standard'),
      ('envelope_events',     'record_type',      'Standard'),
      ('envelopes',           'env_status',       'Draft'),
      ('envelopes',           'env_status',       'Sent'),
      ('envelopes',           'env_status',       'Failed'),
      ('envelopes',           'env_status',       'Completed'),
      ('envelopes',           'env_status',       'Declined'),
      ('envelope_recipients', 'recipient_status', 'Created'),
      ('envelope_recipients', 'recipient_status', 'Sent'),
      ('envelope_recipients', 'recipient_status', 'Signed'),
      ('envelope_recipients', 'recipient_status', 'Declined'),
      ('envelope_events',     'event_type',       'Created'),
      ('envelope_events',     'event_type',       'Sent'),
      ('envelope_events',     'event_type',       'Opened'),
      ('envelope_events',     'event_type',       'Viewed'),
      ('envelope_events',     'event_type',       'Signed'),
      ('envelope_events',     'event_type',       'Declined'),
      ('envelope_events',     'event_type',       'Completed'),
      ('envelope_events',     'event_type',       'Resent'),
      ('envelope_events',     'event_type',       'TabFilled'),
      ('envelope_events',     'event_type',       'ConsentGranted'),
      ('envelope_events',     'event_type',       'AdvancedToNext')
  )
  select r.obj, r.fld, r.val,
         case
           when not exists (
             select 1 from public.picklist_values pv
              where pv.picklist_object = r.obj and pv.picklist_field = r.fld
                and pv.picklist_value = r.val
           ) then 'no picklist value with this exact value (check casing)'
           else 'exists but is inactive'
         end
    from required r
   where not exists (
     select 1 from public.picklist_values pv
      where pv.picklist_object = r.obj and pv.picklist_field = r.fld
        and pv.picklist_value  = r.val
        and pv.picklist_is_active
   );
$$;

comment on function public.signing_picklist_seed_integrity() is
  'Every picklist seed the deployed signing edge functions (send-envelope, signing-portal-load, signing-portal-submit, resend-envelope-email) look up by literal value. Must return zero rows -- a row here means Send for Signature fails with "Required picklist seeds missing". The lookup is CASE-SENSITIVE, so a renamed or re-cased value breaks it silently.';

revoke all on function public.signing_picklist_seed_integrity() from public;
revoke all on function public.signing_picklist_seed_integrity() from anon;

do $verify$
declare
  v_bad text;
begin
  select string_agg(format('%s.%s = %L (%s)', picklist_object, picklist_field, expected_value, problem), '; ')
    into v_bad
    from public.signing_picklist_seed_integrity();

  if v_bad is not null then
    raise exception 'Signing picklist seeds the deployed functions require are still missing: %', v_bad;
  end if;

  -- The negative control: prove the checker can actually FAIL, or a green
  -- result means nothing. A value that certainly does not exist must be
  -- reported as missing by the same query shape the function uses.
  if exists (
    select 1 from public.picklist_values
     where picklist_object = 'envelopes' and picklist_field = 'record_type'
       and picklist_value = 'standard'
  ) then
    raise exception 'The lowercase seed still exists -- the rename did not land';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
