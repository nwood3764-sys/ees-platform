# Anura — Data Standards, Validation, Retention

These standards apply to every object and every field in Anura. They are defined during the schema session, not added later.

---

## Field Standards

Every field in Anura must have:
- **Field label** — the display name shown in the UI
- **Field description** — what this field is for, when to use it, and any business rules that apply
- **Help text** — shown inline in the UI as a tooltip or helper text. Written for the end user, not a developer. External portal users especially need clear guidance
- **Example values** — where helpful, a concrete example of valid input
- **Required or optional** — explicitly defined. Required fields cannot be saved without a value
- **Data type** — text, number, date, datetime, boolean, picklist, lookup, currency, percent, phone, email, URL, textarea
- **Field-level security tier** — Tier 1, Tier 2, or Tier 3 financial visibility
- **Field history tracking** — yes or no. Key fields that must be tracked when changed

---

## Validation Rules

Every object has validation rules defined during schema design. Validation rules run before a record is saved and block saving if conditions are not met.

**Rule standards:**
- Every validation rule has a name, a description, and an explicit error message
- Error messages tell the user exactly what is wrong and how to fix it — never generic messages like "This field is required"
- Cross-field validation — rules that check relationships between fields on the same record
- Cross-object validation — rules that check related records before allowing a status change

**Example validation rules:**
- Work order cannot be submitted without at least one completed work step with evidence attached
- Project cannot move to Project Scheduled without a crew assignment and a scheduled date
- Incentive application cannot be submitted without at least one document attached
- Work order cannot be marked Verified if any work step is still in Corrections Needed status
- A record owner field cannot be cleared — must always have a named owner
- Vehicle check-out requires an odometer reading and GPS confirmation
- Job kit cannot be marked Kit Issued without a named Team Lead assigned

---

## Error Messages

All error messages follow this format:
- What failed — the specific field or condition that blocked the save
- Why it failed — the rule that was violated
- How to fix it — exactly what the user needs to do

Example: "Work Order cannot be submitted — 3 work steps are missing required photo evidence. Complete all steps before submitting."

---

## Audit Log

In addition to field history tracking on key fields, Anura maintains a system-wide audit log for destructive and sensitive actions:
- Record deletion (soft delete) — who, when, which record
- User deactivation — who deactivated, when, which user
- Permission changes — who changed, what changed, when
- Role assignments — who assigned, to whom, when
- Financial field access — when Tier 2 or Tier 3 fields are viewed by eligible users
- Bulk updates — any action that modifies more than one record at a time

Audit log is append-only, read-only, never editable. Accessible to Admin only.

---

## Testing Environment

A separate Supabase project mirrors the production Anura database for development and QA. All schema changes, new features, and automation rules are tested in the dev environment before being applied to production. No changes are ever made directly to the production database without testing first.

---

## User Onboarding

Role-specific help content is built into Anura — not a separate PDF. Each module includes:
- Contextual help text on every field
- Role-specific getting started guide accessible from the user menu
- In-app guidance for first-time use of complex workflows
- Video walkthrough links for key processes

---

## Record Lifecycle & Data Retention

**Completed records are never archived or hidden.** Completed projects, verified work orders, received payments, and closed opportunities remain as full active records in the system indefinitely. They are filtered out of default list views using saved filters on status fields. They are always searchable, always reportable, always part of the property and account history.

**No record is ever permanently deleted by end users.** Only system administrators can permanently purge records, and only from the recycle bin after a deliberate multi-step confirmation.

**Deletion workflow — three stages:**

Stage 1 — Soft delete. Any user with delete permission moves a record to the recycle bin. The record is immediately removed from all list views and related lists but the data is intact. A deletion reason is required before the record moves to the recycle bin.

Stage 2 — Recycle bin. Deleted records live in the recycle bin indefinitely until an administrator reviews them. Records in the recycle bin can be restored to their previous state by any user with restore permission or by Admin. Recycle bin is visible to Admin and to the user who deleted the record.

Stage 3 — Permanent purge. Only Admin can permanently purge a record from the recycle bin. Purge requires a second confirmation. Purged records are gone permanently. This action is logged in the audit log with timestamp, admin name, and the full record snapshot at time of purge.

**Cascade rules on deletion:**
- A parent record cannot be deleted if it has active child records. Example — a Property cannot be deleted if it has active Buildings. Admin must delete or reassign child records first.
- Deleting a parent moves all child records to the recycle bin together. Restoring the parent restores all associated children.

**List view behavior:**
- Default list views never show deleted or recycle bin records
- Recycle bin is a dedicated view in Anura Admin
- Reports exclude recycle bin records unless explicitly filtered to include them
