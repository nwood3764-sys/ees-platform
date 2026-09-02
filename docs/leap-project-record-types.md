# Project Record Types — mapping to the products on the opportunity

Status: **PLAN. Nothing has been changed.** Written 2026-09-02 from the live
production database and the current code, on branch
`claude/project-record-types-mapping-xjnlfc`.

---

## 1. Goal

A project's record type must describe **the work that was sold** — and the work
that was sold is the set of products (measures) on the opportunity the project
comes from. Today nothing connects the two, the names are Salesforce import
codes rather than English, and several of them carry a program or a housing
type that the opportunity already carries.

Three things, in this order:

1. **Rename** the project record types so each one names its work explicitly,
   with no abbreviations and no state or program in the name.
2. **Map** product → work measure → project record type, in the database, so a
   project created from an opportunity gets a record type the opportunity's own
   products imply.
3. **Guard** it, so a project record type the opportunity does not support
   cannot be saved.

**Out of scope, deliberately: `WI-IRA-MF-HOMES - AUDIT LEVEL 2`.** Nicholas:
leave it alone. It is not renamed, not retired, not re-mapped, and not brought
under the new guard. It is the one project record type in the platform that is
allowed to name a program.

---

## 2. Current state — measured, not assumed

### 2.1 The record types

18 active, 27 inactive. Live project counts (47 live projects, 44 opportunities):

| Record type (value / label) | Live projects | Status assignments | Layout |
|---|---|---|---|
| `MULTIFAMILY-ENERGY-ASSESSMENT` / Multifamily Energy Assessment | 23 | 0 | — |
| `SINGLE-FAMILY-ENERGY-ASSESSMENT` / Single-Family Energy Assessment | 15 | 0 | — |
| `MF-INS-AIR` / MF-INS-AIR | 3 | 0 | PL-00235 |
| `ASSESSMENT` / Assessment | 2 | 0 | PL-00232 |
| `MF-Exhaust-Fan` / MF-Exhaust Fan Replacement | 2 | **13** | PL-00234 |
| `MF-IN-UNIT-DI` / MF-In-Unit-DI | 1 | 0 | — |
| `WI-IRA-MF-HOMES-AUDIT-LEVEL-2` / WI-IRA-MF-HOMES - AUDIT LEVEL 2 | 1 | 5 | PL-00237 |
| `ASHRAE-LEVEL-1` / ASHRAE Level 1 — **platform default** | 0 | 0 | PL-00231 |
| `MF-AIR` / MF-AIR | 0 | 0 | PL-00233 |
| `MF-APP` / **MF-Eq Survey** | 0 | 0 | — |
| `MF-EQUIPMENT` / MF-Equipment | 0 | 0 | — |
| `MF-CPO` — inactive | 0 | 0 | — |
| `SINGLE-FAMILY` / Single Family | 0 | 0 | — |
| `TRUTEAM-ILLINOIS-INS` / TruTeam Illinois INS | 0 | 0 | PL-00236 |
| `TOWNHOME-ENERGY-ASSESSMENT`, `MULTIFAMILY-DIAGNOSTIC-ASSESSMENT`, `HVAC-QUOTE`, `CUSTOMER-CONSULTATION`, `FIELD-DOCUMENTATION` | 0 | 0 | — |

Four things in that table are defects on their own:

- **`MF-APP` is labelled "MF-Eq Survey".** The stored value and the label name
  two different things.
- **`ASHRAE-LEVEL-1` is `picklist_is_default_record_type`**, so
  `enforce_rt__projects` → `default_record_type_for('projects')` stamps *ASHRAE
  Level 1* on any project inserted without a record type. That is an audit
  deliverable being used as the platform fallback — the same defect class as
  FOE-2024-WI being the opportunity default, fixed 2026-08-23.
- ~~**16 of 18 active types have no `project_status` assignments**, so they fall
  through to all 36 `project_status` values, which mix three objects'
  vocabularies.~~ **Fixed 2026-09-02** — the list is now seven project statuses
  and every record type carries them. See Phase 6.
- **`MF-AIR`, `MF-EQUIPMENT`, `MF-APP`, `SINGLE-FAMILY`, `TRUTEAM-ILLINOIS-INS`
  hold zero records** and only two of them can be interpreted from their names.

### 2.2 Nothing maps products to project record types

- `record_type_eligibility` has **zero `opportunities → projects` rows**. It
  governs buildings→opportunities, opportunities→enrollments /
  incentive_applications / assessments, and projects→work_orders (for
  MF-Exhaust Fan Replacement only). Projects are the gap.
- A project's record type is set today by exactly four things: by hand on the
  create pop-up; `derive_assessment_project()` (from the **assessment** record
  type's `picklist_project_record_type` — correct, and a good precedent);
  the technician ad-hoc path, which resolves `FIELD-DOCUMENTATION` by value;
  and otherwise `enforce_rt__projects` → the platform default above.
- `products.product_project_record_type_id` and
  `product_work_order_record_type_id` exist as **legacy Salesforce import TEXT
  columns — 0 rows populated, 0 readers in code or the database.** So does
  `products.work_type_id` (uuid, 0 populated) and
  `product_create_retrofit_work_order` (boolean, 0 true). They are named for
  this job and do none of it.

### 2.3 What the mismatch actually looks like on real records

- **OPP-00074** (WI-IRA-MF-HOMES) sells Attic Air Sealing, Attic Insulation,
  aerators, showerheads and the HOMES incentive line. It carries an
  **MF-Exhaust Fan Replacement** project — there is no exhaust fan product on
  the opportunity.
- **OPP-00153** (WI-IRA-MF-HOMES, an install program) carries a **Multifamily
  Energy Assessment** project.
- **OPP-00193 / OPP-00198** sell a full attic + direct-install scope and carry
  **no projects at all**.
- **OPP-00066** is right: aerators/showerheads → an MF-In-Unit-DI project,
  attic incentive → MF-INS-AIR. So the intended mapping is already in people's
  heads; it is only in people's heads.

### 2.4 The map that already exists, and must not be duplicated

```
opportunity_line_items → products
   → product_work_measure_map        (18 live rows, 9 distinct measures)
       → derive_reservation_work_measures()  → the reservation enrollment
       → work_measure_work_completed_map     → the payment request's vocabulary
```

`product_work_measure_map` is **the one product map in LEAP**. The 2026-08-31
migration `20260831211429` deleted a second one the same session it was created
and recorded why: *"Two maps means a new product must be wired up twice and the
two answers drift."* What was added instead was a **vocabulary translation**
keyed on the measure — `work_measure_work_completed_map`. This plan follows
that shape exactly.

Current measures in the map: Air Sealing · Ceiling Insulation · Water Saving
Measures · Electrical Load Center · Electrical Wiring · ENERGY STAR Heat Pump
Water Heater · ENERGY STAR Mechanical Ventilation · ENERGY STAR Heat Pump
Clothes Dryer · ENERGY STAR Electric Cooking Product.

**Hole found while mapping: `ENERGY STAR Electric Heat Pump for Space Heating
and Cooling` (HEAR-HP-SPACE-HEAT-COOL) has no `product_work_measure_map` row
at all**, so it is missing from the reservation's "What work will be completed?"
today as well as from anything built here. Three live opportunities sell it
(OPP-00188, OPP-00196). That is a pre-existing defect this work must fix, not
work around.

### 2.5 Why project record types do not need to be state-specific — confirmed

Program and state are already carried, twice, above the project:

- `opportunities.opportunity_record_type` is the program (26 values, state-scoped
  and enforced since 2026-08-23/24), and the project inherits the opportunity.
- **`opportunity_record_type_price_books` scopes the product catalogue per
  program** — 13 price books, e.g. *Wisconsin IRA Multifamily HOMES* offers 10
  products, *Wisconsin IRA Multifamily HOMES Audit* offers 1. The products a
  user can even put on an opportunity are already program-filtered.

So a project record type named for its work is correct in every state, and the
program-specific behaviour rides the axes that already exist. This is the same
conclusion the paperwork matrix reached (keyed on opportunity record type, with
the *documents* varying, not the work).

---

## 3. Target architecture

```
opportunity line items
  → products
    → product_work_measure_map              (EXISTING — the one product map)
      → work_measure_project_record_type_map (NEW — measure → project record type)
        → project record types
          → one project per distinct record type, on the opportunity
```

Design principles, each of which is a rule this build must not break:

1. **One product map.** The new artifact keys on the **measure**, not the
   product, mirroring `work_measure_work_completed_map`. Adding a product then
   needs only its measure rows — which it already needs for the reservation.
2. **Two measures may share a project record type**, and that is the point:
   Air Sealing + Ceiling Insulation are one attic crew's job; Electrical Load
   Center + Electrical Wiring are one electrician's job.
3. **A project record type names the work.** No state, no program, no housing
   type, no abbreviation.
4. **"Creates no project" is stored explicitly**, never left as a missing row.
   A measure with no row means *nobody has decided yet* and must show up as a
   gap; a measure that deliberately creates nothing (the HOMES/FOE incentive
   lines are revenue, not scope) says so on its own row. This is the same
   lesson as the dashboard filter's explicit "— Not filtered —".
5. **Assessment projects keep their existing, different source.** They derive
   from the *assessment* record type's `picklist_project_record_type`
   (2026-08-17), which is correct and already works. Products drive
   install/retrofit projects only. Two questions, two mechanisms.
6. **One project per distinct project record type per opportunity** — which is
   already the practice on OPP-00074 and OPP-00066.
7. **Nothing is created silently.** An explicit action on the opportunity that
   states what it will create, and what it skipped and why.

---

## 4. The renames

Values as well as labels, so nothing in the platform still reads `MF-APP`.
Records store the record type's **uuid**, so no project row changes owner;
what changes is the label people read and the value code resolves.

### Install / scope-of-work types

| Current value | Current label | Proposed value | Proposed label |
|---|---|---|---|
| `MF-INS-AIR` | MF-INS-AIR | `ATTIC-INSULATION-AND-AIR-SEALING` | Attic Insulation and Air Sealing |
| `MF-Exhaust-Fan` | MF-Exhaust Fan Replacement | `EXHAUST-FAN-REPLACEMENT` | Exhaust Fan Replacement |
| `MF-IN-UNIT-DI` | MF-In-Unit-DI | `IN-UNIT-DIRECT-INSTALL` | In-Unit Direct Install |
| `MF-AIR` | MF-AIR | — | **retire** (see decision 6) |
| `MF-EQUIPMENT` | MF-Equipment | ? | **needs Nicholas** (decision 2) |
| `MF-APP` | MF-Eq Survey | ? | **needs Nicholas** (decision 2) |
| `SINGLE-FAMILY` | Single Family | — | **retire** (decision 2) |
| `TRUTEAM-ILLINOIS-INS` | TruTeam Illinois INS | — | **retire** (decision 2) |

### New types — the HEAR measures have nowhere to go today

| Proposed value | Proposed label | Measures it serves |
|---|---|---|
| `HEAT-PUMP-SPACE-HEATING-AND-COOLING-INSTALLATION` | Heat Pump Space Heating and Cooling Installation | ENERGY STAR Heat Pump for Space Heating and Cooling |
| `HEAT-PUMP-WATER-HEATER-INSTALLATION` | Heat Pump Water Heater Installation | ENERGY STAR Heat Pump Water Heater |
| `ELECTRICAL-PANEL-AND-WIRING-UPGRADE` | Electrical Panel and Wiring Upgrade | Electrical Load Center, Electrical Wiring |
| `MECHANICAL-VENTILATION-INSTALLATION` | Mechanical Ventilation Installation | ENERGY STAR Mechanical Ventilation |
| `ELECTRIC-APPLIANCE-REPLACEMENT` | Electric Appliance Replacement | ENERGY STAR Heat Pump Clothes Dryer, ENERGY STAR Electric Cooking Product |

### Left alone

`WI-IRA-MF-HOMES-AUDIT-LEVEL-2` (Nicholas's instruction), the five assessment
types (`ASSESSMENT`, `MULTIFAMILY-ENERGY-ASSESSMENT`,
`SINGLE-FAMILY-ENERGY-ASSESSMENT`, `TOWNHOME-ENERGY-ASSESSMENT`,
`MULTIFAMILY-DIAGNOSTIC-ASSESSMENT`) and `ASHRAE-LEVEL-1`, all of which are
driven by the assessment mechanism, and `FIELD-DOCUMENTATION`, `HVAC-QUOTE`,
`CUSTOMER-CONSULTATION`, which are already explicit and are created by hand or
by the technician path.

### Proposed measure → project record type seed

| Work measure | Project record type |
|---|---|
| Air Sealing | Attic Insulation and Air Sealing |
| Ceiling Insulation | Attic Insulation and Air Sealing |
| Water Saving Measures | In-Unit Direct Install |
| Electrical Load Center | Electrical Panel and Wiring Upgrade |
| Electrical Wiring | Electrical Panel and Wiring Upgrade |
| ENERGY STAR Heat Pump Water Heater | Heat Pump Water Heater Installation |
| ENERGY STAR Mechanical Ventilation | Mechanical Ventilation Installation |
| ENERGY STAR Heat Pump Clothes Dryer | Electric Appliance Replacement |
| ENERGY STAR Electric Cooking Product | Electric Appliance Replacement |
| ENERGY STAR Heat Pump for Space Heating and Cooling *(measure row must be added to `product_work_measure_map` first)* | Heat Pump Space Heating and Cooling Installation |

Products that deliberately create no project, recorded explicitly: the HOMES
modelled-savings lines and the three Focus on Energy attic incentive lines
(revenue, and their attic scope already arrives through Air Sealing / Ceiling
Insulation), the Energy Audit service line (decision 5), and the shop/tool
items that never appear on an opportunity.

---

## 5. Phased build plan

Each phase is additive and independently shippable.

**Phase 1 — Rename and retire (data only).**
Rename labels and values; fix `MF-APP`'s value/label disagreement; retire the
dead types as **inactive, never deleted**; move
`picklist_is_default_record_type` off ASHRAE Level 1 onto a neutral fallback;
rename the three code-named page layouts to match; **re-derive
`projects.project_name` for every affected live project** (see hazard 6.1);
update in the same migration the DB functions that resolve a renamed value as a
string. Migration asserts afterwards that no live project's name still carries
an old label and that no function body still names an old value.

**Phase 2 — The map.**
`work_measure_project_record_type_map` (WMPRT-) with the LEAP conventions:
record number, audit columns, soft delete, RLS via `app_user_can`, a record page
and a list view so it is admin-manageable. Add the missing
`product_work_measure_map` row for the space-heating heat pump. Then
`derive_project_record_types_for_opportunity(p_opportunity_id)` — returns each
implied project record type with the products and measures that implied it,
plus the line items it skipped and the reason (no measure row / measure creates
no project). SECURITY INVOKER, so a state-restricted user cannot read past
their scope.

**Phase 3 — The action.**
**Create Projects from Products** on the opportunity (`recordActions.js`) — a
modal that lists what it will create, what already exists, and what it skipped
and why, before it writes anything. Idempotent: a record type that already has
a live project on the same opportunity and building is skipped, not duplicated.
Each project inherits property / building / account / owner exactly as the
create pop-up does today (`resolveInheritedParents`).

**Phase 4 — The guard.**
Seed `record_type_eligibility` `opportunities → projects` edges from the map so
the New Project pop-up's record-type picker offers only what this opportunity's
products support (the existing `fetchConstrainingParentForCreate` reads that
table, so this is configuration, not new client code). Then a `trg_zz_` trigger
that refuses a project record type the opportunity's products do not imply,
naming the products it does have. **No grandfather clause** — per the
2026-08-24 ruling, a clause that lets a pre-existing mismatch stay saveable
forever is a hole. Which means Phase 5 must run first.

**Phase 5 — Repair the live data.**
A report of every live project whose record type the map does not support, and
the corrections. Known from §2.3: OPP-00074's exhaust-fan project, OPP-00153's
assessment project on an install opportunity. Corrections run with triggers
enabled so names, audit log and rollups all follow, and are re-counted
afterwards — the migration raises rather than shipping a record the Phase 4
trigger would make uneditable.

**Phase 6 — Statuses per record type. DONE for the existing types, 2026-09-02.**
The 36 `project_status` values were three objects' vocabularies in one list;
they are now **seven**: Project Planning → Project Pre-Construction Meeting To
Be Scheduled → Project To Be Scheduled → Project Scheduled → Project Underway →
Project To Be Verified → Project Completed, carried by all 18 active project
record types, with the transition graph rebuilt to match. What remains for this
workstream: **every record type created in Phase 1 must be given the same seven**
in the same migration, or it ships showing no statuses at all.

---

## 6. Hazards, each already paid for once

1. **`derive_project_name()` composes the opportunity name + the record type
   LABEL, and fires on any write (`20260817175451`).** Renaming labels
   therefore rewrites every affected project's name — which is *wanted*, but it
   must be done deliberately in the migration and verified, not discovered
   later when someone edits an unrelated field and the name changes under them.
2. **Seven database functions resolve project record type VALUES as strings** —
   `derive_assessment_project`, `create_technician_work_order_for_property`,
   `create_service_appointment`, `create_assessment_work_order`,
   `create_mf_building_assessment_work_order`, `get_program_portal_data`,
   `create_homes_intake`. They name `ASSESSMENT`, `FIELD-DOCUMENTATION`,
   `ASHRAE-LEVEL-1`, `MULTIFAMILY-ENERGY-ASSESSMENT`,
   `SINGLE-FAMILY-ENERGY-ASSESSMENT` — none of which this plan renames, but any
   change to that list must move the functions in the same migration.
   No client code references any project record type value (checked across
   `src/`, `supabase/functions/`, `scripts/`).
3. **Do not build a second product map.** See §2.4. If the measure vocabulary
   turns out to be the wrong key, fix the vocabulary, do not add a map.
4. **`block_hard_delete()`** — retiring a record type is
   `picklist_is_active = false`, and a migration cannot prove itself with a
   probe insert. Behavioural proof goes in a rolled-back transaction,
   impersonating a real user under RLS.
5. **Migration filenames stamp the real UTC clock time**, and
   `ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` must come back empty.
6. **Advisors** after any DDL; baseline is ~219 in the known categories. A new
   SECURITY DEFINER function needs its EXECUTE revoked in the same migration.
7. **`picklist_values_for_record_type` is strict where a selection exists** — a
   record type WITH `picklist_value_record_type_assignments` shows only those.
   Adding status assignments in Phase 6 to a type that has none today will
   narrow it from 36 values to whatever is selected; that is the intent, but it
   is a visible change to anyone using that type.

---

## 7. Decisions — recommendation first, one line each

1. **Rename the stored values as well as the labels.** *Recommend yes* — the
   label is what people read, the value is what the platform reasons about, and
   `MF-APP` labelled "MF-Eq Survey" is what happens when only one of them is
   maintained. No client code and none of the seven functions above reference
   the values being renamed. — **OPEN**
2. **What are `MF-EQUIPMENT`, `MF-APP`/"MF-Eq Survey", `MF-CPO`,
   `TRUTEAM-ILLINOIS-INS` and `SINGLE-FAMILY`?** All hold zero records and
   cannot be interpreted from their names. *Recommend* retiring
   `SINGLE-FAMILY` (housing type, not work — the building already says this)
   and `TRUTEAM-ILLINOIS-INS` (a subcontractor and a state in one name), and
   renaming the two MF- ones once you say what work they cover. — **OPEN**
3. **One project per distinct project record type on an opportunity.**
   *Recommend yes* — it is what OPP-00074 and OPP-00066 already do. — **OPEN**
4. **Does the map key on the work measure (recommended) or on the product
   directly?** *Recommend the measure* — it reuses the one product map, and it
   is how two measures come to share one crew's project. — **OPEN**
5. **Does the Energy Audit product create a project?** *Recommend no* — the
   assessment already creates and owns the audit's project, through a
   mechanism that works. Two sources for one project is how OPP-00153 ended up
   with an assessment project on an install opportunity. — **OPEN**
6. **Retire `MF-AIR` (air sealing alone) and let Air Sealing map to Attic
   Insulation and Air Sealing?** *Recommend yes* — MF-AIR has zero records, and
   keeping it means the map needs a combination rule ("air sealing without
   insulation → the other type") on day one. One type, one lookup. — **OPEN**

---

## 8. File and table index

**Database**
`picklist_values` (projects/record_type, and `picklist_project_record_type`) ·
`projects` · `opportunities` · `opportunity_line_items` · `products` ·
`price_books` / `price_book_entries` / `opportunity_record_type_price_books` ·
`product_work_measure_map` · `work_measure_work_completed_map` ·
`record_type_eligibility` · `picklist_value_record_type_assignments` ·
`page_layouts`

**Functions**
`derive_project_name` · `enforce_rt__projects` · `default_record_type_for` ·
`derive_assessment_project` · `derive_reservation_work_measures` ·
`ia_work_completed_from_opportunity` · `list_products_for_opportunity` ·
`picklist_values_for_record_type`

**Client**
`src/data/opportunityProductsService.js` ·
`src/components/OpportunityProductsWidget.jsx` · `src/data/recordActions.js` ·
`src/data/layoutService.js` (`fetchConstrainingParentForCreate`,
`resolveInheritedParents`) · `src/components/RecordDetail.jsx` ·
`src/modules/admin/RecordTypesPane` (`CHILD_RECORD_TYPE_SCOPES`)

**Related docs**
`docs/leap-project-lifecycle.md` · `docs/leap-work-types.md` ·
`docs/leap-programs.md` · `docs/leap-project-paperwork-port.md`
