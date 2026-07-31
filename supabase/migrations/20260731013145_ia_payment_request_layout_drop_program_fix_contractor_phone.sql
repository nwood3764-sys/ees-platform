-- Project Payment Request layout tweaks:
--   1. Remove the PROGRAM lookup from the top section — it isn't used.
--   2. Source the contractor phone from the listed CONTACT (contact_phone),
--      not the account. The account phone is often blank while the contact
--      carries the number, so the field rendered "—" even with a contact set.
--      (Email stays on the account, where it currently resolves.)

DO $$
DECLARE
  v_layout    uuid;
  w           record;
  new_fields  jsonb;
BEGIN
  SELECT pl.id INTO v_layout
  FROM public.page_layouts pl
  JOIN public.picklist_values rt ON rt.id = pl.record_type_id
  WHERE pl.page_layout_object = 'incentive_applications'
    AND rt.picklist_value = 'WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST'
    AND pl.is_deleted IS NOT TRUE;

  IF v_layout IS NULL THEN RETURN; END IF;

  FOR w IN
    SELECT id, widget_config FROM public.page_layout_widgets
    WHERE page_layout_id = v_layout AND widget_type = 'field_group' AND is_deleted IS NOT TRUE
  LOOP
    SELECT jsonb_agg(
      CASE
        WHEN f->>'name' = 'ia_contractor_account_id.account_phone' THEN
          jsonb_build_object(
            'name','ia_contractor_contact_id.contact_phone','type','related_field',
            'label', f->>'label', 'column', f->'column',
            'related', jsonb_build_object('table','contacts','column','contact_phone',
              'fk_column','ia_contractor_contact_id','column_type','phone'))
        WHEN f->>'name' = 'ia_support_contractor_account_id.account_phone' THEN
          jsonb_build_object(
            'name','ia_support_contractor_contact_id.contact_phone','type','related_field',
            'label', f->>'label', 'column', f->'column',
            'related', jsonb_build_object('table','contacts','column','contact_phone',
              'fk_column','ia_support_contractor_contact_id','column_type','phone'))
        ELSE f
      END
      ORDER BY ord)
    INTO new_fields
    FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)
    WHERE f->>'name' <> 'program_id';

    UPDATE public.page_layout_widgets
    SET widget_config = jsonb_set(widget_config, '{fields}', COALESCE(new_fields, '[]'::jsonb)),
        updated_at = now()
    WHERE id = w.id;
  END LOOP;
END $$;
