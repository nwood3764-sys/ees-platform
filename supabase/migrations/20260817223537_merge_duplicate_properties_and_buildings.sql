-- Merge duplicate properties and buildings without losing any child record.
--
-- Nicholas, 2026-08-17: "how do we fix this or merge all of these and not lose
-- any of the detailed child records?... I mean photos, attachments,
-- communications, anything. And everything."
--
-- The measured picture: 872 duplicate address groups covering 1,753 live
-- properties, of which 871 had NOTHING attached to any member (bare HUD import
-- rows) and exactly one — 15008 Statesville Road — had children on two members.
--
-- Why photos and documents cannot be lost by this: they do not attach to a
-- property. All 614 photos hang off work_steps; documents hang off accounts,
-- enrollments, opportunities and work_steps. Nothing below the property level is
-- touched, so the whole chain travels intact.
--
-- What the FK graph CANNOT see, and is swept explicitly: the polymorphic
-- (object, id) tables. activity_relations holds rows on properties and buildings
-- with no foreign key — the same trap handled in the 2026-07-25 account merge.
--
-- THE SAFETY RULE, learned from a dry run rather than assumed. LEAP forbids
-- reparenting: "building property_id cannot be changed after creation" and
-- "unit building_id cannot be changed after creation". A first version ignored
-- that, and the dry run showed the cost — a loser's buildings could not follow
-- it and were destroyed with it (buildings 71 -> 67, units 179 -> 175, one
-- orphan). So a pair is merged ONLY when the loser is completely childless,
-- which makes loss structurally impossible: the survivor keeps everything it
-- had and the loser had nothing to keep. Any pair whose loser owns records is
-- reported in pairs_left_alone and left for a person.
--
-- Losers are SOFT-deleted, which is also what makes the 1:1 side tables safe:
-- a soft-deleted property still exists, so property_source_data and
-- property_disaster_exposure (both UNIQUE per property) stay attached to it
-- instead of colliding with the survivor's row. Those two are the only expected
-- entries in tables_skipped.
--
-- This supersedes the four earlier shapes of this function applied the same day
-- (versions 20260817204939 / 205132 / 205515 / 205757), none of which was ever
-- run against live data, plus the unused helper repoint_all_references.

CREATE TABLE IF NOT EXISTS public.property_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pml_object text NOT NULL CHECK (pml_object IN ('properties','buildings')),
  pml_survivor_id uuid NOT NULL,
  pml_merged_id uuid NOT NULL,
  pml_match_key text,
  pml_field_overrides jsonb,
  pml_reparented_counts jsonb,
  pml_skipped jsonb,
  pml_performed_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS property_merge_log_survivor_idx ON public.property_merge_log (pml_survivor_id);
CREATE INDEX IF NOT EXISTS property_merge_log_merged_idx   ON public.property_merge_log (pml_merged_id);

ALTER TABLE public.property_merge_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_merge_log_admin_read ON public.property_merge_log;
CREATE POLICY property_merge_log_admin_read ON public.property_merge_log
  FOR SELECT USING (public.app_user_can('properties', 'read'));

DROP FUNCTION IF EXISTS public.repoint_all_references(text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.merge_duplicate_properties(p_max_pairs int DEFAULT 2000)
 RETURNS TABLE(properties_merged int, buildings_merged int, references_moved bigint,
               pairs_left_alone int, tables_skipped jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := public.current_app_user_id();
  v_props int := 0; v_blds int := 0; v_refs bigint := 0; v_n bigint; v_left int := 0;
  v_skip jsonb := '{}'::jsonb;
  v_sql text; r record; i int;
  POLY constant text[][] := ARRAY[
    ARRAY['activity_relations','ar_related_object','ar_related_id'],
    ARRAY['photos','related_object','related_id'],
    ARRAY['documents','related_object','related_id'],
    ARRAY['activities','related_object','related_id'],
    ARRAY['comments','related_object','related_id'],
    ARRAY['tasks','related_object','related_id'],
    ARRAY['notifications','related_object','related_id'],
    ARRAY['envelopes','env_parent_object','env_parent_record_id'],
    ARRAY['email_sends','parent_object','parent_record_id'],
    ARRAY['chat_threads','chat_parent_object','chat_parent_record_id'],
    ARRAY['status_change_events','sce_object','sce_record_id'],
    ARRAY['flow_date_fires','fdf_object','fdf_record_id']];
BEGIN
  CREATE TEMP TABLE _pmap (loser uuid PRIMARY KEY, survivor uuid, match_key text) ON COMMIT DROP;
  CREATE TEMP TABLE _bmap (loser uuid PRIMARY KEY, survivor uuid, match_key text) ON COMMIT DROP;

  -- Grouping key is lower(btrim(property_street)), not
  -- normalize_street_address(property_street): they are equivalent because the
  -- trigger normalizes on every write and migration 20260817174254 backfilled
  -- every live row, and calling the plpgsql normalizer 17,542 times per run was
  -- itself a timeout.
  WITH keyed AS (
    SELECT p.id, lower(btrim(p.property_street)) AS st,
           left(btrim(p.property_zip), 5) AS z, p.property_created_at AS created
      FROM public.properties p
     WHERE p.property_is_deleted IS NOT TRUE
       AND coalesce(btrim(p.property_street), '') <> ''
       AND coalesce(btrim(p.property_zip), '') <> ''
  ), dupkeys AS (
    SELECT st, z FROM keyed GROUP BY st, z HAVING count(*) > 1 ORDER BY st, z LIMIT greatest(p_max_pairs, 1)
  ), members AS (
    SELECT k.* FROM keyed k JOIN dupkeys d ON d.st = k.st AND d.z = k.z
  ), scored AS (
    SELECT m.*,
           (SELECT count(*) FROM public.buildings x WHERE x.property_id=m.id AND x.building_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.opportunities x WHERE x.property_id=m.id AND x.opportunity_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.projects x WHERE x.property_id=m.id AND x.project_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.work_orders x WHERE x.property_id=m.id AND x.work_order_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.enrollments x WHERE x.property_id=m.id AND x.enrollment_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.assessments x WHERE x.property_id=m.id AND x.assessment_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.incentive_applications x WHERE x.property_id=m.id AND x.ia_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.conversations c WHERE c.property_id=m.id)
         + (SELECT count(*) FROM public.activity_relations ar WHERE ar.ar_related_object='properties' AND ar.ar_related_id=m.id)
           AS kids
      FROM members m
  ), grouped AS (
    SELECT *, first_value(id) OVER (PARTITION BY st, z ORDER BY kids DESC, created ASC, id ASC) AS survivor FROM scored
  )
  INSERT INTO _pmap (loser, survivor, match_key)
  SELECT id, survivor, st || ' / ' || z FROM grouped WHERE id <> survivor AND kids = 0;

  SELECT count(*) INTO v_props FROM _pmap;

  IF v_props > 0 THEN
    -- property_hud_property_id and property_lihtc_project_id carry partial
    -- UNIQUE indexes and collide when copied onto the survivor.
    SELECT 'UPDATE public.properties s SET ' || string_agg(format('%I = coalesce(s.%I, l.%I)', c, c, c), ', ')
           || ' FROM public.properties l, _pmap m WHERE s.id = m.survivor AND l.id = m.loser'
      INTO v_sql FROM (
        SELECT a.attname AS c FROM pg_attribute a
          JOIN pg_class cl ON cl.oid = a.attrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
         WHERE n.nspname='public' AND cl.relname='properties'
           AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
           AND a.attname NOT IN ('id','property_record_number','property_name',
                'property_street','property_city','property_state','property_zip',
                'property_created_at','property_created_by','property_updated_at',
                'property_updated_by','property_is_deleted','property_deletion_reason',
                'property_deleted_by','property_deleted_at','is_seed_data','property_owner',
                'property_hud_property_id','property_lihtc_project_id')) q;
    BEGIN EXECUTE v_sql;
    EXCEPTION WHEN others THEN v_skip := v_skip || jsonb_build_object('properties field carry', SQLERRM); END;

    -- pg_catalog, not information_schema: the equivalent information_schema
    -- constraint join measured 36.8 SECONDS on this database, against 12.7ms here.
    FOR r IN
      SELECT cl.relname AS tbl, att.attname AS col
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        JOIN pg_class rf ON rf.oid = con.confrelid
        CROSS JOIN LATERAL unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
       WHERE con.contype='f' AND n.nspname='public' AND cl.relkind='r' AND rf.relname='properties'
       ORDER BY 1,2
    LOOP
      BEGIN
        EXECUTE format('UPDATE public.%I t SET %I = m.survivor FROM _pmap m WHERE t.%I = m.loser', r.tbl, r.col, r.col);
        GET DIAGNOSTICS v_n = ROW_COUNT; v_refs := v_refs + v_n;
      EXCEPTION WHEN others THEN v_skip := v_skip || jsonb_build_object(r.tbl || '.' || r.col, SQLERRM); END;
    END LOOP;

    FOR i IN 1 .. array_length(POLY, 1) LOOP
      BEGIN
        EXECUTE format('UPDATE public.%I t SET %I = m.survivor FROM _pmap m WHERE t.%I = m.loser AND t.%I = ''properties''',
                       POLY[i][1], POLY[i][3], POLY[i][3], POLY[i][2]);
        GET DIAGNOSTICS v_n = ROW_COUNT; v_refs := v_refs + v_n;
      EXCEPTION WHEN others THEN v_skip := v_skip || jsonb_build_object(POLY[i][1] || ' (poly)', SQLERRM); END;
    END LOOP;

    INSERT INTO public.property_merge_log (pml_object, pml_survivor_id, pml_merged_id, pml_match_key, pml_performed_by)
    SELECT 'properties', m.survivor, m.loser, m.match_key, v_actor FROM _pmap m;

    UPDATE public.properties p
       SET property_is_deleted = true,
           property_deletion_reason = format('Merged into %s (duplicate address)', s.property_record_number),
           property_deleted_by = v_actor, property_deleted_at = now()
      FROM _pmap m JOIN public.properties s ON s.id = m.survivor
     WHERE p.id = m.loser;
  END IF;

  -- Buildings duplicated on the SAME property, again childless losers only.
  WITH keyed AS (
    SELECT x.id, x.property_id,
           lower(btrim(coalesce(x.building_number_or_name, x.building_name))) AS k,
           x.building_created_at AS created
      FROM public.buildings x WHERE x.building_is_deleted IS NOT TRUE
  ), dupkeys AS (
    SELECT property_id, k FROM keyed GROUP BY property_id, k HAVING count(*) > 1 LIMIT greatest(p_max_pairs, 1)
  ), members AS (SELECT kk.* FROM keyed kk JOIN dupkeys d ON d.property_id=kk.property_id AND d.k=kk.k
  ), scored AS (
    SELECT m.*,
           (SELECT count(*) FROM public.units u WHERE u.building_id=m.id AND u.unit_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.work_orders w WHERE w.building_id=m.id AND w.work_order_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.opportunities o WHERE o.building_id=m.id AND o.opportunity_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.assessments a WHERE a.building_id=m.id AND a.assessment_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.enrollments e WHERE e.building_id=m.id AND e.enrollment_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.projects pj WHERE pj.building_id=m.id AND pj.project_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.conversations c WHERE c.building_id=m.id)
         + (SELECT count(*) FROM public.activity_relations ar WHERE ar.ar_related_object='buildings' AND ar.ar_related_id=m.id)
           AS kids FROM members m
  ), grouped AS (
    SELECT *, first_value(id) OVER (PARTITION BY property_id, k ORDER BY kids DESC, created ASC, id ASC) AS survivor FROM scored
  )
  INSERT INTO _bmap (loser, survivor, match_key)
  SELECT id, survivor, k FROM grouped WHERE id <> survivor AND kids = 0;
  SELECT count(*) INTO v_blds FROM _bmap;

  IF v_blds > 0 THEN
    INSERT INTO public.property_merge_log (pml_object, pml_survivor_id, pml_merged_id, pml_match_key, pml_performed_by)
    SELECT 'buildings', m.survivor, m.loser, m.match_key, v_actor FROM _bmap m;

    UPDATE public.buildings b
       SET building_is_deleted = true,
           building_deletion_reason = format('Merged into %s (duplicate building on the same property)', s.building_record_number),
           building_deleted_by = v_actor, building_deleted_at = now()
      FROM _bmap m JOIN public.buildings s ON s.id = m.survivor
     WHERE b.id = m.loser;
  END IF;

  -- Pairs deliberately left for a person: the loser owns records that cannot be
  -- reparented, so merging it would destroy them.
  WITH keyed AS (
    SELECT p.id, lower(btrim(p.property_street)) AS st, left(btrim(p.property_zip), 5) AS z,
           p.property_created_at AS created
      FROM public.properties p
     WHERE p.property_is_deleted IS NOT TRUE
       AND coalesce(btrim(p.property_street), '') <> '' AND coalesce(btrim(p.property_zip), '') <> ''
  ), dupkeys AS (SELECT st, z FROM keyed GROUP BY st, z HAVING count(*) > 1
  ), members AS (SELECT k.* FROM keyed k JOIN dupkeys d ON d.st=k.st AND d.z=k.z
  ), scored AS (
    SELECT m.*,
           (SELECT count(*) FROM public.buildings x WHERE x.property_id=m.id AND x.building_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.opportunities x WHERE x.property_id=m.id AND x.opportunity_is_deleted IS NOT TRUE)
         + (SELECT count(*) FROM public.work_orders x WHERE x.property_id=m.id AND x.work_order_is_deleted IS NOT TRUE)
           AS kids FROM members m
  ), grouped AS (
    SELECT *, first_value(id) OVER (PARTITION BY st, z ORDER BY kids DESC, created ASC, id ASC) AS survivor FROM scored
  )
  SELECT count(*) INTO v_left FROM grouped WHERE id <> survivor AND kids > 0;

  RETURN QUERY SELECT v_props, v_blds, v_refs, v_left, v_skip;
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_duplicate_properties(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_duplicate_properties(int) FROM anon;
REVOKE ALL ON FUNCTION public.merge_duplicate_properties(int) FROM authenticated;

-- Run it. Idempotent: once merged, no duplicate group has a childless loser, so
-- a replay merges 0. On prod this merged 880 properties and left 1 pair alone
-- (15008 Statesville Road, where both sides own a building, an opportunity, a
-- project and a work order).
SELECT public.merge_duplicate_properties(2000);

NOTIFY pgrst, 'reload schema';
