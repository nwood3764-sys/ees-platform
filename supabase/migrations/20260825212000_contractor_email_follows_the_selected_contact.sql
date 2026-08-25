-- Contractor Email follows the selected CONTACT, the way Contractor Phone
-- already does.
--
-- 20260730231129 repointed the contractor Phone Number fields from the account
-- to the section's selected contact, because a phone number is a fact about a
-- person. Email was left on the account, so every contractor block on a program
-- form contradicted itself: "Support Contractor Contact Name: Brittin Wood" sat
-- directly above "Support Contractor Email: ira@EES-WI.org" -- the shared
-- program mailbox, not that person's address, and unchanged no matter which
-- contact was selected.
--
-- Eight fields across four layouts (the WI Project Reservation enrollment and
-- the WI/NC/MI Project Payment Request applications), primary and support.
-- The guard is structural, not a list of ids: only a field whose section
-- actually offers the matching contractor CONTACT lookup is repointed. That is
-- what leaves the WI-IRA-MF-HOMES-ASSESSMENT layout's "Contractor Email" alone
-- -- it has no contact on the form, and its registered-contractor address is
-- deliberately the monitored program mailbox that Focus On Energy replies to.

UPDATE public.page_layout_widgets w
SET widget_config = jsonb_set(w.widget_config, '{fields}', (
      SELECT jsonb_agg(
        CASE
          WHEN fld->>'type' = 'related_field'
           AND fld->'related'->>'column' = 'account_email'
           AND fld->'related'->>'fk_column' LIKE '%contractor_account_id'
           AND w.widget_config->'fields' @> jsonb_build_array(jsonb_build_object(
                 'name', replace(fld->'related'->>'fk_column','_account_id','_contact_id')))
          THEN jsonb_build_object(
                 'name', replace(fld->'related'->>'fk_column','_account_id','_contact_id') || '.contact_email',
                 'type', 'related_field',
                 'label', fld->>'label',
                 'related', jsonb_build_object(
                   'table','contacts',
                   'column','contact_email',
                   'fk_column', replace(fld->'related'->>'fk_column','_account_id','_contact_id'),
                   'column_type','email'))
               || (CASE WHEN fld ? 'column'     THEN jsonb_build_object('column', fld->'column')         ELSE '{}'::jsonb END)
               || (CASE WHEN fld ? 'full_width' THEN jsonb_build_object('full_width', fld->'full_width') ELSE '{}'::jsonb END)
          ELSE fld
        END ORDER BY ord)
      FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(fld, ord)
    )),
    updated_at = now()
WHERE w.is_deleted IS NOT TRUE
  AND w.widget_type = 'field_group'
  AND w.widget_config ? 'fields'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') fld
     WHERE fld->>'type' = 'related_field'
       AND fld->'related'->>'column' = 'account_email'
       AND fld->'related'->>'fk_column' LIKE '%contractor_account_id'
       AND w.widget_config->'fields' @> jsonb_build_array(jsonb_build_object(
             'name', replace(fld->'related'->>'fk_column','_account_id','_contact_id'))));

-- Assert the repoint landed on exactly the blocks that carry a contact, and
-- that no contractor block is left showing a company mailbox beside a person.
DO $verify$
DECLARE v_moved integer; v_left integer;
BEGIN
  SELECT count(*) INTO v_moved
    FROM public.page_layout_widgets w
    CROSS JOIN LATERAL jsonb_array_elements(w.widget_config->'fields') f
   WHERE w.is_deleted IS NOT TRUE
     AND f->'related'->>'column' = 'contact_email'
     AND f->'related'->>'fk_column' LIKE '%contractor_contact_id';
  IF v_moved <> 8 THEN
    RAISE EXCEPTION 'expected 8 contractor email fields reading the contact, found %', v_moved;
  END IF;

  SELECT count(*) INTO v_left
    FROM public.page_layout_widgets w
    CROSS JOIN LATERAL jsonb_array_elements(w.widget_config->'fields') f
   WHERE w.is_deleted IS NOT TRUE
     AND f->'related'->>'column' = 'account_email'
     AND f->'related'->>'fk_column' LIKE '%contractor_account_id'
     AND w.widget_config->'fields' @> jsonb_build_array(jsonb_build_object(
           'name', replace(f->'related'->>'fk_column','_account_id','_contact_id')));
  IF v_left > 0 THEN
    RAISE EXCEPTION '% contractor email field(s) still read the account beside a contact lookup', v_left;
  END IF;
END $verify$;

NOTIFY pgrst, 'reload schema';
