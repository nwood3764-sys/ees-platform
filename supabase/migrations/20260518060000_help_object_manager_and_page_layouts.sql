-- ─── Help article — Object Manager / Page Layouts ─────────────────────
--   • HA-00041 object-manager-and-page-layouts
-- Closes another entry in the open backlog item
--   "Help articles for remaining shipped features"
-- (Page Layouts / Object Manager batch). After this commit, the
-- remaining outstanding articles are: Reports module, Dashboards,
-- Document/Email Templates, E-Signature / Envelopes.
--
-- Body content references real platform surfaces at migration-write
-- time:
--   Object Manager catalog (every object grouped by module),
--   ObjectDetail's seven sub-tabs (Details / Fields & Relationships /
--     Page Layouts / Record Types / Validation Rules / Automation
--     Rules / Related Lookups),
--   LayoutEditor metadata card, section drag-to-reorder, widget
--     drag-to-reorder, danger zone with soft delete,
--   Explicit limitations on widget creation/editing in the UI
--     (must SQL into page_layout_widgets directly today),
--   Multi-record-type and multi-role layout resolver pattern,
--   Field-level security layer separation.

insert into help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_body_markdown, ha_category, ha_audience, ha_is_published
) values (
  '',
  'object-manager-and-page-layouts',
  'Object Manager — configuring fields, layouts, record types, and rules',
  'How to use the Object Manager under Setup to inspect and edit any ' ||
  'object''s schema. Covers the catalog view, the seven sub-tabs on Object ' ||
  'Detail (Details / Fields & Relationships / Page Layouts / Record Types ' ||
  '/ Validation Rules / Automation Rules / Related Lookups), the page-' ||
  'layout editor with its drag-to-reorder sections and widgets, and the ' ||
  'current limitations on widget editing.',
  $body$
The Object Manager is the admin surface for inspecting and configuring every object in LEAP — tables, fields, page layouts, record types, validation rules, automations, and the incoming foreign-key relationships. It's the Salesforce Object Manager equivalent.

### Getting there

Setup → **Object Manager** (highlighted entry in the WelcomePane, also accessible from the left-rail nav tree). Visible to admins. Most actions inside Object Manager require admin permissions; some viewing is broader.

### The catalog

The landing view is a searchable list of every LEAP object grouped by module:

- **Outreach** — accounts, contacts, properties, buildings, units, opportunities, account_contact_relations, property_programs
- **Field** — projects, work_orders, service_appointments, service_appointment_assignments, resource_absences, envelopes, contact_skills, time_sheets, dispatcher_followup_requests (newly added)
- **Qualification** — assessments, incentive_applications, efr_reports
- **Incentives** — project_payment_requests, payment_receipts
- **Stock** — products, product_items, materials_requests, equipment
- **Fleet** — vehicles, vehicle_activities, equipment_containers
- **Admin** — programs, work_types, work_type_skill_requirements, email_templates, document_templates, automation_rules, validation_rules, roles, picklist_values, skills, users, project_report_templates and related tables
- **Reports** — reports, report_folders, scheduled_reports, dashboards, etc.
- **Portal** — portal_users
- **Data** — audit_log, field_history, etc.

Each entry shows the object's label, plural label, table name, and a record count badge (RLS-filtered to what the current user can see — which is actually what an admin usually wants). Counts load in parallel after the catalog renders.

The search bar at the top matches label, plural, table name, or module — type "incent" and you'll find Incentive Applications, Incentives, Payment Receipts (via the Incentives module match), and any other matching entry.

### Object Detail — the seven sub-tabs

Clicking an object opens its detail page. Seven sub-tabs across the top:

**1. Details**

Object summary: table name, label/plural, module, owner field name, soft-delete column name, record-number column name (if any), record count, has-record-types flag. The administrative facts about the object as a whole — not editable here, this is documentation.

**2. Fields & Relationships**

Every column on the table with its data type, nullable flag, default expression, FK target (if any), and comment text. The fast way to verify a column exists before authoring SQL against it. Shows compound types (jsonb, arrays) inline with their structure expanded where the platform stores it.

**3. Page Layouts**

The list of every record-detail and create-form layout configured for the object. Columns: name, type (record_detail / record_create / etc.), record type assignment, role assignment, is_default flag, last updated, owner, soft-delete state. Actions per row: **Open** (drills into the LayoutEditor), **Clone** (creates a new layout starting from this one's structure), **Delete** (soft-delete with reason capture). Top-of-pane action: **New Layout** opens a modal to create a blank layout or clone from an existing one.

This is the most-touched surface in Object Manager. See the [page-layout editor](#page-layout-editor) section below.

**4. Record Types**

List of every record type configured on the object via `picklist_values` (picklist_field='record_type'). Columns: value, label, sort order, is_active, has-layout flag (true when a default record_detail page layout exists for this record type). Actions: **New Record Type** (creates the picklist row and offers four layout strategies — blank, clone from existing, inherit from default, or no layout yet), **Edit** (label / sort order inline), **Deactivate / Reactivate** (toggles picklist_is_active without deleting). The has-layout column is clickable when missing — drops the admin into a layout-creation flow for that specific record type.

**5. Validation Rules**

Every validation_rules row for this object: name, error message, condition (SQL expression evaluated server-side), is_active. Validation rules block saves at the database layer when their condition evaluates true; the error message is what surfaces to the end user. *Note*: today this tab is read-only. Authoring validation rules is SQL-only.

**6. Automation Rules**

Every automation_rules row for this object: name, trigger event (e.g. status change, record insert, scheduled), action description, is_active. Same read-only constraint as validation rules — authoring is SQL-only for now. The Lifecycle Builder and Automation Builder slated as future modules will give this a full UI.

**7. Related Lookups**

The incoming foreign-key graph. Every other table that has a column pointing at this object. Useful for understanding what depends on this object before you make schema changes. Each entry shows the source table + source column + an indication of whether it's a lookup (nullable) or master-detail (NOT NULL). Click-through to that source object's detail page.

### Page-layout editor {#page-layout-editor}

The Layouts tab's per-row Open action opens the LayoutEditor — the most-used admin surface for day-to-day platform customization.

**Metadata card** (top of the editor)
- Layout name (editable)
- Description (editable)
- Role assignment (dropdown — restricts which roles see this layout)
- Record type assignment (dropdown — restricts to records of one specific type)
- is_default flag (one default per object+record_type+role tuple)
- Inline Edit / Save / Cancel flow — changes don't persist until Save

**Section list** (vertically stacked below metadata)

Each section is a horizontal band with:
- Section label (editable inline — click to edit)
- Drag handle (rearranges sections within the layout)
- Settings popover button: column count (1 / 2 / 3), collapsible toggle, default-collapsed toggle, tab assignment (multi-tab layouts group sections under named tabs)
- Soft-delete button (with reason capture)

**Widget list** (inside each section)

Each widget shows its title, type (field_group / related_list / activity_timeline / conversation_panel / etc.), position (column + position within column), and:
- Drag handle (rearranges widgets within or across sections)
- "Edit contents" button (currently disabled with a "coming next" tooltip — see Limitations below)
- Soft-delete button (with reason capture)

**Danger zone** (bottom of the editor)

Layout-level soft-delete. Captures a deletion reason. Recoverable via the Recycle Bin under Setup.

### Current limitations

What the LayoutEditor explicitly doesn't do yet (per the source comments):

- **Adding new widgets via the UI** — there's no "+" button on a section. New widgets must be inserted via SQL into `page_layout_widgets`. The widget-editor modals that would enable inline creation aren't built yet.
- **Editing widget contents** — for `field_group` widgets that means the field picker (which fields are in this widget and in what order); for `related_list` widgets that means the target picker (which related table, which sort field, which columns). The "Edit contents" button is rendered disabled with a "coming next" tooltip. Today, edit the `widget_config` jsonb directly via SQL on `page_layout_widgets`.

For inserts:
```sql
INSERT INTO page_layout_widgets (
  page_layout_widget_record_number, page_layout_id, section_id,
  widget_type, widget_title, widget_column, widget_position, widget_config
) VALUES (
  '', '<page_layout_id>', '<section_id>',
  'field_group', 'My New Widget', 1, 3,
  '{ "fields": [ {"name": "my_column", "label": "My Column"} ] }'::jsonb
);
```

The `''` for `page_layout_widget_record_number` lets the auto-numbering trigger assign PLW-####.

### Multi-record-type and multi-role layouts

A single object can have many layouts, each scoped to a (record_type × role) combination. The platform's layout resolver picks the right one at runtime: for a given record being viewed by a given user, find the layout that matches both the record's record_type and the user's role, with the `is_default` flag as the tiebreaker when multiple match.

Common patterns:
- One layout per record type, no role scoping — most objects start here
- One default + role-specific overrides (e.g. Project Coordinators see a streamlined Work Order layout that hides financial fields; Project Managers see the full layout)
- Per-record-type sections inside one layout, gated via section tabs — when the record-type difference is small enough not to need a separate layout

### Field-level security

Layouts don't carry field-level visibility — that's a separate layer. A field can appear in the layout but be hidden at render time for users whose role doesn't have visibility on that field. The check is `app_user_field_permissions(p_object, p_fields[])` at fetch time; the LayoutService drops `visible:false` fields before passing to the renderer and stamps `_editable:false` on fields the role can see but not edit. See the field-level-enforcement-audit help article for the full pipeline.

### Bulk layout operations

There's no bulk operation surface in the LayoutEditor today. Patterns like "copy this section to every layout on this object" or "rename this field's label everywhere it appears" require SQL. The `clone_page_layout` RPC supports cloning whole layouts; widget-level operations are direct INSERT/UPDATE/DELETE on page_layout_widgets.
$body$,
  'Setup',
  'internal',
  true
);

with om as (select id from help_articles where ha_slug='object-manager-and-page-layouts' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from om, (values
  ('route'::text,   '/admin/setup/object_manager'::text, null::text,            null::text, null::text, 1),
  ('object',        null,                                'page_layouts',        null,       null,       2),
  ('object',        null,                                'page_layout_sections',null,       null,       3),
  ('object',        null,                                'page_layout_widgets', null,       null,       4),
  ('object',        null,                                'validation_rules',    null,       null,       5),
  ('object',        null,                                'automation_rules',    null,       null,       6),
  ('concept',       null,                                null,                  null,       'object-manager',         7),
  ('concept',       null,                                null,                  null,       'page-layout-editor',     8),
  ('concept',       null,                                null,                  null,       'record-type-management', 9),
  ('concept',       null,                                null,                  null,       'field-level-security',  10),
  ('concept',       null,                                null,                  null,       'incoming-fks',          11),
  ('concept',       null,                                null,                  null,       'admin-configuration',   12)
) as t(anchor_type, route, object, field, concept, sort_order);
