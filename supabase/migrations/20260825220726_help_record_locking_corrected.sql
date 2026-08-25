-- HA-00171 corrected in place, not appended to.
--
-- It promised two things that were not true: that locking applied generally
-- (only enrollments had any locking statuses), and that "an administrator can
-- adjust it with no software release" (the flag was on no page layout, so
-- changing it was a database change). Both are true now, and the article also
-- has to say the thing that changed underneath it: the lock is enforced by the
-- database, so it holds on every path, not only on the record page.
UPDATE public.help_articles
   SET ha_summary = 'A record becomes read-only once its status locks it — for enrollments and incentive applications: Submitted, Approved, Denied, Withdrawn. The lock is enforced by the database on every path, and only System Administrators can edit through it.',
       ha_body_markdown = $md$# Why a record is locked (and who can unlock it)

Some records become **read-only** once they reach a certain point in their lifecycle, so work that has been submitted to a program cannot be changed behind the program's back.

## How to tell a record is locked

A locked record shows a blue **"Locked"** chip next to its status, and the **Edit** button is gone. If you try to edit it anyway, LEAP tells you the record is locked and names the status doing the locking.

## Who can edit a locked record

Only **System Administrators**, to make a correction or to move the record to a status that unlocks it. Everyone else sees it as read-only. On a locked record an administrator's chip reads **"Locked · admin can edit."**

## What locks, and when

Locking is tied to the record's **status**.

**Enrollments** lock at:

- Enrollment Submitted — Awaiting Program Response
- Enrollment Approved
- Enrollment Denied
- Enrollment Withdrawn

**Incentive applications** — including the Project Payment Request — lock at the matching four:

- Incentive Application Submitted — Awaiting Program Response
- Incentive Application Approved
- Incentive Application Denied
- Incentive Application Withdrawn

Everything earlier stays editable, and **Corrections Needed stays editable on both** — that status exists precisely so somebody can fix what the program flagged. An incentive application that is only **Pre-Approved** stays editable too, because it is still being worked.

## The lock holds everywhere, not just on the record page

The lock is enforced in the database. Hiding the Edit button is now only the polite half: a list-view inline edit, a bulk update, an import or anything else that tries to write to a locked record is refused with the same message. There is no way around it short of an administrator.

Two things are deliberately not blocked:

- **LEAP's own automation.** Roll-ups, cascades and scheduled jobs keep running, so counts and derived fields stay correct on a submitted record. The field-inheritance automation separately leaves submitted records alone, so a parent-record edit still cannot quietly alter what you submitted.
- **Administrators**, as above.

## Changing which statuses lock

Open the status value under **Setup → Picklist Values** and tick **Locks Record When Selected**. It applies immediately, to every object, with no software release — and it is the only place the rule lives, so the screen and the database can never disagree about it.
$md$,
       ha_updated_at = now()
 WHERE ha_slug = 'why-a-record-is-locked' AND ha_is_deleted IS NOT TRUE;

DO $verify$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v FROM public.help_articles
   WHERE ha_slug = 'why-a-record-is-locked' AND ha_is_deleted IS NOT TRUE
     AND ha_body_markdown LIKE '%Incentive Application Submitted%'
     AND ha_body_markdown LIKE '%enforced in the database%';
  IF v <> 1 THEN
    RAISE EXCEPTION 'HA-00171 did not take the correction';
  END IF;
END $verify$;
