-- Opportunity Contact Roles related list + wired Authorized Signer on ALL opportunity layouts
-- ===========================================================================================
-- Context (Nicholas, 2026-07-29): on OPP-00066 (record type WI-IRA-MF-HOMES) the
-- Authorized Signer field renders a raw contact UUID instead of the contact's name,
-- and the "Opportunity Contact Roles" related list is missing entirely — even though
-- the data is all correct (Dennis Hanson is the Decision Maker / signer, and three
-- Opportunity Contact Roles exist on the opportunity).
--
-- Root cause: the contact-role work (migrations 20260728163337 / 20260728172633 /
-- 20260728191504) wired the Authorized Signer picker as a dependent lookup and added
-- a "Contact Roles" related list to every opportunity page layout EXCEPT one —
-- "WI-IRA-HOMES" (id cc3dc4cf-5963-440c-b985-5ccfd8394aff), which is the default
-- layout the WI-IRA-MF-HOMES record type resolves to. On that layout the signer field
-- was never upgraded from its original plain form
--   {"name":"opportunity_authorized_signer_id","label":"Opportunity Authorized Signer","column":2}
-- (no type / no lookup wiring → renders the stored UUID), and no contact-roles related
-- list was ever added.
--
-- This migration brings that one layout in line with all the others. It is additive and
-- idempotent: it only rewrites the signer field where it is still un-wired and only
-- inserts the related list where it does not already exist. Both changes match the exact
-- shapes used on the sibling layouts (e.g. WI-IRA-MF-HOMES-Audit), so the field and list
-- render identically.

-- 1) Wire the Authorized Signer field as a Decision-Maker-scoped contact lookup on any
--    opportunity layout where it is still the plain, un-wired field. Preserves the
--    field's existing column placement.
UPDATE public.page_layout_widgets pw
SET widget_config = jsonb_set(
      pw.widget_config,
      '{fields}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN f->>'name' = 'opportunity_authorized_signer_id'
             AND NOT (f ? 'lookup_dependency')
            THEN jsonb_strip_nulls(jsonb_build_object(
                   'name',   'opportunity_authorized_signer_id',
                   'type',   'lookup',
                   'label',  'Authorized Signer',
                   'column', f->'column',
                   'lookup_field', 'contact_name',
                   'lookup_table', 'contacts',
                   'lookup_dependency', jsonb_build_object(
                     'kind', 'signer_contacts_for_opportunity',
                     'depends_on', jsonb_build_array(
                       'id',
                       'opportunity_account_id',
                       'opportunity_managing_account_id',
                       'opportunity_property_management_company'
                     )
                   )
                 ))
            ELSE f
          END
        )
        FROM jsonb_array_elements(pw.widget_config->'fields') f
      )
    )
WHERE pw.is_deleted = false
  AND pw.page_layout_id IN (
        SELECT id FROM public.page_layouts
        WHERE page_layout_object = 'opportunities' AND is_deleted = false
      )
  AND pw.widget_config ? 'fields'
  AND pw.widget_config->'fields' @> '[{"name":"opportunity_authorized_signer_id"}]'::jsonb
  AND NOT (pw.widget_config->'fields'
           @> '[{"name":"opportunity_authorized_signer_id","lookup_dependency":{"kind":"signer_contacts_for_opportunity"}}]'::jsonb);

-- 2) Add the "Contact Roles" related list to EVERY opportunity layout that does not
--    already have one — Nicholas: "all opportunity records need an opportunity contact
--    roles related list ... no matter what their name is." Today only WI-IRA-HOMES is
--    missing it, but scoping this to "any opportunity layout without the list" keeps
--    every current and future layout in line rather than one-off patching. For each such
--    layout the widget is placed in a section that already holds related lists (falling
--    back to the layout's first section), at the next open position. Guarded so
--    re-running inserts nothing. The record number is filled by
--    trg_page_layout_widget_record_number; the config is validated by
--    trg_validate_page_layout_widget_config.
INSERT INTO public.page_layout_widgets
  (id, page_layout_widget_record_number, page_layout_id, section_id, widget_type, widget_title,
   widget_column, widget_position, widget_size, widget_config,
   widget_is_user_customizable, widget_is_required, is_deleted)
SELECT
  gen_random_uuid(),
  '',
  pl.id,
  tgt.section_id,
  'related_list',
  'Contact Roles',
  1,
  tgt.next_pos,
  'medium',
  '{"fk":"opportunity_id","table":"opportunity_contact_roles","title":"Contact Roles","columns":[{"name":"ocr_record_number","type":"text","label":"Record #"},{"name":"ocr_role","type":"picklist","label":"Contact Role"},{"name":"contact_id","type":"lookup","label":"Contact","fk_column":"contact_id","lookup_field":"contact_name","lookup_table":"contacts"}],"sort_dir":"desc","sort_field":"ocr_created_at","is_deleted_col":"ocr_is_deleted"}'::jsonb,
  true,
  false,
  false
FROM public.page_layouts pl
CROSS JOIN LATERAL (
  -- Pick a target section on this layout: prefer one that already holds related lists,
  -- otherwise the earliest section. next_pos = one past the last widget in that section.
  SELECT s.section_id,
         (SELECT COALESCE(MAX(w2.widget_position), 0) + 1
            FROM public.page_layout_widgets w2
           WHERE w2.section_id = s.section_id AND w2.is_deleted = false) AS next_pos
  FROM (
    SELECT w.section_id,
           bool_or(w.widget_type = 'related_list') AS has_related_list,
           MIN(w.widget_position) AS min_pos
    FROM public.page_layout_widgets w
    WHERE w.page_layout_id = pl.id AND w.is_deleted = false AND w.section_id IS NOT NULL
    GROUP BY w.section_id
  ) s
  ORDER BY s.has_related_list DESC, s.min_pos
  LIMIT 1
) tgt
WHERE pl.page_layout_object = 'opportunities'
  AND pl.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM public.page_layout_widgets w
    WHERE w.page_layout_id = pl.id
      AND w.is_deleted = false
      AND w.widget_config->>'table' = 'opportunity_contact_roles'
  );

NOTIFY pgrst, 'reload schema';
