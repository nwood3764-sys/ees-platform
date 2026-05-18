-- Communications Module v1, Slice 3
-- HA-00058: Inbound email — threading rules and the Unmatched Inbox

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
    '', 'inbound-email-threading-and-unmatched-inbox',
    'Inbound email — threading rules and the Unmatched Inbox',
    'Communications', 'all',
    'How LEAP threads inbound email replies onto the right conversation, what falls through to the Unmatched Inbox for triage, and what each resolution path means in practice. Covers the plus-addressed conversation token, In-Reply-To/References header matching, sender-email contact lookup, and idempotency under duplicate Graph notifications.',
$body$
# How inbound email threads onto the right conversation

Every customer reply that arrives at one of LEAP's shared mailboxes is processed by the `inbound-email-webhook` edge function. The function runs a three-step resolution chain to figure out which conversation the reply belongs to. If none of the three rules match, the email lands in the **Unmatched Inbox** for manual triage instead of being silently dropped.

## The three resolution rules, in order

**Rule 1 — Plus-addressed conversation token (primary).** Every outbound email we send carries a plus-addressed alias in the From line, like `assessments+c_8f3a2b1d@ees-wi.org`. The `c_8f3a2b1d` token is the first 8 hex characters of the conversation's UUID, indexed on the `conversations.conv_short_token` generated column. Most modern mail clients preserve plus-addressing in their replies, so this is the cheapest and most reliable match. When the recipient clicks Reply, the To address comes back to us with the same token, and we look up the conversation in one indexed query.

**Rule 2 — `In-Reply-To` and `References` headers.** Some corporate mail systems (older Exchange installs, certain mailing-list software) strip plus-addressing before sending. For these, we fall back to RFC 5322 message threading. Every outbound we send has an external Message-ID stored on `msg_external_message_id` — when a reply arrives with `In-Reply-To: <that-id>` or with the id in `References`, we match it back to the original message and use its conversation.

**Rule 3 — Sender email matched against contacts.** If neither the plus-address nor the Message-ID headers tell us where this belongs, we fall back to looking up the From address against `contacts.contact_email`. If the sender is a known contact and they have a recent open email thread on the same shared mailbox, we attach to that thread. This covers cases like a customer starting a new email instead of replying — same person, same mailbox, sensible thread.

## When all three fail — the Unmatched Inbox

If none of the rules match, the email writes to the `unmatched_inbox` table with `ui_status='awaiting_triage'`. This catches:

- Cold outreach from an unknown sender
- Replies where the sender's email isn't yet a Contact record
- Forwards from internal staff or external partners that originated outside any LEAP-tracked thread
- Anything sent to one of our shared mailboxes that wasn't a reply

The Unmatched Inbox surface (Communications module, deferred to a later slice) lets a coordinator review these and either link them to an existing conversation or create a new Contact + thread from the row.

## Idempotency under duplicate notifications

Microsoft Graph can — and does — fire the same change notification more than once. Each notification carries a Graph message id; we use the message's `internetMessageId` header as the canonical idempotency key (falling back to the Graph id when the header is absent). Before the resolution chain runs, the webhook checks whether `msg_provider_message_id` already exists on a non-deleted row. If yes, it returns `status:"duplicate"` and exits without inserting again.

The same idempotency holds for the Unmatched Inbox path via a unique constraint on `ui_provider_message_id` — replaying a notification that originally went unmatched returns `status:"duplicate"` rather than inserting a second triage row.

## Security boundary — clientState

The webhook accepts notifications only when the `clientState` field on every entry matches the `GRAPH_WEBHOOK_CLIENT_STATE` Supabase secret we registered when creating the Graph subscription. This is the security boundary against a forged inbound — without it, anyone who knew the webhook URL could inject messages into customer threads. clientState mismatches are silently dropped (Graph doesn't retry on validation failures) and logged for review.

## Subscription validation handshake

When a Graph subscription is first created, Microsoft sends a one-time validation request with `?validationToken=<token>` and expects the webhook to echo that token back as plain text within 10 seconds. The webhook supports this on both GET and POST since Graph's behavior varies between API versions.

## Mock mode

Production is currently in mock mode — the Azure AD Application Access Policy that grants `Mail.Send.Shared` and `Mail.ReadWrite.Shared` to the LEAP Azure AD app for the new shared mailboxes has not been configured yet. Until it lands, Graph won't deliver real notifications to the webhook.

For end-to-end testing without real Graph notifications, the webhook accepts an inline `_mock_message` field on each notification entry containing the full message body shape (subject, from, toRecipients, body, internetMessageHeaders, etc.). When `_mock_message` is present the webhook skips the Graph fetch and runs the resolution chain against the inline payload. This lets a coordinator post simulated payloads to verify plus-address resolution, Message-ID matching, and unmatched-inbox routing exactly as they would behave for real inbound. The day the Azure AD policy is configured, the webhook starts processing real Graph notifications with zero code changes.
$body$,
    true,
    v_admin_id, v_admin_id
  )
  RETURNING id INTO v_ha_id;

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_created_by) VALUES
    (v_ha_id, 'object', 'conversations',      v_admin_id),
    (v_ha_id, 'object', 'messages',           v_admin_id),
    (v_ha_id, 'object', 'unmatched_inbox',    v_admin_id),
    (v_ha_id, 'object', 'outbound_mailboxes', v_admin_id);

  INSERT INTO public.help_article_anchors (haa_article_id, haa_anchor_type, haa_concept, haa_created_by) VALUES
    (v_ha_id, 'concept', 'inbound-email',                v_admin_id),
    (v_ha_id, 'concept', 'inbound-email-webhook',        v_admin_id),
    (v_ha_id, 'concept', 'email-threading',              v_admin_id),
    (v_ha_id, 'concept', 'plus-addressing',              v_admin_id),
    (v_ha_id, 'concept', 'conversation-token',           v_admin_id),
    (v_ha_id, 'concept', 'conv-short-token',             v_admin_id),
    (v_ha_id, 'concept', 'in-reply-to-references',       v_admin_id),
    (v_ha_id, 'concept', 'unmatched-inbox',              v_admin_id),
    (v_ha_id, 'concept', 'idempotency',                  v_admin_id),
    (v_ha_id, 'concept', 'graph-subscription-handshake', v_admin_id),
    (v_ha_id, 'concept', 'client-state',                 v_admin_id),
    (v_ha_id, 'concept', 'mock-mode',                    v_admin_id);
END $$;
