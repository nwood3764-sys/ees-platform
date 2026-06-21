-- Module id cleanup. The Enrollment and Outreach apps had swapped ids:
--   Enrollment app was id 'outreach'            -> 'enrollment'
--   Outreach app   was id 'outreach_properties' -> 'outreach'
-- Sentinel avoids the transient collision. Applied via MCP 2026-06-21.
UPDATE public.module_sections SET ms_module_id='__enr_tmp__' WHERE ms_module_id='outreach';
UPDATE public.module_sections SET ms_module_id='outreach'   WHERE ms_module_id='outreach_properties';
UPDATE public.module_sections SET ms_module_id='enrollment' WHERE ms_module_id='__enr_tmp__';
UPDATE public.saved_list_views SET list_view_module='__enr_tmp__' WHERE list_view_module='outreach';
UPDATE public.saved_list_views SET list_view_module='outreach'   WHERE list_view_module='outreach_properties';
UPDATE public.saved_list_views SET list_view_module='enrollment' WHERE list_view_module='__enr_tmp__';
UPDATE public.home_pages SET hp_module_id='__enr_tmp__' WHERE hp_module_id='outreach';
UPDATE public.home_pages SET hp_module_id='outreach'   WHERE hp_module_id='outreach_properties';
UPDATE public.home_pages SET hp_module_id='enrollment' WHERE hp_module_id='__enr_tmp__';
