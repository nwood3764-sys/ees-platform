# Anura — Work Types, Work Plans, Work Steps, Materials & Equipment

## Work Types, Work Plans & Work Steps

**Work Type** — defines a specific task. Has a bill of materials (materials and equipment), an estimated duration, a work plan, and a record type. Work types are created and modified continuously through the Work Plan Builder — never static.

**Work Plan** — the step-by-step instructions for completing a work type. Assigned to a work order. Has an estimated total duration built from the sum of its work steps.

**Work Step** — individual task within a work plan. Each step has:
- Description and guidance
- Estimated duration
- Assigned owner
- Required evidence type: photo, document upload, measurement, verified yes/no
- Verifier — a second named person who confirms completion

**Work Order** — the executable unit of field work. Has:
- Record type
- Assigned team and Team Lead
- Work plan attached
- Start time / end time (actual)
- Mileage and GPS at start and end
- Status lifecycle
- All evidence captured against steps

Work types include both field execution types and shop kitting types. The work plan defines the steps regardless of whether execution happens on site or in the shop. Assignment and location are determined by the work order, not the work type.

**Duration tracking:**
- Every work plan has an estimated duration
- Work orders capture actual start and end time
- Travel to site and morning shop load-up are work orders — all team movements tracked
- Individual technician clock-in and clock-out tracked per work order

---

## Materials & Equipment

**Materials** — consumables. Used up on the job. Tracked by quantity per work type, multiplied by unit count to generate project totals. Kitted by shop, issued to Team Lead, installed on work order, or returned to shop if unused.

**Equipment** — non-consumables. Tools, gear, machines. Assigned to named individuals. Tracked out from shop and back. Condition checked on return.

**Bill of Materials (BOM)** — complete materials and equipment list for a work type. Auto-calculated against unit count to generate job totals.

**Equipment hierarchy within a vehicle:**
```
Vehicle
  └── Storage location (toolbox, shelf, rack, standalone)
        └── Equipment item
              └── Assigned to (named individual)
```

**Inventory movements:**
- Receiving — new materials arriving from supplier, or returns from field
- Issuance — materials and equipment leaving shop in a job kit
- Consumed — confirmed installed, tied to specific work order and unit
- Returned — uninstalled items back to shop inventory
