-- Pin search_path on the incentive-application helper functions added this
-- session, clearing the function_search_path_mutable advisor warnings. Every
-- reference inside these functions is already schema-qualified (public.*), so an
-- empty search_path is safe and removes the search-path-hijack surface.

ALTER FUNCTION public.incentive_application_autoname()                        SET search_path = '';
ALTER FUNCTION public.picklist_value_translate(uuid, text, text)             SET search_path = '';
ALTER FUNCTION public.build_ia_payment_request_prefill(uuid)                 SET search_path = '';

NOTIFY pgrst, 'reload schema';
