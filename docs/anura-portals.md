# Anura — Portals

Portals are active working environments for external users — not read-only windows. Each portal is a separate deployed web application on its own subdomain, connected to the Anura database with role-appropriate row-level security. External users never see data belonging to other organizations or properties.

Portal users have their own role and permission architecture configured in Anura Admin — same structure as internal users, scoped to their organization and their external access level.

---

## Property Owner Portal

**Viewing:**
- Full property hierarchy — all buildings, units, project phases
- Program and incentive application statuses
- Work order status per building and unit
- Photos and documentation per project phase
- Project milestone progress
- Payment request and incentive receipt status

**Actions:**
- Upload documents — enrollment agreements, income qualification statements, HUD/HAF agreements, rent rolls, any program-requested documents
- E-sign required documents — project reservation request, project completion acknowledgment, enrollment agreements, HUD/HAF agreements, income qualification statements, any program-specific required signatures
- Record-level comments and notes — tied to a specific work order, unit, photo, or document. Visible to the property owner and their assigned Project Coordinator. Permanent part of the record history. Not a general inbox — specific to the record it is attached to
- Open a ticket or data request — flag a question or issue on a specific record
- Direct messaging — with their assigned Project Coordinator. Either built into the portal or routed to an integrated tool. Every message logged as an activity on the related record

**Portal user roles (configurable in Anura Admin):**
- Property Owner — full portfolio visibility for their properties
- Property Manager — may cover multiple properties across a portfolio
- Regional Decision Maker — visibility across a regional portfolio

---

## Service Provider / Partner Portal

**Viewing:**
- Assigned work orders only — never another organization's records
- Work plans and work steps for their assignments
- Schedule and upcoming assignments
- Photo and documentation requirements per work step
- Payment history — completed tasks, amounts, status per task
- Invoices — submitted and received

**Actions:**
- Formally accept work orders — required before work begins. Acceptance logged and timestamped
- Flag a work order before starting — report a site issue, missing materials, access problem
- Complete work steps — check off steps, upload photos, upload documentation per step requirements
- Submit work orders for verification — formal submission triggering internal verification workflow
- Receive correction notifications — kicked back work orders with specific feedback attached
- Resubmit after corrections — re-enters verification queue
- Submit invoices — per completed verified work order or task
- Record-level comments — on specific work orders or work steps, visible to assigned internal coordinator
- E-sign subcontractor agreements and any required program documents

**Partner organization user roles (configurable in Anura Admin per partner organization):**
- Partner Admin — full visibility including financials. Work orders, scheduling, payment history, invoice amounts, completed task values. Business owner equivalent
- Partner Coordinator — work order and scheduling visibility. No financial fields. Manages field crew assignments and scheduling
- Partner Technician — field user. Sees only their own assigned work orders for the day. Executes work steps, uploads photos, submits completion

**Partner permission rules:**
- Roles and field-level permissions configured in Anura Admin per partner organization
- Financial tier visibility applies to partner roles same as internal roles
- One partner organization never sees another organization's records — enforced at database level
- Partner users can have permission sets applied on top of their base role for specific program or project access

---

## Portal Communication Model

Every portal has two communication layers:

**Record-level comments** — attached to a specific work order, unit, building, photo, or document. Both the external user and the assigned internal owner can comment. Permanent append-only history on the record. Triggers notification to the internal owner on new comment.

**Direct messaging** — with the assigned internal contact. Project Coordinator for property owners. Project Coordinator or Director of Field Services for partners. Every message logged as an activity on the related record.

---

## Portal E-Signature Workflows

All signatures are generated from templates with merge fields, rendered as PDF, sent via portal for signature, stored against the record automatically, logged as a completed activity, and trigger the next status automatically upon completion.

**Property Owner signature events:**
- Enrollment agreement
- HUD / HAF agreement
- Income qualification statement
- Project reservation request
- Project completion acknowledgment
- Any program-specific required documents

**Service Provider signature events:**
- Subcontractor agreement
- Work order acceptance
- Work order completion submission
- Invoice acknowledgment
