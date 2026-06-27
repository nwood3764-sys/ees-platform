# Anura — Module List & Build Order

## Module List

All modules share one Anura database. Each module is a separate frontend application with role-appropriate access.

- **Anura Ops** — CRM, accounts, contacts, opportunities, pipeline, reporting
- **Anura Field** — work orders, work plans, project planning, project implementation
- **Anura Rebate** — incentive applications, project reservations, payment requests, incentive tracking
- **Anura Stock** — materials inventory, equipment inventory, job kits, issuance, receiving
- **Anura Fleet** — vehicles, vehicle activities, vehicle inspections, equipment assigned to vehicles
- **Anura People** — technician records, skills, certifications, availability, time tracking
- **Anura Portal** — customer-facing, property owner-facing, contractor-facing read-only views
- **Anura Admin** — configuration, permissions, templates, work plan builder

---

## Build Order

1. Anura Admin — roles, permissions, field visibility, picklists, record types
2. Core schema — all tables, relationships, field definitions (schema session first)
3. Anura Ops — accounts, contacts, properties, opportunities
4. Anura Rebate — incentive applications, project reservations, payment requests
5. Anura Field — projects, work orders, work plans, scheduling
6. Anura Stock — materials, equipment, job kits, inventory
7. Anura Fleet — vehicles, activities, inspections
8. Anura People — technicians, certifications, time tracking
9. Anura Portal — customer, property owner, contractor views
