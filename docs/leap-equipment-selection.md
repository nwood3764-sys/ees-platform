# Equipment Selection — the auditor picks a model, he does not go shopping

Plan and current-state map. Nothing in here is built yet.

**Nicholas, 2026-09-05:** *"A user within LEAP, when it comes time to select the
equipment, has available equipment models, and they don't have to go search.
Think of an energy auditor that's not an HVAC expert. He knows where the
building's at, the heating load and the cooling design load, building square
footage, weather station, and all that kind of stuff… I want to create a process
where there's only a limited number of equipment that could be possible for a
given installation type… I want to be able to go to this page, auto-populate
this information from what we have in LEAP, and go from there."*
(referring to <https://ashp.neep.org/#!/product_list/>)

---

## 1. Vision

An energy auditor finishes a Manual J. He opens the opportunity, presses
**Select Equipment**, and sees **a short ranked list of specific model numbers**
— each one already known to be (a) something the programme will pay for,
(b) something EES installs, (c) physically installable in this building, and
(d) correctly sized for the load that was just calculated. He picks one. He is
shown *why* it fits: capacity at the winter design temperature, the balance
point, how much supplemental heat is left over. He never opens NEEP, never
types a model number, never guesses a tonnage.

The NEEP page is the reference LEAP should make unnecessary — not a screen to
recreate. Its product list is 40,000+ systems across 100+ brands
([NEEP](https://neep.org/heating-electrification/ccashp-specification-product-list)).
Handing an auditor a search box over 40,000 systems is the problem, not the
solution. **The whole feature is a funnel that turns 40,000 into five.**

### The funnel — four filters, in this order

| # | Filter | Question it answers | Status today |
|---|---|---|---|
| 1 | **Programme eligibility** | Will this programme pay for this model? | ✅ **BUILT** (2026-09-03) |
| 2 | **Installation type** | Can this physically go in this building? | ❌ columns exist, vocabulary empty |
| 3 | **Sizing** | Does it carry the load at design conditions? | 🟡 the load now lands in LEAP (2026-09-05); the sizing engine is unbuilt |
| 4 | **EES preference** | Do we install and stock this? | 🟡 price books exist, not linked to equipment |

Filter 1 already works and is enforced in the database. Filters 2–4 are the
build. **Filter 3 was blocked on something smaller than it looked — LEAP had
nowhere to put a design load — and that blocker was cleared on 2026-09-05:
see Phase 1 below.** What remains of Filter 3 is the sizing arithmetic itself:
capacity at the winter design temperature against the stored design load.

---

## 2. What is already here — and it is much more than the docs say

Everything below was read off **production** (`flyjigrijjjtcsvpgzvk`) on
2026-09-05, not inferred from the code.

### 2a. The two-tier product model is named and shipped

Migration `20260903015923_hear_equipment_products_and_the_models_that_qualify.sql`
already draws the distinction this feature depends on, and says so out loud:

- **Tier 1 — the INCENTIVE MEASURE.** `products` rows on the `PRODUCT` record
  type (`HEAR-VENT`, `HEAR-HPWH`, `MEAS-ATTIC-INS`, "ENERGY STAR Electric Heat
  Pump for Space Heating and Cooling"). No manufacturer, no model number. This
  is what the programme *pays for*, what goes on an `opportunity_line_items`
  row, and what `product_work_measure_map` maps to a work measure.
- **Tier 2 — the REAL EQUIPMENT.** `products` rows on `HEAT-PUMP-EQUIPMENT`,
  `VENTILATION-EQUIPMENT`, `FURNACE-EQUIPMENT`. Carries
  `product_manufacturer` / `product_model_number` and the whole
  specification / submittal / manual block.

**Equipment selection therefore already has a home. It is not a new object.**

### 2b. Filter 1 is enforced in the database, today

| Artifact | What it does |
|---|---|
| `products.product_requires_equipment_selection` | Declares that a measure installs a model-numbered device |
| `products.product_equipment_record_type_id` | Which equipment record type its models take |
| `product_qualifying_equipment` (PQE-) | The junction: measure → approved model |
| `opportunity_line_items.oli_is_equipment_line` / `.oli_equipment_product_id` | The chosen model, on the quoted line |
| `enforce_line_item_equipment_selection()` | Refuses a line with no model, and refuses a model not on the measure's list — **naming the approved models in the error** |
| `list_qualifying_equipment_for_measure(uuid[], uuid)` | What the picker offers |
| `cascade_product_equipment_requirement_to_line_items()` | Keeps the flag and the lines in agreement |
| `create_qualifying_equipment_for_measure(measure, manufacturer, model)` | Mints an equipment product and links it, de-duplicating on make+model |

This is a working, purpose-named eligibility engine. **The plan extends it; it
does not replace it.**

### 2c. `products` ALREADY carries the entire NEEP reporting template

This is the finding that changes the shape of the work. NEEP's manufacturer
reporting template columns are *Brand Owner, Brand Name, Series Name, Ducting
Configuration, AHRI Certified Reference Number, AHRI Type, Outdoor Unit Model
Number, Indoor Type, Indoor Model Number(s), Furnace Model Number, EER2, SEER2,
HSPF2 (Region IV), HSPF2 (Region V), ENERGY STAR Certified, ENERGY STAR Cold
Climate Certified, Variable-Capacity*
([NEEP](https://neep.org/heating-electrification/ccashp-specification-product-list)).

`public.products` (97 columns) already has, one for one:

```
product_manufacturer          product_series / product_series_name
product_model_number          product_ducting_configuration
product_refrigerant_type      product_variable_capacity
product_ahri_certificate_number   product_ahri_link   product_neep_link
product_seer2  product_eer2  product_hspf2_region_iv  product_hspf2_region_v
product_heating_capacity_47f / _17f / _5f / _neg13f
product_heating_cop_5f        product_cooling_capacity_95f
product_capacity_maintenance_17f / _5f / _max5f
product_energy_star_v6_1      product_energy_star_v6_1_cold_climate
product_federal_tax_credit_eligibility
product_specification_sheet_url  product_submittal_sheet_url
product_install_manual_url       product_engineering_manual_url  …
```

And `ahri_certificates` (38 columns) + `ahri_equipment` (16) already model the
thing that trips people up about this dataset: **an AHRI reference number is not
a product, it is a certified *combination*** — one outdoor unit with one or more
indoor units, optionally a furnace. `ahri_equipment` is the junction
(`ahri_certificate_id` → `product_id`, with `ae_equipment_role` and
`ae_quantity`). That is the correct shape and somebody thought about it.

**Every one of those tables is empty.**

| Table | Rows | With performance data |
|---|---|---|
| `products` | 33 live | **0** — no capacity, no COP, no AHRI number, no NEEP link |
| `ahri_certificates` | **0** | — |
| `ahri_equipment` | **0** | — |
| `product_qualifying_equipment` | **1** | — |
| `mechanical_equipment` (85 cols) | **0** | — |
| `program_measure_products` | 19 | — |
| `product_work_measure_map` | 18 | — |
| `price_book_entries` | 73 | — |

Of the 33 products, **9** carry a manufacturer and only **4** are real
equipment: PRD-00001 Mitsubishi MSZ-FH15NA, PRD-00002 Rheem ProTerra,
PRD-00033 Panasonic FV-0511VF1, and a spray-foam kit. The rest are measures,
incentives, services, and a ladder.

> **So this is not a schema project. The schema is right and it is empty.**
> It is a *data acquisition* project plus a *sizing* project. Anyone starting
> here should resist the urge to design new equipment tables — they exist.

### 2c-bis. The ANSWER this feature produces is already written down three times, by hand

Before designing where a sizing result goes, note that three separate objects
already carry a hand-typed heat-pump selection — the *output* of a calculation
nobody can currently perform:

| Object | The block |
|---|---|
| `assessments` | `assessment_hp_model`, `_hp_heating_capacity_btuh`, `_hp_heating_capacity_at_17_f_if_available`, `_hp_cooling_capacity_ton`, `_hp_cooling_eer`, `_hp_cooling_seer_ieer`, `_hp_hspf`, `_hp_cop`, `_hp_cop_at_17_f_if_available`, `_hp_backup_heating_capacity_btuh`, `_estimated_changeover_temperature_f`, `_hp_option_with_necessary_capacity`, `_can_the_hp_connect_to_existing_ductwork`, `_does_the_hp_physically_fit_the_location`, `_do_existing_electric_systems_support_hp`, `_hpwh_model`, `_uef_for_the_specified_hpwh` |
| `efr_reports` (Energize Denver) | `efr_hp_model`, `efr_hp_ahri_number`, `efr_hp_heating_capacity_btuh`, `efr_hp_heating_capacity_17f`, `efr_hp_cop_5f / _17f / _47f`, `efr_hp_cooling_capacity_ton`, `efr_hp_seer2 / _eer2 / _hspf2`, `efr_hp_backup_heating_capacity`, `efr_backup_heat_type`, `efr_estimated_changeover_temp_f`, `efr_ducted_or_ductless`, `efr_cold_climate_certified`, `efr_equipment_area_served_sqft`, `efr_hp_can_connect_ductwork`, `efr_hp_physically_fits`, `efr_electric_systems_support_hp`, `efr_hpwh_model`, `efr_hpwh_uef` |
| `mechanical_equipment` | the fullest HVAC column set in the database — outdoor/indoor model numbers, capacity at 47/17/5 °F, COP at 47/17/5 °F, SEER2/EER2/HSPF2, `me_ducted_or_ductless`, `me_backup_heat_type`, `me_cold_climate_certified`, `me_ahri_reference_number`, `me_estimated_changeover_temp_f` |

**Three objects, one fact, and every one of them filled in by a person typing.**
That is the strongest argument in this document for a single purpose-named
selection record: these three are already drifting, and adding a fourth copy on
the opportunity would make it four. The sizing engine should write **one**
record, and these three should read it — or be retired into it.

The same disease afflicts the *existing* equipment survey, which lives in **five
unreconciled homes**: `buildings.building_heating_equipment_*`,
`assessments.assessment_heating_system_*`, `mechanical_equipment.me_*`,
`efr_reports.efr_*`, and `work_step_field_values` keyed by `heating_*` /
`mf_heating_*`. `docs/leap-multifamily-energy-assessment.md` names `buildings`
as "the natural roll-up target" and **the roll-up is unbuilt**. Sizing needs to
know what is there today; it currently has five places to ask and no rule for
which one wins.

### 2d. Data-integrity problems that must be fixed BEFORE ingesting anything

1. **`products` stores several facts twice — once numeric, once text.** The
   Salesforce import left a parallel text set beside the real columns:
   `product_heating_capacity_47_f text` beside `product_heating_capacity_47f integer`;
   likewise `_17_f`, `_5_f`, `_13_f`, `product_heating_cop_5_f`,
   `product_cooling_capacity_95_f`, `product_ahri_certificate` (text) beside
   `product_ahri_certificate_number` (integer), and all three
   `product_capacity_maintenance_*` pairs, plus
   `product_manufacture_install_manual` beside `product_install_manual_url`.
   **An importer will write one copy and a report will read the other.** This is
   the same class of defect as `C.cardSecondary` and the two-facts-for-one-field
   page layout bug: one fact, two homes, nothing keeping them in agreement.
   Retire the text set before a single row is ingested.
2. **`mechanical_equipment` has the identical doubling** —
   `me_heating_capacity_47f integer` beside `me_heating_capacity_47_f numeric`,
   and the same for 17f/5f/cop/cooling. 85 columns, 0 rows, so it is free to fix
   now and expensive to fix later.
3. **The picklists that express "installation type" have no values.**
   `product_ducting_configuration`, `product_variable_capacity`,
   `product_refrigerant_type`, `product_equipment_category`, `product_type`,
   `product_type_category` are all `uuid` FKs to `picklist_values` — and
   `picklist_values` holds **zero rows** for any of those fields. The columns
   that Filter 2 runs on cannot currently hold a value.
4. **Capacity is stored in two different units, in the same records.**
   `assessment_hp_cooling_capacity_ton` sits beside
   `assessment_hp_heating_capacity_btuh`; the multifamily field capture asks for
   `mf_heating_capacity` in **BTU/h** and `mf_cooling_capacity` in **tons**.
   A sizing engine that compares a load to a capacity cannot tolerate that.
   Store Btu/h; convert to tons for display only.
5. **`products` has no cost column** — and that is correct (price lives on
   `price_book_entries`), but it means Filter 4 has nothing to rank *on* until
   equipment models get price book entries. Today `price_book_entries` holds 73
   rows and none of them point at an equipment product.

### 2e. There is no design load anywhere in LEAP

Every column in the production database was searched for
`design_load | design_temp | heating_load | cooling_load | weather_station |
manual_j | climate_zone | balance_point | degree_day | winter_design |
summer_design`. **One column matched, and it is unrelated**
(`ahri_certificates.ahri_full_load_cooling_air_volume`).

What LEAP *does* capture, on the assessment work plan (`work_step_template_fields`)
and on `assessments` / `buildings` / `properties` / `units`, is the **existing**
equipment — manufacturer, model number, serial number, year, input BTU, output
capacity, condition, fuel — plus square footages by bedroom count and
`building_*_est_btus`. `heating_total_load_pct` exists, but it means *what share
of the load this system serves*, not the load.

`assessments` also carries a half-built proposal block that shows somebody has
been here before: `assessment_hp_heating_capacity_btuh`,
`assessment_hp_heating_capacity_at_17_f_if_available`,
`assessment_hp_cooling_capacity_ton`, `assessment_hp_backup_heating_capacity_btuh`,
`assessment_estimated_changeover_temperature_f`,
`assessment_hp_option_with_necessary_capacity` (free text). These are the
*outputs* of the sizing calculation, typed in by hand, with no load to derive
them from and no catalog to pick from.

> **The single most important build item is not the picker. It is that the
> Manual J result has to land in LEAP as data.** Until it does, sizing has no
> input and every screen after it is decoration.

---

## 3. The data problem: where the equipment list actually comes from

This is the decision that gates everything, and it needs Nicholas.

### 3a. NEEP's own bulk export is not free

The NEEP site "continues to offer the opportunity to download a comprehensive
excel-based list of products, [but] this access is now limited to initiative
subscribers"
([NEEP](https://neep.org/blog/neep-launches-new-website-cold-climate-air-source-heat-pump-product-list)).
Since April 2025 NEEP collects its data through AHRI under a joint
AHRI/NEEP reporting template
([NEEP](https://neep.org/blog/checking-neep-ccashp-product-list)).

### 3b. AHRI's bulk export is a paid, licensed subscription

The public AHRI Directory caps a CSV download at **250 records**. Unlimited
search and download, and an API as a paid add-on, require the **AHRI Data
Subscription Program** under a signed data subscriber licence agreement
([AHRI](https://www.ahrinet.org/certification/license-ahri-directory-data),
[AHRI Support](https://ahridataservicessupport.freshdesk.com/support/solutions/articles/44000889343-ahri-certified-data-subscriber-export-files)).

### 3c. There IS a free, licensed, machine-readable source: EPA ENERGY STAR

EPA publishes its certified-product lists as open data on Socrata with a
documented SODA API — including **ENERGY STAR Certified Air-Source Heat Pumps**
(`w7cv-9xjt`), **Ducted Heat Pumps**, **Mini-Split Air Conditioners**, and
**Central Air Conditioners**, filterable server-side with `$where`
([ENERGY STAR](https://www.energystar.gov/products/spec/energy_star_api_user_essentials_pd),
[dataset](https://data.energystar.gov/Active-Specifications/ENERGY-STAR-Certified-Air-Source-Heat-Pumps/w7cv-9xjt)).
Every record carries the **AHRI Certified Reference Number**, which is the join
key back to both AHRI and NEEP, and ENERGY STAR v6.2 carries an explicit
**cold-climate** designation.

**Recommendation: ingest ENERGY STAR open data, key on the AHRI reference
number, and deep-link to NEEP per model for the human** — `product_neep_link`
and `product_ahri_link` already exist for exactly that. If NEEP or AHRI
subscription data is later licensed, it lands in the *same* columns through the
*same* importer; the source becomes a field, not a rewrite.

> ⚠️ **Unverified and must be checked first.** This sandbox's network policy
> blocks `ashp.neep.org`, `neep.org`, `ahridirectory.org` and
> `data.energystar.gov` outright, so the exact ENERGY STAR column list could
> **not** be read from the live dataset — only from secondary sources. Before
> any mapping is designed, one session with network access must pull
> `GET https://data.energystar.gov/resource/w7cv-9xjt.json?$limit=5` and write
> the real field names down. Specifically confirm whether it publishes
> **capacity and COP at 17 °F and 5 °F**, or only 47 °F plus SEER2/HSPF2 — if
> it is the latter, ENERGY STAR alone cannot answer a cold-climate sizing
> question and the AHRI subscription becomes necessary rather than optional.
> **Do not design the importer against remembered field names.** (The repo has
> already paid for that once: the assistant's pricing table was written from
> memory and every number in it was wrong.)

### 3d. Scraping the NEEP site is not the plan

`ashp.neep.org` is a single-page app over a private JSON endpoint. Scraping it
would put LEAP's equipment catalog — the thing a rebate submission and a
customer proposal are built on — on an undocumented endpoint with no licence,
no schema guarantee and no support. Say no once, and record why.

---

## 4. Target architecture

```
     ┌──────────────────────────── INPUTS ────────────────────────────┐
     │                                                                 │
  Manual J (Conduit Tech)          Building / unit facts        Programme
  design heating load Btu/h        sq ft, existing system,      opportunity
  design cooling load Btu/h        fuel, electrical service     record type
  99% / 1% design temps            ducted or not                     │
  weather station                          │                          │
     │                                     │                          │
     ▼                                     ▼                          ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  select_equipment_for_line_item(opportunity_line_item_id)           │
  │                                                                     │
  │   1. eligible   ← product_qualifying_equipment       (BUILT)        │
  │   2. installable← product_ducting_configuration, category, zones    │
  │   3. sized      ← capacity @ design temp vs design load             │
  │                   against equipment_sizing_rules  (DATA, not code)  │
  │   4. preferred  ← price_book_entries, EES stocking list             │
  └─────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
        ranked candidates, each with its reasoning:
        capacity @ design temp · % of load · balance point ·
        supplemental heat kW · Manual S pass/fail · NEEP + AHRI links
                                     │
                                     ▼
        a person chooses  →  opportunity_line_items.oli_equipment_product_id
                             + the reasoning, stored  (BUILT column)
```

### Design principles

1. **The auditor answers questions about the BUILDING, never about equipment.**
   Every input to the engine is something a BPI-certified auditor already knows
   or already measured. If a screen asks him to choose a tonnage, the feature
   has failed.
2. **Sizing rules are DATA.** A new `equipment_sizing_rules` object, scoped per
   programme (opportunity record type) and per measure, holding the acceptable
   capacity band, the design temperature to evaluate at, and whether
   supplemental heat is allowed. LEAP's standing rule is that nothing is
   hardcoded, and this is exactly the kind of thing that varies by programme and
   by state. ACCA Manual S sizing bands (roughly 90–115 % of the cooling load,
   up to 125 % in a heating-dominant climate, with different treatment for
   variable-capacity equipment —
   [ACCA](https://hvac-blog.acca.org/correctly-sizing-variable-capacity-heat-pump-equipment/),
   [Energy Vanguard](https://www.energyvanguard.com/blog/what-is-a-properly-sized-air-conditioner/))
   are the **seed values**, authored from the Manual S text itself, not from a
   blog and not from this document.
3. **LEAP proposes; a person confirms.** The engine returns ranked candidates
   with its reasoning on screen. It never auto-selects. And the reasoning is
   **stored on the line item** — a year later, an auditor or a programme
   reviewer must be able to see why that model was chosen.
4. **Fail loudly and by name.** No design load → the screen says *"this needs a
   Manual J heating and cooling design load; none is recorded on this
   building"*, and links to where to enter it. Nothing fits → say what was
   filtered out and at which step. **Never fall back to an unsized list** —
   an unsized list is how an auditor who is not an HVAC expert installs a heat
   pump that cannot heat the building.
5. **Do not rebuild the weather database.** Conduit Tech already uses ASHRAE
   2021 design data and is ACCA-approved ("Powered by ACCA Manual J")
   ([Conduit Tech](https://getconduit.com/)). LEAP should capture the design
   temperatures and the weather station **from the Manual J that computed
   them** — that keeps the numbers on the proposal identical to the numbers on
   the load calculation, which is what a programme reviewer checks.
6. **One catalog.** Equipment is `products` on an equipment record type. Never
   a second equipment table. `mechanical_equipment` is *existing* equipment
   found in a building; `products` is the *catalog*. Do not blur them.

---

## 5. Phased build plan

Each phase is additive and independently shippable.

### Phase 0 — clear the ground (small, do it first)
- Retire the duplicate text columns on `products` and `mechanical_equipment`
  (§2d.1–2). Verify each is empty first; migrate any value into the numeric
  column; drop or mark deprecated in one migration with a fixture pinning that
  nothing reads them.
- Seed the picklists for `product_ducting_configuration`,
  `product_variable_capacity`, `product_equipment_category`,
  `product_refrigerant_type` — **using NEEP's own vocabulary**, so an ingested
  value never needs translating.
- **Decide §7.1 (data source) before writing any importer.**

### Phase 1 — the load lands in LEAP  ✅ **SHIPPED 2026-09-05**

Built as **`manual_j_reports` (MJR-)** rather than the `load_calculations`
(LOAD-) proposed here, and hung off the **assessment** rather than the building
or unit — Nicholas, 2026-09-05: *"I think it belongs on the assessment record…
The user, probably the project coordinator, will drag it on top of this widget
you're making, and then you'll scrape the information from it and then save the
PDF to the assessment object."*

Three departures from the plan above, each for a reason worth keeping:

- **It is scraped, not typed.** §7.5 recommended typing six numbers off the
  report with a PDF parse deferred to Phase 5. The parse turned out to be the
  cheaper half: the report is regular, and typing six numbers is where a
  transposed digit becomes a mis-sized heat pump. `src/lib/conduitManualJ.js`
  reads the whole report — 17 load blocks, 15 components each, 14 assemblies —
  and a person reviews it before anything is written.
- **Four tables, not one.** A Manual J is a shape, not a field set: whole home,
  each proposed system, each zone, each room, plus the component breakdown and
  the envelope assemblies. `manual_j_reports` / `manual_j_load_blocks` /
  `manual_j_load_components` / `manual_j_building_materials`.
- **The design load is stored as a DECISION, with its basis.** This is the part
  the plan did not anticipate and the one that matters most to §3's sizing
  filter. See below.

**The trap this uncovered, which any sizing engine has to know about.** A report
that models more than one proposed system prints a Whole Home total that counts
every shared room ONCE PER SYSTEM. On the real 2506 Frazier Ave report the
printed whole-home heating load is **46,735 Btu/h** and the building needs
**29,882** — the difference is Zone 1 over again, because its five rooms are
served by both the gas furnace and the cold-climate heat pump being compared.
**Reading `mjr_design_heating_load_btuh` is safe; reading the whole-home block
is not.** The cooling side of the same report does not diverge, so the check is
per measure. `mjr_design_load_basis` records which load a person chose and why.

**What Filter 3 can now read**, per assessment: design heating and cooling load
(sensible and latent), the basis they were chosen on, winter and summer design
dry bulb, indoor design conditions, weather station, elevation, altitude
correction factor, conditioned floor area, duct configuration and leakage class,
every room's load, and every assembly's U-value. The NEEP advanced search is
fully populated except the construction year, which no Manual J carries — LEAP
takes it from the assessment, then the building, then the property, and asks
when none of them holds one.

**Still open from this phase:** §7.7 is undecided — the sizing RESULT still has
no home, so `equipment_selections` (EQS-) remains the recommendation and the
three hand-typed heat-pump blocks in §2c-bis still drift. Only Conduit Tech is
parsed; a second tool is a new parser behind the same interface, not a rewrite.
And a load calculation cannot yet be filed against a building or unit directly —
it reaches them through its assessment.

### Phase 2 — the catalog gets filled
- Follow the HUD import pattern already proven in this repo (see
  `docs/leap-hud-data-sources.md`): **staging table → normalize → match ladder →
  promote, with a review queue for anything ambiguous and the raw payload kept
  as the import's own transcript.** The concrete precedents to copy are
  `stg_hud_mf` / `stg_hud_lihtc` (service-role-only staging, truncated and
  refilled each refresh), `normalize_addr_key()` / `normalize_owner_key()`
  (IMMUTABLE, pinned `search_path`), `property_hud_match_review` (nothing is
  auto-merged), `property_source_data.psd_raw_payload jsonb`, and
  `property_import_batches` (PIB-) for per-run counts. **Nothing is ever hard
  deleted; a discontinued model is marked, not removed** — it is still on last
  year's signed proposal.
- `equipment_catalog_imports` (ECI-) + `equipment_catalog_import_rows`, an edge
  function that pulls the source, and a scheduled refresh (models are added and
  discontinued constantly).
- Match on **AHRI Certified Reference Number first**, then normalized
  make+model — and reuse an existing product rather than minting a duplicate,
  which `create_qualifying_equipment_for_measure` already does correctly.
- Populate `ahri_certificates` + `ahri_equipment` for the outdoor/indoor
  combination, and `products` for each unit.
- Provenance columns on every ingested product, mirroring the HUD ones:
  which dataset, which batch, when refreshed. A capacity figure on a customer
  proposal must be traceable to a source and a date.
- **Scope it.** 40,000 systems is not the goal. Start with the categories EES
  actually installs — the three record types that already exist
  (`HEAT-PUMP-EQUIPMENT`, `VENTILATION-EQUIPMENT`, `FURNACE-EQUIPMENT`) plus
  **PTHP**, which multifamily needs and which PRD-00035 "High Efficiency PTAC
  Replacement" is already selling.

### Phase 3 — the sizing engine
- `equipment_sizing_rules` (ESR-), per opportunity record type + measure.
- `size_equipment_candidates(...)` — a SECURITY INVOKER function returning
  ranked candidates with, per candidate: capacity at the winter design
  temperature (interpolated between the 47/17/5 °F points), % of design heating
  load met, % of design cooling load met, balance point, supplemental heat
  required, and a pass/fail per rule with the rule named.
- **Interpolation is the one genuinely tricky calculation** and it must be a
  pure, fixture-tested module with a positive control that must come back wrong
  — the platform's standard for anything a reader cannot verify by eye.
- Every filter step reports what it removed, so "no models found" is always
  explainable.

### Phase 4 — the screen
- **Select Equipment** action on the opportunity line item / the Products card,
  auto-populated: building, load, design temps and programme all read from the
  record. The auditor confirms and picks.
- Reuse `list_qualifying_equipment_for_measure`'s contract so the existing
  picker keeps working; the sized list is a *ranking and annotation* of the
  eligible list, never a replacement for the eligibility rule.
- A help article in the same session, per the ship cycle.

### Phase 5 — downstream, once selection is real
- The chosen model flows to the proposal / submittal documents, the HEAR Quality
  Installation Supplemental Data Sheet (which exists to report model numbers and
  is the reason Tier 2 was built), the work order, and the material request.
- Install verification: the model **installed** vs the model **selected**, with
  the nameplate photo as the evidence artifact.
- Conduit Tech PDF/API ingestion to fill Phase 1 automatically.

---

## 6. Technical recommendations and known hazards

- **Verify the source dataset's real columns before designing the mapping**
  (§3c). This is the one item that can invalidate the plan.
- **`= ANY(text[])` is a linear scan; `jsonb ? key` is a hash probe.** A
  catalog filter comparing every candidate against a token list will be slow at
  40,000 rows — the 2026-09-03 text-normalization work measured 5.0 s vs 1.5 s
  on exactly this. Index `product_ahri_certificate_number`,
  `product_heating_capacity_5f` and the category columns before the first
  large import.
- **The Supabase MCP tools time out client-side at 60 s and the server keeps
  going and COMMITS.** A bulk catalog import must be chunked and idempotent,
  and `supabase_migrations.schema_migrations` checked before concluding a
  timeout rolled back.
- **A trigger function promoted to SECURITY DEFINER must revoke EXECUTE in the
  same migration**, or the advisors gain a lint per function.
- **`block_hard_delete()` means a migration cannot prove itself with a probe
  insert.** Behavioural proof belongs in a rolled-back transaction.
- **Do not add a second date/number vocabulary.** Capacity is Btu/h everywhere;
  tons are a *display* conversion, never a stored column. The assessment block
  already mixes them (`assessment_hp_cooling_capacity_ton` beside
  `..._capacity_btuh`) — pick Btu/h and convert at the edge.
- Licensing: whatever source is chosen, record the licence terms on the import
  record. A customer proposal quoting third-party certified performance data is
  a redistribution.

---

## 7. Decisions — recommendation first, each a one-line yes/no

**7.1 — Where does the equipment data come from?**
*Recommendation:* **Ingest EPA ENERGY STAR open data (free, documented API,
licensed for reuse), key on the AHRI reference number, deep-link to NEEP per
model.** Revisit an AHRI Data Subscription only if the verification in §3c shows
ENERGY STAR does not publish capacity/COP at 17 °F and 5 °F — those two numbers
are the whole cold-climate sizing question. **Not** scraping ashp.neep.org.
→ *Yes / no?*

**7.2 — What is the unit of a load calculation?**
*Recommendation was:* per building for a central system, per unit for in-unit
equipment.
→ **DECIDED 2026-09-05, Nicholas — it belongs to the ASSESSMENT.** *"I think it
belongs on the assessment record."* `manual_j_reports.assessment_id` is NOT
NULL; property, building, unit, opportunity and project are inherited from the
assessment so the sizing engine can still find a building's load directly. The
open half of the original question stands: a load calculation cannot yet be
filed against a building or unit that has no assessment.

**7.3 — Which equipment categories are in scope for round one?**
*Recommendation:* the three record types that already exist — heat pump,
ventilation, furnace — **plus PTHP**, since multifamily PTAC replacement is
already a measure being sold. Water heaters, appliances and electrical get a
category when someone installs one.
→ *Yes / no?*

**7.4 — Does the engine ever auto-select?**
*Recommendation:* **no.** It ranks and explains; a person picks and the
reasoning is stored. An auto-selected heat pump that cannot heat the building at
design conditions is a callback, a warranty claim, and a failed programme
inspection.
→ *Yes / no?*

**7.5 — Where does the Manual J come from on day one?**
*Recommendation was:* typed in from the Conduit Tech report, with the PDF
attached as the evidence artifact.
→ **DECIDED 2026-09-05, Nicholas — SCRAPED, not typed.** *"I'll upload the
Conduit Tech report… I want the software to scrape all of the relevant fields
and put the information in."* Shipped: the coordinator drops the PDF on the
assessment, LEAP reads it, a person checks it, the PDF is filed as the evidence.
Typing was the more expensive option once the report turned out to be regular.

**7.6 — Do Phase 0's duplicate-column cleanups ship first, on their own?**
*Recommendation:* **yes.** They are small, they are free while the tables are
empty, and ingesting 40,000 rows into a table that stores capacity twice makes
them permanent.
→ *Yes / no?*

**7.7 — Does the sizing result get one home, or does it fill the existing three?**
*Recommendation:* **one purpose-named record — `equipment_selections` (EQS-) —
written by the engine and READ by `assessments`, `efr_reports` and the
proposal**, rather than the engine writing into three hand-typed blocks that
already drift (§2c-bis). This is the platform's own "one definition" rule; the
alternative is the four-copies-of-one-fact defect this repo has fixed repeatedly.
→ *Yes / no?*

**7.8 — Is the existing-equipment roll-up in scope?**
*Recommendation:* **not in this workstream, but it is a real dependency.**
Sizing wants to know what is installed today, and that fact currently lives in
five places with no rule for which wins (§2c-bis). Log it; do not fold it in.
→ *Yes / no?*

---

## 8. File and DB-table index

### Database — exists and is empty unless noted
| Table / function | Note |
|---|---|
| `products` (97 cols, 33 rows) | The catalog. Carries the full NEEP column set. Tier 1 measures + Tier 2 equipment |
| `product_qualifying_equipment` (1 row) | Filter 1's junction |
| `ahri_certificates` (38 cols, 0 rows) | The certified combination |
| `ahri_equipment` (16 cols, 0 rows) | Certificate → product, with role and quantity |
| `opportunity_line_items` | `oli_is_equipment_line`, `oli_equipment_product_id` |
| `program_measure_products` (19) / `product_work_measure_map` (18) | Programme → measure → work measure |
| `price_books` / `price_book_entries` (73) | Filter 4's raw material |
| `mechanical_equipment` (85 cols, 0 rows) | **Existing** equipment in a building — not the catalog |
| `assessments` (28 rows) | Existing-system survey + the hand-typed heat-pump proposal block |
| `buildings` / `units` / `properties` | Square footage, fuel, existing system type |
| `enforce_line_item_equipment_selection()` | The rule that makes Filter 1 real |
| `list_qualifying_equipment_for_measure()` | What the picker calls |
| `create_qualifying_equipment_for_measure()` | Mints an equipment product from make+model |
| `cascade_product_equipment_requirement_to_line_items()` | Keeps flag and lines in agreement |
| `products_missing_a_measure_mapping()` | Existing gap report |

### Client
| Path | Note |
|---|---|
| `src/components/OpportunityProductsWidget.jsx` (771 lines) | **The screen this feature extends.** The Salesforce-style Opportunity Products grid, and the only equipment picker that exists. Already has the "Which equipment is being installed?" step, the Equipment column rendering manufacturer + model, and the inline "+ New equipment model" form |
| `src/data/opportunityProductsService.js` | `listAddableProducts`, `listQualifyingEquipment`, `createQualifyingEquipment`, `getOpportunityPriceBook`, `getOpportunityRebateCapStatus` |
| `src/data/ventilationSupplementalDataSheetService.js` + `src/lib/ventilationSupplementalDataSheet.js` | The first downstream consumer — prints the selected model number onto the IRA Quality Installation Supplemental Data Sheet |
| `src/data/stockService.js` | `fetchProducts` — the catalog list screens |
| `src/data/paperworkModel.js` `parseAssetScoreText` + `src/lib/homesProposal.js` `parseAssetScore` | **Two Asset Score parsers that can drift**, extracting only `euiCurrent`, `euiUpgraded`, `roofArea`, `roofRs`, persisted nowhere |
| `src/components/RecordDetail.jsx` | Mounts the widget; generic pages for `products`, `price_books`, `product_qualifying_equipment` |

### Migrations worth reading first
`20260903015923_hear_equipment_products_and_the_models_that_qualify.sql` (the
two-tier model, and why `product_assemblies` was **not** reused),
`20260903020144`, `20260903023115` (the picker offers only approved models),
`20260903035430`, `20260903043012`.

### Docs
`docs/leap-work-types.md`, `docs/leap-multifamily-energy-assessment.md`,
`docs/leap-project-record-types.md`, `docs/leap-hud-data-sources.md` (the import
pattern to copy), `docs/leap-programs.md`.

---

## 9. Open, and deliberately not decided here

- **`ahri_certificates` / `ahri_equipment` are dead schema.** Tables, sequences,
  RLS policies and one field-display registration — and nothing else. No seed,
  no INSERT, no service file, no fetcher, no FK from `products`. The AHRI number
  actually in use is the loose integer `products.product_ahri_certificate_number`.
  Phase 2 either brings them to life as the certified-combination model (which is
  what they are correctly shaped for) or retires them. **Do not leave them
  half-alive with an importer writing only the loose integer.**
- **`ENERGY STAR Electric Heat Pump for Space Heating and Cooling`
  (HEAR-HP-SPACE-HEAT-COOL) has no `product_work_measure_map` row** — already
  flagged in `docs/leap-project-record-types.md`. The single most important
  measure for this feature is not mapped to a work measure.
- **`work_measure_project_record_type_map` (WMPRT-) is specced and unbuilt**
  (`docs/leap-project-record-types.md` §3/§5). Equipment selection and project
  record types meet there; the two workstreams should be sequenced deliberately.
- **Asset Score data is parsed and never persisted**, by two separate parser
  implementations. A building's modelled performance is re-derived from a PDF
  every time a document is generated.
- Whether multi-zone systems (one outdoor unit, several indoor heads across
  several dwelling units) are selected per unit or per building. This is the
  hardest modelling question in the feature and it is a business decision.
- Whether EES maintains a **stocking / preferred-brand list** as a filter, or
  ranking only.
- Electrical service adequacy — `assessment_do_existing_electric_systems_support_hp`
  exists as free text. A real constraint on heat-pump selection, currently
  unusable as one.
- Ground-source and air-to-water are outside NEEP's current air-to-air
  specification and outside this plan.
