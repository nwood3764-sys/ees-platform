-- Help article for the "Open Pre-Approval Application" enrollment action.
DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE ORDER BY user_created_at LIMIT 1;
  IF EXISTS (SELECT 1 FROM public.help_articles WHERE ha_slug='open-preapproval-application') THEN
    RETURN;
  END IF;
  INSERT INTO public.help_articles
    (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
     ha_category, ha_audience, ha_is_published, ha_is_deleted, ha_created_by)
  VALUES (gen_random_uuid(), '', 'open-preapproval-application',
    'Open Pre-Approval Application (Focus On Energy)',
    'From a WI-IRA-MF-HOMES assessment pre-approval enrollment, open the Focus On Energy pre-approval form already filled in from the record — review, attach documents, and submit.',
$md$# Open Pre-Approval Application (Focus On Energy)

The **Open Pre-Approval Application** action takes a **WI-IRA-MF-HOMES Assessment Pre-Approval** enrollment and opens the Focus On Energy multifamily pre-approval form in a new tab **already filled in from the enrollment** — so you review, attach the required documents, and submit instead of re-typing everything.

## Where it lives

Open an enrollment whose record type is **WI-IRA-MF-HOMES-Assessment-Preapproval** → **Actions** → **Open Pre-Approval Application**. The button only appears on that record type.

## What it fills

Every text box, dropdown, address block, and radio button on the form is set from the enrollment and its related records:

- **Registered Contractor** name, email, and primary address come from the enrollment's **Registered Contractor** account (its billing address).
- **Payment address** uses the enrollment's payment address when *"payment address different"* is Yes; otherwise it mirrors the contractor's primary address.
- **Property Owner Name** comes from the property's HUD owner organization; **Number of Buildings** from the property.
- **Property Type**, **How the property will be modeled**, **Property Address(es)**, **Units per building**, **Requested Incentive Amount**, **Property LEA#s**, **Building Details**, and **Estimated Assessment Date** come from the enrollment.

A field that is blank on the enrollment is simply left blank on the form for you to complete.

## What you still do by hand

The form's **file uploads** — the PDF energy report, the HPXML / BuildingSync file, and the signed assessment invoice — cannot be pre-filled from a link. Attach those on the form yourself, review every field, then click **Submit** on the Focus On Energy form.

## Changing the mapping

The target form and the field-by-field wiring are stored in the database (**External Form Targets** / **External Form Field Map**), not in code. If Focus On Energy changes a field, an administrator updates the matching row — no software release is needed. Adding another program's form (for example a single-family or payment application) is a new target row plus its field map.
$md$,
    'Programs', 'internal', true, false, v_owner);
END $$;
