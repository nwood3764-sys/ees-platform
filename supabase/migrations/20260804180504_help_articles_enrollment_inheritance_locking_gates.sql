-- Bring the enrollment / pre-approval help articles up to date so the Help
-- Center AND the LEAP AI assistant (which reads published help articles via
-- help_search_articles_for_assistant) can explain how the workflow now works:
-- parent-record inheritance, the completeness gates, and status-based record
-- locking. Two existing articles are rewritten; one new article is added.

-- 1. Open Pre-Approval Application — add the completeness gate + correct sources.
UPDATE public.help_articles SET
  ha_summary = 'From a WI-IRA-MF-HOMES assessment pre-approval enrollment, open the Focus On Energy pre-approval form already filled in from the record and its parent records. LEAP checks every required field first and lists anything missing before it opens.',
  ha_body_markdown = $HA$# Open Pre-Approval Application (Focus On Energy)

The **Open Pre-Approval Application** action takes a **WI-IRA-MF-HOMES Assessment Pre-Approval** enrollment and opens the Focus On Energy multifamily pre-approval form in a new tab **already filled in from the enrollment** — so you review, attach the required documents, and submit instead of re-typing everything.

## Where it lives

Open an enrollment whose record type is **WI-IRA-MF-HOMES-Assessment-Preapproval** → **Actions** → **Open Pre-Approval Application**. The button only appears on that record type.

## It checks the record is complete first

Before it opens the form, LEAP verifies that **every required field is filled**. Those values are resolved from the enrollment *and its parent records* (property, building, and the Registered Contractor account), so a blank means the data is genuinely missing upstream — not just untyped on this screen.

If anything required is still blank, LEAP shows a **"Complete these fields before submitting"** window listing exactly what to fill and **does not open the form** — so a half-filled application is never submitted. Fill the listed fields (most fill automatically once their source record has the value), then click the button again. If it looks like the button did nothing, that completion window is why — LEAP is **asking you to complete these fields** before it will open or submit the form.

> The same completeness check runs when you move the enrollment to **Enrollment Submitted — Awaiting Program Response**: you cannot submit an incomplete application.

## What it fills

Every text box, dropdown, address block, and radio button is set from the enrollment and its related records:

- **Registered Contractor** name, email, and primary address come from the enrollment's Registered Contractor account (its billing address).
- **Payment address** uses the enrollment's payment address when *"payment address different"* is Yes; otherwise it mirrors the contractor's primary address.
- **Property Owner Name** comes from the property's owner organization.
- **Number of Buildings** is **1** — the enrollment is for one building, not the property's total.
- **Property LEA#s** comes from the building's IRA LEA confirmation code.
- **Estimated Assessment Date** comes from the building's assessment record (its *Date of IQ Assessment*).
- **Property Type**, **How the property will be modeled**, **Property Address(es)**, **Units per building**, **Requested Incentive Amount**, and **Building Details** come from the enrollment (most of which are themselves inherited — see *WI-IRA-MF-HOMES-ASSESSMENT enrollment*).

## What you still do by hand

The form's **file uploads** — the PDF energy report, the HPXML / BuildingSync file, and the signed assessment invoice — cannot be pre-filled from a link. Attach those on the form yourself, review every field, then click **Submit** on the Focus On Energy form.

## Changing what's required or mapped

The target form, the field-by-field wiring, and which fields are **required** are stored in the database (**External Form Targets** / **External Form Field Map**), not in code. An administrator can change the mapping or toggle a field's required flag with no software release.
$HA$
WHERE ha_slug = 'open-preapproval-application' AND ha_is_deleted IS NOT TRUE;

-- 2. WI-IRA-MF-HOMES-ASSESSMENT enrollment — full inheritance + locking + gates.
UPDATE public.help_articles SET
  ha_summary = 'The building-specific Wisconsin Multifamily Low Income Energy Assessment pre-approval enrollment. Nearly every field inherits automatically from the building, opportunity, property, assessment, and contractor account; the record locks once submitted; and it can''t be submitted until complete.',
  ha_body_markdown = $HA$# WI-IRA-MF-HOMES-ASSESSMENT enrollment (Low Income Energy Assessment pre-approval)

The **WI-IRA-MF-HOMES-Assessment-Preapproval** enrollment models Wisconsin's *Multifamily Low Income Energy Assessment Incentive* **pre-approval** application. One enrollment is prepared **per building** (enrollments are building-specific), then submitted to Focus On Energy with the **Open Pre-Approval Application** button.

## One enrollment per building

Every building gets its own enrollment. That is why Number of Buildings is **1**, and the LEA# and assessment date are the building's, not the whole property's.

## Almost every field fills automatically (inheritance)

You rarely type anything. When the enrollment is created and each time it is saved, LEAP fills any **blank** field from the records it is connected to (it never overwrites a value you set):

| Field | Fills from |
|---|---|
| Building | The opportunity's building |
| Property Owner Name | The property's owner organization |
| Property Address(es) | The building number + the property's city / state / ZIP |
| Property Type | The building's record type (Multifamily -> *Multifamily 4+ units*) |
| How the property will be modeled | Multifamily default: *Whole Building - DOE-2-based software* |
| Requested Incentive Amount | Multifamily default: **$2,000** |
| Building Details | Multifamily default: *Multi-Family Building Central Equipment Common Area* |
| Number of Units per Building | The building's active unit count |
| Number of Buildings | **1** (building-specific) |
| Property LEA#s | The building's IRA LEA confirmation code |
| Estimated Assessment Date | The building's **assessment** record — its *Date of IQ Assessment* (same opportunity) |
| Contractor Name / Email / Address | The Registered Contractor account (read-only here — change them on the account) |
| Registered Contractor Contact | The contractor account's primary contact |
| Payment Address | The contractor account's billing address (unless "payment address different" is Yes) |
| Status | Defaults to **Enrollment To Be Prepared** — never blank |

If a source is blank (for example the building has no assessment yet), the field stays blank until the source is filled and the enrollment is saved again.

## The name and the Status Path

- The **name** is automatic — *"&lt;Property&gt; - &lt;Building&gt; - WI-IRA-MF-HOMES-Assessment-Preapproval"*. You do not type it.
- The **Status Path** bar across the top shows the lifecycle: To Be Prepared -> To Be Verified -> Verified -> Submitted -> Approved, with Corrections Needed / Denied / Withdrawn as off-path states.

## Submitting the application

Use **Actions -> Open Pre-Approval Application** to open the Focus On Energy form pre-filled from this record. LEAP first checks every required field is present and lists anything missing — see *Open Pre-Approval Application (Focus On Energy)*.

## The record locks once submitted

When an enrollment reaches **Submitted, Approved, Denied, or Withdrawn** it **locks**: a **Locked** chip appears by the status, the Edit button disappears, and the record becomes read-only. Only a **System Administrator** can edit a locked enrollment to make a correction. Prep, To Be Verified, Verified, and **Corrections Needed** stay editable for everyone. See *Why a record is locked*.

You also cannot move an enrollment to **Submitted** until every required field is filled — the same completeness check the Open Pre-Approval Application button runs.

## Good to know

- **Property Type** and **How Will the Property Be Modeled?** are managed picklists; their options appear alphabetically.
- Contractor Name / Email / Address are read-only here (they live on the account). Change them on the contractor's account and every enrollment reads the latest values.
$HA$
WHERE ha_slug = 'wi-ira-mf-homes-assessment-enrollment' AND ha_is_deleted IS NOT TRUE;

-- 3. New article: record locking (answers "why can't I edit this record?").
INSERT INTO public.help_articles
  (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
   ha_category, ha_audience, ha_is_published, ha_is_deleted, ha_created_by)
SELECT gen_random_uuid(), '', 'why-a-record-is-locked',
  'Why a record is locked (and who can unlock it)',
  'Records become read-only once they reach a locking status (for enrollments: Submitted, Approved, Denied, Withdrawn). A Locked chip appears by the status and only System Administrators can edit them.',
$HA$# Why a record is locked (and who can unlock it)

Some records become **read-only** once they reach a certain point in their lifecycle, so finished or submitted work cannot be changed by accident.

## How to tell a record is locked

A locked record shows a blue **"Locked"** chip next to its status, and the **Edit** button is gone. If you try to edit, LEAP tells you the record is locked.

## Who can edit a locked record

Only **System Administrators** can edit a locked record — to make a correction or unlock it. Everyone else sees it as read-only. On a locked record an administrator's chip reads **"Locked · admin can edit."**

## What locks, and when

Locking is tied to the record's **status**. For **enrollments**, the locking statuses are:

- Enrollment Submitted — Awaiting Program Response
- Enrollment Approved
- Enrollment Denied
- Enrollment Withdrawn

Earlier stages — To Be Prepared, To Be Verified, and Verified — stay editable, and **Corrections Needed stays editable** so you can fix what the program flagged.

## Automatic updates stop too

LEAP's field-inheritance automation leaves a locked (submitted or later) record alone, so a bulk change or a parent-record edit can never quietly alter something you have already submitted.

## Changing which statuses lock

Which status values lock a record is a setting on the picklist value (**Locks record**), so an administrator can adjust it with no software release.
$HA$,
  'Data Management', 'internal', true, false,
  (SELECT id FROM public.users WHERE user_is_deleted IS NOT TRUE ORDER BY user_created_at LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_articles WHERE ha_slug = 'why-a-record-is-locked'
);
