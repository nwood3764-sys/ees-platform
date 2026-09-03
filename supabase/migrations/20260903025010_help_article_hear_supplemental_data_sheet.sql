-- The HEAR Quality Installation Supplemental Data Sheet — help article.
--
-- Written in the same session as the feature, per the ship cycle. It documents
-- the two-tier product catalogue as well as the sheet, because 'where does the
-- model number come from' is the question this whole build answers and the
-- answer is not guessable from the screens alone.

INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_category, ha_audience,
  ha_is_published, ha_body_markdown, ha_created_by
)
SELECT '', 'hear-supplemental-data-sheet',
  'The HEAR Quality Installation Supplemental Data Sheet',
  'How the per-unit model-number spreadsheet is produced for a WI IRA MF HEAR Project Reservation, and where the fan model comes from.',
  'Enrollments', 'internal', true,
$md$
# The HEAR Quality Installation Supplemental Data Sheet

The IRA Home Energy Rebates programme wants a spreadsheet listing **every dwelling unit and the model installed in it**. LEAP produces it on the programme administrator's own workbook, so what you send is their form — their columns, their wording, and their Measure Type dropdown.

## When it is produced

It is generated **automatically the moment a `WI-IRA-MF-HEAR-Project-Reservation` enrollment is created**. You do not have to ask for it. It lands on the enrollment's Documents card, named for the building and the enrollment, e.g.

`570_South_Clark_Street_ENR_00077_Quality_Installation_Supplemental_Data_Sheet.xlsx`

No other enrollment record type produces one. A HOMES Project Reservation sells modelled savings, not equipment, and has no model numbers to report.

## Where each column comes from

| Column | Source |
| --- | --- |
| Building Name (optional) | The property's **AKA name** ("GREEN VALLEY ESTATES"). Left empty if there isn't one — the address is already in the next column. |
| Street Address | The building's address plus the unit, as `570 South Clark Street - Unit 1`. |
| Unit Number | The unit's own number. |
| Measure Type | Derived from the equipment's product record type. Ventilation today. |
| Model Number | The **Equipment Installed** on the opportunity's line item — manufacturer plus model, e.g. `Panasonic FV-0511VF1`. |
| Serial Number | `N/A` for a bath fan. |
| AHRI Number | `N/A` for ventilation. |
| City / State / Zip | The building's. |

**One row per dwelling unit.** A building's Attic, Mechanical Room, Common Area, Hallway and Office unit records are not dwellings and get no row. If a building has 8 dwelling units, the sheet has 8 rows.

## Where the model number comes from

The product on a HEAR line item — "ENERGY STAR Ventilation" — is the **rebate**, not the fan. It has no model number, because the programme pays the same for any approved model.

So the catalogue has two tiers:

- **Incentive measures** (record type *Product*) — what the programme pays for. `HEAR-VENT`, `HEAR-HPWH`, and so on.
- **Equipment** (record types *Ventilation Equipment*, *Heat Pump Equipment*, *Furnace Equipment*) — the real thing you install, carrying manufacturer, model number, AHRI certificate, and its supporting documents.

Open the measure's product record (Stock → Products) and its **Related** tab carries a **Qualifying Equipment** section:

- **Approved Equipment Models** — on a measure, the models you may install to claim it. Add a row here when a new fan is approved.
- **Qualifies For These Measures** — on an equipment product, read the same links from the other end. A model can qualify under more than one programme.

A measure only demands an equipment selection when its **Requires Equipment Selection** checkbox is ticked, on the product record. That is how a new measure joins this rule — a checkbox, not a code change.

### Choosing it on the opportunity

When you add a HEAR line item, the **Equipment Installed** field appears beneath Product. It offers **only the models approved for that measure** — pick one and save. This is required: a ventilation or heat-pump line will not save without it, and the error names the measure and lists the approved models.

Lines that install nothing model-numbered — Electrical Wiring, a Load Service Center, insulation, air sealing — do not ask for equipment and will refuse one if you try.

The HEAR opportunity also carries an **Equipment** section listing exactly the lines that install equipment, with the measure, the model, the quantity and the unit. That is the fastest way to see whether anything is still unselected.

### Different models in different units

Most jobs put one model in every unit — leave the line item's Unit empty and it covers the whole building. If three units get a different fan, add a **second line item** for that measure, set its **Unit**, and pick the other model. The unit-scoped line wins for that unit.

If two building-wide lines name different models and nothing says which unit gets which, the sheet leaves those Model Number cells **empty** and tells you why rather than guessing.

## Regenerating

The sheet is a snapshot. Anything that changes afterwards — a unit added to the building, the fan finally chosen, a model corrected — means the filed sheet is stale.

**Actions → Regenerate Supplemental Data Sheet** rebuilds it from current data and files a new copy. The earlier one stays on the record, so what you already submitted is still there.

Regenerating also copies the equipment product's **supporting documents** — submittal sheet, ENERGY STAR certification — onto the enrollment, so the filing packet is complete in one place. Upload those to the product record once and every enrollment that installs it picks them up. They are copied, not linked: if a manufacturer revises a spec sheet next year, what you filed stays what you filed.

## When something is missing

The sheet is always produced, and it tells you what is incomplete rather than quietly filing a short one. You will see a message naming the problem:

- **"No ventilation equipment is recorded on the opportunity"** — the Model Number column is empty. Select the Equipment Installed on the line item, then regenerate.
- **"This building has no unit records in LEAP"** — the sheet has no rows. Add the units to the building first.
- **"…none is typed as a Dwelling Unit"** — the units exist but are all common areas. Check their record types.
- **"…for a measure this sheet does not cover yet"** — heat-pump and furnace lines are recognised but not yet printed on this sheet. Only Ventilation is built.

An empty Model Number is never filled with a guess. A wrong model number on a quality-installation filing is worse than a visible gap.

## What is not built yet

Heat pumps and furnaces have product record types and can be linked to their measures, but the sheet does not yet print rows for them — a heat pump is *Heating*, *Cooling*, or both depending on what it replaced, and that is a programme question still to be answered. Ventilation is the only measure the sheet currently covers.
$md$,
  (SELECT ha_created_by FROM public.help_articles WHERE ha_slug = 'service-appointments-list-view')
WHERE NOT EXISTS (SELECT 1 FROM public.help_articles WHERE ha_slug = 'hear-supplemental-data-sheet');
