-- Recently Viewed Records (Salesforce "Recent Items" / RecentlyViewed parity).
--
-- Nicholas (2026-07-28): "When I go to universal search I want to see my recent
-- items here, at least the last seven." Nothing in the platform recorded which
-- records a user had opened — the global search idle panel only showed three
-- hardcoded example chips. This adds the missing capability the enterprise-correct
-- way: a per-user, RLS-scoped log of opened records, denormalized to nothing (labels
-- are resolved live at read time through the same tables global_search reads), so a
-- renamed record shows its current name and a record the user has lost access to
-- simply drops out.
--
-- Two RPCs:
--   record_recently_viewed(table, id)  — fired when a record detail opens (upsert;
--                                         re-viewing bumps recency, revives a pruned
--                                         row, increments the view counter).
--   list_recently_viewed(limit)        — rehydrates the most-recent rows into the
--                                         exact column shape global_search returns
--                                         (plus last_viewed_at) so the search dropdown
--                                         renders them with the identical row markup.
--
-- Both are SECURITY INVOKER: the recents table is RLS-scoped to the caller, and the
-- resolver joins the real object tables so their RLS decides what the caller may see.

CREATE TABLE IF NOT EXISTS public.user_recently_viewed_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urv_user_id         uuid NOT NULL REFERENCES public.users(id),
  urv_object_table    text NOT NULL,
  urv_record_id       uuid NOT NULL,
  urv_last_viewed_at  timestamptz NOT NULL DEFAULT now(),
  urv_view_count      integer NOT NULL DEFAULT 1,
  is_deleted          boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_recently_viewed_records_one_per_user_record
    UNIQUE (urv_user_id, urv_object_table, urv_record_id)
);

CREATE INDEX IF NOT EXISTS user_recently_viewed_records_user_recency_idx
  ON public.user_recently_viewed_records (urv_user_id, urv_last_viewed_at DESC)
  WHERE is_deleted = false;

ALTER TABLE public.user_recently_viewed_records ENABLE ROW LEVEL SECURITY;

-- A recents entry is a personal footprint: each user reads and manages ONLY their
-- own rows. current_app_user_id() translates auth.users.id -> public.users.id.
DROP POLICY IF EXISTS user_recently_viewed_records_select ON public.user_recently_viewed_records;
CREATE POLICY user_recently_viewed_records_select ON public.user_recently_viewed_records
  FOR SELECT TO authenticated
  USING (urv_user_id = current_app_user_id());

DROP POLICY IF EXISTS user_recently_viewed_records_insert ON public.user_recently_viewed_records;
CREATE POLICY user_recently_viewed_records_insert ON public.user_recently_viewed_records
  FOR INSERT TO authenticated
  WITH CHECK (urv_user_id = current_app_user_id());

DROP POLICY IF EXISTS user_recently_viewed_records_update ON public.user_recently_viewed_records;
CREATE POLICY user_recently_viewed_records_update ON public.user_recently_viewed_records
  FOR UPDATE TO authenticated
  USING (urv_user_id = current_app_user_id())
  WITH CHECK (urv_user_id = current_app_user_id());

REVOKE ALL ON public.user_recently_viewed_records FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.user_recently_viewed_records TO authenticated;
GRANT ALL ON public.user_recently_viewed_records TO service_role;

-- ─── Record a view ──────────────────────────────────────────────────────────
-- Fire-and-forget from the client when a record detail opens. Only the object
-- tables that global_search covers are trackable; anything else is ignored so the
-- recents log never fills with non-navigable rows. Keeps at most 50 active rows per
-- user (soft-deleting the tail — soft-deletes only, per platform standard); a later
-- re-view of a pruned record revives its row via the ON CONFLICT branch.
CREATE OR REPLACE FUNCTION public.record_recently_viewed(p_object_table text, p_record_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := current_app_user_id();
BEGIN
  IF v_uid IS NULL OR p_record_id IS NULL THEN
    RETURN;
  END IF;

  IF p_object_table IS NULL OR p_object_table NOT IN (
    'accounts','contacts','properties','buildings','units','opportunities',
    'projects','work_orders','incentive_applications','assessments','programs',
    'vehicles','equipment','product_items','users','envelopes','service_appointments'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.user_recently_viewed_records
    (urv_user_id, urv_object_table, urv_record_id)
  VALUES (v_uid, p_object_table, p_record_id)
  ON CONFLICT ON CONSTRAINT user_recently_viewed_records_one_per_user_record
  DO UPDATE SET
    urv_last_viewed_at = now(),
    urv_view_count     = public.user_recently_viewed_records.urv_view_count + 1,
    is_deleted         = false,
    updated_at         = now();

  UPDATE public.user_recently_viewed_records u
  SET is_deleted = true, updated_at = now()
  WHERE u.urv_user_id = v_uid
    AND u.is_deleted = false
    AND u.id NOT IN (
      SELECT id FROM public.user_recently_viewed_records
      WHERE urv_user_id = v_uid AND is_deleted = false
      ORDER BY urv_last_viewed_at DESC
      LIMIT 50
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_recently_viewed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_recently_viewed(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_recently_viewed(text, uuid) TO service_role;

-- ─── List recent views ──────────────────────────────────────────────────────
-- Returns the caller's most-recently-viewed records in global_search's exact column
-- shape (+ last_viewed_at). Labels are resolved live by joining the object tables, so
-- names stay current and RLS on each table filters out records the caller can no
-- longer see. Overfetch (limit*3) so RLS/soft-delete drops don't shrink the result
-- below the requested count before the final LIMIT.
CREATE OR REPLACE FUNCTION public.list_recently_viewed(p_limit integer DEFAULT 10)
 RETURNS TABLE(object_type text, object_label text, table_name text, id uuid,
               primary_label text, secondary_label text, record_number text,
               last_viewed_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH recents AS (
    SELECT r.urv_object_table, r.urv_record_id, r.urv_last_viewed_at
    FROM public.user_recently_viewed_records r
    WHERE r.urv_user_id = current_app_user_id()
      AND r.is_deleted = false
    ORDER BY r.urv_last_viewed_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 10), 1) * 3
  ),
  resolved (object_type, object_label, table_name, id,
            primary_label, secondary_label, record_number, last_viewed_at) AS (
    SELECT 'account'::text, 'Accounts'::text, 'accounts'::text, a.id,
           a.account_name,
           COALESCE(a.account_organization_name, a.account_email, a.account_phone),
           a.account_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN accounts a ON rc.urv_object_table = 'accounts' AND a.id = rc.urv_record_id
    WHERE a.account_is_deleted = false
    UNION ALL
    SELECT 'contact'::text, 'Contacts'::text, 'contacts'::text, c.id,
           COALESCE(c.contact_name, NULLIF(TRIM(COALESCE(c.contact_first_name,'') || ' ' || COALESCE(c.contact_last_name,'')), '')),
           COALESCE(c.contact_email, c.contact_mobile_phone, c.contact_phone),
           c.contact_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN contacts c ON rc.urv_object_table = 'contacts' AND c.id = rc.urv_record_id
    WHERE c.contact_is_deleted = false
    UNION ALL
    SELECT 'property'::text, 'Properties'::text, 'properties'::text, p2.id,
           p2.property_name, p2.property_aka_name, p2.property_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN properties p2 ON rc.urv_object_table = 'properties' AND p2.id = rc.urv_record_id
    WHERE p2.property_is_deleted = false
    UNION ALL
    SELECT 'building'::text, 'Buildings'::text, 'buildings'::text, b.id,
           COALESCE(b.building_name, b.building_number_or_name), b.building_address,
           b.building_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN buildings b ON rc.urv_object_table = 'buildings' AND b.id = rc.urv_record_id
    WHERE b.building_is_deleted = false
    UNION ALL
    SELECT 'unit'::text, 'Units'::text, 'units'::text, u.id,
           COALESCE(u.unit_name, u.unit_number), u.unit_tenant_name,
           u.unit_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN units u ON rc.urv_object_table = 'units' AND u.id = rc.urv_record_id
    WHERE u.unit_is_deleted = false
    UNION ALL
    SELECT 'opportunity'::text, 'Opportunities'::text, 'opportunities'::text, o.id,
           o.opportunity_name, o.opportunity_subdivision_name,
           o.opportunity_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN opportunities o ON rc.urv_object_table = 'opportunities' AND o.id = rc.urv_record_id
    WHERE o.opportunity_is_deleted = false
    UNION ALL
    SELECT 'project'::text, 'Projects'::text, 'projects'::text, pr.id,
           pr.project_name, pr.project_program_name,
           pr.project_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN projects pr ON rc.urv_object_table = 'projects' AND pr.id = rc.urv_record_id
    WHERE pr.project_is_deleted = false
    UNION ALL
    SELECT 'work_order'::text, 'Work Orders'::text, 'work_orders'::text, wo.id,
           COALESCE(wo.work_order_name, wo.work_order_property_name), wo.work_order_customer_name,
           wo.work_order_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN work_orders wo ON rc.urv_object_table = 'work_orders' AND wo.id = rc.urv_record_id
    WHERE wo.work_order_is_deleted = false
    UNION ALL
    SELECT 'incentive_application'::text, 'Incentive Applications'::text, 'incentive_applications'::text, ia.id,
           ia.ia_name, ia.ia_program_name, ia.ia_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN incentive_applications ia ON rc.urv_object_table = 'incentive_applications' AND ia.id = rc.urv_record_id
    WHERE ia.ia_is_deleted = false
    UNION ALL
    SELECT 'assessment'::text, 'Assessments'::text, 'assessments'::text, a2.id,
           a2.assessment_name, COALESCE(a2.assessment_applicant_name, a2.assessment_building_owner_name),
           a2.assessment_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN assessments a2 ON rc.urv_object_table = 'assessments' AND a2.id = rc.urv_record_id
    WHERE a2.assessment_is_deleted = false
    UNION ALL
    SELECT 'program'::text, 'Programs'::text, 'programs'::text, pg.id,
           pg.name, pg.short_name, NULL::text, rc.urv_last_viewed_at
    FROM recents rc JOIN programs pg ON rc.urv_object_table = 'programs' AND pg.id = rc.urv_record_id
    WHERE pg.is_deleted = false
    UNION ALL
    SELECT 'vehicle'::text, 'Vehicles'::text, 'vehicles'::text, v.id,
           v.vehicle_name, v.vehicle_vin_last_3, v.vehicle_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN vehicles v ON rc.urv_object_table = 'vehicles' AND v.id = rc.urv_record_id
    WHERE v.vehicle_is_deleted = false
    UNION ALL
    SELECT 'equipment'::text, 'Equipment'::text, 'equipment'::text, e.id,
           COALESCE(e.equipment_name, e.equipment_equipment_name_or_number), e.equipment_serial_number,
           e.equipment_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN equipment e ON rc.urv_object_table = 'equipment' AND e.id = rc.urv_record_id
    WHERE e.equipment_is_deleted = false
    UNION ALL
    SELECT 'product_item'::text, 'Product Items'::text, 'product_items'::text, pi.id,
           pi.product_item_name, pi.product_item_serial_number,
           pi.product_item_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN product_items pi ON rc.urv_object_table = 'product_items' AND pi.id = rc.urv_record_id
    WHERE pi.product_item_is_deleted = false
    UNION ALL
    SELECT 'user'::text, 'Users'::text, 'users'::text, u2.id,
           COALESCE(u2.user_name, NULLIF(TRIM(COALESCE(u2.user_first_name,'') || ' ' || COALESCE(u2.user_last_name,'')), '')),
           u2.user_email, u2.user_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN users u2 ON rc.urv_object_table = 'users' AND u2.id = rc.urv_record_id
    WHERE u2.user_is_deleted = false
    UNION ALL
    SELECT 'envelope'::text, 'Signature Envelopes'::text, 'envelopes'::text, ev.id,
           ev.env_name, NULL::text, ev.env_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN envelopes ev ON rc.urv_object_table = 'envelopes' AND ev.id = rc.urv_record_id
    WHERE ev.is_deleted = false
    UNION ALL
    SELECT 'service_appointment'::text, 'Service Appointments'::text, 'service_appointments'::text, sa.id,
           sa.sa_name, NULL::text, sa.sa_record_number, rc.urv_last_viewed_at
    FROM recents rc JOIN service_appointments sa ON rc.urv_object_table = 'service_appointments' AND sa.id = rc.urv_record_id
    WHERE sa.sa_is_deleted = false
  )
  SELECT object_type, object_label, table_name, id,
         primary_label, secondary_label, record_number, last_viewed_at
  FROM resolved
  ORDER BY last_viewed_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 10), 1)
$function$;

REVOKE ALL ON FUNCTION public.list_recently_viewed(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_recently_viewed(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_recently_viewed(integer) TO service_role;

-- Help article for the new feature.
INSERT INTO public.help_articles
  (id, ha_record_number, ha_slug, ha_title, ha_summary, ha_body_markdown, ha_category, ha_audience, ha_is_published, ha_created_by)
SELECT gen_random_uuid(), 'HA-00159', 'recent-items-in-universal-search',
 'Recent Items in Universal Search',
 'The universal search bar now remembers the records you open and shows your most recent ones the moment you click into it — before you type anything.',
$md$## What it does

When you click into the universal search bar (or press **Cmd/Ctrl + K**), the dropdown
now shows your **Recent** records — the last several records you opened — before you
type a single character. It is the same idea as Salesforce's "Recent Items": a fast way
to jump back to something you were just working on.

Each recent row shows the object icon, the record's name, a secondary detail, and its
record number — identical to how search results appear. Click a row (or use **↑ / ↓**
and **Enter**) to open it.

## How records get onto the list

A record is added to your recent list whenever you **open its detail page**. Opening it
again moves it back to the top. The list holds your most recent visits, newest first,
and the search panel shows the latest seven.

## It's private to you

Your recent items are **yours alone** — each person sees only the records they
personally opened, and only records they still have access to. If a record is renamed,
your recent list shows its current name; if you lose access to a record, it drops off
the list automatically.

## Nothing yet?

If you're new or haven't opened any records, the panel shows the usual "start typing"
hint with example searches. Open a few records and they'll begin appearing here.
$md$,
 'Navigation', 'internal', true,
 (SELECT ha_created_by FROM public.help_articles WHERE ha_created_by IS NOT NULL ORDER BY ha_created_at DESC LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.help_articles WHERE ha_record_number = 'HA-00159');

NOTIFY pgrst, 'reload schema';
