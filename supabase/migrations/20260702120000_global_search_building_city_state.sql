-- Buildings search results: show city and state in the secondary label.
-- The Buildings tab on the global search page (and the search modal) renders
-- whatever secondary_label the RPC returns; it was building_address alone,
-- which is NULL on every live building today, so the subtitle was blank.
-- Now "address, city, state" from the building's own columns, falling back
-- to the parent property's city/state when the building carries none (the
-- current state of all 32 live buildings). Applied to both the exact-match
-- RPC (global_search) and the "did you mean" fallback (fuzzy_match_records)
-- so the two surfaces agree. Everything else in both functions is unchanged
-- from the live definitions.

CREATE OR REPLACE FUNCTION public.global_search(p_query text, p_limit_per_object integer DEFAULT 5, p_object_type text DEFAULT NULL::text)
 RETURNS TABLE(object_type text, object_label text, table_name text, id uuid, primary_label text, secondary_label text, record_number text, match_rank integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
  WITH p AS (
    SELECT NULLIF(TRIM(p_query), '') AS q
  ),
  pat AS (
    SELECT q,
           '%' || q || '%' AS like_pat,
           q || '%'        AS prefix_pat
    FROM p
    WHERE q IS NOT NULL AND length(q) >= 2
  ),

  q_accounts AS (
    SELECT 'account'::text AS object_type, 'Accounts'::text AS object_label, 'accounts'::text AS table_name,
           a.id, a.account_name AS primary_label,
           COALESCE(a.account_organization_name, a.account_email, a.account_phone) AS secondary_label,
           a.account_record_number AS record_number,
           CASE
             WHEN a.account_record_number    ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN a.account_name             ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN a.account_name             ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3
           END AS match_rank
    FROM accounts a, pat
    WHERE a.account_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'account')
      AND ( a.account_name ILIKE pat.like_pat OR a.account_record_number ILIKE pat.prefix_pat
         OR a.account_organization_name ILIKE pat.like_pat OR a.account_email ILIKE pat.like_pat
         OR a.account_phone ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_contacts AS (
    SELECT 'contact'::text, 'Contacts'::text, 'contacts'::text, c.id,
           COALESCE(c.contact_name, NULLIF(TRIM(COALESCE(c.contact_first_name,'') || ' ' || COALESCE(c.contact_last_name,'')), '')),
           COALESCE(c.contact_email, c.contact_mobile_phone, c.contact_phone), c.contact_record_number,
           CASE
             WHEN c.contact_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN c.contact_last_name     ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN c.contact_first_name    ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN c.contact_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN c.contact_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM contacts c, pat
    WHERE c.contact_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'contact')
      AND ( c.contact_name ILIKE pat.like_pat OR c.contact_first_name ILIKE pat.like_pat
         OR c.contact_last_name ILIKE pat.like_pat OR c.contact_record_number ILIKE pat.prefix_pat
         OR c.contact_email ILIKE pat.like_pat OR c.contact_mobile_phone ILIKE pat.like_pat
         OR c.contact_phone ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_properties AS (
    SELECT 'property'::text, 'Properties'::text, 'properties'::text, p2.id,
           p2.property_name, p2.property_aka_name, p2.property_record_number,
           CASE
             WHEN p2.property_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN p2.property_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN p2.property_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM properties p2, pat
    WHERE p2.property_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'property')
      AND ( p2.property_name ILIKE pat.like_pat OR p2.property_aka_name ILIKE pat.like_pat
         OR p2.property_record_number ILIKE pat.prefix_pat OR p2.property_subdivision_name ILIKE pat.like_pat
         OR p2.property_hud_property_id ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_buildings AS (
    SELECT 'building'::text, 'Buildings'::text, 'buildings'::text, b.id,
           COALESCE(b.building_name, b.building_number_or_name),
           COALESCE(
             NULLIF(CONCAT_WS(', ',
               NULLIF(TRIM(b.building_address), ''),
               NULLIF(TRIM(b.building_city), ''),
               NULLIF(TRIM(b.building_state), '')
             ), ''),
             NULLIF(CONCAT_WS(', ',
               NULLIF(TRIM(bp.property_city), ''),
               NULLIF(TRIM(bp.property_state), '')
             ), '')
           ),
           b.building_record_number,
           CASE
             WHEN b.building_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN b.building_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN b.building_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM buildings b LEFT JOIN properties bp ON bp.id = b.property_id, pat
    WHERE b.building_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'building')
      AND ( b.building_name ILIKE pat.like_pat OR b.building_number_or_name ILIKE pat.like_pat
         OR b.building_record_number ILIKE pat.prefix_pat OR b.building_address ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_units AS (
    SELECT 'unit'::text, 'Units'::text, 'units'::text, u.id,
           COALESCE(u.unit_name, u.unit_number), u.unit_tenant_name, u.unit_record_number,
           CASE
             WHEN u.unit_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN u.unit_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN u.unit_number        ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN u.unit_tenant_name   ILIKE (SELECT prefix_pat FROM pat) THEN 1
             ELSE 2 END
    FROM units u, pat
    WHERE u.unit_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'unit')
      AND ( u.unit_name ILIKE pat.like_pat OR u.unit_number ILIKE pat.like_pat
         OR u.unit_record_number ILIKE pat.prefix_pat OR u.unit_tenant_name ILIKE pat.like_pat
         OR u.unit_tenant_email ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_opportunities AS (
    SELECT 'opportunity'::text, 'Opportunities'::text, 'opportunities'::text, o.id,
           o.opportunity_name, o.opportunity_subdivision_name, o.opportunity_record_number,
           CASE
             WHEN o.opportunity_record_number             ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN o.opportunity_external_reference_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN o.opportunity_name                      ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN o.opportunity_name                      ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM opportunities o, pat
    WHERE o.opportunity_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'opportunity')
      AND ( o.opportunity_name ILIKE pat.like_pat OR o.opportunity_record_number ILIKE pat.prefix_pat
         OR o.opportunity_external_reference_number ILIKE pat.prefix_pat OR o.opportunity_subdivision_name ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_projects AS (
    SELECT 'project'::text, 'Projects'::text, 'projects'::text, pr.id,
           pr.project_name, pr.project_program_name, pr.project_record_number,
           CASE
             WHEN pr.project_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN pr.project_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN pr.project_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM projects pr, pat
    WHERE pr.project_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'project')
      AND ( pr.project_name ILIKE pat.like_pat OR pr.project_record_number ILIKE pat.prefix_pat
         OR pr.project_program_name ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_work_orders AS (
    SELECT 'work_order'::text, 'Work Orders'::text, 'work_orders'::text, wo.id,
           COALESCE(wo.work_order_name, wo.work_order_property_name), wo.work_order_customer_name, wo.work_order_record_number,
           CASE
             WHEN wo.work_order_record_number   ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN wo.work_order_external_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN wo.work_order_name            ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN wo.work_order_property_name   ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN wo.work_order_name            ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM work_orders wo, pat
    WHERE wo.work_order_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'work_order')
      AND ( wo.work_order_name ILIKE pat.like_pat OR wo.work_order_record_number ILIKE pat.prefix_pat
         OR wo.work_order_external_number ILIKE pat.prefix_pat OR wo.work_order_property_name ILIKE pat.like_pat
         OR wo.work_order_customer_name ILIKE pat.like_pat OR wo.work_order_contact_name ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_incentive_applications AS (
    SELECT 'incentive_application'::text, 'Incentive Applications'::text, 'incentive_applications'::text, ia.id,
           ia.ia_name, ia.ia_program_name, ia.ia_record_number,
           CASE
             WHEN ia.ia_record_number       ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN ia.ia_name                ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN ia.ia_applicant_name      ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN ia.ia_building_owner_name ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN ia.ia_name                ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM incentive_applications ia, pat
    WHERE ia.ia_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'incentive_application')
      AND ( ia.ia_name ILIKE pat.like_pat OR ia.ia_record_number ILIKE pat.prefix_pat
         OR ia.ia_program_name ILIKE pat.like_pat OR ia.ia_applicant_name ILIKE pat.like_pat
         OR ia.ia_building_owner_name ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_assessments AS (
    SELECT 'assessment'::text, 'Assessments'::text, 'assessments'::text, a2.id,
           a2.assessment_name, COALESCE(a2.assessment_applicant_name, a2.assessment_building_owner_name), a2.assessment_record_number,
           CASE
             WHEN a2.assessment_record_number   ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN a2.assessment_name            ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN a2.assessment_applicant_name  ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN a2.assessment_name            ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM assessments a2, pat
    WHERE a2.assessment_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'assessment')
      AND ( a2.assessment_name ILIKE pat.like_pat OR a2.assessment_record_number ILIKE pat.prefix_pat
         OR a2.assessment_applicant_name ILIKE pat.like_pat OR a2.assessment_building_owner_name ILIKE pat.like_pat
         OR a2.assessment_building_address ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_programs AS (
    SELECT 'program'::text, 'Programs'::text, 'programs'::text, pg.id,
           pg.name, pg.short_name, NULL::text,
           CASE
             WHEN pg.short_name ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN pg.name       ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN pg.name       ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM programs pg, pat
    WHERE pg.is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'program')
      AND ( pg.name ILIKE pat.like_pat OR pg.short_name ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_vehicles AS (
    SELECT 'vehicle'::text, 'Vehicles'::text, 'vehicles'::text, v.id,
           v.vehicle_name, v.vehicle_vin_last_3, v.vehicle_record_number,
           CASE
             WHEN v.vehicle_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN v.vehicle_vin_last_3    ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN v.vehicle_vin           ILIKE (SELECT like_pat   FROM pat) THEN 1
             WHEN v.vehicle_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN v.vehicle_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM vehicles v, pat
    WHERE v.vehicle_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'vehicle')
      AND ( v.vehicle_name ILIKE pat.like_pat OR v.vehicle_record_number ILIKE pat.prefix_pat
         OR v.vehicle_vin ILIKE pat.like_pat OR v.vehicle_vin_last_3 ILIKE pat.prefix_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_equipment AS (
    SELECT 'equipment'::text, 'Equipment'::text, 'equipment'::text, e.id,
           COALESCE(e.equipment_name, e.equipment_equipment_name_or_number), e.equipment_serial_number, e.equipment_record_number,
           CASE
             WHEN e.equipment_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN e.equipment_serial_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN e.equipment_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN e.equipment_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM equipment e, pat
    WHERE e.equipment_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'equipment')
      AND ( e.equipment_name ILIKE pat.like_pat OR e.equipment_equipment_name_or_number ILIKE pat.like_pat
         OR e.equipment_record_number ILIKE pat.prefix_pat OR e.equipment_serial_number ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_product_items AS (
    SELECT 'product_item'::text, 'Product Items'::text, 'product_items'::text, pi.id,
           pi.product_item_name, pi.product_item_serial_number, pi.product_item_record_number,
           CASE
             WHEN pi.product_item_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN pi.product_item_serial_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN pi.product_item_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN pi.product_item_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM product_items pi, pat
    WHERE pi.product_item_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'product_item')
      AND ( pi.product_item_name ILIKE pat.like_pat OR pi.product_item_record_number ILIKE pat.prefix_pat
         OR pi.product_item_serial_number ILIKE pat.like_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_users AS (
    SELECT 'user'::text, 'Users'::text, 'users'::text, u2.id,
           COALESCE(u2.user_name, NULLIF(TRIM(COALESCE(u2.user_first_name,'') || ' ' || COALESCE(u2.user_last_name,'')), '')),
           u2.user_email, u2.user_record_number,
           CASE
             WHEN u2.user_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN u2.user_last_name     ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN u2.user_first_name    ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN u2.user_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN u2.user_email         ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN u2.user_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM users u2, pat
    WHERE u2.user_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'user')
      AND ( u2.user_name ILIKE pat.like_pat OR u2.user_first_name ILIKE pat.like_pat
         OR u2.user_last_name ILIKE pat.like_pat OR u2.user_email ILIKE pat.like_pat
         OR u2.user_record_number ILIKE pat.prefix_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_envelopes AS (
    SELECT 'envelope'::text, 'Signature Envelopes'::text, 'envelopes'::text, ev.id,
           ev.env_name, NULL::text, ev.env_record_number,
           CASE
             WHEN ev.env_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN ev.env_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN ev.env_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM envelopes ev, pat
    WHERE ev.is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'envelope')
      AND ( ev.env_name ILIKE pat.like_pat OR ev.env_record_number ILIKE pat.prefix_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),
  q_service_appointments AS (
    SELECT 'service_appointment'::text, 'Service Appointments'::text, 'service_appointments'::text, sa.id,
           sa.sa_name, NULL::text, sa.sa_record_number,
           CASE
             WHEN sa.sa_record_number ILIKE (SELECT prefix_pat FROM pat) THEN 0
             WHEN sa.sa_name          ILIKE (SELECT prefix_pat FROM pat) THEN 1
             WHEN sa.sa_name          ILIKE (SELECT like_pat   FROM pat) THEN 2
             ELSE 3 END
    FROM service_appointments sa, pat
    WHERE sa.sa_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'service_appointment')
      AND ( sa.sa_name ILIKE pat.like_pat OR sa.sa_record_number ILIKE pat.prefix_pat )
    ORDER BY 8, 5 LIMIT p_limit_per_object
  ),

  exact AS (
    SELECT * FROM q_accounts               UNION ALL
    SELECT * FROM q_contacts               UNION ALL
    SELECT * FROM q_properties             UNION ALL
    SELECT * FROM q_buildings              UNION ALL
    SELECT * FROM q_units                  UNION ALL
    SELECT * FROM q_opportunities          UNION ALL
    SELECT * FROM q_projects               UNION ALL
    SELECT * FROM q_work_orders            UNION ALL
    SELECT * FROM q_incentive_applications UNION ALL
    SELECT * FROM q_assessments            UNION ALL
    SELECT * FROM q_programs               UNION ALL
    SELECT * FROM q_vehicles               UNION ALL
    SELECT * FROM q_equipment              UNION ALL
    SELECT * FROM q_product_items          UNION ALL
    SELECT * FROM q_users                  UNION ALL
    SELECT * FROM q_envelopes              UNION ALL
    SELECT * FROM q_service_appointments
  ),

  -- "Did you mean" suggestions. Fire ONLY on a true miss (no exact hits) for
  -- name-like queries (>= 3 chars). Keep only candidates whose VISIBLE label
  -- (primary_label) is itself a close match (word_similarity >= 0.3), so a user
  -- never sees a suggestion whose displayed name looks unrelated. Best-first.
  suggestions AS (
    SELECT f.object_type, f.object_label, f.table_name, f.id,
           f.primary_label, f.secondary_label, f.record_number,
           9 AS match_rank,
           word_similarity((SELECT q FROM p), f.primary_label) AS vis_score
    FROM fuzzy_match_records((SELECT q FROM p), p_object_type, 0.4, 12) f
    WHERE (SELECT q FROM p) IS NOT NULL
      AND length((SELECT q FROM p)) >= 3
      AND NOT EXISTS (SELECT 1 FROM exact)
      AND word_similarity((SELECT q FROM p), f.primary_label) >= 0.3
    ORDER BY vis_score DESC, f.primary_label ASC
    LIMIT 5
  ),

  combined AS (
    SELECT object_type, object_label, table_name, id, primary_label, secondary_label, record_number, match_rank,
           NULL::real AS vis_score
    FROM exact
    UNION ALL
    SELECT object_type, object_label, table_name, id, primary_label, secondary_label, record_number, match_rank,
           vis_score
    FROM suggestions
  )

  SELECT object_type, object_label, table_name, id, primary_label, secondary_label, record_number, match_rank
  FROM combined
  ORDER BY match_rank ASC, vis_score DESC NULLS LAST, primary_label ASC
$function$
;

CREATE OR REPLACE FUNCTION public.fuzzy_match_records(p_query text, p_object_type text DEFAULT NULL::text, p_threshold real DEFAULT 0.3, p_limit integer DEFAULT 8)
 RETURNS TABLE(object_type text, object_label text, table_name text, id uuid, primary_label text, secondary_label text, record_number text, score real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
  WITH p AS (
    SELECT NULLIF(TRIM(p_query), '') AS q,
           GREATEST(COALESCE(p_threshold, 0.3), 0.05) AS thr,
           LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25) AS lim
  ),
  cand AS (
    -- Accounts
    SELECT 'account'::text AS object_type, 'Accounts'::text AS object_label, 'accounts'::text AS table_name,
           a.id,
           a.account_name AS primary_label,
           COALESCE(a.account_organization_name, a.account_email, a.account_phone) AS secondary_label,
           a.account_record_number AS record_number,
           word_similarity((SELECT q FROM p), a.account_name) AS score
    FROM accounts a
    WHERE a.account_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'account')
      AND a.account_name IS NOT NULL
      AND word_similarity((SELECT q FROM p), a.account_name) >= (SELECT thr FROM p)

    UNION ALL
    -- Contacts (match against the composed display name)
    SELECT 'contact', 'Contacts', 'contacts',
           c.id,
           COALESCE(c.contact_name, NULLIF(TRIM(COALESCE(c.contact_first_name,'') || ' ' || COALESCE(c.contact_last_name,'')), '')) AS primary_label,
           COALESCE(c.contact_email, c.contact_mobile_phone, c.contact_phone),
           c.contact_record_number,
           word_similarity(
             (SELECT q FROM p),
             COALESCE(c.contact_name, NULLIF(TRIM(COALESCE(c.contact_first_name,'') || ' ' || COALESCE(c.contact_last_name,'')), ''), '')
           ) AS score
    FROM contacts c
    WHERE c.contact_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'contact')
      AND word_similarity(
            (SELECT q FROM p),
            COALESCE(c.contact_name, NULLIF(TRIM(COALESCE(c.contact_first_name,'') || ' ' || COALESCE(c.contact_last_name,'')), ''), '')
          ) >= (SELECT thr FROM p)

    UNION ALL
    -- Properties (name + aka)
    SELECT 'property', 'Properties', 'properties',
           p2.id, p2.property_name, p2.property_aka_name, p2.property_record_number,
           GREATEST(
             word_similarity((SELECT q FROM p), COALESCE(p2.property_name,'')),
             word_similarity((SELECT q FROM p), COALESCE(p2.property_aka_name,''))
           ) AS score
    FROM properties p2
    WHERE p2.property_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'property')
      AND GREATEST(
            word_similarity((SELECT q FROM p), COALESCE(p2.property_name,'')),
            word_similarity((SELECT q FROM p), COALESCE(p2.property_aka_name,''))
          ) >= (SELECT thr FROM p)

    UNION ALL
    -- Buildings
    SELECT 'building', 'Buildings', 'buildings',
           b.id,
           COALESCE(b.building_name, b.building_number_or_name) AS primary_label,
           COALESCE(
             NULLIF(CONCAT_WS(', ',
               NULLIF(TRIM(b.building_address), ''),
               NULLIF(TRIM(b.building_city), ''),
               NULLIF(TRIM(b.building_state), '')
             ), ''),
             NULLIF(CONCAT_WS(', ',
               NULLIF(TRIM(bp.property_city), ''),
               NULLIF(TRIM(bp.property_state), '')
             ), '')
           ),
           b.building_record_number,
           word_similarity((SELECT q FROM p), COALESCE(b.building_name, b.building_number_or_name, '')) AS score
    FROM buildings b LEFT JOIN properties bp ON bp.id = b.property_id
    WHERE b.building_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'building')
      AND word_similarity((SELECT q FROM p), COALESCE(b.building_name, b.building_number_or_name, '')) >= (SELECT thr FROM p)

    UNION ALL
    -- Opportunities
    SELECT 'opportunity', 'Opportunities', 'opportunities',
           o.id, o.opportunity_name, o.opportunity_subdivision_name, o.opportunity_record_number,
           word_similarity((SELECT q FROM p), COALESCE(o.opportunity_name,'')) AS score
    FROM opportunities o
    WHERE o.opportunity_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'opportunity')
      AND word_similarity((SELECT q FROM p), COALESCE(o.opportunity_name,'')) >= (SELECT thr FROM p)

    UNION ALL
    -- Projects
    SELECT 'project', 'Projects', 'projects',
           pr.id, pr.project_name, pr.project_program_name, pr.project_record_number,
           word_similarity((SELECT q FROM p), COALESCE(pr.project_name,'')) AS score
    FROM projects pr
    WHERE pr.project_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'project')
      AND word_similarity((SELECT q FROM p), COALESCE(pr.project_name,'')) >= (SELECT thr FROM p)

    UNION ALL
    -- Work orders
    SELECT 'work_order', 'Work Orders', 'work_orders',
           wo.id,
           COALESCE(wo.work_order_name, wo.work_order_property_name) AS primary_label,
           wo.work_order_customer_name, wo.work_order_record_number,
           word_similarity((SELECT q FROM p), COALESCE(wo.work_order_name, wo.work_order_property_name, '')) AS score
    FROM work_orders wo
    WHERE wo.work_order_is_deleted = false
      AND (p_object_type IS NULL OR p_object_type = 'work_order')
      AND word_similarity((SELECT q FROM p), COALESCE(wo.work_order_name, wo.work_order_property_name, '')) >= (SELECT thr FROM p)
  )
  SELECT object_type, object_label, table_name, id, primary_label, secondary_label, record_number, score
  FROM cand, p
  WHERE p.q IS NOT NULL AND length(p.q) >= 2
  ORDER BY score DESC, primary_label ASC
  LIMIT (SELECT lim FROM p)
$function$
;

-- Re-issue grants (belt and braces — CREATE OR REPLACE preserves them, but the
-- house rule after any function DDL is to re-grant and reload PostgREST).
REVOKE ALL ON FUNCTION public.global_search(p_query text, p_limit_per_object integer, p_object_type text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.global_search(p_query text, p_limit_per_object integer, p_object_type text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.global_search(p_query text, p_limit_per_object integer, p_object_type text) TO postgres;
GRANT EXECUTE ON FUNCTION public.global_search(p_query text, p_limit_per_object integer, p_object_type text) TO service_role;

REVOKE ALL ON FUNCTION public.fuzzy_match_records(p_query text, p_object_type text, p_threshold real, p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fuzzy_match_records(p_query text, p_object_type text, p_threshold real, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuzzy_match_records(p_query text, p_object_type text, p_threshold real, p_limit integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.fuzzy_match_records(p_query text, p_object_type text, p_threshold real, p_limit integer) TO service_role;

NOTIFY pgrst, 'reload schema';
