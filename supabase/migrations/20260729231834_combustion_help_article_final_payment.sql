-- The Notification of Combustion Safety moved from a building record action to
-- the Final Project Payment Request package; owner info is inherited from the
-- property. Update the help article to match (idempotent).
UPDATE public.help_articles SET
  ha_summary = 'Fill in and generate the Focus on Energy Notification of Combustion Safety from the Final Project Payment Request package — a required document for WI-IRA-MF-HOMES.',
  ha_body_markdown = $md$# Notification of Combustion Safety (IRA Multifamily)

The **Notification of Combustion Safety (Large Multifamily 5+ Units)** is a Focus on Energy form required in the **WI-IRA-MF-HOMES Final Project Payment Request** package. It is completed **once per building**.

## Where it lives

Open the **project** → **Actions → Generate Final Project Payment Request Submittal**. In the package, alongside the invoices, click **Notification of Combustion Safety** to open the line editor for that project's building.

The captured results are stored as **Diagnostic Test** records (record type *Combustion Safety Notification*): one **Common Areas / Shared Equipment** row plus one row per **sampled unit**. Mechanical-ventilation results are stored on the building. Nothing is duplicated — the generated PDF renders from these records.

## How the line editor works

1. **Common Areas / Shared Equipment** — the gas-leak result and location, ambient carbon-monoxide reading, whether gas / CO detectors are installed and where, and the CO level + spillage for the shared **Heating Plant** and **Water Heater(s)**.
2. **In-Unit Equipment (Sampled)** — the building's unit count sets how many units to sample (5–9 → 4, 10–29 → 7, 30–49 → 10, 50–99 → 15, 100+ → 20). The editor seeds that many unit rows from the building's units. For each sampled unit: gas leak, ambient CO, **Furnace / Boiler** CO + spillage, **Water Heater** CO + spillage, and **Stove** CO. Add or remove sampled units as needed.
3. **Mechanical Ventilation** — Tested / Not Tested and the existing total CFM.
4. **Property Information** — owner / management company name and address, **inherited (read-only) from the property record** (HUD owner fields). To change it, update the property.

## Saving vs generating

- **Save Results** writes to the building's diagnostic-test records without producing a document.
- **Generate & Attach PDF** saves, produces the official Focus on Energy form as a PDF, downloads it, and attaches it to the **project** so it lives with the rest of the final-payment package.
$md$,
  ha_updated_at = now()
WHERE ha_slug = 'notification-of-combustion-safety';
