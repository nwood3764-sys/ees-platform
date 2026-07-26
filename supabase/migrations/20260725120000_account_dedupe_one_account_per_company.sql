-- Account dedupe: one account per real-world company.
-- The HUD imports (2026-06-26 owner + management-company passes, 2026-06-29 owner + untyped passes)
-- created a separate account per role, so a company that both owns and manages properties — e.g.
-- "CDA OF THE CITY OF MADISON WIS" (ACC-02217 owner / ACC-03162 management company) — got two records.
-- Ruling (Nicholas, 2026-07-25): never duplicate an account per role. The Property Owner account is
-- primary; properties.property_management_company_id may point at a Property Owner account (the
-- lookup is not record-type filtered, so no UI change is needed). All child records move to the
-- surviving Property Owner account.
--
-- Survivor selection within each duplicate-name group (upper/trim match):
--   1. record type property_owner, then any record type, then untyped
--   2. most linked child records (properties owned/managed, contacts, opportunities)
--   3. earliest created, then lowest record number
-- Losers are soft-deleted with a reason naming the survivor; every pair is logged in
-- account_merge_log (same audit table the merge_accounts RPC uses).

DO $$
DECLARE
  v_actor uuid;
  v_owner_rt uuid;
  rec record;
  n bigint;
BEGIN
  SELECT id INTO v_actor FROM users
   WHERE user_email = 'nicholas.wood@ees-wi.org' AND user_is_deleted IS NOT TRUE
   LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Actor user not found';
  END IF;

  SELECT id INTO v_owner_rt FROM picklist_values
   WHERE picklist_object = 'accounts' AND picklist_field = 'record_type'
     AND picklist_value = 'property_owner';
  IF v_owner_rt IS NULL THEN
    RAISE EXCEPTION 'property_owner record type picklist value not found';
  END IF;

  -- 1. Build the merge map: loser -> survivor within each duplicate-name group.
  CREATE TEMP TABLE merge_map ON COMMIT DROP AS
  WITH active AS (
    SELECT a.id, a.account_record_number, upper(trim(a.account_name)) AS norm,
           pv.picklist_value AS rt, a.account_created_at
    FROM accounts a
    LEFT JOIN picklist_values pv ON pv.id = a.account_record_type
    WHERE a.account_is_deleted IS NOT TRUE
  ),
  links AS (
    SELECT act.id,
      coalesce(po.n,0)+coalesce(pm.n,0)+coalesce(ct.n,0)+coalesce(op.n,0) AS n_links
    FROM active act
    LEFT JOIN (SELECT property_account_id AS id, count(*) n FROM properties
               WHERE property_is_deleted IS NOT TRUE GROUP BY 1) po USING (id)
    LEFT JOIN (SELECT property_management_company_id AS id, count(*) n FROM properties
               WHERE property_is_deleted IS NOT TRUE GROUP BY 1) pm USING (id)
    LEFT JOIN (SELECT contact_account_id AS id, count(*) n FROM contacts
               WHERE contact_is_deleted IS NOT TRUE GROUP BY 1) ct USING (id)
    LEFT JOIN (SELECT opportunity_account_id AS id, count(*) n FROM opportunities
               WHERE opportunity_is_deleted IS NOT TRUE GROUP BY 1) op USING (id)
  ),
  grp AS (SELECT norm FROM active GROUP BY norm HAVING count(*) > 1),
  ranked AS (
    SELECT act.*, l.n_links,
      row_number() OVER (PARTITION BY act.norm ORDER BY
        CASE WHEN act.rt = 'property_owner' THEN 0
             WHEN act.rt IS NOT NULL THEN 1
             ELSE 2 END,
        l.n_links DESC, act.account_created_at ASC, act.account_record_number ASC) AS rn
    FROM active act JOIN grp USING (norm) JOIN links l ON l.id = act.id
  )
  SELECT loser.id AS loser_id, loser.account_record_number AS loser_rn,
         surv.id AS survivor_id, surv.account_record_number AS survivor_rn
  FROM ranked loser
  JOIN ranked surv ON surv.norm = loser.norm AND surv.rn = 1
  WHERE loser.rn > 1;

  -- 3. Repoint every FK in the schema that references accounts(id) from loser to survivor.
  --    Same dynamic discovery the merge_accounts RPC uses; account_merge_log is history, not data.
  FOR rec IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.accounts'::regclass
      AND c.conrelid::regclass::text <> 'account_merge_log'
  LOOP
    IF rec.tbl = 'accounts' THEN
      EXECUTE format(
        'UPDATE accounts t SET %I = m.survivor_id FROM merge_map m
          WHERE t.%I = m.loser_id AND t.id <> m.survivor_id', rec.col, rec.col);
    ELSE
      EXECUTE format(
        'UPDATE %s t SET %I = m.survivor_id FROM merge_map m
          WHERE t.%I = m.loser_id', rec.tbl, rec.col, rec.col);
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'repointed % rows on %.%', n, rec.tbl, rec.col;
    END IF;
  END LOOP;

  -- Activity relations are polymorphic (no FK) — repoint account relations too.
  UPDATE activity_relations ar SET ar_related_id = m.survivor_id
  FROM merge_map m
  WHERE ar.ar_related_object = 'accounts' AND ar.ar_related_id = m.loser_id;

  -- 3b. Untyped survivors that own at least one property become Property Owner accounts.
  UPDATE accounts s SET
    account_record_type = v_owner_rt,
    account_updated_by = v_actor,
    account_updated_at = now()
  WHERE s.id IN (SELECT DISTINCT survivor_id FROM merge_map)
    AND s.account_record_type IS NULL
    AND EXISTS (SELECT 1 FROM properties p
                WHERE p.property_account_id = s.id AND p.property_is_deleted IS NOT TRUE);

  -- 4. Soft-delete the losers with a reason naming the survivor.
  UPDATE accounts a SET
    account_is_deleted = true,
    account_deleted_at = now(),
    account_deleted_by = v_actor,
    account_deletion_reason = 'Duplicate account merged into ' || m.survivor_rn ||
      ' (one account per company; Property Owner account is primary — dedupe 2026-07-25)',
    account_updated_by = v_actor,
    account_updated_at = now()
  FROM merge_map m
  WHERE a.id = m.loser_id;

  -- 5. Carry contact/address data the loser has and the survivor lacks onto the survivor.
  --    Runs AFTER the soft-delete: accounts_hud_participant_number_unique_idx only covers
  --    active rows, so the HUD number can move to the survivor once the loser is deleted.
  UPDATE accounts s SET
    account_phone   = coalesce(nullif(s.account_phone,   ''), l.account_phone),
    account_email   = coalesce(nullif(s.account_email,   ''), l.account_email),
    account_website = coalesce(nullif(s.account_website, ''), l.account_website),
    account_fax     = coalesce(nullif(s.account_fax,     ''), l.account_fax),
    billing_street  = coalesce(nullif(s.billing_street,  ''), l.billing_street),
    billing_city    = coalesce(nullif(s.billing_city,    ''), l.billing_city),
    billing_state   = coalesce(nullif(s.billing_state,   ''), l.billing_state),
    billing_zip     = coalesce(nullif(s.billing_zip,     ''), l.billing_zip),
    mailing_street  = coalesce(nullif(s.mailing_street,  ''), l.mailing_street),
    mailing_city    = coalesce(nullif(s.mailing_city,    ''), l.mailing_city),
    mailing_state   = coalesce(nullif(s.mailing_state,   ''), l.mailing_state),
    mailing_zip     = coalesce(nullif(s.mailing_zip,     ''), l.mailing_zip),
    account_hud_participant_number = coalesce(nullif(s.account_hud_participant_number, ''), l.account_hud_participant_number),
    account_pha_code = coalesce(nullif(s.account_pha_code, ''), l.account_pha_code),
    account_updated_by = v_actor,
    account_updated_at = now()
  FROM (
    SELECT m.survivor_id,
      (array_remove(array_agg(nullif(a.account_phone,   '')), NULL))[1] AS account_phone,
      (array_remove(array_agg(nullif(a.account_email,   '')), NULL))[1] AS account_email,
      (array_remove(array_agg(nullif(a.account_website, '')), NULL))[1] AS account_website,
      (array_remove(array_agg(nullif(a.account_fax,     '')), NULL))[1] AS account_fax,
      (array_remove(array_agg(nullif(a.billing_street,  '')), NULL))[1] AS billing_street,
      (array_remove(array_agg(nullif(a.billing_city,    '')), NULL))[1] AS billing_city,
      (array_remove(array_agg(nullif(a.billing_state,   '')), NULL))[1] AS billing_state,
      (array_remove(array_agg(nullif(a.billing_zip,     '')), NULL))[1] AS billing_zip,
      (array_remove(array_agg(nullif(a.mailing_street,  '')), NULL))[1] AS mailing_street,
      (array_remove(array_agg(nullif(a.mailing_city,    '')), NULL))[1] AS mailing_city,
      (array_remove(array_agg(nullif(a.mailing_state,   '')), NULL))[1] AS mailing_state,
      (array_remove(array_agg(nullif(a.mailing_zip,     '')), NULL))[1] AS mailing_zip,
      (array_remove(array_agg(nullif(a.account_hud_participant_number, '')), NULL))[1] AS account_hud_participant_number,
      (array_remove(array_agg(nullif(a.account_pha_code, '')), NULL))[1] AS account_pha_code
    FROM merge_map m JOIN accounts a ON a.id = m.loser_id
    GROUP BY m.survivor_id
  ) l
  WHERE s.id = l.survivor_id;

  -- 6. Audit: one merge-log row per pair, same table the merge_accounts RPC writes.
  INSERT INTO account_merge_log
    (aml_master_account_id, aml_merged_account_id, aml_field_overrides, aml_reparented_counts, aml_performed_by)
  SELECT m.survivor_id, m.loser_id, '{}'::jsonb,
         jsonb_build_object('bulk_dedupe', '2026-07-25'),
         v_actor
  FROM merge_map m;

  SELECT count(*) INTO n FROM merge_map;
  RAISE NOTICE 'merged % duplicate accounts', n;
END $$;
