-- The HUD owner fields stay on the property record. The Property ACCOUNT is what
-- inherits everywhere.
--
-- Ruled (Nicholas, 2026-09-01), after 20260901221600 fixed one field:
--
--   "The HUD owner should not be cascading like this or being inherited. That's
--    only for the account record or property record in those specific fields
--    only."
--   "The property account on the property object record is what should be
--    inherited everywhere. The HUD owner and HUD owner address and HUD
--    management org and HUD owner email and HUD owner phone number are only on
--    those specific fields on the property record and don't get moved anywhere
--    else."
--
-- 20260901221600 fixed exactly one field. A sweep found the same wiring in 52
-- more places, all of them putting HUD text on a child record or a program form:
--
--   * 46 field placements on ENROLLMENT layouts -- the "Owner Entity" section
--     (Owner Organization / Email / Phone) and the "Management Agent" section
--     (Management Agent / Mgmt Email / Mgmt Phone) on 7 record types plus the
--     record-type-less layout, and the "Property Owner Name" / "Building Owner
--     Name" / "Business Entity Name" fields on the Assessment-Preapproval, HEAR
--     Project Reservation and HOMES Project Reservation layouts;
--   * 6 field placements on the WI / NC / MI MF-HOMES PROJECT-PAYMENT-REQUEST
--     incentive application layouts ("Business Entity Name", "Building Owner
--     Name");
--   * build_wi_ira_assessment_prefill, which fills the Focus On Energy
--     assessment form's owner name.
--
-- Every one read property_hud_owner_org / _email / _phone or
-- property_hud_management_org / _email / _phone through a cross-object related
-- field. HUD text is what the HUD file said when the property was imported; it
-- names a previous owner often enough to matter (PROP-07530 still says
-- "Independence of Wisconsin, Inc." for a property owned by Lutheran Social
-- Services), and being a related field it was READ-ONLY on the child, so there
-- was nowhere to correct it either.
--
-- WHAT REPLACES IT: first-class Inherited Fields on the account, which is where
-- LEAP records ownership. They resolve live at read through the same engine
-- ia_business_entity_name already uses, so they can never go stale and there is
-- no new mechanism here -- six field_metadata rows and a rebind.
--
--   Owner        -> property_id -> properties.property_account_id            -> accounts
--   Management   -> property_id -> properties.property_management_company_id -> accounts
--
-- The management route is the second half of the same rule: a management agent
-- is a company, so it is an account, and properties.property_management_company_id
-- is where the property names it. (Per the 2026-07-25 ruling it may point at a
-- Property Owner account -- the lookup is not record-type filtered.)
--
-- NOT touched, deliberately:
--   * the property and account layouts -- the HUD fields keep their own place
--     there, which is exactly what the ruling preserves;
--   * global_search, which searches properties BY their HUD owner name -- that
--     is the property's own field being searched, not inherited onto anything;
--   * import_property_batch and merge_duplicate_properties, which write and
--     merge the property's own HUD columns.

-- ---------------------------------------------------------------------------
-- 1. The six inherited fields
-- ---------------------------------------------------------------------------
-- Named for what they are on an enrollment. The three owner names match the
-- columns the client prefill has referenced since the enrollment stopped keeping
-- its own copies -- those columns no longer exist, so the references resolved to
-- nothing; they now resolve to the owner account.

INSERT INTO public.field_metadata
  (fm_record_number, fm_object, fm_column, fm_label, fm_is_custom, fm_field_kind,
   fm_display_type, fm_financial_tier, fm_track_history, fm_inherit_config)
SELECT '', 'enrollments', v.col, v.label, true, 'inherited', v.disp, 1, false,
       jsonb_build_object(
         'hops', jsonb_build_array(
           jsonb_build_object('fk','property_id','table','properties'),
           jsonb_build_object('fk', v.account_fk, 'table','accounts')),
         'display_type', v.disp,
         'source_column', v.src,
         'source_data_type', 'text')
  FROM (VALUES
    ('enrollment_owner_organization', 'Owner Organization', 'text',  'account_name',  'property_account_id'),
    ('enrollment_owner_email',        'Owner Email',        'email', 'account_email', 'property_account_id'),
    ('enrollment_owner_phone',        'Owner Phone',        'phone', 'account_phone', 'property_account_id'),
    ('enrollment_management_agent',   'Management Agent',   'text',  'account_name',  'property_management_company_id'),
    ('enrollment_management_email',   'Mgmt Email',         'email', 'account_email', 'property_management_company_id'),
    ('enrollment_management_phone',   'Mgmt Phone',         'phone', 'account_phone', 'property_management_company_id')
  ) AS v(col, label, disp, src, account_fk)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.field_metadata fm
    WHERE fm.fm_object = 'enrollments' AND fm.fm_column = v.col AND fm.fm_is_deleted IS NOT TRUE);

-- ---------------------------------------------------------------------------
-- 2. Rebind every placement on a child object
-- ---------------------------------------------------------------------------
-- The label is KEPT exactly as it is: these labels are the program form's own
-- wording ("Business Entity Name", "Building Owner Name", "Management Agent"),
-- and a layout may legitimately carry the same field twice under two of the
-- form's labels. Only the binding changes.

DO $$
DECLARE
  r      record;
  v_new  jsonb;
  v_hits integer := 0;
BEGIN
  FOR r IN
    SELECT w.id, w.widget_config, pl.page_layout_object AS obj
      FROM public.page_layouts pl
      JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
      JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
     WHERE pl.is_deleted IS NOT TRUE
       AND pl.page_layout_object NOT IN ('properties','accounts')
       AND w.widget_type = 'field_group'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(w.widget_config->'fields') f
          WHERE f->>'name' LIKE 'property_id.property_hud_owner_%'
             OR f->>'name' LIKE 'property_id.property_hud_management_%')
  LOOP
    SELECT jsonb_build_object('fields', jsonb_agg(nf ORDER BY ord))
      INTO v_new
      FROM (
        SELECT ord,
          CASE
            -- Incentive applications already own both answers.
            WHEN r.obj = 'incentive_applications'
             AND f->>'name' = 'property_id.property_hud_owner_org'
            THEN (f - 'related')
                 || jsonb_build_object(
                      'name', CASE WHEN f->>'label' = 'Building Owner Name'
                                   THEN 'ia_property_owner_name'
                                   ELSE 'ia_business_entity_name' END,
                      'type', 'text')

            WHEN f->>'name' = 'property_id.property_hud_owner_org'
            THEN (f - 'related') || jsonb_build_object('name','enrollment_owner_organization','type','text')
            WHEN f->>'name' = 'property_id.property_hud_owner_email'
            THEN (f - 'related') || jsonb_build_object('name','enrollment_owner_email','type','email')
            WHEN f->>'name' = 'property_id.property_hud_owner_phone'
            THEN (f - 'related') || jsonb_build_object('name','enrollment_owner_phone','type','phone')
            WHEN f->>'name' = 'property_id.property_hud_management_org'
            THEN (f - 'related') || jsonb_build_object('name','enrollment_management_agent','type','text')
            WHEN f->>'name' = 'property_id.property_hud_management_email'
            THEN (f - 'related') || jsonb_build_object('name','enrollment_management_email','type','email')
            WHEN f->>'name' = 'property_id.property_hud_management_phone'
            THEN (f - 'related') || jsonb_build_object('name','enrollment_management_phone','type','phone')
            ELSE f
          END AS nf
          FROM jsonb_array_elements(r.widget_config->'fields') WITH ORDINALITY t(f, ord)
      ) x;

    UPDATE public.page_layout_widgets
       SET widget_config = r.widget_config || v_new, updated_at = now()
     WHERE id = r.id;

    v_hits := v_hits + 1;
  END LOOP;

  RAISE NOTICE 'Rebound HUD owner/management placements on % field group(s)', v_hits;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The assessment form prefill
-- ---------------------------------------------------------------------------
-- Patched in the DEPLOYED source rather than retyped, for the same reason as
-- 20260901224500: retyping a whole mapping body to change one expression is how
-- an unrelated field silently disappears.

DO $$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname = 'build_wi_ira_assessment_prefill';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'build_wi_ira_assessment_prefill not found';
  END IF;

  v_new := replace(v_src,
$o$  -- The property states its owner in two places and either one may be the only
  -- one filled in: the HUD owner-organization text (set by the HUD import) and
  -- the Property Owner ACCOUNT (how an owner is recorded when the property is
  -- created in LEAP). Take the HUD value when it has one -- it names the entity
  -- that owns THIS property, which can be narrower than the account -- and the
  -- owner account's name otherwise. A soft-deleted account names nobody.$o$,
$n$  -- The owner is the Property Owner ACCOUNT and nothing else (Nicholas,
  -- 2026-09-01). The HUD owner organization is what the HUD file said at import
  -- and is not consulted here: it names a previous owner often enough to matter,
  -- and it is not where LEAP records ownership. It keeps its own field on the
  -- property record. A soft-deleted account names nobody.$n$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'the assessment prefill owner comment was not found';
  END IF;

  v_src := v_new;
  v_new := replace(v_src,
$o$COALESCE(
             NULLIF(BTRIM(p.property_hud_owner_org), ''),
             NULLIF(BTRIM(a.account_name), '')
           )$o$,
$n$NULLIF(BTRIM(a.account_name), '')$n$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'the assessment prefill owner expression was not found';
  END IF;

  -- The alias-qualified form is the CODE reference; prose above may name the
  -- field it deliberately no longer reads.
  IF position($c$p.property_hud_$c$ in v_new) > 0 THEN
    RAISE EXCEPTION 'a HUD column reference survived the assessment prefill patch';
  END IF;

  EXECUTE v_new;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Nothing outside the property and account records may read a HUD owner field
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_left integer;
BEGIN
  SELECT count(*) INTO v_left
    FROM public.page_layouts pl
    JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
    JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
   WHERE pl.is_deleted IS NOT TRUE
     AND pl.page_layout_object NOT IN ('properties','accounts')
     AND (f->>'name' ILIKE '%hud_owner%' OR f->>'name' ILIKE '%hud_management%');

  IF v_left > 0 THEN
    RAISE EXCEPTION '% HUD owner/management placement(s) remain on a child object', v_left;
  END IF;
END $$;

-- ...and the property record still has its own.
DO $$
DECLARE v_kept integer;
BEGIN
  SELECT count(*) INTO v_kept
    FROM public.page_layouts pl
    JOIN public.page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
    JOIN public.page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
   WHERE pl.is_deleted IS NOT TRUE
     AND pl.page_layout_object = 'properties'
     AND (f->>'name' ILIKE '%hud_owner%' OR f->>'name' ILIKE '%hud_management%');

  IF v_kept = 0 THEN
    RAISE EXCEPTION 'the HUD fields were removed from the property record itself';
  END IF;
  RAISE NOTICE 'Property record keeps % HUD owner/management field(s)', v_kept;
END $$;

NOTIFY pgrst, 'reload schema';
