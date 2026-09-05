-- HA-00212 — how LEAP writes names, addresses and job titles.
insert into public.help_articles
  (ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published)
select '', 'how-leap-writes-names-and-addresses',
 'How LEAP writes names, addresses and job titles',
 'Why imported text no longer arrives in capitals, which columns the rule governs, and how to correct an acronym it gets wrong.',
$md$
LEAP writes a person's name, a company name, a mailing address, a city and a job
title one way, everywhere. You should not see SHOUTED TEXT on a record page, in
a list view, or on a printed proposal.

## What the rule does

A value that arrives entirely in capitals is rewritten in normal case:

| Stored as | Reads as |
|---|---|
| `LUTHERAN SOCIAL SERVICES OF WISCONSIN AND UPPER MICHIGAN, INC.` | Lutheran Social Services of Wisconsin and Upper Michigan, Inc. |
| `PO BOX 304, WAUKESHA, WI 53187` | PO Box 304, Waukesha, WI 53187 |
| `123 MCDONALD ST` | 123 McDonald St |
| `MORGAN'S MILL SUBDIVISION` | Morgan's Mill Subdivision |
| `Vice President- Housing & Residential` | Vice President - Housing & Residential |

It runs when a record is saved, so anything you type or import is corrected on
the way in, and it was applied once to everything already stored.

## What it deliberately leaves alone

**A value you cased yourself.** If a name already contains a lowercase letter,
LEAP treats that as a decision and does not touch it. "de la Cruz", "iHeart" and
"6737 W Washington Street, Suite 2275" all survive exactly as written.

The one exception is an **address or a city**, where the rule works word by
word — so `13400 Bishops Lane - ATTN: Gary Taxman` becomes `... - Attn: Gary
Taxman` while the rest of the line is untouched. Addresses get this treatment
and names do not, because an address never contains a brand name or a
professional credential and a name often does: `Mary P Fox, CEM` has to keep its
CEM.

**Acronyms.** LLC, LP, LLLP, PLLC, HRA, VOA, ACC, MRCDC, WI, NC and about five
hundred others stay in capitals. LEAP worked that list out from your own data —
a word your records capitalise deliberately beside ordinary words is an
acronym — plus the legal suffixes and the two-letter state codes, which are
written down because they are knowable in advance.

**Program codes.** `WI-IRA-MF-HOMES-AUDIT` is an identifier, not prose, and is
never recased.

**The import's own transcript.** Every field whose name contains `raw` holds
what HUD, LIHTC or USDA actually sent. That is the evidence a property was
matched correctly, so it is kept exactly as received. The display fields beside
it are the ones that get cleaned up.

## If an acronym comes out wrong

Some capitals are genuinely impossible to tell from a shouted word. If you find
one LEAP got wrong — a company whose initials now read as a word, say — an
administrator can add it to the Text Case Acronyms list, and it will stay in
capitals from then on. Removing a row does the opposite.

Correcting a record by hand always wins: type the name the way you want it, with
any lowercase letter in it, and LEAP will leave it alone.

## Where the customer's name and address on a proposal come from

The **Customer Information** block on a Project Reservation or a Final Project
Payment Request reads:

- **the customer** — the account on the property (LEAP keeps one account per
  real-world company, and the property's account is its owner);
- **the address** — that account's billing address, falling back to its mailing
  address, and only then to the free-text owner address on the enrollment;
- **the contact** — the enrollment's Signer contact, with their title.

So if the customer name or address on a printed document is wrong, correct the
**account**, not the document.
$md$,
 'Records', 'all', true
where not exists (
  select 1 from public.help_articles
  where ha_slug = 'how-leap-writes-names-and-addresses' and ha_is_deleted = false);

do $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.help_articles
                 WHERE ha_slug = 'how-leap-writes-names-and-addresses'
                   AND ha_is_published AND ha_is_deleted IS NOT TRUE) THEN
    RAISE EXCEPTION 'the text-case help article did not publish';
  END IF;
END $$;
