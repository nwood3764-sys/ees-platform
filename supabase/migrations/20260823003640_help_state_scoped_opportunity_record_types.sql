-- Help article: opportunity record types are scoped to the property's state.
INSERT INTO public.help_articles (
  ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
  ha_category, ha_audience, ha_is_published
) VALUES (
  '', 'state-scoped-opportunity-record-types',
  'Opportunities Only Offer the Programs That Run in That State',
  'A new opportunity offers the programs that run in its property''s state and nothing else. When the state cannot be worked out, the pop-up asks for it before showing any record types.',
$md$
# Opportunities Only Offer the Programs That Run in That State

Every program EES runs belongs to one state. A North Carolina property runs the NC programs; a Wisconsin property runs the WI programs. **New Opportunity now offers only the record types that run where the property is** — the rest are not on the list at all.

## Where the state comes from

**The property.** Not the building, not the opportunity — the property. An opportunity always has a property, so the state is always knowable, and the property is the one place it is maintained. If you create an opportunity from a building, from a related list, from a list view or from a module's New button, all of them resolve the same property and get the same answer.

An opportunity's own **State** field follows its property automatically. Correct the state on a property and every opportunity on it is corrected too, so the field and the property can never drift apart.

## What you will see

- **The record type list is shorter.** On a property in North Carolina you get the NC programs plus **Field Operations**, which runs everywhere. You will not see FOE-2024-WI or the Michigan set.
- **A state badge** at the top of the pop-up, e.g. `NC — record types that run in this state`, so a short list reads as deliberate rather than as missing programs.
- **A State selector**, when the record cannot tell us where it is — creating an opportunity from a module's New button, for example. Pick the state and its programs appear. Until you do, only the nationwide record types are listed.
- **A state with no programs configured** offers the nationwide record types only. That is not a bug: it means no program has been set up for that state yet.

## The rule is enforced, not just displayed

The database refuses to save an opportunity whose record type runs in a different state from its property, whichever route the record came in by — the record page, a quick-create on a lookup, an import, or an automation. The message names the record type, both states, and what is available where the property actually is.

Opportunities that already carried a mismatched program before this rule existed keep working and stay editable. They are not corrected automatically, because which program they should have been is a business decision.

## Retired record types

**Multifamily Energy Assessment** and **Single-Family Energy Assessment** are no longer opportunity record types. An assessment is the audit program's own work, so it belongs to that state's audit program — NC-IRA-SF-HOMES-AUDIT, WI-IRA-MF-HOMES-AUDIT and the rest.

Both values are **inactive, not deleted**: they no longer appear when you create an opportunity, and opportunities that already carry one keep it, keep their stages, and keep rendering exactly as before.

## Setting up a program in a new state

A record type's state lives on the record type itself: **Setup → Object Manager → Opportunities → Record Types**, the **State** column. Enter a two-letter code and that record type is offered only on properties in that state; leave it blank (shown as *All*) and it is offered everywhere. Nothing about this is hardcoded — adding a state, or a program in a new state, is configuration rather than a build.
$md$,
  'Programs', 'internal', true
);
