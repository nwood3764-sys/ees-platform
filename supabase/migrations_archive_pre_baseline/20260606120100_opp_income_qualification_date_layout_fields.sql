-- Swap the income-qualification yes/no boolean fields on the opportunity
-- layouts for date fields, and add the qualification-analysis start/complete
-- dates. Scoped to the five WI-IRA layouts that actually carry these fields
-- (10 field-group widgets; HOMES, HEAR, FOE-SF-HOMES, MF-HOMES-Audit,
-- SF-HOMES-AUDIT). Other opportunity layouts never referenced these fields.
--
-- The four date columns were added in 20260606120000_opp_income_qualification_dates;
-- the old booleans were renamed *_del there. These widget configs are rewritten
-- to point at the new *_date columns with type "date" so the record detail
-- renders date pickers.

-- WI-IRA-HOMES / MF-HOMES-Audit / SF-HOMES-AUDIT / FOE-SF-HOMES: title
-- "Income Qualification", fields = [submitted, approved, ira_income_code].
UPDATE page_layout_widgets SET widget_config = jsonb_build_object('fields', jsonb_build_array(
  jsonb_build_object('name','opportunity_income_qualification_submitted_date','type','date','label','Income Qualification Application Submitted'),
  jsonb_build_object('name','opportunity_income_qualification_approved_date','type','date','label','Income Qualification Approved'),
  jsonb_build_object('name','opportunity_qualification_analysis_start_date','type','date','label','Qualification Analysis Started'),
  jsonb_build_object('name','opportunity_qualification_analysis_completed_date','type','date','label','Qualification Analysis Completed'),
  jsonb_build_object('name','opportunity_ira_income_code','type','text','label','IRA Income Code')
))
WHERE id IN (
  '23bd55a2-2140-4df3-b754-de16cbc9eb6c',
  'b7ae6f20-c06f-44ce-acbe-dd2abd39cce3',
  '19db6617-2623-4777-ad09-88401e6aceb2',
  'fd55b0b5-e029-4f28-87bb-a64496f0e55c',
  '10dded74-2ca7-4c7f-a076-557d1e3ce9ea',
  '730e6597-fe96-4c85-a538-caaa78890758',
  '971036cd-35c9-4ed1-acff-7c4e9295dd0c',
  '9c79eb5f-8aef-4eaf-9b85-06c97d999b8b'
);

-- WI-IRA-HEAR: title "Qualification Information". Convert the income-
-- qualification booleans to dates, add analysis dates, leave the Homes
-- Application booleans untouched (separate concern).
UPDATE page_layout_widgets SET widget_config = jsonb_build_object('fields', jsonb_build_array(
  jsonb_build_object('name','opportunity_income_qualification_submitted_date','type','date','label','Income Qualification Application Submitted'),
  jsonb_build_object('name','opportunity_income_qualification_approved_date','type','date','label','Income Qualification Approved'),
  jsonb_build_object('name','opportunity_qualification_analysis_start_date','type','date','label','Qualification Analysis Started'),
  jsonb_build_object('name','opportunity_qualification_analysis_completed_date','type','date','label','Qualification Analysis Completed'),
  jsonb_build_object('name','opportunity_homes_application_submitted','type','boolean','label','Homes Application Submitted'),
  jsonb_build_object('name','opportunity_homes_application_approved','type','boolean','label','Homes Application Approved')
))
WHERE id IN (
  'a026642d-a797-4841-b0f3-e25b68d04706',
  '0698a084-f8f5-451f-83c2-30c3eee1aa91'
);
