-- Seed the level-1 grouping each Enrollment-dashboard summary report is "by".
-- The four reports (Opportunities by Stage, Opportunity Pipeline by State,
-- Enrollments by Status, Properties by Status) selected only their group field
-- but had zero report_groupings, so opening them (incl. via a widget segment
-- drill) hit the "needs at least one grouping" empty state. Level is 1 (the
-- rgr_grouping_level check constraint is 1..6). Applied via MCP 2026-06-21.

INSERT INTO report_groupings
  (rgr_report_id, rgr_grouping_level, rgr_field_name, rgr_field_table,
   rgr_field_via_path, rgr_field_label, rgr_sort_direction, rgr_show_subtotal)
VALUES
  ('4a7cb0da-1233-4b62-9393-08239758c6ea', 1, 'opportunity_stage', 'opportunities', NULL, 'Stage', 'asc', true),
  ('6989a362-abf2-4940-83c2-f0b49baa6c29', 1, 'opportunity_state', 'opportunities', NULL, 'State', 'asc', true),
  ('ec3a47b0-0b34-49f5-83d3-dc192e01d672', 1, 'enrollment_status', 'enrollments', NULL, 'Status', 'asc', true),
  ('f2480ac9-67df-412f-8f66-e27cc2c37570', 1, 'property_status', 'properties', NULL, 'Status', 'asc', true);
