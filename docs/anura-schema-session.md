# Anura — Schema Session Instructions & Seed Data

## Schema Session Instructions

The first build session inside this project is the schema session. In that session we will:

1. Define all core tables with field names, data types, and relationships
2. Follow Salesforce object conventions — every table has: id, record_type, owner (required), created_by, created_at, updated_by, updated_at, is_deleted
3. Define parent-child and lookup relationships for every object
4. Identify which fields get field history tracking
5. Define all picklist values per object
6. Define record types per object
7. Map the property hierarchy tables first — they are the foundation everything else builds on
8. Define financial tier designation per field (Tier 1, 2, or 3)

Do not build any frontend module before the schema session is complete.

---

## Seed Data Plan

The following must be populated before Anura is usable on launch day:
- All picklist values across all objects
- All record types per object
- All roles and profiles
- All field permissions per role
- All work types, work plans, and work steps
- All program configurations in the Program Builder
- All email and document templates
- All automation rules and triggers
- Initial user accounts with assigned roles
- Imported property hierarchy from Salesforce export — Property Owners, Property Management Companies, Properties, Buildings, Units
- Imported Accounts and Contacts from Salesforce export
- Imported open Opportunities from Salesforce export

Migration order: Property hierarchy first → Accounts and Contacts → Opportunities → Projects → Work Orders. Never import child records before parent records exist.
