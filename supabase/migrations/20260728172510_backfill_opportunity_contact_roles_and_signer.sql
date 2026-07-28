-- Backfill Opportunity Contact Roles + Decision-Maker signer for existing opportunities
-- =====================================================================================
-- Context (Nicholas, 2026-07-28): the Authorized Signer picker on opportunities was
-- rewired (migration 20260728163337 / PR #272) to source its options from
-- list_signer_contacts_for_opportunity(), which only returns contacts that already
-- exist as Opportunity Contact Roles on that opportunity. Those roles are seeded by the
-- trg_opportunity_seed_contact_roles trigger, which fires only on INSERT of a NEW
-- opportunity. Every opportunity created before that migration (36 of 37, including
-- OPP-00067 "1837 Alden Road - Janesville") therefore has ZERO contact roles, so the
-- signer picker returns "No matches" even when the account has a Decision Maker
-- (e.g. Dennis Hanson) — that's the "can't select the signer" bug.
--
-- This migration is a one-time, additive backfill: it runs the exact same linking logic
-- the INSERT trigger applies, but set-based across every existing opportunity, then
-- defaults the signer to the account's Decision Maker where it is still blank. No
-- schema change, no deletes — it only inserts missing role rows and fills null signers,
-- so it is safe and idempotent (re-running inserts nothing new).

-- 1) Link every active contact on each opportunity's owner account, managing account,
--    or property management company as an Opportunity Contact Role, mapping the
--    contact's durable role (by label) onto the role it carries on the opportunity.
--    Idempotent via the active (opportunity_id, contact_id) NOT EXISTS guard;
--    ocr_name / ocr_record_number are filled by their BEFORE-INSERT triggers.
INSERT INTO public.opportunity_contact_roles
  (opportunity_id, contact_id, ocr_role, ocr_name, ocr_created_by, ocr_is_primary, ocr_includes_communications)
SELECT
  o.id,
  c.id,
  (SELECT r.id FROM public.picklist_values r
     WHERE r.picklist_object = 'opportunity_contact_roles'
       AND r.picklist_field  = 'role'
       AND r.picklist_label  = (SELECT cr.picklist_label FROM public.picklist_values cr WHERE cr.id = c.contact_role)
     LIMIT 1),
  '',
  COALESCE(o.opportunity_created_by, o.opportunity_owner),
  COALESCE(c.contact_is_primary, false),
  true
FROM public.opportunities o
JOIN public.contacts c
  ON NOT c.contact_is_deleted
 AND c.contact_account_id IN (
       o.opportunity_account_id,
       o.opportunity_managing_account_id,
       o.opportunity_property_management_company
     )
WHERE NOT COALESCE(o.opportunity_is_deleted, false)
  AND COALESCE(o.opportunity_created_by, o.opportunity_owner) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.opportunity_contact_roles ocr
    WHERE ocr.opportunity_id = o.id
      AND ocr.contact_id = c.id
      AND NOT COALESCE(ocr.ocr_is_deleted, false)
  );

-- 2) Default the document signer to each opportunity's account Decision Maker (owner
--    account preferred over the management company), only where it is still blank.
UPDATE public.opportunities o
SET opportunity_authorized_signer_id = dm.contact_id
FROM (
  SELECT DISTINCT ON (o2.id) o2.id AS opportunity_id, c.id AS contact_id
  FROM public.opportunities o2
  JOIN public.contacts c
    ON NOT c.contact_is_deleted
   AND c.contact_account_id IN (
         o2.opportunity_account_id,
         o2.opportunity_managing_account_id,
         o2.opportunity_property_management_company
       )
  JOIN public.picklist_values cr
    ON cr.id = c.contact_role
   AND cr.picklist_label = 'Decision Maker'
  WHERE NOT COALESCE(o2.opportunity_is_deleted, false)
    AND o2.opportunity_authorized_signer_id IS NULL
  ORDER BY o2.id, (c.contact_account_id = o2.opportunity_account_id) DESC
) dm
WHERE o.id = dm.opportunity_id
  AND o.opportunity_authorized_signer_id IS NULL;
