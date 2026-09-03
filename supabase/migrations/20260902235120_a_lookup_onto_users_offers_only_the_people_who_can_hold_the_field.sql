-- A lookup offers only the people who can actually hold the field.
--
-- Nicholas, 2026-09-02, creating an Insulation Removal work order: "there's a
-- whole bunch of people under the assigned technician that aren't technicians.
-- Only technicians and people that can get work orders, like our users, should
-- show up under the assigned technician picklist."
--
-- assigned_technician_id is an FK to public.users and always has been, so the
-- picker was not offering contacts -- but it was offering EVERY user, because
-- fetchLookupOptions selects the target table with no filter beyond its
-- soft-delete column. On this database that is 13 people including three
-- Admins, a Program Manager and an Operations Manager, none of whom take a
-- work order.
--
-- Who is a field technician is ALREADY a stored fact: users.user_is_field_
-- technician, maintained on the user record and deliberately not derived from
-- the role (a role is an access grant; being on a crew is a job fact, and
-- Nicholas is an Admin who also carries a work order). The picker simply never
-- consulted it.
--
-- The scope is a declared property of the FIELD, in field_metadata alongside
-- fm_display_type, so one row scopes the column on every layout that carries
-- it and on any layout built later. Ten work-order layouts carry
-- assigned_technician_id; a hand-edit would have to find all ten, then be
-- redone for the eleventh.

ALTER TABLE public.field_metadata
  ADD COLUMN IF NOT EXISTS fm_lookup_filter jsonb;

COMMENT ON COLUMN public.field_metadata.fm_lookup_filter IS
  'Equality filter applied to a lookup field''s option list, as {column: value}. '
  'NULL means the lookup offers every live row of its target table, which is the '
  'behaviour every lookup had before 2026-09-02. Applied on top of the target''s '
  'soft-delete column, never instead of it.';

-- The two work-order columns naming a person who must be able to receive field
-- work. project_site_lead_contact_id is deliberately NOT scoped here: it points
-- at contacts, and a site lead who is the customer's own representative is a
-- real thing. Only the two user-facing columns are scoped.
WITH target(obj, col, lbl, filt) AS (
  VALUES
    ('work_orders', 'assigned_technician_id', 'Assigned Technician',
       '{"user_is_field_technician": true, "user_is_active": true}'::jsonb),
    ('work_orders', 'project_site_lead_user_id', 'Project Site Lead',
       '{"user_is_field_technician": true, "user_is_active": true}'::jsonb)
)
INSERT INTO public.field_metadata (fm_record_number, fm_object, fm_column, fm_label, fm_lookup_filter)
SELECT '', t.obj, t.col, t.lbl, t.filt
  FROM target t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.field_metadata fm
    WHERE fm.fm_object = t.obj AND fm.fm_column = t.col AND fm.fm_is_deleted IS NOT TRUE
 );

UPDATE public.field_metadata fm
   SET fm_lookup_filter = t.filt,
       fm_updated_at    = now()
  FROM (VALUES
    ('work_orders', 'assigned_technician_id',
       '{"user_is_field_technician": true, "user_is_active": true}'::jsonb),
    ('work_orders', 'project_site_lead_user_id',
       '{"user_is_field_technician": true, "user_is_active": true}'::jsonb)
  ) AS t(obj, col, filt)
 WHERE fm.fm_object = t.obj AND fm.fm_column = t.col
   AND fm.fm_is_deleted IS NOT TRUE
   AND fm.fm_lookup_filter IS DISTINCT FROM t.filt;

DO $$
DECLARE
  v_rows int; v_all_users int; v_offered int;
BEGIN
  SELECT count(*) INTO v_rows
    FROM public.field_metadata
   WHERE fm_object = 'work_orders'
     AND fm_column IN ('assigned_technician_id', 'project_site_lead_user_id')
     AND fm_is_deleted IS NOT TRUE AND fm_lookup_filter IS NOT NULL;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'expected a lookup filter on both work-order person columns, found %', v_rows;
  END IF;

  SELECT count(*) INTO v_all_users FROM public.users WHERE user_is_deleted IS NOT TRUE;
  SELECT count(*) INTO v_offered   FROM public.users
   WHERE user_is_deleted IS NOT TRUE AND user_is_active AND user_is_field_technician;

  -- A filter that narrows nothing is a filter nobody needed; one that empties
  -- the picker is worse than the bug, because the field becomes unfillable.
  IF v_offered = 0 THEN
    RAISE EXCEPTION 'no active field technician exists — the picker would be empty';
  END IF;
  IF v_offered >= v_all_users THEN
    RAISE EXCEPTION 'the filter does not narrow the list (% offered of % users)', v_offered, v_all_users;
  END IF;
END $$;
