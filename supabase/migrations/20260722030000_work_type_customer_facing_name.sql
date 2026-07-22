-- Work types carried only an internal name (used on work orders, work plans,
-- and reporting) and a full-sentence customer-facing description. Customer
-- scheduling emails need a SHORT, friendly label that is distinct from the
-- precise internal name — e.g. internal "NC Energy Savers – Single-Family
-- Assessment" vs. customer "home energy assessment". Add a dedicated,
-- admin-manageable customer-facing name column instead of overloading either
-- existing field.

ALTER TABLE public.work_types
  ADD COLUMN IF NOT EXISTS work_type_customer_facing_name text;

COMMENT ON COLUMN public.work_types.work_type_customer_facing_name IS
  'Short, friendly label shown to customers in scheduling emails and the public booking page. Falls back to work_type_name when empty.';

-- Rename the NC site-visit work type to the precise internal name and give it a
-- warm customer-facing label. The public slug is unchanged, so existing booking
-- links keep working.
UPDATE public.work_types
   SET work_type_name = 'NC Energy Savers – Single-Family Assessment',
       work_type_customer_facing_name = 'home energy assessment',
       work_type_updated_at = now()
 WHERE work_type_public_slug = 'nc-energy-savers-site-visit'
   AND work_type_is_deleted = false;
