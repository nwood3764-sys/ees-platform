-- ─── Help article — Envelopes and e-signature ────────────────────────
--   • HA-00043 envelopes-and-e-signature
-- Sixth article closing the open help-articles backlog. After this
-- commit, the remaining outstanding articles are: Reports module,
-- Dashboards.
--
-- Body content references real platform state at migration-write time:
--   7 envelopes, 7 envelope_recipients, 0 envelope_tabs (schema ready),
--   32 envelope_events,
--   env_status picklist: Draft / Sent / Delivered / Completed /
--     Declined / Voided / Failed,
--   recipient_status picklist: Created / Sent / Delivered / Signed /
--     Declined / AutoResponded / Completed / Voided,
--   tab_type picklist: signature / initial / date / text,
--   event_type picklist (16 values): Created, Sent, EmailDelivered,
--     EmailBounced, Opened, Viewed, ConsentGranted, TabFilled, Signed,
--     AdvancedToNext, Completed, Declined, Voided, Failed, Resent,
--     Expired,
--   template-snapshot binding via document_template_snapshot_id,
--   ESIGN-Act audit trail (recipient_consent_at + IP + user-agent
--     capture on envelope_events).

insert into help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_body_markdown, ha_category, ha_audience, ha_is_published
) values (
  '',
  'envelopes-and-e-signature',
  'Envelopes and e-signature — sending, signing, voiding, and the audit trail',
  'How LEAP''s e-signature stack works end to end. Covers the four-table ' ||
  'data model (envelopes / envelope_recipients / envelope_tabs / ' ||
  'envelope_events), the lifecycle states with branches for ' ||
  'Declined / Voided / Failed, recipient routing order, tab types and ' ||
  'positioning, the ESIGN-Act-compliant audit trail (consent timestamp ' ||
  '+ IP + user-agent capture), template-snapshot binding for legal ' ||
  'stability, the void-vs-decline distinction, and the token-based ' ||
  'signing URL pattern.',
  $body$
The e-signature stack in LEAP is a four-table data model rooted at `envelopes`. An envelope wraps one rendered PDF (produced from a document_template) and routes it through one or more recipients who sign in defined order. Every meaningful action — sent, opened, signed, declined, voided — writes an audit event that satisfies the ESIGN Act's evidence requirements.

### The four-table model

| Table | Purpose | Today |
|---|---|---|
| `envelopes` | One row per send. Carries the parent record reference, the source template + snapshot, the lifecycle status, and the storage paths for the unsigned/signed/certificate PDFs. | 7 |
| `envelope_recipients` | One row per signer. Carries the signing order, the role resolution against the parent record's contacts, the per-recipient lifecycle (sent/delivered/signed/declined), and the signing-session audit trail (IP, user-agent, consent timestamp). | 7 |
| `envelope_tabs` | One row per signable area on the document (signature box, initial box, date field, free-text field). Anchor-based or absolute-positioned. | 0 (schema ready) |
| `envelope_events` | Append-only event stream. Every state transition, email delivery callback, view, scroll, fill, sign produces a row here. | 32 |

The four-table split mirrors DocuSign's data model so a future provider migration (DocuSign / HelloSign / Adobe Sign) is a config swap rather than a schema rewrite.

### Envelope lifecycle

Status values on `envelopes.env_status`:

```
                                  ┌──→ Declined
                                  │
Draft → Sent → Delivered → ──────┼──→ Completed
                                  │
                                  ├──→ Voided
                                  │
                                  └──→ Failed
```

- **Draft** — envelope row exists, recipients defined, but the provider hasn't been called yet. Recipients have no signing URLs. Editable.
- **Sent** — provider call succeeded; the first recipient (lowest `recipient_order`) has been emailed a signing URL. `env_sent_at` stamped.
- **Delivered** — at least one recipient has had email delivery confirmed by the provider's callback. `env_delivered_at` stamped.
- **Completed** — every recipient has signed. The signed PDF is uploaded to `env_signed_pdf_path`, the certificate of completion to `env_certificate_path`, and a `documents` row is created and linked via `env_signed_document_id`. `env_completed_at` stamped.
- **Declined** — any recipient declined. `env_declined_at` stamped. The decline reason is captured on the recipient row, not the envelope.
- **Voided** — sender canceled the envelope mid-flight. `env_voided_at` stamped. The void reason is on `env_void_reason`.
- **Failed** — provider error (email bounced for every recipient, provider rejected the document, etc.). `env_failed_at` stamped. The failure reason is on `env_failure_reason`.

Once an envelope reaches Completed / Declined / Voided / Failed it's terminal — no further state transitions. The schema doesn't enforce a strict state machine via constraints; it's enforced at the application layer in the envelope service.

### Recipient routing

`envelope_recipients` carries the signing order on `recipient_order` (integer, ascending). The provider sends signing URLs to recipients sequentially — recipient #1 gets their email immediately; recipient #2 doesn't get an email until #1 signs.

`recipient_role` is the role on the parent record (e.g. `PropertyOwner`, `PropertyManager`, `EES_Auditor`). The platform resolves the role against the record's contact roles to pick a specific `recipient_contact_id` at send time. `recipient_email` and `recipient_name` are cached on the row so a later change to the contact (different email address) doesn't retroactively re-route an in-flight envelope.

Per-recipient status values on `recipient_status`:

```
Created → Sent → Delivered → Signed → Completed
                        │
                        ├→ Declined
                        ├→ AutoResponded
                        └→ Voided   (when the envelope is voided)
```

The envelope's overall status is computed from its recipients — Completed when all are Signed; Declined as soon as any one declines.

### Tabs

Tabs are the signable areas on a document. Each tab belongs to one recipient and one envelope, and has a type:

- **signature** — a signature box. Required for the recipient to complete the envelope.
- **initial** — initials box (typically per-page).
- **date** — date field. Auto-fills with the signing timestamp by default.
- **text** — free-text field (name, title, address override, etc.).

Positioning is dual-strategy:

- **Anchor-based** (`tab_anchor_string`) — the platform searches the rendered PDF for the literal string (e.g. `"<<Owner Signature>>"`) and places the tab adjacent. The author embeds anchor strings in the document_template body; the rendered PDF carries them through; the provider strips them visually but uses them for positioning. Resilient to template re-flow.
- **Absolute** (`tab_page` + `tab_x` + `tab_y` + `tab_width` + `tab_height`) — explicit coordinates. Fragile against template revisions; used as a fallback when anchor-based positioning doesn't fit.

`envelope_tabs` is empty today because production envelopes have been using full-page signature-only flows (the provider auto-places a signature line at the bottom). The schema is ready for typed-tab flows when complex agreements need them.

### Audit trail (ESIGN Act compliance)

Every meaningful action writes to `envelope_events`. Event types:

| Event | When |
|---|---|
| `Created` | envelope row was inserted (Draft state) |
| `Sent` | provider call succeeded; first recipient email issued |
| `EmailDelivered` | provider callback: recipient's email server accepted delivery |
| `EmailBounced` | provider callback: bounce |
| `Opened` | recipient clicked the signing URL |
| `Viewed` | recipient progressed past the consent page into the document |
| `ConsentGranted` | recipient ticked the ESIGN-Act consent box. **This is the legal pivot point** — without it, the signature isn't enforceable. |
| `TabFilled` | recipient entered/selected a value on a tab |
| `Signed` | recipient completed all their tabs and submitted |
| `AdvancedToNext` | the next recipient in the routing order was emailed |
| `Completed` | all recipients signed; envelope reached terminal state |
| `Declined` | a recipient declined; envelope reached terminal state |
| `Voided` | sender voided the envelope |
| `Failed` | provider-side failure |
| `Resent` | sender re-issued a signing URL to a recipient |
| `Expired` | recipient's signing token expired before they signed |

Each event row also captures `event_ip_address` (inet) and `event_user_agent` (text). For Signed events specifically, these are the IP + UA the signer used at the moment of signing. The `recipient_consent_at` timestamp on `envelope_recipients` is the ESIGN consent moment; combined with the `ConsentGranted` event row, this is the evidence trail an auditor or court would want.

`event_metadata` (jsonb) carries provider-specific payload — the raw webhook body, the signing certificate hash, etc.

### Template-snapshot binding

When an envelope is sent, it captures both `document_template_id` (the live template) and `document_template_snapshot_id` (the immutable snapshot of that template's body at the time of send). This is critical: if the template gets revised after send, the in-flight envelope still references the body the customer is actually looking at.

The snapshot binding is what makes the document/email-templates snapshot pattern (HA-00042) legally meaningful — the customer signed a specific document, and the platform can prove exactly what that document said.

### Storage paths

Three PDF artifacts per envelope:

- `env_unsigned_pdf_path` — the rendered PDF at send time. Generated from the document_template snapshot.
- `env_signed_pdf_path` — the same document with all signatures, initials, dates, and text-fill values rendered onto it. Populated when the envelope reaches Completed.
- `env_certificate_path` — the provider's Certificate of Completion. A separate PDF (legally required by some providers) summarizing the signing event with timestamps, IPs, and a tamper-evident hash.

All three paths point at the Supabase storage `documents` bucket. The `env_signed_document_id` FK links to a `documents` table row that surfaces the signed PDF in the parent record's documents related list.

### Void vs Decline

Distinct concepts:

- **Decline** is the recipient's action. They reviewed the document and refused to sign. The envelope is dead from that point; no further routing. A decline reason (recipient_decline_reason) is captured on the recipient row. The originating record stays in whatever status it was — the workflow has to handle "envelope declined" as an explicit next-state decision.
- **Void** is the sender's action. They sent the envelope, then realized something was wrong — wrong recipient, wrong document, wrong terms — and pulled it back. Any recipients who haven't signed yet immediately have their signing tokens invalidated. The envelope reaches Voided. The void reason (env_void_reason) is captured on the envelope row.

Both produce terminal events on the audit stream, so the audit trail is clear about which actor stopped the signing flow.

### Token-based signing URLs

The provider doesn't see the parent record. Recipients click a signing URL that hands off a single-use token. The token is captured on `recipient_signing_token` with `recipient_token_expires_at` for short-lived URL safety. Token expiration produces an `Expired` event and lets the sender resend without losing the audit history (the original token's events are preserved).

### Current state vs spec

What's working today:
- Schema and event audit trail (32 events captured across 7 envelopes in production)
- Provider integration for send / signed callback / status updates
- The four-table model

Open backlog (per TASKS): "E-signature workflow polish — schema exists, frontend gaps." The remaining work is largely UI:
- Per-record envelope creation flow (today: SQL-only for some record types)
- Inline status banner on the parent record
- Resend / void admin actions in the UI (today: SQL-only)
- Envelope-tabs authoring surface for typed tabs (anchor strings + absolute positioning)

The audit trail and the data model are production-ready; the surfaces around them are filling in opportunistically.
$body$,
  'Communications',
  'internal',
  true
);

with t as (select id from help_articles where ha_slug='envelopes-and-e-signature' and not ha_is_deleted)
insert into help_article_anchors (
  haa_article_id, haa_anchor_type, haa_route, haa_object, haa_field, haa_concept, haa_sort_order
)
select id, anchor_type, route, object, field, concept, sort_order
from t, (values
  ('object'::text,  null::text, 'envelopes'::text,            null::text, null::text, 1),
  ('object',        null,       'envelope_recipients',        null,       null,       2),
  ('object',        null,       'envelope_tabs',              null,       null,       3),
  ('object',        null,       'envelope_events',            null,       null,       4),
  ('concept',       null,       null,                         null,       'e-signature',                5),
  ('concept',       null,       null,                         null,       'envelope-lifecycle',         6),
  ('concept',       null,       null,                         null,       'recipient-routing',          7),
  ('concept',       null,       null,                         null,       'signature-tabs',             8),
  ('concept',       null,       null,                         null,       'esign-act-compliance',       9),
  ('concept',       null,       null,                         null,       'audit-trail',               10),
  ('concept',       null,       null,                         null,       'envelope-void-vs-decline', 11),
  ('concept',       null,       null,                         null,       'template-snapshot-binding', 12),
  ('concept',       null,       null,                         null,       'consent-capture',          13)
) as t2(anchor_type, route, object, field, concept, sort_order);
