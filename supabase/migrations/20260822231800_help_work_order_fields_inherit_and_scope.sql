-- Help article: what a work order fills in for you, and why the pickers are short.
INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published
) VALUES (
  '', 'work-order-fields-inherit-and-scope',
  'Work Order Fields: What Fills Itself In, and Why the Pickers Are Short',
  'Account and Contact come down from the property chain, and Building, Unit, Project, Opportunity and Contact only offer records that belong to this job.',
$md$
# Work Order Fields

A work order sits under a property, a building, an opportunity and a project. It should never ask you for something that chain already answers, and it should never offer you a record from a different job.

## What fills itself in

**Account** is not a choice. A work order belongs to whoever owns the property the work is performed at, so LEAP sets it from the property and keeps it there. Re-point a property at a different account and its work orders follow. (The subcontractor doing the work is a separate field — **Assigned Subcontractor**.)

**Contact** is filled in when the work order is created, from the most specific person the chain knows:

1. the opportunity's **Property Site Contact**
2. the **building's** primary contact
3. the **property's** primary contact
4. the opportunity's **Account Contact**

It is a starting point, not a lock — change it and your answer stays. If it comes up empty, the chain genuinely has no contact on it; add one to the property, the building or the opportunity and new work orders will pick it up.

## Why the pickers only show a few records

Every child lookup is scoped to this work order's own parent chain:

| Field | Offers |
|---|---|
| **Building** | buildings on this work order's property |
| **Unit** | units in the chosen building — or, with no building yet, every unit on the property |
| **Project** | projects on this work order's opportunity |
| **Opportunity** | opportunities on this work order's property |
| **Contact** | people connected to this job: the site contact, the property's and buildings' contacts, the opportunity's contact roles, and everyone at the owning account and its parent companies |

If a picker says **"Fill property first"**, set the parent above it and the list appears. If it says **"No matching records"**, the parent is set and there genuinely is nothing under it yet — use **+ New** in the picker to create one in the right place.

A value already saved on the record always stays visible, even if the scope narrowed around it later.

## Assignment

Assignment lives on real records, never in a text box:

- **Work Order Owner** — the person accountable for the work order.
- **Assigned Technician** — a LEAP user.
- **Assigned Subcontractor** — a service provider account, with **Subcontractor Assigned** recording when.
- **Service Appointments** (the related list) — the scheduled visits, each with its own assigned people, date and time. This is what LEAP Pad shows a technician as today's stops.

The old free-text Assigned To / Assigned Technician / Assigned Subcontractor / Service Appointment boxes were carried over from the Salesforce import, were read by nothing, and have been removed.

## Property and Building are lookups now

Property and Building on the work order used to be text boxes holding a copy of the name. Anything typed into them was overwritten on the next save, because LEAP maintains those copies from the real records. They are now the real Property and Building lookups — click through to the record, or change the work order's parent, from the field itself.
$md$,
  'Field Operations', 'internal', true
);
