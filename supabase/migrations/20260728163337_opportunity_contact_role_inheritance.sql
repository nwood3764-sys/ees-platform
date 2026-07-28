-- Opportunity contact-role inheritance + document-signer routing
-- ================================================================
-- Business rules (Nicholas, 2026-07-28):
--   • A company's contacts live on its account, each with a durable ROLE
--     (Decision Maker, Site Property Manager, Property Owner, ...). The
--     Decision Maker is the person who signs documents.
--   • When an opportunity is created it must carry the account's people over as
--     Opportunity Contact Roles, so the signer/decision-maker is available
--     without re-entering anyone — "for any opportunity, you need the account's
--     contacts on it."
--   • The document signer (opportunity_authorized_signer_id, read by the
--     e-signature flow) defaults to the account's Decision Maker.
--
-- The contacts.contact_role column already existed but had no picklist values
-- and was on no page layout — this migration turns it into a real field, adds
-- the create-time inheritance trigger, and routes the signer picker to the
-- Decision Maker.

-- 1) Contact role picklist — mirrors the Opportunity Contact Role role set so a
--    contact's durable role maps 1:1 onto the role it carries on an opportunity.
INSERT INTO public.picklist_values
  (picklist_object, picklist_field, picklist_value, picklist_label, picklist_sort_order, picklist_is_active)
SELECT 'contacts', 'role', v.val, v.val, v.ord, true
FROM (VALUES
  ('Property Owner', 1),
  ('Site Property Manager', 2),
  ('Enrollment Contact', 3),
  ('Decision Maker', 4),
  ('Property Maintenance Contact', 5)
) AS v(val, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.picklist_values p
  WHERE p.picklist_object = 'contacts' AND p.picklist_field = 'role' AND p.picklist_value = v.val
);

-- 2) Expose contact_role on the customer-facing contact layouts (master +
--    property_owner_contact). Internal-staff record types (technician, ees_contact,
--    program_implementer) represent our own people and don't carry program roles,
--    so they're intentionally left out.
UPDATE public.page_layout_widgets pw
SET widget_config = jsonb_set(
      widget_config, '{fields}',
      (widget_config->'fields') || jsonb_build_object('name','contact_role','type','picklist','label','Contact Role')
    )
WHERE pw.id IN (
        '23cdfaba-6f01-4c0f-a520-73502fc1c34b',  -- master: Contact Information
        '45dd74d2-1319-4f64-92bc-2cb38c988a06'   -- property_owner_contact: Contact Information
      )
  AND pw.is_deleted = false
  AND NOT (widget_config->'fields' @> '[{"name":"contact_role"}]'::jsonb);

-- 3) On INSERT of an opportunity, link the account's people as Opportunity
--    Contact Roles and default the signer to the account's Decision Maker.
CREATE OR REPLACE FUNCTION public.seed_opportunity_contact_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_creator    uuid;
  v_dm_contact uuid;
BEGIN
  -- Someone must own the created role rows (ocr_created_by is NOT NULL). Fall
  -- back through the opportunity's creator/owner to the acting app user; if none
  -- can be resolved, skip silently rather than block the opportunity insert.
  v_creator := COALESCE(NEW.opportunity_created_by, NEW.opportunity_owner, current_app_user_id());
  IF v_creator IS NULL THEN
    RETURN NEW;
  END IF;

  -- Link every active contact on the opportunity's owner account, managing
  -- account, or property management company. Each contact's durable role maps
  -- (by label) onto the role it carries on this opportunity. Idempotent via the
  -- active (opportunity_id, contact_id) unique index; ocr_name / ocr_record_number
  -- are filled by their BEFORE-INSERT triggers.
  INSERT INTO public.opportunity_contact_roles
    (opportunity_id, contact_id, ocr_role, ocr_name, ocr_created_by, ocr_is_primary, ocr_includes_communications)
  SELECT
    NEW.id,
    c.id,
    (SELECT o.id FROM public.picklist_values o
       WHERE o.picklist_object = 'opportunity_contact_roles'
         AND o.picklist_field  = 'role'
         AND o.picklist_label  = (SELECT cr.picklist_label FROM public.picklist_values cr WHERE cr.id = c.contact_role)
       LIMIT 1),
    '',
    v_creator,
    COALESCE(c.contact_is_primary, false),
    true
  FROM public.contacts c
  WHERE NOT c.contact_is_deleted
    AND c.contact_account_id IN (
      NEW.opportunity_account_id,
      NEW.opportunity_managing_account_id,
      NEW.opportunity_property_management_company
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.opportunity_contact_roles ocr
      WHERE ocr.opportunity_id = NEW.id
        AND ocr.contact_id = c.id
        AND NOT COALESCE(ocr.ocr_is_deleted, false)
    );

  -- Default the document signer to the account's Decision Maker (owner account
  -- preferred over the management company), only when the caller left it blank.
  IF NEW.opportunity_authorized_signer_id IS NULL THEN
    SELECT c.id INTO v_dm_contact
    FROM public.contacts c
    JOIN public.picklist_values cr ON cr.id = c.contact_role
    WHERE NOT c.contact_is_deleted
      AND cr.picklist_label = 'Decision Maker'
      AND c.contact_account_id IN (
        NEW.opportunity_account_id,
        NEW.opportunity_managing_account_id,
        NEW.opportunity_property_management_company
      )
    ORDER BY (c.contact_account_id = NEW.opportunity_account_id) DESC
    LIMIT 1;

    IF v_dm_contact IS NOT NULL THEN
      UPDATE public.opportunities
         SET opportunity_authorized_signer_id = v_dm_contact
       WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.seed_opportunity_contact_roles() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_opportunity_seed_contact_roles ON public.opportunities;
CREATE TRIGGER trg_opportunity_seed_contact_roles
AFTER INSERT ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.seed_opportunity_contact_roles();

-- 4) Route the Authorized Signer picker to Decision Makers. When the opportunity
--    has a contact whose role is Decision Maker, offer those; otherwise fall back
--    to every linked contact so the picker is never empty. The currently-selected
--    contact is always included so it renders even if its role later changes.
CREATE OR REPLACE FUNCTION public.list_signer_contacts_for_opportunity(
  p_opportunity_id uuid,
  p_include_contact_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(id uuid, contact_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH dm AS (
    SELECT DISTINCT c.id, c.contact_name
      FROM public.opportunity_contact_roles ocr
      JOIN public.contacts c        ON c.id = ocr.contact_id
      JOIN public.picklist_values pv ON pv.id = ocr.ocr_role
     WHERE ocr.opportunity_id = p_opportunity_id
       AND NOT COALESCE(ocr.ocr_is_deleted, false)
       AND NOT c.contact_is_deleted
       AND pv.picklist_label = 'Decision Maker'
  ),
  linked AS (
    SELECT DISTINCT c.id, c.contact_name
      FROM public.opportunity_contact_roles ocr
      JOIN public.contacts c ON c.id = ocr.contact_id
     WHERE ocr.opportunity_id = p_opportunity_id
       AND NOT COALESCE(ocr.ocr_is_deleted, false)
       AND NOT c.contact_is_deleted
  )
  SELECT id, contact_name FROM dm
  UNION
  SELECT id, contact_name FROM linked WHERE NOT EXISTS (SELECT 1 FROM dm)
  UNION
  SELECT c.id, c.contact_name
    FROM public.contacts c
   WHERE p_include_contact_id IS NOT NULL
     AND c.id = p_include_contact_id
     AND NOT c.contact_is_deleted
  ORDER BY contact_name;
$function$;

GRANT EXECUTE ON FUNCTION public.list_signer_contacts_for_opportunity(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
