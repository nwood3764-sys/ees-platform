-- =========================================================================
-- Seed canonical status_transitions for the three major lifecycles whose
-- picklists exist today: incentive_applications.ia_status,
-- projects.project_status, work_orders.work_order_status.
--
-- 54 transitions total:
--   - incentive_applications.ia_status  — 16 edges (full lifecycle + withdrawals)
--   - projects.project_status           — 25 edges (canonical happy path + walkaway)
--   - work_orders.work_order_status     — 13 edges (canonical path + unable-to-complete)
--
-- Labels follow the explicit naming convention — action-oriented imperatives.
-- Sort orders control display ordering when multiple transitions exit the
-- same status (lower first). Escape transitions (Withdraw / Walk-Away /
-- Unable to Complete) are seeded at the common exit points; admins can
-- author additional escapes in the Lifecycle Builder if other statuses
-- need them.
-- =========================================================================

DO $seed$
DECLARE
  v_owner uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';

  -- Incentive Applications
  ia_to_prepare   uuid; ia_to_verify    uuid; ia_to_submit    uuid;
  ia_submitted    uuid; ia_preapproved  uuid; ia_approved     uuid;
  ia_corrections  uuid; ia_denied       uuid; ia_withdrawn    uuid;

  -- Projects (top of pipeline)
  pj_to_sched     uuid; pj_scheduled    uuid; pj_underway     uuid;
  pj_wo_to_create uuid; pj_wo_created   uuid; pj_wo_to_issue  uuid;
  pj_wo_issued    uuid; pj_wo_completed uuid; pj_wo_qa        uuid;
  pj_wo_vip       uuid; pj_wo_to_verify uuid; pj_wo_approved  uuid;
  pj_pm_signoff   uuid; pj_inc_prep_pend uuid; pj_inc_prep    uuid;
  pj_inc_prep_done uuid; pj_inc_qa_pend uuid; pj_inc_qa_done  uuid;
  pj_inc_submitted uuid; pj_inc_to_recon uuid; pj_inc_recon   uuid;
  pj_inc_reconciled uuid; pj_inc_received uuid; pj_complete   uuid;
  pj_walkaway     uuid;

  -- Work Orders
  wo_new          uuid; wo_to_sched     uuid; wo_to_assign    uuid;
  wo_assigned     uuid; wo_to_accept    uuid; wo_scheduled    uuid;
  wo_in_progress  uuid; wo_to_verify    uuid; wo_corrections  uuid;
  wo_verified     uuid; wo_unable       uuid; wo_closed       uuid;
BEGIN
  -- ── Resolve picklist value UUIDs ────────────────────────────────────
  SELECT id INTO ia_to_prepare  FROM picklist_values WHERE picklist_object='incentive_applications' AND picklist_field='ia_status' AND picklist_value='Incentive Application To Be Prepared';
  SELECT id INTO ia_to_verify   FROM picklist_values WHERE picklist_object='incentive_applications' AND picklist_field='ia_status' AND picklist_value='Incentive Application To Be Verified';
  SELECT id INTO ia_to_submit   FROM picklist_values WHERE picklist_object='incentive_applications' AND picklist_field='ia_status' AND picklist_value='Incentive Application To Be Submitted';
  SELECT id INTO ia_submitted   FROM picklist_values WHERE picklist_object='incentive_applications' AND picklist_field='ia_status' AND picklist_value='Incentive Application Submitted — Awaiting Program Response';
  SELECT id INTO ia_preapproved FROM picklist_values WHERE picklist_object='incentive_applications' AND picklist_field='ia_status' AND picklist_value='Incentive Application Pre-Approved';
  SELECT id INTO ia_approved    FROM picklist_values WHERE picklist_object='incentive_applications' AND picklist_field='ia_status' AND picklist_value='Incentive Application Approved';
  SELECT id INTO ia_corrections FROM picklist_values WHERE picklist_object='incentive_applications' AND picklist_field='ia_status' AND picklist_value='Incentive Application Corrections Needed';
  SELECT id INTO ia_denied      FROM picklist_values WHERE picklist_object='incentive_applications' AND picklist_field='ia_status' AND picklist_value='Incentive Application Denied';
  SELECT id INTO ia_withdrawn   FROM picklist_values WHERE picklist_object='incentive_applications' AND picklist_field='ia_status' AND picklist_value='Incentive Application Withdrawn';

  SELECT id INTO pj_to_sched         FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project To Be Scheduled';
  SELECT id INTO pj_scheduled        FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Scheduled';
  SELECT id INTO pj_underway         FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Underway';
  SELECT id INTO pj_wo_to_create     FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Order to be Created';
  SELECT id INTO pj_wo_created       FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Order Created';
  SELECT id INTO pj_wo_to_issue      FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Order to be Issued';
  SELECT id INTO pj_wo_issued        FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Order Issued';
  SELECT id INTO pj_wo_completed     FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Order Completed';
  SELECT id INTO pj_wo_qa            FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Order QA Pending';
  SELECT id INTO pj_wo_vip           FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Order Verification In Progress';
  SELECT id INTO pj_wo_to_verify     FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Orders To Be Verified';
  SELECT id INTO pj_wo_approved      FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Work Order Approved';
  SELECT id INTO pj_pm_signoff       FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='PM Sign Off';
  SELECT id INTO pj_inc_prep_pend    FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive Preparation Pending';
  SELECT id INTO pj_inc_prep         FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive Preparation';
  SELECT id INTO pj_inc_prep_done    FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive Preparation Complete';
  SELECT id INTO pj_inc_qa_pend      FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive QA Review Pending';
  SELECT id INTO pj_inc_qa_done      FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive QA Review Completed';
  SELECT id INTO pj_inc_submitted    FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive Submitted';
  SELECT id INTO pj_inc_to_recon     FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive to be Reconciled';
  SELECT id INTO pj_inc_recon        FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive Reconcile';
  SELECT id INTO pj_inc_reconciled   FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive Reconciled';
  SELECT id INTO pj_inc_received     FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Incentive Received';
  SELECT id INTO pj_complete         FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Project Completed';
  SELECT id INTO pj_walkaway         FROM picklist_values WHERE picklist_object='projects' AND picklist_field='project_status' AND picklist_value='Walk-Away';

  SELECT id INTO wo_new          FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='New';
  SELECT id INTO wo_to_sched     FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='To Be Scheduled';
  SELECT id INTO wo_to_assign    FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='To Be Assigned';
  SELECT id INTO wo_assigned     FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='Assigned';
  SELECT id INTO wo_to_accept    FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='To Be Accepted';
  SELECT id INTO wo_scheduled    FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='Scheduled';
  SELECT id INTO wo_in_progress  FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='In Progress';
  SELECT id INTO wo_to_verify    FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='To Be Verified';
  SELECT id INTO wo_corrections  FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='Corrections Needed';
  SELECT id INTO wo_verified     FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='Verified';
  SELECT id INTO wo_unable       FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='Unable to Complete';
  SELECT id INTO wo_closed       FROM picklist_values WHERE picklist_object='work_orders' AND picklist_field='work_order_status' AND picklist_value='Closed';

  -- ── Incentive Application transitions ───────────────────────────────
  INSERT INTO status_transitions
    (st_record_number, st_object, st_status_field, st_from_status_id, st_to_status_id,
     st_transition_label, st_description, st_sort_order, st_owner, st_created_by)
  VALUES
    ('', 'incentive_applications', 'ia_status', NULL,            ia_to_prepare,  'Create application',              'Initial-creation transition when a new IA is inserted.',                            10, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_to_prepare,   ia_to_verify,   'Submit for verification',         'Author finishes the application; passes to QA reviewer.',                          10, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_to_prepare,   ia_withdrawn,   'Withdraw application',            'Author decides not to pursue this IA before verification.',                        90, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_to_verify,    ia_to_submit,   'Approve for submission',          'QA reviewer signs off; application is ready to send to the program.',              10, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_to_verify,    ia_to_prepare,  'Send back for revisions',         'QA reviewer identifies gaps; author needs to fix and resubmit.',                   20, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_to_verify,    ia_withdrawn,   'Withdraw application',            'Decision made not to submit after QA review.',                                     90, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_to_submit,    ia_submitted,   'Submit to program',               'Application sent to the program administrator; clock starts on their response.',   10, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_to_submit,    ia_withdrawn,   'Withdraw application',            'Pulled before the program receives it.',                                           90, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_submitted,    ia_preapproved, 'Pre-approval received',           'Program responds with pre-approval pending final review.',                         10, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_submitted,    ia_corrections, 'Program requested corrections',   'Program returns the application asking for changes.',                              20, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_submitted,    ia_denied,      'Application denied',              'Program rejects the application outright.',                                        30, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_submitted,    ia_withdrawn,   'Withdraw application',            'Applicant withdraws while awaiting program response.',                             90, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_preapproved,  ia_approved,    'Final approval received',         'Program issues final approval; reservation can be created.',                       10, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_preapproved,  ia_denied,      'Reverse pre-approval',            'Program retracts pre-approval at final review.',                                   20, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_corrections,  ia_to_verify,   'Resubmit after corrections',      'Corrections made; routed back through internal QA before re-submission.',          10, v_owner, v_owner),
    ('', 'incentive_applications', 'ia_status', ia_corrections,  ia_withdrawn,   'Withdraw application',            'Decision made not to pursue further after correction request.',                    90, v_owner, v_owner);

  -- ── Project transitions (canonical happy-path) ──────────────────────
  INSERT INTO status_transitions
    (st_record_number, st_object, st_status_field, st_from_status_id, st_to_status_id,
     st_transition_label, st_description, st_sort_order, st_owner, st_created_by)
  VALUES
    ('', 'projects', 'project_status', NULL,                pj_to_sched,        'Create project',                        'Initial-creation transition.',                                                10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_to_sched,         pj_scheduled,       'Schedule project',                      'Crew, date, and address all confirmed.',                                      10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_to_sched,         pj_walkaway,        'Walk away from project',                'Decision not to pursue this project.',                                        90, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_scheduled,        pj_underway,        'Start project',                         'Crew arrives on site; project execution begins.',                             10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_underway,         pj_wo_to_create,    'Open work order planning',              'Field work needs work orders to be scoped.',                                  10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_wo_to_create,     pj_wo_created,      'Create work order',                     'Work order record is in the system; ready to be issued.',                     10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_wo_created,       pj_wo_to_issue,     'Queue work order for issuance',         'Work order is approved internally and ready to be assigned.',                 10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_wo_to_issue,      pj_wo_issued,       'Issue work order to crew',              'Work order is dispatched; crew has been notified.',                           10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_wo_issued,        pj_wo_completed,    'Mark work order complete',              'Crew submits the work order with evidence attached.',                         10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_wo_completed,     pj_wo_qa,           'Move to QA pending',                    'Submitted work order awaits internal verification.',                          10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_wo_qa,            pj_wo_vip,          'Begin work order verification',         'Project Coordinator picks up the verification work.',                         10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_wo_vip,           pj_wo_to_verify,    'Queue final verification',              'Initial verification pass complete; awaiting sign-off.',                      10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_wo_to_verify,     pj_wo_approved,     'Approve work orders',                   'Final sign-off given on all work orders.',                                    10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_wo_approved,      pj_pm_signoff,      'PM signs off',                          'Project Manager certifies all field work is complete and verified.',          10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_pm_signoff,       pj_inc_prep_pend,   'Queue incentive preparation',           'PM hands off to incentives team.',                                            10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_prep_pend,    pj_inc_prep,        'Begin incentive preparation',           'Incentive author starts assembling submission package.',                      10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_prep,         pj_inc_prep_done,   'Complete incentive preparation',        'Package ready for internal QA.',                                              10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_prep_done,    pj_inc_qa_pend,     'Queue incentive QA',                    'Submitted to QA reviewer.',                                                   10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_qa_pend,      pj_inc_qa_done,     'Complete incentive QA',                 'QA reviewer signs off on the incentive package.',                             10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_qa_done,      pj_inc_submitted,   'Submit incentive to program',           'Package sent to the program administrator.',                                  10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_submitted,    pj_inc_to_recon,    'Queue for reconciliation',              'Awaiting payment to reconcile against submitted amount.',                     10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_to_recon,     pj_inc_recon,       'Begin reconciliation',                  'Finance team picks up reconciliation.',                                       10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_recon,        pj_inc_reconciled,  'Mark reconciled',                       'Reconciliation complete; amounts agree.',                                     10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_reconciled,   pj_inc_received,    'Mark incentive received',               'Payment received in the bank.',                                               10, v_owner, v_owner),
    ('', 'projects', 'project_status', pj_inc_received,     pj_complete,        'Close project',                         'All incentive payments received; close-out report generated.',                10, v_owner, v_owner);

  -- ── Work Order transitions ──────────────────────────────────────────
  INSERT INTO status_transitions
    (st_record_number, st_object, st_status_field, st_from_status_id, st_to_status_id,
     st_transition_label, st_description, st_sort_order, st_owner, st_created_by)
  VALUES
    ('', 'work_orders', 'work_order_status', NULL,             wo_new,          'Create work order',                'Initial-creation transition when a new WO is inserted.',                       10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_new,           wo_to_sched,     'Queue for scheduling',             'Work order accepted by planning; awaiting calendar slot.',                     10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_to_sched,      wo_to_assign,    'Mark ready for assignment',        'Calendar slot identified; awaiting crew assignment.',                          10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_to_assign,     wo_assigned,     'Assign to crew',                   'Crew assigned by dispatcher.',                                                 10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_assigned,      wo_to_accept,    'Send to crew for acceptance',      'Notify crew lead; awaiting their acceptance.',                                 10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_to_accept,     wo_scheduled,    'Crew accepts work order',          'Crew lead acknowledges and accepts the work order.',                           10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_scheduled,     wo_in_progress,  'Begin work',                       'Crew clocks in on site; work execution begins.',                               10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_in_progress,   wo_to_verify,    'Submit for verification',          'Crew completes work and submits with evidence attached.',                      10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_in_progress,   wo_unable,       'Mark unable to complete',          'Crew cannot finish — access denied, missing materials, site unsafe, etc.',     20, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_to_verify,     wo_verified,     'Verification passed',              'Verifier approves all submitted evidence.',                                    10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_to_verify,     wo_corrections,  'Send back for corrections',        'Verifier identifies missing or incorrect evidence; sent back to crew.',        20, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_corrections,   wo_in_progress,  'Resume corrections',               'Crew returns to site to address verification feedback.',                       10, v_owner, v_owner),
    ('', 'work_orders', 'work_order_status', wo_verified,      wo_closed,       'Close work order',                 'Final close-out; record is read-only from here.',                              10, v_owner, v_owner);

END $seed$;
