# LEAP — Multifamily Energy Assessment Work Order (build spec)

Status: **SPEC — not yet built.** Authored 2026-08-05 on branch `claude/multifamily-assessment-wo-spec-lnyugh`.
Owner to confirm the open decisions in §7 before Phase 1.

---

## 1. Vision / goal

Give EES field auditors a **Multifamily Energy Assessment** work order that is the direct parallel of the shipped **Single-Family Energy Assessment** — same capture engine, same LEAP Pad experience, same evidence discipline — but structured for a building with many dwelling units.

It must collect, in the field, every data point required to:

1. **Populate the DOE Building Energy Asset Score** (Full Input Mode) — building geometry/use-type, construction assemblies, HVAC systems, service hot water, and lighting. Output feeds the Asset Score tool + its HPXML/BuildingSync export.
2. **Satisfy an ASHRAE/ACCA Standard 211 Level 2 energy audit** — the detailed equipment inventory, envelope survey, common-area + in-unit systems, utility/energy data, and the field observations that back the Energy Efficiency Measure (EEM) list and end-use breakdown.

Both are already named as required deliverables in the WI HOMES submittal templates ("Whole-Building Energy Audit Report (ASHRAE Level II equivalent)", "HPXML v4 / BuildingSync file from Asset Score"; ASHRAE Level II is required for 5+ unit projects). This work order is the field-capture front end that produces the raw inputs for those deliverables and the Snugg Pro model.

**The multifamily difference, in one line:** a single-family home is one envelope + one set of systems; a multifamily property is **whole-building envelope + central/common-area systems captured once at the building level, plus a representative _sample_ of dwelling units captured one unit at a time.** The spec's whole job is to express that split cleanly on top of the existing engine without breaking the platform's "a work order never spans units" rule.

---

## 2. What just shipped (context — the SF assessment we're mirroring)

The Single-Family Energy Assessment is live and is the template to copy exactly.

- **Work type:** `Single-Family Energy Assessment` (scheduled, 90 min, not technician-creatable).
- **Work plan template:** `Single-Family Energy Assessment - Standard`, `wpt_allow_any_order = true`, live id `b122ffcf-b0e5-4ac0-8d17-d1f063f12ac5`.
- **Record type** (purpose-built, not legacy `hes_assessment`): `single_family_energy_assessment` on `work_orders`, `opportunities`, `projects`.
- **Modeled on Snugg Pro** — observable ranges/types are the primary inputs; exact R / U / SHGC values are optional label-entry.
- Built as a chain of migrations, each appending sections idempotently to the one plan (`20260722123000` foundation → `…340000` create-WO RPC → envelope/diagnostic/system follow-ons through `20260727204000`).

Live section catalog: Front Door Photo · Exterior Photos (N/E/S/W) · Exterior 360 Video · Utility Meters · Kitchen/Thermostat/Bathroom rooms · Heating System · Cooling System · Water Heating System · Building Characteristics · Attic/Ceiling · Walls · Foundation/Floor · Windows & Doors · Attic 360 Video · Diagnostic Tests (blower door, static pressures, combustion CO/draft, bath-fan CFM).

**Everything in §4 that says "already collected" is proven in production on the SF flow — the MF build inherits it, it does not reinvent it.**

---

## 3. Current-state architecture map (grounded in the code)

### 3.1 The capture engine (this is what we extend — do not rebuild)

Template layer (authored in migrations):

| Table | Prefix | Purpose | Key columns |
|---|---|---|---|
| `work_types` | `WT-` | The schedulable task | `work_type_name`, `work_type_default_work_plan_template_id` → plan, `work_type_default_work_order_record_type`, `work_type_is_technician_creatable`, `work_type_duration_minutes` |
| `work_plan_templates` | `WPT-` | Ordered set of steps | `wpt_name`, `wpt_allow_any_order` (non-linear walk), `wpt_record_type` |
| `work_plan_template_entries` | `WPTE-` | Join: step → plan | `work_plan_template_id`, `work_step_template_id`, `wpte_execution_order` |
| `work_step_templates` | `WST-` | A "section" | `wst_name`, `wst_assigned_owner_role_id`, `wst_verifier_role_id`, `wst_required_evidence_type_id` (Photo/Video/Document/Measurement/Verified-Yes-No), `wst_photos_required_count`, `wst_is_screen_flow`, `wst_photos_required_from_sampling`, `wst_category` |
| `work_step_template_fields` | `WSTF-` | Field defs in a section | `wstf_field_label`, `wstf_field_name`, `wstf_field_type`, `wstf_is_required`, `wstf_unit`, `wstf_sort_order`, `wstf_help_text`, `wstf_illustration_url`, `wstf_is_calculated`/`wstf_calc_expression`, `wstf_allow_not_present` |

**Allowed `wstf_field_type` values** (CHECK constraint, current): `number`, `text`, `select`, `user_multiselect`, `key_source`, `photo`. Video and Measurement are **step-level evidence types** (`wst_required_evidence_type_id`), not field types; measurements are captured as `number` fields with a `wstf_unit`. `select` option lists live in the `work_step_fields` picklist (`picklist_object='work_step_fields'`, `picklist_field=<wstf_field_name>`), admin-extendable.

Instance layer (created at runtime by the create-WO RPC + instantiate trigger; never authored in migrations): `work_orders` → `work_plans` → `work_steps` → `work_step_field_values`. LEAP Pad reads it all through the `work_order_detail_for_technician(uuid)` RPC; values are written by `save_work_step_field_value(...)` behind a hard "evidence gap" gate that blocks step completion until required fields/photos/video are present.

### 3.2 The hierarchy spine (why the build splits building vs unit)

`work_orders` carries the full FK spine on every row: `project_id` (NOT NULL), `opportunity_id` (NOT NULL), `property_id` (NOT NULL), `building_id` (nullable), `unit_id` (nullable). Platform rule, confirmed in docs and the create-WO RPCs: **a work order never spans units — building-level work runs with `unit_id = NULL`; in-unit work is one work order per unit.** Opportunities and payment requests are scoped **per building**.

### 3.3 Existing wide "record" tables (where captured data can roll up)

These SF-import tables already hold most audit data points as one-column-per-point and are the natural roll-up/report targets (they are **not** the capture UI — the work-step engine is):

- **`buildings`** (`building_*`) — richest physical store: year built, stories, sq ft, attic sq ft, avg ceiling height, construction/foundation/roof type, window type, ventilation, **unit mix by bedroom count + per-bedroom sq ft/BTU**, heating/cooling/DHW equipment (type/capacity/efficiency/age/manufacturer/year), blower-door result, infiltration ACH, insulation R-values, electric+gas meter numbers, annual therm usage.
- **`units`** (`unit_*`) — **thin on physics**: sq ft, bedrooms, bathrooms, floor level, heating/cooling/DHW/ventilation type, plus income-qualification/occupancy. A per-unit MF assessment needs most envelope/system detail added here (see §6.4).
- **`assessments`** (`assessment_*`) — ~270-column Snugg Pro/SF port: envelope, air leakage, attic, knee wall, heating, cooling/heat-pump (COP/HSPF/SEER/EER), DHW (incl. HPWH UEF), chimney/flue, water fixtures, lighting, plus model/report links (`assessment_snug_pro_url`, `assessment_matterport_url`, baseline energy use, modeled savings).
- **`diagnostic_tests`** (`diagnostic_*`) — wide blower-door + combustion-safety test store (pre/post CFM, ACH50, pressures, combustion CO/efficiency, AFUE, appliance nameplate). No active capture UI today; live diagnostics are captured as work-step fields.
- **`properties`** (`property_*`) — property roll-up + HUD/LIHTC metadata (`property_total_units`, `property_total_buildings`, `property_bedroom_mix`, `property_assisted_units`, HUD contract fields).

### 3.4 The sampling pattern already in the codebase (reuse the _pattern_, not the table)

`20260730233827_quality_install_verification_sampling.sql` shipped an **admin-managed unit-sampling bracket** for the IRA Multifamily Quality Install photo verification:

- `quality_install_sampling_rates` (min/max units → sample size, or "sample all"), RLS admin-write.
- `quality_install_sample_size(p_units integer)` — resolves the bracket for a unit count.
- `work_step_templates.wst_photos_required_from_sampling` — when true, a step's required photo count is derived at run time from the building's unit count instead of a static count.

This is the exact mechanism the MF assessment needs for "how many units do we sample." Per the platform's **build-discipline rule (no reuse across purposes)**, we do **not** point the assessment at the QI rate table; we create a purpose-named `assessment_sampling_rates` + `assessment_sample_size()` following the same proven shape (see §6.3).

### 3.5 Honest pain points / gaps

- **`units` is too thin** to hold per-unit assessment results — needs an envelope/systems column set (§6.4) or the values live only as work-step field values.
- **No utility/energy-data capture** in the field flow. ASHRAE L2 requires ≥12 months of all-fuel utility data + EUI + benchmarking. That's back-office data entry, not a field measurement — the spec routes it to a building-level section that can be filled in-office (§5, Phase 2).
- **Asset Score geometry** (building "blocks", footprint L×W, orientation, window-to-wall ratio, use-type mix) is **not** collected by the SF flow — it's genuinely new for MF (§6.2, Appendix A).
- **EEM list + financial analysis** (ASHRAE L2 §Normative Annex EEM tables — energy/cost savings, implementation cost, simple payback) is **analysis output**, produced in Snugg Pro / Asset Score, not a field-capture step. The WO captures the observations that feed it; it does not compute payback. Spec treats EEMs as downstream (§8 note).

---

## 4. What's already collected vs. net-new for MF

Legend: ✅ inherited from SF flow · ➕ new section, building-level · 🔁 new section, per-sampled-unit · 📋 back-office/data-entry.

| Data domain | Asset Score | ASHRAE L2 | Status in MF build |
|---|---|---|---|
| Front/exterior photos, 360 video | — | site record | ✅ + ➕ per building elevation |
| Building geometry: footprint L×W, # floors, gross floor area, orientation | ✅ required | ✅ | ➕ **new** (Building Geometry & Use) |
| Use-type mix (MF 4+ / MF <4 / mixed-use, common area) | ✅ required | ✅ | ➕ **new** |
| Year built / last major retrofit | ✅ | ✅ | ✅ (Building Characteristics) |
| Roof / wall / floor assemblies + insulation | ✅ | ✅ | ➕ building envelope (whole-building) |
| Windows: frame, glass type, WWR (or count+dims), U/SHGC | ✅ | ✅ | ➕ building + 🔁 spot-check per sampled unit |
| Air leakage (blower door CFM50/ACH50, pressures) | infiltration | ✅ | 🔁 per sampled unit + ➕ whole-building if guarded |
| Common-area / central **heating** (boiler, central furnace, plant loop) | ✅ | ✅ | ➕ Central & Common-Area Systems |
| Common-area / central **cooling** (chiller, cooling tower, plant loop, condenser) | ✅ | ✅ | ➕ |
| Distribution (AHU / zone equip, ducts, hydronic) | ✅ | ✅ | ➕ + 🔁 |
| Central / in-unit **service hot water** (type, fuel, capacity, efficiency, recirc) | ✅ | ✅ | ➕ central + 🔁 in-unit |
| **Lighting** inventory (fixture/lamp type, W/lamp, lamps/fixture, count or % area, mounting, controls) | ✅ | ✅ | ➕ common-area + 🔁 in-unit |
| In-unit heating / cooling / DHW equipment | ✅ | ✅ | 🔁 per sampled unit |
| In-unit appliances, ventilation (ASHRAE 62.2), bath-fan CFM | — | ✅ | 🔁 |
| Combustion safety (CO, draft, spillage, gas leak) | — | ✅ (health/safety) | 🔁 per sampled unit w/ combustion appliances |
| Utility / energy data: ≥12 mo all fuels, EUI, benchmarking (ENERGY STAR / Portfolio Manager) | — | ✅ **required** | 📋 building-level, in-office |
| Energy end-use breakdown | — | ✅ | 📋 (modeling output) |
| EEM list + savings/cost/payback + financial analysis | — | ✅ **required** | downstream (Snugg Pro / Asset Score), not field capture |
| Occupancy / operating schedules | asset-based (n/a) | ✅ | 📋 building-level |

Full field-by-field inventory in **Appendix A (Asset Score)** and **Appendix B (ASHRAE L2)**.

---

## 5. Phased build plan (each phase additive and independently shippable)

**Phase 1 — Foundation: work type, record types, plan, building-level WO.**
New `work_type` "Multifamily Energy Assessment"; new record type `multifamily_energy_assessment` on `work_orders`, `opportunities`, `projects` (+ `buildings` record type check per the enforce-record-type migration); new `work_plan_template` "Multifamily Energy Assessment — Building — Standard" (`wpt_allow_any_order=true`, fresh uuid). Building-level sections only: Building Photos & 360, Building Geometry & Use, Whole-Building Envelope (roof/wall/floor/windows), Central & Common-Area Systems (heating/cooling/distribution/DHW), Common-Area Lighting. `create_mf_assessment_work_order` RPC (find-or-create Account→Property→Building→Opportunity→Project→WO at `unit_id=NULL`), paralleling `create_assessment_work_order` incl. the Field Data Verification Review task. Ships a usable whole-building assessment.

**Phase 2 — Utility & energy data + occupancy (ASHRAE L2 data blocks).**
Building-level "Utility & Energy Data" and "Occupancy & Operating Schedules" sections (📋 fillable in-office). ≥12-month all-fuel entry, meter numbers/rates, EUI calc field (`wstf_is_calculated`), ENERGY STAR / Portfolio Manager score, occupancy counts, operating hours. Roll-up target: `buildings` meter/therm columns + new columns as needed.

**Phase 3 — Per-unit sampling engine + per-unit assessment WO.**
Purpose-named `assessment_sampling_rates` + `assessment_sample_size(units)` (§6.3). Second plan "Multifamily Energy Assessment — Unit — Standard" and a companion technician-/PC-creatable path that spawns **one per-unit WO per sampled unit** (`unit_id` set): In-Unit Systems (heating/cooling/DHW), In-Unit Envelope Spot-Check, In-Unit Lighting & Appliances, In-Unit Ventilation/Bath-Fan (ASHRAE 62.2), In-Unit Diagnostics (blower door + combustion safety), Unit Photos. A building-level "Unit Sample Plan" step shows the required sample size and which units are covered (mirrors the QI grouped-step display). Sampling stratified by unit type (see §7 Decision D2).

**Phase 4 — Roll-up, export & report wiring.**
Map captured field values onto `buildings` / `units` / `assessments` columns (roll-up), and wire the Asset Score HPXML/BuildingSync + ASHRAE Level II report deliverables named in the WI HOMES submittal templates. Add the `units` physics columns (§6.4). This is the phase that closes the loop to the submittal documents.

**Phase 5 — Help articles + admin surface.**
HA article ("Running a Multifamily Energy Assessment"), admin management of `assessment_sampling_rates`, and the `work_step_fields` picklists for all new selects. Per CLAUDE.md, a help article ships in the same session as the user-facing feature — so each phase carries its own HA increment; Phase 5 is the consolidation.

---

## 6. Technical recommendations

### 6.1 Copy the SF seed recipe verbatim
Use the exact `work_type → work_plan_templates → work_step_templates → work_step_template_fields → work_plan_template_entries` chain from `20260722123000`, with `''` record numbers (BEFORE-INSERT triggers fill them), the idempotent `EXISTS`-guarded section-append per follow-on migration, and role/evidence UUIDs pulled by lookup (Lead Technician owner, Project Site Lead verifier, Photo/Video evidence types). Screen-flow (`wst_is_screen_flow=true`) for multi-field sections; inline for single-photo/video steps.

### 6.2 Building Geometry & Use is the only genuinely new capture pattern
Asset Score needs footprint L×W (ft), # floors, gross floor area, orientation, window-to-wall ratio (continuous) **or** window count + dimensions (discrete), and a use-type selection incl. the MF 4+/<4 and mixed-use/common-area distinction. All expressible as `number` + `select` fields; add `wstf_help_text`/`wstf_illustration_url` because auditors won't know "aspect ratio" or "WWR" cold. Full field list in Appendix A.

### 6.3 Sampling: new purpose-named table, same proven shape
```
assessment_sampling_rates(asr_label, asr_min_units, asr_max_units, asr_sample_size, asr_sample_all, ...)
assessment_sample_size(p_units integer) RETURNS integer   -- resolves the bracket
```
RLS: internal-staff read, admin write (mirror `qisr_*`). Seed a default bracket aligned to the audit protocol EES uses (BPI-1105 / DOE MF sampling — **confirm in Decision D2**). Stratify by unit type in the create path, not in the rate table.

### 6.4 Add per-unit physics columns to `units` (Phase 4)
`units` currently can't store per-unit envelope/system results. Add a `unit_*` column set mirroring the sampled fields (insulation, window type, heating/cooling/DHW type+efficiency+age, blower-door CFM50/ACH50, bath-fan CFM, combustion results) so sampled-unit data rolls up and is reportable, respecting inherited-field conventions (`docs/leap-inherited-fields-lookups.md`) where a unit value can inherit from the building.

### 6.5 Known hazards
- **Migration filename stamps** — use real UTC `YYYYMMDDHHMMSS`, verify prefix uniqueness (`ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` must be empty). Concurrent round-number stamps already caused 7 duplicate-version pairs.
- **`wstf_field_type` CHECK** — only the six allowed types; don't invent `video`/`measurement` field types. Extend the constraint (new migration) only if a new field type is truly required, then re-`NOTIFY pgrst`.
- **After any function DROP/CREATE** — re-issue REVOKE/GRANT and `NOTIFY pgrst, 'reload schema'`; run `get_advisors(security)` after DDL (baseline ~205, only NEW lints act).
- **Vite** — new field-mobile UI must go through `npm run build:safe`; watch vendor-chunk TDZ if any new lazy import is added.
- **Verify column names** in `information_schema.columns` before DML; prefix conventions are inconsistent.

---

## 7. Decisions (recommendation first — confirm, then Phase 1)

- **D1 — WO structure: building-level WO (`unit_id=NULL`) + N per-unit sample WOs.**
  Recommend: **yes.** This is the only shape consistent with the platform's "a WO never spans units" rule, and it mirrors the SF create-WO cascade. Whole-building + common/central + geometry live on the building WO; each sampled unit is its own WO. **DECIDED: pending Nicholas.**

- **D2 — Sampling protocol & default bracket.** Recommend: **stratify by unit type (one of each bedroom configuration) then top up to a size bracket by total unit count**, seeded from the DOE IRA MF / BPI-1105 sampling guidance EES already follows for Quality Install. Need Nicholas to confirm the exact bracket numbers (or "use the same brackets as `quality_install_sampling_rates`"). **DECIDED: pending — this is the one number-set the spec can't invent.**

- **D3 — Utility/energy data: field vs back-office.** Recommend: **building-level section, fillable in-office** (auditor rarely has 12 months of bills on site). Not a hard evidence gate. **DECIDED: pending Nicholas.**

- **D4 — Snugg Pro vs Asset Score as system of record for the model.** SF uses Snugg Pro; Asset Score is a required WI HOMES deliverable. Recommend: **field WO is the single capture surface; it feeds both** (Snugg Pro model + Asset Score HPXML export) in Phase 4 — we do not double-enter. **DECIDED: pending Nicholas.**

- **D5 — Do we add `unit_*` physics columns, or keep sampled-unit data only as work-step field values?** Recommend: **add the columns in Phase 4** so unit data is reportable/roll-uppable; until then it lives as field values. **DECIDED: pending Nicholas.**

---

## 8. File + DB-table index (what the next session touches)

New migrations (Phase order), all under `supabase/migrations/` with real UTC stamps:
- P1: `..._mf_energy_assessment_foundation.sql` (work type, record types, building plan, sections), `..._create_mf_assessment_work_order.sql` (RPC).
- P2: `..._mf_assessment_utility_energy_data.sql`, `..._mf_assessment_occupancy.sql`.
- P3: `..._assessment_sampling_rates.sql` (table + `assessment_sample_size`), `..._mf_assessment_unit_plan.sql`, `..._create_mf_unit_assessment_wo.sql`.
- P4: `..._units_physics_columns.sql`, `..._mf_assessment_rollup_and_export.sql`.

Existing files to copy/extend: `20260722123000_single_family_energy_assessment.sql` (seed recipe), `20260722340000_create_assessment_work_order.sql` (RPC cascade + review task), `20260722380000_assessment_rpc_global_address_dedup.sql` (dedup variant), `20260727024000_assessment_envelope_sections.sql` (envelope pattern), `20260727030000/031500/134500` (diagnostics), `20260730233827_quality_install_verification_sampling.sql` (sampling shape to parallel), `20260713144748_work_step_measurement_capture.sql` (save RPC + evidence gate).

Front end (LEAP Pad renders screen-flow steps with no code change if we only add data): `src/fieldMobile/`, `src/modules/FieldModule.jsx`. New create-WO UI (parallel to the SF "New Assessment" entry) if a dedicated launcher is wanted.

DB tables: capture engine (`work_types`, `work_plan_templates`, `work_plan_template_entries`, `work_step_templates`, `work_step_template_fields`, runtime `work_orders`/`work_plans`/`work_steps`/`work_step_field_values`); roll-up targets (`buildings`, `units`, `assessments`, `diagnostic_tests`, `properties`); new (`assessment_sampling_rates`); picklists (`work_step_fields`, plus `record_type` values on `work_orders`/`opportunities`/`projects`/`buildings`).

Reference docs: `leap-work-types.md`, `leap-property-hierarchy.md`, `leap-field-mobile.md`, `leap-field-types.md`, `leap-inherited-fields-lookups.md`, `leap-project-paperwork-port.md` (submittal deliverables).

---

## Appendix A — DOE Building Energy Asset Score (Full Input Mode) field inventory

From the DOE Asset Score Data Collection Short Form v2/7/19 (Full Input Mode). Fields marked required generate the score; conditional fields apply only if the component exists.

**Building info:** name; data collector; email/phone; date collected; year completed (or last major retrofit); gross floor area (ft²); location (street/city/state/postal); footprint dimensions LENGTH × WIDTH (ft); number of floors.

**Use type** (select, one+ per block; MF-relevant): Multi-family (4 stories +), Multi-family (less than 4 stories), Office, Retail, Lodging, Parking Garage (Ventilation only), Community Center, Assisted Living, Senior Center, Warehouse non-refrigerated, etc. — supports mixed-use via multiple blocks (Long Form).

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
- **Service Hot Water** (Long Form / required if present): system type, fuel, capacity, efficiency — collected in the Central/In-Unit DHW sections.

## Appendix B — ASHRAE/ACCA Standard 211 Level 2 field data (Normative Annex reporting)

Level 2 = everything in Level 1 plus the detailed survey below. Analysis outputs (EEM tables, financials, end-use model) are produced downstream, not in the field WO; the WO captures the observations that back them.

- **Facility description:** name/address; primary + secondary use types; gross conditioned floor area; year built + major-retrofit history; number of floors; **unit mix** (count by type); occupancy; operating schedules/hours.
- **Utility & energy data (required):** ≥12 consecutive months for **each** fuel (electric kWh + peak demand kW; natural gas; other fuels); meter numbers; utility rates; site & source EUI; benchmarking (ENERGY STAR / Portfolio Manager score); weather normalization inputs.
- **Envelope:** wall / roof / floor / foundation assemblies + insulation R-values + condition; windows (frame, glazing, U-factor, SHGC, WWR) + condition; air leakage/infiltration observations; doors.
- **Lighting:** inventory by space (common area + representative in-unit): fixture type, lamp type, wattage, quantity, controls, operating hours; lighting power density.
- **HVAC:** full equipment inventory — heating/cooling/ventilation type, capacity, efficiency (AFUE/HSPF/SEER/EER/COP), age, condition, fuel, controls/setpoints, schedules; distribution (ducts location/insulation/leakage, hydronic, AHU/zone); central plant (boiler, chiller, cooling tower, pumps).
- **Service hot water:** type, fuel, capacity, efficiency, temperature setpoint, distribution/recirculation, condition.
- **Other loads:** plug loads, elevators, laundry, common kitchen, pools/spas, motors, ventilation (ASHRAE 62.2 for dwelling units), exhaust-fan airflow.
- **Health & safety / combustion:** combustion appliance zone testing — undiluted & ambient CO, draft/spillage, gas-leak, worst-case depressurization; mold/moisture; roof & drainage condition.
- **EEMs & financials (downstream deliverable, not field capture):** low/no-cost and capital measures, each with estimated energy savings, cost savings, implementation cost, and simple payback; interactions; recommended package.
