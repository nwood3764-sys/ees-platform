-- Help: contractor contact details come from the contact you select.
--
-- Written for the one thing the screen cannot explain on its own: why the
-- email beside a contractor's name used to be the shared program mailbox and
-- never changed, and what now decides who appears there.

INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_category, ha_audience,
  ha_is_published, ha_body_markdown
)
SELECT '', 'contractor-contact-and-email',
  'Contractor Email and Phone Follow the Contact You Select',
  'On a Project Reservation or a Project Payment Request, the contractor''s email and phone are read from the contact selected beside them — and that contact follows the contractor account.',
  'Records', 'internal', true,
$md$## The short version

Every contractor block on a program form — **Primary Contractor** and **Support Contractor**, on the Project Reservation enrollment and on the WI / NC / MI Project Payment Request — asks for two things:

1. the contractor **company** (an account), and
2. the **person** at that company (a contact).

Everything else in the block is read live from those two records. **Business name and address come from the account. Email and phone come from the contact.** Nothing is typed in and nothing is copied, so correcting a phone number on someone's contact record corrects it on every form that names them.

## Why the email used to look wrong

Contractor **Email** used to be read from the *account* instead of the contact. So a block could say "Support Contractor Contact Name: Brittin Wood" and, directly underneath, "Support Contractor Email: ira@EES-WI.org" — the shared program mailbox — and choosing a different contact changed nothing. The phone number had already been moved onto the contact; the email had been left behind. It now reads the contact, like the phone.

## Who fills the contact in

When you pick a contractor company, LEAP fills the contact from that company's own **Account Contact** — the field on the account record. Set the Account Contact once and every new form for that contractor names the right person.

Two consequences worth knowing:

- **Change the contractor company and the contact moves with it.** A form can never be left showing a person from the company you just replaced. If you switch the support contractor from Energy Efficiency Services of Wisconsin to Sealed Inc, the contact becomes Sealed Inc's Account Contact, and the email and phone follow.
- **Clear the contractor company and the contact clears too.** A contractor contact with no contractor represents nobody.

You can always choose a different person — the contact picker is right there, and your choice is kept.

## Which people the picker offers

The contact picker offers everyone at the contractor account, **plus everyone at its parent companies**, plus anyone linked to it through a contact relationship. That is deliberate: Energy Efficiency Services of Wisconsin is a child of Energy Efficiency Services, and a person on the parent record can legitimately represent the Wisconsin entity on a form.

A contact from an **unrelated** company is not offered, and if one somehow ends up stored — an import, or a company changed after the fact — it is replaced with the account's own Account Contact the next time the record is saved.

## If the email or phone is blank

The contact record does not have one. Open the contact and fill it in; the form picks it up straight away. Nothing on the form itself needs editing.

## One place this deliberately does not apply

The **WI Assessment Pre-Approval** enrollment has a single "Contractor Email" and no contractor contact on the form. That address stays the registered contractor's **account** email on purpose: it is what Focus On Energy replies to, and it needs to reach the monitored program mailbox rather than one person's inbox.
$md$
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_articles
   WHERE ha_slug = 'contractor-contact-and-email' AND ha_is_deleted IS NOT TRUE
);
