# LEAP — PROJECT INSTRUCTIONS

## What Is LEAP

LEAP is the internal name for our custom-built business operations platform. It replaces Salesforce Service Cloud, Salesforce Field Service Lightning, and Jobber. It is our company CRM, ERP, project management system, field service platform, inventory system, and customer portal — all in one relational database.

The company operating LEAP is **Energy Efficiency Services of Wisconsin (EES / EES-WI)**. We are a BPI-certified home performance and HVAC contracting business headquartered in Madison, WI (3218 Progress Rd, 53716). We operate across five states: Wisconsin, North Carolina, Colorado, Michigan, and Indiana.

LEAP is the platform. Energy Efficiency Services (EES / EES-WI) is the business that runs on it.

---

## Core Philosophy

**LEAP is an enterprise-grade system.** Every design decision defaults to enterprise standards — data integrity, audit trails, recycle bin, validation rules, field history, role-based security, cascading rules, and referential integrity are non-negotiable. No shortcuts, no basic implementations. If a feature exists in enterprise software like Salesforce, ServiceNow, or SAP, implement it to that standard.

If a concept exists in Salesforce, use the same terminology, the same structure, and the same mental model unless there is a clearly better approach. When in doubt, ask — do not assume.

Salesforce equivalents in LEAP:
- Object = Table
- Record Type = Record Type
- Page Layout = Page Layout
- Profile = Profile
- Permission Set = Permission Set
- Picklist = Picklist
- Master-Detail = Parent-Child (required foreign key)
- Lookup = Lookup (optional foreign key)
- Junction Object = Junction Table
- Field History Tracking = Field History Tracking
- Activity Timeline = Activity Timeline
- Validation Rule = Validation Rule
- Workflow / Flow = Automation / Trigger
- Opportunity Line Items = Opportunity Line Items
- Reports & Dashboards = Reports & Dashboards

**Every status name must be explicit and unambiguous.** No generic terms like "active," "pending," or "in progress" shared across objects. Every status tells you exactly what state the record is in and implies the next action. Format: [Object] [State]. Examples: Project To Be Scheduled, Work Order To Be Verified, Incentive Application To Be Prepared.

**Every record has a named owner assigned at creation.** Owner is a required field on every major object. Nothing is ever assigned to a team, a pool, or left unassigned. If it exists in the system, one named person is responsible for it.

**Every task has an evidence artifact.** No self-certification. Every work step requires a defined completion artifact — a photo, a document upload, a measurement, or a verified yes/no. Every artifact has a second set of eyes — a verifier — before the step closes.

**Every status implies a next action.** The record is never static. Completion of one status automatically triggers the next. The only pauses are named external dependencies — waiting on a program administrator, a utility, a customer signature, or a calendar date — each with a follow-up task and reminder attached.

**Nothing is hardcoded.** Work types, work plans, work steps, status lifecycles, picklist values, record types, field permissions, role permissions, template assignments — all stored in the database and manageable through LEAP Admin without touching code. New objects, new tables, new modules are always additive and never break existing functionality.

**Naming conventions are always explicit.** No abbreviations, no shortcuts, no ambiguous terms. When in doubt use the full descriptive name.

---

## Technology Stack

**Database:** Supabase (PostgreSQL)
- One Supabase project named: leap (project ref flyjigrijjjtcsvpgzvk)
- Row-level security on all tables
- Foreign keys enforced on all relationships
- Timestamps on all records: created_at, updated_at
- Soft deletes only — no hard deletes
- Field history tracking on key fields across all major objects
- Three RLS role categories: internal_staff, external_partner, customer

**Frontend:** Single-file HTML deployed to Netlify, or React with Tailwind + shadcn/ui for complex multi-view applications

**Hosting:** Netlify
- Subdomain convention: [module].ees-wi.org
- Examples: ops.ees-wi.org, field.ees-wi.org, portal.ees-wi.org

**SMS:** Twilio — SMS magic link authentication for customer portal, appointment reminders, work order notifications

**E-Signature:** Built into LEAP — document templates with merge fields rendered as PDF, sent for signature, stored against the record, logged as a completed activity

**Authentication:** Supabase Auth — phone/SMS magic link for external users, email for internal staff

---

## Design System

All LEAP modules use a consistent design system. Never deviate from these standards without explicit instruction.

**Color Palette:**
- Sidebar background: #07111f (deep navy)
- Page background: #f0f3f8
- Card background: #ffffff
- Card secondary: #f7f9fc
- Border: #e4e9f2
- Border dark: #d0d8e8
- Emerald accent: #3ecf8e (primary action color)
- Emerald mid: #2aab72
- Sky blue secondary: #7eb3e8
- Amber warning: #e8a949
- Text primary: #0d1a2e
- Text secondary: #4a5e7a
- Text muted: #8fa0b8
- Nav text inactive: rgba(255,255,255,0.62)
- Nav text active: rgba(255,255,255,0.96)

**Typography:**
- UI font: Inter
- Monospace (codes, numbers, IDs): JetBrains Mono

**Icons:** SVG only. No emoji in any UI chrome.

**Layout:** Fixed sidebar (240px), sticky topbar (54px), scrollable content area. Always fully mobile responsive. Mobile sidebar slides in via hamburger menu with backdrop overlay.

**Responsive breakpoints:**
- Desktop: sidebar fixed, full layout
- Tablet (≤900px): content grid stacks to single column
- Mobile (≤768px): sidebar hidden, hamburger menu
- Small mobile (≤520px): secondary nav elements hidden, simplified layout

**Components:** Cards with 1px border and subtle shadow, 8px border radius. Status badges with colored backgrounds. Progress bars with gradient fills. Timeline with dot and line pattern. All animations subtle — 200-250ms ease, translateY(5px) fade-up on load.

**Sidebar nav active state:** 3px left border in emerald, slightly lighter background, full white text.

**Topbar:** White background, 1px bottom border, page title left, actions right.

---

## Financial Visibility Tiers

Financial data is controlled at the database view level, not just the UI. Three tiers:

**Tier 1 — All authenticated internal staff**
Record existence, status, assignments, dates, property information, work order details.

**Tier 2 — Project Managers and above**
Contract values, rebate amounts, program incentive amounts, invoice totals, opportunity line item amounts.

**Tier 3 — Admin only**
Gross margin, labor cost, overhead, net revenue, company P&L, all financial aggregates.

Field-level permissions are stored in a field_permissions table in LEAP Admin and applied dynamically — not hardcoded in application logic.

---

## General Rules for All Build Sessions

- Always ask which module and which specific object or feature we are building before starting
- Always follow the design system exactly — colors, fonts, spacing, icons
- Always build mobile responsive — desktop and mobile in every build
- Always use explicit status names following the naming convention
- Always include owner as a required field on every major object
- Always include created_by, created_at, updated_by, updated_at on every table
- Always use soft deletes — never hard delete records
- Always log sent communications as activities against the related record
- Never hardcode roles, permissions, picklist values, or status lifecycles
- Never use emoji in UI chrome — SVG icons only
- Never use generic status names — always explicit and action-oriented
- When adding a new object, always ask about: record types, status lifecycle, owner field, field history tracking fields, related objects, financial tier designations, and template triggers
- Default to Salesforce conventions — ask before deviating

---

## Detailed Reference Material

Detailed specs for everything else are maintained as separate files in this project's knowledge base. When we start working on a specific area, reference the relevant file by name or module. I'll pull it automatically when the topic comes up.

| Topic | Knowledge file |
|---|---|
| Property hierarchy | leap-property-hierarchy.md |
| Roles, field operations, asset accountability | leap-roles-and-field-structure.md |
| Program portfolio (all five states) | leap-programs.md |
| 12-stage project lifecycle | leap-project-lifecycle.md |
| Status lifecycles per object | leap-status-lifecycles.md |
| Work types, work plans, materials & equipment | leap-work-types.md |
| Vehicles and fleet | leap-fleet.md |
| Communications and templates | leap-communications.md |
| LEAP Admin Builders | leap-admin-builders.md |
| Portals (property owner and partner) | leap-portals.md |
| LEAP Field Mobile | leap-field-mobile.md |
| Reports and dashboards | leap-reports.md |
| Data standards, validation, retention | leap-data-standards.md |
| LEAP AI assistant | leap-ai-spec.md |
| Module list and build order | leap-modules-and-build-order.md |
| Schema session instructions | leap-schema-session.md |

If you're working on something and you think I'm missing context from one of these files, name the file or the topic and I'll pull it in.
