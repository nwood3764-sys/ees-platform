-- Six enrollment record types (SF/MF for WI, NC, MI) + status lifecycle.
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_state, picklist_is_active, picklist_sort_order)
VALUES
  ('enrollments','record_type','WI-IRA-SF','WI-IRA-SF','WI', true, 10),
  ('enrollments','record_type','WI-IRA-MF','WI-IRA-MF','WI', true, 20),
  ('enrollments','record_type','NC-IRA-SF','NC-IRA-SF','NC', true, 30),
  ('enrollments','record_type','NC-IRA-MF','NC-IRA-MF','NC', true, 40),
  ('enrollments','record_type','MI-IRA-SF','MI-IRA-SF','MI', true, 50),
  ('enrollments','record_type','MI-IRA-MF','MI-IRA-MF','MI', true, 60);
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_is_active, picklist_sort_order)
VALUES
  ('enrollments','status','Enrollment To Be Prepared','Enrollment To Be Prepared', true, 10),
  ('enrollments','status','Enrollment To Be Verified','Enrollment To Be Verified', true, 20),
  ('enrollments','status','Enrollment Verified','Enrollment Verified', true, 30),
  ('enrollments','status','Enrollment Submitted — Awaiting Program Response','Enrollment Submitted — Awaiting Program Response', true, 40),
  ('enrollments','status','Enrollment Approved','Enrollment Approved', true, 50),
  ('enrollments','status','Enrollment Corrections Needed','Enrollment Corrections Needed', true, 60),
  ('enrollments','status','Enrollment Denied','Enrollment Denied', true, 70),
  ('enrollments','status','Enrollment Withdrawn','Enrollment Withdrawn', true, 80);
