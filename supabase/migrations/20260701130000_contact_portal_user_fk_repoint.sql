-- =============================================================================
-- Repoint contacts.contact_portal_user_id to portal_users.
--
-- The column is named for a PORTAL user and is used by the "Add to Portal" flow
-- to record which portal_users row a contact was invited as. Its FK, however,
-- pointed at public.users (staff table) — a leftover from before portal users
-- were split into their own table. No rows use it (verified: 0), so repointing
-- is safe and additive. ON DELETE SET NULL so a soft/hard-deleted portal user
-- never dangles the contact link.
-- =============================================================================

alter table public.contacts
  drop constraint if exists contacts_contact_portal_user_id_fkey;

alter table public.contacts
  add constraint contacts_contact_portal_user_id_fkey
  foreign key (contact_portal_user_id)
  references public.portal_users (id)
  on delete set null;

notify pgrst, 'reload schema';
