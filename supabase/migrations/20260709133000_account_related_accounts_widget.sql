-- =====================================================================
-- Account page layouts: "Related Accounts" related list
--
-- Owner organizations are layered — holding companies, property LLCs,
-- management subsidiaries, partnerships — modeled with the existing
-- accounts.parent_account_id lookup. The hierarchy was invisible on the
-- account record (only the Parent Account field on Details). This adds
-- a Related Accounts related list (child accounts of this account) to
-- the Related Records section of every account page layout, alongside
-- Properties / Contacts / Opportunities.
-- =====================================================================

INSERT INTO public.page_layout_widgets (
  page_layout_widget_record_number, page_layout_id, section_id,
  widget_type, widget_title, widget_column, widget_position, widget_size,
  widget_config, widget_is_user_customizable, widget_is_required
)
SELECT
  '', pl.id, s.id,
  'related_list', 'Related Accounts', 1,
  COALESCE((
    SELECT max(w.widget_position) + 1 FROM public.page_layout_widgets w
    WHERE w.section_id = s.id AND w.is_deleted IS NOT TRUE
  ), 1),
  'medium',
  jsonb_build_object(
    'table', 'accounts',
    'fk', 'parent_account_id',
    'title', 'Related Accounts',
    'columns', jsonb_build_array(
      jsonb_build_object('name','account_record_number','type','text','label','Record #'),
      jsonb_build_object('name','account_name','type','text','label','Name'),
      jsonb_build_object('name','account_website','type','text','label','Website'),
      jsonb_build_object('name','account_created_at','type','datetime','label','Created')
    ),
    'sort_field', 'account_name',
    'sort_dir', 'asc',
    'is_deleted_col', 'account_is_deleted'
  ),
  true, false
FROM public.page_layouts pl
JOIN public.page_layout_sections s
  ON s.page_layout_id = pl.id
 AND s.section_label = 'Related Records'
 AND s.is_deleted IS NOT TRUE
WHERE pl.page_layout_object = 'accounts'
  AND pl.is_deleted IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.page_layout_widgets w
    WHERE w.section_id = s.id
      AND w.widget_type = 'related_list'
      AND w.widget_config->>'table' = 'accounts'
      AND w.widget_config->>'fk' = 'parent_account_id'
      AND w.is_deleted IS NOT TRUE
  );

NOTIFY pgrst, 'reload schema';
