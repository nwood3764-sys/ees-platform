-- Communications Module v1, Slice 3
-- Adds a generated short-token column on conversations for fast O(1) lookup
-- by the inbound webhook's plus-address resolution path.
--
-- send-email-v1 injects c_<first-8-hex-chars-of-conv-id> into the From address
-- as a plus-addressed alias. Inbound replies that preserve the plus-address
-- arrive with the same token in toRecipients. The webhook must look up the
-- conversation by this 8-char token.
--
-- PostgREST .like() doesn't auto-cast uuid columns to text, so the original
-- design (LIKE 'token%' against id) didn't work over the JS client. A stored
-- generated column derived from id::text gives us a clean .eq() match plus
-- a partial index for O(1) lookups.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS conv_short_token text
  GENERATED ALWAYS AS (substring(id::text from 1 for 8)) STORED;

CREATE INDEX IF NOT EXISTS idx_conversations_short_token
  ON public.conversations (conv_short_token)
  WHERE NOT conv_is_deleted;

COMMENT ON COLUMN public.conversations.conv_short_token IS
  'First 8 hex chars of conversations.id (no dashes). Used by inbound-email-webhook to resolve threads from plus-addressed conversation tokens like assessments+c_8f3a2b1d@ees-wi.org. Generated column — never written directly.';
