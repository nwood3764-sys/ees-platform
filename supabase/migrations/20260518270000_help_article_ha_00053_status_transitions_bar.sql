-- =========================================================================
-- HA-00053 — Status transitions bar on record detail pages
-- =========================================================================

WITH new_article AS (
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
    ha_category, ha_audience, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    'HA-00053',
    'status-transitions-bar-record-detail',
    'Status transitions bar on record detail pages',
    'Every record whose object has a configured lifecycle shows a status bar above the page layout: the current status as a pill, plus one button per outgoing transition. Clicking a button confirms the change and calls the change_record_status RPC, which validates the move against the lifecycle before applying.',
    $md$
On any record whose object has a configured lifecycle in **Setup → Lifecycle Builder**, a status transitions bar appears at the top of the record detail page, just below the header and above the tab bar.

### What the bar shows

- **Current status pill** — the record's current value for its lifecycle field (e.g. *Project Status*, *Work Order Status*, *Incentive Application Status*), rendered as a monospace pill so the exact picklist value reads clearly.
- **Transition buttons** — one button per outgoing transition from the current status. The button label is the transition's *action-oriented label* (e.g. "Submit for verification") with the destination status shown beside it in a smaller pill (`→ To Be Verified`).

### Clicking a transition

The bar pops a confirmation modal showing the from-status, to-status, the transition's record number, and the transition description if one was authored. Click **Confirm Change** to apply, or **Cancel** to back out.

On confirmation, the platform calls the `change_record_status` RPC. The RPC:

1. Verifies the caller has update permission on the object (via `app_user_can`)
2. Re-reads the record's current status (defending against stale UI state)
3. Looks up the `status_transitions` row matching `(object, status_field, from = current, to = requested)` with `is_active = true` and `is_deleted = false`
4. Refuses the change if no such row exists — meaning the lifecycle was edited mid-session
5. Updates the record's status column plus the standard audit columns (`*_updated_by`, `*_updated_at`)
6. Returns the transition_id used, so the audit trail and field history can be traced back to the exact lifecycle edge that authorized the change

After a successful change, the record re-fetches and the bar updates to show the new status's outgoing transitions.

### When the bar is hidden

The bar self-suppresses in four cases:

1. **The table has no lifecycle yet** — no `status_transitions` rows exist for the object. The record renders normally with no bar.
2. **The table has multiple status fields configured** — some tables (Work Orders, Work Steps) carry both a main lifecycle status and one or more approval-status fields. Surfacing buttons for all of them at once would be ambiguous, so the bar is suppressed until the table declares a primary lifecycle. This is a v1.1 enhancement.
3. **Edit mode is active** — when the user is filling out field changes, a status change here would be confusing and might race the form save.
4. **The current status is terminal** — no outgoing transitions exist. The record is at the end of its lifecycle (e.g. *Project Completed*, *Work Order Closed*).

### Authoring transitions

The buttons that appear here come directly from the **Setup → Lifecycle Builder** graph. To add, edit, or remove a button, edit the corresponding transition row in the Lifecycle Builder — changes propagate immediately on next page load.

### What the bar doesn't do

The bar applies a **status change only**. It doesn't:

- Save unrelated field edits (they need a separate Edit + Save)
- Trigger downstream automation (when Automation Builder lands, status-change events will fire flows; until then, only the status column itself changes)
- Add a note or comment to the change (audit log captures the field change with timestamp + user; a note field is a v1.1 enhancement)
- Prevent races with concurrent edits (the RPC always validates against the current DB state, so a concurrent change can cause the second click to fail with a clear error — refresh and try again)

### Related

- **Setup → Lifecycle Builder** (HA-00052) — where transitions are authored
- **Audit Log** — every status change is captured automatically by the table's audit trigger
- **Field History** — the lifecycle field is typically registered for field history, so a per-record timeline of status changes is available
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
  ('object'::text,  NULL::text, 'status_transitions'::text, NULL::text, NULL::text, 10),
  ('object',        NULL,       'projects',                 NULL,        NULL, 20),
  ('object',        NULL,       'work_orders',              NULL,        NULL, 30),
  ('object',        NULL,       'incentive_applications',   NULL,        NULL, 40),
  ('field',         NULL,       'projects',                 'project_status',   NULL, 50),
  ('field',         NULL,       'work_orders',              'work_order_status', NULL, 60),
  ('field',         NULL,       'incentive_applications',   'ia_status',         NULL, 70),
  ('concept',       NULL,       NULL,                       NULL, 'status-transitions-bar',  5),
  ('concept',       NULL,       NULL,                       NULL, 'change-record-status',   15),
  ('concept',       NULL,       NULL,                       NULL, 'status-lifecycle',       25),
  ('concept',       NULL,       NULL,                       NULL, 'lifecycle-runtime',      35),
  ('concept',       NULL,       NULL,                       NULL, 'transition-confirmation', 45)
) AS a(atype, aroute, aobj, afield, aconcept, asort);
