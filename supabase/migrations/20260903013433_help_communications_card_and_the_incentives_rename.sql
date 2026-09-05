-- =============================================================================
-- Help: the Communications card on enrollments and incentives, and the rename.
--
-- HA-00078 is CORRECTED IN PLACE rather than appended to. It named the card
-- "Conversations", listed six objects that no longer describe where the card
-- is, and told the reader to look on the Details tab when every seeded card
-- sits on Related. An article that sends someone to the wrong tab under the
-- wrong heading is a wrong instruction, not a stale one.
-- =============================================================================

INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary,
  ha_category, ha_audience, ha_is_published, ha_body_markdown
) VALUES (
  '', 'communications-on-enrollments-and-incentives',
  'Communications on enrollments and incentives',
  'Every enrollment and every incentive now carries the Communications card — email threads, text threads and logged calls in one feed on the record. The object formerly called Incentive Application is now called Incentive.',
  'Communications', 'all', true,
$md$
Every **enrollment** and every **incentive** record now carries the
**Communications** card, the same omni-channel area accounts, contacts, work
orders, projects, properties, buildings, opportunities and assessments already
had.

## What the card does

Open an enrollment or an incentive and go to the **Related** tab. The
**Communications** section holds one time-ordered feed of everything said to or
by the people on that record:

- **Email threads** — send a new one with **New Email**; replies from the
  customer thread back onto the same conversation automatically.
- **Text threads**, where the record has a mobile number.
- **Logged calls, meetings and notes** — press **Log a Call** to record a call
  that happened on somebody's phone. It is part of the same feed, not a
  separate list.
- **An email that happened in Outlook** — drag the message from Outlook and
  drop it on the card. LEAP reads who was on it, files it on the record and
  shows you what it read before anything is written.

## Which mailbox an email comes from

You do not choose. LEAP walks the record to the state it is in and sends from
that state's mailbox:

- **Enrollment** → the property's state, and failing that the linked
  opportunity's state.
- **Incentive** → the installation address state, else the linked property,
  else the parent project's property.

If no state can be found, the composer says so instead of sending from the
wrong address.

## Relating a call to more than the record you logged it on

A call logged on an enrollment or an incentive can also be related to the
property, the building, the opportunity, the project and the account behind it.
Tick the ones it belongs to when you log it, and the call shows on those
records' feeds too.

## The object is now called Incentive

What used to read **Incentive Application** now reads **Incentive**
everywhere — the tab, the list views, the record page, the reports and the nine
statuses (**Incentive To Be Prepared**, **Incentive Approved**, and so on).

Nothing moved and nothing was renumbered. Record numbers (IA-00001 and the
rest), links you have saved and every field on the record are unchanged; only
the name you read has changed.
$md$
);

-- -----------------------------------------------------------------------------
-- HA-00078, corrected.
-- -----------------------------------------------------------------------------
UPDATE public.help_articles SET
  ha_title = 'Communications card — which records carry it, and how a reply finds its mailbox',
  ha_summary = 'The Communications card — the split-pane view of every email thread, text thread and logged call on a record — is on thirteen objects, including enrollments and incentives. Replies route through the right state mailbox automatically.',
  ha_body_markdown = $md$
The **Communications** card — the split-pane area showing every email thread,
text thread and logged call anchored to the record you are looking at — is on
these objects:

- **Account** (which also rolls up its contacts' threads and calls)
- **Contact**
- **Enrollment**
- **Incentive**
- **Opportunity**
- **Project**
- **Assessment**
- **Work Order**
- **Service Appointment**
- **Property**
- **Building**
- **Unit**

## Where to find it

Open the record and go to the **Related** tab. The **Communications** section
is collapsible and starts collapsed; expand it to see the feed on the left and
the active thread with its composer on the right (single column on a phone).

The card is the same everywhere: **New Email**, **Log a Call**, and a drop
target for an email dragged out of Outlook.

## How replies route to the right mailbox

When you send from a record, LEAP works out which state mailbox to send from
(WI, NC, CO, MI or IN) by walking that record to a state:

- **Enrollment** → property's state, else the linked opportunity's state
- **Work Order** → property's state, else the parent project's property
- **Incentive** → installation address state, else linked property, else the
  parent project's property
- **Opportunity** → opportunity's state, else linked property's state
- **Assessment** → linked property's state, else parent project, else building
- **Building** → building's state, else parent property
- **Property** → state directly

If no state can be found — a record with no property linked yet, for
instance — the composer tells you, rather than guessing and sending from the
wrong address.

## Adding the card to another object

The card can be placed on any object a thread can be anchored to, and the
layout editor's card palette offers it exactly there. On an object with no
anchor the palette shows it greyed out and says why, rather than letting you
place a card that would always be empty.
$md$
WHERE ha_record_number = 'HA-00078';

-- -----------------------------------------------------------------------------
-- Prove the articles say what they should.
-- -----------------------------------------------------------------------------
DO $do$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.help_articles
   WHERE ha_slug = 'communications-on-enrollments-and-incentives' AND ha_is_deleted = false;
  IF v_n <> 1 THEN RAISE EXCEPTION 'the new help article was not written'; END IF;

  SELECT count(*) INTO v_n FROM public.help_articles
   WHERE ha_record_number = 'HA-00078' AND ha_body_markdown LIKE '%**Enrollment**%'
     AND ha_title LIKE 'Communications card%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'HA-00078 was not corrected'; END IF;

  -- No article still CALLS the object by its old name. The one article that
  -- may say the words is the one explaining the rename, which has to quote the
  -- name a reader is looking for.
  SELECT count(*) INTO v_n FROM public.help_articles
   WHERE ha_is_deleted = false
     AND ha_slug <> 'communications-on-enrollments-and-incentives'
     AND (ha_title ILIKE '%incentive application%' OR ha_body_markdown ILIKE '%incentive application%');
  IF v_n <> 0 THEN RAISE EXCEPTION '% help article(s) still name the object Incentive Application', v_n; END IF;
END
$do$;
