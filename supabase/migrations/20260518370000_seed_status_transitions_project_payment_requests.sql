-- =========================================================================
-- status_transitions seed for project_payment_requests.
--
-- 10 edges covering the canonical 9-status lifecycle per
-- anura-status-lifecycles.md, plus two corrections off-ramps:
--
--   Forward path (8 edges):
--     To Be Prepared           → To Be Verified              (Submit for verification)
--     To Be Verified           → To Be Submitted             (Approve for submission)
--     To Be Submitted          → Submitted — Awaiting Review (Submit to program)
--     Submitted — Awaiting Review → Under Review             (Mark under review)
--     Under Review             → Approved                    (Mark approved)
--     Approved                 → Payment Pending             (Issue payment request)
--     Payment Pending          → Payment Received            (Record payment received)
--     Payment Received         → Closed                      (Close payment request)
--
--   Corrections off-ramps (2 edges):
--     To Be Verified           → To Be Prepared              (Return for corrections)
--     Under Review             → To Be Prepared              (Return for rework)
--
-- Owner: c5a01ec8-960f-42ab-8a9e-a49822de89af (Admin / Nicholas Wood)
-- =========================================================================

WITH pv AS (
  SELECT picklist_value, id
  FROM public.picklist_values
  WHERE picklist_object = 'project_payment_requests'
    AND picklist_field  = 'ppr_status'
)
INSERT INTO public.status_transitions (
  st_object, st_status_field,
  st_from_status_id, st_to_status_id,
  st_transition_label, st_description,
  st_sort_order, st_is_active,
  st_owner, st_created_by, st_updated_by
)
SELECT
  'project_payment_requests', 'ppr_status',
  (SELECT id FROM pv WHERE picklist_value = e.from_v),
  (SELECT id FROM pv WHERE picklist_value = e.to_v),
  e.label, e.descr,
  e.sort, true,
  'c5a01ec8-960f-42ab-8a9e-a49822de89af',
  'c5a01ec8-960f-42ab-8a9e-a49822de89af',
  'c5a01ec8-960f-42ab-8a9e-a49822de89af'
FROM (VALUES
  -- Forward path
  ('Payment Request To Be Prepared',           'Payment Request To Be Verified',            'Submit for verification',  'Mark the request ready for an internal verification review before submission to the program.', 10),
  ('Payment Request To Be Verified',           'Payment Request To Be Submitted',           'Approve for submission',   'Verifier confirms the request is complete and approves it for transmission to the program administrator.', 20),
  ('Payment Request To Be Submitted',          'Payment Request Submitted — Awaiting Review','Submit to program',        'Transmit the request to the program administrator. Triggers the external review clock.', 30),
  ('Payment Request Submitted — Awaiting Review','Payment Request Under Review',            'Mark under review',        'Program administrator acknowledged receipt and the request is actively being reviewed.', 40),
  ('Payment Request Under Review',             'Payment Request Approved',                  'Mark approved',            'Program approved the request. Payment is now pending issuance.', 50),
  ('Payment Request Approved',                 'Payment Request Payment Pending',           'Issue payment request',    'Payment instruction has been issued to the disbursement system; funds are in transit.', 60),
  ('Payment Request Payment Pending',          'Payment Request Payment Received',          'Record payment received',  'Funds have landed. Record the received amount and payment reference on the request.', 70),
  ('Payment Request Payment Received',         'Payment Request Closed',                    'Close payment request',    'All required documentation captured and the request is complete. No further action expected.', 80),
  -- Corrections off-ramps
  ('Payment Request To Be Verified',           'Payment Request To Be Prepared',            'Return for corrections',   'Verifier identified an issue. Return the request to the preparer for corrections before re-submission.', 90),
  ('Payment Request Under Review',             'Payment Request To Be Prepared',            'Return for rework',        'Program administrator requested changes. Return to the preparer for rework and re-submission.', 100)
) AS e(from_v, to_v, label, descr, sort);
