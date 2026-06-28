-- =========================================================================
-- HA-00056 — Project Payment Request lifecycle
--
-- Documents the 9-status canonical lifecycle authored for the
-- project_payment_requests object across two migrations:
--   • 20260518360000 — ppr_status / ppr_record_type / ppr_record_number
--                      columns + 9 status picklist values + backfill +
--                      auto-numbering trigger
--   • 20260518370000 — 10 status_transitions edges (8 forward + 2
--                      corrections off-ramps)
--
-- StatusTransitionsBar resolution: project_payment_requests has only one
-- status field carrying transitions (ppr_status), so phase 1 of the bar's
-- resolver is unambiguous and no object_lifecycle_config row is required.
-- =========================================================================

WITH new_article AS (
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00056',
    'project-payment-request-lifecycle',
    'Project Payment Request lifecycle',
    'Project Payment Requests follow a 9-status lifecycle from prepared through closed, with corrections off-ramps at the verification and program-review stages. The lifecycle is authored as 10 status_transitions edges and rendered by the StatusTransitionsBar on every PPR record detail page.',
    $md$
Each project payment request (PPR) represents a single submission to a program for an approved incentive. The lifecycle covers internal preparation, internal verification, transmission to the program, the program's external review, and the disbursement path through to a closed and reconciled record.

### The 9 statuses

In sort order:

1. **Payment Request To Be Prepared** — the starting state. Preparer is assembling supporting documentation and the program's required forms.
2. **Payment Request To Be Verified** — preparer has handed off to an internal verifier. The verifier reviews the request before it leaves the building.
3. **Payment Request To Be Submitted** — verifier has approved. The request is queued for transmission to the program administrator.
4. **Payment Request Submitted — Awaiting Review** — submitted. The external review clock starts here.
5. **Payment Request Under Review** — program administrator acknowledged receipt; review is actively in progress.
6. **Payment Request Approved** — program approved the request. Payment is queued for issuance.
7. **Payment Request Payment Pending** — payment instruction has been issued; funds are in transit.
8. **Payment Request Payment Received** — funds have landed. Record the received amount and payment reference on the request.
9. **Payment Request Closed** — all required documentation captured. No further action expected.

Each is a row in `picklist_values` with `picklist_object='project_payment_requests'` and `picklist_field='ppr_status'`.

### The 10 transitions

**Forward path (8 edges):**

| From | To | Label |
|---|---|---|
| To Be Prepared | To Be Verified | Submit for verification |
| To Be Verified | To Be Submitted | Approve for submission |
| To Be Submitted | Submitted — Awaiting Review | Submit to program |
| Submitted — Awaiting Review | Under Review | Mark under review |
| Under Review | Approved | Mark approved |
| Approved | Payment Pending | Issue payment request |
| Payment Pending | Payment Received | Record payment received |
| Payment Received | Closed | Close payment request |

**Corrections off-ramps (2 edges):**

| From | To | Label |
|---|---|---|
| To Be Verified | To Be Prepared | Return for corrections |
| Under Review | To Be Prepared | Return for rework |

The two off-ramps cover the two realistic correction loops: the internal verifier sending it back to the preparer (own decision) and the program administrator sending it back during external review (typically attached to a corrections list). Both return to *To Be Prepared* so the preparer reworks the request from the same starting state before re-submitting.

There is no off-ramp from *Submitted — Awaiting Review*, *Approved*, *Payment Pending*, or *Payment Received*. These states represent external commitments that aren't unwound by a status change — they get resolved by the next forward step or by manual record amendment.

### Dual-column transition state

`project_payment_requests` is mid-transition from a legacy bare-column convention to the prefixed-column convention used everywhere else in the platform. As of the lifecycle author:

- **Legacy column:** `status` (text, default `Payment Request To Be Prepared`). Still readable by `incentivesService.js`.
- **New column:** `ppr_status` (uuid → `picklist_values.id`). Read by `RecordDetail.jsx` and `layoutService.js` via the standard picklist-join path.

Both columns are populated and kept aligned by the backfill in migration `20260518360000`. The legacy `status` column is *legacy* — once `incentivesService.js` is updated to read the uuid path, the text column can be dropped. Until then, treat both as live.

The same dual-column pattern applies to `record_type` / `ppr_record_type` and `payment_request_number` / `ppr_record_number`.

### How it renders in the UI

`project_payment_requests` has exactly one status field carrying transitions (`ppr_status`), so the `StatusTransitionsBar` phase-1 resolver finds it unambiguously. No `object_lifecycle_config` row is required for this object. The bar appears above the page layout on every PPR record-detail page and shows:

- The current status as a colored pill
- One button per outgoing transition from the current status — labeled with `st_transition_label` (e.g. *Submit for verification*, *Approve for submission*)
- An optional note field in the confirmation modal — captured into `status_change_events.sce_note` for audit purposes

A PPR in *To Be Verified* shows two outgoing buttons: *Approve for submission* and *Return for corrections*. A PPR in *Closed* shows zero outgoing buttons (terminal state).

### Audit trail

Every status change writes a `status_change_events` row (HA-00054) and renders as a first-class entry in the record's Activity tab (HA-00055). The `field_history` de-duplication pass suppresses the redundant bare `status: X → Y` row when both the SCE row and a field_history row land within 5 seconds — so each PPR status change appears once in the timeline, with the transition label and optional note inline.

### Related

- **HA-00052** — Lifecycle Builder (where transitions are authored)
- **HA-00053** — StatusTransitionsBar widget (where users initiate status changes)
- **HA-00054** — `status_change_events` audit trail
- **HA-00055** — Status changes in the Activity Timeline
$md$,
    'Records',
    'internal',
    true,
    'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af'
  )
  RETURNING id
)
INSERT INTO public.help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order, haa_created_by
)
SELECT new_article.id, a.atype, a.aroute, a.aobj, a.afield, a.aconcept, a.asort, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
FROM new_article,
LATERAL (VALUES
  ('object'::text, NULL::text, 'project_payment_requests'::text, NULL::text, NULL::text, 10),
  ('field',        NULL,       'project_payment_requests',       'ppr_status',     NULL, 20),
  ('field',        NULL,       'project_payment_requests',       'ppr_record_type', NULL, 30),
  ('field',        NULL,       'project_payment_requests',       'ppr_record_number', NULL, 40),
  ('field',        NULL,       'project_payment_requests',       'status',          NULL, 50),
  ('concept',      NULL,       NULL,                              NULL, 'payment-request-lifecycle', 60),
  ('concept',      NULL,       NULL,                              NULL, 'corrections-off-ramp', 70),
  ('concept',      NULL,       NULL,                              NULL, 'dual-column-transition', 80),
  ('concept',      NULL,       NULL,                              NULL, 'lifecycle-canonical-9', 90)
) AS a(atype, aroute, aobj, afield, aconcept, asort);
