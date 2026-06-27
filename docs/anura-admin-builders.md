# Anura — Admin Builders

Anura Admin is the configuration and management module. Built early — before other modules — because all modules depend on the permission and configuration infrastructure it provides.

Anura Admin is built around a set of **Builders** — purpose-built configuration tools that let authorized users define and modify how Anura behaves without touching code. Builders are the Anura equivalent of Salesforce's Process Builder, Flow Builder, Record Type setup, Page Layout editor, and Validation Rules — purpose-built for this business.

---

## Program Builder

Programs are the unit of configuration for all incentive work. Every program has its own lifecycle, document requirements, templates, notification rules, and payment process. Programs are attached to projects — a project can have multiple programs running simultaneously, each with its own independent lifecycle and status.

Program Builder manages:
- Program record creation and configuration
- Lifecycle stages per program — named stages, owner role per stage, evidence requirements per stage, trigger for next stage
- Document requirements per stage — which forms, uploads, and templates are required
- Notification rules — who gets notified at each stage transition
- Template assignments — which email and document templates apply at each stage
- Payment request configuration — how payment requests are structured for this program
- Annual versioning — programs change year to year. Applications stay on the version they were created under. New applications use the current version
- Program status lifecycle — active, inactive, sunset

**Program naming convention:** Largest to smallest. Exact program names are entered by the user when building programs — not predefined in the system.

**Key rule:** A project can have multiple programs attached simultaneously. Each program runs its own independent lifecycle in parallel. Never assume one program per project.

---

## Work Plan Builder

Work types, work plans, and work steps are defined and modified continuously. Never static. The Work Plan Builder is one of the most frequently used tools in Anura Admin.

Work Plan Builder manages:

**Work Type** — the specific task being performed. Each work type has:
- Name and description
- Record type
- Bill of materials — materials (consumables) with quantities
- Equipment list — non-consumables required
- Estimated total duration
- Assigned owner role
- Work plan attached

**Work Plan** — the step-by-step instructions for completing a work type. Each work plan has:
- Name
- Estimated total duration — sum of all step durations
- Ordered list of work steps
- Version history — modifications tracked, completed work orders stay on the version used at time of execution

**Work Step** — individual task within a work plan. Each work step has:
- Step number and description
- Guidance notes and reference links
- Estimated duration
- Assigned owner — named individual or role
- Required evidence type: photo, document upload, measurement, verified yes/no
- Verifier — second named person who confirms step completion
- Photo requirements — number of photos, before/after designation

Work Plan Builder applies to all work types regardless of where or by whom they are executed. Assignment and location are determined by the work order, not the work type. Shop kitting tasks and field installation tasks use the same builder and the same structure.

---

## Lifecycle Builder

Defines status chains per record type per object. Every object in Anura has one or more status lifecycles depending on its record types.

Lifecycle Builder manages:
- Status names — explicit, unambiguous, action-oriented per naming convention
- Status order — defined sequence
- Transition rules — what triggers advancement to the next status
- Owner rules — does ownership transfer on status change, and to whom
- Automation triggers — what fires when this status is reached
- External dependency flags — statuses that pause pending an external actor, with follow-up task and reminder configuration
- Validation rules — what must be true before a status can advance

---

## Template Builder

Manages all communications and document generation across Anura.

Template Builder manages:
- Email templates — organized by program, state, project type, record type
- Document templates — merge fields pull from any related object, rendered as PDF
- Application templates — program-specific forms
- E-signature workflows — document generation, signature routing, signed copy storage
- Trigger assignments — which templates fire automatically on which status changes
- Manual send availability — which templates can be sent manually from which record types
- Merge field library — all available merge fields across all objects

---

## Permission Builder

Manages all user access and field visibility across Anura.

Permission Builder manages:
- Roles — create, clone, rename, deactivate
- Profiles — page layouts per record type per role
- Field-level permissions — per object, per role, per field — visible or not visible
- Module access — which roles can access which modules
- Financial tier assignments — which fields belong to Tier 1, 2, or 3
- Permission sets — additive permissions on top of a base role

---

## Automation Builder

Equivalent of Salesforce Flow Builder. Defines what happens automatically when records change.

Automation Builder manages:
- Status change triggers — when object X reaches status Y, do Z
- Record creation triggers — when a new record is created, automatically create related records
- Date-based triggers — when a date arrives, fire a task or notification
- Task creation — automatically create and assign tasks on trigger
- Notification rules — who gets notified, by what method, at what trigger
- Work order auto-generation — when opportunity line items are selected, automatically generate appropriate work orders and shop kitting work orders
- Crew phone issuance rules — based on work type, determine which team members receive crew phones

---

## Additional Anura Admin Functions

- User management — create users, assign roles, deactivate
- Picklist values — all dropdown values across all objects, managed centrally
- Record types — create and manage per object
- Lookup tables — categories, classifications, program lists
- Audit log — who changed what and when, read-only, append-only
