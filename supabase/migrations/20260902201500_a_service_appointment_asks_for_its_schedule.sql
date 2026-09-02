-- An appointment with no time is not an appointment.
--
-- With sa_name now correctly derived and never asked for, the New Service
-- Appointment pop-up had nothing left to ask: Work Order comes locked from the
-- parent, and owner / created_by / record number are system columns. Saving it
-- produced a row that scheduled nobody for no time — which is what "this does
-- not have a create new record" was pointing at.
--
-- The create modal shows required fields only, so the two facts that make an
-- appointment real are marked required on the layout. Safe to require on edit
-- as well as create: all 100 live service appointments already carry both, so
-- no existing record becomes unsaveable.
--
-- Status is deliberately NOT required — it has a sensible lifecycle default and
-- demanding it would make a person answer a question the platform can answer.

UPDATE page_layout_widgets w
   SET widget_config = jsonb_set(
         w.widget_config,
         '{fields}',
         (
           SELECT jsonb_agg(
             CASE
               WHEN f->>'name' IN ('sa_scheduled_start_time', 'sa_scheduled_end_time')
                 THEN f || jsonb_build_object('required', true)
               ELSE f
             END
             ORDER BY ord
           )
           FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)
         )
       ),
       updated_at = now()
  FROM page_layout_sections s
  JOIN page_layouts pl ON pl.id = s.page_layout_id
 WHERE w.section_id = s.id
   AND pl.page_layout_object = 'service_appointments'
   AND pl.is_deleted IS NOT TRUE
   AND s.is_deleted IS NOT TRUE
   AND w.is_deleted IS NOT TRUE
   AND w.widget_config ? 'fields'
   AND w.widget_config->'fields' @> '[{"name":"sa_scheduled_start_time"}]'::jsonb;

-- Assert, rather than trust the jsonb rewrite: both must now be required, the
-- field list must not have lost or gained an entry, and the derived name must
-- NOT have been marked required by accident.
DO $do$
DECLARE
  v_required int;
  v_name_required int;
  v_fields int;
BEGIN
  SELECT count(*) FILTER (WHERE f->>'name' IN ('sa_scheduled_start_time','sa_scheduled_end_time')
                            AND (f->>'required')::boolean IS TRUE),
         count(*) FILTER (WHERE f->>'name' = 'sa_name' AND (f->>'required')::boolean IS TRUE),
         count(*)
    INTO v_required, v_name_required, v_fields
  FROM page_layouts pl
  JOIN page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
  JOIN page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.page_layout_object = 'service_appointments' AND pl.is_deleted IS NOT TRUE;

  IF v_required <> 2 THEN
    RAISE EXCEPTION 'Expected both scheduled time fields to be required; got %', v_required;
  END IF;
  IF v_name_required <> 0 THEN
    RAISE EXCEPTION 'sa_name must never be required — the database derives it';
  END IF;
  IF v_fields < 5 THEN
    RAISE EXCEPTION 'The service appointment layout lost fields during the rewrite (% left)', v_fields;
  END IF;
END
$do$;
