-- Help article for the WI-IRA-MF-HOMES-AUDIT incentive application: the fields,
-- what inherits from the enrollment, and the required documents.
DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE
   ORDER BY user_created_at LIMIT 1;

  DELETE FROM public.help_articles WHERE ha_slug = 'ira-audit-incentive-application';

  INSERT INTO public.help_articles
    (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
     ha_category, ha_audience, ha_is_published, ha_is_deleted, ha_created_by)
  VALUES (gen_random_uuid(), '', 'ira-audit-incentive-application',
    'WI-IRA-MF-HOMES-AUDIT incentive application',
    'The Wisconsin IRA multifamily audit incentive application: the fields it asks for, what it inherits from the enrollment on the same opportunity, and the documents it requires.',
$md$# WI-IRA-MF-HOMES-AUDIT incentive application

The audit application is the Focus On Energy **multifamily energy assessment incentive application**, held in LEAP as an **incentive application** whose record type is **WI-IRA-MF-HOMES-AUDIT**. Its page reads in the same sections, in the same order, as the assessment pre-approval **enrollment** — because both mirror the same program form.

## The sections

| Section | What it holds |
|---|---|
| **Application** | Opportunity, Property, Building, Record Type, Status — plus the status path. |
| **Contractor Information** | The registered contractor (a lookup to the account), the contractor's name, email and primary address read from that account, and the payment address. |
| **Property & Owner** | Property owner name (read from the property), property address(es), how the property will be modeled, property type, number of buildings, units per building. |
| **Incentive Request** | Requested incentive amount, property LEA#s, building details, estimated assessment date. |
| **Incentive Tracking** | The program's response — pre-approved date and amount, submitted date, paid date. |
| **Required Documents** *(Related tab)* | The three uploads the application requires. |
| **Supporting Documents** *(Related tab)* | Anything else filed on the application. |

## What you do not type twice

When the opportunity already carries a **WI-IRA-MF-HOMES-Assessment-Preapproval enrollment**, the application fills itself from it the moment it is created:

- Registered contractor and contractor contact
- Payment address, and whether it differs from the primary address
- Property address(es), property type, how the property will be modeled
- Number of buildings and units per building
- Requested incentive amount, property LEA#s, building details
- Estimated assessment date

Three rules govern this, and they matter:

1. **Anything you type wins.** Inheritance only fills a blank. Correcting a value on the application never fights the enrollment.
2. **It stops when the application goes out.** Once the status reaches **Incentive Application To Be Submitted** or beyond, nothing is filled or changed automatically again.
3. **Contractor and owner details are read, not stored.** The contractor's name, email and primary address come from the account record; the property owner name comes from the property. Change them there and every application shows the change.

If the opportunity has no pre-approval enrollment, nothing is inherited and every field is yours to complete — no error, no blocked save.

## Required documents

Each required upload is its own card on the **Related** tab, and each card shows **only its own file**:

- **Energy Report (PDF)** — the modeling report for the assessed building.
- **HPXMLv4 / BuildingSync File** — the machine-readable model file.
- **Signed Assessment Invoice** — the Energy Audit Invoice for this assessment, signed.

A card with nothing in it is marked **Required** and says so plainly; once a file is attached the badge reads **Attached**. Anything you upload that is not one of the three lands in **Supporting Documents**, so a file is never listed twice and nothing is hidden.

**Actions → Verify Fields** now checks both halves: it names every empty field *and* every required document still missing, so you know the application is complete before you key it into the Focus On Energy portal.

## Changing the form

The field-by-field wiring is data, not code:

- **Which fields inherit from which enrollment column** lives in *Incentive Application Enrollment Field Map* — one row per column pair, per record type.
- **The sections, labels and required documents** live on the page layout (Setup → Object Manager → Incentive Applications → Layouts), so a document the program adds is a new gallery on the layout, not a software release.

Another state's audit program inherits nothing yet: only WI-IRA-MF-HOMES-AUDIT is mapped, because NC and MI have no assessment pre-approval enrollment record type. Adding one is rows in the field map.
$md$,
    'Programs', 'internal', true, false, v_owner);
END $$;
