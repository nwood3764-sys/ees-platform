-- HA-00192 rewritten against the live form. The version published an hour
-- earlier described form 6324680's fields and named three uploads that form
-- asks for and this one does not.
DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE
   ORDER BY user_created_at LIMIT 1;

  UPDATE public.help_articles SET
    ha_summary = 'The Wisconsin IRA multifamily audit incentive application, section for section against the live Focus On Energy form: what it asks, what it inherits from the enrollment on the same opportunity, and the three files it requires.',
    ha_body_markdown = $md$# WI-IRA-MF-HOMES-AUDIT incentive application

The audit application is the Focus On Energy **IRA assessment application**, held in LEAP as an **incentive application** whose record type is **WI-IRA-MF-HOMES-AUDIT**. Its page is laid out section for section against the live form, so you fill the record top to bottom and then key it across.

## The sections

| Section | What it asks |
|---|---|
| **Application** | The LEAP record itself — Opportunity, Property, Building, Record Type, Status, and the status path. Not part of the program form. |
| **Application Information** | How was the building modeled? (Single Family Attached / Single Family Detached / Multifamily) · Requesting incentives for more than one property or unit owned by the same person or entity? |
| **Assessment Details — Individual Multifamily Building** | Property Owner Name · Building Name · Assessment Address · How many units are in the building? · What modeling software was used? (BPI-2400 / DOE-2-based software) · IRA Income Code · Assessment Date · Assessment Cost · Requested Incentive Amount · Building Improvements |
| **Assessor Information** | Registered Contractor business name · Office Address · Payment Address · Phone · Email |
| **Additional Information** | Will the customer be moving forward with a HOMES project? (Yes/No/Unknown) · Additional Comments |
| **Terms and Conditions and Signature** | The five attestations and the typed first and last name |
| **Incentive Tracking** | The program's response — pre-approved date and amount, submitted date, paid date. LEAP's own tracking, not on the form. |
| **Required Documents** *(Related tab)* | Asset Score · BuildingSync File · Invoice |

Two of the form's rules are worth remembering as you fill it in: the **requested incentive cannot exceed the assessment cost**, and the **Assessment Date is the date shown on the energy assessment report** — not the date you booked the visit.

## What you do not type twice

**Read from the related record, always current.** Property Owner Name comes from the property. Building Name and the Assessment Address (line 1, city, state, ZIP) come from the building. The assessor's business name, office address, phone and email come from the Registered Contractor account. Change any of them on the source record and every application shows the change. Only the address's second line is the application's own field — buildings carry no line 2.

**Filled from the enrollment on the same opportunity.** When the opportunity carries a **WI-IRA-MF-HOMES-Assessment-Preapproval enrollment**, the application fills itself from it the moment it is created:

- Registered Contractor and contractor contact
- Payment address (street, city, state, ZIP)
- How the building was modeled, and which modeling software was used
- How many units are in the building
- IRA Income Code, Assessment Date, Requested Incentive Amount

Two of those are **narrowed**, not copied: the enrollment records *Multifamily 2-3 units* or *Multifamily 4+ units*, and the form only offers **Multifamily**; the enrollment records *Whole Building — BPI 2400* or *Individual Units — BPI 2400*, and the form only offers **BPI-2400**. LEAP translates them rather than leaving the field blank.

Three rules govern all of it:

1. **Anything you type wins.** Inheritance only fills a blank, so correcting the application never fights the enrollment.
2. **It stops when the application goes out.** At **Incentive Application To Be Submitted** and beyond, nothing is filled or changed automatically again.
3. **No enrollment, no problem.** If the opportunity has no pre-approval enrollment, nothing is inherited and every field is yours — no error, no blocked save.

Never inherited, because the form asks for facts the enrollment does not hold: **Assessment Cost**, **Building Improvements**, the HOMES follow-up question, the more-than-one-property question, the attestations and the signature.

## Required documents

Each is its own card on the **Related** tab, showing only its own file:

- **Asset Score** — a PDF of the asset score. An audit template is *not* required.
- **BuildingSync File** — an `.xml` or `.html` file.
- **Invoice** — must follow IRA Home Energy Rebate invoicing requirements. PDF or image only.

A card with nothing in it is badged **Required**; once a file is attached it reads **Attached**. Anything else you upload lands in **Supporting Documents**, so a file is never listed twice.

**Actions → Verify Fields** checks both halves — every empty field *and* every required document still missing — so you know the application is complete before you key it into the Focus On Energy portal.

## Worth confirming

**IRA Income Code** is inherited from the enrollment's Property LEA#s, which LEAP takes from the building's IRA confirmation code (LEA). If the program means a different code by "IRA Income Code", clear that mapping in *Incentive Application Enrollment Field Map* and enter the code by hand.

## Changing the form

The wiring is data, not code. Which fields inherit from which enrollment column — and how a value translates — lives in *Incentive Application Enrollment Field Map*, one row per column pair. The sections, labels and required documents live on the page layout, so a question the program adds is a layout edit, not a software release.

Only WI-IRA-MF-HOMES-AUDIT is mapped. NC and MI carry audit application record types but have no assessment pre-approval enrollment to inherit from; adding one is rows in the field map.
$md$,
    ha_updated_at = now()
  WHERE ha_slug = 'ira-audit-incentive-application';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Help article ira-audit-incentive-application not found';
  END IF;
END $$;
