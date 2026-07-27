-- Add "Public Housing Authority Owned" to the Subsidized Type picklist on properties.
--
-- The Subsidized Type dropdown on the property record page is driven by
-- picklist_values rows where picklist_object = 'properties' and
-- picklist_field = 'property_subsidy_type'. The properties.property_subsidy_type
-- column is a uuid FK to picklist_values.id, so adding this option is a pure
-- additive picklist_values insert -- no column or constraint change needed.
-- fetchPicklistOptions() renders active values alphabetically by label, so the
-- sort order is cosmetic; it is appended after the existing values.
--
-- Idempotent: guarded so re-running (or a branch-database replay) does not
-- create a duplicate value for this object/field.

INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order, picklist_state)
SELECT
  'properties', 'property_subsidy_type', 'Public Housing Authority Owned', 'Public Housing Authority Owned', true, 7, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values
  WHERE picklist_object = 'properties'
    AND picklist_field  = 'property_subsidy_type'
    AND picklist_value  = 'Public Housing Authority Owned'
);
