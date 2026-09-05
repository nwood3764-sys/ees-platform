-- =============================================================================
-- A trigger that RE-CASES a value is not filling it in, and a comparison is
-- not an assignment.
--
-- Reported as: "Create failed — null value in column "building_number_or_name"
-- of relation "buildings" violates not-null constraint". Seventeen times on
-- 2026-09-03, from the Buildings list, from a property record page and from a
-- work order page — the user pressing Save, being refused, and eventually
-- finding the field themselves (BLD-00198 "1840" landed at 14:41, two minutes
-- after the last failure).
--
-- WHY THE FORM STOPPED ASKING. `trigger_written_columns` answers "which columns
-- does a trigger fill in", and the create pop-up uses it to avoid demanding a
-- value the database is about to compose anyway (2026-09-02: an appointment
-- saved as "NEW" comes back "3002 West Darling Street - Appleton", so asking
-- for the name was asking a person to type something thrown away one statement
-- later). It answered by matching `NEW.<col>` near an `=` in the trigger
-- source. That was two things at once, and both were wrong:
--
--   1. NORMALISATION READ AS DERIVATION. The text-case rule shipped earlier the
--      same day (20260903025114) generates, per object,
--        NEW.building_number_or_name :=
--          public.normalize_text_case(NEW.building_number_or_name, 'organization');
--      which is an assignment, so the column was reported as trigger-filled and
--      the pop-up stopped offering it. But normalize_text_case(NULL, …) is
--      NULL: a trigger that re-cases what you typed cannot invent it. The
--      database still demanded the column, and the create failed on save.
--
--   2. A COMPARISON READ AS AN ASSIGNMENT. The pattern was `:?=` — the `?`
--      makes the colon optional — so `IF NEW.widget_type = 'field_group'`, an
--      ordinary read in an IF, counted as writing widget_type. Nine more NOT
--      NULL columns were hidden from their create forms for that reason alone,
--      among them photos.related_object and four on
--      project_report_template_sections.
--
-- THE RULE NOW. A column is filled by a trigger when some trigger assigns to it
-- (a real `:=`, with the assigned expression captured) and that expression is
-- something other than a re-casing of the column itself. Stated the other way:
-- if every assignment to a column reads that same column back through
-- normalize_text_case, the value came from the person, and the form must ask.
--
-- This is deliberately NOT keyed on the generated function's name. The
-- statement shape is what makes it a normalisation, and normalize_text_case is
-- called from normalize_property_address too, not only from the generated
-- text_case_normalize__<object> functions.
--
-- THE FAILURE DIRECTION IS THE POINT: the new answer is a strict SUBSET of the
-- old one (asserted below), so a create form can only ever gain a field, never
-- lose one. Over-asking is a nuisance; under-asking is a record that cannot be
-- created.
--
-- MEASURED ON PRODUCTION BEFORE AND AFTER: 846 reported columns become 787.
-- Of the 59 that stop being hidden, 13 are NOT NULL — four from (1), nine from
-- (2) — and every one of those is a create form that could not be completed.
-- Nothing becomes newly hidden. All ten derived names LEAP composes
-- (building_name, contact_name, property_name, sa_name, assessment_name,
-- enrollment_name, work_step_name, work_plan_name, user_name, saa_name) stay
-- hidden, so the 2026-09-02 ruling is untouched.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trigger_written_columns(p_object text)
 RETURNS TABLE(column_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH trg AS (
    SELECT p.prosrc
    FROM pg_trigger t
    JOIN pg_class c     ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_proc p      ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND c.relname = p_object
      AND (t.tgtype & 2) <> 0
      AND ((t.tgtype & 4) <> 0 OR (t.tgtype & 16) <> 0)
  ),
  -- Real assignments only: ':=', never a bare '=' (which is a comparison), and
  -- the assigned expression is captured so it can be judged. A statement ends
  -- at the semicolon.
  assignments AS (
    SELECT lower(m[1]) AS col, m[2] AS assigned_expression
    FROM trg, regexp_matches(prosrc, 'NEW\.([a-z_][a-z0-9_]*)\s*:=\s*([^;]*)', 'gi') AS m
  ),
  -- A column is FILLED when at least one assignment to it is something other
  -- than re-casing the column itself. `NEW.x := normalize_text_case(NEW.x, …)`
  -- cannot produce a value where there was none, so it does not count.
  filled AS (
    SELECT col
    FROM assignments
    GROUP BY col
    HAVING bool_or(
      assigned_expression !~* ('^\s*public\.normalize_text_case\s*\(\s*NEW\.' || col || '\M')
    )
  )
  SELECT f.col::text
  FROM filled f
  JOIN information_schema.columns ic
    ON ic.table_schema = 'public'
   AND ic.table_name   = p_object
   AND ic.column_name  = f.col
  ORDER BY 1;
$function$;

COMMENT ON FUNCTION public.trigger_written_columns(text) IS
  'Columns a BEFORE INSERT/UPDATE trigger FILLS IN on this object, so a create form does not demand a value the database composes. Counts real := assignments only (a bare = is a comparison), and does not count an assignment that merely re-cases the column through normalize_text_case — a value that must still come from the person.';

REVOKE ALL ON FUNCTION public.trigger_written_columns(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trigger_written_columns(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- Assertions. The controls run in BOTH directions: the columns that must stop
-- being hidden, and the derived names that must still be hidden.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
  v_wrong   text;
BEGIN
  -- (1) and (2): these NOT NULL columns must now be offered by their create
  -- form. building_number_or_name is the reported failure; the rest are the
  -- same defect on other objects, found by running the rule over every table.
  SELECT string_agg(format('%s.%s', v.obj, v.col), ', ')
    INTO v_wrong
  FROM (VALUES
    ('accounts','account_name'),
    ('buildings','building_number_or_name'),
    ('contacts','contact_first_name'),
    ('contacts','contact_last_name'),
    ('photos','related_object'),
    ('page_layout_widgets','widget_type'),
    ('project_report_template_sections','prts_section_type')
  ) AS v(obj,col)
  WHERE EXISTS (
    SELECT 1 FROM public.trigger_written_columns(v.obj) t WHERE t.column_name = v.col
  );
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'still hidden from their create form, so still uncreatable: %', v_wrong;
  END IF;

  -- CONTROL: a name LEAP genuinely composes must STILL be hidden. If this
  -- fires, the rule has gone too far and every create form has started
  -- demanding a value the database throws away — the 2026-09-02 defect, back.
  SELECT string_agg(format('%s.%s', v.obj, v.col), ', ')
    INTO v_missing
  FROM (VALUES
    ('buildings','building_name'),
    ('contacts','contact_name'),
    ('properties','property_name'),
    ('service_appointments','sa_name'),
    ('assessments','assessment_name'),
    ('enrollments','enrollment_name'),
    ('work_steps','work_step_name'),
    ('work_plans','work_plan_name'),
    ('users','user_name'),
    ('service_appointment_assignments','saa_name')
  ) AS v(obj,col)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.trigger_written_columns(v.obj) t WHERE t.column_name = v.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'a derived name stopped being recognised, so its create form will demand it: %', v_missing;
  END IF;

  -- The normaliser genuinely cannot fill a column in: this is WHY the form has
  -- to ask. Proved rather than asserted in prose.
  IF public.normalize_text_case(NULL::text, 'organization') IS NOT NULL THEN
    RAISE EXCEPTION 'normalize_text_case invented a value from NULL — the premise of this migration is wrong';
  END IF;
  IF public.normalize_text_case('1840', 'organization') IS DISTINCT FROM '1840' THEN
    RAISE EXCEPTION 'normalize_text_case altered a value it should have left alone';
  END IF;
END $$;

-- The answer must be a strict SUBSET of the old one, on every object that has
-- any trigger at all: a create form may gain a field, never lose one. The old
-- rule is recomputed here from the same catalog so the comparison is real.
DO $$
DECLARE
  v_regressed text;
BEGIN
  WITH objects AS (
    SELECT DISTINCT c.relname AS obj
    FROM pg_trigger t
    JOIN pg_class c     ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE NOT t.tgisinternal AND (t.tgtype & 2) <> 0
      AND ((t.tgtype & 4) <> 0 OR (t.tgtype & 16) <> 0)
  ),
  old_rule AS (
    SELECT o.obj, lower(m[1]) AS col
    FROM objects o
    JOIN pg_class c     ON c.relname = o.obj
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_trigger t   ON t.tgrelid = c.oid AND NOT t.tgisinternal
    JOIN pg_proc p      ON p.oid = t.tgfoid,
    LATERAL regexp_matches(p.prosrc, 'NEW\.([a-z_][a-z0-9_]*)\s*:?=', 'gi') AS m
    WHERE (t.tgtype & 2) <> 0 AND ((t.tgtype & 4) <> 0 OR (t.tgtype & 16) <> 0)
  ),
  new_rule AS (
    SELECT o.obj, tw.column_name AS col
    FROM objects o, LATERAL public.trigger_written_columns(o.obj) tw
  )
  SELECT string_agg(format('%s.%s', nr.obj, nr.col), ', ')
    INTO v_regressed
  FROM new_rule nr
  LEFT JOIN old_rule orr ON orr.obj = nr.obj AND orr.col = nr.col
  WHERE orr.col IS NULL;

  IF v_regressed IS NOT NULL THEN
    RAISE EXCEPTION 'a column became newly hidden, which this change must never do: %', v_regressed;
  END IF;
END $$;
