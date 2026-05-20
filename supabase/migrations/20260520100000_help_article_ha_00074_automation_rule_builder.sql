-- =====================================================================
-- HA-00074 — Structured Automation Rule Builder (Setup → Process
-- Automation → Flows).
-- =====================================================================

INSERT INTO help_articles (
  ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published
) VALUES (
  'automation-rule-builder',
  'Authoring automation rules with the structured builder',
  'The Flows pane provides a structured editor for automation_rules. Each action type renders its own form so action_config matches what the runtime executor expects. No JSON authoring required.',
  $md$
The **Flows (Automation Rules)** pane at Setup → Process Automation →
Flows is a structured builder for the `automation_rules` table. The
generic record editor cannot shape `action_config` per action type, so
this pane owns the full create/read/update surface.

## What a rule looks like

Every rule has two halves:

* **When (Trigger)** — what record event fires the rule
* **Then (Action)** — what the executor does when the trigger fires

The trigger half writes to `trigger_object`, `trigger_event`, and
`trigger_status`. The action half writes to `action_type` and
`action_config`. The list view shows each rule as a one-line summary
of both halves.

## Supported triggers

The Builder supports `status_change` triggers today. A status_change
trigger fires when a record transitions to a specific status — the
record's status field, the new status label, and the source table are
all required.

* **Trigger object** — picklist of every object that has at least one
  active row in `status_transitions`. These are the objects where a
  lifecycle exists today.
* **Trigger status** — picklist of every status label reachable as a
  destination on the chosen object's lifecycle. Picker falls back to
  free-text if the lifecycle is empty or unreadable.

The `scheduled` trigger event is not handled by this builder. Scheduled
rules are fired by the `dispatch-scheduled-reports` cron edge function
and managed via the `scheduled_reports` table directly.

## Supported actions

Each action type renders a form scoped to exactly the `action_config`
keys the runtime executor reads. Saving validates that all required
keys are present before insert.

### send_email

Fires the `_automation_action_send_email` handler.

* `template` — the email template name. Picker shows every non-deleted
  template (Active surfaces by name; Draft surfaces as `name (Draft)`).
* `recipient_role` — the role whose users receive the email. Picker
  shows every active role.

### create_task

Fires `_automation_action_create_task`.

* `task_name` — text shown on the created task.
* `assigned_role` — picklist of active roles.
* `due_days` — days from rule fire to task due date. Optional.

### create_work_order

Fires `_automation_action_create_work_order`.

* `work_type` — picklist of every active, non-deleted work type.
* `assigned_role` — picklist of active roles.

The handler walks the trigger record's parent chain to wire the new
work order to its project / property / opportunity / unit / building as
appropriate. The created WO inherits its record_type from the
work_type's default.

### update_record

Fires `_automation_action_update_record`. Updates either the trigger
record itself or one of its parent records.

* `target` — one of:
    * `self`
    * `parent_project` / `parent_opportunity` / `parent_property` /
      `parent_work_order` / `parent_account` /
      `parent_incentive_application`
* `mode` — `status` or `set_field`.
* `status_to_label` (when mode=status) — the new status label.
* `set_field` (when mode=set_field) — the column name to set.
* `set_value` (when mode=set_field) — the value to set.

The handler picks the path through the parent chain at runtime based
on the trigger object and the chosen target.

## Picker-or-text fallback

Every picklist in the editor falls back to a free-text input if its
underlying query returns zero rows (RPC failure, offline, target table
empty). The saved value is identical either way — what changes is
just whether the user types or selects.

## Activation

The `Active` toggle in the Details section controls whether the rule
fires. The runtime executor ignores rules with `is_active=false`. Toggle
without affecting any other field; the Builder writes only the columns
you change.

## Execution order

When multiple rules match the same trigger, the executor fires them in
ascending `execution_order`. Lower numbers fire first. Default is 1.

## Raw action_config preview

The `Raw action_config (advanced)` collapsible at the bottom of the
modal shows the current JSON about to be saved. Useful for verifying
what the executor will see, and for power-user authoring of action
shapes the Builder doesn't yet expose.

## What this builder does not yet do

* Field-change triggers (`trigger_event='field_change'`) — runtime
  hook for these is not yet wired into the executor.
* Record-create triggers — same.
* Multi-step flows — each rule has exactly one action. Authoring a
  multi-step sequence today requires creating multiple rules with the
  same trigger and incrementing `execution_order`.
* Conditional branches — actions fire unconditionally on matching
  triggers. There is no per-rule WHERE clause.

These are tracked as future work under the Automation Builder backlog.
$md$,
  'Configuration',
  'internal',
  true
);

INSERT INTO help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_field, haa_concept, haa_sort_order)
SELECT id, 'object',  'automation_rules', NULL, NULL, 1 FROM help_articles WHERE ha_slug='automation-rule-builder'
UNION ALL
SELECT id, 'field',   'automation_rules', 'trigger_object', NULL, 2 FROM help_articles WHERE ha_slug='automation-rule-builder'
UNION ALL
SELECT id, 'field',   'automation_rules', 'trigger_event', NULL, 3 FROM help_articles WHERE ha_slug='automation-rule-builder'
UNION ALL
SELECT id, 'field',   'automation_rules', 'trigger_status', NULL, 4 FROM help_articles WHERE ha_slug='automation-rule-builder'
UNION ALL
SELECT id, 'field',   'automation_rules', 'action_type', NULL, 5 FROM help_articles WHERE ha_slug='automation-rule-builder'
UNION ALL
SELECT id, 'field',   'automation_rules', 'action_config', NULL, 6 FROM help_articles WHERE ha_slug='automation-rule-builder'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'automation-rule', 7 FROM help_articles WHERE ha_slug='automation-rule-builder'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'automation-builder', 8 FROM help_articles WHERE ha_slug='automation-rule-builder'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'action-config', 9 FROM help_articles WHERE ha_slug='automation-rule-builder';
