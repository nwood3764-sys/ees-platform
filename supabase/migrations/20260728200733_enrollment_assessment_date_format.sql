-- Display the WI-IRA-MF-HOMES-ASSESSMENT enrollment's Estimated Assessment Date
-- with a 2-digit year (MM/DD/YY) to match the external program form. The field
-- stays a real date; only its display format changes (honored by
-- formatFieldValue via the field's "format" key).

UPDATE page_layout_widgets
SET widget_config = '{"fields":[
      {"name":"enrollment_requested_incentive_amount","type":"currency","label":"Requested Incentive Amount","required":true,"column":1},
      {"name":"enrollment_property_lea_numbers","type":"text","label":"Property LEA#s","column":1},
      {"name":"enrollment_building_details","type":"textarea","label":"Building Details","required":true,"column":1},
      {"name":"enrollment_estimated_assessment_date","type":"date","label":"Estimated Assessment Date","column":2,"format":"MM/DD/YY"}
    ]}'::jsonb,
    updated_at = now()
WHERE page_layout_id='68d28e30-2369-42e6-9baf-a2bad552cae3'
  AND widget_title='Incentive Request'
  AND widget_type='field_group'
  AND is_deleted IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
