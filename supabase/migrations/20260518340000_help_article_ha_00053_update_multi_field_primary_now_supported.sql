-- =========================================================================
-- HA-00053 body update: the "table has multiple status fields" suppression
-- case now has a configurable resolution path via object_lifecycle_config.
-- Replace the v1.1-promise paragraph with the live behavior.
-- =========================================================================

UPDATE public.help_articles
SET ha_body_markdown = $md$
On any record whose object has a configured lifecycle in **Setup → Lifecycle Builder**, a status transitions bar appears at the top of the record detail page, just below the header and above the tab bar.

### What the bar shows

- **Current status pill** — the record's current value for its lifecycle field (e.g. *Project Status*, *Work Order Status*, *Incentive Application Status*), rendered as a monospace pill so the exact picklist value reads clearly.
- **Transition buttons** — one button per outgoing transition from the current status. The button label is the transition's *action-oriented label* (e.g. "Submit for verification") with the destination status shown beside it in a smaller pill (`→ To Be Verified`).

### Clicking a transition

The bar pops a confirmation modal showing the from-status, to-status, the transition's record number, and the transition description if one was authored. The modal also has an optional **Note** field for adding context that gets captured on the status change event (see HA-00054). Click **Confirm Change** to apply, or **Cancel** to back out.

On confirmation, the platform calls the `change_record_status` RPC. The RPC:

1. Verifies the caller has update permission on the object (via `app_user_can`)
2. Re-reads the record's current status (defending against stale UI state)
3. Looks up the `status_transitions` row matching `(object, status_field, from = current, to = requested)` with `is_active = true` and `is_deleted = false`
4. Refuses the change if no such row exists — meaning the lifecycle was edited mid-session
5. Updates the record's status column plus the standard audit columns (`*_updated_by`, `*_updated_at`)
6. Inserts a `status_change_events` row recording the transition, from/to statuses, the optional note, and the timestamp + user
7. Returns the transition_id used and the new event_id, so the audit trail can be traced back to the exact lifecycle edge that authorized the change

After a successful change, the record re-fetches and the bar updates to show the new status's outgoing transitions.

### How the bar resolves which status field to follow

The bar's two-phase resolver:

**Phase 1** — Query `status_transitions` for distinct `st_status_field` values on the object.

- **Zero fields**: the object has no lifecycle configured. Bar stays hidden.
- **One field**: unambiguous. That's the lifecycle field.
- **Multiple fields**: ambiguous. Fall through to phase 2.

**Phase 2** — Query `object_lifecycle_config` for a row where `olc_object = <this object>` and `olc_is_deleted = false`. The row's `olc_primary_status_field` declares which of the multiple fields is the primary lifecycle. If found and the declared field actually has transitions configured, the bar follows that field. If no row exists, or the declared field is stale, the bar suppresses.

This means: tables can carry multiple status fields with separate lifecycles. The primary one drives the record-detail bar; secondary ones still write to `status_change_events` when transitioned (via `change_record_status` with the appropriate `p_status_field` parameter) and still appear in the Activity Timeline. They just don't get the headline UI.

### When the bar is hidden

The bar self-suppresses in four cases:

1. **The table has no lifecycle yet** — no `status_transitions` rows exist for the object.
2. **The table has multiple status fields and no primary is declared** — `status_transitions` has rows on more than one column AND `object_lifecycle_config` has no matching row for the object. Author a row in `object_lifecycle_config` to resolve.
3. **Edit mode is active** — a status change here would race the form save.
4. **The current status is terminal** — no outgoing transitions exist.

### Authoring transitions

The buttons that appear here come directly from the **Setup → Lifecycle Builder** graph. To add, edit, or remove a button, edit the corresponding transition row in the Lifecycle Builder — changes propagate immediately on next page load.

### What the bar doesn't do

The bar applies a **status change only**. It doesn't:

- Save unrelated field edits (they need a separate Edit + Save)
- Trigger downstream automation (when Automation Builder lands, status-change events will fire flows; until then, only the status column itself changes)
- Prevent races with concurrent edits (the RPC always validates against the current DB state, so a concurrent change can cause the second click to fail with a clear error — refresh and try again)

### Related

- **Setup → Lifecycle Builder** (HA-00052) — where transitions are authored
- **Status change events** (HA-00054) — the structured audit trail this bar writes to
- **Status changes in the Activity Timeline** (HA-00055) — where the events surface in the record-detail UI
- **`object_lifecycle_config`** — per-object primary-lifecycle declaration for multi-status-field tables
- **Audit Log** — every status change is also captured by the table's audit trigger as a generic field diff
- **Field History** — the lifecycle field is typically registered for field history, so a per-record timeline of status changes is available
$md$,
ha_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af',
ha_updated_at = now()
WHERE ha_record_number = 'HA-00053';
