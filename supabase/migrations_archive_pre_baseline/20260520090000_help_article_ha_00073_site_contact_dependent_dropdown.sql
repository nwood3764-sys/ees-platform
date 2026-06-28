-- =====================================================================
-- HA-00073 — Site Contact dependent dropdown on property records
-- =====================================================================

INSERT INTO help_articles (
  ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published
) VALUES (
  'site-contact-dependent-dropdown',
  'Site Contact dropdown filters by property accounts',
  'On a property record the Site Contact picker now shows only contacts related to the property''s owner account or managing account, instead of every contact in the system. Edit the parent account to refresh the list.',
  $md$
On a property record the **Site Contact** field is a dependent dropdown.
The list of selectable contacts is filtered by the property's parent
accounts — specifically the **Property Owner** and **Property Management
Company** fields on the same record.

A contact appears in the picker when either:

* The contact's primary account (`contacts.contact_account_id`) is one
  of the property's parent accounts, OR
* An active row in the **Account Contact Relations** junction
  (`account_contact_relations`) links the contact to one of the
  property's parent accounts.

## Edit-mode behavior

When you switch a property into edit mode the Site Contact dropdown
loads its options using the current saved values for **Property Owner**
and **Property Management Company**. If you change either of those
fields while editing, the Site Contact options refresh immediately
against the new value.

If neither parent account is filled in (typical on a new property
record), the picker shows a hint like
`— Fill property account or property managing account first —`
rather than appearing broken.

If the property already has a Site Contact saved that isn't currently
associated with either parent account (a historical data state), that
contact is still included in the picker so editing the record won't
silently lose the saved value.

## Layouts where this filter applies

The filter is configured on the Site Contact field in every property
page layout that includes it:

* Multifamily — Property Ownership Information
* Other — Information
* Single Family — Property Owner Information
* Non-Residential — Property Information

## How it is configured

In the page layout's field group, the field carries a
`lookup_dependency` clause in its `widget_config`:

```json
{
  "name": "property_primary_contact_id",
  "type": "lookup",
  "label": "Site Contact",
  "lookup_table": "contacts",
  "lookup_field": "contact_name",
  "lookup_dependency": {
    "kind": "contacts_for_accounts",
    "depends_on": [
      "property_account_id",
      "property_managing_account_id"
    ]
  }
}
```

* `kind` — names the query pattern. `contacts_for_accounts` calls the
  `list_contacts_for_accounts` Postgres RPC. Future kinds add new RPCs.
* `depends_on` — the host-record columns whose values feed the filter.
  Empty / null values are skipped; missing values yield an empty list.

Adding a new dependent-lookup pattern requires (1) a new RPC that takes
the dependency values and returns `{id, <display>}` rows and (2) a new
`case` in `fetchDependentLookupOptions` (`src/data/layoutService.js`).
No changes to `RecordDetail.jsx` are required — the dispatcher routes
on `kind` automatically.

## What this does not do

* It does not enforce the filter on the underlying foreign key at the
  database level. A direct SQL `UPDATE` or a record imported via a
  different path can still write any contact id to the column. The
  filter is a UX affordance for the typical editing path.
* It does not currently support OR-ing across multiple unrelated
  account fields beyond what the `contacts_for_accounts` RPC defines.
* It does not auto-clear the Site Contact value when the parent
  account changes. The saved contact remains in place; it appears in
  the refreshed list via the `p_include_contact_id` fallback in the
  RPC, so the user can decide whether to keep or change it.
$md$,
  'Records',
  'internal',
  true
);

INSERT INTO help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_field, haa_concept, haa_sort_order)
SELECT id, 'object', 'properties', NULL, NULL, 1 FROM help_articles WHERE ha_slug = 'site-contact-dependent-dropdown'
UNION ALL
SELECT id, 'field', 'properties', 'property_primary_contact_id', NULL, 2 FROM help_articles WHERE ha_slug = 'site-contact-dependent-dropdown'
UNION ALL
SELECT id, 'field', 'properties', 'property_account_id', NULL, 3 FROM help_articles WHERE ha_slug = 'site-contact-dependent-dropdown'
UNION ALL
SELECT id, 'field', 'properties', 'property_managing_account_id', NULL, 4 FROM help_articles WHERE ha_slug = 'site-contact-dependent-dropdown'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'dependent-lookup', 5 FROM help_articles WHERE ha_slug = 'site-contact-dependent-dropdown'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'site-contact', 6 FROM help_articles WHERE ha_slug = 'site-contact-dependent-dropdown'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'lookup-dependency-config', 7 FROM help_articles WHERE ha_slug = 'site-contact-dependent-dropdown';
