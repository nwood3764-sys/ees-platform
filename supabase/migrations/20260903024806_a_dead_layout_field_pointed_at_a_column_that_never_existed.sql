-- A dead layout field pointed at a column that never existed.
--
-- The WI-IRA-MF-HOMES-AUDIT incentive application layout carries
-- `ia_payment_address_different`, labelled "Payment address different from
-- primary?", in its Contractor Information section. There is no such column on
-- incentive_applications. The field renders with nothing behind it and can
-- never save.
--
-- Found because validate_page_layout_widget_config() refuses ANY update to a
-- widget carrying an unknown column -- so this one row silently blocked an
-- unrelated change to every field beside it. Same shape as the clone defect of
-- 2026-08-23: a layout can hold a broken reference indefinitely and only bites
-- when something rewrites the row.
--
-- THE REAL COLUMN HAS THE OPPOSITE SENSE. `ia_mailing_same_as_primary_contractor`
-- asks whether the address is the SAME; the dead field asked whether it is
-- DIFFERENT. Repointing the field and keeping the label would invert the
-- question -- a tick would come to mean its opposite on a payment address. So
-- the label is corrected to the column's own meaning, matching the wording every
-- other layout already uses for it ("Check if same as Primary Contractor
-- Address"), rather than the column being bent to fit a label.

UPDATE public.page_layout_widgets w
   SET widget_config = jsonb_set(w.widget_config, '{fields}', (
         SELECT jsonb_agg(
           CASE WHEN f->>'name' = 'ia_payment_address_different'
                THEN f || jsonb_build_object(
                       'name','ia_mailing_same_as_primary_contractor',
                       'type','boolean',
                       'label','Check if same as Primary Contractor Address')
                ELSE f END ORDER BY ord)
         FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)))
 WHERE w.widget_config ? 'fields'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') f
                WHERE f->>'name' = 'ia_payment_address_different');

NOTIFY pgrst, 'reload schema';

DO $assert$
DECLARE v_left int; v_fixed int;
BEGIN
  SELECT count(*) INTO v_left
    FROM public.page_layout_widgets w
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
   WHERE f->>'name' = 'ia_payment_address_different';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'The dead field is still placed % times', v_left;
  END IF;

  SELECT count(*) INTO v_fixed
    FROM public.page_layout_widgets w
    JOIN public.page_layout_sections s ON s.id = w.section_id
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
    JOIN public.picklist_values rt ON rt.id = pl.record_type_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
   WHERE rt.picklist_value = 'WI-IRA-MF-HOMES-AUDIT'
     AND pl.page_layout_object = 'incentive_applications'
     AND f->>'name' = 'ia_mailing_same_as_primary_contractor';
  IF v_fixed < 1 THEN
    RAISE EXCEPTION 'The corrected field did not land on the audit layout.';
  END IF;
END $assert$;
