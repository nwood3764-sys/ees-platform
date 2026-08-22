-- Help article for clickable phone / email / website fields.
DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE ORDER BY user_created_at LIMIT 1;
  IF EXISTS (SELECT 1 FROM public.help_articles WHERE ha_slug='clickable-phone-email-website-fields') THEN
    RETURN;
  END IF;
  INSERT INTO public.help_articles
    (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
     ha_category, ha_audience, ha_is_published, ha_is_deleted, ha_created_by)
  VALUES (gen_random_uuid(), '', 'clickable-phone-email-website-fields',
    'Clickable phone, email, and website fields',
    'Phone numbers dial, email addresses open a composer, and websites open in a new tab — on record pages, related lists, and list views. Admins control which columns behave this way from Object Manager.',
$md$# Clickable phone, email, and website fields

A phone number, an email address, and a website are actions, not text. Anywhere LEAP shows one, it is a link:

- **Phone** — click to dial. The number is handed to whatever your device uses for calls: Microsoft Teams or a softphone on a desktop, the dialer on a phone or tablet. Extensions are carried through, so "608-555-1212 ext 214" dials the number and passes 214.
- **Email** — click to open a new message to that address in your mail client.
- **Website** — click to open the site in a new tab. You don't have to type `https://`; a value entered as `example.com` opens correctly.

Links appear on **record pages** (including fields pulled in from a parent record, and formula / roll-up / inherited fields), inside **related lists** on a record page, and in **list views**. Clicking a link inside a list row places the call or opens the site — it does not open the row's record.

Phone numbers display in a consistent US format — `(608) 555-1212` — no matter how they were typed or imported.

## When a value stays plain text

LEAP only links a value it can actually act on. These stay as plain text, on purpose:

- Two numbers in one field ("555-1212 / 555-1213") — there's no way to know which to dial. Put the second number in its own field, or in the record's notes.
- A note instead of a value ("call the site office").
- Anything that isn't a real web address in a website field.

If a field you expect to be clickable isn't, check the value first — that's almost always the reason.

## For administrators

Whether a column behaves as a phone, an email, or a website is a property of the **column**, not of a page layout. Set it in **Setup → Object Manager → (object) → Fields & Relationships**: open the field and set its **type** to Phone, Email, or URL.

That one setting applies everywhere the column appears — every page layout for that object (including layouts built later), every related list, and every list view — so there is nothing to configure per layout. Edit forms also follow it: a phone field brings up the numeric keypad on a phone, an email field the email keyboard, and a website field prompts for `https://`.
$md$,
    'Records', 'internal', true, false, v_owner);
END $$;
