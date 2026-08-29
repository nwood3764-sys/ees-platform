-- ============================================================================
-- HA-00202 — The record header stays on screen while you scroll
-- ----------------------------------------------------------------------------
-- Nicholas, 2026-08-29, partway down an incentive application: "when we scroll
-- down on a page, we kind of lose everything. We don't really know where we're
-- at. I need this section here to remain locked so the Save button and edit
-- buttons are still available, but the user also knows where they're at."
--
-- Data only — no schema change. The behaviour is in the app; this is the
-- article that describes it.
-- ============================================================================

insert into help_articles
  (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
   ha_category, ha_audience, ha_is_published)
select gen_random_uuid(), 'HA-00202', 'record-header-stays-on-screen',
 'The Record Header Stays on Screen While You Scroll',
 'On every record page the breadcrumb trail, the record''s name and status, its action buttons and its tabs stay pinned to the top — scroll as far down as you like and Edit, Save and Actions are still one click away.',
$md$## What changed

Open any record — a property, an opportunity, an incentive application, a work
order — and scroll down. The top of the page no longer scrolls away with it.

Pinned to the top of the record, on every object:

- **The breadcrumb trail** — the module, the object's list, and the parent
  records this one sits under. Every crumb is still a link.
- **The record's identity** — its icon, its name, its record number and its
  status.
- **The action buttons** — Edit, Actions, and any buttons that object carries
  (Verify Fields, Generate…, Advance…). While you are editing, the same place
  holds **Save** and **Cancel**.
- **The tabs** — Details, Related, Activity and any custom tabs, pinned
  directly under the header.

Everything else — the stage path, the field sections, the related lists —
scrolls underneath it as usual.

## It gets out of your way

At the top of a record the header is the full card you have always seen: the
large title, the object and record-type labels, the status.

As soon as you start scrolling it **condenses to a single line** — the same
name, record number, status and buttons, in about a third of the height — so a
long field section still has room to read. Scroll back to the top and it opens
out again.

A very long record name is shortened with an ellipsis on that single line; hover
it to read the whole thing, or scroll back to the top.

## Saving from anywhere on the page

This is the part that matters on a long form. Click **Edit**, scroll to a
section near the bottom of the record, make your change — **Save** is still
sitting at the top of the screen. You no longer have to scroll back up to find
it, and there is no separate save button further down the page that could get
out of step with it.

## On a phone or tablet

Nothing changed on mobile: the record's compact header bar (back arrow, record
name, actions) was already fixed to the top of the screen, and while you are
editing, Save is already fixed to the bottom.
$md$,
 'Navigation', 'all', true
where not exists (select 1 from help_articles where ha_slug = 'record-header-stays-on-screen');
