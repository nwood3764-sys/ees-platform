-- ============================================================================
-- HA-00143 — document how a related list is named
-- ----------------------------------------------------------------------------
-- The article told admins the Title "is filled in automatically" and stopped
-- there, which is exactly the part that was wrong: an object related to the
-- layout's object more than once produced the same title twice and named
-- neither relationship. The titles now carry the lookup field's own wording;
-- this says so, with the Account/Properties case spelled out.
-- ============================================================================

DO $help$
DECLARE
  v_body    text;
  v_section text;
BEGIN
  SELECT ha_body_markdown INTO v_body
    FROM help_articles
   WHERE ha_record_number = 'HA-00143' AND ha_is_deleted IS NOT TRUE;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'HA-00143 not found';
  END IF;

  v_section :=
E'## What the list is called\n\n'
|| E'The title is filled in for you from the object being listed — **Contacts**, **Opportunities**, **Work Orders**.\n\n'
|| E'When an object is related to this one **more than one way**, the object''s name alone is not a name, so the title also carries the relationship, in the wording of the lookup field itself. On an Account, properties arrive through two different lookups, and the two cards read:\n\n'
|| E'- **Properties (Property Account)** — properties whose *Property Account* is this account.\n'
|| E'- **Properties (Property Management Company)** — properties this account manages, through the *Property Management Company* lookup.\n\n'
|| E'The same applies anywhere else an object is related twice (an account''s **Owner Research Requests (Account)** and **Owner Research Requests (Approved Account)**). In the **Show Records From** browser those rows read the same way, with the foreign-key column shown beside them, so you pick the relationship rather than guessing between two identical rows.\n\n'
|| E'You can type your own title over it at any time — once you edit it, it stops being filled in for you.\n\n';

  IF position('## What the list is called' in v_body) > 0 THEN
    RAISE NOTICE 'HA-00143 already documents related-list naming';
    RETURN;
  END IF;

  IF position(E'## Changing the columns' in v_body) = 0 THEN
    RAISE EXCEPTION 'HA-00143 no longer has the Changing the columns heading to insert before';
  END IF;

  UPDATE help_articles
     SET ha_body_markdown = replace(v_body, E'## Changing the columns', v_section || E'## Changing the columns')
   WHERE ha_record_number = 'HA-00143' AND ha_is_deleted IS NOT TRUE;
END
$help$;
