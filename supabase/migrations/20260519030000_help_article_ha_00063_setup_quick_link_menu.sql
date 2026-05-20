-- Help article HA-00063 — Setup Quick Links on Every Record.
-- Documents the admin-only gear menu that ships in the same commit:
-- Edit Page Layout / Edit Object / Edit Record Types.

INSERT INTO public.help_articles
  (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published)
VALUES (
  '',  -- auto-numbering BEFORE INSERT trigger fills this in
  'setup-quick-link-menu',
  'Setup Quick Links on Every Record',
  'Admin-only gear menu on every record detail page that deep-links into Setup — Edit Page Layout, Edit Object, Edit Record Types.',
  $$
# Setup Quick Links on Every Record

If you have the **Admin** role, every record detail page has a small gear icon between the **Clone** and **Delete** buttons in the top-right toolbar. This menu is the fastest way to jump from a record you're looking at into the Setup pane that controls how that record renders or behaves.

The menu has three options:

## Edit Page Layout

Opens the **page layout for this specific object and record type** directly in Setup. No hunting through Object Manager → Page Layouts → filtering by object → scrolling to the right record-type variant. One click takes you to the layout that produced the page you were just looking at.

Example: you're viewing a Property whose record type is **Multifamily**. Clicking **Edit Page Layout** opens the **Multifamily** layout for properties, where you can drag fields between sections, add related-list widgets, or change which columns show in a field group.

## Edit Object

Opens **Setup → Object Manager**. From there you can:

- Add or rename columns
- Modify validation rules
- See the full set of record types on the object
- Edit record-type-specific behavior

## Edit Record Types

Opens **Setup → Record Types**. From there you can:

- Activate or deactivate record types
- Rename a record type's label
- Reorder record types in the picker that shows up when a user clicks New on the object

## Who sees this menu

Only users with the **Admin** role. Other users won't see the gear icon at all — the toolbar collapses naturally to show just Edit / Clone / Delete.

## When you'd use it

While you're iterating on the platform — adding new fields, reorganizing layouts, tuning validation rules. Salesforce admins know this pattern well: the productivity difference between hunting through Setup vs. jumping directly from the record you're staring at is enormous when you're making 20 small changes a day.
  $$,
  'Admin',
  'admin',
  true
);
