-- ---------------------------------------------------------------------------
-- Child lookups are scoped to the record's own parent chain
--
-- Nicholas, 2026-08-22, from the Unit picker on WO-00204 (a Rocky Mount, NC
-- work order) offering Waunona Woods Court units in Madison, WI: "the unit
-- field on work orders should only have units from that specific building.
-- You shouldn't be a universal sort. There has to be a filter... If there's
-- other places like this, we need to lock it down."
--
-- The rule already exists — dependent lookups (opportunities_for_property,
-- buildings_for_property, projects_for_opportunity...) were built for exactly
-- this — it was simply never applied past the opportunity picker. On work
-- orders alone, Unit (11 layouts), Project (10), Building (8) and Contact (3)
-- all listed the entire platform.
--
-- Two new scopes are needed to finish the chain:
--
--   units_for_building          a unit belongs to a building; when the record
--                               has no building yet, the property's units are
--                               the widest honest answer
--   contacts_for_property_chain a work order's contact is a person connected
--                               to THIS job: the program's site contact, the
--                               property's and building's contacts, the
--                               opportunity's contact roles, and the people at
--                               the owning account (and its parents)
--
-- The layout sweep at the bottom is table-driven and only applies a scope to a
-- layout that actually carries the column it depends on — a layout with no
-- Property field keeps an unscoped Building picker rather than a dead one.
-- ---------------------------------------------------------------------------

-- ── Units of a building (falling back to the property) ─────────────────────
CREATE OR REPLACE FUNCTION public.list_units_for_building(
  p_building_ids  uuid[],
  p_property_ids  uuid[] DEFAULT NULL,
  p_include_unit_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, unit_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT u.id, u.unit_name
    FROM units u
    LEFT JOIN buildings b ON b.id = u.building_id AND b.building_is_deleted = false
   WHERE u.unit_is_deleted = false
     AND (
       -- A building was chosen: only its units.
       (p_building_ids IS NOT NULL AND array_length(p_building_ids, 1) > 0
         AND u.building_id = ANY(p_building_ids))
       -- No building yet: every unit on the property, across its buildings.
       OR (COALESCE(array_length(p_building_ids, 1), 0) = 0
           AND p_property_ids IS NOT NULL AND array_length(p_property_ids, 1) > 0
           AND b.property_id = ANY(p_property_ids))
       -- Whatever is already saved stays visible, so an existing value never
       -- renders blank because the scope narrowed around it.
       OR (p_include_unit_id IS NOT NULL AND u.id = p_include_unit_id)
     )
   ORDER BY u.unit_name ASC, u.id ASC;
$fn$;

REVOKE ALL ON FUNCTION public.list_units_for_building(uuid[], uuid[], uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_units_for_building(uuid[], uuid[], uuid) TO authenticated;

-- ── Contacts connected to this property / opportunity ──────────────────────
CREATE OR REPLACE FUNCTION public.list_contacts_for_property_chain(
  p_property_ids     uuid[],
  p_opportunity_ids  uuid[] DEFAULT NULL,
  p_include_contact_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, contact_name text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  WITH RECURSIVE owning AS (
    -- The accounts that own the property, plus every ancestor: a contact is
    -- never duplicated down a family tree, so the site contact may live on the
    -- parent company.
    SELECT a.id, a.parent_account_id, 0 AS depth
      FROM properties p
      JOIN accounts a ON a.id = p.property_account_id
     WHERE p_property_ids IS NOT NULL AND p.id = ANY(p_property_ids)
       AND NOT a.account_is_deleted
    UNION ALL
    SELECT parent.id, parent.parent_account_id, chain.depth + 1
      FROM owning chain
      JOIN accounts parent ON parent.id = chain.parent_account_id
     WHERE NOT parent.account_is_deleted AND chain.depth < 20
  ),
  tree AS (SELECT DISTINCT id FROM owning),
  named AS (
    -- The specific people the chain already points at.
    SELECT p.property_primary_contact_id AS contact_id
      FROM properties p WHERE p_property_ids IS NOT NULL AND p.id = ANY(p_property_ids)
    UNION
    SELECT b.building_primary_contact_id
      FROM buildings b WHERE p_property_ids IS NOT NULL AND b.property_id = ANY(p_property_ids)
       AND b.building_is_deleted = false
    UNION
    SELECT o.opportunity_property_site_contact
      FROM opportunities o WHERE p_opportunity_ids IS NOT NULL AND o.id = ANY(p_opportunity_ids)
    UNION
    SELECT o.opportunity_account_contact
      FROM opportunities o WHERE p_opportunity_ids IS NOT NULL AND o.id = ANY(p_opportunity_ids)
    UNION
    SELECT o.opportunity_authorized_signer_id
      FROM opportunities o WHERE p_opportunity_ids IS NOT NULL AND o.id = ANY(p_opportunity_ids)
    UNION
    SELECT ocr.contact_id
      FROM opportunity_contact_roles ocr
     WHERE p_opportunity_ids IS NOT NULL AND ocr.opportunity_id = ANY(p_opportunity_ids)
       AND ocr.ocr_is_deleted = false
  )
  SELECT c.id, c.contact_name
    FROM contacts c
   WHERE NOT c.contact_is_deleted
     AND (
       c.id IN (SELECT contact_id FROM named WHERE contact_id IS NOT NULL)
       OR c.contact_account_id IN (SELECT id FROM tree)
       OR EXISTS (
         SELECT 1 FROM account_contact_relations acr
          WHERE acr.contact_id = c.id
            AND acr.account_id IN (SELECT id FROM tree)
            AND acr.acr_is_active = true
            AND NOT acr.acr_is_deleted
       )
       OR (p_include_contact_id IS NOT NULL AND c.id = p_include_contact_id)
     )
   ORDER BY c.contact_name;
$fn$;

REVOKE ALL ON FUNCTION public.list_contacts_for_property_chain(uuid[], uuid[], uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_contacts_for_property_chain(uuid[], uuid[], uuid) TO authenticated;

-- ── Apply the scopes to every live page layout ─────────────────────────────
DO $do$
DECLARE
  v_rule    record;
  v_widget  record;
  v_fields  jsonb;
  v_field   jsonb;
  v_out     jsonb;
  v_layout_cols text[];
  v_ok      boolean;
  v_dep     text;
  v_touched integer := 0;
BEGIN
  FOR v_rule IN
    SELECT * FROM (VALUES
      -- object,                field,            kind,                          depends_on (must all be on the layout)
      ('work_orders',           'unit_id',        'units_for_building',          ARRAY['building_id','property_id']),
      ('work_orders',           'building_id',    'buildings_for_property',      ARRAY['property_id']),
      ('work_orders',           'project_id',     'projects_for_opportunity',    ARRAY['opportunity_id']),
      ('work_orders',           'opportunity_id', 'opportunities_for_property',  ARRAY['property_id']),
      ('work_orders',           'contact_id',     'contacts_for_property_chain', ARRAY['property_id']),
      ('projects',              'building_id',    'buildings_for_property',      ARRAY['property_id']),
      ('enrollments',           'opportunity_id', 'opportunities_for_property',  ARRAY['property_id']),
      ('incentive_applications','building_id',    'buildings_for_property',      ARRAY['property_id']),
      ('income_qualifications', 'building_id',    'buildings_for_property',      ARRAY['property_id']),
      ('income_qualifications', 'unit_id',        'units_for_building',          ARRAY['building_id','property_id'])
    ) AS t(obj, field, kind, depends_on)
  LOOP
    FOR v_widget IN
      SELECT w.id, w.widget_config, l.id AS layout_id
        FROM page_layout_widgets w
        JOIN page_layout_sections s ON s.id = w.section_id AND COALESCE(s.is_deleted,false) = false
        JOIN page_layouts l ON l.id = s.page_layout_id AND COALESCE(l.is_deleted,false) = false
       WHERE COALESCE(w.is_deleted,false) = false
         AND w.widget_type = 'field_group'
         AND l.page_layout_object = v_rule.obj
         AND w.widget_config @> jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('name', v_rule.field)))
    LOOP
      -- Every column this scope depends on has to exist somewhere on the SAME
      -- layout, otherwise the picker would have nothing to read and would
      -- dead-end on an empty list.
      SELECT array_agg(f2->>'name') INTO v_layout_cols
        FROM page_layout_widgets w2
        JOIN page_layout_sections s2 ON s2.id = w2.section_id AND COALESCE(s2.is_deleted,false) = false
        CROSS JOIN LATERAL jsonb_array_elements(w2.widget_config->'fields') f2
       WHERE s2.page_layout_id = v_widget.layout_id
         AND COALESCE(w2.is_deleted,false) = false
         AND w2.widget_type = 'field_group';

      v_ok := true;
      FOREACH v_dep IN ARRAY v_rule.depends_on LOOP
        IF NOT (v_dep = ANY(COALESCE(v_layout_cols, ARRAY[]::text[]))) THEN
          v_ok := false;
        END IF;
      END LOOP;
      CONTINUE WHEN NOT v_ok;

      v_out := '[]'::jsonb;
      FOR v_field IN SELECT f FROM jsonb_array_elements(v_widget.widget_config->'fields') f LOOP
        IF v_field->>'name' = v_rule.field AND NOT (v_field ? 'lookup_dependency') THEN
          v_field := v_field
            || jsonb_build_object('type', 'lookup')
            || jsonb_build_object('lookup_dependency', jsonb_build_object(
                 'kind', v_rule.kind,
                 'depends_on', to_jsonb(v_rule.depends_on)));
          v_touched := v_touched + 1;
        END IF;
        v_out := v_out || jsonb_build_array(v_field);
      END LOOP;

      UPDATE page_layout_widgets
         SET widget_config = jsonb_set(widget_config, '{fields}', v_out),
             updated_at = now()
       WHERE id = v_widget.id;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Scoped % child lookup field(s) to their parent chain.', v_touched;
END $do$;

NOTIFY pgrst, 'reload schema';
