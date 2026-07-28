-- Enrollment: automatic name + registered-contractor sourced from an account.
--
-- Two changes on top of the WI-IRA-MF-HOMES-ASSESSMENT work:
--
-- 1) enrollment_name becomes automatic (like projects/work orders): a derive
--    trigger sets it to "<property name> - <record type label>". The typed
--    Name field is removed from the layout.
--
-- 2) The registered contractor is an existing EES account, not free text. A
--    new enrollment_contractor_account_id lookup (real FK -> accounts) drives
--    read-only related fields (name / email / primary address) pulled live
--    from that account. The six free-text contractor columns added earlier in
--    this workstream (no data yet) are dropped as superseded. The payment
--    address stays editable for the "payment address different?" branch.
--
-- Order matters: add the FK column FIRST (related-field validation resolves
-- via pg_constraint), rebuild the layout so no active widget references the
-- free-text columns, THEN drop them.

-- 1) Contractor account lookup (real FK so related_field validation passes) ----
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS enrollment_contractor_account_id uuid;
COMMENT ON COLUMN public.enrollments.enrollment_contractor_account_id IS 'Registered contractor - FK to the EES account that is the registered contractor for this application. Contractor name/email/address are read from this account.';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='enrollments_enrollment_contractor_account_id_fkey') THEN
    ALTER TABLE public.enrollments
      ADD CONSTRAINT enrollments_enrollment_contractor_account_id_fkey
      FOREIGN KEY (enrollment_contractor_account_id) REFERENCES public.accounts(id);
  END IF;
END $$;

-- 2) Automatic enrollment name -------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_enrollment_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_property_name text;
  v_record_label  text;
BEGIN
  SELECT p.property_name INTO v_property_name
    FROM properties p WHERE p.id = NEW.property_id;
  SELECT pv.picklist_label INTO v_record_label
    FROM picklist_values pv WHERE pv.id = NEW.enrollment_record_type;

  NEW.enrollment_name := NULLIF(
    trim(both ' -' FROM (
      coalesce(NULLIF(trim(coalesce(v_property_name,'')),''), '')
      || CASE WHEN v_record_label IS NOT NULL AND trim(v_record_label) <> ''
              THEN ' - ' || v_record_label ELSE '' END
    )),
    ''
  );
  -- enrollment_name is NOT NULL; property_id is required and always named, so
  -- the result is non-null in practice. Guard anyway: keep any prior value.
  IF NEW.enrollment_name IS NULL THEN
    NEW.enrollment_name := COALESCE(OLD.enrollment_name, NEW.enrollment_name);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enrollment_name ON public.enrollments;
CREATE TRIGGER trg_enrollment_name
  BEFORE INSERT OR UPDATE OF property_id, enrollment_record_type
  ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.derive_enrollment_name();

-- Backfill existing enrollments to the derived name (only where a property
-- name is present, so we never violate the NOT NULL constraint).
UPDATE public.enrollments e
SET enrollment_name = NULLIF(trim(both ' -' FROM (
      coalesce((SELECT property_name FROM properties WHERE id = e.property_id), '')
      || CASE WHEN (SELECT picklist_label FROM picklist_values WHERE id = e.enrollment_record_type) IS NOT NULL
              THEN ' - ' || (SELECT picklist_label FROM picklist_values WHERE id = e.enrollment_record_type)
              ELSE '' END)), '')
WHERE e.enrollment_is_deleted IS NOT TRUE
  AND coalesce((SELECT property_name FROM properties WHERE id = e.property_id), '') <> '';

-- 3) Rebuild the WI-IRA-MF-HOMES-ASSESSMENT layout ----------------------------
DO $$
DECLARE
  v_layout uuid := '68d28e30-2369-42e6-9baf-a2bad552cae3';
  v_sec1 uuid := gen_random_uuid();
  v_sec2 uuid := gen_random_uuid();
  v_sec3 uuid := gen_random_uuid();
  v_sec4 uuid := gen_random_uuid();
  v_sec5 uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM page_layouts WHERE id=v_layout AND NOT is_deleted) THEN
    RAISE EXCEPTION 'WI-IRA-MF-HOMES-ASSESSMENT layout % not found', v_layout;
  END IF;

  UPDATE page_layout_widgets
     SET is_deleted=true, updated_at=now()
   WHERE page_layout_id=v_layout AND is_deleted IS NOT TRUE;
  UPDATE page_layout_sections
     SET is_deleted=true, deletion_reason='Rebuilt for auto-name + contractor-account sourcing', updated_at=now()
   WHERE page_layout_id=v_layout AND is_deleted IS NOT TRUE;

  INSERT INTO page_layout_sections (id, page_layout_id, section_order, section_label, section_columns, section_tab, section_placement, is_deleted) VALUES
    (v_sec1, v_layout, 1, 'Enrollment',              2, 'Details', 'main', false),
    (v_sec2, v_layout, 2, 'Contractor Information',  2, 'Details', 'main', false),
    (v_sec3, v_layout, 3, 'Property & Owner',        2, 'Details', 'main', false),
    (v_sec4, v_layout, 4, 'Incentive Request',       2, 'Details', 'main', false),
    (v_sec5, v_layout, 5, 'Supporting Documents',    1, 'Related', 'main', false);

  INSERT INTO page_layout_widgets (page_layout_widget_record_number, page_layout_id, section_id, widget_type, widget_title, widget_column, widget_position, widget_config) VALUES
  -- Section 1: status + identity. Name is auto-derived (no typed field).
  ('', v_layout, v_sec1, 'status_path', 'Status Path', 1, 1,
   '{"status_field":"enrollment_status","show_guidance":true,"show_completed_count":true}'::jsonb),
  ('', v_layout, v_sec1, 'field_group', 'Enrollment', 1, 2,
   '{"fields":[
      {"name":"property_id","type":"lookup","label":"Property","required":true,"column":1,"lookup_table":"properties","lookup_field":"property_name"},
      {"name":"opportunity_id","type":"lookup","label":"Opportunity","column":1,"lookup_table":"opportunities","lookup_field":"opportunity_name","lookup_dependency":{"kind":"opportunities_for_property","depends_on":["property_id"]}},
      {"name":"enrollment_record_type","type":"picklist","label":"Record Type","column":2},
      {"name":"enrollment_status","type":"picklist","label":"Status","column":2},
      {"name":"enrollment_owner","type":"lookup","label":"Owner","column":2,"lookup_table":"users","lookup_field":"user_name"}
   ]}'::jsonb),
  -- Section 2: Contractor Information. Pick the registered-contractor account;
  -- name/email/primary address are read live from that account (related fields).
  ('', v_layout, v_sec2, 'field_group', 'Contractor Information', 1, 1,
   '{"fields":[
      {"name":"enrollment_contractor_account_id","type":"lookup","label":"Registered Contractor","column":1,"lookup_table":"accounts","lookup_field":"account_name"},
      {"name":"enrollment_contractor_account_id.account_name","type":"related_field","label":"Contractor Name","column":1,"related":{"table":"accounts","column":"account_name","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.account_email","type":"related_field","label":"Contractor Email","column":2,"related":{"table":"accounts","column":"account_email","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_street","type":"related_field","label":"Primary Address","column":1,"related":{"table":"accounts","column":"billing_street","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_city","type":"related_field","label":"City","column":1,"related":{"table":"accounts","column":"billing_city","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_state","type":"related_field","label":"State","column":2,"related":{"table":"accounts","column":"billing_state","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_contractor_account_id.billing_zip","type":"related_field","label":"ZIP","column":2,"related":{"table":"accounts","column":"billing_zip","fk_column":"enrollment_contractor_account_id","column_type":"text"}},
      {"name":"enrollment_payment_address_different","type":"boolean","label":"Payment address different from primary?","column":1},
      {"name":"enrollment_payment_address_line1","type":"text","label":"Payment Address","column":1},
      {"name":"enrollment_payment_city","type":"text","label":"Payment City","column":1},
      {"name":"enrollment_payment_state","type":"text","label":"Payment State","column":2},
      {"name":"enrollment_payment_zip","type":"text","label":"Payment ZIP","column":2}
   ]}'::jsonb),
  -- Section 3: Property & Owner
  ('', v_layout, v_sec3, 'field_group', 'Property & Owner', 1, 1,
   '{"fields":[
      {"name":"enrollment_owner_organization","type":"text","label":"Property Owner Name","required":true,"column":1},
      {"name":"enrollment_property_addresses","type":"textarea","label":"Property Address(es)","required":true,"column":1},
      {"name":"enrollment_modeling_approach","type":"picklist","label":"How Will the Property Be Modeled?","required":true,"column":1},
      {"name":"enrollment_property_type","type":"picklist","label":"Property Type","required":true,"column":2},
      {"name":"enrollment_number_of_buildings","type":"integer","label":"Number of Buildings","required":true,"column":2},
      {"name":"enrollment_units_per_building","type":"integer","label":"Number of Units per Building (if MF or SF attached)","column":2}
   ]}'::jsonb),
  -- Section 4: Incentive Request
  ('', v_layout, v_sec4, 'field_group', 'Incentive Request', 1, 1,
   '{"fields":[
      {"name":"enrollment_requested_incentive_amount","type":"currency","label":"Requested Incentive Amount","required":true,"column":1},
      {"name":"enrollment_property_lea_numbers","type":"text","label":"Property LEA#s","column":1},
      {"name":"enrollment_building_details","type":"textarea","label":"Building Details","required":true,"column":1},
      {"name":"enrollment_estimated_assessment_date","type":"date","label":"Estimated Assessment Date","column":2}
   ]}'::jsonb),
  -- Section 5: Supporting Documents (Related tab)
  ('', v_layout, v_sec5, 'file_gallery', 'Supporting Documents', 1, 1,
   '{"target":"documents","document_type":"attachment"}'::jsonb);
END $$;

-- 4) Drop the superseded free-text contractor columns (no data; no active
--    widget references them after the rebuild above).
ALTER TABLE public.enrollments
  DROP COLUMN IF EXISTS enrollment_contractor_name,
  DROP COLUMN IF EXISTS enrollment_contractor_email,
  DROP COLUMN IF EXISTS enrollment_contractor_primary_address_line1,
  DROP COLUMN IF EXISTS enrollment_contractor_primary_city,
  DROP COLUMN IF EXISTS enrollment_contractor_primary_state,
  DROP COLUMN IF EXISTS enrollment_contractor_primary_zip;

NOTIFY pgrst, 'reload schema';
