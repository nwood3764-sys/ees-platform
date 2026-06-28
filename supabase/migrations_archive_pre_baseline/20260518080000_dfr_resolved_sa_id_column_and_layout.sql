-- ─── DFR → SA resolution link ─────────────────────────────────────────
-- Adds the FK column dispatcher_followup_requests want when a captured lead
-- is resolved by creating a real Service Appointment (the most common
-- positive resolution path). Nullable — a DFR can resolve without an SA
-- (manual handling, customer no longer reachable, etc.).
--
-- The column is a normal nullable lookup; trigger logic for stamping
-- dfr_resolved_at / dfr_resolved_by stays as-is (those fire on the
-- dfr_status flip into Resolved/Closed, which the conversion flow does
-- alongside writing this FK).

alter table public.dispatcher_followup_requests
  add column if not exists dfr_resolved_sa_id uuid
  references public.service_appointments(id) on delete set null;

create index if not exists idx_dfr_resolved_sa_id
  on public.dispatcher_followup_requests(dfr_resolved_sa_id)
  where dfr_resolved_sa_id is not null;

comment on column public.dispatcher_followup_requests.dfr_resolved_sa_id is
  'When a dispatcher resolves this DFR by booking a real Service Appointment, the FK to that SA. Nullable — non-conversion resolutions (no longer reachable, served elsewhere, etc.) leave this null.';

-- Extend the Status & Resolution field_group widget on the DFR record-detail
-- page layout to include the new lookup so it surfaces alongside the
-- existing resolution fields.
update public.page_layout_widgets
set widget_config = jsonb_set(
  widget_config,
  '{fields}',
  (widget_config->'fields') || jsonb_build_array(
    jsonb_build_object(
      'name',         'dfr_resolved_sa_id',
      'type',         'lookup',
      'label',        'Resolved by SA',
      'lookup_field', 'sa_record_number'
    )
  ),
  false
),
updated_at = now()
where id = 'e5a722b9-74f1-4ae7-a6bf-f8b2a3ece553';
