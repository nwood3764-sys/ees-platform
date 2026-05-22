-- The frontend reads action config for ANY user opening a record. Match
-- page_layouts' open-read SELECT policy; writes remain admin-gated via
-- app_user_can('page_layout_actions','update'|'delete') and the existing
-- role_object_access seed pattern.
DROP POLICY IF EXISTS app_select_page_layout_actions ON public.page_layout_actions;
CREATE POLICY app_select_page_layout_actions
  ON public.page_layout_actions FOR SELECT TO authenticated
  USING (true);

-- Seed role_object_access for Admin so the action-tab UI in LayoutEditor
-- can write rows. Matches the outbound_mailboxes pattern.
INSERT INTO public.role_object_access (roa_role_id, roa_object_name, roa_read, roa_create, roa_update, roa_delete)
SELECT r.id, 'page_layout_actions', true, true, true, true
FROM public.roles r
WHERE r.role_name = 'Admin'
ON CONFLICT DO NOTHING;
