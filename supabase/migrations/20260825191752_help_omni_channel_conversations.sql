-- Help: the omni-channel Conversations area, and filing an email by dropping it.
--
-- Written for the two things a user has to know that no screen can teach them:
-- that a drag from Outlook works at all, and that what LEAP matched is shown
-- for checking before anything is saved.

INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_category, ha_audience,
  ha_is_published, ha_body_markdown
)
SELECT '', 'omni-channel-conversations',
  'Conversations: Every Email, Text and Call in One Place',
  'The Conversations card on a contact or account holds every communication with them — emails, texts and logged calls — and you can drag an email onto it to file it.',
  'Communications', 'internal', true,
$md$## What the Conversations card holds

On a contact or an account, **Conversations** is the one place every communication with that person or company is recorded:

- **Email threads** LEAP sent or received.
- **Text message threads**.
- **Calls, meetings, site visits and notes** you logged by hand.
- **Emails you filed** by dragging them in from Outlook.

They are one list, newest first, with a channel icon on each row so you can tell a call from an email at a glance. Click any row to read it on the right.

## An account shows its contacts' history too

A call with a person at a company is a call with the company. So an **account's** Conversations card also carries every thread and every logged call belonging to its contacts, each marked with a **via <contact name>** badge so you can tell whose it was. A contact's own card shows only that contact.

## Logging a call

Click **Log a Call** on the card header. Pick the type (Call, Meeting, Site Visit, Note — whatever your admin has set up), the direction, roughly how long it ran, who you spoke to, and what was said. It appears in the list immediately.

Logging a call on a **contact** offers you the contact's **account** as a related record, ticked by default. Leave it ticked and the call shows on the company's page as well.

## Filing an email by dragging it in

An email that happened outside LEAP — sent from your own Outlook, forwarded to you by a program administrator, or older than the account itself — can be put on the record it belongs to.

**Drag the message out of Outlook and drop it anywhere on the Conversations card.** The card turns green while you are dragging over it. You can also drag in a saved `.msg` or `.eml` file from your computer, or drop several at once.

### LEAP reads who was involved

Before anything is saved, you get a summary of what was read:

- The **subject**, the **date the message was actually sent**, and which file it came from.
- Every **From / To / Cc** address, each with what it matched in LEAP — a contact, an account, an EES staff member, or one of our own program mailboxes.
- Addresses that matched **nothing**, said plainly. Those are still recorded on the message as unmatched, so you can create the contact later and nothing is lost.

From that, LEAP works out whether the email was **sent by EES** or **received by EES** — from the addresses on the message, never from the record you dropped it on.

Check the summary, then click **File Email**. The message joins the thread with that person if one exists, or starts a new one. Because it is filed with the time it was really sent, it sorts into the history where it belongs rather than jumping to the top.

### Things worth knowing

- **The same email filed twice does not duplicate.** LEAP recognises the message by its internet Message-ID and opens the copy already on the record.
- **An email filed on a contact also shows on their account**, and one filed on an account carries the contact if the address matches one.
- **If your mail client hands over only text** instead of the message file — some do — LEAP reads the From / Sent / To / Subject block out of the text and says so on the summary. There is no Message-ID in that case, so filing the same message again would create a second copy.
- **A photo or a PDF dropped on the card is not filed.** Only a message is.
- **Nothing is sent.** Filing an email records it; it does not forward or reply to anything.

## Replying

Open an email or text thread and use the composer at the bottom, exactly as before. A logged call has no composer — it is a record of something that already happened.
$md$
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_articles
  WHERE ha_slug = 'omni-channel-conversations' AND ha_is_deleted IS NOT TRUE
);

DO $$
DECLARE v_number text;
BEGIN
  SELECT ha_record_number INTO v_number
  FROM public.help_articles
  WHERE ha_slug = 'omni-channel-conversations' AND ha_is_deleted IS NOT TRUE;
  IF v_number IS NULL OR v_number = '' THEN
    RAISE EXCEPTION 'The omni-channel Conversations help article was not created.';
  END IF;
  RAISE NOTICE 'Omni-channel Conversations help article is %', v_number;
END $$;
