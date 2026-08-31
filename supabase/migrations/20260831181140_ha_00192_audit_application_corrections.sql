-- HA-00192 corrected in place: three of its statements stopped being true today.
--
-- Corrected, not appended -- a help article that describes the old behaviour
-- sends the reader to the wrong tab and tells them a field fills itself when it
-- does not (the same reason 20260831173605 corrected HA-00169/HA-00157 rather
-- than adding a note under them).
--
--   1. Required Documents moved from the Related tab to the Details tab
--      (20260831180024), so both places the article names the tab are wrong.
--   2. Property Owner Name is no longer a read-only value "from the property":
--      it is the application's own editable field, resolved from the property's
--      HUD owner organization else its owner account (20260831175946).
--   3. Building Improvements is listed under "never inherited". It now inherits
--      from the pre-approval enrollment (20260831175912).

DO $$
DECLARE
  v_body text;
  v_new  text;
BEGIN
  SELECT ha_body_markdown INTO v_body
    FROM public.help_articles
   WHERE ha_record_number = 'HA-00192' AND ha_is_deleted IS NOT TRUE;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'HA-00192 not found';
  END IF;
  v_new := v_body;

  -- 1) The section table's own row for the uploads.
  v_new := replace(v_new,
    '| **Required Documents** *(Related tab)* | Asset Score · BuildingSync File · Invoice |',
    '| **Required Documents** | Asset Score · BuildingSync File · Invoice — on the Details tab, directly under Assessment Details, exactly where the form asks for them |');

  -- 2) Property Owner Name is the application''s own field now, and it reads the
  --    owner from BOTH places a property records one.
  v_new := replace(v_new,
    '**Read from the related record, always current.** Property Owner Name comes from the property. Building Name',
    '**Read from the related record, always current.** Building Name');
  v_new := replace(v_new,
    'Only the address''s second line is the application''s own field — buildings carry no line 2.',
    'Only the address''s second line is the application''s own field — buildings carry no line 2.'
    || E'\n\n**Property Owner Name is the application''s own field**, filled in for you when the record is created. A property states its owner in two places and either one may be the only one filled in: the HUD owner organization, and the Property Owner **account**. LEAP takes the HUD name where there is one — it names the entity that owns *that* property, which can be narrower than the account (LSS HOUSING, INC. under the parent Lutheran Social Services of Wisconsin and Upper Michigan, Inc.) — and the account name otherwise. Because it is the application''s own field you can also **edit it**, which matters when a particular application has to go out under a different name.');

  -- 3) Building Improvements now inherits.
  v_new := replace(v_new,
    '- IRA Income Code, Assessment Date, Requested Incentive Amount',
    '- IRA Income Code, Assessment Date, Requested Incentive Amount'
    || E'\n- Building Improvements (the pre-approval''s Building Details — both forms ask for the measures that were modeled)');
  v_new := replace(v_new,
    'Never inherited, because the form asks for facts the enrollment does not hold: **Assessment Cost**, **Building Improvements**, the HOMES follow-up question, the more-than-one-property question, the attestations and the signature.',
    'Never inherited, because the form asks for facts the enrollment does not hold: **Assessment Cost**, the HOMES follow-up question, the more-than-one-property question, the attestations and the signature. Those are yours to answer on the application itself.');

  -- 4) The Required Documents section body.
  v_new := replace(v_new,
    'Each is its own card on the **Related** tab, showing only its own file:',
    'Each is its own card on the **Details** tab, between Assessment Details and Assessor Information — the order the form itself uses — showing only its own file:');
  v_new := replace(v_new,
    'Anything else you upload lands in **Supporting Documents**, so a file is never listed twice.',
    'Anything else you upload lands in **Supporting Documents** on the Related tab — a LEAP catch-all with no counterpart on the form — so a file is never listed twice.');

  IF v_new = v_body THEN
    RAISE EXCEPTION 'HA-00192 was not changed — its wording no longer matches what this migration replaces';
  END IF;
  IF v_new LIKE '%*(Related tab)* | Asset Score%' THEN
    RAISE EXCEPTION 'HA-00192 still sends the reader to the Related tab for the required uploads';
  END IF;
  IF v_new LIKE '%Property Owner Name comes from the property.%' THEN
    RAISE EXCEPTION 'HA-00192 still describes Property Owner Name as read-only from the property';
  END IF;
  IF v_new LIKE '%does not hold: **Assessment Cost**, **Building Improvements**%' THEN
    RAISE EXCEPTION 'HA-00192 still lists Building Improvements as never inherited';
  END IF;

  UPDATE public.help_articles
     SET ha_body_markdown = v_new, ha_updated_at = now()
   WHERE ha_record_number = 'HA-00192';
END $$;
