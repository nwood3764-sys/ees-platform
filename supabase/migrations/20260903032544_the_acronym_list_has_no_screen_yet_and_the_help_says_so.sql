-- HA-00212 said an administrator "can add it to the Text Case Acronyms list",
-- which reads as though a screen exists. It does not: text_case_acronyms is a
-- table with RLS and no record page, so today adding a token is a database
-- change. HA-00053 promised a resolver that was never built and an admin
-- followed it into a dead end; say what is true instead.
update public.help_articles
   set ha_body_markdown = replace(
         ha_body_markdown,
         'one LEAP got wrong — a company whose initials now read as a word, say — an
administrator can add it to the Text Case Acronyms list, and it will stay in
capitals from then on. Removing a row does the opposite.',
         'one LEAP got wrong — a company whose initials now read as a word, say — tell
your administrator. The list lives in the database (`text_case_acronyms`) and
does not have a screen yet, so adding or retiring a token is a change an
administrator makes directly.')
 where ha_slug = 'how-leap-writes-names-and-addresses'
   and ha_is_deleted = false;

do $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.help_articles
             WHERE ha_slug = 'how-leap-writes-names-and-addresses'
               AND ha_is_deleted = false
               AND ha_body_markdown LIKE '%administrator can add it to the Text Case Acronyms list%') THEN
    RAISE EXCEPTION 'HA-00212 still promises a screen that does not exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.help_articles
                 WHERE ha_slug = 'how-leap-writes-names-and-addresses'
                   AND ha_is_deleted = false
                   AND ha_body_markdown LIKE '%does not have a screen yet%') THEN
    RAISE EXCEPTION 'the HA-00212 correction did not land';
  END IF;
END $$;
