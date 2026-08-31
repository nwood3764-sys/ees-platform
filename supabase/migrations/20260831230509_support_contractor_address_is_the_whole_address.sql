-- Support Contractor Information showed one line where a full address belongs,
-- and a blank phone number.
--
-- 1. "Support Contractor Full Address" was bound to accounts.billing_street
--    ALONE, while the Primary Contractor section beside it carries four
--    separate related fields (street / city / state / zip). The label promised
--    a full address and the binding could only ever deliver the street: a
--    related field reads exactly one parent column, it cannot compose. The
--    account had the rest all along -- Monona, Wisconsin, 53716.
--
--    Mirrored on the Primary section, field for field, including its
--    'us_state_abbrev' format (which is why Primary prints "WI" while the
--    account stores "Wisconsin"). The street field is relabelled "Support
--    Contractor Address" to match Primary's wording, since it is now the
--    street line rather than the whole thing.
--
-- 2. The phone number wiring was already correct
--    (ia_support_contractor_contact_id.contact_phone). It rendered blank
--    because the linked contact, CON-00130 Brittin Wood, has no phone -- while
--    a duplicate of the same person with the same email address, CON-00131,
--    carries 5152978316. The phone is copied onto CON-00130 from its own
--    duplicate, which unblocks every application pointing at it.
--
--    The DUPLICATE ITSELF IS NOT RESOLVED HERE. Merging two contacts, and
--    deciding whether "Energy Efficiency Services" and "Energy Efficiency
--    Services of Wisconsin" are one company or two, is a data decision for
--    Nicholas, not something to infer inside a migration.

UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(
  w.widget_config,
  '{fields}',
  (
    SELECT COALESCE(jsonb_agg(
             CASE WHEN f->>'name' = 'ia_support_contractor_account_id.billing_street'
                  THEN jsonb_set(f, '{label}', '"Support Contractor Address"')
                  ELSE f END
             ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb))
         WITH ORDINALITY AS t(f, ord)
  )
  || jsonb_build_array(
       jsonb_build_object(
         'name','ia_support_contractor_account_id.billing_city',
         'type','related_field','label','City','column',2,'full_width',true,
         'related', jsonb_build_object('table','accounts','column','billing_city',
                                       'fk_column','ia_support_contractor_account_id',
                                       'column_type','text')),
       jsonb_build_object(
         'name','ia_support_contractor_account_id.billing_state',
         'type','related_field','label','State / Province','column',1,'full_width',true,
         'format','us_state_abbrev',
         'related', jsonb_build_object('table','accounts','column','billing_state',
                                       'fk_column','ia_support_contractor_account_id',
                                       'column_type','text')),
       jsonb_build_object(
         'name','ia_support_contractor_account_id.billing_zip',
         'type','related_field','label','Postal / Zip Code','column',2,'full_width',true,
         'related', jsonb_build_object('table','accounts','column','billing_zip',
                                       'fk_column','ia_support_contractor_account_id',
                                       'column_type','text')))
)
FROM public.page_layouts pl
WHERE pl.id = w.page_layout_id
  AND pl.page_layout_record_number = 'PL-00382'
  AND pl.is_deleted IS NOT TRUE
  AND w.is_deleted IS NOT TRUE
  AND w.widget_title = 'Support Contractor Information'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
     WHERE f->>'name' = 'ia_support_contractor_account_id.billing_city');

UPDATE public.contacts tgt
SET contact_phone = src.contact_phone
FROM public.contacts src
WHERE tgt.contact_record_number = 'CON-00130'
  AND src.contact_record_number = 'CON-00131'
  AND tgt.contact_is_deleted IS NOT TRUE
  AND src.contact_is_deleted IS NOT TRUE
  AND lower(tgt.contact_email) = lower(src.contact_email)
  AND tgt.contact_phone IS NULL
  AND src.contact_phone IS NOT NULL;

DO $$
DECLARE
  v_fields  text;
  v_phone   text;
BEGIN
  SELECT string_agg(f->>'name', ', ' ORDER BY f->>'name') INTO v_fields
  FROM public.page_layouts pl
  JOIN public.page_layout_widgets w ON w.page_layout_id = pl.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.page_layout_record_number = 'PL-00382' AND pl.is_deleted IS NOT TRUE
    AND w.widget_title = 'Support Contractor Information'
    AND f->>'name' LIKE 'ia_support_contractor_account_id.%';

  IF v_fields IS DISTINCT FROM
     'ia_support_contractor_account_id.billing_city, ia_support_contractor_account_id.billing_state, ia_support_contractor_account_id.billing_street, ia_support_contractor_account_id.billing_zip' THEN
    RAISE EXCEPTION 'Support contractor address fields are: %', COALESCE(v_fields, '(none)');
  END IF;

  SELECT contact_phone INTO v_phone FROM public.contacts
   WHERE contact_record_number = 'CON-00130' AND contact_is_deleted IS NOT TRUE;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'CON-00130 still has no phone, so the support contractor phone will still render blank';
  END IF;
END $$;
