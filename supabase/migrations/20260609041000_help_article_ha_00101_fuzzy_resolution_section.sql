-- Extend HA-00101 (Using the LEAP Assistant) with a section covering the new
-- fuzzy entity resolution / "did you mean?" behavior. Inserted after the
-- confirmation section, before "Building reports", where a user wondering about
-- a misread name would look.
update public.help_articles
set ha_body_markdown = replace(
      ha_body_markdown,
      E'Lookups and questions are answered immediately, since they only read data.\n\nIf the assistant needs a piece of information it cannot safely guess — for example, which account a new contact belongs to — it asks rather than inventing a value.\n\n## Building reports',
      E'Lookups and questions are answered immediately, since they only read data.\n\nIf the assistant needs a piece of information it cannot safely guess — for example, which account a new contact belongs to — it asks rather than inventing a value.\n\n## "Did you mean…?" — typos and voice-to-text\n\nYou do not have to spell things perfectly. If you mistype a name, dictate by voice and a word comes out wrong, or only half-remember how a property or status is written, the assistant matches what you said against the real values in LEAP and tells you what it found.\n\nWhen there is one clear match, it corrects it and says so — for example, you type "mark the North Willo work order verifyed" and it replies that it read "North Willo" as the property **North Willow** and "verifyed" as the **Verified** status. The correction also appears on the confirmation card, so you can see exactly what it matched before you click Confirm.\n\nWhen several values are close, the assistant does not guess. It lists the closest matches and asks which one you meant, then continues once you choose. It only ever matches against records and values you have permission to see.\n\nThis works for record names (properties, contacts, work orders, and so on) and for picklist values such as statuses, record types, and work types.\n\n## Building reports'
    ),
    ha_updated_at = now(),
    ha_updated_by = 'c5a01ec8-960f-42ab-8a9e-a49822de89af'
where ha_record_number = 'HA-00101';
