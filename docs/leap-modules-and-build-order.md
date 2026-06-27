# LEAP — Module List & Build Order

## Module List

All modules share one LEAP database. Each module is a separate frontend application with role-appropriate access.

- **LEAP Ops** — CRM, accounts, contacts, opportunities, pipeline, reporting
- **LEAP Field** — work orders, work plans, project planning, project implementation
- **LEAP Rebate** — incentive applications, project reservations, payment requests, incentive tracking
- **LEAP Stock** — materials inventory, equipment inventory, job kits, issuance, receiving
- **LEAP Fleet** — vehicles, vehicle activities, vehicle inspections, equipment assigned to vehicles
- **LEAP People** — technician records, skills, certifications, availability, time tracking
- **LEAP Portal** — customer-facing, property owner-facing, contractor-facing read-only views
- **LEAP Admin** — configuration, permissions, templates, work plan builder

---

## Build Order

1. LEAP Admin — roles, permissions, field visibility, picklists, record types
2. Core schema — all tables, relationships, field definitions (schema session first)
3. LEAP Ops — accounts, contacts, properties, opportunities
4. LEAP Rebate — incentive applications, project reservations, payment requests
5. LEAP Field — projects, work orders, work plans, scheduling
6. LEAP Stock — materials, equipment, job kits, inventory
7. LEAP Fleet — vehicles, activities, inspections
8. LEAP People — technicians, certifications, time tracking
9. LEAP Portal — customer, property owner, contractor views
