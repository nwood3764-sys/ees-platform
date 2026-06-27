# LEAP — Roles, Field Operations & Asset Accountability

## Roles and Permissions Architecture

Roles, permissions, and field-level visibility are stored in the database and managed through LEAP Admin. Never hardcoded.

**Core tables:**
- roles — id, name, description
- permissions — id, module, object, action, field_group
- role_permissions — role_id, permission_id (many-to-many)
- field_permissions — object, role, field, visible (true/false)

**Known roles (seed data — not exhaustive, always extensible):**
- Admin
- Program Manager
- Project Manager
- Project Coordinator
- Director of Field Services
- Project Site Lead
- Team Lead
- Lead Technician
- Technician in Training
- Shop Steward
- Property Owner
- Property Manager
- Subcontractor / Partner

**Field-level permissions** follow Salesforce field-level security conventions. A role can see a record without seeing all fields on that record. Example: Project Manager sees an Opportunity but not the Amount field. Managed in LEAP Admin — change a permission once, it applies immediately to all users in that role.

---

## Field Operations Structure

**Office Side — Project Planning:**
Scheduling, work order creation, work plan assignment, materials ordering, resource assignment, crew phone issuance planning. Owned by Project Manager and Project Coordinator. Happens days and weeks ahead of execution.

**Field Side — Project Implementation:**
Executing the work. Team Lead runs the crew, completes work orders, captures photos, installs materials. Director of Field Services manages day-of execution, real-time adjustments, sick calls, team swaps, direct communication with Team Leads.

**Field Hierarchy:**
- Director of Field Services
  - Project Site Lead (manages up to 3 teams)
    - Team Lead (leads a team, responsible driver, issues crew phone)
      - Lead Technician
      - Technician in Training

**Standard team:** 3 people — Team Lead, Lead Technician, Technician in Training. Travel in one box truck. Typically 1 box truck per team.

---

## Asset Accountability Rule

Every asset — vehicle, equipment, tool, crew phone, job kit, material — is assigned to exactly one named individual at all times. Never assigned to a team, a pool, or left unassigned.

- Asset in shop → assigned to Shop Steward
- Asset issued to field → assigned to Team Lead or designated technician
- Asset returned → reassigned to Shop Steward on return
