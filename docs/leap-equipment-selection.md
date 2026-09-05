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

**And it is two doors onto one engine (Nicholas, 2026-09-05):** *"It can be a
standalone tool also, where the user can just put in the design loads, and
you're searching for proper equipment."* So the engine takes **numbers, not a
record** — see §4.

### The funnel — four filters, in this order

| # | Filter | Question it answers | Status today |
|---|---|---|---|
| 1 | **Programme eligibility** | Will this programme pay for this model? | ✅ **BUILT** (2026-09-03) |
| 2 | **Installation type** | Can this physically go in this building? | ❌ columns exist, vocabulary empty |
| 3 | **Sizing** | Does it carry the load at design conditions? | ❌ nothing — and no load field exists |
| 4 | **EES preference** | Do we install and stock this? | 🟡 price books exist, not linked to equipment |

Filter 1 already works and is enforced in the database. Filters 2–4 are the
build. **Filter 3 is the hard one, and it is blocked on something smaller than
it looks: LEAP has nowhere to put a design load.**

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

### 2c-bis. The ANSWER already has a hand-typed home, and two dead tables beside it

**Correction to an earlier reading of this (2026-09-05).** I first wrote that the
sizing result was "hand-typed in three objects that drift". It is not. Two of
the three — `efr_reports` and `mechanical_equipment` — hold **zero rows**, as
does `equipment_information`. They are empty Salesforce-import residue with no
writer anywhere in the codebase, not competing copies of live data. **Nicholas,
2026-09-05: "we should have deleted all that shit from our database a long time
ago, so stop referencing that."** They are out of scope for this workstream — no
part of the design reads or writes them — and retiring them is its own small,
safe change (§9), with nothing to migrate.

What is real is one block, on `assessments`:
`assessment_hp_model`, `assessment_hp_heating_capacity_btuh`,
`assessment_hp_heating_capacity_at_17_f_if_available`,
`assessment_hp_cooling_capacity_ton`, `assessment_hp_backup_heating_capacity_btuh`,
`assessment_estimated_changeover_temperature_f`,
`assessment_hp_option_with_necessary_capacity` (free text),
`assessment_can_the_hp_connect_to_existing_ductwork`,
`assessment_does_the_hp_physically_fit_the_location`,
`assessment_do_existing_electric_systems_support_hp`.

That is an auditor answering, by hand and from memory, the exact question this
engine exists to answer — with no load to derive it from and no catalog to pick
from. It is the *shape* of the output, which makes it a useful specification
and a candidate to be filled by the engine rather than typed.

**The existing-equipment survey is a genuine five-way split and does still
matter**, because sizing wants to know what is installed today:
`buildings.building_heating_equipment_*`, `assessments.assessment_heating_system_*`,
`properties.property_heating_*`, `units.unit_heating_*`, and
`work_step_field_values` keyed by `heating_*` / `mf_heating_*`.
`docs/leap-multifamily-energy-assessment.md` names `buildings` as "the natural
roll-up target" and **the roll-up is unbuilt**. Logged, not folded in (§7.8).

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
2. **`mechanical_equipment` has the identical doubling — and should be dropped,
   not cleaned.** 85 columns, **0 rows**, no writer anywhere. Do not spend a
   migration tidying columns in a table that is being retired (§9).
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

### 3c-bis. VERIFIED against the live dataset, 2026-09-05

The first cut of this plan flagged the ENERGY STAR field list as unverified,
because this sandbox's network policy blocks `data.energystar.gov`. **It was
verified anyway — the sandbox is blocked, Postgres is not.** The `http`
extension on prod calls the Socrata API server-side, the same route the
assistant self-test uses. Set `http_set_curlopt('CURLOPT_TIMEOUT','30')` in the
same statement batch; the default 5 s is too short.

**`GET data.energystar.gov/resource/w7cv-9xjt.json` returns 200 and carries
everything the sizing engine needs.** Real row, verbatim keys:

```
ahri_reference_number            214602071        <- the join key to AHRI and NEEP
outdoor_unit_brand_name          1HVAC            energy_star_partner   1HVAC Energy, LLC
model_number                     ACIQ-12-EHPB     series_name           ACIQ Series
indoor_unit_model_number         ACIQ-12-AHB      indoor_unit_brand_name
product_type                     HP - Split System | HP - Mini or Multi Split | HP - Single Package
cold_climate                     Yes | No         meets_peak_cooling_requirements  Yes
compressor_staging               Continuously variable
seer2_btu_wh  17.50   eer2_btu_wh  11.70   hspf2_btu_wh  9.00
cooling_capacity_btu_h           12000
heating_capacity_at_47_f_btu_h   13000
heating_capacity_at_17_f_btu_h   12000
heating_capacity_at_5_f_btu_h    11000
cop_at_5_f                       2.60
refrigerant_with_gwp             R-410A (GWP:2088)
date_certified  date_available_on_market  markets  meets_most_efficient_criteria
pd_id  manufacturer_type  energy_star_model_identifier  connected_capability
```

**Capacity and COP at 17 °F and 5 °F are published.** That was the one finding
that could have invalidated the phasing and forced a paid AHRI subscription. It
does not. **§7.1 stands, verified rather than assumed.**

**Mapping onto `products` is close to 1:1** — `heating_capacity_at_47_f_btu_h` →
`product_heating_capacity_47f`, and so on through `_17f`, `_5f`, `cop_at_5_f` →
`product_heating_cop_5f`, `cooling_capacity_btu_h` → `product_cooling_capacity_95f`,
`seer2_btu_wh`/`eer2_btu_wh` → `product_seer2`/`product_eer2`,
`ahri_reference_number` → `product_ahri_certificate_number`,
`model_number` → `product_model_number`, `series_name` → `product_series_name`,
`cold_climate` → `product_energy_star_v6_1_cold_climate`,
`compressor_staging` → `product_variable_capacity`,
`product_type` → `product_ducting_configuration`.

**Five real gaps, each of which must be a deliberate decision, not a silent NULL:**
1. **One `hspf2_btu_wh`, not the Region IV / Region V pair.** LEAP has both
   columns; this source fills one. Decide which (Region IV is the standard
   rating) and leave the other explicitly empty rather than duplicating.
2. **One capacity per temperature, not NEEP's min / rated / max grid.** On the
   first mini-split sampled, 5 °F capacity (8,000) *exceeds* 47 °F (7,100) —
   that is a boosted **maximum**, not a rated figure. For sizing this is the
   right number to check a design heating load against, but it must be **stored
   and labelled as maximum**, or someone will later average it with a rated
   value and get a smaller machine than the building needs.
3. **`refrigerant_with_gwp` is one string** — `R-410A (GWP:2088)`. Parse into
   refrigerant and GWP; do not store the composite in a picklist.
4. **`product_ducting_configuration` has no direct field**; `product_type`
   carries it at three values. LEAP's picklist should be seeded to those three
   plus whatever the PTHP dataset uses — not invented.
5. **No PTHP / PTAC in this dataset.** That is a separate ENERGY STAR product
   list and has not yet been located; multifamily needs it (PRD-00035 "High
   Efficiency PTAC Replacement" is already a measure). **Find it before Phase 2
   is scoped as complete.**

### 3c-ter. The row count is 281,975 — and 22 of every 23 rows are the same machine

**This is the single most important number in the plan, and it changes the
scoping answer.** Measured live:

| Slice | Rows | Distinct outdoor models |
|---|---|---|
| Everything | **281,975** | — (279 brands, 281,539 distinct AHRI refs) |
| `cold_climate = Yes` | **146,238** | **6,662** (+ 8,691 indoor models) |
| `cold_climate = Yes`, mini/multi split + single package | **15,479** | **5,116** |

**An AHRI reference number is a certified COMBINATION, so a ducted outdoor unit
appears once per matched indoor coil.** 146,238 cold-climate rows resolve to
6,662 real outdoor units — **a 22:1 explosion**, and it is almost entirely
ducted split systems. Ductless barely explodes at all (15,479 rows over 5,116
models, ~3:1) because a mini-split head has few permutations.

The brand list makes it concrete: the seven largest cold-climate "brands" are
**Airquest, Tempstar, Arcoaire, Heil, Comfortmaker, Day & Night and Keeprite —
about 9,030 rows each, ~63,000 rows of rebadges of one manufacturer's line.**
An auditor choosing between Airquest and Tempstar is choosing between two
stickers on the same box.

**Which is why the dormant `ahri_certificates` + `ahri_equipment` pair is not
optional — it is the whole answer to "how do we not drown."**
- `ahri_certificates` = one row per certified combination.
- `products` = one row per distinct MODEL — 6,662 outdoor, 8,691 indoor, not 146,238.
- `ahri_equipment` = the junction, with `ae_equipment_role`.

Writing one product per AHRI row would put 146,000 rows in the catalogue an
auditor picks from, most of them duplicates. **Do not flatten the combination
into the product.**

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

### The workflow boundary — three things, three homes, no mixing

Nicholas asked directly whether this mixes workflow. It does not, provided the
three responsibilities stay separated:

| Step | Where it lives | Owner |
|---|---|---|
| **Produce the loads** | the **assessment** record | a separate workstream, already in flight |
| **Turn loads into candidates** | `size_equipment_candidates(...)` — a function over NUMBERS | this workstream |
| **Record the choice** | `opportunity_line_items.oli_equipment_product_id` | already built, already enforced |

**The engine never writes anything.** It takes design loads, design
temperatures, an installation type and (optionally) a measure, and returns a
ranked list with its reasoning. That is what makes both front doors possible off
one definition:

- **Door 1 — the standalone Equipment Sizing tool.** Type the design heating
  load, the design cooling load and the winter design temperature; get the
  ranked models. No opportunity, no assessment, no property, nothing saved. An
  auditor sizing something on the phone, or checking a contractor's proposal.
- **Door 2 — the opportunity line item.** The same call, with every argument
  **pre-filled** from the assessment and the building, launched from the
  equipment step that `OpportunityProductsWidget` already renders. The chosen
  model lands in `oli_equipment_product_id`, which
  `enforce_line_item_equipment_selection()` already validates against the
  measure's approved list.

Door 2 is Door 1 with the inputs filled in. If the engine ever needs a record id
to do its job, that is the sign the two have been mixed.

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
5. **Do not rebuild the weather database, and do not build a second home for
   the load.** Conduit Tech already uses ASHRAE 2021 design data and is
   ACCA-approved ("Powered by ACCA Manual J")
   ([Conduit Tech](https://getconduit.com/)), so LEAP captures the design
   temperatures and the weather station **from the Manual J that computed
   them** — keeping the numbers on the proposal identical to the numbers on the
   load calculation, which is what a programme reviewer checks. **Those fields
   go on the ASSESSMENT record** (Nicholas, 2026-09-05 — a separate session is
   adding them). This workstream **reads** them and must not invent its own.
6. **One catalog, and one place the choice is recorded.** Equipment is
   `products` on an equipment record type — never a second equipment table. The
   selection is `opportunity_line_items.oli_equipment_product_id` — never a
   second selection record.

---

## 5. Phased build plan

Each phase is additive and independently shippable.

### Phase 0 — clear the ground (small, do it first)
- Retire the duplicate legacy text columns on `products` (§2d.1). Verify each is
  empty first; migrate any value into the numeric column; drop or mark
  deprecated in one migration with a fixture pinning that nothing reads them.
  **`mechanical_equipment` is not cleaned — it is retired** (§9), so its
  duplicates cost nothing.
- Seed the picklists for `product_ducting_configuration`,
  `product_variable_capacity`, `product_equipment_category`,
  `product_refrigerant_type` — **using NEEP's own vocabulary**, so an ingested
  value never needs translating.
- **Decide §7.1 (data source) before writing any importer.**

### Phase 1 — read the load off the assessment  *(dependency, not this workstream's build)*
**DECIDED 2026-09-05 (Nicholas): the design load goes on the ASSESSMENT record,
and a separate session is adding it.** This workstream does not design a
`load_calculations` object and must not add competing columns.
- What this workstream owes Phase 1 is a **contract, not a table**: name the
  fields the engine reads — design heating load Btu/h, design cooling load
  Btu/h (sensible and latent), winter 99 % design dry bulb, summer 1 % design
  dry bulb, weather station, conditioned floor area, and the source Manual J
  PDF as the evidence artifact. Agree those column names with the other session
  before either side writes code; a mismatch here is the one thing that makes
  both efforts useless.
- Today `assessments` carries **none** of them — verified 2026-09-05, every
  column searched. The nearest things are `assessment_output_rated_heating_capacity_btuh`
  (a nameplate rating, not a load) and `assessment_hp_backup_heating_capacity_btuh`.
- The engine reads them and **never writes them**. The standalone tool takes the
  same numbers by hand, which is what proves the engine is record-independent.

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
- **Scope by CATEGORY first — it does almost all the work.** Cold-climate mini
  or multi split + single package is **15,479 rows over 5,116 models** (§3c-ter),
  which is nothing. That one filter takes the multifamily catalogue from 282,000
  to 15,000 without naming a single brand, and it is principled rather than
  arbitrary: cold-climate certification is a programme requirement for this work
  anyway.
- **A manufacturer list is a legitimate second cut, and it is the right one for
  DUCTED split systems** — 130,759 cold-climate rows, seven rebadged brands of
  one manufacturer's line accounting for ~63,000 of them. If EES starts doing
  ducted retrofits, name the manufacturers; do not ingest 130,000 rows of
  stickers. **Correcting the first cut of this plan, which argued against
  manufacturer limiting on the grounds that volume is cheap:** the objection was
  never storage, and the first cut had the row count wrong by 7x. 22 rows per
  real machine is noise whatever it costs to store.
- **Wherever the line is drawn, record it as DATA an admin edits** (an
  `is_preferred` flag or an `equipment_preferred_manufacturers` row set), not as
  a constant in an importer — so widening it later is a row, not a deploy, and
  so the reason a model is absent is answerable.
- Categories in scope: the three equipment record types that already exist
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

### Phase 4 — the two screens, off one engine
- **The standalone Equipment Sizing tool** first, because it is the honest test
  of the engine: three numbers in, ranked models out, nothing saved. If it needs
  a record to work, the separation in §4 has already been broken.
- **Then the opportunity line item.** The equipment step in
  `OpportunityProductsWidget` already exists and already lists approved models;
  this adds the loads, the sizing verdict per model and the ranking — the sized
  list is an **annotation and ordering of the eligible list**, never a
  replacement for `enforce_line_item_equipment_selection()`'s rule.
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

## 7. Decisions — marked DECIDED with date and owner as they are confirmed

**7.1 — Where does the equipment data come from?**
**DECIDED 2026-09-05, Nicholas: ENERGY STAR — and VERIFIED the same day against
the live dataset (§3c-bis), not assumed.** Ingest EPA ENERGY STAR open data
(free, documented Socrata API, licensed for reuse), key on the AHRI Certified
Reference Number, deep-link to NEEP per model for the human. **Not** scraping
ashp.neep.org. It **does** publish capacity at 47/17/5 °F and COP at
5 °F, which was the one finding that could have forced a paid AHRI subscription.
No subscription is needed.

**7.2 — Where does the design load live?**
**DECIDED 2026-09-05, Nicholas: on the ASSESSMENT record**, being added by a
separate session. This workstream reads it and adds no competing columns
(§Phase 1). Supersedes the earlier `load_calculations` proposal.

**7.3 — Which equipment categories are in scope for round one?**
*Recommendation:* the three equipment record types that already exist — heat
pump, ventilation, furnace — **plus PTHP**, since multifamily PTAC replacement
is already a measure being sold. Water heaters, appliances and electrical get a
category when someone installs one.
→ *Yes / no?*

**7.4 — Does the engine ever auto-select?**
*Recommendation:* **no.** It ranks and explains; a person picks. An
auto-selected heat pump that cannot heat the building at design conditions is a
callback, a warranty claim, and a failed programme inspection.
→ *Yes / no?*

**7.5 — Where does the Manual J come from on day one?**
*Recommendation:* **typed in from the Conduit Tech report, with the PDF attached
as the evidence artifact.** A Conduit integration is real work and should not
gate the sizing engine, which is the part with the value. (The field names are
the other session's; this is about the source, not the schema.)
→ *Yes / no?*

**7.6 — Do Phase 0's duplicate-column cleanups ship first, on their own?**
*Recommendation:* **yes.** Small, free while the tables are empty, and ingesting
tens of thousands of rows into a table that stores capacity twice makes the
ambiguity permanent.
→ *Yes / no?*

**7.7 — Does the sizing result get its own record?**
**DECIDED 2026-09-05, Nicholas: NO.** *"The equipment selection is going to go
on the opportunity line item when we select the product."* The choice is
`opportunity_line_items.oli_equipment_product_id` — the column that already
exists and is already enforced. No `equipment_selections` object; the earlier
proposal for one is withdrawn. Whether the engine also fills the assessment's
`assessment_hp_*` block, or that block is retired once the line item is
authoritative, is a smaller follow-up question.

**7.8 — Is the existing-equipment roll-up in scope?**
*Recommendation:* **no, but it is a real dependency.** Sizing wants to know what
is installed today, and that fact lives in five places with no rule for which
wins (§2c-bis). Log it; do not fold it in.
→ *Yes / no?*

**7.9 — Manufacturer scope on the import.**
*Recommendation, revised after measuring the real dataset (§3c-ter):* **cut by
CATEGORY first, and yes, cut ducted split systems by manufacturer.** Cold-climate
ductless + single package is 15,479 rows over 5,116 models and needs no brand
filter at all. Ducted split is 130,759 rows in which seven rebadged brands of one
manufacturer's line account for ~63,000 — there, Nicholas's instinct to limit by
manufacturer is correct and this plan's first cut was wrong to push back on it.
Either way the list is stored as data an admin edits, never as a constant in the
importer.
→ *Yes / no?*

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
| `mechanical_equipment` (85 cols, **0 rows**) | Dead Salesforce-import residue, no writer — to be retired, not used |
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
- **Three empty tables should be retired, and it is safe: `efr_reports`,
  `mechanical_equipment` and `equipment_information` all hold ZERO rows** and
  have no writer anywhere in the codebase (Salesforce-import residue). Nicholas
  has said they should be gone. Nothing to migrate — but it is a schema deletion
  and therefore its own small, deliberate change, not a side effect of this
  workstream.
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
