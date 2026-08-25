-- ============================================================================
-- HA-00143 — correct the related-list naming section
-- ----------------------------------------------------------------------------
-- The section added earlier today said the card title carries the relationship
-- ("Properties (Property Management Company)"). It does not: the title is the
-- object's name and the admin types their own — on an Account, "Properties"
-- and "Properties Managed". Naming the relationship belongs to the picker
-- ROWS, where two routes to the same object have to be told apart. Rewritten
-- in place rather than appended, so the article does not promise a title
-- nobody uses.
-- ============================================================================

DO $help$
DECLARE
  v_body    text;
  v_old     text;
  v_new     text;
  v_start   int;
  v_end     int;
BEGIN
  SELECT ha_body_markdown INTO v_body
    FROM help_articles
   WHERE ha_record_number = 'HA-00143' AND ha_is_deleted IS NOT TRUE;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'HA-00143 not found';
  END IF;

  v_start := position('## What the list is called' in v_body);
  v_end   := position('## Changing the columns' in v_body);

  IF v_start = 0 OR v_end = 0 OR v_end < v_start THEN
    RAISE EXCEPTION 'HA-00143 does not carry the naming section to correct';
  END IF;

  v_old := substring(v_body from v_start for v_end - v_start);

  v_new :=
E'## What the list is called\n\n'
|| E'The **Title** is filled in with the name of the object you picked — Contacts, Opportunities, Work Orders. Type over it with whatever the people reading the record page call the card; once you edit it, it stops being filled in for you. On an Account the two properties cards are titled **Properties** and **Properties Managed**.\n\n'
|| E'Some objects are related to this one **more than one way**, so picking "Properties" would be ambiguous. In **Show Records From** those rows name the relationship — the lookup field the records come through — with its column beside it:\n\n'
|| E'- **Properties (Property Account)** `property_account_id` — properties whose Property Account is this account.\n'
|| E'- **Properties (Property Management Company)** `property_management_company_id` — properties this account manages.\n\n'
|| E'Pick the row you mean, then title the card whatever you like.\n\n';

  UPDATE help_articles
     SET ha_body_markdown = replace(v_body, v_old, v_new)
   WHERE ha_record_number = 'HA-00143' AND ha_is_deleted IS NOT TRUE;
END
$help$;
