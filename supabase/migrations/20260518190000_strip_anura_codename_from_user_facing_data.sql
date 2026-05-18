-- Strip the deprecated "Anura" codename from every user-facing data
-- surface that still referenced it. The platform was renamed LEAP
-- earlier in 2026 (EES-WI is the company, LEAP is the system); data
-- cleanup has been incremental. These seven stragglers surfaced during
-- an admin-tree audit and a comprehensive cross-table sweep:
--
--   picklist_values (contacts.record_type)
--     id bbdb34c1: 'Anura_Contact' / 'Anura Contact' (active, SF-imported)
--                  → 'EES_Contact' / 'EES Contact' (matches SF DeveloperName)
--     id b936acca: 'anura_contact' / 'Anura Contact' (inactive, legacy)
--                  → 'ees_contact' / 'EES Contact'
--
--   page_layouts.page_layout_name
--     contacts:           'Anura Contact'                    → 'EES Contact'
--     time_sheet_entries: 'Anura Time Sheet Entry Layout'    → 'Time Sheet Entry Layout'
--
--   page_layout_widgets.widget_title
--     EES Contact layout: 'Anura Information' → 'EES Information'
--
--   help_articles.ha_body_markdown
--     HA-00003 financial-visibility-tiers: 1 occurrence (replace 'Anura'→'LEAP')
--     HA-00025 notification-send-edge-fns: 1 occurrence (replace 'Anura'→'LEAP')
--
-- No code references the strings (verified via grep across src/ and supabase/).
-- The FK on contacts.contact_record_type targets UUID not string, so the
-- 4 contact rows referencing the renamed record-type UUID continue to
-- resolve correctly — they just display as "EES Contact" instead of
-- "Anura Contact". No EES_Contact picklist row existed before the
-- rename, so no unique-key collision.

-- Picklist values (active SF-imported)
update picklist_values
set picklist_value = 'EES_Contact',
    picklist_label = 'EES Contact'
where picklist_object = 'contacts'
  and picklist_field = 'record_type'
  and picklist_value = 'Anura_Contact';

-- Picklist values (legacy inactive made-up row)
update picklist_values
set picklist_value = 'ees_contact',
    picklist_label = 'EES Contact'
where picklist_object = 'contacts'
  and picklist_field = 'record_type'
  and picklist_value = 'anura_contact';

-- Page layouts
update page_layouts
set page_layout_name = 'EES Contact',
    updated_at = now()
where page_layout_object = 'contacts'
  and page_layout_name = 'Anura Contact'
  and not is_deleted;

update page_layouts
set page_layout_name = 'Time Sheet Entry Layout',
    updated_at = now()
where page_layout_object = 'time_sheet_entries'
  and page_layout_name = 'Anura Time Sheet Entry Layout'
  and not is_deleted;

-- Page layout widget title
update page_layout_widgets
set widget_title = 'EES Information',
    updated_at = now()
where widget_title = 'Anura Information';

-- Help articles — both have exactly one 'Anura' occurrence each (verified).
update help_articles
set ha_body_markdown = replace(ha_body_markdown, 'Anura', 'LEAP'),
    ha_updated_at = now()
where ha_record_number in ('HA-00003', 'HA-00025')
  and not ha_is_deleted;
