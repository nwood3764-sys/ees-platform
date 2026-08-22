-- Correct the administrator paragraph of HA "System Information on every record".
--
-- The first draft said an administrator manages Record Audit Column Overrides
-- in Setup. Object Manager is schema administration only — it has Details,
-- Fields & Relationships, Page Layouts and Record Types tabs, and no way to
-- edit an object's ROWS. The overrides table is registered in the Object
-- Manager catalog so its shape is visible, but editing a row today is a
-- database change, and the help article must say what is true.
UPDATE public.help_articles
   SET ha_body_markdown = replace(
         ha_body_markdown,
'Each object''s audit columns are resolved by naming convention (`<object>_created_at`, `<object>_created_by`, and so on). The few objects whose columns are named differently are listed in **Record Audit Column Overrides**, where an administrator can point an object at the columns that actually hold its create and modify stamps. The two append-only system logs — the audit log and field history — are there: a row in either is written once and never modified, so the moment it was written *is* both its created and its last-modified stamp.',
'Each object''s audit columns are resolved by naming convention (`<object>_created_at`, `<object>_created_by`, and so on), so a new object needs no setup at all.

Two objects are exceptions, and they are recorded in the **Record Audit Column Overrides** table: the audit log and field history. A row in either is written once and never modified, so the moment it was written *is* both its created and its last-modified stamp, and both fields point at the same column. If another object ever needs an exception, adding it is a database change — ask for it rather than editing a page layout, because the four fields are placed from that one definition.')
 WHERE ha_slug = 'system-information-on-every-record'
   AND ha_is_deleted = false;
