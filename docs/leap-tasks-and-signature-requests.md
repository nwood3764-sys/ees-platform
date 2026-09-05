# LEAP — Tasks, and the signature request that lives on one

**Status:** specification, nothing built.
**Branch:** `claude/leap-tasks-form-tracking-cr7h72`
**Written:** 2026-09-05

---

## 1. Vision

Nicholas, 2026-09-05:

> *"I want to be able to have tasks. A use case is that I need an income
> acknowledgement or a building owner acknowledgement form on the side for an
> enrollment to move forward. In the process, I want to be able to create a task
> and assign it to a user, and that task should also have communications history
> and all that kind of stuff. I need to email the customer (the property owner)
> and say, 'Hey, I need this form signed. Here's the form. Sign it,' right? I
> need to send it for signature and be able to track that within the task."*

One sentence: **a task is a piece of work assigned to a named person, and
everything that happened while it was being done hangs off it** — the emails
sent, the calls logged, the form that went out for signature, and the signed
form that came back.

The acknowledgment form is the first use case, not the whole feature. Chasing a
signature is one *kind* of task. The object has to be general.

### What "done" looks like

A coordinator opens an enrollment that needs a Low-Income Building Owner
Acknowledgment. They create a task — **Get the Building Owner Acknowledgment
signed** — assign it to themselves or a colleague, and give it a due date. The
assignee opens the task and sees:

- which enrollment it belongs to, and that the enrollment cannot be submitted
  until this is done;
- a **Communications** card where they email the property owner, and where the
  owner's reply lands;
- a **Send for Signature** action that puts the form in front of the owner;
- the envelope's live status — Sent, Viewed, Signed — on the task itself;
- the signed PDF, filed on the enrollment, when it comes back.

When the owner signs, the task closes itself and the enrollment stops being
blocked. Nobody has to remember to check.

---

## 2. What exists today — three of the four legs are already built

This is the important finding, and it is why this is a moderate build rather
than a large one. **The signature pipeline works, the document requirement model
exists, and the enrollment already reacts to a signature.** What is missing is
the task in the middle that a person actually works from.

Verified against production (`flyjigrijjjtcsvpgzvk`) on 2026-09-05.

### 2a. The e-signature pipeline is real and it works

`envelopes` / `envelope_recipients` / `envelope_tabs` / `envelope_events` is a
complete DocuSign-shaped implementation: sequential signers, per-recipient
32-byte magic-link tokens with a 30-day expiry, ESIGN consent capture, IP and
user-agent on every event, PDF overlay stamping with `pdf-lib`, a generated
Certificate of Completion, and the signed PDF filed back as a `documents` row on
the parent record.

Crucially, **an envelope already attaches to any object**:

```
envelopes.env_parent_object   text NOT NULL   -- table name
envelopes.env_parent_record_id uuid NOT NULL
```

It is a polymorphic pair, already registered with the geographic-access engine
(`record_state_scope_sources`, kind `polymorphic_lookup`). Pointing an envelope
at a task needs **no schema change**.

`send-envelope` accepts either a `document_template_id` (renders from a
published template snapshot) or an `env_source_document_id` (sends the bytes of
an existing `documents` row). The second route is what makes an arbitrary PDF
signable, and it shipped 2026-07-27
(`20260727130400_envelopes_source_document_signing_route.sql`).

### 2b. The enrollment already moves on a signature

`sync_enrollment_status_from_envelope()` (trigger
`trg_zzz_enrollment_status_from_envelope`, shipped
`20260903044012`) watches `envelopes.env_status` and, when the envelope's parent
is an enrollment, moves the enrollment:

| Envelope status | Enrollment status |
|---|---|
| `Sent` | `Proposal Signature Requested` |
| `Completed` | `Enrollment To Be Submitted` |

`Delivered` and `Voided` deliberately do nothing. The update is guarded by a
`picklist_value_record_type_assignments` check, so an enrollment of a record type
whose path does not offer those statuses is left alone rather than stamped with a
status its chevron strip cannot draw.

**This is exactly the "form signed → enrollment moves forward" mechanism
Nicholas is describing.** It exists. It is scoped to one record type
(`WI-IRA-MF-HEAR-Project-Reservation`) and one document (the HEAR proposal).

### 2c. The document requirement model exists

`stage_document_requirements` (SDR-) already says *"at this stage, on this
object, this document is required, and it needs a signature from this role"*:

```
sdr_object              text     -- the table
sdr_stage_value_id      uuid     -- the status/stage it gates
sdr_document_key        text
sdr_document_template_id uuid
sdr_is_required         boolean
sdr_requires_signature  boolean
sdr_signer_role         text     -- e.g. 'Property Owner'
```

Eight live rows, **all on `opportunities`, none on `enrollments`**. Two of them
already carry `sdr_requires_signature = true` with signer role `Property Owner`.

Nothing reads this table to *enforce* anything. It is a declaration with no
consumer.

### 2d. The acknowledgment form already has a home — and it is a dead end

The form Nicholas named exists as a **`file_gallery` upload slot** on two
enrollment layouts (`WI-IRA-MF-HOMES-PR` and `WI-IRA-MF-HEAR-PR`):

```json
{ "target": "documents",
  "document_type": "li_owner_acknowledgment",
  "help_text": "Required for all Low-Income Multifamily projects." }
```

**Six have been uploaded to production.** So this workflow is running today —
entirely by hand. Somebody emails the owner from Outlook, the owner prints,
signs, scans and emails it back, and somebody drags the PDF into the slot.

The help text "Required for all Low-Income Multifamily projects" is a string on a
card. It enforces nothing, chases nobody, and blocks no status change.

And once uploaded, **the form can never be routed for signature from LEAP**:
`send-envelope`'s `source_document_id` path requires the caller to supply
`tabs[]` (there are no discoverable anchors in a scanned or third-party PDF), and
there is no UI anywhere that lets a person place a signature tab on an arbitrary
uploaded document. Every existing tab set is hardcoded in a generator
(`homesProposalService`, `hearProposalService`, `ProjectSubmittalDocumentsModal`).

### 2e. Tasks — the object exists and has never been used by a human

This is the missing leg, and it is emptier than it looks.

**Schema** (`tasks`, baseline `:5144`): `subject`, `description`, `status`,
`priority`, `due_date`, `completed_date`, `owner_id`, `created_by_id`,
`related_object` + `related_id` (polymorphic parent), `is_automated`,
`automation_rule`, `is_ai_created`, `reminder_date`, `reminder_sent`.

**Production data, all 71 rows:**

| | |
|---|---|
| `related_object` | `work_orders` — every single one |
| `status` | `Open` — every single one |
| `priority` | `High` — every single one |
| `is_automated` | true on 70 of 71 |
| Ever completed | none |

**Nobody has ever created a task, and nobody has ever finished one.** Every row
was written by a database trigger.

That is not an adoption problem. **There is no way to create a task in the LEAP
UI.** `src/data/tasksService.js` contains exactly three functions — `fetchTasks`,
`markTaskComplete`, `reopenTask`. There is no insert path, no New Task button, no
assign-to-user picker, no due-date entry, and no way to edit a task's subject,
description, priority or owner. `TasksModule` mounts `ListView` with no `onNew`
handler.

What *does* work: a Tasks module with My Tasks / All / Automated / Overdue tabs,
a Complete/Reopen button, a home-page `task_list` widget, and an in-app
notification on assignment (`trg_task_create_notification`, which correctly skips
self-assignment).

**Pain points, all verified:**

1. **A task cannot carry communications.** `conversations` has no `task_id`
   column, so `conversation_anchor_columns()` — which derives the anchor list
   from the table's own foreign keys — cannot return `tasks`. The Communications
   card is offered on twelve objects and refuses tasks by name:
   *"Conversations carry no foreign key to this object."* This is the single
   most direct blocker on Nicholas's ask.

2. **Statuses are unmanaged free text with three competing vocabularies.** The
   column default is `'Task Open'`; every writer passes `'Open'`; the client
   filter offers `Open / In Progress / Completed / Cancelled`, hardcoded in
   `TasksModule.jsx:35`. There are **zero `picklist_values` rows for `tasks`**,
   so an admin cannot manage them. Both LEAP hard rules are broken here —
   "nothing is hardcoded" and the `[Object] [State]` naming rule. A row inserted
   on the column default lands outside every filter the UI offers.

3. **A task is invisible from the record it is about.** `tasks` has foreign keys
   only to `users`, so the related-list builder — which enumerates children from
   real FKs via `describe_object_incoming_fks` — can offer a Tasks related list
   only on a **User** record. There is no Tasks card on any layout in
   production. A work order's page shows no sign of the review task its own
   trigger created.

4. **`related_object` renders as a raw table name.** The list shows
   `work_orders`, never `WO-00123 — 1400 Elm St`. `fetchTasks` selects the id and
   never resolves the parent's name.

5. **Reminders are dead columns.** `reminder_date` and `reminder_sent` are
   written by nothing and read by nothing. No cron, no edge function, no
   trigger. The only overdue signal is computed client-side for display.

6. **The page layout is a raw field dump.** PL-00137 "Standard Tasks Layout"
   shows the user `Is Automated`, `Automation Rule`, `Is Ai Created` and
   `Reminder Sent`; `Status` and `Priority` are free-text boxes; `Related Object`
   is a text box and `Related` renders as a picklist over a uuid. There are no
   cards of any kind.

7. **`tasks` has no `block_hard_delete` trigger** — confirmed in production,
   where every other entity table carries one. `DELETE FROM tasks` succeeds.
   LEAP is soft-deletes only; this is an exception nobody chose.

8. **RLS is object-level only.** `app_select_tasks USING (app_user_can('tasks',
   'read'))` — a role with read sees every task in the platform, and a role
   without it sees none, *including its own*. Geographic scoping is layered on
   correctly through the polymorphic parent, but there is no owner or team
   scoping. Already flagged as open in `docs/leap-geographic-record-access.md`.

9. **`fieldMetadataService.js:400` maps `tasks: 'task_name'`** — a column that
   does not exist. The name column is `subject`. Any lookup picker or breadcrumb
   resolving a task through `guessNameColumn` renders blank.

10. **The help anchor is orphaned.** `TasksModule` renders a `?` for concept
    `tasks-module-overview`; there is no help article behind it.

11. **No record types**, so no per-type layouts and no per-type status paths.

### 2f. Two send paths bypass the outbound-approval hard rule

Found while mapping this and **worth fixing regardless of what happens to
tasks.** CLAUDE.md: *"Never send an email without a person approving it. HARD
RULE, EVERYWHERE."*

| Path | Gated? |
|---|---|
| `hearProposalService.js` → `requireOutboundApproval` | yes |
| `homesProposalService.js` → `requireOutboundApproval` | yes |
| `SendForSignatureModal.jsx:167` — raw `fetch` to `send-envelope` | **no** |
| `ProjectSubmittalDocumentsModal.jsx:277` — raw `fetch` to `send-envelope` | **no** |

The build fixture meant to enforce this
(`scripts/outbound-send-guard-fixture.mjs:92`) scans exactly two files —
`conversationsService.js` and `serviceProviderService.js` — and only looks for
`functions.invoke('send-email-v1'|'send-notification-sms')`. A raw `fetch` to
`send-envelope` from a component matches nothing. The guard cannot see either
gap. This is the same class of defect as every hand-maintained list this
platform has fixed in the last month: **a list nothing checks is the defect.**

`send-envelope` itself emails recipient #1 through `send-email-via-graph`, whose
source is **not in this repository** (a known out-of-band deploy, logged in
`docs/leap-activity-email-layer.md`). So the signature email path is both
ungated and unreviewable from source.

---

## 3. Current-state map — files and tables

### Database

| Table | Role today | Change needed |
|---|---|---|
| `tasks` | 71 machine-written rows, no human path in | statuses, record types, `task_id` anchor, soft-delete guard |
| `conversations` | 12 FK anchors, derived registry | **add `task_id`** — the registry picks it up automatically |
| `envelopes` | polymorphic parent, 1 row ever | none — already points anywhere |
| `documents` | polymorphic parent | none |
| `stage_document_requirements` | 8 rows, all on opportunities, no consumer | rows for enrollments; a function that reads them |
| `notifications` | in-app on task assign, works | none |
| `picklist_values` | **no rows for `tasks`** | task status + priority + record type |
| `page_layouts` | PL-00137, raw field dump | rebuild |
| `automation_rules` | `create_task` action exists, **all 7 rules inactive** | possible consumer |

### Key functions

- `conversation_anchor_columns()` — derives the anchor list from
  `conversations`' own uuid FKs, excluding `users` and `picklist_values`.
  **Adding a column is the whole change**; the CASE statements, the email-log
  picker and the Outlook add-in all read from it.
- `sync_enrollment_status_from_envelope()` — envelope status → enrollment status.
- `resolve_outbound_mailbox_for_anchor()` — needs a `tasks` branch, or an email
  from a task fails with *"no mailbox could be resolved."* This is exactly the
  trap the enrollments work hit on 2026-09-03.
- `list_relatable_records()` — still an if/else per object; would need tasks.
- `record_in_state_scope()` / `record_state_scope_tasks()` — already correct.

### Client

| File | Role |
|---|---|
| `src/modules/TasksModule.jsx` | 4-tab list; hardcoded status vocabulary at `:35` |
| `src/data/tasksService.js` | fetch / complete / reopen — **no create** |
| `src/lib/conversationAnchors.js` | the 12-anchor list; one line to add tasks |
| `src/lib/layoutCards.js:134` | Communications card availability rule |
| `src/data/recordActions.js:653` | generic `send_for_signature`, gated on `hasActiveTemplate` |
| `src/components/SendForSignatureModal.jsx` | template route; **ungated** |
| `src/components/ProjectSubmittalDocumentsModal.jsx` | source-document route; **ungated** |
| `src/data/fieldMetadataService.js:400` | `tasks: 'task_name'` — wrong column |

---

## 4. Target architecture

### Design principles

1. **A task is the unit of assigned work; everything else hangs off it.** The
   envelope, the thread, the documents, the notifications. Not the reverse.
2. **The envelope stays polymorphic and unchanged.** An envelope on a task uses
   the same `env_parent_object` / `env_parent_record_id` pair that already
   serves projects and enrollments. No new coupling, no new column.
3. **A requirement is declared, not coded.** Which forms an enrollment needs, at
   which status, signed by whom, lives in `stage_document_requirements` — the
   table that already exists for this.
4. **The task carries the evidence.** CLAUDE.md already states the rule:
   *"Every task has an evidence artifact and a second-set-of-eyes verifier before
   it closes."* A signed acknowledgment form is that evidence artifact. The
   object was designed for this and never finished.
5. **Nothing sends without a person.** Every new outbound path goes through
   `requireOutboundApproval`, and the build fixture is widened so it can
   actually see them.
6. **Statuses are `[Object] [State]`, in the database, scoped per record type.**

### The shape

```
enrollment  ──<  task  ──<  conversation   (new task_id FK)
                  │
                  ├──<  envelope           (existing polymorphic parent)
                  │        └── signed PDF → documents (on the ENROLLMENT)
                  └──<  documents          (existing polymorphic parent)

stage_document_requirements  ──  declares which forms an enrollment
                                 needs at which status, and who signs
```

The signed PDF is deliberately filed on the **enrollment**, not the task: the
task is how the work got done, but the form belongs to the filing. The task
links to it.

---

## 5. Phased build plan

Each phase is additive and independently shippable.

### Phase 1 — Make a task a real record

No dependency on the signature work; fixes ten defects listed above.

- **Task statuses as picklist values**, `[Object] [State]`:
  `Task To Be Started` → `Task In Progress` → `Task To Be Verified` →
  `Task Completed`, plus `Task Cancelled` and `Task Blocked`. Migrate the 71
  live rows off `'Open'`. Priority becomes a picklist too.
- **Record types**: `Task` (general) and `Document Signature Request`, each with
  its own status assignments per LEAP's per-record-type picklist rule.
- **Create and edit from the UI**: a New Task action on the Tasks module and on
  any record's Tasks card, using the platform's existing required-fields-only
  create modal. Assign to a user, set due date, priority, description.
- **Rebuild PL-00137** so it stops showing `Is Ai Created` and starts showing
  the parent record by name.
- **A Tasks card on any object.** Because `tasks` has no business FK, this uses
  the `match={related_object:'…'}` escape hatch the renderer already supports for
  the polymorphic Documents list (`layoutService.js:1438`); the builder needs a
  path to configure it.
- Resolve `related_object`/`related_id` to a record name in the list.
- Fix `fieldMetadataService.js:400` → `subject`; add `block_hard_delete`; write
  the missing `tasks-module-overview` help article.

### Phase 2 — Communications on a task

Directly answers *"that task should also have communications history."*

- `ALTER TABLE conversations ADD COLUMN task_id uuid REFERENCES tasks(id)`.
  `conversation_anchor_columns()` picks it up with no further change, and with it
  the timeline, the Outlook add-in's Log Email picker, and the email-log target
  resolver.
- One line in `src/lib/conversationAnchors.js`.
- A `tasks` branch in `resolve_outbound_mailbox_for_anchor()` — walk task →
  parent record → state → mailbox. **Without this a send from a task fails**;
  the enrollments work hit this exact trap.
- Register the anchor in `record_state_scope_sources` so a thread anchored only
  to a task is visible to a state-scoped user.
- Place the Communications card on the task layout.

### Phase 3 — Send a form for signature from a task

- **Signature request on a task**: pick the document (a template, a generated
  PDF, or an uploaded file), pick the recipient (defaulting to the property
  owner contact resolved from the task's parent), send. Through
  `requireOutboundApproval`, naming the recipient back to the sender.
- **Tab placement for an uploaded PDF** — the thing that makes an arbitrary form
  signable. Either a simple page/coordinate picker over a PDF preview, or a
  convention where an uploaded form carries anchor text. This is the single
  largest piece of new UI in the plan and the reason the acknowledgment form is
  a dead end today.
- **Envelope status on the task**: the task shows Sent / Viewed / Signed without
  navigating to the envelope. An `envelopes` related list plus a status field.
- **Close the loop**: when the envelope completes, the task moves to
  `Task To Be Verified` (not straight to Completed — LEAP requires a second set
  of eyes), and the signed PDF is filed on the parent record.

### Phase 4 — The requirement drives the work

- Seed `stage_document_requirements` rows for enrollments, starting with the
  Low-Income Building Owner Acknowledgment and the income qualification
  statement.
- A function that reads the requirements for a record's current status and
  reports what is outstanding.
- An **Outstanding Documents** card on the enrollment: what is required, what is
  in, what is out for signature, with a one-click "create the task and chase it."
- Optionally, gate the status transition. **See decision D2.**

### Phase 5 — Reminders and the chase

- Make `reminder_date` / `reminder_sent` real: a cron that fires in-app
  notifications for tasks due or overdue.
- An **Open Signature Requests** report — everything sent and unsigned, oldest
  first. Note that signing tokens expire after 30 days and nothing currently
  surfaces an envelope stranded in `Sent`.

### Phase 0 — do this regardless

Close the outbound-approval gap in §2f: put `requireOutboundApproval` on both
raw `send-envelope` fetches, and widen
`scripts/outbound-send-guard-fixture.mjs` so it scans components as well as
services and recognises a `fetch` to `send-envelope`, not just
`functions.invoke('send-email-v1')`. This is a live hard-rule violation and is
independent of everything else here.

---

## 6. Technical recommendations and known hazards

- **Do not add a business FK to `tasks` per parent object.** The polymorphic
  `related_object`/`related_id` pair is already indexed and already registered
  with the state-scope engine. Twelve nullable FK columns would be a second
  hand-maintained list.
- **`conversations.task_id` is the exception** and must be a real FK, because
  the anchor registry is *derived from foreign keys*. That is the mechanism, not
  a workaround.
- **The mailbox resolver is the silent failure.** An anchor object with no
  branch in `resolve_outbound_mailbox_for_anchor` produces a card that renders
  and a send that dies. Add the branch in the same migration as the column.
- **A trigger promoted to `SECURITY DEFINER` must `REVOKE EXECUTE` in the same
  migration** — the settled answer to a defect that has recurred twice.
- **Migration filenames take the real UTC clock time**, and
  `ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` must come back empty.
- **The Supabase MCP tools time out client-side at 60s and the server commits
  anyway.** Check `supabase_migrations.schema_migrations` before concluding a
  timeout rolled back.
- **Verify in a browser, not by reading.** Three defects in the last month —
  the photo upload, the status path, the staggered layout rows — read correctly
  and were broken. A signature flow with a tab-placement UI needs
  `npm run verify:*` with a real Chromium and a positive control.
- **Prove behaviour in rolled-back transactions on prod** under RLS,
  impersonating a real user. `block_hard_delete()` means a migration cannot
  clean up its own probe insert, so behavioural proof belongs in a rolled-back
  transaction and the migration asserts the deployed definition instead.

---

## 7. Decisions

**D1 — Is this the Task object, or a new purpose-built Signature Request object?**
**Recommendation: the Task object, with record types.** LEAP's build discipline
forbids reusing an artifact built for another purpose — but a task's purpose *is*
"work assigned to a person," and chasing a signature is work assigned to a
person. CLAUDE.md already states that every task carries an evidence artifact and
a verifier; the signed form is that artifact. A separate object would duplicate
assignment, due dates, ownership, notifications and the communications anchor.
The specialisation belongs in a **record type** (`Document Signature Request`)
with its own status set, which is how LEAP expresses exactly this.
**Status: OPEN — recommendation stated, awaiting confirmation.**

**D2 — Does an unsatisfied document requirement BLOCK the enrollment, or just
show as outstanding?** **Recommendation: show it, do not block it — at first.**
The enrollment already moves on a signature today via the envelope trigger, which
is a *forward* motion nobody has to police. A hard gate can strand a real filing
over a checkbox, and LEAP's own field-side ruling is that documentation is never
blocked. Start with a visible Outstanding Documents card and the automatic
forward motion that already exists; add a hard gate per requirement
(`sdr_is_required` already exists) once the requirement rows are trusted.
**Status: OPEN — recommendation stated, awaiting confirmation.**

**D3 — How does a signature tab get onto an uploaded PDF?** **Recommendation: a
minimal click-to-place picker over a rendered page.** The alternative — requiring
anchor text in the source file — cannot work for a form a program administrator
publishes. This is the piece that turns the acknowledgment form from a dead
upload slot into something LEAP can actually route. **Status: OPEN.**

**D4 — Task statuses.** **Recommendation:** `Task To Be Started`,
`Task In Progress`, `Task To Be Verified`, `Task Completed`, `Task Cancelled`,
`Task Blocked`, scoped per record type. Follows the `[Object] [State]` rule and
preserves the second-set-of-eyes step. **Status: OPEN.**

**D5 — Does the signature request task close itself on signature?**
**Recommendation: it moves to `Task To Be Verified`, not `Task Completed`.** A
returned form can be the wrong form, unsigned on page 3, or signed by the wrong
person. **Status: OPEN.**

**DECIDED — the envelope stays polymorphic.** No `task_id` on `envelopes`; the
existing `env_parent_object` pair carries it. Settled by the schema as built.

**DECIDED — the signed PDF is filed on the parent record, not the task.** The
form belongs to the enrollment's filing; the task is how it was obtained.
`signing-portal-submit` already writes it to `env_parent_object`, so pointing the
envelope at the task would file the form on the task instead — which means the
envelope's parent should stay the **enrollment**, and the task links to the
envelope rather than owning it. This is a real consequence of the existing code
and should not be re-derived.

---

## 8. File and DB-table index

**Tables:** `tasks`, `conversations`, `envelopes`, `envelope_recipients`,
`envelope_tabs`, `envelope_events`, `documents`, `document_templates`,
`stage_document_requirements`, `picklist_values`,
`picklist_value_record_type_assignments`, `page_layouts`,
`page_layout_sections`, `page_layout_widgets`, `notifications`,
`record_state_scope_sources`, `enrollments`.

**Functions:** `conversation_anchor_columns`, `find_or_create_conversation`,
`list_communication_timeline`, `resolve_outbound_mailbox_for_anchor`,
`sync_enrollment_status_from_envelope`, `trg_task_create_notification`,
`generate_task_number`, `record_in_state_scope`, `void_envelope`,
`list_envelope_events_for_record`, `list_relatable_records`.

**Edge functions:** `send-envelope`, `signing-portal-load`,
`signing-portal-submit`, `resend-envelope-email`,
`render-document-template-pdf`, `send-email-v1`, and the out-of-repo
`send-email-via-graph`.

**Client:** `src/modules/TasksModule.jsx`, `src/data/tasksService.js`,
`src/lib/conversationAnchors.js`, `src/lib/layoutCards.js`,
`src/data/recordActions.js`, `src/components/SendForSignatureModal.jsx`,
`src/components/SignatureSendModal.jsx`,
`src/components/ProjectSubmittalDocumentsModal.jsx`,
`src/components/RecordDetail.jsx`, `src/data/fieldMetadataService.js`,
`src/lib/outboundSendGuard.js`, `src/pages/SigningPortal.jsx`,
`scripts/outbound-send-guard-fixture.mjs`.
