-- Help article: the two rules that decide which programs a New Opportunity
-- offers (the property's state and the building's housing type), plus the
-- retirement of the closed Focus on Energy years and of Close Date.
DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE user_is_deleted IS NOT TRUE
   ORDER BY user_created_at LIMIT 1;

  DELETE FROM public.help_articles WHERE ha_slug = 'which-programs-run-on-a-building';

  INSERT INTO public.help_articles
    (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown,
     ha_category, ha_audience, ha_is_published, ha_is_deleted, ha_created_by)
  VALUES (gen_random_uuid(), '', 'which-programs-run-on-a-building',
    'Which programs a New Opportunity offers',
    'Two rules decide the record types in the New Opportunity pop-up: the property''s state, and the building''s housing type. Single-family programs are not offered on a multifamily building, and cannot be saved on one.',
$md$# Which programs a New Opportunity offers

**New Opportunity** never shows you every program in LEAP. Two rules narrow it, and both are enforced in the database — not just hidden in the picker.

## Rule 1 — the property's state

A program belongs to one state. A North Carolina property is offered North Carolina programs; a Wisconsin property is offered Wisconsin's. **Field Operations** is the exception: it is not a program, it is how field documentation work is carried, so it is available everywhere.

## Rule 2 — the building's housing type

A program is written for a housing type. IRA HOMES and HEAR each run a **multifamily** track and a **single-family** track, and they are different programs — different applications, different measures, different money. The building already says which it is, in its **record type**.

So on a **Multifamily** building you are offered the multifamily programs only; on a **Single Family**, **Single Family Attached** or **Single Family Detached** building, the single-family programs only. Focus on Energy runs both, so it appears on either.

On a Wisconsin multifamily building the whole list is now five:

- Field Operations
- FOE-2026-WI
- WI-IRA-MF-HEAR
- WI-IRA-MF-HOMES
- WI-IRA-MF-HOMES-AUDIT

### If the building has no record type

Then it has not said what it is, and neither rule can narrow on housing type — every program that runs in the state is offered. That is a gap in the building record, not permission: fill in the building's record type and the rule applies from that moment.

### It is refused on save, not merely hidden

Choosing a program another way — a module-level **New**, an import, an integration — does not get around it. Saving an opportunity whose program does not run on its building is refused, and the message names the building's type and what *is* available on it:

> Opportunity record type "WI-IRA-SF-HOMES" does not run on a Multifamily building ("5513 North Hopkins Street - Milwaukee - 5513"). Available on this building: Field Operations, FOE-2026-WI, WI-IRA-MF-HEAR, WI-IRA-MF-HOMES, WI-IRA-MF-HOMES-AUDIT.

### Retyping the building itself

Changing a building from Single Family to Multifamily (or back) is refused while opportunities on it run programs the new type does not, and the message names them. There is no automatic conversion — a multifamily HOMES opportunity is not the same record as a single-family one — so move or close those opportunities first, deliberately.

## Focus on Energy: only the open year

Focus on Energy record types are **program years**. FOE-2024-WI and FOE-2025-WI are closed years and are no longer offered; **FOE-2026-WI** is the open one. The retired years are **inactive, not deleted** — any record already carrying one keeps it, and a year can be reactivated if the program reopens.

## Close Date is gone

Opportunities no longer carry a **Close Date**. It was a sales-pipeline field EES does not use — populated on none of the live opportunities while four layouts marked it required, so the create pop-up demanded a date nobody had. An opportunity ends when its program's stages end, and the stages record those dates.

## Changing any of this

None of it is code:

- **Which programs run on which building type** — Setup → Object Manager → **Buildings** → Record Types → **Programs**, per building record type.
- **Which state a program runs in** — the record type's State, on the opportunity record type.
- **Retiring or reopening a program year** — deactivate or reactivate the record type. Never delete one.
$md$,
    'Programs', 'internal', true, false, v_owner);
END $$;
