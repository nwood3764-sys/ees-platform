-- Help article for the System Information section every record now carries.
DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE ORDER BY user_created_at LIMIT 1;
  IF EXISTS (SELECT 1 FROM public.help_articles WHERE ha_slug='system-information-on-every-record') THEN
    RETURN;
  END IF;
  INSERT INTO public.help_articles
    (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
     ha_category, ha_audience, ha_is_published, ha_is_deleted, ha_created_by)
  VALUES (gen_random_uuid(), '', 'system-information-on-every-record',
    'System Information on every record',
    'Every record shows who created it and when, and who last changed it and when, in a System Information section on its page. The four values are written by the database and cannot be edited.',
$md$# System Information on every record

Every record in LEAP — a property, a work order, a picklist value, a saved list view, anything with a record page — carries four values under a **System Information** section:

| Field | What it tells you |
|---|---|
| **Created Date** | The date and time the record was first saved. |
| **Created By** | The person who saved it. Click the name to open their user record. |
| **Last Modified Date** | The date and time of the most recent change. |
| **Last Modified By** | The person who made that change. |

The section sits at the bottom of the record's Details tab and is collapsed by default — click the heading to open it.

## These four are written by LEAP, not by you

They are stamped by the database on every save, so they are always accurate and they cannot be edited — not from the record page, not from a list view, not by an import. That is the point: an audit trail nobody can adjust after the fact is the only kind worth having.

- **Created Date and Created By never change.** They record the moment the record came into existence and stay that way for the life of the record.
- **Last Modified Date and Last Modified By change on every save**, including edits made from a list view, from LEAP Pad in the field, or by an automation.

Because these fields are system-written, they are not asked for on the New pop-up when you create a record.

## Reading them

"Last Modified" tells you how current a record is, and who to ask about it. When Last Modified matches Created exactly, the record has never been edited since it was made.

A blank **Created By** or **Last Modified By** means LEAP genuinely does not know who it was — most often on records that came in through a data import before the person existed as a LEAP user. Blank is honest; LEAP never guesses a name.

## Recording more than the last change

System Information shows the *most recent* change. The full history — every field that changed, its old and new value, and who changed it — is in the record's **Field History** and in the audit log. System Information is the quick answer; those are the complete one.

## For administrators

The four fields are placed on **every** record page layout automatically, including layouts created later. There is nothing to configure per layout, and the fields are marked as system-audit so the record page holds them read-only wherever they appear.

Each object's audit columns are resolved by naming convention (`<object>_created_at`, `<object>_created_by`, and so on). The few objects whose columns are named differently are listed in **Record Audit Column Overrides**, where an administrator can point an object at the columns that actually hold its create and modify stamps. The two append-only system logs — the audit log and field history — are there: a row in either is written once and never modified, so the moment it was written *is* both its created and its last-modified stamp.
$md$,
    'Records', 'internal', true, false, v_owner);
END $$;
