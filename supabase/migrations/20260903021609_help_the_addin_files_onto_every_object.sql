-- =============================================================================
-- Help: HA-00154 no longer lists six objects.
--
-- Corrected in place. The article's "What you can log an email to" section was
-- a hand-typed copy of the same six-object list the code carried; a reader
-- looking for enrollments would have been told, in writing, that it is not
-- possible.
-- =============================================================================

UPDATE public.help_articles SET
  ha_summary = 'Install the LEAP "Log to LEAP" Outlook add-in, then log any open email — with attachments — onto any record that carries a Communications card, Salesforce-style.',
  ha_body_markdown = replace(
    ha_body_markdown,
    '## What you can log an email to

- Opportunity
- Property
- Account
- Contact
- Project
- Work Order',
    '## What you can log an email to

Every record that carries a **Communications** card — which is every object a
conversation can be anchored to:

- Account
- Assessment
- Building
- Contact
- Enrollment
- Incentive
- Opportunity
- Project
- Property
- Service Appointment
- Unit
- Work Order

The **Log to** list is read from LEAP itself each time the pane opens, so it is
never out of date: an object that gains a Communications card appears in the
add-in the same day, and one that cannot hold a thread is never offered.'
  )
WHERE ha_record_number = 'HA-00154';

DO $do$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.help_articles
   WHERE ha_record_number = 'HA-00154' AND ha_body_markdown LIKE '%- Enrollment%'
     AND ha_body_markdown LIKE '%- Incentive%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'HA-00154 still tells the reader they can file onto six objects';
  END IF;
END
$do$;
