# LEAP — Communications Module

**Status:** Architectural spec. Supersedes the older `leap-communications.md` reference file.
**Owner:** Nicholas Wood
**Last updated:** 2026-05-17

This document captures the decisions made for the LEAP Communications Module — covering customer-facing email (and eventually SMS) sending, receiving, threading, AI-assisted composition, attachment handling, and visibility permissions. It is the source of truth for the next build session on this module.

---

## Scope

The Communications Module handles **customer-facing, record-anchored correspondence**. Specifically:

- Outbound email to property owners, property managers, partner organizations, and program contacts
- Inbound email replies and customer-initiated communications
- SMS sends/receives (already partially implemented via Twilio v2 dual-write — extends the same pattern)
- AI-assisted composition with record context
- Templated communications driven by the Template Builder in LEAP Admin

**Out of scope:** internal team email (stays in Outlook), calendar invites (stays in Outlook), Microsoft Teams chat (stays in Teams), vendor coordination email unrelated to a specific record.

---

## Core Architectural Principle

> Outlook is the authoritative archive. LEAP is the operational view. Both stay in sync via Microsoft Graph.

Every customer-facing email exists in two places:
- **In the shared mailbox on Microsoft 365**, where any user with delegate access sees it through normal Outlook (desktop, web, mobile).
- **In LEAP's `messages` and `conversations` tables**, threaded onto the anchoring record's Conversations related list.

Outlook handles archival, search, mobile access, and team awareness of inbound. LEAP handles record context, AI assistance, threading, templates, and audit-grade logging.

---

## Send Architecture

### Microsoft Graph App Registration

LEAP authenticates to Microsoft 365 via a single app registration using **app-only authentication** (client credentials flow). One set of credentials held by LEAP; no per-user OAuth dance.

Required Graph permissions:
- `Mail.Send.Shared` — send mail from shared mailboxes
- `Mail.ReadWrite.Shared` — read inbound from shared mailboxes
- `MailboxSettings.Read.Shared` — read mailbox configuration

App registration credentials stored as Supabase Edge Function secrets (never in repo, never in client bundle).

### Shared Mailbox Routing

Sends go from EES-WI's existing shared mailboxes, one per program/state combination. The mailbox-to-program mapping is a config table in LEAP Admin, not hardcoded.

**New table: `outbound_mailboxes`**

| Column | Type | Notes |
|---|---|---|
| `outbound_mailbox_id` | uuid PK | |
| `outbound_mailbox_record_number` | text | OBM-#### auto-numbered |
| `outbound_mailbox_address` | text | e.g. `wi-homes@ees-wi.org` |
| `outbound_mailbox_display_name` | text | e.g. `WI HOMES Team` |
| `outbound_mailbox_program_id` | uuid FK → programs | |
| `outbound_mailbox_state` | text | WI/NC/CO/MI/IN |
| `outbound_mailbox_default_signature_template_id` | uuid FK → templates | |
| `outbound_mailbox_is_active` | boolean default true | |
| `outbound_mailbox_owner` | uuid FK → users | |
| standard audit cols | | created_at/by, updated_at/by, is_deleted |

LEAP picks the right shared mailbox at compose time based on the record context (program + state on the anchoring record/parent opportunity). If multiple match, user picks from a dropdown.

### Conversation Token Injection

Every outbound includes a plus-addressed conversation token in the From address:

`wi-homes+c_8f3a2b1d@ees-wi.org`

Where `c_8f3a2b1d` encodes the `conversation_id` (short-hashed for URL cleanliness). Microsoft 365 routes any plus-addressed mail to the base mailbox automatically — no infrastructure changes needed.

This token is the **primary** reply-threading mechanism. Two fallbacks for replies that don't preserve the plus address:

1. **Message-ID / In-Reply-To header matching.** Every outbound `Message-ID` stored on the `messages` row. Inbound webhook checks the `In-Reply-To` and `References` headers against stored Message-IDs.
2. **Sender-domain / contact-email matching.** If no token and no Message-ID match, look up the sender's email against `contacts.contact_email`. If a contact match exists with recent thread activity, attach to most recent open conversation. If no match, route to the Unmatched Inbox for triage.

### Send Flow

1. User clicks **Compose** on a record (or **Reply** on an existing message).
2. LEAP modal opens with template picker filtered by record type, program, state, status.
3. User picks template OR starts blank. Merge fields render as tokens in the editor.
4. User edits the editable region; locked regions are visually distinguished and uneditable.
5. (Optional) User invokes AI assist. AI receives editable region + full record context as system prompt; never sees resolved merge field values.
6. User clicks Preview. Merge fields resolve to live record values. User reviews exactly what the recipient will see.
7. User clicks Send.
8. LEAP edge function `send-email-v1`:
    a. Resolves all merge fields against the record.
    b. Generates the conversation token and Message-ID.
    c. Calls Microsoft Graph `POST /users/{shared-mailbox}/sendMail`. Graph automatically places a copy in the mailbox's Sent Items.
    d. Writes `messages` row with full content, recipients, attachments references, AI metadata.
    e. Writes/updates `conversations` row.
    f. Writes activity-timeline row anchored to the originating record.

---

## Inbound Architecture

### Microsoft Graph Change Notifications

LEAP subscribes to **`messages` change notifications** on each shared mailbox's inbox via Microsoft Graph webhooks. Subscriptions expire and must be renewed every 3 days — a daily cron edge function (`renew-graph-subscriptions`) handles this. If subscription renewal fails, alert Admin.

Webhook endpoint: `https://flyjigrijjjtcsvpgzvk.supabase.co/functions/v1/inbound-email-webhook`

### Inbound Webhook Flow

1. Microsoft Graph POSTs to webhook when new mail arrives in any subscribed mailbox.
2. Webhook fetches full message via Graph (`/users/{mailbox}/messages/{id}`).
3. Parse `To:` address for plus-addressed conversation token → match to `conversations.conversation_id`.
4. If no token, parse `In-Reply-To` and `References` headers → match against `messages.message_external_message_id`.
5. If no Message-ID match, sender-domain/email match against `contacts`.
6. If no match at all, write to `unmatched_inbox` for triage.
7. On match: write `messages` row (inbound), attach to conversation, write attachments to Supabase Storage (virus-scanned via ClamAV edge function before persisting), write activity-timeline row, increment unread badge for the assigned Project Coordinator.

### Unmatched Inbox

A dedicated view in the Communications surface. Lists inbound emails that couldn't be auto-threaded. Project Coordinators with appropriate permission can manually link an unmatched message to a contact + record. Once linked, the message attaches to that conversation and any future inbounds from the same sender on the same domain auto-thread correctly.

---

## Rich-Text Composition

### Editor: TipTap

LEAP uses **TipTap** (built on ProseMirror) as the rich-text editor. Installed as a React component, styled to match the LEAP design system.

**Built-in editor features:**
- Bold, italic, underline, strikethrough, color
- Bulleted and numbered lists, indent/outdent
- Hyperlinks
- Headings, blockquotes
- Tables
- Inline image embeds (paste, drag, upload to Supabase Storage)
- Markdown shortcuts
- Undo/redo
- Clean paste from Outlook, Word, Google Docs

**Spell check:** browser-native (`spellcheck="true"` on contenteditable). Works in every modern browser. No LEAP-side implementation needed.

**Grammar check:** Grammarly browser extension works on TipTap's contenteditable surface. No LEAP-side implementation needed.

**Merge fields as interactive chips:** TipTap custom Mention node. User types `{{` → dropdown of merge fields available for the current record context. Inserts as a styled chip that can't be partially edited. Renders to the final email as the resolved value at send time.

**Mobile:** same editor in LEAP Field Mobile PWA, with a simplified toolbar for small screens.

---

## Templates & Locked Regions

### The Locking Model

Every template has two kinds of regions:

- **Locked regions:** legal language, program-required disclosures, compliance statements, signature blocks, HAF/HUD references, regulatory boilerplate. Rendered exactly as defined in the Template Builder, with merge fields resolved. **Cannot be modified by users or by AI.**
- **Editable regions:** the personalized message body — where the user adds context, framing, and personal voice. Both users and AI can modify these.

Subject lines are **always editable**, never part of the locked-region schema. Defaults provided (template default subject, `Re: [original]` for replies) but user can override.

### Schema Impact

**`templates` table additions:**

| Column | Type | Notes |
|---|---|---|
| `template_locked_regions` | jsonb | Array of region objects defining locked sections. See structure below. |
| `template_ai_assist_allowed` | boolean default true | Per-template flag. If false, AI assist button is hidden in compose. |
| `template_default_outbound_mailbox_id` | uuid FK → outbound_mailboxes | Override mailbox selection at template level. |

**`template_locked_regions` structure:**

```json
[
  {
    "region_id": "greeting",
    "region_type": "locked",
    "region_content": "Dear {{contact_first_name}},",
    "region_order": 1
  },
  {
    "region_id": "personal_message",
    "region_type": "editable",
    "region_placeholder": "Personalize your message here...",
    "region_order": 2
  },
  {
    "region_id": "status_block",
    "region_type": "locked",
    "region_content": "Your application for {{program_name}} is currently in status: {{incentive_application_status}}.",
    "region_order": 3
  },
  {
    "region_id": "compliance_disclosure",
    "region_type": "locked",
    "region_content": "All incentives under this program are paid directly to EES-WI...",
    "region_order": 4
  },
  {
    "region_id": "signature",
    "region_type": "locked",
    "region_content": "{{user_signature}}",
    "region_order": 5
  }
]
```

**Enforcement is at the data layer, not just the UI.** The `send-email-v1` edge function validates the final composed message against the template's locked regions before sending. If a locked region's resolved content has been tampered with, send is refused and logged to `audit_log`. This protects against any future surface (mobile, API, bulk-send) that might bypass UI-level enforcement.

---

## AI Assist

### Behavior

Per the LEAP AI spec, the AI assistant is record-aware, permission-scoped, and always confirmation-required for sends (AI cannot click Send — it can only propose draft revisions).

In the compose modal, an **AI button** in the toolbar opens a side panel beside the draft. The panel is a chat interface scoped to this email composition.

**Context the AI receives automatically:**
- The anchoring record + its parent chain (opportunity → project → work order, etc.)
- The recipient contact + their relationship to the record
- Recent activity on the record (last 30 days)
- The user's voice profile (if opt-in enabled)
- The current draft of the editable region(s) only
- The merge field library scoped to this record context
- The template's locked regions as read-only reference

**Context the AI never receives:**
- Resolved merge field values (the AI sees `{{project_amount}}`, never the dollar number)
- Locked region content beyond what's needed to know what regions exist
- Other users' AI conversation transcripts
- Records the composing user doesn't have visibility into

### Guardrails

System-prompt-enforced rules, reinforced by examples:

1. **AI can only modify editable regions.** Locked regions are read-only to the AI.
2. **AI cannot introduce factual claims outside merge fields and locked text.** Specifically: no dates, dollar amounts, names, deadlines, program requirements, or policy statements as literal strings. The AI must use merge field tokens for any factual content.
3. **AI cannot resolve merge fields.** All resolution happens at send time by LEAP's merge-field resolver, against the live record. Single source of truth.
4. **Available merge fields are record-scoped.** AI only sees merge fields that exist for the current record context.
5. **AI cannot send.** User always clicks Send themselves. AI can only propose edits to the draft.

### Voice Profiles

**Opt-in, passively built.** Each user has a setting toggle: "Help my AI drafts sound like me." When enabled, LEAP stores style signals from sent emails (sentence length, formality, common phrasings, sign-off style) on the user's record. The AI uses this as style guidance.

No manual sample-email authoring required. Profile builds over time. User can review and reset their profile at any time.

### Per-Template AI Disable

For compliance-sensitive templates (HUD agreements, HAF documents, anything legally binding), set `template_ai_assist_allowed = false`. The AI button is hidden in the compose modal for those templates. User can still edit the editable regions manually, but no AI iteration is offered.

### AI Audit Trail

**`messages` table additions:**

| Column | Type | Notes |
|---|---|---|
| `message_ai_assisted` | boolean default false | True if any AI iteration was used in composition. |
| `message_ai_iterations` | integer default 0 | Count of AI iterations (user prompts to AI). |

**New table: `message_ai_transcripts`**

| Column | Type | Notes |
|---|---|---|
| `mat_id` | uuid PK | |
| `mat_record_number` | text | MAT-#### auto-numbered |
| `mat_message_id` | uuid FK → messages | |
| `mat_iteration_order` | integer | 1, 2, 3... |
| `mat_user_prompt` | text | What the user typed to the AI |
| `mat_ai_response` | text | What the AI proposed |
| `mat_user_accepted` | boolean | Did the user accept this proposal |
| `mat_draft_snapshot` | jsonb | Editable region content at this iteration |
| `mat_created_at` | timestamptz | |
| `mat_owner` | uuid FK → users | The composing user |

If a property owner ever disputes what they were told, full traceability: who sent it, when, AI-assisted yes/no, what the AI proposed at each step, what the user accepted, what the final approved draft was.

---

## Attachments

### Size & Type Rules

- **Allowed types:** PDF, DOCX, XLSX, PPTX, PNG, JPG, HEIC, HEIF, CSV, TXT, ZIP. Common business formats.
- **Blocked types:** executables/scripts (.exe, .bat, .sh, .ps1, .vbs, .js, .jar, .dll). Refused at upload with clear error.
- **Virus scanning:** ClamAV edge function scans every upload before persistence. Infected files refused and logged.
- **Up to 25 MB per file:** sent as normal email attachment via Microsoft Graph. Microsoft 365's inbound limit is 25 MB; staying under it ensures delivery.
- **Over 25 MB:** automatic switch to LEAP Large File Transfer pattern. File uploads to Supabase Storage, email body includes a "Download attachment" signed-URL link, link expires after 30 days. No hard size cap on this path (within Supabase Storage limits).

User experience is seamless: they attach the file, LEAP picks the right delivery method.

### Storage

All attachments (outbound and inbound) stored in Supabase Storage under `communications/{conversation_id}/{message_id}/{filename}`. Linked from `message_attachments` junction table:

| Column | Type |
|---|---|
| `ma_id` | uuid PK |
| `ma_message_id` | uuid FK → messages |
| `ma_storage_path` | text |
| `ma_file_name` | text |
| `ma_file_size_bytes` | bigint |
| `ma_mime_type` | text |
| `ma_delivery_method` | text — `inline` or `signed_link` |
| `ma_virus_scan_status` | text — `clean`, `infected`, `pending` |
| `ma_signed_link_expires_at` | timestamptz |
| standard audit cols | |

---

## Email Visibility Permissions

### Visibility Model

A user can see an email/conversation if **any** of these are true:

1. **They are Admin.** Short-circuits all other checks.
2. **They sent it.** Their `users.id` matches `messages.message_sender_user_id`.
3. **They are a recipient.** Their email appears in `message_to`, `message_cc`, or `message_bcc`.
4. **They are on the parent opportunity's contact roles.** This is the canonical anchor. The RLS policy walks the anchoring record up to its parent opportunity and checks `opportunity_contact_roles` for the user (via their contact). If `ocr_includes_communications` is true on that role, the user sees the thread.
5. **They are the record owner.** The named owner on the anchoring record (or any ancestor in the chain).
6. **They have explicit "Communications: View All" permission** via their role or a permission set. Configured in Permission Builder. Reserved for Admin, Program Managers, senior Project Managers.

A user who matches none of these does not see the email thread in LEAP, even when looking at a record they otherwise have access to. The record's Conversations related list is filtered to threads they have visibility into; if zero, the related list is empty.

### The Opportunity-As-Anchor Principle

Email visibility is calculated against the **parent opportunity**, not the leaf record. Since almost all customer correspondence flows in the opportunity lineage (opportunity → project → work order → service appointment, etc.), contact roles on the opportunity propagate visibility down to all child records' email threads.

One contact-role assignment at the opportunity level = visibility across the full work lineage. Adding a Project Coordinator to an opportunity's contact roles gives them visibility into communications on every project, work order, and assessment under that opportunity. Clean, predictable, scales without per-record permission management.

Every record type that can have email anchored to it must have a clean parent-chain traversal back to an opportunity: project, work_order, assessment, incentive_application, payment_request, service_appointment, etc. The RLS helper function `resolve_anchor_opportunity(record_id, table_name)` handles the traversal.

### Schema Impact

**`opportunity_contact_roles` and other contact-role junctions** get a new flag:

| Column | Type | Notes |
|---|---|---|
| `ocr_includes_communications` | boolean default true | If false, this role does not confer email visibility |

Default-on for normal contact roles. Set false for tracking-only roles (e.g. utility contacts recorded for reference but not for correspondence visibility).

**New table: `communications_view_all_grants`**

Tracks which roles and permission sets confer cross-thread visibility.

| Column | Type | Notes |
|---|---|---|
| `cvag_id` | uuid PK |  |
| `cvag_role_id` | uuid FK → roles | Nullable |
| `cvag_permission_set_id` | uuid FK → permission_sets | Nullable |
| standard audit cols |  |  |

Exactly one of `cvag_role_id` or `cvag_permission_set_id` populated per row.

### RLS Policies

`messages` and `conversations` get RLS policies enforcing the visibility model. No application-layer filtering — the database refuses to return rows the user shouldn't see. This protects every surface: UI, API, edge functions, third-party tools using the publishable key.

Policy sketch (pseudocode):
```sql
CREATE POLICY message_visibility ON messages FOR SELECT TO authenticated USING (
  is_admin()
  OR message_sender_user_id = current_app_user_id()
  OR is_recipient(message_id, current_app_user_id())
  OR is_on_anchor_opportunity_contact_roles(message_id, current_app_user_id())
  OR is_record_owner_in_chain(message_id, current_app_user_id())
  OR has_communications_view_all(current_app_user_id())
);
```

Identical structure for `conversations` (visible if any of its messages are visible).

### AI Transcript Visibility — Stricter

`message_ai_transcripts` is more restricted than the message itself. Transcripts could contain candid framing ("Britton's been stressed about the timeline — soften this") that isn't appropriate for general thread visibility.

Visibility rules for `message_ai_transcripts`:
1. **Admin** — always.
2. **The composing user** — always.
3. **The record owner** of the message's anchoring record.
4. **Users with explicit "Communications: View All" permission.**

No contact-role-based visibility on transcripts. Recipients of the email don't see how the email was drafted with AI.

### Shared Mailbox Access Is Separate

LEAP's visibility model controls what users see **inside LEAP**. Shared mailbox access in Outlook is controlled by Microsoft 365 delegate permissions and is managed entirely on the M365 side.

The two access models can — and should — be different. A user with shared mailbox access in Outlook sees everything that mailbox sends and receives. A user looking at a record in LEAP sees only the threads relevant to that record given their LEAP visibility rules.

---

## Notifications

**One notification channel: LEAP itself.** No Teams webhooks, no digest emails, no SMS notifications about emails. The team already monitors shared mailboxes in Outlook; duplicating that into multiple LEAP-driven channels creates clutter without value.

LEAP surfaces unread items in two places:

1. **Bell icon in the topbar.** Shows an unread count. Click to see a panel of recent activity needing attention: new messages on threads assigned to the user, items awaiting approval, mentions, etc.
2. **Home screen "What needs my attention" dashboard.** Salesforce-style cards: unread messages, approvals queue, open to-dos, overdue tasks.

Both surfaces filter through the same visibility model. A user only sees notifications for threads they have visibility into.

---

## Schema Summary

New tables to add:

- `outbound_mailboxes` — shared mailbox configuration
- `conversations` — already exists from SMS v2; extend if needed
- `messages` — already exists from SMS v2; add AI metadata cols
- `message_attachments` — attachment metadata + storage refs
- `message_ai_transcripts` — full AI conversation history per message
- `communications_view_all_grants` — role/pset grants for cross-thread visibility
- `unmatched_inbox` — inbound emails awaiting manual triage

Existing tables modified:

- `templates` — add `template_locked_regions`, `template_ai_assist_allowed`, `template_default_outbound_mailbox_id`
- `opportunity_contact_roles` (and other contact-role junctions) — add `ocr_includes_communications`
- `messages` — add `message_ai_assisted`, `message_ai_iterations`, `message_external_message_id`
- `users` — add voice profile fields (opt-in toggle + style signals)

---

## Edge Functions

New functions to build:

- `send-email-v1` — composes and sends via Graph; writes messages/conversations/activity; validates locked regions before send
- `inbound-email-webhook` — Microsoft Graph notification receiver; threads inbound to conversations
- `renew-graph-subscriptions` — daily cron; renews Graph subscriptions every 3 days
- `virus-scan-attachment` — ClamAV scan on upload
- `ai-compose-assist` — Claude API wrapper scoped to editable regions with record context
- `resolve-merge-fields` — single source of truth for merge field resolution at send time

Existing functions affected:

- `send-notification-email` v2 — refactor or supersede; the new `send-email-v1` is the canonical path for record-anchored sends. `send-notification-email` may remain for system-generated notifications that aren't record-anchored.
- `send-notification-sms` v2 — already does dual-write; serves as the architectural pattern reference for email.

---

## Build Order

1. **Schema migration** — all new tables and column additions, RLS policies, helper functions (`is_admin`, `resolve_anchor_opportunity`, `has_communications_view_all`).
2. **Microsoft Graph app registration** — set up in Azure AD, store credentials in Supabase secrets, test app-only auth against a test shared mailbox.
3. **`outbound_mailboxes` seed data** — populate with all existing EES-WI shared mailboxes, map to programs/states.
4. **`send-email-v1` edge function** — minimum viable: text-only send, merge field resolution, conversation token injection, write to messages/conversations, copy to Sent Items via Graph.
5. **`inbound-email-webhook` edge function** — minimum viable: receive Graph notification, fetch message, thread by token (no fallbacks yet), write inbound row.
6. **Subscription management** — initial subscription creation per mailbox, renewal cron.
7. **TipTap editor integration** — drop into existing modal scaffolding, configure toolbar, style to design system.
8. **Locked region rendering** — visual treatment in editor, validation on send.
9. **Merge field chips** — TipTap mention node, scoped to record context.
10. **Attachments** — upload to Supabase Storage, virus scan, attach to message; large-file signed link path.
11. **AI assist panel** — Claude API integration, system prompt with guardrails, transcript capture.
12. **Voice profile** — opt-in setting, passive style signal accumulation.
13. **Unmatched Inbox** — surface in LEAP for manual triage.
14. **Notification bell + home screen cards** — unread surfacing.
15. **Permission Builder updates** — `Communications: View All` permission, per-role contact-role flags.
16. **Help articles** — one per shipped sub-feature, anchored to the relevant routes/records per the standing help protocol.

---

## Open Items For The Next Session To Resolve

These came up during the architectural conversation but were deferred:

- **Voice profile reset UX.** Should users be able to inspect their accumulated style signals, not just reset? Probably yes, but the UI hasn't been designed.
- **Cross-program email visibility for users in multiple programs.** A user who is a Project Coordinator on WI HOMES and CO Denver simultaneously — does the visibility model handle this naturally via multiple opportunity contact role assignments, or is there a cross-program ACL we're missing? Suspect it handles fine via the existing model, but worth verifying with a concrete test case.
- **Bulk send.** Not in scope for v1, but the architecture should not preclude it. Sending the same template to 50 property owners on a portfolio update should still respect locked regions and write 50 individual messages/conversations rows. Worth a design pass before building, but not blocking v1.
- **E-signature integration.** Per `leap-portals.md`, e-signature workflows render templates with merge fields → PDF → portal signature. The Communications Module should integrate cleanly with this — outbound e-sign requests should be a special send type, threaded into conversations like everything else. Spec'd later; flag the integration point.
- **Inbound from contacts whose email isn't in the system yet.** A new property manager replies from an unknown address. Match by domain to the parent account, prompt the Coordinator to confirm/create a contact record on triage. Logic exists in the Unmatched Inbox flow but UX needs design.
