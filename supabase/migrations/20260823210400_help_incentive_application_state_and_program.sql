-- Help article: incentive application record types are scoped by state and program.
INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published
) VALUES (
  '', 'incentive-application-state-and-program-scoping',
  'Incentive Applications Only Offer Their State''s and Their Program''s Forms',
  'A new incentive application offers the application forms that run in its property''s state AND belong to its opportunity''s program — nothing else. North Carolina and Michigan now have their own forms.',
$md$
# Incentive Applications Only Offer Their State's and Their Program's Forms

Two rules now decide which record type a new incentive application can carry. Both have to pass, and both are enforced in the database, not just hidden in the list.

## 1. The state, from the property

Every program EES runs belongs to one state, and so does every application form. **A new incentive application offers only the forms that run in its property's state.**

The state comes from the **property** — never the building, and never a copy on the application. An incentive application always has a property, so the state is always knowable, and the property is the one place it is maintained. Creating the application from the building, from the opportunity, from a related list or from an inline **+ New** on a lookup all resolve the same property and get the same answer.

## 2. The program, from the opportunity

**An opportunity's record type IS the program**, so it decides which application forms belong to it. A WI-IRA-SF-HEAR application has no business on a WI-IRA-MF-HOMES opportunity, and it is no longer offered on one.

Today each program allows its own same-named form, with two deliberate exceptions:

- **FOE-2024-WI, FOE-2025-WI and FOE-2026-WI** all submit the one **WI-FOE** application — Focus on Energy is one program run year by year.
- **WI-IRA-MF-HOMES** allows both **WI-IRA-MF-HOMES** and **WI-IRA-MF-HOMES-PROJECT-PAYMENT-REQUEST**, because the Wisconsin HOMES payment request is its own form.

**Field Operations** is not a program, so it constrains nothing — an application created under it still obeys the state rule.

## North Carolina and Michigan have their own forms now

Every application record type used to be declared nationwide, and all but one of them were Wisconsin's. A North Carolina property was being offered Wisconsin's forms because there was nothing else to offer.

The six IRA programs each state runs — MF/SF × HEAR, HOMES and HOMES-AUDIT — now have their own **NC-** and **MI-** application record types, each with **its own page layout**, cloned from the Wisconsin original so they start complete. States share nothing: edit a North Carolina layout freely and Wisconsin's does not move.

Electrify Denver is scoped to **CO**. It has no program edge yet because Colorado has no opportunity record type; it joins in when the program does.

## What you will see

- **A shorter record type list**, holding only the forms that run in the property's state and belong to the opportunity's program. Often that is exactly one, and the pop-up picks it for you.
- **The right form filled in automatically** when an application is created without one — it takes its opportunity's program. Before this it took the platform default, which was Electrify Denver, a Colorado program, wherever the property was.
- **A plain refusal in a state with no programs.** On a property in a state where EES runs nothing — Texas, Georgia and Minnesota all have live properties — the pop-up says so and names the states that are configured, instead of offering another state's forms.

## The rule is enforced, not just displayed

The database refuses to save an application whose form runs in a different state from its property, or which does not belong to its opportunity's program — whichever route the record came in by: the record page, an inline quick-create, an import, or an automation. The message names the form, the states or the program, and what is allowed instead.

Applications created before this rule existed keep working and stay editable. They are not corrected automatically, because which program they should have been is a business decision.

## Changing any of this

Nothing here is hardcoded.

- **A form's state**: Setup → Object Manager → Incentive Applications → Record Types, the **State** column. A two-letter code scopes the form to that state; blank (shown as *All*) means everywhere.
- **Which forms a program allows**: Setup → Object Manager → Opportunities → Record Types → **Application forms** on the program's row. Tick the forms that belong to it. Ticking **none** — or **all** — leaves the program open to every form, including any added later.
$md$,
  'Programs', 'internal', true
);
