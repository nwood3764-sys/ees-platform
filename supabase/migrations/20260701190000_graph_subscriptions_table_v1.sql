-- Records Microsoft Graph change-notification subscriptions created on shared
-- mailbox inboxes, so inbound replies get pushed to inbound-email-webhook.
-- create-graph-subscriptions writes here; renew-graph-subscriptions can read it.
CREATE TABLE IF NOT EXISTS public.graph_subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gs_mailbox         text NOT NULL,
  gs_subscription_id text,
  gs_resource        text,
  gs_expiration      timestamptz,
  gs_status          text NOT NULL DEFAULT 'active',   -- 'active' | 'error'
  gs_error           text,
  gs_created_at      timestamptz NOT NULL DEFAULT now(),
  gs_updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_graph_subscriptions_mailbox ON public.graph_subscriptions (gs_mailbox);

ALTER TABLE public.graph_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_select_graph_subscriptions ON public.graph_subscriptions;
CREATE POLICY app_select_graph_subscriptions ON public.graph_subscriptions
  FOR SELECT USING ((SELECT app_user_can('activities','read')));
GRANT SELECT ON public.graph_subscriptions TO authenticated;
