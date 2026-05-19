-- Adds `is_seed_data` to every tenant-data table so existing rows can be
-- bulk-purged once real production data is in. The flag defaults to FALSE so
-- every new row created by the live UI is treated as production by default.
-- All EXISTING rows in these tables are immediately stamped TRUE — the data
-- in the database right now is all seed.
--
-- System-config tables (picklist_values, roles, page_layouts, templates,
-- programs, picklists, lifecycle config, etc.) are deliberately excluded.
-- Those are platform configuration, not customer data, and survive the purge.
--
-- A companion seed_purge_tenant_data() admin RPC in a follow-up migration
-- uses this flag to wipe all seed rows in FK-dependency order.

DO $$
DECLARE
  v_table text;
  v_tenant_tables text[] := ARRAY[
    'accounts','account_contact_relations','contacts',
    'opportunities','opportunity_contact_roles','opportunity_line_items',
    'properties','buildings','units','property_programs','property_distances',
    'projects','project_reservations','project_payment_requests',
    'work_orders','work_plans','work_steps',
    'service_appointments','service_appointment_assignments','service_appointment_tokens',
    'assessments','incentive_applications','incentives','income_qualifications',
    'payment_receipts','efr_reports','diagnostic_tests',
    'documents','photos',
    'conversations','messages','message_attachments','message_ai_transcripts','unmatched_inbox',
    'activities','tasks','comments',
    'chat_threads','chat_messages',
    'email_sends','envelopes','envelope_recipients','envelope_tabs','envelope_events',
    'occurrences','occurrence_participants',
    'dispatcher_followup_requests',
    'mechanical_equipment','equipment_information',
    'time_sheets','time_sheet_entries',
    'job_kits','job_kit_line_items',
    'materials_requests','materials_request_line_items',
    'product_transfers','product_items',
    'vehicle_activities','equipment_activities','asset_assignments','gps_points',
    'status_change_events',
    'cfp_projects','cfp_scenarios',
    'notification_logs','notifications',
    'portal_users'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tenant_tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS is_seed_data boolean NOT NULL DEFAULT false',
      v_table
    );
    EXECUTE format('UPDATE public.%I SET is_seed_data = true WHERE is_seed_data = false', v_table);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (is_seed_data) WHERE is_seed_data',
      'idx_' || v_table || '_is_seed_data', v_table
    );
    EXECUTE format(
      'COMMENT ON COLUMN public.%I.is_seed_data IS %L',
      v_table,
      'True for rows seeded before go-live. Defaults FALSE for production rows. Wiped en masse via seed_purge_tenant_data() admin RPC. Never set TRUE on production rows.'
    );
  END LOOP;
END$$;
