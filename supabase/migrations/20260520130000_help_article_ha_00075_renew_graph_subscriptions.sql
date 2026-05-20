-- =====================================================================
-- HA-00075 — Inbound email subscription renewal (renew-graph-subscriptions).
-- =====================================================================

INSERT INTO help_articles (
  ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published
) VALUES (
  'renew-graph-subscriptions',
  'Inbound email subscription renewal: keeping Graph webhooks alive',
  'Microsoft Graph subscriptions expire every ~3 days. The renew-graph-subscriptions cron edge function extends them every 6 hours so inbound email continues flowing without manual intervention.',
  $md$
Microsoft Graph's change-notification subscriptions — the mechanism
that powers inbound email threading via `inbound-email-webhook` —
have a hard expiration. Mail subscriptions live for up to 4230
minutes (~70 hours) and must be PATCHed before expiry. If a
subscription expires, Graph silently stops sending notifications and
inbound email goes dark. The renewal cron exists to prevent that.

## How it works

A pg_cron job named `renew-graph-subscriptions-every-6h` runs at
`0 */6 * * *` (every 6 hours, on the hour). The job calls the
`renew-graph-subscriptions` edge function via `net.http_post`,
authenticating with a pre-shared key in the `x-graph-renewal-secret`
header.

The function then:

1. Acquires an app access token via the same client_credentials flow
   as `send-email-v1`.
2. Calls `GET https://graph.microsoft.com/v1.0/subscriptions` to
   enumerate every subscription the app owns. Pagination via
   `@odata.nextLink` is supported but unlikely to fire — we expect
   single-digit subscriptions in practice.
3. For each subscription whose `expirationDateTime` falls inside the
   renewal window (default: next 24 hours), PATCHes a new
   `expirationDateTime` set to now + 4200 minutes (~70 hours, just
   under Graph's documented 4230-minute cap).
4. Returns a JSON summary `{mode, total_subscriptions,
   renewal_window_h, attempted, succeeded, failed[]}` and writes one
   row to `graph_subscription_renewal_runs` for observability.

The 6-hour cadence vs the ~70-hour expiry gives ~11x headroom — three
consecutive failed runs still leave time to react.

## Operating modes

* **Mock mode** — When any of `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`,
  or `OUTLOOK_TENANT_ID` is unset on the edge function, the function
  short-circuits to a no-op response with `mode: 'mock'`. Lets the cron
  schedule land cleanly before Azure AD is configured.
* **Real mode** — All three secrets present. Calls Graph, attempts
  renewals, writes observability row. Returns `mode: 'real'`.

## Authentication

The pg_cron job has no user JWT, so the function gates write access
behind a pre-shared key. The vault secret `graph_renewal_cron_secret`
must be set in Supabase Dashboard → Project Settings → Vault to match
the `GRAPH_RENEWAL_CRON_SECRET` environment variable on the edge
function. Until both are set the cron sends a literal sentinel
`__pending_secret__`, which the function:

* Rejects with 401 in real mode (when Azure AD is configured).
* Accepts in mock mode (when Azure AD is not yet configured).

So the schedule lands gracefully before any secrets are configured,
and surfaces a hard failure once Azure AD is real but the matching
cron secret hasn't been set.

## Observability

Every run writes one row to `graph_subscription_renewal_runs` with
`gsrr_summary` capturing the full response body. Inspect recent runs
with:

```sql
SELECT gsrr_ran_at, gsrr_summary
  FROM graph_subscription_renewal_runs
  ORDER BY gsrr_ran_at DESC
  LIMIT 24;
```

A healthy real-mode run shows `mode='real'`, `total_subscriptions >= 1`
once subscriptions exist, and `failed=[]`. A gap of more than 7 hours
between rows means the cron didn't run — investigate via
`SELECT * FROM cron.job_run_details WHERE jobname = 'renew-graph-subscriptions-every-6h' ORDER BY start_time DESC`.

## Manual invocation

The function is also callable directly (POST to `/functions/v1/renew-graph-subscriptions`)
with an optional body `{"renewal_window_hours": 72}` to do a one-off
catch-up renewal across a wider window. Capped at 72 hours to prevent
runaway renewals.

## Why this is safe to deploy before subscriptions exist

The function gracefully handles zero subscriptions: it lists, finds
nothing due for renewal, and returns
`{total_subscriptions: 0, attempted: 0}`. The cron schedule is
likewise harmless before subscriptions exist — at worst it writes
many "no work to do" rows to the observability table, which is fine.
$md$,
  'Communications',
  'internal',
  true
);

INSERT INTO help_article_anchors (haa_article_id, haa_anchor_type, haa_object, haa_field, haa_concept, haa_sort_order)
SELECT id, 'object',  'graph_subscription_renewal_runs', NULL, NULL, 1
  FROM help_articles WHERE ha_slug='renew-graph-subscriptions'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'graph-subscription-renewal', 2
  FROM help_articles WHERE ha_slug='renew-graph-subscriptions'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'inbound-email-webhook', 3
  FROM help_articles WHERE ha_slug='renew-graph-subscriptions'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'graph-webhook', 4
  FROM help_articles WHERE ha_slug='renew-graph-subscriptions'
UNION ALL
SELECT id, 'concept', NULL, NULL, 'pg-cron-edge-function', 5
  FROM help_articles WHERE ha_slug='renew-graph-subscriptions';
