-- fuzzy_resolve_picklist: grounded "did you mean?" matching for picklist /
-- enum values (statuses, record types, work types stored as picklists, etc.).
-- Trigram-ranked against ACTIVE picklist values for one object (+ optional
-- field). SECURITY INVOKER so it sees only what the caller's RLS allows on
-- picklist_values; returns id + value + label + similarity so the assistant
-- can propose a single best match or a short candidate list.
--
-- Pairs with global_search (record-name matching). Together they are the
-- entity-resolution layer behind the assistant's "Did you mean…?" confirmations.
-- pg_trgm lives in the extensions schema, so similarity() is reached via the
-- function's search_path (extensions included).

create or replace function public.fuzzy_resolve_picklist(
  p_object      text,
  p_term        text,
  p_field       text default null,
  p_limit       integer default 5,
  p_min_score   real    default 0.20
)
returns table (
  id             uuid,
  picklist_field text,
  value          text,
  label          text,
  score          real
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select
    pv.id,
    pv.picklist_field,
    pv.picklist_value as value,
    pv.picklist_label as label,
    greatest(
      similarity(coalesce(pv.picklist_label, ''), coalesce(p_term, '')),
      similarity(coalesce(pv.picklist_value, ''), coalesce(p_term, ''))
    ) as score
  from public.picklist_values pv
  where pv.picklist_object = p_object
    and pv.picklist_is_active is true
    and (p_field is null or pv.picklist_field = p_field)
    and (
      coalesce(pv.picklist_label, '') ilike '%' || coalesce(p_term, '') || '%'
      or coalesce(pv.picklist_value, '') ilike '%' || coalesce(p_term, '') || '%'
      or greatest(
           similarity(coalesce(pv.picklist_label, ''), coalesce(p_term, '')),
           similarity(coalesce(pv.picklist_value, ''), coalesce(p_term, ''))
         ) >= p_min_score
    )
  order by score desc, length(coalesce(pv.picklist_label, pv.picklist_value)) asc
  limit greatest(least(coalesce(p_limit, 5), 25), 1);
$$;

revoke all on function public.fuzzy_resolve_picklist(text, text, text, integer, real) from public;
grant execute on function public.fuzzy_resolve_picklist(text, text, text, integer, real) to authenticated;

notify pgrst, 'reload schema';
