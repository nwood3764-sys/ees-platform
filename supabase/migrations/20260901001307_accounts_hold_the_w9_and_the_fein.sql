-- A W-9 slot on the account, and the FEIN where the payee accounts can see it.
--
-- The payment request already pulls the contractor's W-9, but there was nowhere
-- on the account to put one: all eight account layouts carry a single generic
-- Documents gallery of type 'attachment'. The one W-9 in the platform, on
-- Maintenance At Best Mechanical LLC, was invisible on its own account page.
--
-- The finding that shapes this: Sealed Inc, Energy Efficiency Services of
-- Wisconsin and Maintenance At Best are all record type SERVICE-PROVIDER, and
-- there is NO Service Provider account layout -- they fall back to the default,
-- PL-00162. So the FEIN field, which exists only on the CONTRACTOR layout, had
-- never been visible on a single account this programme actually pays. "The
-- FEIN field already exists" was true of the column and wrong about the screen.
--
-- So the W-9 gallery goes on the default layout (what the payee accounts
-- render) and on Contractor and Vendor, the other payee-shaped types; the FEIN
-- field goes on the default layout beside the billing details it belongs with.
--
-- Typed 'w9', which is exactly the document type the payment request
-- inheritance reads -- upload once on the account, and every payment request
-- created for that contractor copies it in.

INSERT INTO public.page_layout_widgets
  (page_layout_widget_record_number, page_layout_id, section_id, widget_title, widget_type,
   widget_config, widget_position, widget_column)
SELECT '', pl.id, s.id, 'W-9', 'file_gallery',
       jsonb_build_object('target','documents','document_type','w9',
                          'help_text','The payee''s W-9. Held once here; a payment request created for this contractor copies it in automatically.'),
       coalesce((select max(w2.widget_position) from public.page_layout_widgets w2
                  where w2.section_id = s.id and w2.is_deleted is not true), 0) + 1,
       1
FROM public.page_layouts pl
JOIN public.page_layout_sections s
  ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE AND s.section_label = 'Documents'
WHERE pl.page_layout_object = 'accounts'
  AND pl.is_deleted IS NOT TRUE
  AND pl.page_layout_record_number IN ('PL-00162','PL-00164','PL-00169')
  AND NOT EXISTS (
    SELECT 1 FROM public.page_layout_widgets w3
     WHERE w3.section_id = s.id AND w3.is_deleted IS NOT TRUE
       AND w3.widget_config->>'document_type' = 'w9');

UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
  w.widget_config, '{fields}',
  COALESCE(w.widget_config->'fields','[]'::jsonb)
  || jsonb_build_array(jsonb_build_object(
       'name','account_fein', 'type','text', 'label','Tax Identification FEIN', 'column',2)))
FROM public.page_layouts pl
WHERE pl.id = w.page_layout_id
  AND pl.page_layout_record_number = 'PL-00162'
  AND pl.is_deleted IS NOT TRUE
  AND w.is_deleted IS NOT TRUE
  AND w.widget_type = 'field_group'
  AND w.widget_config ? 'fields'
  AND jsonb_array_length(w.widget_config->'fields') > 5
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
     WHERE f->>'name' = 'account_fein');

DO $$
DECLARE v_galleries integer; v_fein integer;
BEGIN
  SELECT count(*) INTO v_galleries
  FROM public.page_layouts pl
  JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
  WHERE pl.page_layout_object='accounts' AND pl.is_deleted IS NOT TRUE
    AND w.widget_config->>'document_type' = 'w9';
  IF v_galleries <> 3 THEN
    RAISE EXCEPTION 'Expected a W-9 gallery on 3 account layouts, found %', v_galleries;
  END IF;

  SELECT count(*) INTO v_fein
  FROM public.page_layouts pl
  JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.page_layout_record_number='PL-00162' AND pl.is_deleted IS NOT TRUE
    AND f->>'name'='account_fein';
  IF v_fein <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one FEIN field on the default account layout, found %', v_fein;
  END IF;
END $$;
