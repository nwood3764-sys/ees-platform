-- Communications Module v1, Slice 2
-- HA-00057: Composing a new email from the Conversations panel
--
-- Documents the MVP "New Email" button shipped on the Conversations panel
-- header for contact / account / project / service_appointment page layouts.
-- 15 anchors total: 7 object (the four parent objects that carry the panel,
-- plus conversations / messages / outbound_mailboxes) + 8 concept (compose-
-- email, new-email, send-email-v1, outbound-mailbox, conversation-token,
-- plus-addressing, mock-mode, email-threading).

DO $$
DECLARE
  v_admin_id uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af';
  v_ha_id    uuid;
BEGIN
  INSERT INTO public.help_articles (
    ha_record_number, ha_slug, ha_title, ha_category, ha_audience,
    ha_summary, ha_body_markdown, ha_is_published,
    ha_created_by, ha_updated_by
  ) VALUES (
    '', 'compose-email-new-thread',
    'Composing a new email from the Conversations panel',
    'Communications', 'all',
    'How to send a new email anchored to a contact, account, project, or service appointment using the New Email button on the Conversations related list. Covers free-form compose, the outbound mailbox picker, mock-mode behavior, and what happens to the new thread afterward.',
$body$
# Composing a new email

The **New Email** button on every Conversations panel header opens a compose modal that sends an email anchored to the current record. Available on the Conversations related list of contact, account, project, and service appointment page layouts.

## Where the button is

Open any contact, account, project, or service appointment record. The **Conversations** section in the related list has a panel header with a green **New Email** button to the left of the Refresh button. Click it to open the compose modal.

## What the modal asks for

- **From** — pick which outbound mailbox the email sends from. The dropdown lists every active row in the `outbound_mailboxes` config table. State is in the domain (`assessments@ees-wi.org` for Wisconsin, `assessments@ees-mi.org` for Michigan, etc.), so the picker shows the address plus a state tag.
- **To · Email** — the recipient's email address. Pre-filled when the parent record is a Contact and the contact has an email on file.
- **To · Name** — optional display name shown alongside the email address.
- **Subject** — required.
- **Message** — plain text for now. Line breaks are preserved. A rich-text editor with locked-region templates (legal language, program disclosures, signature blocks that the user cannot edit) lands in a later slice.

## What happens when you click Send

The modal calls the `send-email-v1` edge function. The function:

1. Resolves the outbound mailbox you chose.
2. Looks up the parent record (contact / account / project / service appointment) for merge-field context.
3. Calls `find_or_create_conversation` to thread on the `(customer email, mailbox)` pair. New customer = new thread; same customer = appended to the existing thread.
4. Builds a plus-addressed From like `assessments+c_8f3a2b1d@ees-wi.org` where `c_8f3a2b1d` encodes the conversation id. Inbound replies that preserve the plus-address auto-thread back to this conversation.
5. Generates an external Message-ID (`<leap-…@ees-wi.org>`) and stores it on `msg_external_message_id` for inbound `In-Reply-To` / `References` matching as a fallback.
6. Inserts the messages row in `'queued'`, then flips it to `'sent'`.
7. The AFTER INSERT rollup trigger updates the conversation's `conv_last_message_at`, `_direction`, and `_preview` so the panel's related list refreshes.

After a successful send the modal closes, the Conversations panel re-fetches its thread list, and the newly created thread is selected automatically. Your sent message appears in the right pane immediately.

## Mock mode

Production is currently in mock mode for Graph send. The Azure AD Application Access Policy that scopes `Mail.Send` to the new shared mailboxes has not been configured yet — until it lands, the edge function skips the actual Graph `sendMail` call and writes a `mock-<uuid>` provider id to the row.

In mock mode:
- The compose modal still works end-to-end.
- The `messages` row is inserted and the conversation thread is created.
- The thread surfaces on the Conversations panel exactly as it would for a real send.
- No email actually leaves Microsoft 365 — the recipient receives nothing.

A success toast distinguishes the two states: real-mode says "Email sent"; mock-mode says "queued in mock mode — Graph credentials not yet configured."

The day the Azure AD policy is in place, the same compose flow starts delivering for real with zero code changes.

## Permissions and visibility

The compose modal honors the same role-object access as the rest of LEAP. You can only send from a record you have read access to. The email row that lands is subject to the spec's opportunity-anchored visibility model: you'll see it on the related list because you composed it; other users see it if they're on the parent opportunity's contact roles with `ocr_includes_communications` true, are a record owner anywhere up the parent chain, are explicit recipients, or have the **Communications: View All** permission.

## Limits in this slice

- **Free-form only** for now. Email templates with locked-region structure (legal disclosures, signature blocks, program boilerplate) require the rich-text editor; that ships in the next slice.
- **No CC / BCC fields** in the modal yet. The edge function accepts them — they're a UI add when needed.
- **No attachments** in the modal yet. The `message_attachments` table is in place; the upload flow + Supabase Storage wiring is its own slice.
- **No AI-assist panel** yet. The `message_ai_transcripts` table is in place; the Claude-API integration with the locked-region guardrails ships when the editor does.

## Replying to an existing email thread

The composer at the bottom of the right pane works for both SMS and email threads now. Pick the thread, type your reply, press Cmd/Ctrl + Enter or click Send. For email threads the reply is routed back through `send-email-v1` in free-form mode, anchored to the conversation's deepest FK (service_appointment > project > account > contact). The subject becomes `Re: <original subject>` automatically.
$body$,
    true,
    v_admin_id, v_admin_id
  )
  RETURNING id INTO v_ha_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_created_by) VALUES
    (v_ha_id, 'object', 'contacts',             v_admin_id),
    (v_ha_id, 'object', 'accounts',             v_admin_id),
    (v_ha_id, 'object', 'projects',             v_admin_id),
    (v_ha_id, 'object', 'service_appointments', v_admin_id),
    (v_ha_id, 'object', 'conversations',        v_admin_id),
    (v_ha_id, 'object', 'messages',             v_admin_id),
    (v_ha_id, 'object', 'outbound_mailboxes',   v_admin_id);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_created_by) VALUES
    (v_ha_id, 'concept', 'compose-email',        v_admin_id),
    (v_ha_id, 'concept', 'new-email',            v_admin_id),
    (v_ha_id, 'concept', 'send-email-v1',        v_admin_id),
    (v_ha_id, 'concept', 'outbound-mailbox',     v_admin_id),
    (v_ha_id, 'concept', 'conversation-token',   v_admin_id),
    (v_ha_id, 'concept', 'plus-addressing',      v_admin_id),
    (v_ha_id, 'concept', 'mock-mode',            v_admin_id),
    (v_ha_id, 'concept', 'email-threading',      v_admin_id);
END $$;
