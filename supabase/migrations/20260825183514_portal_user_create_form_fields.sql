-- =============================================================================
-- Portal Users: a portal user can actually be created from the pop-up.
--
-- Creating a Program Manager User for Everblue is the first step of testing the
-- Program Manager Portal, and three things on the Standard Portal Users Layout
-- stood in the way:
--
--   • portal_role is declared `text` on the layout but is a uuid FK to
--     picklist_values, and it is NOT NULL — so the one field the create pop-up
--     insists on rendered as a text box asking, in effect, for a uuid. Declared
--     as the picklist it is, so the six roles are offered by name.
--
--   • The account was optional. A portal user with no account cannot be scoped
--     at all: the program portal reads the organisation from it, the download
--     gate reads account_allow_portal_download from it, and the owner portal's
--     account guard joins through it. Required.
--
--   • The email was optional. It is how the person is identified and the address
--     any future invitation goes to. Required.
--
-- `status` is deliberately left alone. Its column is text and holds the picklist
-- LABEL ('Portal User Active') while the picklist row's value is snake_case, so
-- typing it as a picklist would store an id where every gate compares a label.
-- It carries a working default and the create form never asks for it. Worth a
-- separate decision, not a silent change here.
-- =============================================================================

WITH target AS (
  SELECT w.id AS widget_id, w.widget_config
    FROM public.page_layout_widgets w
    JOIN public.page_layout_sections s ON s.id = w.section_id
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
   WHERE pl.page_layout_object = 'portal_users'
     AND pl.is_deleted IS NOT TRUE
     AND s.is_deleted IS NOT TRUE
     AND w.is_deleted IS NOT TRUE
     AND w.widget_type = 'field_group'
     AND w.widget_config->'fields' @> '[{"name":"portal_role"}]'::jsonb
), rebuilt AS (
  SELECT t.widget_id,
         jsonb_set(t.widget_config, '{fields}', (
           SELECT jsonb_agg(
                    CASE
                      WHEN f->>'name' = 'portal_role'
                        THEN f || '{"type":"picklist","required":true}'::jsonb
                      WHEN f->>'name' IN ('email', 'portal_user_account_id')
                        THEN f || '{"required":true}'::jsonb
                      ELSE f
                    END
                    ORDER BY ord)
             FROM jsonb_array_elements(t.widget_config->'fields') WITH ORDINALITY AS e(f, ord)
         )) AS new_config
    FROM target t
)
UPDATE public.page_layout_widgets w
   SET widget_config = r.new_config,
       updated_at    = now()
  FROM rebuilt r
 WHERE w.id = r.widget_id;

-- Assert rather than assume: the pop-up is unusable if any of the three missed.
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.page_layout_widgets w
    JOIN public.page_layout_sections s ON s.id = w.section_id
    JOIN public.page_layouts pl ON pl.id = s.page_layout_id
   WHERE pl.page_layout_object = 'portal_users'
     AND pl.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE AND w.is_deleted IS NOT TRUE
     AND w.widget_config->'fields' @> '[{"name":"portal_role"}]'::jsonb
     AND NOT (
       w.widget_config->'fields' @> '[{"name":"portal_role","type":"picklist","required":true}]'::jsonb
       AND w.widget_config->'fields' @> '[{"name":"email","required":true}]'::jsonb
       AND w.widget_config->'fields' @> '[{"name":"portal_user_account_id","required":true}]'::jsonb
     );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Portal Users layout not fully updated (% widget(s) still wrong)', v_bad;
  END IF;
END $$;
