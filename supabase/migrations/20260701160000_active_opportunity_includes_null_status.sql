-- =============================================================================
-- Engaged-flag fix: treat a null-status opportunity as active/open.
--
-- property_has_active_opportunity (materialized by 20260701150000) only flipped
-- true when a linked opportunity's status = 'Open'. But opportunities imported
-- from Salesforce arrive with a NULL opportunity_status (the status picklist is
-- Open/Won/Lost and the import never set it). Net effect: every property read
-- as "no active opportunity", so the Outreach Map's "Include properties with
-- active opportunity" toggle had nothing to surface and the Outreach top-of-
-- funnel list never excluded already-engaged properties.
--
-- Correct rule: a property is engaged if it has a non-deleted opportunity whose
-- status is Open OR not yet set (NULL). A brand-new opportunity with no status
-- is open by default. Won/Lost opportunities are NOT active and do not count.
-- =============================================================================

-- ── Recompute helper: engaged iff a non-deleted, non-closed opp exists ───────
create or replace function public.recompute_property_active_opp(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if p_property_id is null then return; end if;
  update public.properties p
     set property_has_active_opportunity = exists (
       select 1
       from public.opportunities o
       left join public.picklist_values pv
         on pv.id = o.opportunity_status
        and pv.picklist_object = 'opportunities'
        and pv.picklist_field  = 'opportunity_status'
       where o.property_id = p_property_id
         and coalesce(o.opportunity_is_deleted, false) = false
         and (o.opportunity_status is null or pv.picklist_value = 'Open')
     )
   where p.id = p_property_id
     and p.property_has_active_opportunity is distinct from (
       exists (
         select 1
         from public.opportunities o
         left join public.picklist_values pv
           on pv.id = o.opportunity_status
          and pv.picklist_object = 'opportunities'
          and pv.picklist_field  = 'opportunity_status'
         where o.property_id = p_property_id
           and coalesce(o.opportunity_is_deleted, false) = false
           and (o.opportunity_status is null or pv.picklist_value = 'Open')
       )
     );
end;
$function$;

-- Trigger trg_opportunities_active_flag (20260701150000) already calls this
-- helper on every opportunity insert/update/delete — no change needed.

-- ── Backfill the stored flag under the corrected definition ──────────────────
-- Guarded by is-distinct so only the properties whose flag actually changes
-- are written (avoids touching all 17k rows / firing updated_at needlessly).
update public.properties p
   set property_has_active_opportunity = exists (
     select 1
     from public.opportunities o
     left join public.picklist_values pv
       on pv.id = o.opportunity_status
      and pv.picklist_object = 'opportunities'
      and pv.picklist_field  = 'opportunity_status'
     where o.property_id = p.id
       and coalesce(o.opportunity_is_deleted, false) = false
       and (o.opportunity_status is null or pv.picklist_value = 'Open')
   )
 where coalesce(p.property_is_deleted, false) = false
   and p.property_has_active_opportunity is distinct from (
     exists (
       select 1
       from public.opportunities o
       left join public.picklist_values pv
         on pv.id = o.opportunity_status
        and pv.picklist_object = 'opportunities'
        and pv.picklist_field  = 'opportunity_status'
       where o.property_id = p.id
         and coalesce(o.opportunity_is_deleted, false) = false
         and (o.opportunity_status is null or pv.picklist_value = 'Open')
     )
   );

revoke all on function public.recompute_property_active_opp(uuid) from public, anon;

notify pgrst, 'reload schema';
