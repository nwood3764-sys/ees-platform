-- Activate the "Standard Contact" record type on contacts
-- ---------------------------------------------------------------------------
-- Nicholas: keep the specialized contact record types (Property Owner,
-- Service Provider, Program, Utility), but there also needs to be a plain,
-- general-purpose option for a contact that isn't one of those. The row for
-- it already exists in picklist_values ("Standard Contact", STANDARD-CONTACT)
-- but was left inactive, so it never appeared in the New Contact record-type
-- picker.
--
-- This flips it active, gives it a clean sort order (first, so it reads as the
-- neutral/general choice), and a description. No page layout is created: a
-- record type with no dedicated page layout falls back to the object's default
-- layout ("Contact Layout", record_type_id IS NULL), exactly like the existing
-- Service Provider / Program / Utility contact types already do.
--
-- The default record type for contacts is unchanged (Property Owner Contact) —
-- the default is only the fallback for non-interactive inserts (imports,
-- automation); people creating a contact by hand still choose explicitly.
-- ---------------------------------------------------------------------------

update picklist_values
   set picklist_is_active = true,
       picklist_sort_order = 5,
       picklist_label = 'Standard Contact',
       picklist_description = 'A general-purpose contact that does not fit one of the specialized types (Property Owner, Service Provider, Program, Utility). Use when no more specific record type applies.'
 where picklist_object = 'contacts'
   and picklist_field  = 'record_type'
   and picklist_value  = 'STANDARD-CONTACT';

notify pgrst, 'reload schema';
