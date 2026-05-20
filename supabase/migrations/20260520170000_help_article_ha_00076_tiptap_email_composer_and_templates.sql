-- =====================================================================
-- HA-00076 — Rich-text email composer + template-driven send
--
-- Documents the TipTap composer that replaces the prior plain-text
-- <textarea> in ComposeEmailModal, the new template picker, and the
-- locked-region rendering contract.
-- =====================================================================

WITH article AS (
  INSERT INTO public.help_articles (
    ha_slug,
    ha_title,
    ha_category,
    ha_audience,
    ha_summary,
    ha_body_markdown,
    ha_is_published,
    ha_created_by,
    ha_updated_by
  ) VALUES (
    'tiptap-email-composer-and-templates',
    'Rich-text email composer + email templates',
    'Communications',
    'internal',
    'How to use the rich-text body editor, insert merge fields, and pick a template (including locked-region behavior).',
    $body$
# Rich-text email composer + email templates

The New Email modal now uses a rich-text editor (TipTap) and accepts an optional **template** that prefills subject and body. The send path still goes through `send-email-v1`; what changed is how you author the message.

## Two modes

The composer works in one of two modes, derived automatically from your template choice:

- **Free-form** — no template picked, or the picked template has no locked-region structure. The whole body is editable.
- **Template (structured)** — picked template has a `template_locked_regions` array with at least one region. Locked regions render as dimmed, uneditable blocks; editable regions render as bordered zones you fill in.

The dropdown label tells you which state you're in, and the helper text below the editor reflects the active mode.

## Selecting a template

The **Template** dropdown lists every Active email template whose `related_object` matches the record you're composing from (so on a work order, only work-order templates show; on a project, project templates; etc.). Selecting one:

1. Seeds the subject from the template's `subject` column (only if you haven't typed one yet — your edits aren't overwritten).
2. Sets the From mailbox to `template_default_outbound_mailbox_id` if the template specifies one.
3. Either prefills the body with `template.body_html` (free-form mode) or renders the locked + editable regions inline (template mode).

You can clear the template at any time by reselecting the blank option in the dropdown. Body content from a free-form-prefilled template stays in the editor when you clear; locked-region content does not.

## Merge fields

Two ways to insert a merge field:

- Type `{{` anywhere in the editor — a suggestion popup appears with the full merge-field catalog. Filter by typing the path or label, then `↑` / `↓` and `Enter` to pick.
- Click the **Merge field** button in the toolbar. Same catalog, modal popover with a search box.

Inserted fields render as styled chips like `{{project.project_name}}`. They serialize to literal `{{path}}` tokens in the outgoing HTML — the server-side resolver replaces them with live record values at send time.

The catalog covers Project / Property / Building / Unit / Work Order / Opportunity / Account scalars, collection-first-row fields, and synthetic groups (Report / User / Today). Signing anchors are intentionally excluded from the email picker since they only apply to documents.

## Locked regions (template mode)

When a template defines a `template_locked_regions` array, each entry is one of two types:

- `region_type: "locked"` — `region_content` text appears verbatim in the editor, with a dimmed background, a "Locked" tag in the corner, and a not-allowed cursor. You can't place the caret inside it.
- `region_type: "editable"` — appears as a bordered editable zone where you compose your part of the message. The `region_id` field on each editable region is what the composer maps your content to before send.

On send the composer extracts editable region HTML by region_id and submits `{ email_template_id, editable_regions: { region_id: html, ... } }`. The edge function reassembles the full body from the template's locked regions interleaved with your editable content, then validates that every locked region's resolved content appears verbatim in the assembled body. Send is refused if a locked region was tampered with.

## Per-template AI assist toggle

`template_ai_assist_allowed = false` on a template hides the AI assist affordance on that template's compose. The toggle is shown next to the template name when it's off, so authors know AI iteration is disabled for that path. (The AI assist panel itself lands in a follow-up slice.)

## Toolbar

The toolbar exposes the formatting marks most common in customer email:

- **Bold** (Ctrl+B), **Italic** (Ctrl+I), **Underline** (Ctrl+U)
- **Bulleted list** and **Numbered list**
- **Link** — opens a prompt for the URL; bare hostnames get `https://` prepended
- **Merge field** — opens the full picker modal

Spell check is the browser's native check (red squiggles in Chrome/Edge/Firefox). Grammarly's browser extension works against the TipTap surface unmodified.

## What's deferred to the next slice

- Tables, images, color picker — the spec calls for these eventually; for v1 they're not on the toolbar.
- **AI assist panel** — Claude-API-backed iteration on draft text, scoped to editable regions with record context and the user's voice profile. The data column exists (`template_ai_assist_allowed`) but no UI consumer yet.
- **Voice profile builder** — passive accumulation of the user's style signals from sent messages.
- **Locked-region authoring UI** — today templates are seeded with `template_locked_regions = []`. Authoring locked + editable structure on a template happens in the Templates Builder dedicated module (separate backlog item).

## Workflow examples

**Quick reply to a property owner** (free-form):
1. From a Contact page layout, click the green **New Email** in the Conversations widget.
2. Leave template blank. Subject + body, with merge fields as needed.
3. Send.

**Standard incentive-application acknowledgment** (template, locked-region structured once authored):
1. From the Incentive Application record, click **New Email**.
2. Pick "Incentive Application Submitted — WI HOMES" from the Template dropdown.
3. Subject and From mailbox prefill automatically.
4. Fill in the editable section(s).
5. Send. The locked compliance language and merge fields render server-side from the template, with your editable content stitched in between.

**Starting from a template body (template with no locked regions)** — same as above except the entire body is editable. The template's `body_html` lands in the editor as a starting point; merge fields still resolve at send time, but you can edit any line.
$body$,
    true,
    'c5a01ec8-960f-42ab-8a9e-a49822de89af',
    'c5a01ec8-960f-42ab-8a9e-a49822de89af'
  )
  RETURNING id, ha_slug, ha_record_number
)
INSERT INTO public.help_article_anchors (
  haa_article_id, haa_anchor_type,
  haa_object, haa_field, haa_concept, haa_route,
  haa_sort_order, haa_created_by
)
SELECT a.id, kind, obj, fld, cpt, rt, ord, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid
FROM article a,
LATERAL (VALUES
  ('object',  'email_templates',  NULL,                              NULL,                       NULL,  1),
  ('object',  'messages',         NULL,                              NULL,                       NULL,  2),
  ('object',  'conversations',    NULL,                              NULL,                       NULL,  3),
  ('field',   'email_templates',  'template_locked_regions',         NULL,                       NULL, 10),
  ('field',   'email_templates',  'template_ai_assist_allowed',      NULL,                       NULL, 11),
  ('field',   'email_templates',  'related_object',                  NULL,                       NULL, 12),
  ('field',   'email_templates',  'body_html',                       NULL,                       NULL, 13),
  ('concept', NULL,               NULL,                              'compose-email',            NULL, 20),
  ('concept', NULL,               NULL,                              'rich-text-editor',         NULL, 21),
  ('concept', NULL,               NULL,                              'tiptap-composer',          NULL, 22),
  ('concept', NULL,               NULL,                              'merge-field-chip',         NULL, 23),
  ('concept', NULL,               NULL,                              'locked-region',            NULL, 24),
  ('concept', NULL,               NULL,                              'editable-region',          NULL, 25),
  ('concept', NULL,               NULL,                              'email-template-picker',    NULL, 26)
) AS anchors(kind, obj, fld, cpt, rt, ord);

-- Sanity check
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.help_article_anchors haa
  JOIN public.help_articles ha ON ha.id = haa.haa_article_id
  WHERE ha.ha_slug = 'tiptap-email-composer-and-templates';
  IF v_count <> 14 THEN
    RAISE EXCEPTION 'Expected 14 anchors on HA-00076, found %', v_count;
  END IF;
END $$;
