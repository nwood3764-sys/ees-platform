-- Installation Building: match the payment JotForm exactly. Only the 6 fields on
-- the payment form (Business Entity Name, Contact Name, Email, Phone Number,
-- Building Owner Name, Installation Address). Reservation-only fields removed
-- (units, occupied, sq footage, floors, year, income level, confirmation code,
-- project cost). Address is full-width via column-2 spacers so the left-column
-- fields don't get a mismatched partner (the renderer is column-fill).
DO $$
DECLARE v_layout uuid; v_s5 uuid;
BEGIN
  SELECT pl.id INTO v_layout FROM public.page_layouts pl
  JOIN public.picklist_values rt ON rt.id = pl.record_type_id
  WHERE pl.page_layout_object='incentive_applications'
    AND rt.picklist_value='WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST' AND pl.is_deleted IS NOT TRUE;
  IF v_layout IS NULL THEN RETURN; END IF;
  SELECT id INTO v_s5 FROM public.page_layout_sections
   WHERE page_layout_id=v_layout AND section_label='Installation Building Information' AND is_deleted IS NOT TRUE;

  UPDATE public.page_layout_widgets SET updated_at=now(), widget_config =
   '{"fields": [
     {"name": "property_id.property_hud_owner_org", "type": "related_field", "label": "Business Entity Name", "column": 1, "related": {"table": "properties", "column": "property_hud_owner_org", "fk_column": "property_id", "column_type": "text"}},
     {"name": "ia_signer_contact_id", "type": "lookup", "label": "Contact Name", "column": 2, "lookup_table": "contacts", "lookup_field": "contact_name"},
     {"name": "ia_signer_contact_id.contact_email", "type": "related_field", "label": "Email", "column": 1, "related": {"table": "contacts", "column": "contact_email", "fk_column": "ia_signer_contact_id", "column_type": "email"}},
     {"name": "ia_signer_contact_id.contact_phone", "type": "related_field", "label": "Phone Number", "column": 2, "related": {"table": "contacts", "column": "contact_phone", "fk_column": "ia_signer_contact_id", "column_type": "phone"}},
     {"name": "property_id.property_hud_owner_org", "type": "related_field", "label": "Building Owner Name", "column": 1, "related": {"table": "properties", "column": "property_hud_owner_org", "fk_column": "property_id", "column_type": "text"}},
     {"type": "spacer", "column": 2, "spacer_id": "ib1"},
     {"name": "property_id.property_street", "type": "related_field", "label": "Installation Address", "column": 1, "related": {"table": "properties", "column": "property_street", "fk_column": "property_id", "column_type": "text"}},
     {"type": "spacer", "column": 2, "spacer_id": "ib2"},
     {"name": "property_id.property_city", "type": "related_field", "label": "City", "column": 1, "related": {"table": "properties", "column": "property_city", "fk_column": "property_id", "column_type": "text"}},
     {"type": "spacer", "column": 2, "spacer_id": "ib3"},
     {"name": "property_id.property_state", "type": "related_field", "label": "State / Province", "column": 1, "related": {"table": "properties", "column": "property_state", "fk_column": "property_id", "column_type": "text"}, "format": "us_state_abbrev"},
     {"type": "spacer", "column": 2, "spacer_id": "ib4"},
     {"name": "property_id.property_zip", "type": "related_field", "label": "Postal / Zip Code", "column": 1, "related": {"table": "properties", "column": "property_zip", "fk_column": "property_id", "column_type": "text"}},
     {"type": "spacer", "column": 2, "spacer_id": "ib5"}
   ]}'::jsonb
  WHERE page_layout_id=v_layout AND section_id=v_s5 AND widget_type='field_group' AND is_deleted IS NOT TRUE;
END $$;
