-- Duplicate checking at record creation (accounts / properties / buildings).
-- Nicholas (2026-07-26): warn the user at create time when a new account, property, or
-- building is an exact or close match for an existing record — names and addresses both.
-- Purpose-built RPC consumed by the create form's duplicate-warning panel in LEAP.
--
-- Matching rules:
--   accounts   — exact normalized-name match (punctuation + entity suffixes stripped),
--                then trigram-similar names.
--   properties — same normalized street address (+ zip5 or city), exact normalized name,
--                then trigram-similar names.
--   buildings  — scoped to the parent property: same or similar building number/name.
-- SECURITY INVOKER: results respect RLS, callers only see records they can already read.

-- 1. Purpose-built name normalizer for company/record duplicate matching.
--    Uppercases, strips punctuation, drops trailing/leading entity words, collapses spaces.
CREATE OR REPLACE FUNCTION public.normalize_duplicate_match_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT NULLIF(trim(regexp_replace(
    regexp_replace(
      regexp_replace(upper(coalesce(p_name, '')), '[^A-Z0-9 ]', ' ', 'g'),
      '\m(LLC|INC|INCORPORATED|LP|LLP|LTD|LIMITED PARTNERSHIP|LIMITED|CORP|CORPORATION|CO|COMPANY|THE)\M', '', 'g'),
    '\s+', ' ', 'g')), '')
$$;

REVOKE ALL ON FUNCTION public.normalize_duplicate_match_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_duplicate_match_name(text) TO authenticated, service_role;

-- 2. Indexes for fast probes while the user types.
CREATE INDEX IF NOT EXISTS accounts_account_name_trgm_idx
  ON public.accounts USING gin (lower(account_name) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS accounts_normalized_dup_name_idx
  ON public.accounts (normalize_duplicate_match_name(account_name))
  WHERE account_is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS properties_property_name_trgm_idx
  ON public.properties USING gin (lower(property_name) extensions.gin_trgm_ops);

-- 3. The duplicate-candidate finder.
CREATE OR REPLACE FUNCTION public.find_duplicate_candidates(
  p_object       text,
  p_name         text DEFAULT NULL,
  p_street       text DEFAULT NULL,
  p_city         text DEFAULT NULL,
  p_state        text DEFAULT NULL,
  p_zip          text DEFAULT NULL,
  p_property_id  uuid DEFAULT NULL,
  p_exclude_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  record_id     uuid,
  record_number text,
  record_name   text,
  match_type    text,
  match_detail  text,
  match_score   real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $$
DECLARE
  v_norm_name   text := normalize_duplicate_match_name(p_name);
  v_norm_street text;
  v_zip5        text := NULLIF(left(trim(coalesce(p_zip, '')), 5), '');
BEGIN
  IF p_object = 'accounts' THEN
    IF v_norm_name IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT a.id, a.account_record_number, a.account_name,
           CASE WHEN normalize_duplicate_match_name(a.account_name) = v_norm_name
                THEN 'exact_name' ELSE 'similar_name' END,
           CASE WHEN normalize_duplicate_match_name(a.account_name) = v_norm_name
                THEN 'Same company name (ignoring punctuation and suffixes like LLC / Inc.)'
                ELSE 'Similar company name' END,
           similarity(lower(a.account_name), lower(p_name))::real
    FROM accounts a
    WHERE a.account_is_deleted IS NOT TRUE
      AND (p_exclude_id IS NULL OR a.id <> p_exclude_id)
      AND (normalize_duplicate_match_name(a.account_name) = v_norm_name
           OR (lower(a.account_name) % lower(p_name)
               AND similarity(lower(a.account_name), lower(p_name)) >= 0.55))
    ORDER BY (normalize_duplicate_match_name(a.account_name) = v_norm_name) DESC,
             similarity(lower(a.account_name), lower(p_name)) DESC
    LIMIT 8;

  ELSIF p_object = 'properties' THEN
    v_norm_street := CASE WHEN p_street IS NULL OR trim(p_street) = '' THEN NULL
                          ELSE normalize_street_address(p_street) END;
    IF v_norm_name IS NULL AND v_norm_street IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT p.id, p.property_record_number, p.property_name,
           CASE WHEN v_norm_street IS NOT NULL
                     AND normalize_street_address(p.property_street) = v_norm_street
                     AND (v_zip5 IS NULL OR left(trim(coalesce(p.property_zip,'')),5) = v_zip5)
                     AND (p_city IS NULL OR trim(p_city) = ''
                          OR upper(trim(p.property_city)) = upper(trim(p_city)))
                THEN 'same_address'
                WHEN v_norm_name IS NOT NULL
                     AND normalize_duplicate_match_name(p.property_name) = v_norm_name
                THEN 'exact_name' ELSE 'similar_name' END,
           CASE WHEN v_norm_street IS NOT NULL
                     AND normalize_street_address(p.property_street) = v_norm_street
                     AND (v_zip5 IS NULL OR left(trim(coalesce(p.property_zip,'')),5) = v_zip5)
                     AND (p_city IS NULL OR trim(p_city) = ''
                          OR upper(trim(p.property_city)) = upper(trim(p_city)))
                THEN 'Same street address'
                     || coalesce(' in ' || nullif(trim(p.property_city),''), '')
                WHEN v_norm_name IS NOT NULL
                     AND normalize_duplicate_match_name(p.property_name) = v_norm_name
                THEN 'Same property name'
                ELSE 'Similar property name' END,
           greatest(
             CASE WHEN v_norm_name IS NULL THEN 0
                  ELSE similarity(lower(p.property_name), lower(p_name)) END,
             CASE WHEN v_norm_street IS NOT NULL
                       AND normalize_street_address(p.property_street) = v_norm_street
                  THEN 1.0 ELSE 0 END)::real
    FROM properties p
    WHERE p.property_is_deleted IS NOT TRUE
      AND (p_exclude_id IS NULL OR p.id <> p_exclude_id)
      AND (
        (v_norm_street IS NOT NULL
         AND normalize_street_address(p.property_street) = v_norm_street
         AND (v_zip5 IS NULL OR left(trim(coalesce(p.property_zip,'')),5) = v_zip5)
         AND (p_city IS NULL OR trim(p_city) = ''
              OR upper(trim(p.property_city)) = upper(trim(p_city))))
        OR (v_norm_name IS NOT NULL
            AND (normalize_duplicate_match_name(p.property_name) = v_norm_name
                 OR (lower(p.property_name) % lower(p_name)
                     AND similarity(lower(p.property_name), lower(p_name)) >= 0.55)))
      )
    ORDER BY 6 DESC
    LIMIT 8;

  ELSIF p_object = 'buildings' THEN
    IF p_property_id IS NULL OR v_norm_name IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT b.id, b.building_record_number,
           coalesce(b.building_name, b.building_number_or_name),
           CASE WHEN normalize_duplicate_match_name(b.building_number_or_name) = v_norm_name
                     OR normalize_duplicate_match_name(b.building_name) = v_norm_name
                THEN 'exact_name' ELSE 'similar_name' END,
           CASE WHEN normalize_duplicate_match_name(b.building_number_or_name) = v_norm_name
                     OR normalize_duplicate_match_name(b.building_name) = v_norm_name
                THEN 'Same building number/name on this property'
                ELSE 'Similar building number/name on this property' END,
           greatest(similarity(lower(coalesce(b.building_number_or_name,'')), lower(p_name)),
                    similarity(lower(coalesce(b.building_name,'')), lower(p_name)))::real
    FROM buildings b
    WHERE b.building_is_deleted IS NOT TRUE
      AND b.property_id = p_property_id
      AND (p_exclude_id IS NULL OR b.id <> p_exclude_id)
      AND (normalize_duplicate_match_name(b.building_number_or_name) = v_norm_name
           OR normalize_duplicate_match_name(b.building_name) = v_norm_name
           OR similarity(lower(coalesce(b.building_number_or_name,'')), lower(p_name)) >= 0.5
           OR similarity(lower(coalesce(b.building_name,'')), lower(p_name)) >= 0.5)
    ORDER BY 6 DESC
    LIMIT 8;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.find_duplicate_candidates(text, text, text, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_duplicate_candidates(text, text, text, text, text, text, uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
