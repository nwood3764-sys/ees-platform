# LEAP Activity + Email Layer — Handoff

**Status: SHIPPED to production (2026-07-05).** This document is the complete record of the activity-logging and two-way email layer: what's live, how it's built, the per-state rollout playbook, and the remaining follow-ups. A fresh session should be able to extend this system from this doc alone.

---

## 1. Vision / goal

Salesforce-parity activity tracking: every interaction — call, email, meeting, site visit, event, note — is logged against the records it relates to, visible everywhere it's connected, with **no manual copy/paste**. Email is fully intelligent: sent from shared program mailboxes through Microsoft Graph, stamped with a hidden conversation token, and **replies auto-log themselves** to the right record.

## 2. What shipped (all live on master + prod)

### Activity logging (PRs #57, #58, #59, #60)
- **Log Activity composer** (`LogActivityModal.jsx`) on the record header action bar + Activity tab for `opportunities`, `properties`, `contacts`, `accounts`. Type picker (Call, Email, Meeting, Site Visit, Event, Text Message, Note, Other — managed picklist `activities.activity_type`); Direction shows for communication types, Duration for time-based types.
- **Multi-relate with rollup** (Salesforce shared activities): `activity_relations` junction — one activity linked to many records, shown on each record's Activity timeline. Composer offers the record's connected parents ("Also relate to" checkboxes, default on).
- **Activity timeline** (`ActivityTimeline.jsx`) merges: audit/field history + email sends + envelope events + logged activities, with per-type badges and filter chips.
- RPCs: `log_activity(...)` (insert + relations), `list_activities_for_record(...)` (rollup read via junction), `list_relatable_records(...)` (composer's parent options). All SECURITY INVOKER.

### Email pipeline (PRs #61, #84–#90)
- **Outbound**: `send-email-v1` (v12) — real Graph send from the state/program shared mailbox (`resolve_outbound_mailbox_for_anchor`, non-overridable). Conversation pinned to the anchor record (opportunity/property/building/project/etc. FKs on `conversations`).
- **Program signatures** (2026-07-06, migration `20260706010500`): `outbound_mailboxes.obm_signature_html` — send-email-v1 (v13) appends the mailbox's token-substituted signature to every outbound email, replies included. Managed per mailbox as data; seeded for ncira@/ira@. Add a signature to each new state mailbox at rollout step 2.
- **Purpose-aware mailbox routing** (2026-07-05, migration `20260705232819`): `outbound_mailboxes.obm_purpose` managed picklist (`General Correspondence` / `Assessments`). The resolver picks the state's single active **General Correspondence** mailbox for record-anchored sends; a state with only one active mailbox of any purpose falls back to it; two-plus ambiguous boxes still return empty so the caller surfaces the config problem. Live routing: NC → `ncira@ees-nc.org`, WI → `ira@ees-wi.org` (`assessments.wi@EES-WI.org` is signatures/assessment-only and is never picked for correspondence).
- **Threading**: each fresh compose = a NEW conversation (`find_or_create_conversation(p_force_new)`); the one-open-thread unique index is scoped to SMS only. In-app replies pass `conversation_id`; customer replies route by token.
- **Hidden token**: `conv_short_token` (`c_` + 8 hex of conversation id) rides as the **reply-to** plus-address (`ncira+c_xxxxxxxx@ees-nc.org`) + `X-LEAP-Conversation-Token` header. Inbound webhook tier-1 matches it; tier-2 = In-Reply-To/Message-ID; tier-3 = sender→contact email; else → Unmatched Inbox triage.
- **Merge fields**: free-form AND template sends substitute `{{tokens}}`; cross-object roots hydrated per anchor (`RELATED_MERGE_ROOTS`): opportunity → property/building/account (+contact); project → those + opportunity; composer's `X.first.Y` paths normalized.
- **Attachments**: composer uploads to storage **pre-send** (`uploadAttachmentToStorage`), refs ride the payload, function inlines ≤2.5 MB total as Graph fileAttachments (Graph's ~4 MB request cap), larger → 30-day signed link appended to body; rows registered post-send (`registerAttachmentRows`). Read failure = send fails loudly.
- **Auto-renew**: `renew-graph-subscriptions` (v6) every 6h via pg_cron (`renew-graph-subscriptions-every-6h`), secret falls back to `GRAPH_WEBHOOK_CLIENT_STATE`. Verified against Microsoft (1/1 renewed).
- **DKIM**: EES-NC.org signed with its own domain (Defender toggle + 2 selector CNAMEs in GoDaddy DNS). Fixed gmail spam-foldering of attachment mail.
- **Rendering**: `ConversationPanel` renders email HTML sanitized (DOMPurify); composer no longer wipes drafts mid-send (`bodyHtmlSnapshot`; editor `setEditable` instead of re-create).
- **Self-test harness**: `admin-test-send-email` (v2) — actions `send` (service-role on-behalf-of, optional generated attachment, registers the attachment row), `reply_sim` (Graph-send to the tokenized alias → forces tier-1 threading), `inspect` (Graph read-back: subject/hasAttachments/bodyPreview). Gated by `x-graph-renewal-secret`. **Run this after ANY email-pipeline change** — it proved: real send, attachment on the delivered mail, merge fields resolved, reply auto-threaded in ~60s, zero triage leakage.
- `send-email-v1` accepts `on_behalf_of_user_id` for service-role callers only (compared against the service key env var; newer projects issue non-JWT secret keys).

### Help articles (prod)
- **HA-00118** Logging an Activity on a record. **HA-00119** Sending email from a record. **HA-00120** Email attachment virus scanning.

## 3. Current-state architecture map

| Piece | Where |
|---|---|
| Log Activity composer | `src/components/LogActivityModal.jsx` |
| Activity timeline (merged feed) | `src/components/ActivityTimeline.jsx` + `src/data/activityService.js` |
| Activity data layer | `src/data/callActivityService.js` |
| Header action registry | `src/data/recordActions.js` (`log_activity`) |
| Conversations panel / composer | `src/components/ConversationPanel.jsx`, `ComposeEmailModal.jsx`, `TiptapEmailComposer.jsx` |
| Email data layer | `src/data/conversationsService.js` |
| Send function | `supabase/functions/send-email-v1/` (v12 deployed) |
| Inbound webhook | `supabase/functions/inbound-email-webhook/` |
| Subscription renewal | `supabase/functions/renew-graph-subscriptions/` (v6) |
| Self-test harness | `supabase/functions/admin-test-send-email/` (v2) |
| Attachment scanner | `supabase/functions/scan-message-attachments/` (5-min cron) |
| DB: activities | `activities`, `activity_relations` (junction), picklists `activities.activity_type` / `.direction` |
| DB: email | `conversations` (anchor FKs incl. opportunity/property/building), `messages`, `message_attachments`, `outbound_mailboxes`, `unmatched_inbox` |
| Migrations (this layer) | `20260701120000`, `20260701140000`, `20260701160000`, `20260701170000`, `20260701180000`, `20260705190000`, `20260705191000`, `20260705232819` (mailbox purpose routing) |

**Pain points / hazards**
- Edge-function sources deployed out-of-band before this workstream (`outlook-oauth-*`, `outlook-disconnect`, `send-email-via-graph`, `create-graph-subscriptions`) are NOT in the repo. Repo has: send-email-v1, inbound-email-webhook, renew-graph-subscriptions, admin-test-send-email (all current).
- The per-user Outlook connect path (`user_outlook_connections`, `OutlookConnectionCard`) is a separate, parallel integration — NOT part of the shared-mailbox pipeline. Reconcile or retire later.
- Outbound Message-ID is synthetic (`graph-<msg id>`) — tier-2 reply matching is dead until reconciliation (tier-1 token carries the load and is verified working).
- Self-tests send the mailbox to ITSELF; the outbound copy of a self-send lands in Unmatched (no token on To) — the harness run-book is: dismiss with reason afterward.

## 4. Per-state email rollout playbook (NC + WI done; MI/CO/IN remain)

For each state, in order:
1. **M365**: create the shared program mailbox (e.g. `ncira@ees-nc.org` pattern for that state's program).
2. **LEAP**: insert/activate the `outbound_mailboxes` row (`obm_state`, `obm_address`, `obm_purpose='General Correspondence'`, `obm_is_active=true`). Assessment/signature-only boxes get `obm_purpose='Assessments'` and are never selected for record-anchored correspondence. Keep exactly ONE active General Correspondence box per state.
3. **DKIM**: Defender portal → Email authentication → DKIM → domain → copy the 2 selector CNAMEs → add at GoDaddy DNS → toggle Enabled.
4. **Subscription**: create the Graph inbox subscription for the new mailbox (via `create-graph-subscriptions`, deployed in prod) — the 6h cron then keeps it renewed.
5. **Verify autonomously**: `admin-test-send-email` → `send` (self, with attachment + merge tag) → `inspect` (hasAttachments + resolved body) → `reply_sim` (token) → confirm inbound message row on the conversation; dismiss the self-send's unmatched row.

## 5. Follow-ups (none blocking daily use)

1. **Message-ID reconciliation** — after Graph 202, read the sent item's real `internetMessageId` into `msg_external_message_id` so tier-2 reply matching works. (Tier-1 verified working.)
2. ~~Virus scan~~ — **DONE 2026-07-06**: `scan-message-attachments` edge function (5-min pg_cron `scan-message-attachments-every-5min`) runs LEAP's policy scan on every stored attachment — EICAR signature, executable magic bytes (PE/ELF/Mach-O), dangerous-extension blocklist, content-type spoofing — on top of Microsoft EOP's transit AV. Verdicts: `clean` / `blocked` (+`ma_virus_scan_engine`, `ma_virus_scan_detail`; `scan_failed` slow-retries hourly). ConversationPanel disables download on blocked files and shows the reason. Full ClamAV stays optional if a dedicated scan host ever exists.
3. ~~Program-aware mailbox routing~~ — **DONE 2026-07-05** as purpose-aware routing (`obm_purpose`, migration `20260705232819`). Program-level (`obm_program_id`) granularity remains available if a state ever runs two General Correspondence boxes for different programs.
4. **Commit out-of-band function sources** — pull `outlook-oauth-*`, `create-graph-subscriptions`, `send-email-via-graph` sources into the repo (or retire the per-user path).
5. **Contact dedupe** — `nwood3764@gmail.com` is on two contacts (test remnants); ambiguous for tier-3 matching. Clean via UI.
6. **Multi-contact activities** — composer links one contact; `activity_relations` already supports many (role `contact`), UI multi-select is additive.
7. **CC/BCC in composer UI** — send function accepts them; composer exposes To only.

## 6. Decisions (all DECIDED 2026-07-05, owner Nicholas)

- **Shared team mailboxes per state+program** (not per-user Outlook) for outreach/coordination email. NC = `ncira@ees-nc.org`; WI = `ira@ees-wi.org` (assessments.wi@ is signatures-only, never used for correspondence).
- **Email threads like email**: one conversation per exchange; new compose = new thread. (SMS stays one thread per number.)
- **Activity relations are user-picked** (checkboxes, defaults on), not auto-derived; rollup shows the activity on every linked record.
- **One shared secret** (`GRAPH_WEBHOOK_CLIENT_STATE`) gates the whole Graph pipeline (webhook, renewal cron, self-test harness).
