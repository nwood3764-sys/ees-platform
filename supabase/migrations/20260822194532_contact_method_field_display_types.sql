-- Clickable phone / email / website fields
-- =========================================================================
-- Nicholas, 2026-08-22: the Website on a property page rendered as plain
-- text. A phone number, an email address, and a website are actions, not
-- strings — clicking one should dial (handing off to Teams / the softphone /
-- the mobile dialer), open a mail composer, or open the site.
--
-- The renderer does that for any field whose logical type is phone / email /
-- url. What was missing is the type: these columns are plain `text` in
-- Postgres, and the page layouts inherited that — property_website was typed
-- `text`, property_phone / property_email carried no type at all.
--
-- field_metadata.fm_display_type is the platform's existing, admin-manageable
-- place for a column's logical type; loadRecordDetailData overlays it onto
-- every layout that shows the column, so one row here fixes the field on all
-- of that object's layouts (and any layout built later) without editing a
-- single layout.
--
-- Scope is explicit, one row per real contact-method column on a user-facing
-- object. Deliberately NOT typed as `url`: columns that hold a storage key
-- rather than a link (photos.file_url / thumbnail_url, documents.file_url,
-- users.user_profile_photo_url, the work-step reference photos,
-- portals.portal_url_path) — those are resolved to signed URLs by their own
-- components. Deliberately NOT typed at all: import staging tables
-- (stg_hud_*, hud_property_master), system/log tables (client_errors,
-- email_sends, password_reset_sms_requests, user_outlook_connections,
-- scheduled_report_runs), contacts.contact_mobile_carrier (a carrier name,
-- not a number) and equipment.equipment_registered_email_password.
--
-- Idempotent: an existing row keeps whatever display type it already carries
-- (an admin's choice in the Field Manager wins), and formula / rollup /
-- inherited fields are left completely alone.

WITH seed(fm_object, fm_column, display_type) AS (
  VALUES
    ('accounts', 'account_website', 'url'),
    ('properties', 'property_website', 'url'),
    ('service_provider_applications', 'spa_website', 'url'),
    ('contacts', 'contact_linkedin', 'url'),
    ('owner_research_candidates', 'orc_linkedin_url', 'url'),
    ('opportunities', 'opportunity_jobber_url', 'url'),
    ('opportunities', 'opportunity_snugg_pro_url', 'url'),
    ('assessments', 'assessment_matterport_url', 'url'),
    ('assessments', 'assessment_snug_pro_url', 'url'),
    ('assessments', 'assessment_exterior_of_building_video_url', 'url'),
    ('ahri_certificates', 'ahri_certificate_url', 'url'),
    ('products', 'product_engineering_manual_url', 'url'),
    ('products', 'product_install_manual_url', 'url'),
    ('products', 'product_manufacturer_site_url', 'url'),
    ('products', 'product_manufacturer_specifications_url', 'url'),
    ('products', 'product_service_manual_url', 'url'),
    ('products', 'product_specification_sheet_url', 'url'),
    ('products', 'product_submittal_sheet_url', 'url'),
    ('product_items', 'product_item_reorder_url', 'url'),
    ('product_transfers', 'pt_shipment_tracking_url', 'url'),
    ('work_orders', 'work_order_training_video_url', 'url'),
    ('contact_skills', 'cs_document_url', 'url'),
    ('activities', 'document_url', 'url'),
    ('accounts', 'account_email', 'email'),
    ('contacts', 'contact_email', 'email'),
    ('properties', 'property_email', 'email'),
    ('properties', 'property_hud_management_email', 'email'),
    ('properties', 'property_hud_owner_email', 'email'),
    ('properties', 'property_ph_authority_email', 'email'),
    ('properties', 'property_mf_raw_mgmt_contact_email_text', 'email'),
    ('properties', 'property_mfown_raw_mgmt_contact_email_text', 'email'),
    ('properties', 'property_mfown_raw_owner_contact_email_text', 'email'),
    ('properties', 'property_ph_raw_exec_dir_email', 'email'),
    ('properties', 'property_ph_raw_ha_email_addr_text', 'email'),
    ('units', 'unit_tenant_email', 'email'),
    ('users', 'user_email', 'email'),
    ('portal_users', 'email', 'email'),
    ('enrollments', 'enrollment_contact_email', 'email'),
    ('incentive_applications', 'ia_applicant_building_owner_email', 'email'),
    ('incentive_applications', 'ia_email_for_tax_purposes', 'email'),
    ('incentive_applications', 'ia_primary_contractor_email', 'email'),
    ('assessments', 'assessment_applicant_building_owner_email', 'email'),
    ('assessments', 'assessment_building_owner_email_address', 'email'),
    ('efr_reports', 'efr_applicant_building_owner_email', 'email'),
    ('efr_reports', 'efr_applicant_email', 'email'),
    ('efr_reports', 'efr_building_owner_email_address', 'email'),
    ('equipment', 'equipment_registered_email', 'email'),
    ('dispatcher_followup_requests', 'dfr_email', 'email'),
    ('envelope_recipients', 'recipient_email', 'email'),
    ('service_provider_applications', 'spa_business_email', 'email'),
    ('service_provider_applications', 'spa_contact_email', 'email'),
    ('accounts', 'account_phone', 'phone'),
    ('accounts', 'account_fax', 'phone'),
    ('contacts', 'contact_phone', 'phone'),
    ('contacts', 'contact_mobile_phone', 'phone'),
    ('contacts', 'contact_fax', 'phone'),
    ('contacts', 'contact_emergency_contact_home_phone', 'phone'),
    ('contacts', 'contact_emergency_contact_mobile_phone', 'phone'),
    ('properties', 'property_phone', 'phone'),
    ('properties', 'property_hud_management_phone', 'phone'),
    ('properties', 'property_hud_owner_phone', 'phone'),
    ('properties', 'property_ph_authority_phone', 'phone'),
    ('properties', 'property_mf_raw_property_on_site_phone_number', 'phone'),
    ('properties', 'property_mfown_raw_mgmt_agent_main_phone_number', 'phone'),
    ('properties', 'property_mfown_raw_mgmt_agent_main_fax_number', 'phone'),
    ('properties', 'property_mfown_raw_owner_main_phone_number_text', 'phone'),
    ('properties', 'property_mfown_raw_owner_main_fax_number_text', 'phone'),
    ('properties', 'property_mfown_raw_property_phone_number', 'phone'),
    ('properties', 'property_ph_raw_exec_dir_phone', 'phone'),
    ('properties', 'property_ph_raw_exec_dir_fax', 'phone'),
    ('properties', 'property_ph_raw_ha_fax_num', 'phone'),
    ('units', 'unit_tenant_phone', 'phone'),
    ('users', 'user_phone', 'phone'),
    ('portal_users', 'phone', 'phone'),
    ('work_orders', 'work_order_contact_phone', 'phone'),
    ('enrollments', 'enrollment_contact_phone', 'phone'),
    ('incentive_applications', 'ia_applicant_building_owner_office_phone', 'phone'),
    ('incentive_applications', 'ia_building_owner_mobile_phone', 'phone'),
    ('incentive_applications', 'ia_primary_contractor_phone_number', 'phone'),
    ('assessments', 'assessment_applicant_building_owner_office_phone', 'phone'),
    ('assessments', 'assessment_building_owner_office_phone', 'phone'),
    ('efr_reports', 'efr_applicant_building_owner_office_phone', 'phone'),
    ('efr_reports', 'efr_applicant_phone', 'phone'),
    ('efr_reports', 'efr_building_owner_office_phone', 'phone'),
    ('equipment', 'equipment_phone_number', 'phone'),
    ('dispatcher_followup_requests', 'dfr_phone', 'phone'),
    ('crew_phones', 'phone_number', 'phone'),
    ('service_provider_applications', 'spa_business_phone', 'phone'),
    ('service_provider_applications', 'spa_contact_phone', 'phone')
),
-- Every seeded column must actually exist on the object; a typo silently
-- seeding a phantom column would be invisible until someone opened the
-- Field Manager.
resolved AS (
  SELECT s.*
  FROM seed s
  JOIN pg_catalog.pg_class c ON c.relname = s.fm_object
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = s.fm_column
   AND a.attnum > 0 AND NOT a.attisdropped
),
-- Prefer the label the object's page layouts already use for the column, so
-- the Field Manager and the record page agree; fall back to a humanized
-- column name for columns no layout carries yet.
labeled AS (
  SELECT r.*,
    COALESCE(
      (SELECT f->>'label'
         FROM public.page_layouts l
         JOIN public.page_layout_widgets w
           ON w.page_layout_id = l.id AND w.is_deleted IS NOT TRUE
          AND w.widget_type = 'field_group'
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields', '[]'::jsonb)) f
        WHERE l.page_layout_object = r.fm_object
          AND l.is_deleted IS NOT TRUE
          AND f->>'name' = r.fm_column
          AND NULLIF(btrim(f->>'label'), '') IS NOT NULL
        LIMIT 1),
      initcap(replace(r.fm_column, '_', ' '))
    ) AS fm_label
  FROM resolved r
)
INSERT INTO public.field_metadata (fm_record_number, fm_object, fm_column, fm_label, fm_display_type)
SELECT '', fm_object, fm_column, fm_label, display_type FROM labeled
ON CONFLICT (fm_object, fm_column) DO UPDATE
SET fm_display_type = COALESCE(field_metadata.fm_display_type, EXCLUDED.fm_display_type),
    fm_updated_at   = now()
WHERE field_metadata.fm_field_kind = 'standard'
  AND field_metadata.fm_display_type IS NULL;
