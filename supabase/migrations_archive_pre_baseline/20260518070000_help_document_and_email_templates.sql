-- ─── Help article — Document and email templates ──────────────────────
--   • HA-00042 document-and-email-templates
-- Fifth article closing the open help-articles backlog item. After this
-- commit, the remaining outstanding articles are: Reports module,
-- Dashboards, E-Signature / Envelopes.
--
-- Body content references real platform state at migration-write time:
--   5 document_templates, 6 email_templates, 14 notification_templates,
--   4 document_template_snapshots,
--   the four-family taxonomy (document/email/notification/PRT),
--   the merge-field vocabulary inherited from PRT
--     (substituteMergeFields convention),
--   the Draft/Active/Archived lifecycle + version + published_at fields,
--   the document_template_snapshots pattern for compliance-stable history
--     (also used by project_report_template_snapshots),
--   e-signature integration via requires_signature + signer_role.

insert into help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_body_markdown, ha_category, ha_audience, ha_is_published
) values (
  '',
  'document-and-email-templates',
  'Document and email templates — authoring, publishing, and merge fields',
  'How the document and email template families work. Covers the four ' ||
  'template tables (document_templates, email_templates, ' ||
  'notification_templates, project_report_templates), merge fields and ' ||
  'their dotted-path resolution context, the status lifecycle ' ||
  '(Draft → Active → Archived), the snapshot pattern that keeps ' ||
  'historical generated documents stable when a template gets revised, ' ||
  'and how each family ties into the communications, e-signature, and ' ||
  'notification stacks.',
  $body$
LEAP has four distinct template families, each backed by its own table and each tuned to a different kind of output. They share a common merge-field vocabulary and a common publish-and-snapshot model, but the bodies, the rendering, and the destinations differ.

### The four families

| Table | Rendering | Used for | Count today |
|---|---|---|---|
| `document_templates` | HTML body → rendered PDF | Customer-facing agreements, reservation requests, completion acknowledgments, payment-request documents. Usually paired with an e-signature envelope. | 5 |
| `email_templates` | HTML body → rich email | Manual sends from a record (Project Coordinator emails the property owner), automated emails on status changes | 6 |
| `notification_templates` | Plain-text body → SMS or email | Short event-fired customer notifications driven by the orchestrator (booking confirmation, on-my-way, reminder, etc.) | 14 |
| `project_report_templates` | Sectioned body → rendered PDF | Internal project reports (per-property breakdowns, multifamily after-action) generated on demand or via scheduled reports | (PRT-####) |

The four are independent — there's no inheritance hierarchy, no shared row. Picking the right family at design time matters more than picking the right field within a family. Decision rule:

- Is this a customer-signs-it artifact? → `document_templates` + e-sig envelope
- Is this a rich-content email I'm sending from a record's surface? → `email_templates`
- Is this a short, event-fired SMS or email driven by automation? → `notification_templates`
- Is this an internal report bundling multiple records? → `project_report_templates`

### Common fields across templates

All four template tables share a similar scoping + lifecycle pattern:

- `name` — admin-facing label
- `description` — admin-facing notes about when to use this template
- Scoping fields — typically some combination of `program_id`, `state`, `related_object`, `record_type`. The resolver picks the most-specific matching template for a given record.
- `trigger_status` (document/email/notification) — the status value that auto-fires this template when a record reaches it. NULL means manual-only.
- `is_manual` / `is_automated` flags — whether the template appears on a record's "Send" menu (manual) and/or fires automatically on status change (automated).
- `status` (Draft / Active / Archived) — Draft templates are admin-editable but don't fire; Active templates are locked from edits and do fire; Archived templates are out of rotation but their historical sends still resolve correctly via snapshots.
- `published_at` / `version` — set on the Draft → Active transition. Increments on each republish.
- `requires_signature` + `signer_role` (document_templates only) — when true, the generated PDF is wrapped in an e-sig envelope routed to the named role on the record.

### Merge fields

Bodies carry `{{dotted.path}}` tokens that resolve at send time against a context object scoped to the record. The vocabulary is consistent across all four families. For a record-rooted send, the context typically looks like:

```js
{
  appointment: { /* SA fields */ },
  contact:     { /* customer */ },
  auditor:     { /* assigned auditor */ },
  property:    { /* full address */ },
  project:     { /* project record */ },
  work_type:   { /* what's being done */ },
  company:     { /* EES-WI sender info */ },
}
```

Examples:
- `{{contact.full_name}}` — the customer's full name
- `{{property.street}}, {{property.city_state_zip}}` — one-line address
- `{{appointment.start_date}}` — formatted appointment date
- `{{project.project_record_number}}` — the project ID for the email subject

Missing keys resolve to empty string (no `undefined` literal in the output). The resolver is the same code path PRT uses (`substituteMergeFields` convention) — what works in one template family works in the others.

For specific record types, the context grows. The dispatcher_followup_required template gets a DFR-shaped context with `appointment.record_number = DFR-####` even though no SA exists yet — because the orchestrator builds the context object inline to match the merge-field vocabulary the author wrote against.

### Publishing and locking

Active templates are locked. This is deliberate, modeled on the PRT lifecycle:

- **Draft** — fully editable. Body, scoping, trigger_status, all fields. Drafts don't fire automatically and don't appear on manual-send menus.
- **Active** — body and locked fields immutable. Send + history continue to work. To make changes, clone the template into a new Draft, edit, then publish as a new version.
- **Archived** — like Active but out of rotation. The trigger_status no longer fires this template; manual-send menus filter it out. Historical sends still resolve.

The publish transition bumps `version` and stamps `published_at`. The unpublish path returns to Draft (only if there are no dependent records currently in-flight — e.g. don't unpublish a document template while its envelope is mid-signature).

### Snapshot pattern (document_template_snapshots)

When a customer receives Document v1 of a template, then a year later the template is revised to v2, the customer's archived copy must still reflect v1 — both for compliance and for the customer's expectations of what they signed.

`document_template_snapshots` stores per-publish snapshots of the document_template body so historical sends can resolve against the body that was live at the time. Today: 4 snapshot rows across 5 document templates (most are still at v1).

The send-time flow:

1. Template authored as Draft → user edits body
2. Template published → version 1 written to document_template_snapshots
3. Customer receives the document with `dtsn_id` (snapshot id) recorded on the send
4. Template edited (now Draft → Active again) → version 2 written to a new snapshot
5. Old customer's copy still references version 1's snapshot; new customer gets version 2

The `version` field on the live template always points at the latest published version; older versions live in the snapshots table. Querying "what did this customer actually see" requires joining through the snapshot, not the live template.

(`project_report_templates` uses the same pattern via `project_report_template_snapshots` for historical report regeneration. `email_templates` and `notification_templates` don't snapshot today — they're short enough that v2 going forward is acceptable, and there's no compliance reason to preserve the exact email phrasing.)

### How each family ties into the rest of the platform

**Document templates → e-signature envelopes**
When `requires_signature=true`, the platform wraps the generated PDF in an `envelopes` row, adds an `envelope_recipient` for the customer (resolved via `signer_role` against the record's contact roles), and routes the envelope through the e-sig provider. Status transitions on the envelope drive downstream record events (e.g. signed reservation request → project moves to next status).

**Email templates → communications**
Manual sends and automated emails both write a row to the parent record's activity timeline ("Email sent: <template name>" with a clickable preview). The send goes through the same `send-notification-email` v2 path the orchestrator uses, so audit logging and provider routing are consistent. The `template_ai_assist_allowed` flag on email_templates gates whether the in-record compose AI may use this template as a base.

**Notification templates → fire-notification orchestrator**
See the notification-orchestrator-fire-notification help article for the full pipeline. Each `(trigger_event, channel)` combo maps to a notification_templates row; the work_type_id scoping picks per-work-type overrides over NULL globals.

**Project report templates → generate-project-report edge function**
See the project-report-generator help article. PRT bodies are sectioned (project_report_template_sections) rather than monolithic HTML; the generator walks the sections and assembles a PDF.

### Common pitfalls

- **Don't edit an Active template directly via SQL** — bypasses the version bump and breaks the snapshot pattern. Use the unpublish → edit → republish flow even when going via SQL.
- **Don't conflate `notification_templates` and `email_templates`** — they have similar names and similar fields but serve different surfaces. Notification templates are short, event-fired, orchestrator-driven; email templates are rich, record-anchored, manual-or-automated.
- **Watch the scoping resolver** — when adding a new program-specific template, make sure the global default isn't unintentionally preferred. The resolver picks most-specific match; an Active row with all scoping fields NULL beats no match at all, but loses to an Active row with `program_id` set when the record has a program.
- **Test the merge fields before publishing** — bad merge paths render as empty strings, which can produce silent omissions in the output. Send yourself a test as Draft, eyeball the result, then publish.
$body$,
  'Communications',
  'internal',
  true
);

with t as (select id from help_articles where ha_slug='document-and-email-templates' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from t, (values
  ('object'::text,  null::text,                              'document_templates'::text,           null::text, null::text, 1),
  ('object',        null,                                     'email_templates',                  null,       null,       2),
  ('object',        null,                                     'document_template_snapshots',      null,       null,       3),
  ('object',        null,                                     'notification_templates',           null,       null,       4),
  ('object',        null,                                     'project_report_templates',         null,       null,       5),
  ('concept',       null,                                     null,                                null,       'merge-fields',            6),
  ('concept',       null,                                     null,                                null,       'template-publishing',     7),
  ('concept',       null,                                     null,                                null,       'template-snapshots',      8),
  ('concept',       null,                                     null,                                null,       'template-versioning',     9),
  ('concept',       null,                                     null,                                null,       'template-scoping',       10),
  ('concept',       null,                                     null,                                null,       'template-status-lifecycle', 11),
  ('concept',       null,                                     null,                                null,       'manual-vs-automated-send', 12)
) as t2(anchor_type, route, object, field, concept, sort_order);
