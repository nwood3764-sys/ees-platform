-- Help article for the Inherited Field type (HA-00161). Record number is
-- assigned by trg_help_articles_rn (pass '').
INSERT INTO public.help_articles (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published)
VALUES ('', 'inherited-fields', 'Inherited Fields — show a parent record''s value without re-typing it',
  'Create a read-only field that pulls a value from a base record up the relationship chain, so child records reference parent data instead of duplicating it.',
$md$
## What an Inherited Field is

An **Inherited Field** shows a value that lives on a **base record up the
relationship chain** — read-only, and never re-entered on the child. It is
Salesforce's cross-object formula field: you set the value once on the base
record, and it appears on every related record that inherits it.

There are two related building blocks — you use them together:

- **Lookup** — the relationship itself. It links this record to a parent record
  (e.g. an Opportunity to its Property/Account) and shows/links that record.
- **Inherited Field** — rides an existing relationship chain to display one of the
  base record's **fields** (owner email, site address, phone…). Read-only.

> The Lookup is the road; Inherited Fields are what travels it.

## Why use it

Don't copy a parent's data onto child records — it goes stale the moment the
parent changes. Inherit it instead: one source of truth on the base record, shown
everywhere, always current.

## Creating one

1. Object Manager → your object → **New Field**.
2. **Field Type → Inherited Field (from parent)** (under Relationship).
3. **Relationship to follow** — pick the parent this field inherits through
   (e.g. Property). Add another hop to reach further up the chain (e.g. Property →
   Account) for a value that lives on a grandparent.
4. **Field to show** — choose the base record's field to display.
5. **Display As** — how it renders (text, currency, email, date…). Auto-set from
   the source field; adjust if needed.
6. Save, then place the field on the page layout like any other.

## Notes

- Inherited Fields are **read-only** and carry an **INHERITED** chip. To change the
  value, edit it on the base record — it updates everywhere it's inherited.
- They have **no database column** — the value is resolved live when the record
  loads, so there is nothing to keep in sync.
- Version 1 supports **scalar** source fields (text, number, currency, date,
  email, phone, etc.). Picklist and lookup source fields are a later addition.
$md$,
  'Administration', 'admin', true);
