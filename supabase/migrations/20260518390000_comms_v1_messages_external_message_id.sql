-- Communications Module v1, Slice 1
-- Adds RFC 5322 Message-ID storage to `messages` for cross-channel inbound threading.
--
-- Usage by the inbound webhook fallback chain:
--   1. Plus-addressed conversation token  → conversations.id (primary)
--   2. In-Reply-To / References header   → messages.msg_external_message_id (this column)
--   3. Sender email match on contacts     → conversations resolution
--   4. Unmatched Inbox triage
--
-- Outbound:
--   send-email-v1 generates a Message-ID at compose time, stores it here, and
--   sets the same value on the outgoing email's Message-ID header. The Twilio SMS
--   path keeps using `msg_provider_message_id` (SID) — this column is for RFC 5322
--   email Message-IDs specifically.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS msg_external_message_id text;

-- Partial index for inbound threading lookups (the only access pattern).
-- Excludes NULLs (SMS rows) so the index stays small.
CREATE INDEX IF NOT EXISTS idx_messages_external_message_id
  ON public.messages (msg_external_message_id)
  WHERE msg_external_message_id IS NOT NULL;

COMMENT ON COLUMN public.messages.msg_external_message_id IS
  'RFC 5322 Message-ID for email rows. Used for inbound threading via In-Reply-To / References when the conversation token is absent. NULL for SMS.';
