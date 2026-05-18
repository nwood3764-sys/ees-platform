-- Communications Module v1, Slice 4
-- HA-00059: Triaging the Unmatched Inbox

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
    '', 'unmatched-inbox-triage',
    'Triaging the Unmatched Inbox',
    'Communications', 'all',
    'How to work the Unmatched Inbox queue: linking inbound emails to existing conversations, dismissing rows that do not belong on a thread, and what each status means. Open at Setup → Communication Templates → Unmatched Inbox.',
$body$
# Triaging the Unmatched Inbox

The Unmatched Inbox is where inbound emails land when the `inbound-email-webhook` couldn't auto-thread them onto an existing conversation. The webhook runs a three-step resolution chain (plus-address token → In-Reply-To/References → sender + contact lookup); if all three rules miss, the email writes to `unmatched_inbox` with `ui_status='awaiting_triage'` and waits for a coordinator to look at it.

## Where it lives

**Setup → Communication Templates → Unmatched Inbox.** The triage page has a status filter at top (Awaiting triage · Linked · Dismissed · All) and defaults to **Awaiting triage** so coordinators see the work queue, not history.

## The triage decision

For every row, the question is: **does this email actually belong on a LEAP conversation?**

- **Yes** → Link it. Click the row, click **Link to conversation**, search the picker for the right thread on the same shared mailbox, click the conversation, click **Link**. The email is inserted onto that thread as an inbound message, the unmatched row is stamped `ui_status='linked'`, and the triage queue clears it.

- **No** → Dismiss it. Spam, an internal forward, a vendor newsletter, anything that isn't customer correspondence on a tracked thread. Click **Dismiss**, write a one-line reason (required), click **Dismiss**. The row is stamped `ui_status='dismissed'` with the reason and your user id; nothing is deleted.

Neither action ever deletes the original `unmatched_inbox` row — both decisions are stamps on the same row that preserve the full audit trail.

## What you see on each row

The left pane lists rows newest-received first. Each row shows the sender, subject, status pill, record number (UI-#####), and relative time. The right pane shows the full detail of the selected row:

- **From / To** addresses as they arrived on the wire
- **Received** timestamp (Microsoft Graph `receivedDateTime`)
- **Provider Message ID** — the canonical idempotency key (the email's `internetMessageId` header)
- **In-Reply-To / References** headers if present — these are the values the webhook tried to match against `messages.msg_external_message_id` before giving up
- **Body preview** — first 500 characters of the inbound message, sanitized (scripts and inline event handlers stripped)

## Link picker logic

The conversation picker shows email threads on the same shared mailbox the inbound was sent to (stripping any plus-addressing first — so an inbound that arrived at `assessments+c_abc123@ees-wi.org` searches against `conv_our_address = 'assessments@ees-wi.org'`). Threads are ordered newest activity first. The filter input matches subject, customer email, or conversation number.

## What status the linked message lands with

When you click Link, the function inserts a row into `messages` with `msg_direction='inbound'`, `msg_channel='email'`, `msg_status='received'`, the original Message-ID preserved on `msg_external_message_id`, and `msg_provider_message_id` set to the same value as the unmatched row's provider id. The conversation's AFTER INSERT rollup trigger updates `conv_last_message_at`, `conv_last_message_direction='inbound'`, `conv_last_message_preview`, and increments `conv_inbound_unread_count` exactly as it would for an auto-threaded inbound.

If the original message somehow already exists on the target conversation (e.g. you linked a duplicate row that had already been threaded another way), the function returns "already existed" and just stamps the unmatched row without double-inserting.

## What dismiss preserves

Dismissed rows aren't deleted. They stay in `unmatched_inbox` with `ui_status='dismissed'`, your written reason on `ui_dismissed_reason`, your user id on `ui_updated_by`, and a timestamp. You can audit them later via the **Dismissed** filter at the top of the page. If you ever realize a dismiss was wrong, the row is still there and (in a follow-up enhancement) can be re-opened to triage.

## What's not in v1 of this surface

- **Create-new-thread**. If an inbound is from an unknown sender on an unknown topic and there's no existing thread to link to, the only option in v1 is dismiss. Creating a new conversation + contact from the row is its own follow-up slice.
- **Bulk dismiss**. Each row is dismissed individually. Bulk actions land when the queue grows enough to need them.
- **Re-open dismissed**. Dismissed is currently terminal; a re-open action is straightforward to add when needed.
$body$,
    true,
    v_admin_id, v_admin_id
  )
  RETURNING id INTO v_ha_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_created_by) VALUES
    (v_ha_id, 'object', 'unmatched_inbox',    v_admin_id),
    (v_ha_id, 'object', 'conversations',      v_admin_id),
    (v_ha_id, 'object', 'messages',           v_admin_id),
    (v_ha_id, 'object', 'outbound_mailboxes', v_admin_id);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_route, haa_created_by) VALUES
    (v_ha_id, 'route', '/admin/unmatched_inbox', v_admin_id);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_created_by) VALUES
    (v_ha_id, 'concept', 'unmatched-inbox',          v_admin_id),
    (v_ha_id, 'concept', 'unmatched-inbox-triage',   v_admin_id),
    (v_ha_id, 'concept', 'link-conversation',        v_admin_id),
    (v_ha_id, 'concept', 'dismiss-row',              v_admin_id),
    (v_ha_id, 'concept', 'email-threading',          v_admin_id),
    (v_ha_id, 'concept', 'inbound-email-webhook',    v_admin_id);
END $$;
