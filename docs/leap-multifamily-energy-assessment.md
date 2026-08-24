# LEAP — Multifamily Building Energy Assessment Work Order (build spec)

Status: **Phase 1 SHIPPED** (2026-08-06). Foundation live on prod: migrations `20260806113132` (work type WT-00074 + WPT-00020, 15 building-level sections / 99 fields, WO + opportunity record types) and `20260806113133` (`create_mf_building_assessment_work_order` RPC); help article **HA-00158**. Phases 2–4 (utility/energy back-office polish, roll-up + Asset Score/ASHRAE export) queued below. Authored 2026-08-05 on branch `claude/multifamily-assessment-wo-spec-lnyugh`.

---

## 1. Vision / goal

Give EES field auditors a **Multifamily Building Energy Assessment** work order — the direct parallel of the shipped **Single-Family Energy Assessment**, structured for a whole multifamily building. It is a **building-level audit tool**: one work order per building (`unit_id = NULL`) that captures everything the auditor observes about the building — its geometry, envelope, central/common-area systems, and the system types serving the building — plus the back-office energy data.

It must collect every data point required to:

1. **Populate the DOE Building Energy Asset Score** (Full Input Mode) — building geometry/use-type, construction assemblies, HVAC systems, service hot water, and lighting. Asset Score is inherently building/block-based, so this maps cleanly to a building-level tool. Output feeds the Asset Score tool + its HPXML/BuildingSync export.
2. **Satisfy an ASHRAE/ACCA Standard 211 Level 2 energy audit** — the detailed building envelope survey, central + common-area systems inventory, utility/energy data, and the field observations that back the Energy Efficiency Measure (EEM) list and end-use breakdown.

Both are named deliverables in the WI HOMES submittal templates ("Whole-Building Energy Audit Report (ASHRAE Level II equivalent)", "HPXML v4 / BuildingSync file from Asset Score"; ASHRAE Level II is required for 5+ unit projects). This work order is the field-capture front end that produces the raw inputs for those deliverables and the Snugg Pro model.

### 1.1 Scope boundary — this is the BUILDING-level tool

**In scope:** whole-building geometry, envelope, central plant and common-area systems, the *system type* that serves the dwelling units (e.g. "PTHP in each unit," "central hydronic boiler"), common-area lighting, building diagnostics, and building-level utility/energy + occupancy data. This is exactly the altitude Asset Score and ASHRAE L2 operate at for multifamily — you describe the systems serving the building, not a per-apartment inventory.

**Out of scope (separate workstream):** granular **unit-level data collection** — going into individual apartments to inventory each unit's equipment. That is a different tool with a different structure and is **not** part of this spec. This spec deliberately does **not** introduce unit-sampling, per-unit work orders, or per-unit assessment schema. When the unit-level tool is built, it links to the same building/property spine; the two are complementary, not merged.

---

## 2. What just shipped (context — the SF assessment we're mirroring)

The Single-Family Energy Assessment is live and is the template to copy exactly.

- **Work type:** `Single-Family Energy Assessment` (scheduled, 90 min, not technician-creatable).
- **Work plan template:** `Single-Family Energy Assessment - Standard`, `wpt_allow_any_order = true`, live id `b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5`.
- **Record type** (purpose-built, not legacy `hes_assessment`): `single_family_energy_assessment` on `work_orders`, `opportunities`, `projects`.
- **Modeled on Snugg Pro** — observable ranges/types are the primary inputs; exact R / U / SHGC values are optional label-entry.
- Built as a chain of migrations, each appending sections idempotently to the one plan (`20260722123000` foundation → `…340000` create-WO RPC → envelope/diagnostic/system follow-ons through `20260727204000`).

Live section catalog: Front Door Photo · Exterior Photos (N/E/S/W) · Exterior 360 Video · Utility Meters · Kitchen/Thermostat/Bathroom rooms · Heating System · Cooling System · Water Heating System · Building Characteristics · Attic/Ceiling · Walls · Foundation/Floor · Windows & Doors · Attic 360 Video · Diagnostic Tests (blower door, static pressures, combustion CO/draft, bath-fan CFM).

**Everything in §4 that says "already collected" is proven in production on the SF flow — the MF building tool inherits the capture mechanics, it does not reinvent them.**

---

## 3. Current-state architecture map (grounded in the code)

### 3.1 The capture engine (this is what we extend — do not rebuild)

Template layer (authored in migrations):

| Table | Prefix | Purpose | Key columns |
|---|---|---|---|
| `work_types` | `WT-` | The schedulable task | `work_type_name`, `work_type_default_work_plan_template_id` → plan, `work_type_default_work_order_record_type`, `work_type_is_technician_creatable`, `work_type_duration_minutes` |
| `work_plan_templates` | `WPT-` | Ordered set of steps | `wpt_name`, `wpt_allow_any_order` (non-linear walk), `wpt_record_type` |
| `work_plan_template_entries` | `WPTE-` | Join: step → plan | `work_plan_template_id`, `work_step_template_id`, `wpte_execution_order` |
| `work_step_templates` | `WST-` | A "section" | `wst_name`, `wst_assigned_owner_role_id`, `wst_verifier_role_id`, `wst_required_evidence_type_id` (Photo/Video/Document/Measurement/Verified-Yes-No), `wst_photos_required_count`, `wst_is_screen_flow`, `wst_category` |
| `work_step_template_fields` | `WSTF-` | Field defs in a section | `wstf_field_label`, `wstf_field_name`, `wstf_field_type`, `wstf_is_required`, `wstf_unit`, `wstf_sort_order`, `wstf_help_text`, `wstf_illustration_url`, `wstf_is_calculated`/`wstf_calc_expression`, `wstf_allow_not_present` |

**Allowed `wstf_field_type` values** (CHECK constraint, current): `number`, `text`, `select`, `user_multiselect`, `key_source`, `photo`. Video and Measurement are **step-level evidence types** (`wst_required_evidence_type_id`), not field types; measurements are captured as `number` fields with a `wstf_unit`. `select` option lists live in the `work_step_fields` picklist (`picklist_object='work_step_fields'`, `picklist_field=<wstf_field_name>`), admin-extendable.

Instance layer (created at runtime by the create-WO RPC + instantiate trigger; never authored in migrations): `work_orders` → `work_plans` → `work_steps` → `work_step_field_values`. LEAP Pad reads it all through the `work_order_detail_for_technician(uuid)` RPC; values are written by `save_work_step_field_value(...)` behind a hard "evidence gap" gate that blocks step completion until required fields/photos/video are present.

### 3.2 The hierarchy spine (why this tool lives at the building level)

`work_orders` carries the full FK spine on every row: `project_id` (NOT NULL), `opportunity_id` (NOT NULL), `property_id` (NOT NULL), `building_id` (nullable), `unit_id` (nullable). Platform rule: **a work order never spans units — building-level work runs with `unit_id = NULL`.** This MF building assessment is a building-level WO: `building_id` set, `unit_id = NULL`. Opportunities and payment requests are scoped **per building**, which matches.

### 3.3 Existing wide "record" tables (where captured data can roll up)

These SF-import tables already hold most audit data points as one-column-per-point and are the natural roll-up/report targets (they are **not** the capture UI — the work-step engine is):

- **`buildings`** (`building_*`) — richest physical store, and the primary roll-up target for this tool: year built, stories, sq ft, attic sq ft, avg ceiling height, construction/foundation/roof type, window type, ventilation, **unit mix by bedroom count + per-bedroom sq ft/BTU**, heating/cooling/DHW equipment (type/capacity/efficiency/age/manufacturer/year), blower-door result, infiltration ACH, insulation R-values, electric+gas meter numbers, annual therm usage, perimeter/area.
- **`assessments`** (`assessment_*`) — ~270-column Snugg Pro/SF port: envelope, air leakage, attic, knee wall, heating, cooling/heat-pump (COP/HSPF/SEER/EER), DHW (incl. HPWH UEF), chimney/flue, water fixtures, lighting, plus model/report links (`assessment_snug_pro_url`, `assessment_matterport_url`, baseline energy use, modeled savings). Carries `building_id` — a natural target for the building assessment result.
- **`diagnostic_tests`** (`diagnostic_*`) — wide blower-door + combustion-safety test store. No active capture UI today; live diagnostics are captured as work-step fields.
- **`properties`** (`property_*`) — property roll-up + HUD/LIHTC metadata (`property_total_units`, `property_total_buildings`, `property_bedroom_mix`, `property_assisted_units`, HUD contract fields).

### 3.4 Honest pain points / gaps

- **Asset Score geometry** (footprint L×W, # floors, orientation, window-to-wall ratio, use-type mix) is **not** collected by the SF flow — genuinely new for the building tool (§6.2, Appendix A).
- **No utility/energy-data capture** in the field flow. ASHRAE L2 requires ≥12 months of all-fuel utility data + EUI + benchmarking. That's back-office data entry — routed to a building-level, non-gated section (§5 Phase 2; **confirmed** in §7 D2).
- **EEM list + financial analysis** (energy/cost savings, implementation cost, simple payback) is **analysis output**, produced in Snugg Pro / Asset Score, not a field-capture step. The WO captures the observations that feed it; it does not compute payback. Treated as downstream (Appendix B note).

---

## 4. What's already collected vs. net-new for the building tool

Legend: ✅ inherited from SF flow (capture mechanics proven) · ➕ new building-level section.

| Data domain | Asset Score | ASHRAE L2 | Status |
|---|---|---|---|
| Exterior photos per elevation + 360 video | — | site record | ✅ + ➕ per building elevation |
| Building geometry: footprint L×W, # floors, gross floor area, orientation | ✅ required | ✅ | ➕ **new** (Building Geometry & Use) |
| Use-type mix (MF 4+ / MF <4 / mixed-use / common area) + unit count & bedroom mix | ✅ required | ✅ | ➕ **new** |
| Year built / last major retrofit | ✅ | ✅ | ✅ pattern (Building Characteristics) |
| Roof / wall / floor assemblies + insulation | ✅ | ✅ | ➕ whole-building envelope |
| Windows: frame, glass type, WWR (or count+dims), U/SHGC | ✅ | ✅ | ➕ whole-building |
| Air leakage / infiltration (blower door where a guarded test is feasible) | infiltration | ✅ | ➕ building diagnostics (optional) |
| **Heating** system serving the building (central plant boiler/furnace, or the system type in the units — e.g. PTHP/baseboard) + fuel, capacity, efficiency | ✅ | ✅ | ➕ Central & Building Systems |
| **Cooling** system serving the building (chiller/plant/DX/PTAC/VRF) + compressor, condenser, efficiency | ✅ | ✅ | ➕ |
| Distribution (AHU / zone equip, ducts, hydronic) | ✅ | ✅ | ➕ |
| **Service hot water** serving the building (central DHW or in-unit type) — type, fuel, capacity, efficiency, recirc | ✅ | ✅ | ➕ |
| **Lighting** — common-area inventory (fixture/lamp type, W/lamp, lamps/fixture, count or % area, mounting, controls) + typical in-unit lighting % | ✅ | ✅ | ➕ Common-Area Lighting |
| Utility / energy data: ≥12 mo all fuels, EUI, benchmarking (ENERGY STAR / Portfolio Manager) | — | ✅ **required** | ➕ 📋 building-level, back-office, not gated |
| Occupancy / operating schedules | asset-based (n/a) | ✅ | ➕ 📋 building-level, back-office |
| Energy end-use breakdown | — | ✅ | modeling output (downstream) |
| EEM list + savings/cost/payback + financial analysis | — | ✅ **required** | downstream (Snugg Pro / Asset Score), not field capture |

> **On "the system type serving the units":** Asset Score models HVAC/DHW per building block by *system type*, and ASHRAE L2 permits describing the systems that serve the residential space at the building level. So the building tool records the **system type + characteristics** (e.g. "each unit has a PTHP, ~9 SEER / 3.3 COP, ~10 yr old"), which is a building-level observation — **not** a walk-every-apartment inventory. That granular per-unit inventory is the separate unit-level tool (§1.1).

Full field-by-field inventory in **Appendix A (Asset Score)** and **Appendix B (ASHRAE L2)**.

---

## 5. Phased build plan (each phase additive and independently shippable)

**Phase 1 — Foundation: work type, record types, building plan, building-level WO. ✅ SHIPPED 2026-08-06.**
Adopted the pre-existing stub work type **WT-00074 "Multifamily Energy Assessment"** (found-or-created by name, never duplicated) and the existing `MULTIFAMILY` building + `MULTIFAMILY-ENERGY-ASSESSMENT` project record types; created the `MULTIFAMILY-ENERGY-ASSESSMENT` record type on `work_orders` + `opportunities` (opportunity type carries its own never-shared Open/Completed stages via pvrta). New plan **WPT-00020 "Multifamily Building Energy Assessment - Standard"** (`wpt_allow_any_order=true`) with **all 15 sections / 99 fields** — Building Photos · Building 360 Video · Building Geometry & Use · Roof/Ceiling · Walls · Foundation/Floor · Windows & Doors · Heating Systems · Cooling Systems · Distribution & Ventilation · Service Hot Water · Common-Area Lighting · Building Diagnostics (optional) · Utility & Energy Data (back-office) · Occupancy & Operating Schedules (back-office). All field names `mf_`-prefixed so the `work_step_fields` option lists are independent of the SF flow. `create_mf_building_assessment_work_order` RPC (find-or-create Account→Property→Building(MULTIFAMILY)→Opportunity→Project→WO at `unit_id=NULL`), paralleling `create_assessment_work_order` incl. the Field Data Verification Review task. The back-office Utility/Occupancy sections (originally slated for Phase 2) shipped in Phase 1 — all their fields are optional so they never gate completion (§7 D2). Help article **HA-00158**. Verified: WT-00074 → WPT-00020 wired, 15 sections instantiate via `trg_instantiate_work_plan_on_wo_insert`, advisors unchanged (no new lints).

**Phase 2 — Roll-up, export & report wiring. ⬖ PARTIALLY SHIPPED 2026-08-24 (the report).**
The **Energy Assessment Report** is live: `Actions → Generate Energy Assessment Report` on the assessment work order. It is the audit's own deliverable, not a program submittal (Project Reservation / Final Project Payment Request live on the project and are filings to a program administering body), so it got its own document kind `energy_assessment_report`, its own rendering engine (`ASSESSMENT_SECTION_RENDERERS` in `paperworkModel.js`, sharing no section type with the invoice/proposal engines), and its own template — **SDT-00006 "Multifamily Building Energy Assessment Report"**, 22 sections, editable through Edit Sections.

It reads directly off this work order: each section is driven by the work step TEMPLATE (so a skipped question prints an em dash rather than vanishing, and an N/A step prints its reason), and the photos are exactly the ones flagged **Include in final report** on the Photos card — the first consumer of `photos.include_in_final_report`, which had shipped 2026-07-20 with nothing reading it. Photos print with the section that captured them, so the report can be ordered and re-headed to mirror the Asset Score report and read side by side with it; that is a template edit, not code. Which report a work order gets is keyed by its record type in `src/lib/assessmentReport.js` (MF built; single-family and HES declared and unbuilt). Pinned by `scripts/assessment-report-fixture.mjs` (91 checks), which renders real PDFs rather than asserting on config. Help article **HA-00187**.

**Still open in this phase:** mapping captured field values onto `buildings` / `assessments` columns (roll-up), and the Asset Score **HPXML / BuildingSync export** named in the WI HOMES submittal templates. The report does not model savings, cost or payback — that stays downstream in Snugg Pro / Asset Score.

**Phase 3 — Admin surface + EUI calc + polish.**
Admin management of the `work_step_fields` picklists for all new `mf_` selects (already admin-editable in LEAP Admin), an optional `wstf_is_calculated` Site-EUI field on the Utility section, and any field tweaks from real-world use. (The Phase-1 help article HA-00158 already covers the field workflow.)

---

## 6. Technical recommendations

### 6.1 Copy the SF seed recipe verbatim
Use the exact `work_type → work_plan_templates → work_step_templates → work_step_template_fields → work_plan_template_entries` chain from `20260722123000`, with `''` record numbers (BEFORE-INSERT triggers fill them), the idempotent `EXISTS`-guarded section-append per follow-on migration, and role/evidence UUIDs pulled by lookup (Lead Technician owner, Project Site Lead verifier, Photo/Video evidence types). Screen-flow (`wst_is_screen_flow=true`) for multi-field sections; inline for single-photo/video steps.

### 6.2 Building Geometry & Use is the only genuinely new capture pattern
Asset Score needs footprint L×W (ft), # floors, gross floor area, orientation, window-to-wall ratio (continuous) **or** window count + dimensions (discrete), and a use-type selection incl. the MF 4+/<4 and mixed-use/common-area distinction, plus unit count and bedroom mix. All expressible as `number` + `select` fields; add `wstf_help_text`/`wstf_illustration_url` because auditors won't know "aspect ratio" or "WWR" cold. Full field list in Appendix A.

### 6.3 Central & Building Systems mirrors the SF Heating/Cooling/DHW sections, plus central-plant options
Reuse the SF Heating/Cooling/DHW section field sets (type/fuel/capacity/efficiency/age/duct), and extend the `select` picklists with the Asset Score central-plant options: plant-loop boiler / district hot water / chiller / district chilled water / condenser, compressor type (scroll-screw/reciprocating/centrifugal), condenser type (air/water), cooling tower / ground heat exchanger, VRF, water-loop & ground-source HP, dedicated outdoor air system. Add a "system serves" select (whole-building central vs. one-per-unit type) so the model knows the topology.

### 6.4 Known hazards
- **Migration filename stamps** — real UTC `YYYYMMDDHHMMSS`, verify prefix uniqueness (`ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` must be empty).
- **`wstf_field_type` CHECK** — only the six allowed types; video/measurement are step-level evidence, not field types.
- **After any function DROP/CREATE** — re-issue REVOKE/GRANT and `NOTIFY pgrst, 'reload schema'`; run `get_advisors(security)` after DDL (baseline ~205, only NEW lints act).
- **Vite** — any new field-mobile UI goes through `npm run build:safe`.
- **Verify column names** in `information_schema.columns` before DML; prefix conventions are inconsistent.

---

## 7. Decisions

- **D1 — Building-level tool, unit-level collection is separate.** **DECIDED 2026-08-05 (Nicholas):** this is a building-level audit tool; unit-level data collection is a different tool, out of scope here. No unit sampling, no per-unit WOs, no per-unit assessment schema.

- **D2 — Utility/energy data is back-office, not gated.** **DECIDED 2026-08-05 (Nicholas):** building-level section, fillable in-office after the visit; not a hard evidence gate.

- **D3 — Snugg Pro vs Asset Score as system of record for the model.** **DECIDED 2026-08-06:** the field WO is the single capture surface; it feeds **both** the Snugg Pro model and the Asset Score HPXML export in Phase 3 — no double entry.

- **D4 — Building diagnostics (blower door / combustion) in the building tool.** **DECIDED 2026-08-06:** an **optional Building Diagnostics section** is included (section 13) for whole-building/guarded-zone tests; granular per-unit combustion/airflow testing belongs to the separate unit-level tool.

---

## 8. File + DB-table index (what the next session touches)

New migrations (Phase order), all under `supabase/migrations/` with real UTC stamps:
- P1: `..._mf_building_energy_assessment_foundation.sql` (work type, record types, plan, sections), `..._create_mf_building_assessment_work_order.sql` (RPC).
- P2: `..._mf_building_assessment_utility_energy_data.sql`, `..._mf_building_assessment_occupancy.sql`.
- P3: `..._mf_building_assessment_rollup_and_export.sql`.

Existing files to copy/extend: `20260722123000_single_family_energy_assessment.sql` (seed recipe), `20260722340000_create_assessment_work_order.sql` (RPC cascade + review task), `20260722380000_assessment_rpc_global_address_dedup.sql` (dedup variant), `20260727024000_assessment_envelope_sections.sql` (envelope pattern), `20260722220000_assessment_snuggpro_system_fields.sql` (system field sets + picklists), `20260713144748_work_step_measurement_capture.sql` (save RPC + evidence gate).

Front end (LEAP Pad renders screen-flow steps with no code change if we only add data): `src/fieldMobile/`, `src/modules/FieldModule.jsx`. New create-WO launcher parallel to the SF "New Assessment" entry if wanted.

DB tables: capture engine (`work_types`, `work_plan_templates`, `work_plan_template_entries`, `work_step_templates`, `work_step_template_fields`, runtime `work_orders`/`work_plans`/`work_steps`/`work_step_field_values`); roll-up targets (`buildings`, `assessments`, `diagnostic_tests`, `properties`); picklists (`work_step_fields`, plus `record_type` values on `work_orders`/`opportunities`/`projects`/`buildings`).

Reference docs: `leap-work-types.md`, `leap-property-hierarchy.md`, `leap-field-mobile.md`, `leap-field-types.md`, `leap-project-paperwork-port.md` (submittal deliverables).

---

## Appendix A — DOE Building Energy Asset Score (Full Input Mode) field inventory

From the DOE Asset Score Data Collection Short Form v2/7/19 (Full Input Mode). Required fields generate the score; conditional fields apply only if the component exists. Asset Score is building/block-based — this is exactly a building-level tool's data set.

**Building info:** name; data collector; email/phone; date collected; year completed (or last major retrofit); gross floor area (ft²); location (street/city/state/postal); footprint dimensions LENGTH × WIDTH (ft); number of floors.

**Use type** (select, one+ per block; MF-relevant): Multi-family (4 stories +), Multi-family (less than 4 stories), Office, Retail, Lodging, Parking Garage (Ventilation only), Community Center, Assisted Living, Senior Center, etc. — supports mixed-use via multiple blocks (Long Form).

**Construction properties (envelope):**
- Roof type: Built-up w/ Concrete Deck · Built-up w/ Metal Deck · Built-up w/ Wood Deck · Metal Surfacing · Shingles/Shakes.
- Floor type: Concrete Slab · Slab on Grade · Steel Joist · Wood Frame.
- Wall type: Brick/stone on Masonry · on Steel Frame · on Wood Frame · Metal Panel/Curtain Wall · Siding on Steel Frame · Siding on Wood Frame.
- Window framing: Metal · Metal w/ Thermal Breaks · Wood/Vinyl/Fiberglass.
- Window glass: Single-pane · Double-pane · Double-pane w/ Low-E · Triple-pane · Triple-pane w/ Low-E.
- Window-to-Wall Ratio (continuous layout) **or** # of windows + dimensions W×H ft (discrete layout).

**Lighting (per fixture row):** lighting type (CFL, Fluorescent T5/HO T5, T8/Super T8, T12/HO T12, High-Pressure Sodium, Incandescent/Halogen, LED, Mercury Vapor, Metal Halide); mounting type (Recessed/Surface/Pendant); watts per lamp; lamps per fixture; # of fixtures **or** % area served.

**Heating/Cooling:**
- Distribution equipment type: Air Handler Unit (AHU) · Zone Equipment.
- HVAC system type (select one): PTAC · Four-Pipe Fan Coil · PTHP · Packaged Rooftop AC · Packaged Rooftop HP · Packaged Rooftop VAV w/ HW Reheat · w/ Electric Reheat · VAV w/ HW Reheat · VAV w/ Electric Reheat · Warm Air Furnace · Ventilation Only · Water-Loop HP · Ground Source HP · Dedicated Outdoor Air System · Window AC · Baseboard · VRF.
- Cooling source: No cooling · DX Coil · Plant Loop Chiller · Plant Loop District Chilled Water · Plant Loop Condenser. Compressor type (if chiller): Scroll/Screw · Reciprocating · Centrifugal. Condenser type: Air · Water. Condenser plant type: Cooling Tower · Ground Heat Exchanger.
- Heating source: No heating · Central Furnace · Heat Pump (electric) · Plant Loop Boiler · Plant Loop District Hot Water. Heating fuel (if boiler/furnace): Natural Gas · Electricity · Fuel Oil · Propane. District heat type: Hot Water · Steam. Draft type (if boiler): Mechanical · Other Draft. Sink/Source (if heat pump): Air · Water · Ground.
- **Service Hot Water** (Long Form / required if present): system type, fuel, capacity, efficiency.

## Appendix B — ASHRAE/ACCA Standard 211 Level 2 field data (Normative Annex reporting)

Level 2 = everything in Level 1 plus the detailed survey below, at the building level. Analysis outputs (EEM tables, financials, end-use model) are produced downstream, not in the field WO; the WO captures the observations that back them.

- **Facility description:** name/address; primary + secondary use types; gross conditioned floor area; year built + major-retrofit history; number of floors; **unit mix** (count by type); occupancy; operating schedules/hours.
- **Utility & energy data (required):** ≥12 consecutive months for **each** fuel (electric kWh + peak demand kW; natural gas; other fuels); meter numbers; utility rates; site & source EUI; benchmarking (ENERGY STAR / Portfolio Manager score); weather normalization inputs.
- **Envelope:** wall / roof / floor / foundation assemblies + insulation R-values + condition; windows (frame, glazing, U-factor, SHGC, WWR) + condition; air leakage/infiltration observations; doors.
- **Lighting:** inventory by space (common area): fixture type, lamp type, wattage, quantity, controls, operating hours; lighting power density.
- **HVAC:** equipment inventory for the systems serving the building — heating/cooling/ventilation type, capacity, efficiency (AFUE/HSPF/SEER/EER/COP), age, condition, fuel, controls/setpoints, schedules; distribution (ducts location/insulation/leakage, hydronic, AHU/zone); central plant (boiler, chiller, cooling tower, pumps).
- **Service hot water:** type, fuel, capacity, efficiency, temperature setpoint, distribution/recirculation, condition.
- **Other loads:** plug loads, elevators, common laundry, common kitchen, pools/spas, motors, common-area ventilation.
- **Health & safety / combustion (building-level, optional §7 D4):** combustion appliance zone observations — undiluted & ambient CO, draft/spillage, gas-leak; mold/moisture; roof & drainage condition.
- **EEMs & financials (downstream deliverable, not field capture):** low/no-cost and capital measures, each with estimated energy savings, cost savings, implementation cost, and simple payback; interactions; recommended package.
