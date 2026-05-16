-- team_leads_qualified_for_work_orders — qualification helper for the
-- Project Scheduler wizard. Returns one row per active Team Lead with
-- qualified=true/false based on certification coverage for a given batch
-- of work orders.
--
-- A lead is qualified when they hold every cert required by every WO in
-- the batch, with cc_expires_date NULL or >= p_start_date.

CREATE OR REPLACE FUNCTION public.team_leads_qualified_for_work_orders(
  p_work_order_ids uuid[],
  p_start_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  contact_id        uuid,
  full_name         text,
  contact_title     text,
  crew_label        text,
  qualified         boolean,
  missing_certs     text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF public.current_app_user_id() IS NULL THEN
    RAISE EXCEPTION 'team_leads_qualified_for_work_orders: caller not authenticated' USING ERRCODE='28000';
  END IF;

  RETURN QUERY
  WITH leads AS (
    SELECT c.id, c.contact_first_name, c.contact_last_name, c.contact_title
      FROM contacts c
     WHERE c.contact_is_deleted = false
       AND c.contact_title ILIKE '%team lead%'
  ),
  required AS (
    SELECT DISTINCT cert.id AS cert_id, cert.certification_name
      FROM unnest(COALESCE(p_work_order_ids, ARRAY[]::uuid[])) AS uw(wo_id)
      JOIN work_orders wo ON wo.id = uw.wo_id
      JOIN work_type_required_certifications wtrc
        ON wtrc.work_type_id = wo.work_type_id AND wtrc.wtrc_is_deleted = false
      JOIN certifications cert
        ON cert.id = wtrc.certification_id
       AND COALESCE(cert.certification_is_active, true) = true
       AND COALESCE(cert.certification_is_deleted, false) = false
  ),
  per_lead_missing AS (
    SELECT l.id AS contact_id,
           r.cert_id, r.certification_name,
           EXISTS (
             SELECT 1 FROM contact_certifications cc
              WHERE cc.contact_id = l.id
                AND cc.certification_id = r.cert_id
                AND COALESCE(cc.cc_is_deleted, false) = false
                AND (cc.cc_expires_date IS NULL OR cc.cc_expires_date >= p_start_date)
           ) AS held
      FROM leads l CROSS JOIN required r
  ),
  per_lead_summary AS (
    SELECT pm.contact_id,
           string_agg(pm.certification_name, ', ' ORDER BY pm.certification_name)
             FILTER (WHERE NOT pm.held) AS missing_certs
      FROM per_lead_missing pm
     GROUP BY pm.contact_id
  )
  SELECT l.id AS contact_id,
         TRIM(BOTH ' ' FROM COALESCE(l.contact_first_name,'') || ' ' || COALESCE(l.contact_last_name,'')) AS full_name,
         l.contact_title,
         CASE
           WHEN l.contact_title ILIKE '%—%'
             THEN TRIM(BOTH ' ' FROM SPLIT_PART(l.contact_title, '—', 2))
           WHEN l.contact_title ILIKE '%-%'
             THEN TRIM(BOTH ' ' FROM SPLIT_PART(l.contact_title, '-', 2))
           ELSE NULL
         END AS crew_label,
         COALESCE(s.missing_certs, '') = '' AS qualified,
         s.missing_certs
    FROM leads l
    LEFT JOIN per_lead_summary s ON s.contact_id = l.id
   ORDER BY (COALESCE(s.missing_certs, '') = '') DESC,
            l.contact_last_name, l.contact_first_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.team_leads_qualified_for_work_orders FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_leads_qualified_for_work_orders TO authenticated;

COMMENT ON FUNCTION public.team_leads_qualified_for_work_orders IS
'Returns all active Team Leads with qualified=true/false based on cert coverage for the supplied WO batch. The wizard uses this to gate the lead dropdown — unqualified leads show with a missing-certs tooltip and disabled state.';
