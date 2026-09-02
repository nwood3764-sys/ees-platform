-- datetime fields become editable on record pages (no editor existed before),
-- so the ones a PERSON must never rewrite have to say so on the layout.
--
-- Two groups, both "the platform stamps this, nobody types it":
--
--   1. Soft-delete timestamps. Recycle-bin metadata owned by the delete
--      machinery; editing one would rewrite when a record was removed.
--
--   2. The e-signature, notification and delivery trail. env_sent_at,
--      recipient_signed_at and their siblings are EVIDENCE — an auditor reads
--      them to establish when a property owner signed. They are written by the
--      signing pipeline and the Graph mail path, never by hand, and making them
--      editable would turn an audit trail into a text box.
--
-- Deliberately NOT locked, because a person legitimately sets them:
--   activities.performed_at        — when the call actually happened
--   sa_actual_start_time / _end    — corrected after the fact from the field
--   tse_clock_in_time / _out       — a timesheet correction is a real workflow
--   work_order_start/end_datetime, occurrence_date_and_time, mr_need_by_datetime
--
-- system_audit is the mechanism the record page already reads for exactly this
-- (2026-08-22), so this adds no new concept and each field stays individually
-- unlockable in the layout editor.
UPDATE page_layout_widgets w
   SET widget_config = jsonb_set(
         w.widget_config, '{fields}',
         (
           SELECT jsonb_agg(
             CASE
               WHEN f->>'type' = 'datetime' AND (
                      f->>'name' ~ '_deleted_at$' OR f->>'name' = 'deleted_at'
                   OR f->>'name' IN (
                        'env_sent_at','env_delivered_at','env_completed_at',
                        'env_declined_at','env_voided_at','env_failed_at',
                        'recipient_sent_at','recipient_delivered_at','recipient_signed_at',
                        'recipient_declined_at','recipient_consent_at','recipient_token_expires_at',
                        'tab_filled_at','sent_at','read_at','last_login',
                        'sr_last_sent_at','sr_next_send_at','gps_time_stamp',
                        'conv_last_message_at','taken_at','signed_at','verified_at'
                      ))
                 THEN f || jsonb_build_object('system_audit', true)
               ELSE f
             END ORDER BY ord)
           FROM jsonb_array_elements(w.widget_config->'fields') WITH ORDINALITY AS t(f, ord)
         )),
       updated_at = now()
  FROM page_layout_sections s
  JOIN page_layouts pl ON pl.id = s.page_layout_id
 WHERE w.section_id = s.id
   AND pl.is_deleted IS NOT TRUE AND s.is_deleted IS NOT TRUE AND w.is_deleted IS NOT TRUE
   AND w.widget_config ? 'fields';

-- Assert both directions: nothing platform-stamped is left editable, and the
-- fields a person genuinely fills in were NOT swept up.
DO $do$
DECLARE v_open int; v_locked_business int; v_sched int;
BEGIN
  SELECT count(*) INTO v_open
  FROM page_layouts pl
  JOIN page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
  JOIN page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.is_deleted IS NOT TRUE AND f->>'type' = 'datetime'
    AND NOT COALESCE((f->>'system_audit')::boolean, false)
    AND (f->>'name' ~ '_deleted_at$' OR f->>'name' = 'deleted_at'
         OR f->>'name' IN ('recipient_signed_at','env_completed_at','signed_at','verified_at'));
  IF v_open > 0 THEN
    RAISE EXCEPTION '% platform-stamped datetime field(s) are still editable', v_open;
  END IF;

  SELECT count(*) INTO v_locked_business
  FROM page_layouts pl
  JOIN page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
  JOIN page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.is_deleted IS NOT TRUE AND f->>'type' = 'datetime'
    AND COALESCE((f->>'system_audit')::boolean, false)
    AND f->>'name' IN ('sa_scheduled_start_time','sa_scheduled_end_time',
                       'work_order_start_datetime','work_order_end_datetime',
                       'tse_clock_in_time','tse_clock_out_time','performed_at');
  IF v_locked_business > 0 THEN
    RAISE EXCEPTION '% field(s) a person must fill in were wrongly locked', v_locked_business;
  END IF;

  -- The two that started this must be editable and required.
  SELECT count(*) INTO v_sched
  FROM page_layouts pl
  JOIN page_layout_sections s ON s.page_layout_id = pl.id AND s.is_deleted IS NOT TRUE
  JOIN page_layout_widgets w ON w.section_id = s.id AND w.is_deleted IS NOT TRUE
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.widget_config->'fields','[]'::jsonb)) f
  WHERE pl.page_layout_object = 'service_appointments' AND pl.is_deleted IS NOT TRUE
    AND f->>'name' IN ('sa_scheduled_start_time','sa_scheduled_end_time')
    AND (f->>'required')::boolean IS TRUE
    AND NOT COALESCE((f->>'system_audit')::boolean, false);
  IF v_sched <> 2 THEN
    RAISE EXCEPTION 'Scheduled Start/End are not both editable and required (got %)', v_sched;
  END IF;
END
$do$;
