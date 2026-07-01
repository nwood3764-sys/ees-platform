-- =====================================================================
-- Expand activity_type picklist for the general Log Activity composer (v2)
--
-- The Log a Call composer is generalized into a Salesforce-style "Log
-- Activity" composer where the user picks the activity type. This seeds the
-- fuller managed picklist (Call, Email, Meeting, Site Visit, Event, Text
-- Message, Note, Other). Idempotent — only inserts values not already
-- present; admins can add or relabel more in LEAP Admin.
-- =====================================================================

INSERT INTO public.picklist_values
  (id, picklist_object, picklist_field, picklist_value, picklist_label,
   picklist_is_active, picklist_sort_order, picklist_created_at)
SELECT gen_random_uuid(), 'activities', 'activity_type', v.value, v.label,
       true, v.sort_order, now()
FROM (VALUES
  ('Call',         'Call',          10),
  ('Email',        'Email',         20),
  ('Meeting',      'Meeting',       30),
  ('Site Visit',   'Site Visit',    40),
  ('Event',        'Event',         50),
  ('Text Message', 'Text Message',  60),
  ('Note',         'Note',          70),
  ('Other',        'Other',         80)
) AS v(value, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object = 'activities'
    AND p.picklist_field  = 'activity_type'
    AND p.picklist_value  = v.value
);

-- Re-align sort order for the values seeded in v1.
UPDATE public.picklist_values SET picklist_sort_order = m.sort_order
FROM (VALUES
  ('Call',10),('Email',20),('Meeting',30),('Site Visit',40),
  ('Event',50),('Text Message',60),('Note',70),('Other',80)
) AS m(value, sort_order)
WHERE picklist_object='activities' AND picklist_field='activity_type'
  AND picklist_value = m.value;
