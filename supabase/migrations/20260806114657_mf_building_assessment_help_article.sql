-- Help article HA-00158 — Running a Multifamily Building Energy Assessment.
-- Ships with the Phase 1 Multifamily Building Energy Assessment work order
-- (migrations 20260806113132 / 20260806113133).

INSERT INTO public.help_articles
  (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published, ha_created_by)
SELECT
  gen_random_uuid(), 'HA-00158', 'multifamily-building-energy-assessment',
  'Running a Multifamily Building Energy Assessment',
  'How to run the building-level multifamily energy assessment work order in LEAP Pad, and what each section captures for the DOE Asset Score and ASHRAE Level 2 audit.',
$md$
## What this is

The **Multifamily Building Energy Assessment** is a scheduled work order that captures a whole multifamily building's energy characteristics in one visit. It is the building-level parallel of the Single-Family Energy Assessment. Everything you record here feeds the building's **DOE Building Energy Asset Score** and its **ASHRAE Level 2** audit report.

**One work order = one building.** The assessment lives at the building level (no unit is attached). Going into individual apartments to inventory each unit is a separate tool — this work order describes the building and the *systems that serve it*.

## Starting one

Create a work order with the **Multifamily Energy Assessment** work type against the building. The 15 assessment sections are added automatically. In LEAP Pad the sections can be completed **in any order** — walk the building however is convenient.

Each section is a guided, photo-first screen flow: it opens full-screen and walks you through a photo and then each field, one prompt at a time. A section is done once its required prompts are answered.

## The sections

1. **Building Photos** — one photo of each face (front, left, right, rear).
2. **Building 360 Video** — a full-circle phone pan of the building/site.
3. **Building Geometry & Use** — use type, gross floor area, footprint length × width, number of floors, orientation, year built, total units. These are the Asset Score geometry inputs. *Footprint* is the outside dimensions of the building's outline; *orientation* is the direction the front faces.
4. **Roof / Ceiling**, 5. **Walls**, 6. **Foundation / Floor**, 7. **Windows & Doors** — the building envelope. Pick the closest construction and insulation option; exact R-values / NFRC label numbers are optional.
8. **Heating Systems**, 9. **Cooling Systems**, 10. **Distribution & Ventilation**, 11. **Service Hot Water** — the systems serving the building. Use **System Serves** to say whether it's a central plant, one system per unit, or common-areas only, then record the type, fuel, efficiency, and age. Photograph the nameplate.
12. **Common-Area Lighting** — the dominant fixture/lamp type in common areas, plus a rough estimate of typical in-unit lighting efficiency.
13. **Building Diagnostics** *(optional)* — whole-building or guarded-zone blower door, and combustion-safety readings on central/common gas appliances. Skip if no test is run.
14. **Utility & Energy Data** and 15. **Occupancy & Operating Schedules** — **back-office sections.** Fill these in from the utility bills and property records after the visit; they are not required to complete the field work. ASHRAE Level 2 needs at least 12 months of whole-building energy use for every fuel.

## Evidence and review

Photos keep their original EXIF/GPS/timestamp and are tagged with the section name. If creating the assessment also creates new records (a new owner account, property, or building), a Field Data Verification Review task is routed to a Project Coordinator to confirm the field data.

## Notes

- All the dropdown option lists are managed in LEAP Admin — if a system type, fuel, or construction option is missing, add it there.
- The System Serves / representative-type approach is deliberate: Asset Score and ASHRAE Level 2 describe the systems serving the residential space at the building level, so you record the system **type and characteristics**, not an apartment-by-apartment inventory.
$md$,
  'Field Service', 'internal', true, 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
WHERE NOT EXISTS (SELECT 1 FROM public.help_articles WHERE ha_record_number='HA-00158' OR ha_slug='multifamily-building-energy-assessment');
