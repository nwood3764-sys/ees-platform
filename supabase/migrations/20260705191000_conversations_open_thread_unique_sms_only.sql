-- Email now threads per-conversation (multiple open threads per customer
-- address), so the one-open-thread-per-address-pair uniqueness applies to
-- SMS only (SMS has no thread concept — one running exchange per number).
DROP INDEX IF EXISTS public.conversations_open_thread_unique;
CREATE UNIQUE INDEX conversations_open_thread_unique
  ON public.conversations USING btree (conv_channel, conv_our_address, conv_customer_address)
  WHERE conv_is_deleted = false AND conv_status = 'open' AND conv_channel = 'sms';
