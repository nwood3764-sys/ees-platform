-- Help article for the Notification of Combustion Safety line editor + generation.
DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE ORDER BY user_created_at LIMIT 1;
  IF EXISTS (SELECT 1 FROM public.help_articles WHERE ha_slug='notification-of-combustion-safety') THEN
    RETURN;
  END IF;
  INSERT INTO public.help_articles
    (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
     ha_category, ha_audience, ha_is_published, ha_is_deleted, ha_created_by)
  VALUES (gen_random_uuid(), '', 'notification-of-combustion-safety',
    'Notification of Combustion Safety (IRA Multifamily)',
    'Fill in and generate the Focus on Energy Notification of Combustion Safety from a building record — a required document for the WI-IRA-MF-HOMES Final Project Payment Request.',
$md$# Notification of Combustion Safety (IRA Multifamily)

The **Notification of Combustion Safety (Large Multifamily 5+ Units)** is a Focus on Energy form that must accompany the **WI-IRA-MF-HOMES Final Project Payment Request**. It is completed **once per building**.

## Where it lives

Open a **building** record → **Actions** → **Notification of Combustion Safety**. The form is per building, so it is filled in from the building — not from the project.

The captured results are stored as **Diagnostic Test** records (record type *Combustion Safety Notification*): one **Common Areas / Shared Equipment** row plus one row per **sampled unit**. Mechanical-ventilation results are stored on the building. Nothing is duplicated — the generated PDF renders from these records.

## How the line editor works

1. **Common Areas / Shared Equipment** — record the gas-leak result and location, ambient carbon-monoxide reading, whether gas / CO detectors are installed, and the CO level + spillage for the shared **Heating Plant** and **Water Heater(s)**.
2. **In-Unit Equipment (Sampled)** — the building's unit count sets how many units to sample (5–9 → 4, 10–29 → 7, 30–49 → 10, 50–99 → 15, 100+ → 20). The editor seeds that many unit rows from the building's units. For each sampled unit, record gas leak, ambient CO, **Furnace / Boiler** CO + spillage, **Water Heater** CO + spillage, and **Stove** CO. Add or remove sampled units as needed.
3. **Mechanical Ventilation** — Tested / Not Tested and the existing total CFM.
4. **Property Information** — owner / management company name and address (prefilled from the property's account; editable).

## Saving vs generating

- **Save Results** writes everything to the building's diagnostic-test records without producing a document — use it to capture field results as you go.
- **Generate & Attach PDF** saves, produces the official Focus on Energy form as a PDF, downloads it, and attaches it to the building's documents.

## Capture-once

If combustion data was captured during the assessment (the *Diagnostic Tests* work step), that data belongs to the same diagnostic-test system of record. The line editor is where the building-level and sampling results are consolidated and the final notification is produced for the payment package.
$md$,
    'Programs', 'internal', true, false, v_owner);
END $$;
